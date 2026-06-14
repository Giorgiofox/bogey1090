import { useEffect, useState } from "react";

const KEY = "bogey1090.settings";
const DEFAULTS = {
  centerLat: null, centerLon: null, zoom: 8, maxTracks: 250,
  ringUnit: "km", ringDistances: [50, 100, 150], showRings: true,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
  }, [settings]);
  return [settings, setSettings];
}
