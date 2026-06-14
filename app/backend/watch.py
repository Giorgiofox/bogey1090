"""Watchlist: user-defined special aircraft, matched at ingest.

Entries match on one field each: hex, reg, callsign, type or operator. `*` acts as a
wildcard (fnmatch); without it, hex/reg/type match exactly, callsign matches as a prefix,
operator matches as a substring.
"""
import fnmatch

KINDS = {"hex", "reg", "callsign", "type", "operator"}
EVENT_GAP_SECONDS = 1800  # don't log the same watched aircraft more than once per pass


def load(con) -> list[dict]:
    return [dict(r) for r in con.execute(
        "select id, kind, value, label, enabled from watchlist where enabled=1"
    )]


def _match_one(entry: dict, fields: dict) -> bool:
    kind = entry["kind"]
    value = (entry.get("value") or "").strip().upper()
    field = fields.get(kind)
    if not value or not field:
        return False
    field = str(field).upper()
    if "*" in value:
        return fnmatch.fnmatchcase(field, value)
    if kind == "callsign":
        return field.startswith(value)
    if kind == "operator":
        return value in field
    return field == value  # hex, reg, type: exact


def match(watchlist: list[dict], hexid, reg, flight, ac_type, operator) -> dict | None:
    """Return the first matching watchlist entry, or None."""
    fields = {"hex": hexid, "reg": reg, "callsign": flight, "type": ac_type, "operator": operator}
    for entry in watchlist:
        if _match_one(entry, fields):
            return entry
    return None


def has_operator_entries(watchlist: list[dict]) -> bool:
    return any(e["kind"] == "operator" for e in watchlist)


def maybe_log_event(con, entry: dict, hexid, seen_at, flight, lat, lon) -> None:
    """Record a watch event once per pass (dedupe within EVENT_GAP_SECONDS)."""
    last = con.execute(
        "select seen_at from watch_events where hex=? order by seen_at desc limit 1", (hexid,)
    ).fetchone()
    if last:
        # ISO strings compare lexicographically; cheap recency guard via Python.
        import datetime as dt
        try:
            prev = dt.datetime.fromisoformat(last["seen_at"].replace("Z", "+00:00"))
            now = dt.datetime.fromisoformat(seen_at.replace("Z", "+00:00"))
            if (now - prev).total_seconds() < EVENT_GAP_SECONDS:
                return
        except ValueError:
            pass
    con.execute(
        """insert into watch_events (hex, watch_id, label, kind, value, seen_at, flight, lat, lon)
           values (?,?,?,?,?,?,?,?,?)""",
        (hexid, entry.get("id"), entry.get("label") or entry.get("value"),
         entry.get("kind"), entry.get("value"), seen_at, flight, lat, lon),
    )
