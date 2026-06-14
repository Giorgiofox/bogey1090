"""SQLite access: connection, schema, idempotent migrations, one-shot backfill."""
import json
import os
import sqlite3

from . import classify, config

# Columns added on top of the original v1 schema.
_MIGRATION_COLUMNS = {
    "sightings": [
        ("reg", "text"),
        ("ac_type", "text"),
        ("ac_desc", "text"),
        ("db_flags", "integer"),
        ("traffic_class", "text"),
        ("mlat", "integer"),
        ("watched", "integer"),
        ("watch_label", "text"),
    ],
    "aircraft_state": [
        ("reg", "text"),
        ("ac_type", "text"),
        ("ac_desc", "text"),
        ("db_flags", "integer"),
        ("traffic_class", "text"),
        ("mlat", "integer"),
        ("watched", "integer"),
        ("watch_label", "text"),
    ],
}


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    con = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None)
    con.execute("pragma journal_mode=WAL")
    con.execute("pragma synchronous=NORMAL")
    con.execute("pragma busy_timeout=5000")
    con.row_factory = sqlite3.Row
    return con


def _create_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        create table if not exists sightings (
          id integer primary key autoincrement,
          seen_at text not null,
          source_now real,
          hex text not null,
          flight text,
          lat real,
          lon real,
          alt_baro text,
          alt_geom integer,
          gs real,
          track real,
          squawk text,
          category text,
          rssi real,
          messages integer,
          seen real,
          seen_pos real,
          military_score integer not null default 0,
          military_reasons text,
          reg text,
          ac_type text,
          ac_desc text,
          db_flags integer,
          traffic_class text,
          mlat integer,
          raw_json text not null
        );
        create index if not exists idx_sightings_seen_at on sightings(seen_at);
        create index if not exists idx_sightings_hex_seen_at on sightings(hex, seen_at);
        create index if not exists idx_sightings_flight on sightings(flight);
        create index if not exists idx_sightings_military on sightings(military_score, seen_at);

        create table if not exists aircraft_state (
          hex text primary key,
          first_seen_at text not null,
          last_seen_at text not null,
          flight text,
          lat real,
          lon real,
          alt_baro text,
          alt_geom integer,
          gs real,
          track real,
          squawk text,
          category text,
          rssi real,
          messages integer,
          military_score integer not null default 0,
          military_reasons text,
          reg text,
          ac_type text,
          ac_desc text,
          db_flags integer,
          traffic_class text,
          mlat integer,
          samples integer not null default 0,
          raw_json text not null
        );
        create index if not exists idx_state_military on aircraft_state(military_score, last_seen_at);

        create table if not exists aircraft_info (
          hex text primary key,
          registration text,
          type text,
          icao_type text,
          manufacturer text,
          operator text,
          owner text,
          country text,
          photo_url text,
          photo_thumb text,
          photographer text,
          photo_link text,
          route_origin text,
          route_dest text,
          airline text,
          source text,
          fetched_at text,
          not_found integer not null default 0
        );

        create table if not exists watchlist (
          id integer primary key autoincrement,
          kind text not null,
          value text not null,
          label text,
          enabled integer not null default 1,
          created_at text
        );

        create table if not exists watch_events (
          id integer primary key autoincrement,
          hex text not null,
          watch_id integer,
          label text,
          kind text,
          value text,
          seen_at text not null,
          flight text,
          lat real,
          lon real
        );
        create index if not exists idx_watch_events_seen on watch_events(seen_at);
        create index if not exists idx_watch_events_hex on watch_events(hex, seen_at);

        create table if not exists logger_status (
          key text primary key,
          value text not null
        );
        """
    )


def _migrate_columns(con: sqlite3.Connection) -> None:
    for table, columns in _MIGRATION_COLUMNS.items():
        existing = {row["name"] for row in con.execute(f"pragma table_info({table})")}
        for name, decl in columns:
            if name not in existing:
                con.execute(f"alter table {table} add column {name} {decl}")
    # Indexes on migrated columns, created after the columns exist.
    con.execute("create index if not exists idx_sightings_class on sightings(traffic_class, seen_at)")
    con.execute("create index if not exists idx_state_class on aircraft_state(traffic_class, last_seen_at)")


def _backfill(con: sqlite3.Connection) -> None:
    """Recompute class/reg/type from stored raw_json for legacy rows. Runs once."""
    done = con.execute(
        "select value from logger_status where key='backfill_v2_done'"
    ).fetchone()
    if done:
        return
    for table, key in (("sightings", "id"), ("aircraft_state", "hex")):
        rows = con.execute(
            f"select {key} as pk, raw_json from {table} where traffic_class is null"
        ).fetchall()
        for row in rows:
            try:
                aircraft = json.loads(row["raw_json"])
            except (ValueError, TypeError):
                continue
            meta = classify.classify(aircraft)
            con.execute(
                f"""update {table} set reg=?, ac_type=?, ac_desc=?, db_flags=?,
                       traffic_class=?, mlat=? where {key}=?""",
                (meta.reg, meta.ac_type, meta.ac_desc, meta.db_flags,
                 meta.traffic_class, meta.mlat, row["pk"]),
            )
    con.execute(
        "insert or replace into logger_status(key, value) values ('backfill_v2_done', '1')"
    )


def init_db() -> None:
    con = connect()
    try:
        _create_schema(con)
        _migrate_columns(con)
        _backfill(con)
    finally:
        con.close()


def query_rows(sql: str, params: tuple = ()) -> list[dict]:
    con = connect()
    try:
        return [dict(row) for row in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def query_one(sql: str, params: tuple = ()) -> dict | None:
    con = connect()
    try:
        row = con.execute(sql, params).fetchone()
        return dict(row) if row else None
    finally:
        con.close()
