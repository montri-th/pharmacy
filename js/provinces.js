/**
 * Province frames for the country view: with the whole country on screen the map still shows where the
 * pharmacies are — every province is a frame to drill down into.
 *
 * Below PROVINCE_FILL_MAX_ZOOM every frame is filled with the LDS `count` family (rows per province — a
 * total, not a density: the country view answers “how many”, the subdistrict choropleth answers “how
 * dense”). From there up only the outline remains until PROVINCE_OUTLINE_MAX_ZOOM, where the แขวง/ตำบล
 * carry the reading. With a จังหวัด filter no frame is filled: the selected one shows its own แขวง/ตำบล at
 * every zoom (js/map-layers.js, province view) under its selection stroke, the others go quiet (outline).
 *
 * Boundaries: data/provinces.geojson, dissolved from CityMETER production subdistrict boundaries.
 * EVID-05: measured · measured_zero (0 rows in this selection, e.g. a chain that is not there).
 */
import {provinceByCode} from './model.js';
import {buildCountClasses, classify} from './scales.js';
import {featureBounds, firstLineLayerId} from './map-layers.js';

export const PROVINCE_FILL_MAX_ZOOM = 8;
export const PROVINCE_OUTLINE_MAX_ZOOM = 12;
export const PROVINCE_LABEL_MAX_ZOOM = 9;
const SOURCE = 'provinces';
export const PROVINCE_LAYERS = Object.freeze({fill: 'province-fill', zero: 'province-zero-outline', outline: 'province-outline', selected: 'province-selected'});

function cssVar(name, fallback) {
  const value = typeof getComputedStyle === 'function' && typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return value || fallback;
}

/** Per-province model: rows per province among `rows` (rows carry the production province code). */
export function buildProvinceModel(rows, geojson, {unit = 'ร้าน'} = {}) {
  const counts = new Map();
  for (const r of rows || []) counts.set(r.province, (counts.get(r.province) || 0) + 1);
  const provinces = (geojson?.features || []).map(f => {
    const code = String(f.id ?? f.properties?.id);
    const meta = provinceByCode(code) || {code, th: f.properties?.name || code, en: f.properties?.nameEn || code};
    return {id: code, code, name: meta.th, nameEn: meta.en, count: counts.get(code) || 0, label: f.properties?.label || null, feature: f};
  });
  const classes = buildCountClasses(provinces.map(p => p.count), 5, {unit});
  for (const p of provinces) { const c = classify(p.count, classes); p.state = c.state; p.fill = c.fill; p.ink = c.ink; p.outline = c.outline || null; }
  return {provinces, classes, zeroCount: provinces.filter(p => p.state === 'measured_zero').length};
}

export function installProvinceLayers(map, geojson) {
  const beforeId = firstLineLayerId(map);
  map.addSource(SOURCE, {type: 'geojson', data: geojson, promoteId: 'id'});
  const fs = (key, on, off = 0) => ['case', ['boolean', ['feature-state', key], false], on, off];
  map.addLayer({id: PROVINCE_LAYERS.fill, type: 'fill', source: SOURCE, maxzoom: PROVINCE_FILL_MAX_ZOOM,
    paint: {'fill-color': ['coalesce', ['feature-state', 'fill'], '#000000'], 'fill-opacity': fs('filled', 1), 'fill-antialias': true}}, beforeId);
  map.addLayer({id: PROVINCE_LAYERS.zero, type: 'line', source: SOURCE, maxzoom: PROVINCE_FILL_MAX_ZOOM,
    paint: {'line-color': cssVar('--data-zero-outline', '#7D877F'), 'line-width': 2, 'line-opacity': fs('zero', 1)}}, beforeId);
  map.addLayer({id: PROVINCE_LAYERS.outline, type: 'line', source: SOURCE, maxzoom: PROVINCE_OUTLINE_MAX_ZOOM,
    paint: {'line-color': ['case', ['boolean', ['feature-state', 'quiet'], false], cssVar('--border-default', '#C9D0CB'), cssVar('--border-emphasis', '#7D877F')],
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 9, 1.2, 12, 1.6], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 12, 0.35]}});
  map.addLayer({id: PROVINCE_LAYERS.selected, type: 'line', source: SOURCE, maxzoom: 13,
    paint: {'line-color': cssVar('--map-selected-stroke', '#176B82'), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 9, 2.4],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, fs('selected', 1), 13, fs('selected', 0.3)]}});
  let current = {provinces: [], classes: null, zeroCount: 0};
  const ids = (geojson?.features || []).map(f => String(f.id ?? f.properties?.id));

  /** rows: the filtered scope WITHOUT the province filter (every frame keeps its own count); selectedCode: the จังหวัด filter. */
  function update({rows = [], selectedCode = '', visible = true, unit = 'ร้าน'} = {}) {
    current = buildProvinceModel(rows, geojson, {unit});
    const byId = new Map(current.provinces.map(p => [p.code, p]));
    for (const id of ids) {
      const p = byId.get(id);
      p.selected = id === selectedCode; p.quiet = Boolean(selectedCode) && !p.selected;
      const filled = !selectedCode; // a จังหวัด filter: its แขวง/ตำบล carry the reading (no count fill under them)
      map.setFeatureState({source: SOURCE, id}, {fill: p.fill, filled, zero: filled && p.state === 'measured_zero', quiet: p.quiet, selected: p.selected});
    }
    for (const id of Object.values(PROVINCE_LAYERS)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    return current;
  }
  function dispose() {
    for (const id of Object.values(PROVINCE_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
  return {update, dispose, model: () => current, layerIds: PROVINCE_LAYERS};
}

/** Bounds of one province frame (drill-down fit). */
export function provinceBounds(geojson, code, LngLatBounds) {
  const f = (geojson?.features || []).find(x => String(x.id ?? x.properties?.id) === code);
  return f ? featureBounds(f, LngLatBounds) : null;
}
