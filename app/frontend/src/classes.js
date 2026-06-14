// Traffic-class metadata: label, color, short tag. UI labels in English.
export const CLASSES = {
  military: { label: "Military", color: "#ff5d5d", tag: "MIL" },
  hems: { label: "Air ambulance", color: "#ff8bd1", tag: "HEMS" },
  helicopter: { label: "Helicopter", color: "#ffd166", tag: "HELI" },
  drone: { label: "Drone / UAV", color: "#b794f6", tag: "UAV" },
  emergency: { label: "Emergency", color: "#ff8c42", tag: "EMG" },
  airline: { label: "Airline", color: "#6fa8dc", tag: "LINE" },
  ga: { label: "General aviation", color: "#7ee0a6", tag: "GA" },
};

// Chips shown in the search panel. "Non-airline" maps to all classes except airline.
export const FILTER_CHIPS = [
  { key: "military", label: "Military" },
  { key: "hems", label: "Air ambulance" },
  { key: "helicopter", label: "Helicopters" },
  { key: "drone", label: "Drones / UAV" },
  { key: "emergency", label: "Emergency" },
  { key: "ga", label: "General aviation" },
  { key: "airline", label: "Airline" },
];

export const NON_AIRLINE = ["military", "hems", "helicopter", "drone", "emergency", "ga"];

export function classMeta(klass) {
  return CLASSES[klass] || { label: klass || "Unknown", color: "#8aa0b3", tag: "?" };
}

// Altitude (feet) -> color gradient for the track.
export function altColor(alt) {
  const a = typeof alt === "number" ? alt : parseFloat(alt);
  if (!isFinite(a)) return "#5cc8ff";
  const stops = [
    [0, "#2dd4bf"],
    [5000, "#4ade80"],
    [15000, "#facc15"],
    [25000, "#fb923c"],
    [35000, "#f87171"],
    [45000, "#e879f9"],
  ];
  let [, c0] = stops[0];
  for (let i = 1; i < stops.length; i++) {
    if (a <= stops[i][0]) {
      const [lo, lc] = stops[i - 1];
      const [hi, hc] = stops[i];
      return lerp(lc, hc, (a - lo) / (hi - lo));
    }
    c0 = stops[i][1];
  }
  return c0;
}

function lerp(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const pa = hex2rgb(a);
  const pb = hex2rgb(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
