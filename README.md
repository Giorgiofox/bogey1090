# Bogey1090

**ADS-B tracker & history logger for non-airline traffic.**

Bogey1090 watches a local ADS-B feed and records the aircraft that don't belong to the
scheduled-airline crowd — **military, air ambulances (HEMS), helicopters, drones/UAV,
emergencies and general aviation** — then lets you search the history, replay each
aircraft's flight path on a map, browse a daily/monthly traffic calendar, and enrich every
aircraft with registration, type, operator, route and photos.

> *"Bogey"* — aviation slang for an unidentified aircraft. *1090* — the ADS-B frequency
> (1090 MHz).

It sits next to [`tar1090`](https://github.com/sdr-enthusiasts/docker-tar1090): tar1090
decodes the receiver and serves the live map; Bogey1090 reads its `aircraft.json`, persists
a sampled history into SQLite and serves its own search/analysis UI.

---

## Table of contents

- [Features](#features)
- [Screenshots / UI overview](#ui-overview)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Traffic classification](#traffic-classification)
- [Aircraft enrichment](#aircraft-enrichment)
- [Time & timezone](#time--timezone)
- [HTTP API](#http-api)
- [Data model](#data-model)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Credits & licence](#credits--licence)

---

## Features

- **Continuous logging** of an ADS-B feed (`tar1090`/`readsb` `aircraft.json`) into SQLite,
  with change-based sampling to keep the database compact.
- **Traffic classification** at ingest using the local readsb aircraft DB
  (`dbFlags`, `r`, `t`, `desc`) plus heuristics — no external calls needed for the base
  class. Classes: `military`, `hems`, `helicopter`, `drone`, `emergency`, `airline`, `ga`.
  *Non-airline* = everything except `airline`.
- **Search** the history by hex / callsign / registration / type / description, with class
  chips, an `MLAT` filter, a military-score threshold and a "clear all" reset.
- **Map** (dark MapLibre): click any aircraft to draw its flight path coloured by altitude,
  with start/end markers, receiver marker and configurable concentric range rings.
- **Time window**: pick a range (presets *Last 6h / 24h / Today / Yesterday* or a manual
  from→to) to plot **all aircraft and all their tracks at once**, filtered live by the class
  chips. Click any track on the map to open that flight's details.
- **Daily traffic calendar**: navigate any month, see per-day aircraft counts with a
  per-class breakdown and a monthly summary (distinct aircraft per class). Respects the
  active filters; click a day to load it.
- **Aircraft enrichment**: registration, type, manufacturer, operator, country, route and
  photo, pulled from [adsbdb](https://www.adsbdb.com/), [hexdb.io](https://hexdb.io/),
  [planespotters.net](https://www.planespotters.net/) and
  [airport-data.com](https://airport-data.com/) — cached in SQLite, fetched once per
  aircraft, fully graceful when offline. Detail view also links out to Planespotters,
  JetPhotos, Flightradar24, ADSBexchange and FlightAware.
- **Preferences** (gear icon, stored in the browser): map centre, default zoom, range-ring
  distances and unit (km/mi), max tracks on the map.

## UI overview

- **Header** — live counters (aircraft, non-airline, military), `Calendar` and preferences
  (gear) buttons, feed status indicator.
- **Left panel** — search box, class chips, `MLAT`, time-window controls, military-score
  slider, and the results list (one row per aircraft, with class tag and last-seen time).
- **Map** — receiver marker, range rings, selected track (altitude-coloured) or all tracks
  in the active time window; click a track for details.
- **Detail drawer** — photo (click for full resolution), identity, live flight values,
  position & signal, military signals, sighting timeline, and external reference links.

## Architecture

```
                Beast (30005)            HTTP aircraft.json            Web UI :8095
 RTL-SDR Pi  ───────────────▶  tar1090  ───────────────────▶  bogey1090  ───────────▶  browser
 (remote)                      (:8090)                         (FastAPI + React SPA)
```

- **tar1090** (`ghcr.io/sdr-enthusiasts/docker-tar1090`) decodes the remote receiver's Beast
  stream and serves the live map + graphs1090 — used as-is, untouched.
- **bogey1090** (`app/`) — a FastAPI backend (poller + enrichment + REST API) that also
  serves a React/Vite/Tailwind/MapLibre single-page app, all in one container.

```
app/
  backend/
    config.py     env-driven configuration
    db.py         SQLite connection, schema, idempotent migrations, one-shot backfill
    classify.py   military scoring + traffic-class + HEMS/drone/heli detection
    poller.py     async loop: fetch aircraft.json, sample, persist
    enrich.py     async enrichment (adsbdb -> hexdb -> planespotters -> airport-data) + cache
    main.py       FastAPI app, REST API, static SPA mount, background enrichment
  frontend/
    src/          React app (App, SearchPanel, ResultsList, MapView, DetailDrawer,
                  CalendarPanel, SettingsPanel) + api/time/classes helpers
  Dockerfile      multi-stage: node build frontend -> python runtime
  healthcheck.py  checks the web server is up and a recent poll succeeded
compose.yaml      tar1090 + bogey1090 services
```

## Quick start

Requirements: Docker + Docker Compose, and a reachable ADS-B receiver (a Raspberry Pi
running readsb/tar1090 feeding Beast output).

```bash
git clone https://github.com/Giorgiofox/bogey1090.git
cd bogey1090
cp .env.example .env          # edit with your receiver host + coordinates
docker compose up -d --build
```

URLs (replace `<host>` with the Docker host's address):

| Service | URL |
| --- | --- |
| Bogey1090 UI | `http://<host>:8095` |
| tar1090 live map | `http://<host>:8090` |
| graphs1090 | `http://<host>:8090/graphs1090` |

## Configuration

All configuration is via environment variables (see `.env.example`). The real `.env` is
gitignored because it contains your receiver's IP and coordinates.

### Core

| Variable | Default | Meaning |
| --- | --- | --- |
| `TZ` | `Europe/Rome` | Container timezone (used for local-day grouping in the calendar) |
| `RECEIVER_NAME` | `ADS-B` | Receiver label shown on the map marker |
| `RECEIVER_LAT` / `RECEIVER_LON` | – | Receiver position (default map centre + marker) |
| `RASPBERRY_BEAST_HOST` / `RASPBERRY_BEAST_PORT` | – | Remote receiver Beast output (consumed by tar1090) |
| `ADSB_SOURCE_URL` | `http://tar1090/data/aircraft.json` | Feed polled by the logger |
| `POLL_SECONDS` | `5` | Poll interval |
| `SAMPLE_MIN_SECONDS` | `60` | Minimum sampling interval per aircraft when position is unchanged |
| `REQUEST_TIMEOUT` | `4` | Feed request timeout (s) |
| `DB_PATH` | `/data/adsb.sqlite` | SQLite database path (volume-mounted) |
| `WEB_BIND` / `WEB_PORT` | `0.0.0.0` / `8080` | Web server bind (container port; published as 8095) |

### Enrichment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENRICH_ENABLED` | `true` | Enable external info/photo lookups |
| `USER_AGENT` | `Bogey1090/2.0 (+repo URL)` | Descriptive UA — **required by planespotters** (generic UAs get HTTP 403) |
| `ENRICH_TIMEOUT` | `6` | Per-request enrichment timeout (s) |
| `ENRICH_TTL_DAYS` | `30` | Cache lifetime for found aircraft |
| `ENRICH_NOT_FOUND_TTL_DAYS` | `7` | Cache lifetime for not-found lookups (retried sooner) |
| `ADSBDB_BASE` / `HEXDB_BASE` / `PLANESPOTTERS_BASE` / `AIRPORTDATA_BASE` | upstream URLs | Override enrichment endpoints |

### Classification tuning

| Variable | Meaning |
| --- | --- |
| `MILITARY_CALLSIGN_PREFIXES` | Callsign prefixes scored as military |
| `HEMS_MARKERS` | Operator/callsign markers identifying air ambulances |
| `HELI_TYPES` | ICAO type codes treated as rotorcraft |
| `UAS_TYPES` | ICAO type codes treated as drones/UAV |

## Traffic classification

Each aircraft is classified at ingest. The ICAO type code (`t`) and the readsb DB military
flag (`dbFlags & 0x1`) are authoritative; the noisy ADS-B emitter category is only trusted
when the type is unknown. Priority order:

1. **military** — military DB flag, or a military score ≥ 50 (callsign prefix, emergency
   squawk, ICAO range, category).
2. **emergency** — squawk 7500 / 7600 / 7700.
3. **drone** — known UAS type code, or emitter category B6 when the type is unknown.
4. **hems** — rotorcraft whose operator/callsign matches an air-ambulance marker.
5. **helicopter** — any other rotorcraft.
6. **airline** — airline-style callsign (3 letters + digits), or large/heavy fixed-wing
   (category A3/A4/A5).
7. **ga** — everything else (general aviation, the catch-all non-airline class).

> Single-receiver setups only ever see ADS-B positions, so the `MLAT` flag will normally be
> zero unless you feed an MLAT network back into tar1090.

## Aircraft enrichment

Looked up once per aircraft and cached in SQLite; the chain stops at the first hit and is
graceful when offline (the UI still works from the local `r`/`t`/`desc` fields).

- **adsbdb** — type, manufacturer, owner, country, and route/airline by callsign.
- **hexdb.io** — registration/type/owner/operator fallback.
- **Photos** are looked up **by registration first, then hex** (the mode-S hex can be
  reassigned and external DBs can be stale):
  - **planespotters.net** — ~497px image + photographer (attribution shown).
  - **airport-data.com** — full-resolution image derived from the thumbnail id.

Enrichment runs in the background on detail open, so clicks are instant and the photo
appears a moment later.

## Time & timezone

Timestamps are stored in **UTC**. The UI renders them in the browser's local timezone, and
the calendar groups days by **local** date (via SQLite `localtime`, DST-aware) so a passage
just after local midnight lands on the right day.

## HTTP API

| Endpoint | Description |
| --- | --- |
| `GET /api/status` | Counts, receiver, feed freshness |
| `GET /api/search` | Search aircraft. Params: `q`, `class` (repeatable), `mil_min`, `mlat`, `day`, `from`, `to`, `limit` |
| `GET /api/tracks` | All tracks in a window (for the map overlay). Same filter params + `max_aircraft`, `max_points` |
| `GET /api/aircraft/{hex}` | Aircraft state + enrichment (`enriching: true` while the background lookup runs) |
| `GET /api/aircraft/{hex}/track` | Ordered track points (`from`/`to` optional) |
| `GET /api/aircraft/{hex}/photo` | Cached photo + attribution |
| `GET /api/calendar` | Per-day counts with per-class breakdown. Params: `days`, filters |
| `GET /api/breakdown` | Distinct-aircraft totals per class for a window |
| `GET /api/recent`, `GET /api/military` | Recent / military sightings (v1 compatibility) |
| `GET /healthz` | Health + status |

Filter params are shared: `q` (free text over hex/flight/reg/type/desc), `class` (one of the
seven traffic classes, repeatable), `mil_min` (0–100), `mlat` (`1` for MLAT-only), and a
time window via `day=YYYY-MM-DD` or `from`/`to` (ISO 8601, UTC).

## Data model

SQLite at `./data/adsb.sqlite` (WAL mode). Schema migrations run automatically at startup
and are additive (no data loss when upgrading from v1).

| Table | Purpose |
| --- | --- |
| `sightings` | Append-only sampled history (one row per sample) |
| `aircraft_state` | Latest authoritative state per aircraft (one row per hex) |
| `aircraft_info` | Enrichment cache (registration, type, operator, photo, route…) |
| `logger_status` | Poller status key/values |

## Development

```bash
# Backend (FastAPI + uvicorn)
pip install -r app/requirements.txt
DB_PATH=./data/adsb.sqlite uvicorn backend.main:app --reload --app-dir app

# Frontend (Vite dev server, proxies /api to :8080)
cd app/frontend && npm install && npm run dev
```

The production image is built multi-stage (`app/Dockerfile`): Node builds the frontend to
`dist/`, then the Python stage serves the API and the static SPA from one container.

## Troubleshooting

- **No photos / low resolution** — make sure `USER_AGENT` is descriptive (planespotters
  returns HTTP 403 for generic User-Agents). Brand-new airframes and small private GA may
  simply have no photo in the free databases; use the external links in the detail view.
- **`MLAT` always zero** — expected for a single receiver; MLAT requires a receiver network.
- **Calendar only shows recent months** — history starts when the logger first ran; older
  months are empty until data accumulates.
- **Health unhealthy** — check `docker compose logs bogey-? ` for `poll error`; verify
  `ADSB_SOURCE_URL` and that tar1090 is reachable.

## Credits & licence

Aircraft data from adsbdb, hexdb.io and the readsb/tar1090 aircraft database. Photos from
planespotters.net (shown with photographer attribution) and airport-data.com. Map tiles ©
OpenStreetMap contributors © CARTO. Built on
[docker-tar1090](https://github.com/sdr-enthusiasts/docker-tar1090).

Licensed under the MIT Licence — see [LICENSE](LICENSE).
