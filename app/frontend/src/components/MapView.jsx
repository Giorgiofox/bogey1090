import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { altColor, classMeta } from "../classes.js";
import { fmtLocal } from "../time.js";

const STYLE = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const empty = () => ({ type: "FeatureCollection", features: [] });
const altNum = (a) => { const n = typeof a === "number" ? a : parseFloat(a); return isFinite(n) ? n : 0; };

function segments(points) {
  const feats = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.lat == null || b.lat == null) continue;
    feats.push({
      type: "Feature",
      properties: { color: altColor((altNum(a.alt) + altNum(b.alt)) / 2) },
      geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
    });
  }
  return { type: "FeatureCollection", features: feats };
}

function multiLines(tracks) {
  const feats = [];
  (tracks || []).forEach((t) => {
    const pts = (t.points || []).filter((p) => p.lat != null && p.lon != null);
    if (pts.length < 2) return;
    feats.push({
      type: "Feature",
      properties: {
        color: t.watched ? "#fbbf24" : classMeta(t.traffic_class).color,
        hex: t.hex, watched: t.watched ? 1 : 0,
      },
      geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) },
    });
  });
  return { type: "FeatureCollection", features: feats };
}

function circle(lon, lat, km, steps = 64) {
  const coords = [];
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

const HOUSE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#0a0e14" stroke="#5cc8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>';

export default function MapView({ center, receiver, rings, track, multiTracks, onSelectTrack }) {
  const ref = useRef(null);
  const map = useRef(null);
  const recMarker = useRef(null);
  const centerMarker = useRef(null);
  const endMarkers = useRef([]);
  const selectCb = useRef(onSelectTrack);
  selectCb.current = onSelectTrack;

  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: [center?.lon || 9.9, center?.lat || 45.5],
      zoom: center?.zoom || 8,
      attributionControl: true,
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.current.on("load", () => {
      map.current.addSource("rings", { type: "geojson", data: empty() });
      map.current.addLayer({ id: "rings-line", type: "line", source: "rings",
        paint: { "line-color": "#2b3a4a", "line-width": 1, "line-dasharray": [2, 3] } });
      map.current.addSource("multi", { type: "geojson", data: empty() });
      map.current.addLayer({
        id: "multi-line", type: "line", source: "multi",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["case", ["==", ["get", "watched"], 1], 4, 1.6],
          "line-color": ["get", "color"],
          "line-opacity": ["case", ["==", ["get", "watched"], 1], 1, 0.7],
        },
      });
      // Wider invisible hit area so thin tracks are easy to click.
      map.current.addLayer({
        id: "multi-hit", type: "line", source: "multi",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 12, "line-color": "#000", "line-opacity": 0 },
      });
      map.current.on("click", "multi-hit", (e) => {
        const hex = e.features?.[0]?.properties?.hex;
        if (hex && selectCb.current) selectCb.current(hex);
      });
      map.current.on("mouseenter", "multi-hit", () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", "multi-hit", () => { map.current.getCanvas().style.cursor = ""; });
      map.current.addSource("track", { type: "geojson", data: empty() });
      map.current.addLayer({
        id: "track-line", type: "line", source: "track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 3, "line-color": ["get", "color"] },
      });
      drawReceiver();
      drawCenter();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawReceiver() {
    const m = map.current;
    if (!m || !receiver?.lat) return;
    if (recMarker.current) recMarker.current.remove();
    const el = document.createElement("div");
    el.style.cssText = "width:13px;height:13px;border-radius:50%;background:#5cc8ff;border:2px solid #0a0e14;box-shadow:0 0 0 4px rgba(92,200,255,.2)";
    recMarker.current = new maplibregl.Marker({ element: el })
      .setLngLat([receiver.lon, receiver.lat])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setText(receiver.name || "Receiver"))
      .addTo(m);
  }

  function drawCenter() {
    const m = map.current;
    if (!m || center?.lat == null) return;
    // House marker at the configured center.
    if (centerMarker.current) centerMarker.current.remove();
    const el = document.createElement("div");
    el.innerHTML = HOUSE_SVG;
    el.style.cssText = "filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));cursor:default";
    centerMarker.current = new maplibregl.Marker({ element: el })
      .setLngLat([center.lon, center.lat])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setText("Map center"))
      .addTo(m);
    // Concentric rings around the center.
    const src = m.getSource("rings");
    if (!src) return;
    if (rings?.show === false) { src.setData(empty()); return; }
    const toKm = rings?.unit === "mi" ? 1.60934 : 1;
    const dists = (rings?.distances && rings.distances.length ? rings.distances : [50, 100, 150]);
    src.setData({ type: "FeatureCollection", features: dists.map((d) => circle(center.lon, center.lat, d * toKm)) });
  }

  useEffect(() => {
    if (map.current?.isStyleLoaded()) drawReceiver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiver?.lat, receiver?.lon, receiver?.name]);

  // Recenter + redraw center marker/rings when center or ring settings change.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (m.isStyleLoaded()) drawCenter(); else m.once("load", drawCenter);
    if (center?.lat != null) {
      m.flyTo({ center: [center.lon, center.lat], zoom: center.zoom || m.getZoom(), duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lon, center?.zoom, rings?.show, rings?.unit, JSON.stringify(rings?.distances)]);

  // Multi-track overlay (time-window mode).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => m.getSource("multi")?.setData(multiLines(multiTracks));
    if (m.isStyleLoaded()) apply(); else m.once("load", apply);
  }, [multiTracks]);

  // Single selected track (altitude-coloured) + endpoints.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      endMarkers.current.forEach((mk) => mk.remove());
      endMarkers.current = [];
      const pts = (track?.points || []).filter((p) => p.lat != null && p.lon != null);
      const src = m.getSource("track");
      if (!src) return;
      if (pts.length < 1) { src.setData(empty()); return; }
      src.setData(segments(pts));
      const start = pts[0], end = pts[pts.length - 1];
      endMarkers.current.push(new maplibregl.Marker({ color: "#7ee0a6", scale: 0.7 }).setLngLat([start.lon, start.lat]).addTo(m));
      endMarkers.current.push(
        new maplibregl.Marker({ color: "#ff5d5d" }).setLngLat([end.lon, end.lat])
          .setPopup(new maplibregl.Popup({ offset: 14 }).setText(`${track.hex.toUpperCase()} · ${fmtLocal(end.t)}`)).addTo(m)
      );
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p.lon, p.lat]));
      m.fitBounds(b, { padding: 80, maxZoom: 11, duration: 600 });
    };
    if (m.isStyleLoaded()) apply(); else m.once("load", apply);
  }, [track]);

  return <div ref={ref} className="absolute inset-0" />;
}
