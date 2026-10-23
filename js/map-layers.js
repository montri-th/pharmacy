/**
 * Area layers on the MapLibre map: แขวง/ตำบล choropleth, เขต/อำเภอ outlines and HTML area labels.
 *
 * The subdistrict and district outlines arrive per province (js/frames.js); the sources hold the merged
 * frames loaded so far and are re-set when a province arrives (setFrames). Every update only writes
 * feature-state for the loaded frames, so recolouring never re-tiles. Fill = LDS density.area class of
 * rows per km² within scopeRows, inserted beneath the basemap's first line layer so roads and labels stay
 * readable above an exact, opaque data colour; it switches off at zoom ≥ FILL_MAX_ZOOM (hard switch) where
 * pins and buildings carry the reading.
 *
 * Every loaded frame stays a click target at every zoom (`area-hit`, a transparent fill without maxzoom):
 * from a selected แขวง/ตำบล a click on the next one moves there. Hover draws a thin outline.
 *
 * Province view (live walk 2026-10-23: a big จังหวัด held at zoom 8 lost half its frame off screen): with a
 * จังหวัด filter, that province's frames carry feature-state `province` and are drawn from
 * PROVINCE_VIEW_MIN_ZOOM, so the whole province fits with its choropleth; every other frame still starts at
 * AREA_MIN_ZOOM (below it the province frames of js/provinces.js carry the reading).
 *
 * EVID-05 per frame: measured (class fill) · measured_zero (the national register lists no premises there
 * in this selection → lowest fill + zero outline, labelled “0 ในทะเบียน”) · no_data is not used by the
 * licence register, which covers the whole country (kept for the treatment contract) · out_of_scope does
 * not occur (all 77 provinces are frames).
 */
import {summarizeAreas} from './areas.js';
import {buildDensityClasses, classify} from './scales.js';

export const FILL_MAX_ZOOM = 14.5;
export const AREA_MIN_ZOOM = 8;
/** Lowest zoom at which the frames of the selected จังหวัด are drawn (the country fit never goes below 4). */
export const PROVINCE_VIEW_MIN_ZOOM = 4;
const SOURCE = 'areas', DISTRICTS = 'districts', HATCH = 'nodata-hatch';
export const AREA_LAYERS = Object.freeze({hit: 'area-hit', fill: 'area-fill', hatch: 'area-nodata', zero: 'area-zero-outline', outline: 'area-outline', hover: 'area-hover', selected: 'area-selected'});
export const DISTRICT_LAYERS = Object.freeze({outline: 'district-outline', selected: 'district-selected'});

function cssVar(name, fallback) {
  const value = typeof getComputedStyle === 'function' && typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return value || fallback;
}

/** First basemap line layer id, so data fills stay under roads and labels. */
export function firstLineLayerId(map) {
  const layers = map.getStyle()?.layers || [];
  return (layers.find(l => l.type === 'line') || layers.find(l => l.type === 'symbol'))?.id;
}

export function featureBounds(feature, LngLatBounds) {
  const b = new LngLatBounds();
  const walk = v => { if (typeof v[0] === 'number') b.extend(v); else v.forEach(walk); };
  walk(feature.geometry.coordinates);
  return b;
}

/** 135° hatch (EVID-05 no_data): data-no-data ground with border-emphasis strokes, 8 px tile. */
export function hatchImage(ground = '#D5DAD6', stroke = '#7D877F', size = 8) {
  const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [gr, gg, gb] = parse(ground), [sr, sg, sb] = parse(stroke);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const onLine = ((x + y) % size) < 1.5;
    const o = (y * size + x) * 4;
    data[o] = onLine ? sr : gr; data[o + 1] = onLine ? sg : gg; data[o + 2] = onLine ? sb : gb; data[o + 3] = 255;
  }
  return {width: size, height: size, data};
}

/**
 * Per-area model for the layer, the legend, the labels and the ranking colours. Every frame of the index
 * (optionally one province) is listed; `noDataIds` (optional) marks frames the source does not cover.
 */
export function buildAreaModel(rows, index, {province = '', noDataIds = null} = {}) {
  const summaries = summarizeAreas(rows, index, {includeEmpty: true, province});
  const classes = buildDensityClasses(summaries.map(s => s.density));
  const areas = summaries.map(s => {
    const c = noDataIds?.has(s.id) ? classify(null, classes, 'no_data') : classify(s.count ? s.density : 0, classes);
    return {id: s.id, name: s.name, nameEn: s.nameEn, district: s.district, districtName: s.districtName, province: s.province,
      count: s.count, density: s.density, km2: s.km2, quality: s.quality, state: c.state, fill: c.fill, ink: c.ink, outline: c.outline || null,
      label: s.label, bbox: s.bbox};
  });
  return {areas, byId: new Map(areas.map(a => [a.id, a])), classes, zeroCount: areas.filter(a => a.state === 'measured_zero').length, noDataCount: areas.filter(a => a.state === 'no_data').length};
}

export function installAreaLayers(map, {areas, districts}) {
  const beforeId = firstLineLayerId(map);
  const ground = cssVar('--data-no-data', '#D5DAD6'), emphasis = cssVar('--border-emphasis', '#7D877F');
  if (!map.hasImage(HATCH)) map.addImage(HATCH, hatchImage(ground, emphasis));
  map.addSource(SOURCE, {type: 'geojson', data: areas, promoteId: 'id',
    attribution: 'ขอบเขตปกครอง: <a href="https://landometer.com/v3/citymeter" target="_blank" rel="noopener">CityMETER</a>'});
  map.addSource(DISTRICTS, {type: 'geojson', data: districts, promoteId: 'id'});
  const fs = (key, on, off = 0) => ['case', ['boolean', ['feature-state', key], false], on, off];
  // Below AREA_MIN_ZOOM only the frames of the selected จังหวัด (feature-state `province`) are drawn.
  const gate = expr => ['step', ['zoom'], fs('province', expr), AREA_MIN_ZOOM, expr];
  // Click target only (never drawn): every loaded frame from PROVINCE_VIEW_MIN_ZOOM; below AREA_MIN_ZOOM the
  // app accepts a hit only inside the selected จังหวัด (js/app.js#onMapClick).
  map.addLayer({id: AREA_LAYERS.hit, type: 'fill', source: SOURCE, minzoom: PROVINCE_VIEW_MIN_ZOOM,
    paint: {'fill-color': '#000000', 'fill-opacity': 0}}, beforeId);
  map.addLayer({id: AREA_LAYERS.fill, type: 'fill', source: SOURCE, minzoom: PROVINCE_VIEW_MIN_ZOOM, maxzoom: FILL_MAX_ZOOM,
    paint: {'fill-color': ['coalesce', ['feature-state', 'fill'], '#000000'], 'fill-opacity': gate(fs('filled', 1)), 'fill-antialias': true}}, beforeId);
  map.addLayer({id: AREA_LAYERS.hatch, type: 'fill', source: SOURCE, minzoom: PROVINCE_VIEW_MIN_ZOOM, maxzoom: FILL_MAX_ZOOM,
    paint: {'fill-pattern': HATCH, 'fill-opacity': gate(fs('nodata', 1))}}, beforeId);
  map.addLayer({id: AREA_LAYERS.zero, type: 'line', source: SOURCE, minzoom: PROVINCE_VIEW_MIN_ZOOM, maxzoom: FILL_MAX_ZOOM,
    paint: {'line-color': cssVar('--data-zero-outline', '#7D877F'), 'line-width': 2, 'line-opacity': gate(fs('zero', 1))}}, beforeId);
  map.addLayer({id: DISTRICT_LAYERS.outline, type: 'line', source: DISTRICTS, minzoom: 9.5,
    paint: {'line-color': cssVar('--border-emphasis', '#7D877F'), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.4],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0.5, 15, 0.7, 17, 0.35]}});
  map.addLayer({id: AREA_LAYERS.outline, type: 'line', source: SOURCE, minzoom: PROVINCE_VIEW_MIN_ZOOM,
    paint: {'line-color': ['case', ['boolean', ['feature-state', 'quiet'], false], cssVar('--border-default', '#C9D0CB'), cssVar('--border-emphasis', '#7D877F')],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1, 17, 1.4], 'line-dasharray': [3, 2],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], PROVINCE_VIEW_MIN_ZOOM, fs('province', 0.25), AREA_MIN_ZOOM - 0.01, fs('province', 0.4), AREA_MIN_ZOOM, 0.4, 11, 0.85]}});
  map.addLayer({id: AREA_LAYERS.hover, type: 'line', source: SOURCE, minzoom: PROVINCE_VIEW_MIN_ZOOM,
    paint: {'line-color': cssVar('--map-selected-stroke', '#176B82'), 'line-width': 2, 'line-opacity': fs('hover', 0.7)}});
  map.addLayer({id: DISTRICT_LAYERS.selected, type: 'line', source: DISTRICTS,
    paint: {'line-color': cssVar('--map-selected-stroke', '#176B82'), 'line-width': 2.4, 'line-opacity': fs('selected', 1)}});
  map.addLayer({id: AREA_LAYERS.selected, type: 'line', source: SOURCE,
    paint: {'line-color': cssVar('--map-selected-stroke', '#176B82'), 'line-width': 3, 'line-opacity': fs('selected', 1)}});

  let current = null, lastDistrict = '', lastArgs = null;
  let ids = (areas.features || []).map(f => String(f.id ?? f.properties.id));
  let districtIds = (districts.features || []).map(f => String(f.id ?? f.properties.id));

  /** A province arrived: re-set both sources and re-apply the last state to every loaded frame. */
  function setFrames(nextAreas, nextDistricts) {
    map.getSource(SOURCE)?.setData(nextAreas);
    map.getSource(DISTRICTS)?.setData(nextDistricts);
    ids = (nextAreas.features || []).map(f => String(f.id ?? f.properties.id));
    districtIds = (nextDistricts.features || []).map(f => String(f.id ?? f.properties.id));
    lastDistrict = null;
    if (lastArgs) update(lastArgs);
  }

  /**
   * model = buildAreaModel(scopeRows…); focus + quiet: with a selected area or an
   * area focus only those frames keep their fill; the rest stay outline-only.
   * outlineFocus: draw the selection stroke around the focused frames (the top-three
   * focus) — off for a district, whose own outline already marks the selection.
   * provinceCode: the จังหวัด filter — its frames (the model then holds only them) are drawn at every zoom.
   */
  function update(args = {}) {
    const {model, selectedId = '', focusIds = [], outlineFocus = true, districtId = '', visible = true, provinceCode = ''} = args;
    if (!model) return current;
    lastArgs = args;
    current = model;
    const focus = new Set(selectedId ? [selectedId] : focusIds);
    const focusMode = focus.size > 0;
    const byId = model.byId;
    for (const id of ids) {
      const a = byId.get(id);
      const focused = !focusMode || focus.has(id);
      const filled = Boolean(a) && focused;
      map.setFeatureState({source: SOURCE, id}, {
        fill: a?.fill || null, filled: filled && (a.state === 'measured' || a.state === 'measured_zero'),
        zero: filled && a.state === 'measured_zero', nodata: filled && a.state === 'no_data',
        quiet: focusMode && !focused, selected: id === selectedId || (!selectedId && outlineFocus && focusIds.includes(id)),
        province: Boolean(provinceCode) && a?.province === provinceCode,
      });
    }
    if (lastDistrict !== districtId) {
      for (const id of districtIds) map.setFeatureState({source: DISTRICTS, id}, {selected: id === districtId});
      lastDistrict = districtId;
    }
    for (const id of [...Object.values(AREA_LAYERS), ...Object.values(DISTRICT_LAYERS)]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    return current;
  }

  function retheme() {
    const g = cssVar('--data-no-data', '#D5DAD6'), e = cssVar('--border-emphasis', '#7D877F');
    if (map.hasImage(HATCH)) map.updateImage(HATCH, hatchImage(g, e));
    if (map.getLayer(AREA_LAYERS.zero)) map.setPaintProperty(AREA_LAYERS.zero, 'line-color', cssVar('--data-zero-outline', '#7D877F'));
  }

  /** The loaded frame under a screen point (any zoom ≥ PROVINCE_VIEW_MIN_ZOOM), as its id, or ''. */
  function hitTest(point) {
    if (!map.getLayer(AREA_LAYERS.hit) || map.getLayoutProperty?.(AREA_LAYERS.hit, 'visibility') === 'none') return '';
    const f = map.queryRenderedFeatures([point.x, point.y], {layers: [AREA_LAYERS.hit]})[0];
    return f ? String(f.id ?? f.properties?.id) : '';
  }
  let hovered = '';
  /** Thin outline on the frame under the pointer ('' clears). */
  function hover(id = '') {
    if (id === hovered) return;
    if (hovered) map.setFeatureState({source: SOURCE, id: hovered}, {hover: false});
    hovered = id;
    if (hovered) map.setFeatureState({source: SOURCE, id: hovered}, {hover: true});
  }

  function dispose() {
    for (const id of [...Object.values(AREA_LAYERS), ...Object.values(DISTRICT_LAYERS)]) if (map.getLayer(id)) map.removeLayer(id);
    for (const s of [SOURCE, DISTRICTS]) if (map.getSource(s)) map.removeSource(s);
    if (map.hasImage(HATCH)) map.removeImage(HATCH);
  }

  return {update, setFrames, retheme, dispose, hitTest, hover, model: () => current, layerIds: AREA_LAYERS};
}

/**
 * HTML labels (ink chips: name + value badge), collision-managed against each
 * other and the map chrome. Used for แขวง/ตำบล (a bounded set: the focus, the
 * selection and the densest frames in view) and for the province frames.
 */
export function installAreaLabels(map, container, {onSelect, reservedBottom = () => 0, className = 'area-label', hostId = 'area-labels', hostLabel = 'พื้นที่บนแผนที่', minZoom = 0, maxZoom = Infinity, verb = 'กดเพื่อสำรวจ', detailZoomClass = true, maxLabels = 40} = {}) {
  const host = document.createElement('div');
  host.id = hostId;
  host.className = 'area-labels';
  host.setAttribute('aria-label', hostLabel);
  container.append(host);
  let labels = [], frame = 0;
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  function layout() {
    const width = container.clientWidth, height = container.clientHeight - reservedBottom();
    const panel = container.closest('.map-panel'), rect = container.getBoundingClientRect();
    const chrome = [...panel.querySelectorAll('.map-toolbar, .map-legend, .map-status, .map-aha, .maplibregl-ctrl-top-right')]
      .filter(e => e.offsetWidth && e.offsetHeight)
      .map(e => { const b = e.getBoundingClientRect(); return {left: b.left - rect.left - 4, right: b.right - rect.left + 4, top: b.top - rect.top - 4, bottom: b.bottom - rect.top + 4}; });
    const placed = [];
    const zoom = map.getZoom();
    if (detailZoomClass) panel.classList.toggle('is-detail-zoom', zoom >= FILL_MAX_ZOOM);
    const inWindow = zoom >= minZoom && zoom < maxZoom;
    let shown = 0;
    for (const e of labels) {
      const p = map.project(e.center);
      e.button.hidden = !(e.visible && inWindow && shown < maxLabels && p.x > 0 && p.x < width && p.y > 48 && p.y < height);
      if (e.button.hidden) continue;
      // A chip's size never changes after it is built: measure once (no forced layout on every frame of a move).
      if (!e.size) e.size = {w: e.button.offsetWidth, h: e.button.offsetHeight};
      const {w, h} = e.size;
      let position = null;
      for (const [dx, dy] of [[0, 0], [0, -26], [0, 26], [-36, 0], [36, 0]]) {
        const x = p.x + dx, y = p.y + dy;
        const box = {left: x - w / 2 - 4, right: x + w / 2 + 4, top: y - h / 2 - 3, bottom: y + h / 2 + 3};
        if (box.left < 4 || box.right > width - 4 || box.top < 48 || box.bottom > height || placed.some(b => overlaps(box, b)) || chrome.some(b => overlaps(box, b))) continue;
        position = {x, y, box};
        break;
      }
      e.button.hidden = !position;
      if (position) { e.button.style.left = `${position.x}px`; e.button.style.top = `${position.y}px`; placed.push(position.box); shown++; }
    }
  }
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };

  /** items: [{id, name, value, title, state, quiet, selected, swatch?, center:[lng,lat]}] in priority order. */
  function update(items, {visible = true} = {}) {
    host.replaceChildren();
    labels = [];
    for (const a of items) {
      if (!Array.isArray(a.center)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `area-label ${className} is-${a.state || 'measured'}${a.selected ? ' is-selected' : ''}${a.quiet ? ' is-quiet' : ''}`;
      button.innerHTML = '<span class="label-name"></span><span class="label-count data-number" aria-hidden="true"></span>';
      button.querySelector('.label-name').textContent = a.name;
      button.querySelector('.label-count').textContent = a.value;
      button.setAttribute('aria-label', `${a.title} ${verb}`);
      button.title = a.title;
      button.setAttribute('aria-pressed', String(Boolean(a.selected)));
      if (a.swatch) button.style.setProperty('--label-swatch', a.swatch);
      button.onclick = () => onSelect?.(a.id);
      host.append(button);
      labels.push({button, center: a.center, visible});
    }
    schedule();
  }
  map.on('move', schedule);
  map.on('resize', schedule);
  return {update, layout: schedule, dispose() { cancelAnimationFrame(frame); map.off('move', schedule); map.off('resize', schedule); host.remove(); }};
}
