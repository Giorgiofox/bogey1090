"""Background poll loop: fetch aircraft.json, sample, persist sightings + state."""
import asyncio
import datetime as dt
import json
import time

import httpx

from . import classify, config, db, enrich, watch

# Runtime status surfaced via /api/status.
state = {
    "last_source_ok": None,
    "last_source_error": None,
    "last_poll_at": None,
    "last_aircraft_count": 0,
    "last_insert_count": 0,
}

# hex -> (timestamp, position-tuple) for change-based sampling.
_last_samples: dict[str, tuple[float, tuple]] = {}
_SAMPLE_TTL = 3600  # evict hexes unseen for this long to bound memory


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _should_sample(hexid: str, aircraft: dict, now: float) -> bool:
    position = (
        aircraft.get("lat"), aircraft.get("lon"), aircraft.get("alt_baro"),
        aircraft.get("flight"), aircraft.get("squawk"),
    )
    previous = _last_samples.get(hexid)
    if previous is None:
        _last_samples[hexid] = (now, position)
        return True
    prev_time, prev_position = previous
    if position != prev_position or now - prev_time >= config.SAMPLE_MIN_SECONDS:
        _last_samples[hexid] = (now, position)
        return True
    return False


def _evict_stale(now: float) -> None:
    stale = [h for h, (t, _) in _last_samples.items() if now - t > _SAMPLE_TTL]
    for h in stale:
        _last_samples.pop(h, None)


def _persist(source_now, aircraft_list: list[dict]) -> int:
    """Blocking SQLite write; runs in a worker thread."""
    seen_at = now_iso()
    now = time.time()
    inserted = 0
    con = db.connect()
    watchlist = watch.load(con)
    wl_has_op = watch.has_operator_entries(watchlist)
    try:
        for aircraft in aircraft_list:
            hexid = str(aircraft.get("hex") or "").lower().strip()
            if not hexid or not _should_sample(hexid, aircraft, now):
                continue
            meta = classify.classify(aircraft)
            flight = classify.clean_flight(aircraft.get("flight"))
            raw = json.dumps(aircraft, separators=(",", ":"), sort_keys=True)
            # Watchlist match (operator needs enrichment, looked up only if needed).
            operator = None
            if wl_has_op:
                op_row = con.execute(
                    "select coalesce(operator, owner) from aircraft_info where hex=?", (hexid,)
                ).fetchone()
                operator = op_row[0] if op_row else None
            watch_entry = watch.match(watchlist, hexid, meta.reg, flight, meta.ac_type, operator)
            watched = 1 if watch_entry else 0
            watch_label = (watch_entry.get("label") or watch_entry.get("value")) if watch_entry else None
            if watch_entry:
                watch.maybe_log_event(con, watch_entry, hexid, seen_at, flight,
                                      aircraft.get("lat"), aircraft.get("lon"))
            con.execute(
                """insert into sightings (
                  seen_at, source_now, hex, flight, lat, lon, alt_baro, alt_geom, gs, track,
                  squawk, category, rssi, messages, seen, seen_pos, military_score,
                  military_reasons, reg, ac_type, ac_desc, db_flags, traffic_class, mlat,
                  watched, watch_label, raw_json
                ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    seen_at, source_now, hexid, flight, aircraft.get("lat"), aircraft.get("lon"),
                    classify.as_text(aircraft.get("alt_baro")), aircraft.get("alt_geom"),
                    aircraft.get("gs"), aircraft.get("track"),
                    classify.as_text(aircraft.get("squawk")), aircraft.get("category"),
                    aircraft.get("rssi"), aircraft.get("messages"), aircraft.get("seen"),
                    aircraft.get("seen_pos"), meta.military_score, meta.military_reasons,
                    meta.reg, meta.ac_type, meta.ac_desc, meta.db_flags, meta.traffic_class, meta.mlat,
                    watched, watch_label, raw,
                ),
            )
            con.execute(
                """insert into aircraft_state (
                  hex, first_seen_at, last_seen_at, flight, lat, lon, alt_baro, alt_geom,
                  gs, track, squawk, category, rssi, messages, military_score, military_reasons,
                  reg, ac_type, ac_desc, db_flags, traffic_class, mlat,
                  watched, watch_label, samples, raw_json
                ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
                on conflict(hex) do update set
                  last_seen_at=excluded.last_seen_at,
                  flight=coalesce(excluded.flight, aircraft_state.flight),
                  lat=excluded.lat, lon=excluded.lon, alt_baro=excluded.alt_baro,
                  alt_geom=excluded.alt_geom, gs=excluded.gs, track=excluded.track,
                  squawk=excluded.squawk, category=excluded.category, rssi=excluded.rssi,
                  messages=excluded.messages,
                  military_score=max(aircraft_state.military_score, excluded.military_score),
                  military_reasons=case when excluded.military_reasons != ''
                    then excluded.military_reasons else aircraft_state.military_reasons end,
                  reg=coalesce(excluded.reg, aircraft_state.reg),
                  ac_type=coalesce(excluded.ac_type, aircraft_state.ac_type),
                  ac_desc=coalesce(excluded.ac_desc, aircraft_state.ac_desc),
                  db_flags=coalesce(excluded.db_flags, aircraft_state.db_flags),
                  traffic_class=excluded.traffic_class,
                  mlat=excluded.mlat,
                  watched=excluded.watched,
                  watch_label=excluded.watch_label,
                  samples=aircraft_state.samples + 1,
                  raw_json=excluded.raw_json""",
                (
                    hexid, seen_at, seen_at, flight, aircraft.get("lat"), aircraft.get("lon"),
                    classify.as_text(aircraft.get("alt_baro")), aircraft.get("alt_geom"),
                    aircraft.get("gs"), aircraft.get("track"),
                    classify.as_text(aircraft.get("squawk")), aircraft.get("category"),
                    aircraft.get("rssi"), aircraft.get("messages"), meta.military_score,
                    meta.military_reasons, meta.reg, meta.ac_type, meta.ac_desc, meta.db_flags,
                    meta.traffic_class, meta.mlat, watched, watch_label, raw,
                ),
            )
            inserted += 1
        con.execute("insert or replace into logger_status(key,value) values ('last_poll_at',?)", (seen_at,))
        con.execute("insert or replace into logger_status(key,value) values ('last_aircraft_count',?)", (str(len(aircraft_list)),))
        con.execute("insert or replace into logger_status(key,value) values ('last_insert_count',?)", (str(inserted),))
    finally:
        con.close()
    _evict_stale(now)
    state["last_poll_at"] = seen_at
    state["last_aircraft_count"] = len(aircraft_list)
    state["last_insert_count"] = inserted
    return inserted


async def run(stop: asyncio.Event) -> None:
    db.init_db()
    async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT) as client:
        while not stop.is_set():
            try:
                resp = await client.get(config.SOURCE_URL)
                resp.raise_for_status()
                payload = resp.json()
                aircraft = payload.get("aircraft", [])
                inserted = await asyncio.to_thread(_persist, payload.get("now"), aircraft)
                state["last_source_ok"] = now_iso()
                state["last_source_error"] = None
                print(f"poll ok aircraft={len(aircraft)} inserted={inserted}", flush=True)
                if config.ENRICH_ENABLED:
                    await enrich.enrich_special(aircraft)
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                state["last_source_error"] = str(exc)
                print(f"poll error: {exc}", flush=True)
            try:
                await asyncio.wait_for(stop.wait(), timeout=config.POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
