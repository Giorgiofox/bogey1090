import { useState } from "react";
import { classMeta } from "../classes.js";
import { PlaneIcon, CloseIcon } from "../icons.jsx";
import { fmtFull, tzName } from "../time.js";
import { hexCountry, countryName, flagUrl } from "../flags.js";

const CATEGORY = {
  A0: "No info", A1: "Light (<15.5t)", A2: "Small (15.5-75t)", A3: "Large (75-300t)",
  A4: "High-vortex large", A5: "Heavy (>300t)", A6: "High performance", A7: "Rotorcraft",
  B0: "No info", B1: "Glider / sailplane", B2: "Lighter-than-air", B3: "Parachutist",
  B4: "Ultralight", B6: "UAV / drone", B7: "Space vehicle",
  C0: "No info", C1: "Surface emergency", C2: "Surface service", C3: "Point obstacle",
};

function parseRaw(json) {
  try { return JSON.parse(json || "{}"); } catch { return {}; }
}
function num(v, d = 0) { const n = Number(v); return isFinite(n) ? n.toFixed(d) : null; }

export default function DetailDrawer({ detail, onClose }) {
  const { state, info } = detail;
  const raw = parseRaw(state.raw_json);
  const [imgOk, setImgOk] = useState(true);
  const m = classMeta(state.traffic_class);
  const title = state.flight || info?.registration || state.reg || state.hex.toUpperCase();
  const photo = info?.photo_url || info?.photo_thumb;
  const hasPhoto = photo && imgOk;
  const alt = state.alt_baro === "ground" ? "On ground" : (num(state.alt_baro) ? `${state.alt_baro} ft` : null);
  const vrate = raw.baro_rate ?? raw.geom_rate;

  return (
    <div className="absolute top-3 right-3 bottom-3 w-[360px] bg-ink-800/95 backdrop-blur
                    border border-ink-600 rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {hasPhoto ? (
        <div className="relative shrink-0">
          <a href={info?.photo_link || photo} target="_blank" rel="noreferrer" title="Open full-resolution photo">
            <img
              src={photo} alt={title} referrerPolicy="no-referrer" loading="lazy"
              onError={() => setImgOk(false)}
              className="w-full h-44 object-cover hover:opacity-90 transition"
            />
          </a>
          <button onClick={onClose}
            className="absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-full bg-black/50 text-slate-200 hover:bg-black/70">
            <CloseIcon width={14} height={14} />
          </button>
          <span className="absolute bottom-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded"
            style={{ background: `${m.color}cc`, color: "#0a0e14" }}>{m.label}</span>
          {info?.photographer && (
            <a href={info.photo_link} target="_blank" rel="noreferrer"
              className="absolute bottom-1 right-2 text-[9px] text-white/70 hover:text-white">
              © {info.photographer} / planespotters.net
            </a>
          )}
        </div>
      ) : (
        // No photo: collapse the photo area to a slim bar.
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-ink-600">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded"
            style={{ background: `${m.color}cc`, color: "#0a0e14" }}>{m.label}</span>
          <span className="text-[11px] text-slate-500 truncate">
            {detail.enriching ? "Loading photo…" : "No photo in free databases — try the links below"}
          </span>
          <span className="flex-1" />
          <button onClick={onClose}
            className="w-7 h-7 grid place-items-center rounded-full bg-ink-700 text-slate-300 hover:bg-ink-600">
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      )}

      <div className="p-4 overflow-y-auto space-y-4">
        <div>
          <div className="text-lg font-semibold leading-tight flex items-center gap-2 flex-wrap">
            {title}
            {state.watched ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/30 text-amber-200" title={state.watch_label || ""}>WATCHED{state.watch_label ? `: ${state.watch_label}` : ""}</span> : null}
            {state.mlat ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">MLAT</span> : null}
          </div>
          <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
            {hexCountry(state.hex) && (
              <span className="grid place-items-center" style={{ width: 20, height: 14 }} title={countryName(hexCountry(state.hex))}>
                <img src={flagUrl(hexCountry(state.hex))} alt=""
                  style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }} />
              </span>
            )}
            {state.hex.toUpperCase()}{(state.ac_type || raw.t) ? ` · ${state.ac_type || raw.t}` : ""}
          </div>
        </div>

        <ExternalLinks hex={state.hex} reg={info?.registration || state.reg} flight={state.flight} />

        <Section title="Identity">
          <Field label="Registration" value={info?.registration || state.reg} />
          <Field label="Type" value={info?.type || state.ac_type} />
          <Field label="ICAO type" value={info?.icao_type || raw.t} />
          <Field label="Manufacturer" value={info?.manufacturer} />
          <Field label="Operator" value={info?.operator || info?.owner} wide />
          <Field label="Country" value={info?.country} />
          <Field label="Category" value={raw.category ? `${raw.category} · ${CATEGORY[raw.category] || "?"}` : null} wide />
          {(info?.route_origin || info?.route_dest) && (
            <Field label="Route" value={`${info.route_origin || "?"} → ${info.route_dest || "?"}`} wide />
          )}
          {info?.airline && <Field label="Airline" value={info.airline} wide />}
        </Section>

        <Section title="Flight">
          <Field label="Altitude (baro)" value={alt} />
          <Field label="Altitude (geom)" value={raw.alt_geom ? `${raw.alt_geom} ft` : null} />
          <Field label="Vertical rate" value={vrate != null ? `${vrate} ft/min` : null} />
          <Field label="Ground speed" value={num(state.gs) ? `${num(state.gs)} kt` : null} />
          <Field label="IAS / TAS" value={raw.ias || raw.tas ? `${raw.ias ?? "?"} / ${raw.tas ?? "?"} kt` : null} />
          <Field label="Mach" value={raw.mach != null ? String(raw.mach) : null} />
          <Field label="Track" value={num(raw.track) != null ? `${num(raw.track)}°` : null} />
          <Field label="Heading (mag)" value={num(raw.mag_heading) != null ? `${num(raw.mag_heading)}°` : null} />
          <Field label="Squawk" value={state.squawk} />
          <Field label="Sel. altitude" value={raw.nav_altitude_mcp ? `${raw.nav_altitude_mcp} ft` : null} />
        </Section>

        <Section title="Position & signal">
          <Field label="Latitude" value={state.lat != null ? num(state.lat, 4) : null} />
          <Field label="Longitude" value={state.lon != null ? num(state.lon, 4) : null} />
          <Field label="Distance" value={raw.r_dst != null ? `${num(raw.r_dst, 1)} nm` : null} />
          <Field label="Bearing" value={raw.r_dir != null ? `${num(raw.r_dir)}°` : null} />
          <Field label="Signal (RSSI)" value={state.rssi != null ? `${state.rssi} dBFS` : null} />
          <Field label="Messages" value={state.messages} />
          <Field label="Wind" value={raw.wd != null ? `${raw.wd}° @ ${raw.ws}kt` : null} />
          <Field label="OAT / TAT" value={raw.oat != null ? `${raw.oat} / ${raw.tat ?? "?"} °C` : null} />
        </Section>

        {state.military_reasons && (
          <div className="text-xs">
            <div className="text-slate-500 mb-1">Military signals</div>
            <div className="flex flex-wrap gap-1">
              {state.military_reasons.split(",").filter(Boolean).map((r) => (
                <span key={r} className="px-2 py-0.5 rounded bg-red-500/15 text-red-300 font-mono text-[11px]">{r}</span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Samples" value={state.samples} />
          <Stat label="Mil score" value={state.military_score} />
          <Stat label="Class" value={m.tag} />
        </div>

        <div className="text-xs text-slate-500 space-y-0.5">
          <div>First seen: {fmtFull(state.first_seen_at)}</div>
          <div>Last seen: {fmtFull(state.last_seen_at)}</div>
          <div className="text-[10px] text-slate-600">times in {tzName()}</div>
        </div>
      </div>
    </div>
  );
}

function ExternalLinks({ hex, reg, flight }) {
  const f = flight ? flight.trim() : null;
  const links = [
    ["Planespotters", `https://www.planespotters.net/hex/${hex}`],
    ["JetPhotos", reg ? `https://www.jetphotos.com/registration/${reg}` : `https://www.jetphotos.com/photo/keyword/${hex}`],
    ["Flightradar24", reg ? `https://www.flightradar24.com/data/aircraft/${reg}` : f ? `https://www.flightradar24.com/data/flights/${f}` : `https://www.flightradar24.com/${hex}`],
    ["RadarBox", f ? `https://www.radarbox.com/data/flights/${f}` : reg ? `https://www.radarbox.com/data/registration/${reg}` : null],
    ["ADSBexchange", `https://globe.adsbexchange.com/?icao=${hex}`],
    ["FlightAware", f ? `https://flightaware.com/live/flight/${f}` : `https://flightaware.com/live/modes/${hex}/redirect`],
    ["airfleets", reg ? `https://www.airfleets.net/recherche/?key=${reg}` : null],
  ].filter(([, url]) => url);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-accent/70 mb-1.5">Photos & info</div>
      <div className="flex flex-wrap gap-1.5">
        {links.map(([label, url]) => (
          <a key={label} href={url} target="_blank" rel="noreferrer"
            className="px-2.5 py-1 rounded-full text-xs border bg-ink-700 border-ink-500 text-slate-300 hover:border-accent hover:text-accent transition">
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  const fields = Array.isArray(children) ? children : [children];
  const visible = fields.filter((c) => c && c.props && c.props.value);
  if (visible.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-accent/70 mb-1.5">{title}</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Field({ label, value, wide }) {
  if (value == null || value === "") return null;
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-200 truncate">{value}</dd>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-ink-700 rounded-lg py-2">
      <div className="text-slate-200 font-medium tabular-nums">{value ?? "-"}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

