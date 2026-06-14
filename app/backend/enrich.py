"""Aircraft enrichment: registration/type/operator/route + photo, with SQLite cache.

Lookup order (each result cached in aircraft_info, fetched once per hex):
  1. adsbdb   - type, manufacturer, owner, country, route/airline, photo
  2. hexdb.io - reg/type/owner/operator fallback
  3. planespotters - richer photo + photographer + attribution link
Fully graceful offline: callers fall back to the local r/t/desc fields.
"""
import asyncio
import datetime as dt

import httpx

from . import config, db

_CACHE_CLASSES = {"military", "hems", "helicopter", "drone", "ga", "emergency"}
_semaphore = asyncio.Semaphore(4)
_inflight: set[str] = set()


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _fresh(row: dict) -> bool:
    if not row or not row.get("fetched_at"):
        return False
    try:
        fetched = dt.datetime.fromisoformat(row["fetched_at"])
    except ValueError:
        return False
    ttl = config.ENRICH_NOT_FOUND_TTL_DAYS if row.get("not_found") else config.ENRICH_TTL_DAYS
    return (_now() - fetched) < dt.timedelta(days=ttl)


def _read_cache(hexid: str) -> dict | None:
    return db.query_one("select * from aircraft_info where hex=?", (hexid,))


def _write_cache(info: dict) -> None:
    con = db.connect()
    try:
        con.execute(
            """insert into aircraft_info (
              hex, registration, type, icao_type, manufacturer, operator, owner, country,
              photo_url, photo_thumb, photographer, photo_link, route_origin, route_dest,
              airline, source, fetched_at, not_found
            ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            on conflict(hex) do update set
              registration=excluded.registration, type=excluded.type,
              icao_type=excluded.icao_type, manufacturer=excluded.manufacturer,
              operator=excluded.operator, owner=excluded.owner, country=excluded.country,
              photo_url=excluded.photo_url, photo_thumb=excluded.photo_thumb,
              photographer=excluded.photographer, photo_link=excluded.photo_link,
              route_origin=excluded.route_origin, route_dest=excluded.route_dest,
              airline=excluded.airline, source=excluded.source,
              fetched_at=excluded.fetched_at, not_found=excluded.not_found""",
            (
                info["hex"], info.get("registration"), info.get("type"), info.get("icao_type"),
                info.get("manufacturer"), info.get("operator"), info.get("owner"),
                info.get("country"), info.get("photo_url"), info.get("photo_thumb"),
                info.get("photographer"), info.get("photo_link"), info.get("route_origin"),
                info.get("route_dest"), info.get("airline"), info.get("source"),
                info.get("fetched_at"), int(info.get("not_found", 0)),
            ),
        )
    finally:
        con.close()


async def _get_json(client: httpx.AsyncClient, url: str) -> dict | None:
    try:
        resp = await client.get(url)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception:  # noqa: BLE001 - any failure means "no data", stay graceful
        return None


async def _fetch_adsbdb(client, hexid: str, flight: str | None, info: dict) -> None:
    data = await _get_json(client, f"{config.ADSBDB_BASE}/aircraft/{hexid}")
    ac = (data or {}).get("response", {}).get("aircraft") if data else None
    if ac:
        info["registration"] = info.get("registration") or ac.get("registration")
        info["type"] = info.get("type") or ac.get("type")
        info["icao_type"] = info.get("icao_type") or ac.get("icao_type")
        info["manufacturer"] = info.get("manufacturer") or ac.get("manufacturer")
        info["owner"] = info.get("owner") or ac.get("registered_owner")
        info["country"] = info.get("country") or ac.get("registered_owner_country_name")
        info["found"] = True
    if flight:
        route = await _get_json(client, f"{config.ADSBDB_BASE}/callsign/{flight}")
        fr = (route or {}).get("response", {}).get("flightroute") if route else None
        if fr:
            airline = (fr.get("airline") or {}).get("name")
            info["airline"] = info.get("airline") or airline
            info["operator"] = info.get("operator") or airline
            info["route_origin"] = (fr.get("origin") or {}).get("iata_code") or (fr.get("origin") or {}).get("icao_code")
            info["route_dest"] = (fr.get("destination") or {}).get("iata_code") or (fr.get("destination") or {}).get("icao_code")
            info["found"] = True


async def _fetch_hexdb(client, hexid: str, info: dict) -> None:
    data = await _get_json(client, f"{config.HEXDB_BASE}/aircraft/{hexid}")
    if data:
        info["registration"] = info.get("registration") or data.get("Registration")
        info["type"] = info.get("type") or data.get("Type")
        info["icao_type"] = info.get("icao_type") or data.get("ICAOTypeCode")
        info["manufacturer"] = info.get("manufacturer") or data.get("Manufacturer")
        info["owner"] = info.get("owner") or data.get("RegisteredOwners")
        info["operator"] = info.get("operator") or data.get("OperatorFlagCode")
        info["found"] = True


async def _fetch_planespotters(client, hexid: str, info: dict) -> None:
    # Registration is the airframe identity; the mode-s hex can be reassigned and
    # external photo DBs may be stale, so try by registration first, then hex.
    urls = []
    if info.get("registration"):
        urls.append(f"{config.PLANESPOTTERS_BASE}/reg/{info['registration']}")
    urls.append(f"{config.PLANESPOTTERS_BASE}/hex/{hexid}")
    for url in urls:
        data = await _get_json(client, url)
        photos = (data or {}).get("photos") or []
        if photos:
            photo = photos[0]
            large = (photo.get("thumbnail_large") or {}).get("src")
            small = (photo.get("thumbnail") or {}).get("src")
            info["photo_url"] = large or small
            info["photo_thumb"] = small or large
            info["photographer"] = photo.get("photographer")
            info["photo_link"] = photo.get("link")
            info["found"] = True
            return


async def _fetch_airportdata(client, hexid: str, info: dict) -> None:
    # airport-data.com thumbnail API: by registration (r=) first (reliable airframe
    # identity), then by hex (m=), which can be stale/reassigned.
    queries = []
    if info.get("registration"):
        queries.append(f"r={info['registration']}")
    queries.append(f"m={hexid.upper()}")
    for qs in queries:
        data = await _get_json(client, f"{config.AIRPORTDATA_BASE}/ac_thumb.json?{qs}")
        items = (data or {}).get("data") or []
        if items:
            item = items[0]
            thumb = item.get("image")
            # The API returns a tiny (~200px) thumbnail; the full image lives at
            # image.airport-data.com/aircraft/<id>.jpg. Derive it from the thumb id.
            full = thumb
            if thumb and thumb.endswith(".jpg"):
                photo_id = thumb.rsplit("/", 1)[-1][:-4]
                full = f"https://image.airport-data.com/aircraft/{photo_id}.jpg"
            info["photo_url"] = full
            info["photo_thumb"] = thumb
            info["photographer"] = item.get("photographer")
            info["photo_link"] = item.get("link")
            info["found"] = True
            return


def peek(hexid: str) -> tuple[dict | None, bool]:
    """Non-blocking cache read: returns (cached_info_or_None, is_fresh)."""
    hexid = (hexid or "").lower().strip()
    cached = _read_cache(hexid)
    return cached, bool(cached and _fresh(cached))


async def get_info(hexid: str, flight: str | None = None, reg: str | None = None,
                   ac_type: str | None = None, ac_desc: str | None = None,
                   force: bool = False) -> dict:
    hexid = (hexid or "").lower().strip()
    cached = _read_cache(hexid)
    if cached and _fresh(cached) and not force:
        return cached
    if not config.ENRICH_ENABLED:
        return cached or {"hex": hexid}
    if hexid in _inflight:
        return cached or {"hex": hexid}
    _inflight.add(hexid)
    try:
        # Seed with the local tar1090 DB fields so registration-based photo
        # lookups work even when adsbdb/hexdb miss or are rate-limited.
        info: dict = {"hex": hexid, "found": False}
        if reg:
            info["registration"] = reg
        if ac_type:
            info["icao_type"] = ac_type
        async with _semaphore, httpx.AsyncClient(
            timeout=config.ENRICH_TIMEOUT, headers={"User-Agent": config.USER_AGENT}
        ) as client:
            await _fetch_adsbdb(client, hexid, flight, info)
            if not (info.get("registration") and info.get("type")):
                await _fetch_hexdb(client, hexid, info)
            # Photo sources, best first; stop once we have one with attribution.
            await _fetch_planespotters(client, hexid, info)
            if not info.get("photo_url"):
                await _fetch_airportdata(client, hexid, info)
        info["source"] = "adsbdb+hexdb+planespotters"
        info["fetched_at"] = _now().replace(microsecond=0).isoformat()
        info["not_found"] = 0 if info.pop("found", False) else 1
        _write_cache(info)
        return info
    finally:
        _inflight.discard(hexid)


async def enrich_special(aircraft_list: list[dict]) -> None:
    """Background fill of the cache for special (non-airline) traffic as it passes."""
    if not config.ENRICH_ENABLED:
        return
    tasks = []
    for aircraft in aircraft_list:
        hexid = str(aircraft.get("hex") or "").lower().strip()
        if not hexid:
            continue
        from . import classify
        klass = classify.traffic_class(
            aircraft,
            classify.military_score(aircraft)[0],
            aircraft.get("t"),
            aircraft.get("desc"),
        )
        if klass not in _CACHE_CLASSES:
            continue
        cached = _read_cache(hexid)
        if cached and _fresh(cached):
            continue
        flight = classify.clean_flight(aircraft.get("flight"))
        tasks.append(get_info(
            hexid, flight, reg=aircraft.get("r"),
            ac_type=aircraft.get("t"), ac_desc=aircraft.get("desc"),
        ))
    if tasks:
        await asyncio.gather(*tasks[:20], return_exceptions=True)
