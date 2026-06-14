import { FILTER_CHIPS } from "../classes.js";
import { CloseIcon } from "../icons.jsx";

// datetime-local (local wall time) -> UTC ISO with Z, and back.
function toIsoZ(local) {
  if (!local) return null;
  return new Date(local).toISOString().slice(0, 19) + "Z";
}
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
}

function presetRange(kind) {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  if (kind === "6h") start.setHours(start.getHours() - 6);
  if (kind === "24h") start.setHours(start.getHours() - 24);
  if (kind === "today") start.setHours(0, 0, 0, 0);
  if (kind === "yesterday") {
    start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
  }
  return { from: start.toISOString().slice(0, 19) + "Z", to: end.toISOString().slice(0, 19) + "Z" };
}

export default function SearchPanel({ filters, onChange, onSubmit, count, loading, rangeMode }) {
  function toggleClass(key) {
    const set = new Set(filters.classes);
    set.has(key) ? set.delete(key) : set.add(key);
    onChange({ ...filters, classes: [...set] });
  }
  function setRange(r) { onChange({ ...filters, from: r.from, to: r.to }); }
  const nonlineActive = filters.classes.includes("__nonline__");
  const anyFilter = filters.q || filters.classes.length || filters.milMin || filters.from || filters.to || filters.mlat || filters.watched;

  return (
    <div className="p-4 border-b border-ink-600 space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex gap-2">
        <input
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Search hex, callsign, reg, type…"
          className="flex-1 bg-ink-700 border border-ink-500 rounded-lg px-3 py-2 text-sm
                     placeholder:text-slate-500 focus:outline-none focus:border-accent"
        />
        <button type="submit"
          className="px-3 py-2 rounded-lg bg-accent/15 text-accent border border-accent/40 text-sm hover:bg-accent/25 transition">
          {loading ? "…" : "Search"}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={nonlineActive} onClick={() => toggleClass("__nonline__")}>Non-airline</Chip>
        {FILTER_CHIPS.map((c) => (
          <Chip key={c.key} active={filters.classes.includes(c.key)} onClick={() => toggleClass(c.key)}>{c.label}</Chip>
        ))}
        <Chip active={!!filters.mlat} onClick={() => onChange({ ...filters, mlat: filters.mlat ? 0 : 1 })}>MLAT</Chip>
        <Chip active={!!filters.watched} onClick={() => onChange({ ...filters, watched: filters.watched ? 0 : 1 })}>Watched</Chip>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-accent/70">Time window</span>
          {rangeMode && (
            <button onClick={() => onChange({ ...filters, from: null, to: null })}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-accent">
              clear <CloseIcon width={11} height={11} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[["6h", "Last 6h"], ["24h", "Last 24h"], ["today", "Today"], ["yesterday", "Yesterday"]].map(([k, l]) => (
            <Chip key={k} onClick={() => setRange(presetRange(k))}>{l}</Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="datetime-local" value={toLocalInput(filters.from)}
            onChange={(e) => onChange({ ...filters, from: toIsoZ(e.target.value) })}
            className="bg-ink-700 border border-ink-500 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent" />
          <input type="datetime-local" value={toLocalInput(filters.to)}
            onChange={(e) => onChange({ ...filters, to: toIsoZ(e.target.value) })}
            className="bg-ink-700 border border-ink-500 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-accent" />
        </div>
        {rangeMode && (
          <p className="text-[10px] text-slate-500">
            Showing all aircraft and tracks in this window. Class chips filter the tracks on the map.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-400 flex-1">
          Mil ≥ <span className="tabular-nums text-slate-200 w-6">{filters.milMin}</span>
          <input type="range" min="0" max="100" step="10" value={filters.milMin}
            onChange={(e) => onChange({ ...filters, milMin: Number(e.target.value) })}
            className="flex-1 accent-accent" />
        </label>
      </div>
      <p className="text-[10px] text-slate-600 leading-snug">
        Military score: 0 = all; higher = only stronger military signals (DB flag, callsign,
        emergency squawk, ICAO range). 50+ = military candidate.
      </p>

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{count} aircraft{rangeMode ? " in window" : ""}</span>
        <button
          onClick={() => onChange({ q: "", classes: [], milMin: 0, from: null, to: null, mlat: 0, watched: 0 })}
          disabled={!anyFilter}
          className={`px-2.5 py-1 rounded-full border transition ${
            anyFilter ? "bg-ink-700 border-ink-500 text-slate-300 hover:border-accent hover:text-accent"
                      : "border-transparent text-slate-700 cursor-default"}`}>
          Clear all · show everything
        </button>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border transition ${
        active ? "bg-accent/20 border-accent/60 text-accent"
               : "bg-ink-700 border-ink-500 text-slate-400 hover:border-slate-400"}`}>
      {children}
    </button>
  );
}
