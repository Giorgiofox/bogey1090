async function get(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

function filterParams({ q, classes, milMin, mlat }) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  (classes || []).forEach((c) => p.append("class", c));
  if (milMin) p.set("mil_min", String(milMin));
  if (mlat) p.set("mlat", "1");
  return p;
}

export function getStatus() {
  return get("/api/status");
}

export function search({ q, classes, milMin, mlat, from, to, limit = 500 }) {
  const p = filterParams({ q, classes, milMin, mlat });
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  p.set("limit", String(limit));
  return get(`/api/search?${p.toString()}`);
}

export function getTracks({ q, classes, milMin, mlat, from, to }) {
  const p = filterParams({ q, classes, milMin, mlat });
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  return get(`/api/tracks?${p.toString()}`);
}

export function getCalendar({ q, classes, milMin, mlat, days = 366 } = {}) {
  const p = filterParams({ q, classes, milMin, mlat });
  p.set("days", String(days));
  return get(`/api/calendar?${p.toString()}`);
}

export function getBreakdown({ q, classes, milMin, mlat, from, to, day } = {}) {
  const p = filterParams({ q, classes, milMin, mlat });
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (day) p.set("day", day);
  return get(`/api/breakdown?${p.toString()}`);
}

export function getAircraft(hex) {
  return get(`/api/aircraft/${hex}`);
}

export function getTrack(hex) {
  return get(`/api/aircraft/${hex}/track`);
}
