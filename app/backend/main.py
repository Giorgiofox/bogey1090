"""FastAPI app: serves the API and the built frontend; runs the poll loop."""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, enrich, poller, watch

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


# Enrichment columns also matched by free-text search (model name, manufacturer…).
AI_COLS = ["ai.type", "ai.manufacturer", "ai.icao_type", "ai.operator", "ai.owner"]


def _range_where(prefix, q, klass, mil_min, day, frm, to, mlat=0, extra_cols=(), watched=0):
    """Filter over a sightings/state join for a day or [from,to] time window."""
    where, params = _filter(prefix, q, klass, mil_min, mlat, extra_cols, watched)
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
    watched: int = 0,
    day: str | None = None,
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    limit: int = 300,
):
    limit = max(1, min(limit, 2000))
    if day or frm or to:
        # Aircraft seen in the window; class/identity from authoritative aircraft_state,
        # timing/counts from that window's sightings. Filters apply to the state class.
        where, params = _range_where("st.", q, klass, mil_min, day, frm, to, mlat, AI_COLS, watched)
        clause = " where " + " and ".join(where)
        return db.query_rows(
            f"""select s.hex, st.flight, st.reg, st.ac_type, st.ac_desc, st.traffic_class,
                       st.military_score, st.military_reasons, st.db_flags, st.mlat,
                       st.watched, st.watch_label,
                       max(s.lat) as lat, max(s.lon) as lon, max(s.alt_baro) as alt_baro,
                       max(s.gs) as gs, max(s.squawk) as squawk, max(s.category) as category,
                       min(s.seen_at) as first_seen_at, max(s.seen_at) as last_seen_at,
                       count(*) as samples
                from sightings s join aircraft_state st on st.hex = s.hex
                  left join aircraft_info ai on ai.hex = s.hex{clause}
                group by s.hex order by st.watched desc, last_seen_at desc limit ?""",
            tuple(params) + (limit,),
        )
    # Default: latest state per aircraft.
    where, params = _filter("st.", q, klass, mil_min, mlat, AI_COLS, watched)
    clause = (" where " + " and ".join(where)) if where else ""
    return db.query_rows(
        f"""select st.hex, st.flight, st.reg, st.ac_type, st.ac_desc, st.traffic_class,
                  st.military_score, st.military_reasons, st.db_flags, st.mlat,
                  st.watched, st.watch_label, st.lat, st.lon,
                  st.alt_baro, st.gs, st.squawk, st.category,
                  st.first_seen_at, st.last_seen_at, st.samples
           from aircraft_state st left join aircraft_info ai on ai.hex = st.hex{clause}
           order by st.watched desc, st.last_seen_at desc limit ?""",
        tuple(params) + (limit,),
    )


@app.get("/api/tracks")
async def api_tracks(
    q: str | None = None,
    klass: list[str] | None = Query(default=None, alias="class"),
    mil_min: int = 0,
    mlat: int = 0,
    watched: int = 0,
    day: str | None = None,
    frm: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    max_aircraft: int = 250,
    max_points: int = 40000,
):
    """All tracks (one polyline per aircraft) for a time window, for the map overlay."""
    max_aircraft = max(1, min(max_aircraft, 1000))
    max_points = max(1, min(max_points, 200000))
    where, params = _range_where("st.", q, klass, mil_min, day, frm, to, mlat, watched=watched)
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
        f"""select s.hex, st.traffic_class, st.watched, s.seen_at as t, s.lat, s.lon, s.alt_baro as alt
            from sightings s join aircraft_state st on st.hex = s.hex
            {clause} and s.hex in ({placeholders})
            order by s.hex, s.seen_at asc limit ?""",
        tuple(params) + tuple(hexes) + (max_points,),
    )
    tracks: dict[str, dict] = {}
    for r in rows:
        t = tracks.setdefault(r["hex"], {
            "hex": r["hex"], "traffic_class": r["traffic_class"],
            "watched": r["watched"], "points": [],
        })
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


def _filter(prefix, q, klass, mil_min, mlat=0, extra_cols=(), watched=0):
    """WHERE clause + params for aircraft columns. `prefix` qualifies the table
    (e.g. "" for aircraft_state, "st." when joined as st). `extra_cols` are extra
    fully-qualified columns also matched by the free-text query (e.g. enrichment)."""
    where, params = [], []
    if q:
        like = f"%{q.strip().upper()}%"
        cols = [f"{prefix}{c}" for c in ("hex", "flight", "reg", "ac_type", "ac_desc")]
        cols += list(extra_cols)
        where.append("(" + " or ".join(
            f"upper(coalesce({c},'')) like ?" for c in cols
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
    if watched:
        where.append(f"{prefix}watched = 1")
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


def _recompute_watched():
    """Re-match every known aircraft against the current watchlist (after edits),
    so the UI reflects changes immediately without waiting for the next pass."""
    con = db.connect()
    try:
        wl = watch.load(con)
        rows = con.execute(
            """select st.hex, st.reg, st.flight, st.ac_type,
                      coalesce(ai.operator, ai.owner) as operator
               from aircraft_state st left join aircraft_info ai on ai.hex = st.hex"""
        ).fetchall()
        for r in rows:
            entry = watch.match(wl, r["hex"], r["reg"], r["flight"], r["ac_type"], r["operator"])
            con.execute(
                "update aircraft_state set watched=?, watch_label=? where hex=?",
                (1 if entry else 0, (entry.get("label") or entry.get("value")) if entry else None, r["hex"]),
            )
    finally:
        con.close()


@app.get("/api/watchlist")
async def watchlist_list():
    return db.query_rows("select id, kind, value, label, enabled, created_at from watchlist order by id")


@app.post("/api/watchlist")
async def watchlist_add(item: dict = Body(...)):
    kind = (item.get("kind") or "").strip().lower()
    value = (item.get("value") or "").strip()
    if kind not in watch.KINDS or not value:
        return JSONResponse({"error": f"kind must be one of {sorted(watch.KINDS)} and value non-empty"}, status_code=400)
    con = db.connect()
    try:
        con.execute(
            "insert into watchlist (kind, value, label, enabled, created_at) values (?,?,?,1,?)",
            (kind, value, (item.get("label") or "").strip() or None, poller.now_iso()),
        )
    finally:
        con.close()
    _recompute_watched()
    return {"ok": True}


@app.patch("/api/watchlist/{wid}")
async def watchlist_toggle(wid: int, item: dict = Body(...)):
    con = db.connect()
    try:
        con.execute("update watchlist set enabled=? where id=?", (1 if item.get("enabled") else 0, wid))
    finally:
        con.close()
    _recompute_watched()
    return {"ok": True}


@app.delete("/api/watchlist/{wid}")
async def watchlist_delete(wid: int):
    con = db.connect()
    try:
        con.execute("delete from watchlist where id=?", (wid,))
    finally:
        con.close()
    _recompute_watched()
    return {"ok": True}


@app.get("/api/watch-events")
async def watch_events(limit: int = 100):
    limit = max(1, min(limit, 1000))
    return db.query_rows(
        "select id, hex, label, kind, value, seen_at, flight, lat, lon "
        "from watch_events order by seen_at desc limit ?",
        (limit,),
    )


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
