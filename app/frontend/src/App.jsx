import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api.js";
import { NON_AIRLINE } from "./classes.js";
import { useSettings } from "./useSettings.js";
import { GearIcon, CalendarIcon, PlaneIcon, EyeIcon } from "./icons.jsx";
import { fmtLocal } from "./time.js";
import SearchPanel from "./components/SearchPanel.jsx";
import ResultsList from "./components/ResultsList.jsx";
import MapView from "./components/MapView.jsx";
import DetailDrawer from "./components/DetailDrawer.jsx";
import CalendarPanel from "./components/CalendarPanel.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import WatchlistPanel from "./components/WatchlistPanel.jsx";

function resolveClasses(classes) {
  return classes.includes("__nonline__")
    ? [...new Set([...classes.filter((c) => c !== "__nonline__"), ...NON_AIRLINE])]
    : classes;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useSettings();
  const [filters, setFilters] = useState({ q: "", classes: [], milMin: 0, from: null, to: null });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [track, setTrack] = useState(null);
  const [detail, setDetail] = useState(null);
  const [multiTracks, setMultiTracks] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const seq = useRef(0);
  const lastEventId = useRef(null);

  const rangeMode = !!(filters.from && filters.to);

  const runSearch = useCallback(async (f) => {
    const id = ++seq.current;
    setLoading(true);
    const args = {
      q: f.q, classes: resolveClasses(f.classes), milMin: f.milMin,
      mlat: f.mlat, watched: f.watched, from: f.from, to: f.to,
    };
    try {
      const rows = await api.search(args);
      if (id !== seq.current) return;
      setResults(rows);
      if (f.from && f.to) {
        const { tracks } = await api.getTracks(args);
        if (id === seq.current) setMultiTracks(tracks);
      } else {
        setMultiTracks(null);
      }
    } catch {
      if (id === seq.current) { setResults([]); setMultiTracks(null); }
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    runSearch(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.classes, filters.milMin, filters.mlat, filters.watched, filters.from, filters.to]);

  useEffect(() => {
    api.getStatus().then(setStatus).catch(() => {});
    const t = setInterval(() => api.getStatus().then(setStatus).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  // Notify when a watched aircraft passes (browser notification, if permitted).
  useEffect(() => {
    async function poll() {
      const events = await api.getWatchEvents(10).catch(() => []);
      if (!events.length) return;
      const newest = events[0].id;
      if (lastEventId.current === null) { lastEventId.current = newest; return; }
      const fresh = events.filter((e) => e.id > lastEventId.current);
      lastEventId.current = newest;
      if (fresh.length && "Notification" in window && Notification.permission === "granted") {
        for (const e of fresh.slice(0, 3)) {
          new Notification("Watched aircraft", {
            body: `${e.label || e.value} - ${e.flight || e.hex.toUpperCase()} at ${fmtLocal(e.seen_at)}`,
          });
        }
      }
    }
    poll();
    const t = setInterval(poll, 20000);
    return () => clearInterval(t);
  }, []);

  async function selectAircraft(hex) {
    setSelected(hex);
    setDetail(null);
    setTrack(null);
    try {
      const [tr, det] = await Promise.all([api.getTrack(hex), api.getAircraft(hex)]);
      setTrack(tr);
      setDetail(det);
      // Enrichment runs in the background server-side; refetch to pick up the photo.
      if (det?.enriching) {
        for (const delay of [1200, 3000]) {
          setTimeout(async () => {
            const d2 = await api.getAircraft(hex).catch(() => null);
            if (d2 && !d2.enriching) {
              setDetail((cur) => (cur?.state?.hex === hex ? d2 : cur));
            }
          }, delay);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  function pickDay(day) {
    setShowCalendar(false);
    // day is a local (Rome) calendar date; convert its local midnight..end to UTC.
    const from = new Date(`${day}T00:00:00`).toISOString().slice(0, 19) + "Z";
    const to = new Date(`${day}T23:59:59`).toISOString().slice(0, 19) + "Z";
    setFilters((f) => ({ ...f, from, to }));
  }

  const center = {
    lat: settings.centerLat ?? status?.receiver?.lat,
    lon: settings.centerLon ?? status?.receiver?.lon,
    zoom: settings.zoom,
  };

  return (
    <div className="h-full flex flex-col bg-ink-900">
      <header className="flex items-center gap-3 px-5 h-14 border-b border-ink-600 bg-ink-800">
        <span className="text-accent"><PlaneIcon width={20} height={20} /></span>
        <span className="font-semibold tracking-tight">Bogey1090</span>
        <span className="text-xs text-slate-500">ADS-B Logger</span>
        <div className="flex-1" />
        <button onClick={() => setShowWatchlist(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-ink-700 border border-ink-500 text-slate-300 hover:border-accent hover:text-accent transition">
          <EyeIcon /> Watchlist
        </button>
        <button onClick={() => setShowCalendar(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-ink-700 border border-ink-500 text-slate-300 hover:border-accent hover:text-accent transition">
          <CalendarIcon /> Calendar
        </button>
        <button onClick={() => setShowSettings(true)} title="Preferences"
          className="w-8 h-8 grid place-items-center rounded-lg bg-ink-700 border border-ink-500 text-slate-300 hover:border-accent hover:text-accent transition">
          <GearIcon />
        </button>
        <div className="hidden lg:flex items-center gap-4 text-xs text-slate-400 pl-2">
          <Stat label="Aircraft" value={status?.unique_aircraft} />
          <Stat label="Non-airline" value={status?.non_airline} />
          <Stat label="Military" value={status?.military_candidates} />
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${status?.last_source_ok && !status?.last_source_error ? "bg-emerald-400" : "bg-red-500"}`} />
            {status?.last_source_ok && !status?.last_source_error ? "live" : "stale"}
          </span>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[380px_1fr] xl:grid-cols-[420px_1fr]">
        <aside className="flex flex-col min-h-0 border-r border-ink-600 bg-ink-800">
          <SearchPanel
            filters={filters}
            onChange={setFilters}
            onSubmit={() => runSearch(filters)}
            count={results.length}
            loading={loading}
            rangeMode={rangeMode}
          />
          <ResultsList rows={results} selected={selected} onSelect={selectAircraft} loading={loading} />
        </aside>
        <main className="relative min-h-0">
          <MapView
            center={center}
            receiver={status?.receiver}
            rings={{ show: settings.showRings, unit: settings.ringUnit, distances: settings.ringDistances }}
            track={track}
            multiTracks={multiTracks}
            onSelectTrack={selectAircraft}
          />
          {rangeMode && multiTracks && (
            <div className="absolute top-3 left-3 text-xs bg-ink-800/90 border border-ink-600 rounded-lg px-3 py-1.5 text-slate-300">
              {multiTracks.length} tracks · {fmtLocal(filters.from)} → {fmtLocal(filters.to)}
            </div>
          )}
          {detail && (
            <DetailDrawer detail={detail} onClose={() => { setSelected(null); setDetail(null); setTrack(null); }} />
          )}
        </main>
      </div>

      {showCalendar && (
        <CalendarPanel filters={filters} onChange={setFilters}
          onClose={() => setShowCalendar(false)} onPickDay={pickDay} />
      )}
      {showSettings && (
        <SettingsPanel settings={settings} receiver={status?.receiver}
          onSave={setSettings} onClose={() => setShowSettings(false)} />
      )}
      {showWatchlist && (
        <WatchlistPanel
          onClose={() => setShowWatchlist(false)}
          onChanged={() => runSearch(filters)}
          onPickHex={selectAircraft}
        />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <span className="flex flex-col leading-tight text-right">
      <span className="text-slate-200 font-medium tabular-nums">{value ?? "-"}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    </span>
  );
}
