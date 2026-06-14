import { useState } from "react";
import { CloseIcon } from "../icons.jsx";

export default function SettingsPanel({ settings, receiver, onSave, onClose }) {
  const [s, setS] = useState(settings);
  const lat = s.centerLat ?? receiver?.lat ?? "";
  const lon = s.centerLon ?? receiver?.lon ?? "";

  function set(k, v) { setS((p) => ({ ...p, [k]: v })); }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-6" onClick={onClose}>
      <div className="bg-ink-800 border border-ink-600 rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600">
          <div className="font-semibold">Preferences</div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full bg-ink-700 hover:bg-ink-600">
            <CloseIcon />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-accent/70 mb-2">Map default center</div>
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label="Latitude" value={lat}
                onChange={(v) => set("centerLat", v === "" ? null : Number(v))} />
              <LabeledInput label="Longitude" value={lon}
                onChange={(v) => set("centerLon", v === "" ? null : Number(v))} />
            </div>
            <button
              onClick={() => setS((p) => ({ ...p, centerLat: receiver?.lat ?? null, centerLon: receiver?.lon ?? null }))}
              className="mt-2 text-xs text-accent hover:underline"
            >
              Use receiver location ({receiver?.name})
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Default zoom" type="number" value={s.zoom}
              onChange={(v) => set("zoom", Number(v))} />
            <LabeledInput label="Max tracks on map" type="number" value={s.maxTracks}
              onChange={(v) => set("maxTracks", Number(v))} />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-accent/70 mb-2">Range rings (around center)</div>
            <label className="flex items-center gap-2 mb-2 text-xs text-slate-400">
              <input type="checkbox" checked={s.showRings} onChange={(e) => set("showRings", e.target.checked)} className="accent-accent" />
              Show concentric rings
            </label>
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label={`Distances (${s.ringUnit}, comma-sep)`}
                value={(s.ringDistances || []).join(",")}
                onChange={(v) => set("ringDistances", v.split(",").map((x) => Number(x.trim())).filter((n) => n > 0))} />
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Unit</span>
                <select value={s.ringUnit} onChange={(e) => set("ringUnit", e.target.value)}
                  className="w-full bg-ink-700 border border-ink-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent">
                  <option value="km">Kilometers</option>
                  <option value="mi">Miles</option>
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-ink-600">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-ink-700 border border-ink-500 text-sm">Cancel</button>
          <button onClick={() => { onSave(s); onClose(); }}
            className="px-3 py-1.5 rounded-lg bg-accent/20 border border-accent/50 text-accent text-sm">Save</button>
        </div>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      <input
        type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-ink-700 border border-ink-500 rounded-lg px-3 py-2 text-sm
                   focus:outline-none focus:border-accent"
      />
    </label>
  );
}
