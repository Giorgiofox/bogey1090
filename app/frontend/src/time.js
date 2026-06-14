// All timestamps are stored UTC (…Z). Display them in the browser's local zone
// (Rome for this deployment). new Date(isoZ) parses as UTC; formatting is local.
const SHORT = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function fmtLocal(iso) {
  return iso ? SHORT.format(new Date(iso)) : "";
}
export function fmtFull(iso) {
  return iso ? FULL.format(new Date(iso)) : "–";
}
export function tzName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "local";
  }
}
