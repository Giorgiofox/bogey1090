import { useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { NON_AIRLINE, classMeta, FILTER_CHIPS } from "../classes.js";
import { CloseIcon, ChevronLeft, ChevronRight } from "../icons.jsx";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SUMMARY = ["airline", "ga", "helicopter", "hems", "drone", "emergency", "military"];

function resolveClasses(classes) {
  return classes.includes("__nonline__")
    ? [...new Set([...classes.filter((c) => c !== "__nonline__"), ...NON_AIRLINE])]
    : classes;
}
function dow(dayStr) {
  const [y, m, d] = dayStr.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
function curYM() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shiftYM(ym, delta) {
  let [y, m] = ym.split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function CalendarPanel({ filters, onChange, onClose, onPickDay }) {
  function toggleClass(key) {
    const set = new Set(filters.classes);
    set.has(key) ? set.delete(key) : set.add(key);
    onChange({ ...filters, classes: [...set] });
  }
  const anyFilter = filters.q || filters.classes.length || filters.milMin || filters.mlat;
  const [ym, setYm] = useState(curYM());
  const [byDay, setByDay] = useState({});
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const classes = resolveClasses(filters.classes);
  const args = { q: filters.q, classes, milMin: filters.milMin };
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${ym}-01T00:00:00Z`;
  const to = `${ym}-${String(lastDay).padStart(2, "0")}T23:59:59Z`;

  useEffect(() => {
    setError(null);
    api.getCalendar({ ...args, days: 400 })
      .then((rows) => setByDay(Object.fromEntries(rows.map((r) => [r.day, r]))))
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, JSON.stringify(classes), filters.milMin]);

  useEffect(() => {
    setSummary(null);
    api.getBreakdown({ ...args, from, to }).then(setSummary).catch(() => setSummary(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym, filters.q, JSON.stringify(classes), filters.milMin]);

  const max = useMemo(() => Math.max(1, ...Object.values(byDay).map((r) => r.aircraft)), [byDay]);

  const cells = [];
  const offset = dow(`${ym}-01`);
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-6" onClick={onClose}>
      <div className="bg-ink-800 border border-ink-600 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600">
          <div className="flex items-center gap-3">
            <button onClick={() => setYm(shiftYM(ym, -1))} className="w-8 h-8 grid place-items-center rounded-lg bg-ink-700 hover:bg-ink-600"><ChevronLeft /></button>
            <div className="font-semibold w-40 text-center">{MONTHS[m - 1]} {y}</div>
            <button onClick={() => setYm(shiftYM(ym, 1))} className="w-8 h-8 grid place-items-center rounded-lg bg-ink-700 hover:bg-ink-600"><ChevronRight /></button>
            {ym !== curYM() && <button onClick={() => setYm(curYM())} className="text-xs text-accent hover:underline">today</button>}
          </div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full bg-ink-700 hover:bg-ink-600"><CloseIcon /></button>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-3 border-b border-ink-600 flex flex-wrap items-center gap-1.5">
          <Chip active={filters.classes.includes("__nonline__")} onClick={() => toggleClass("__nonline__")}>Non-airline</Chip>
          {FILTER_CHIPS.map((c) => (
            <Chip key={c.key} active={filters.classes.includes(c.key)} onClick={() => toggleClass(c.key)}>{c.label}</Chip>
          ))}
          <Chip active={!!filters.mlat} onClick={() => onChange({ ...filters, mlat: filters.mlat ? 0 : 1 })}>MLAT</Chip>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 ml-2">
            mil ≥ <span className="tabular-nums text-slate-200 w-6">{filters.milMin}</span>
            <input type="range" min="0" max="100" step="10" value={filters.milMin}
              onChange={(e) => onChange({ ...filters, milMin: Number(e.target.value) })}
              className="w-24 accent-accent" />
          </label>
          {anyFilter && (
            <button onClick={() => onChange({ ...filters, q: "", classes: [], milMin: 0, mlat: 0 })}
              className="ml-auto text-xs px-2.5 py-1 rounded-full bg-ink-700 border border-ink-500 text-slate-300 hover:border-accent hover:text-accent">
              Clear · show all
            </button>
          )}
        </div>

        {/* Month summary by class */}
        <div className="px-5 py-3 border-b border-ink-600">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
            This month · distinct aircraft{filters.q || classes.length || filters.milMin ? " (filtered)" : ""}
          </div>
          <div className="flex flex-wrap gap-2">
            <Tile label="Total" value={summary?.total} color="#5cc8ff" />
            {SUMMARY.map((c) => (
              <Tile key={c} label={classMeta(c).label} value={summary?.by_class?.[c] || 0} color={classMeta(c).color} />
            ))}
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          {error && <div className="text-sm text-red-400">{error}</div>}
          <div className="grid grid-cols-7 gap-1.5 text-[10px] text-slate-600 mb-1">
            {WEEKDAYS.map((w) => <div key={w} className="text-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />;
              const r = byDay[day];
              const dn = Number(day.slice(8));
              const intensity = r ? 0.15 + 0.55 * (r.aircraft / max) : 0;
              return (
                <button key={day} disabled={!r} onClick={() => r && onPickDay(day)}
                  title={r ? `${day}\n${r.aircraft} aircraft · ${r.sightings} sightings\nairline ${r.airline} · GA ${r.ga} · heli ${r.helicopter} · HEMS ${r.hems} · drone ${r.drone} · emg ${r.emergency} · mil ${r.military}` : day}
                  className={`h-20 rounded-lg border p-1.5 flex flex-col justify-between text-left transition
                    ${r ? "border-ink-500 hover:border-accent cursor-pointer" : "border-ink-700/40 cursor-default"}`}
                  style={r ? { background: `rgba(92,200,255,${intensity})` } : {}}>
                  <span className="text-[10px] text-slate-400 leading-none">{dn}</span>
                  {r && (
                    <span className="leading-tight">
                      <span className="block text-lg font-semibold tabular-nums text-white">{r.aircraft}</span>
                      <span className="block text-[10px] text-slate-300 leading-none">
                        {r.helicopter + r.hems > 0 && <span>H{r.helicopter + r.hems} </span>}
                        {r.ga > 0 && <span className="text-emerald-300">GA{r.ga} </span>}
                        {r.military > 0 && <span className="text-red-300">M{r.military}</span>}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {Object.keys(byDay).filter((d) => d.startsWith(ym)).length === 0 && (
            <div className="text-sm text-slate-500 mt-4 text-center">No traffic recorded this month.</div>
          )}
        </div>
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

function Tile({ label, value, color }) {
  return (
    <div className="px-3 py-1.5 rounded-lg bg-ink-700 border border-ink-600 min-w-[84px]">
      <div className="text-lg font-semibold tabular-nums" style={{ color }}>{value ?? "-"}</div>
      <div className="text-[10px] text-slate-500 leading-tight">{label}</div>
    </div>
  );
}
