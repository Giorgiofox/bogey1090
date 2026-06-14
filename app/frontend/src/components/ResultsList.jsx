import { classMeta } from "../classes.js";
import { fmtLocal } from "../time.js";
import { hexCountry, countryName, flagUrl } from "../flags.js";

export default function ResultsList({ rows, selected, onSelect, loading }) {
  if (!loading && rows.length === 0) {
    return <div className="flex-1 grid place-items-center text-sm text-slate-500">No aircraft match.</div>;
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {rows.map((r) => {
        const m = classMeta(r.traffic_class);
        const active = r.hex === selected;
        const iso = hexCountry(r.hex);
        return (
          <button
            key={r.hex}
            onClick={() => onSelect(r.hex)}
            className={`w-full text-left px-4 py-2.5 border-b border-ink-700 flex items-center gap-3
              hover:bg-ink-700 transition ${active ? "bg-ink-700" : ""}
              ${r.watched ? "border-l-2 border-l-amber-400 bg-amber-400/5" : ""}`}
          >
            <span className="shrink-0 flex items-center gap-1.5">
              <span
                className="w-12 text-center text-[10px] font-semibold py-0.5 rounded"
                style={{ background: `${m.color}22`, color: m.color }}
              >
                {m.tag}
              </span>
              {iso && (
                <span className="shrink-0 border border-ink-600 bg-ink-900 grid place-items-center overflow-hidden"
                  style={{ width: 22, height: 15 }} title={countryName(iso)}>
                  <img src={flagUrl(iso)} alt={iso} loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-medium text-sm truncate">
                  {r.flight || r.reg || r.hex.toUpperCase()}
                </span>
                {r.ac_type && <span className="text-xs text-slate-500">{r.ac_type}</span>}
                {r.mlat ? <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">MLAT</span> : null}
                {r.watched ? <span className="text-[9px] px-1 rounded bg-amber-400/30 text-amber-200" title={r.watch_label || "watched"}>WATCH</span> : null}
              </span>
              <span className="block text-xs text-slate-500 truncate">
                {r.reg ? `${r.reg} · ` : ""}{r.ac_desc || m.label}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {r.military_score > 0 && (
                <span className="block text-[11px] text-red-400 tabular-nums">mil {r.military_score}</span>
              )}
              <span className="block text-[10px] text-slate-600">{fmtLocal(r.last_seen_at)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
