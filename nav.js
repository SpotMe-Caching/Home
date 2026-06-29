'use strict';

// ── NAVIGATION OVERLAY ────────────────────────────────────────────────────────
// Externe Abhängigkeiten (aus state.js / main):
//   userPos      – aktueller GPS-Standort des Users
//   ORS_KEY      – OpenRouteService API Key
//   haversineKm  – aus helpers.js
//   toast        – aus helpers.js
//   maplibregl   – global via CDN
// ─────────────────────────────────────────────────────────────────────────────

let naviMap         = null;
let naviUserMarker  = null;
let naviSpotMarker  = null;
let naviWatchId     = null;
let naviLastRoutePos = null;
let naviRouting     = false;
let naviTarget      = null;
let naviCentered    = true;

// ── PUBLIC: Einstiegspunkt aus Marker-Drawer ──────────────────────────────────
function navigateToSpot(lat, lng, name) {
  openNavOverlay(lat, lng, name || 'Spot');
}

// ── OVERLAY ÖFFNEN ────────────────────────────────────────────────────────────
function openNavOverlay(lat, lng, name) {
  naviTarget       = { lat, lng, name: name || 'Spot' };
  naviLastRoutePos = null;
  naviRouting      = false;
  naviCentered     = true;

  // UI zurücksetzen
  document.getElementById('naviSpotName').textContent = naviTarget.name;
  document.getElementById('naviSpotSub').textContent  = 'NAVIGATION · GPS aktiv';
  document.getElementById('naviDistVal').textContent  = '…';
  document.getElementById('naviFootVal').textContent  = '…';
  document.getElementById('naviCarVal').textContent   = '…';
  document.getElementById('naviOverlay').classList.add('active');

  // Recenter-Button
  document.getElementById('naviRecenterBtn').onclick = () => {
    naviCentered = true;
    if (naviMap && userPos) {
      naviMap.flyTo({ center: [userPos.lng, userPos.lat], zoom: 15, duration: 600 });
    }
  };

  // Kleines Delay damit CSS-Transition sauber anläuft
  setTimeout(() => {
    if (naviMap) { naviMap.remove(); naviMap = null; }
    naviUserMarker = null;
    naviSpotMarker = null;

    const center = userPos
      ? [(userPos.lng + lng) / 2, (userPos.lat + lat) / 2]
      : [lng, lat];

    naviMap = new maplibregl.Map({
      container: 'naviMap',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center,
      zoom: 14,
      attributionControl: false
    });

    naviMap.on('dragstart', () => { naviCentered = false; });

    naviMap.on('load', () => {
      // Spot-Marker (orange)
      const sEl = document.createElement('div');
      sEl.style.cssText = [
        'width:22px;height:22px;',
        'background:#ff9f00;border-radius:50%;',
        'border:2.5px solid rgba(255,255,255,0.85);',
        'box-shadow:0 0 0 4px rgba(255,159,0,0.2),0 0 20px rgba(255,159,0,0.8);'
      ].join('');
      naviSpotMarker = new maplibregl.Marker({ element: sEl })
        .setLngLat([lng, lat])
        .addTo(naviMap);

      if (userPos) {
        naviAddUserMarker();
        naviUpdateDistDisplay();
        naviFitBounds();
        naviFetchRoute();
      }
    });

    // GPS-Watch starten
    if (navigator.geolocation) {
      naviWatchId = navigator.geolocation.watchPosition(
        pos => {
          userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };

          if (naviUserMarker) naviUserMarker.setLngLat([userPos.lng, userPos.lat]);
          else naviAddUserMarker();

          if (naviCentered && naviMap) {
            naviMap.easeTo({ center: [userPos.lng, userPos.lat], duration: 400 });
          }

          naviUpdateDistDisplay();

          const moved = naviLastRoutePos
            ? haversineKm(naviLastRoutePos.lat, naviLastRoutePos.lng, userPos.lat, userPos.lng) * 1000
            : 999;
          if (moved > 25) naviFetchRoute();
        },
        () => toast('⚠️ GPS Signal verloren'),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
    }
  }, 80);
}

// ── OVERLAY SCHLIESSEN ────────────────────────────────────────────────────────
function closeNavOverlay() {
  if (naviWatchId) {
    navigator.geolocation.clearWatch(naviWatchId);
    naviWatchId = null;
  }
  if (naviMap) { naviMap.remove(); naviMap = null; }
  naviUserMarker   = null;
  naviSpotMarker   = null;
  naviLastRoutePos = null;
  naviTarget       = null;
  naviRouting      = false;
  document.getElementById('naviOverlay').classList.remove('active');
}

// ── INTERNE HELPERS ───────────────────────────────────────────────────────────
function naviAddUserMarker() {
  if (!naviMap || !userPos) return;
  if (naviUserMarker) naviUserMarker.remove();
  const uEl = document.createElement('div');
  uEl.style.cssText = [
    'width:18px;height:18px;',
    'background:#22d3ee;border-radius:50%;',
    'border:3px solid white;',
    'box-shadow:0 0 10px rgba(34,211,238,0.9);'
  ].join('');
  naviUserMarker = new maplibregl.Marker({ element: uEl })
    .setLngLat([userPos.lng, userPos.lat])
    .addTo(naviMap);
}

function naviFitBounds() {
  if (!naviMap || !userPos || !naviTarget) return;
  const bounds = new maplibregl.LngLatBounds(
    [userPos.lng, userPos.lat],
    [naviTarget.lng, naviTarget.lat]
  );
  naviMap.fitBounds(bounds, { padding: 80, maxZoom: 16 });
}

function naviUpdateDistDisplay() {
  if (!userPos || !naviTarget) return;
  const m = haversineKm(userPos.lat, userPos.lng, naviTarget.lat, naviTarget.lng) * 1000;
  document.getElementById('naviDistVal').textContent =
    m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function naviClearRouteLayers() {
  if (!naviMap) return;
  ['navi-foot-casing', 'navi-foot', 'navi-car-casing', 'navi-car'].forEach(id => {
    if (naviMap.getLayer(id)) naviMap.removeLayer(id);
  });
  ['navi-src-foot', 'navi-src-car'].forEach(id => {
    if (naviMap.getSource(id)) naviMap.removeSource(id);
  });
}

async function naviFetchRoute() {
  if (!userPos || !naviTarget || !naviMap || naviRouting) return;
  naviRouting      = true;
  naviLastRoutePos = { ...userPos };

  const start   = `${userPos.lng},${userPos.lat}`;
  const end     = `${naviTarget.lng},${naviTarget.lat}`;
  const osrmSeg = `${userPos.lng},${userPos.lat};${naviTarget.lng},${naviTarget.lat}?overview=full&geometries=geojson`;

  // Fahrrad: OSRM (kein Key)
  const carPromise = fetch(`https://router.project-osrm.org/route/v1/bike/${osrmSeg}`)
    .then(r => r.json())
    .catch(() => null);

  // Fußweg: ORS wenn Key da, sonst OSRM foot
  const footPromise = ORS_KEY
    ? fetch(`https://api.openrouteservice.org/v2/directions/foot-hiking?api_key=${ORS_KEY}&start=${start}&end=${end}`)
        .then(r => r.json()).catch(() => null)
    : fetch(`https://router.project-osrm.org/route/v1/foot/${osrmSeg}`)
        .then(r => r.json()).catch(() => null);

  const [carData, footRaw] = await Promise.all([carPromise, footPromise]);

  naviRouting = false;
  if (!naviMap) return; // wurde inzwischen geschlossen

  naviClearRouteLayers();

  const fmtMin = s => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  // Auto-Route zeichnen
  if (carData?.routes?.length) {
    const r = carData.routes[0];
    naviMap.addSource('navi-src-car', {
      type: 'geojson',
      data: { type: 'Feature', geometry: r.geometry }
    });
    naviMap.addLayer({
      id: 'navi-car-casing', type: 'line', source: 'navi-src-car',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint:  { 'line-color': '#0a0d12', 'line-width': 8, 'line-opacity': 0.7 }
    });
    naviMap.addLayer({
      id: 'navi-car', type: 'line', source: 'navi-src-car',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint:  { 'line-color': '#f59e0b', 'line-width': 5, 'line-opacity': 0.9 }
    });
    document.getElementById('naviCarVal').textContent = fmtMin(r.duration);
  }

  // Fußweg zeichnen
  let footGeometry = null, footDuration = null;
  if (ORS_KEY && footRaw?.features?.length) {
    footGeometry = footRaw.features[0].geometry;
    footDuration  = footRaw.features[0].properties?.summary?.duration;
  } else if (!ORS_KEY && footRaw?.routes?.length) {
    footGeometry = footRaw.routes[0].geometry;
    footDuration  = footRaw.routes[0].duration;
  }

  if (footGeometry) {
    naviMap.addSource('navi-src-foot', {
      type: 'geojson',
      data: { type: 'Feature', geometry: footGeometry }
    });
    naviMap.addLayer({
      id: 'navi-foot-casing', type: 'line', source: 'navi-src-foot',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint:  { 'line-color': '#0a0d12', 'line-width': 6, 'line-opacity': 0.6 }
    });
    naviMap.addLayer({
      id: 'navi-foot', type: 'line', source: 'navi-src-foot',
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint:  { 'line-color': '#22d3ee', 'line-width': 3, 'line-opacity': 1, 'line-dasharray': [2, 2] }
    });
    if (footDuration) document.getElementById('naviFootVal').textContent = fmtMin(footDuration);
  }
}
