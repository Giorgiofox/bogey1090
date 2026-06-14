"""FastAPI app: serves the API and the built frontend; runs the poll loop."""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, enrich, poller

_stop = asyncio.Event()
_poll_task: asyncio.Task | None = None

VALID_CLASSES = {"military", "hems", "helicopter", "drone", "emergency", "airline", "ga"}
DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    global _poll_task
    _poll_task = asyncio.create_task(poller.run(_stop))
    try:
        yield
    finally:
        _stop.set()
        if _poll_task:
            await asyncio.gather(_poll_task, return_exceptions=True)


app = FastAPI(title="ADS-B Logger", lifespan=lifespan)


def _status() -> dict:
    counts = db.query_one(
        """select
             (select count(*) from sightings) total_sightings,
             (select count(*) from aircraft_state) unique_aircraft,
             (select count(*) from aircraft_state where military_score>=50) military_candidates,
             (select count(*) from aircraft_state where traffic_class='hems') hems,
             (select count(*) from aircraft_state where traffic_class='helicopter') helicopters,
             (select count(*) from aircraft_state where traffic_class!='airline') non_airline"""
    ) or {}
    return {
        "source_url": config.SOURCE_URL,
        "receiver": {"name": config.RECEIVER_NAME, "lat": config.RECEIVER_LAT, "lon": config.RECEIVER_LON},
        "enrich_enabled": config.ENRICH_ENABLED,
        **poller.state,
        **counts,
    }


@app.get("/api/status")
async def api_status():
    return _status()


@app.get("/healthz")
async def healthz():
    return {"ok": True, **_status()}


def _range_where(prefix, q, klass, mil_min, day, frm, to, mlat=0):
    """Filter over a sightings/state join for a day or [from,to] time window."""
    where, params = _filter(prefix, q, klass, mil_min, mlat)
    if day:
        where.append("substr(s.seen_at,1,10) = ?")
        params.append(day)
    if frm:
        where.append("s.seen_at >= ?")
        params.append(frm)
    if to:
        where.append("s.seen_at <= ?")
        params.append(to)
    return where, params


@app.get("/api/search")
async def api_search(
    q: str | None = None,
    klass: list[str] | None = Query(default=None, alias="class"),
    mil_min: int = 0,
    mlat: int = 0,
    day: str | None = None,
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    limit: int = 300,
):
    limit = max(1, min(limit, 2000))
    if day or frm or to:
        # Aircraft seen in the window; class/identity from authoritative aircraft_state,
        # timing/counts from that window's sightings. Filters apply to the state class.
        where, params = _range_where("st.", q, klass, mil_min, day, frm, to, mlat)
        clause = " where " + " and ".join(where)
        return db.query_rows(
            f"""select s.hex, st.flight, st.reg, st.ac_type, st.ac_desc, st.traffic_class,
                       st.military_score, st.military_reasons, st.db_flags, st.mlat,
                       max(s.lat) as lat, max(s.lon) as lon, max(s.alt_baro) as alt_baro,
                       max(s.gs) as gs, max(s.squawk) as squawk, max(s.category) as category,
                       min(s.seen_at) as first_seen_at, max(s.seen_at) as last_seen_at,
                       count(*) as samples
                from sightings s join aircraft_state st on st.hex = s.hex{clause}
                group by s.hex order by last_seen_at desc limit ?""",
            tuple(params) + (limit,),
        )
    # Default: latest state per aircraft.
    where, params = _filter("", q, klass, mil_min, mlat)
    clause = (" where " + " and ".join(where)) if where else ""
    return db.query_rows(
        f"""select hex, flight, reg, ac_type, ac_desc, traffic_class, military_score,
                  military_reasons, db_flags, mlat, lat, lon, alt_baro, gs, squawk, category,
                  first_seen_at, last_seen_at, samples
           from aircraft_state{clause}
           order by last_seen_at desc limit ?""",
        tuple(params) + (limit,),
    )


@app.get("/api/tracks")
async def api_tracks(
    q: str | None = None,
    klass: list[str] | None = Query(default=None, alias="class"),
    mil_min: int = 0,
    mlat: int = 0,
    day: str | None = None,
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    max_aircraft: int = 250,
    max_points: int = 40000,
):
    """All tracks (one polyline per aircraft) for a time window, for the map overlay."""
    max_aircraft = max(1, min(max_aircraft, 1000))
    max_points = max(1, min(max_points, 200000))
    where, params = _range_where("st.", q, klass, mil_min, day, frm, to, mlat)
    where += ["s.lat is not null", "s.lon is not null"]
    clause = " where " + " and ".join(where)
    # Step 1: pick the matching aircraft (most recent first).
    heads = db.query_rows(
        f"""select s.hex from sightings s join aircraft_state st on st.hex = s.hex{clause}
            group by s.hex order by max(s.seen_at) desc limit ?""",
        tuple(params) + (max_aircraft,),
    )
    hexes = [h["hex"] for h in heads]
    if not hexes:
        return {"tracks": []}
    # Step 2: fetch their points within the same window.
    placeholders = ",".join("?" * len(hexes))
    rows = db.query_rows(
        f"""select s.hex, st.traffic_class, s.seen_at as t, s.lat, s.lon, s.alt_baro as alt
            from sightings s join aircraft_state st on st.hex = s.hex
            {clause} and s.hex in ({placeholders})
            order by s.hex, s.seen_at asc limit ?""",
        tuple(params) + tuple(hexes) + (max_points,),
    )
    tracks: dict[str, dict] = {}
    for r in rows:
        t = tracks.setdefault(r["hex"], {"hex": r["hex"], "traffic_class": r["traffic_class"], "points": []})
        t["points"].append({"t": r["t"], "lat": r["lat"], "lon": r["lon"], "alt": r["alt"]})
    return {"tracks": list(tracks.values())}


@app.get("/api/aircraft/{hexid}")
async def api_aircraft(hexid: str):
    hexid = hexid.lower().strip()
    state = db.query_one("select * from aircraft_state where hex=?", (hexid,))
    if not state:
        return JSONResponse({"error": "unknown aircraft"}, status_code=404)
    cached, fresh = enrich.peek(hexid)
    if fresh:
        return {"state": state, "info": cached, "enriching": False}
    # Not cached yet: return immediately and enrich in the background so the click
    # is snappy. The client refetches shortly to pick up the photo/details.
    if config.ENRICH_ENABLED:
        asyncio.create_task(enrich.get_info(
            hexid, state.get("flight"), reg=state.get("reg"),
            ac_type=state.get("ac_type"), ac_desc=state.get("ac_desc"),
        ))
    info = cached or {
        "hex": hexid, "registration": state.get("reg"), "icao_type": state.get("ac_type"),
    }
    return {"state": state, "info": info, "enriching": True}


@app.get("/api/aircraft/{hexid}/track")
async def api_track(
    hexid: str,
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    limit: int = 5000,
):
    hexid = hexid.lower().strip()
    where = ["hex = ?", "lat is not null", "lon is not null"]
    params: list = [hexid]
    if frm:
        where.append("seen_at >= ?")
        params.append(frm)
    if to:
        where.append("seen_at <= ?")
        params.append(to)
    limit = max(1, min(limit, 20000))
    rows = db.query_rows(
        f"""select seen_at as t, lat, lon, alt_baro as alt, gs, track
            from sightings where {' and '.join(where)}
            order by seen_at asc limit ?""",
        tuple(params) + (limit,),
    )
    return {"hex": hexid, "points": rows}


@app.get("/api/aircraft/{hexid}/photo")
async def api_photo(hexid: str):
    info = await enrich.get_info(hexid.lower().strip())
    return {
        "photo_url": info.get("photo_url"),
        "photo_thumb": info.get("photo_thumb"),
        "photographer": info.get("photographer"),
        "photo_link": info.get("photo_link"),
    }


def _filter(prefix, q, klass, mil_min, mlat=0):
    """WHERE clause + params for aircraft columns. `prefix` qualifies the table
    (e.g. "" for aircraft_state, "st." when joined as st)."""
    where, params = [], []
    if q:
        like = f"%{q.strip().upper()}%"
        cols = ["hex", "flight", "reg", "ac_type", "ac_desc"]
        where.append("(" + " or ".join(
            f"upper(coalesce({prefix}{c},'')) like ?" for c in cols
        ) + ")")
        params += [like] * len(cols)
    if klass:
        valid = [k for k in klass if k in VALID_CLASSES]
        if valid:
            where.append(f"{prefix}traffic_class in ({','.join('?' * len(valid))})")
            params += valid
    if mil_min:
        where.append(f"{prefix}military_score >= ?")
        params.append(mil_min)
    if mlat:
        where.append(f"{prefix}mlat = 1")
    return where, params


@app.get("/api/calendar")
async def api_calendar(
    days: int = 180,
    q: str | None = None,
    klass: list[str] | None = Query(default=None, alias="class"),
    mil_min: int = 0,
    mlat: int = 0,
):
    days = max(1, min(days, 730))
    # Per-day counts with a per-class breakdown; class from authoritative aircraft_state.
    where, params = _filter("st.", q, klass, mil_min, mlat)
    clause = (" where " + " and ".join(where)) if where else ""
    return db.query_rows(
        f"""select substr(datetime(s.seen_at,'localtime'),1,10) as day,
                  count(distinct s.hex) as aircraft,
                  count(distinct case when st.military_score>=50 then s.hex end) as military,
                  count(distinct case when st.traffic_class!='airline' then s.hex end) as non_airline,
                  {_class_count_cols('st.')},
                  count(*) as sightings
           from sightings s join aircraft_state st on st.hex = s.hex{clause}
           group by day order by day desc limit ?""",
        tuple(params) + (days,),
    )


def _class_count_cols(prefix):
    return ", ".join(
        f"count(distinct case when {prefix}traffic_class='{c}' then s.hex end) as \"{c}\""
        for c in ("airline", "ga", "helicopter", "hems", "drone", "emergency", "military")
    )


@app.get("/api/breakdown")
async def api_breakdown(
    q: str | None = None,
    klass: list[str] | None = Query(default=None, alias="class"),
    mil_min: int = 0,
    mlat: int = 0,
    day: str | None = None,
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = None,
):
    """Distinct-aircraft totals per class for a window (for calendar/window summaries)."""
    where, params = _range_where("st.", q, klass, mil_min, day, frm, to, mlat)
    clause = (" where " + " and ".join(where)) if where else ""
    rows = db.query_rows(
        f"""select st.traffic_class as cls, count(distinct s.hex) as n
            from sightings s join aircraft_state st on st.hex = s.hex{clause}
            group by st.traffic_class""",
        tuple(params),
    )
    by_class = {r["cls"]: r["n"] for r in rows}
    total = db.query_one(
        f"""select count(distinct s.hex) as n
            from sightings s join aircraft_state st on st.hex = s.hex{clause}""",
        tuple(params),
    )
    return {"total": (total or {}).get("n", 0), "by_class": by_class}


# Back-compat with the v1 JSON endpoints.
@app.get("/api/recent")
async def api_recent(limit: int = 200):
    limit = max(1, min(limit, 5000))
    return db.query_rows("select * from sightings order by seen_at desc limit ?", (limit,))


@app.get("/api/military")
async def api_military(limit: int = 200):
    limit = max(1, min(limit, 5000))
    return db.query_rows(
        "select * from sightings where military_score>=50 order by seen_at desc limit ?",
        (limit,),
    )


# Serve the built SPA last so /api/* routes win.
if os.path.isdir(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="spa")
