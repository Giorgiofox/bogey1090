import { useEffect, useState } from "react";
import * as api from "../api.js";
import { CloseIcon } from "../icons.jsx";
import { fmtLocal } from "../time.js";

const KINDS = [
  ["reg", "Registration"],
  ["hex", "Hex (ICAO)"],
  ["callsign", "Callsign / prefix"],
  ["type", "Type code"],
  ["operator", "Operator"],
];

export default function WatchlistPanel({ onClose, onChanged, onPickHex }) {
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [kind, setKind] = useState("reg");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState(null);

  async function refresh() {
    setItems(await api.getWatchlist().catch(() => []));
    setEvents(await api.getWatchEvents(50).catch(() => []));
  }
  useEffect(() => { refresh(); }, []);

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.addWatch({ kind, value: value.trim(), label: label.trim() });
      setValue(""); setLabel("");
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(String(err.message || err));
    }
  }
  async function remove(id) { await api.deleteWatch(id); await refresh(); onChanged?.(); }
  async function toggle(it) { await api.toggleWatch(it.id, !it.enabled); await refresh(); onChanged?.(); }

  function enableNotifications() {
    if ("Notification" in window) Notification.requestPermission();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-6" onClick={onClose}>
      <div className="bg-ink-800 border border-ink-600 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600">
          <div>
            <div className="font-semibold">Watchlist</div>
            <div className="text-xs text-slate-500">Special aircraft, highlighted and logged when they pass</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full bg-ink-700 hover:bg-ink-600"><CloseIcon /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-slate-500">
              Match by
              <select value={kind} onChange={(e) => setKind(e.target.value)}
                className="mt-1 bg-ink-700 border border-ink-500 rounded-lg px-2 py-2 text-sm text-slate-200">
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-slate-500 flex-1 min-w-[120px]">
              Value (use * as wildcard)
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="D-EYIU, IAM*, P180…"
                className="mt-1 bg-ink-700 border border-ink-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
            </label>
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-slate-500 flex-1 min-w-[120px]">
              Note (optional)
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="why watched"
                className="mt-1 bg-ink-700 border border-ink-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
            </label>
            <button type="submit" className="px-3 py-2 rounded-lg bg-accent/15 text-accent border border-accent/40 text-sm hover:bg-accent/25">Add</button>
          </form>
          {error && <div className="text-xs text-red-400">{error}</div>}

          <div>
            <div className="text-[10px] uppercase tracking-wide text-accent/70 mb-1.5">Watched ({items.length})</div>
            {items.length === 0 && <div className="text-sm text-slate-500">Nothing watched yet.</div>}
            <div className="space-y-1">
              {items.map((it) => (
                <div key={it.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-ink-600 ${it.enabled ? "" : "opacity-50"}`}>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-ink-700 text-slate-300 uppercase">{it.kind}</span>
                  <span className="font-mono text-sm text-slate-100">{it.value}</span>
                  {it.label && <span className="text-xs text-slate-500 truncate">{it.label}</span>}
                  <span className="flex-1" />
                  <button onClick={() => toggle(it)} className="text-[11px] text-slate-400 hover:text-accent">{it.enabled ? "disable" : "enable"}</button>
                  <button onClick={() => remove(it.id)} className="text-[11px] text-red-400 hover:text-red-300">remove</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-accent/70">Recent passages</div>
              <button onClick={enableNotifications} className="text-[11px] text-slate-400 hover:text-accent">enable notifications</button>
            </div>
            {events.length === 0 && <div className="text-sm text-slate-500">No passages recorded.</div>}
            <div className="space-y-1">
              {events.map((ev) => (
                <button key={ev.id} onClick={() => { onPickHex?.(ev.hex); onClose(); }}
                  className="w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-ink-700 text-sm">
                  <span className="text-amber-300 font-medium">{ev.label || ev.value}</span>
                  <span className="text-xs text-slate-500 font-mono">{ev.flight || ev.hex.toUpperCase()}</span>
                  <span className="flex-1" />
                  <span className="text-[11px] text-slate-500">{fmtLocal(ev.seen_at)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
