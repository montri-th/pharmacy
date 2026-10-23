/**
 * CityMETER · Pharmacy — application orchestration.
 *
 * One committed selection drives everything. Three row scopes, named the same way everywhere:
 *   scopeRows — rows after the search/type/quality/province/chain filters and the counting unit, BEFORE any
 *               area selection or area focus: the comparison base for the Aha, the choropleth, the charts
 *               and every rank.
 *   baseRows  — scopeRows narrowed by the selected เขต/อำเภอ or แขวง/ตำบล (if any).
 *   rows      — baseRows narrowed by the area focus (if any): pins with detail, counters, the table.
 *
 * Counting unit (DATA_METHOD.md §3): by default a row is a licensed premises (ขย1 register: one licence =
 * one shop); `count=all` counts every dataset row (“รายการ”, may repeat a storefront). js/model.js#unitWords
 * gives the words everywhere.
 *
 * Area focus has three modes (state.focusAreaIds / state.autoFocus):
 *   auto     — default: up to three densest แขวง/ตำบล of the leading province (≥ 30 rows each) are the focus,
 *              so the first screen is one coherent 3D city scene.
 *   explicit — ?areas=a,b,c chosen by the user.
 *   none     — ?areas=all: every area filled, nothing quiet.
 *
 * National scale: the area index (data/area-index.json) has every subdistrict without geometry, so ranks,
 * panels, charts and camera fits work at once; outlines arrive per province (js/frames.js) — the provinces
 * the selection needs, and the provinces under the map once it is zoomed in to subdistrict level.
 *
 * Focus + quiet on the map: data fills, cue pins and rounded focus massing only for the focused part;
 * everything else stays visible but quiet (outline-only areas, grey dots, pale city massing). Below
 * PROVINCE_FILL_MAX_ZOOM the province frames carry the reading (counts) — except with a จังหวัด filter:
 * that province shows its own แขวง/ตำบล at every zoom (province view) and is fitted whole.
 *
 * Buildings: the published points of the scope are joined to the focus-tier OSM footprints the map draws
 * (js/building-join.js, “จุดตกในอาคาร”). A building is a click target: one point opens the store, several open
 * the building panel; the opened building (or the building of the open store) is drawn in the data colour.
 *
 * Map clicks, in order: focus pin → focus building → below PROVINCE_FILL_MAX_ZOOM a แขวง/ตำบล of the selected
 * จังหวัด, else a province → แขวง/ตำบล (`area-hit`, every zoom from AREA_MIN_ZOOM). Quiet context dots are
 * never targets.
 * Panel modes: overview | district | area | building | store (with a back stack).
 * URL state: filters, district, area, areas, view, store, view3d.
 */
import {provinces as provinceList, provinceByCode, provinceCodeFrom, setProvinces, decodeDataset, filterRows, summarize, hasPoint, unitWords, productionLink, EVIDENCE_SHORT} from './model.js';
import {buildAreaIndex, areaWord, districtWord, areaLocator, recordBounds} from './areas.js';
import {summarizeAreaInsight, filterAreaRows, MIN_AREA_ROWS} from './area-insight.js';
import {renderInsightChart} from './charts.js';
import {loadMapLibrary} from './vendors.js';
import {installPharmacyPins} from './pins.js';
import {installAreaLayers, installAreaLabels, buildAreaModel, AREA_MIN_ZOOM, PROVINCE_VIEW_MIN_ZOOM} from './map-layers.js';
import {installProvinceLayers, buildProvinceModel, PROVINCE_FILL_MAX_ZOOM, PROVINCE_LABEL_MAX_ZOOM} from './provinces.js';
import {createFrameStore, provinceLocator} from './frames.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildStoreDetail, buildBuildingProfile, listOrder} from './profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderBuilding, renderStore, renderFilterChips, esc, num, dens} from './panel.js';
import {joinRows, containsPoint} from './building-join.js';
import {buildMapStyle, basemapPalette, TILEJSON_URL, MASSING_BEFORE} from './map-style.js';
import {installMassing, outerRings} from './massing.js';
import {presetFor, applyPreset, fitPitched, framePoint} from './camera.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText} from './breadcrumb.js';
import {cueMarkup} from './cues.js';

const $ = id => document.getElementById(id);
const FIELDS = ['search', 'group', 'quality', 'province', 'brand', 'count'];
/** Filters that remove rows from an area (the counting unit and the province do not). */
const NARROWING = ['search', 'group', 'quality', 'brand'];
const BANGKOK = {center: [100.535, 13.745], zoom: 11.5};
/** Release tag of this module (index.html import map) — also versions the province frame files. */
const RELEASE = (() => { try { return new URL(import.meta.url).searchParams.get('v') || ''; } catch { return ''; } })();
const THEME_KEY = 'citymeter-pharmacy-theme';
const COLLATOR = new Intl.Collator('th');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobilePortrait = () => matchMedia('(max-width: 760px) and (orientation: portrait)').matches;

const state = {
  data: null, index: null, provincesGeo: null, frames: null,
  scopeRows: [], baseRows: [], rows: [], insight: null,
  view: 'density', page: 0,
  focusAreaIds: [], autoFocus: true, focusIds: [], selectedArea: '', selectedDistrict: '', selectedId: '',
  panel: {mode: 'overview', id: ''}, history: [],
  map: null, loaded: false, mapTheme: '', popup: null, initialCameraDone: false, tileTemplate: '',
  view3d: true, showAreas: true,
  pins: null, massing: null, areaLayers: null, labels: null, areaModel: null,
  provinceLayers: null, provinceLabels: null, provinceModel: null, rowById: new Map(),
  scopeKey: '', join: null, buildingSel: null, labelView: new Map(), renderedSig: '', locateArea: null, locateProvince: null,
  blueBuildings: false, lastPreset: '',
};

/* ---------- helpers ---------- */
const values = () => Object.fromEntries(FIELDS.map(k => [k, $(k).value]));
const unit = () => unitWords($('count').value === 'all' ? 'all' : 'licensed');
const rowById = id => state.rowById.get(id) || null;
const areaById = id => state.index.byId.get(id) || null;
const districtById = id => state.index.districtById.get(id) || null;
const provinceRecord = code => state.index.provinceById.get(code) || null;
// Null-safe: an embedding page or extension may detach the tray while map callbacks are still queued.
const bottomSpace = () => ($('insights')?.getBoundingClientRect().height ?? 0) + 12;
/** Area/province labels also keep clear of the map attribution (its live height is --attrib-height on .map-panel). */
const labelBottomSpace = () => { const panel = document.querySelector('.map-panel'); return bottomSpace() + (panel ? parseFloat(getComputedStyle(panel).getPropertyValue('--attrib-height')) || 0 : 0); };
const activeFilterCount = f => FIELDS.filter(k => f[k]).length;
const overviewPanel = () => ({mode: 'overview', id: ''});
const sheetOffset = () => (mobilePortrait() ? [0, -Math.round(window.innerHeight * 0.2)] : [0, 0]);
const announce = text => { $('announcement').textContent = text; };
const theme = () => document.documentElement.dataset.theme;
const focusMode = () => (state.focusAreaIds.length ? 'explicit' : state.focusIds.length ? 'auto' : 'none');
const sheetOpen = () => mobilePortrait() && $('panel').classList.contains('is-open');
const animate = () => !reduced();
const cssVar = (name, fallback = '') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
/** The building being looked at (building mode): {key, kind, footprint, rows, height}. */
const currentBuilding = () => (state.panel.mode === 'building' ? state.buildingSel : null);
const cameraPreset = () => presetFor({view3d: state.view3d, mode: ['overview', 'district'].includes(state.panel.mode) ? 'overview' : 'detail'});

function saveURL() {
  const f = values(), p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (state.selectedDistrict) p.set('district', state.selectedDistrict);
  if (state.selectedArea) p.set('area', state.selectedArea);
  if (state.focusAreaIds.length) p.set('areas', state.focusAreaIds.join(','));
  else if (!state.autoFocus) p.set('areas', 'all');
  if (state.view !== 'density') p.set('view', state.view);
  if (state.panel.mode === 'store' && state.panel.id) p.set('store', state.panel.id);
  if (!state.view3d) p.set('view3d', '0');
  history.replaceState(null, '', location.pathname + (p.size ? '?' + p : ''));
}

/* ---------- theme ---------- */
function applyTheme() {
  const value = $('theme').value;
  const next = value === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, value); } catch {}
  if (state.map && next !== state.mapTheme) {
    state.loaded = false;
    disposeSpatial();
    state.mapTheme = next;
    state.map.setStyle(buildMapStyle(next), {diff: false});
  }
  if (state.data) drawChart();
}

function disposeSpatial() {
  for (const k of ['massing', 'pins']) { try { state[k]?.dispose(); } catch (e) { console.warn('dispose', k, e); } state[k] = null; }
  state.areaLayers = null; state.provinceLayers = null; state.join = null; refreshJoin.key = '';
}

/* ---------- selection ---------- */
function update({fit = false} = {}) {
  const f = values();
  // The scope only changes with the filters: a selection reuses it (and the pins keep their context).
  const scopeKey = JSON.stringify(f);
  if (scopeKey !== state.scopeKey) { state.scopeRows = filterRows(state.data.rows, f); state.scopeKey = scopeKey; }
  const area = state.selectedArea ? areaById(state.selectedArea) : null;
  const district = !area && state.selectedDistrict ? districtById(state.selectedDistrict) : null;
  state.baseRows = area ? state.scopeRows.filter(r => r.area === area.id) : district ? state.scopeRows.filter(r => r.district === district.id) : state.scopeRows;
  state.insight = summarizeAreaInsight(district ? state.baseRows : state.scopeRows, state.index);
  state.focusIds = state.focusAreaIds.length ? state.focusAreaIds : (state.autoFocus && !area && !district ? state.insight.areaIds : []);
  state.rows = state.focusIds.length ? filterAreaRows(state.baseRows, new Set(state.focusIds)) : state.baseRows;
  state.page = 0;
  if (update.modelScope !== state.scopeRows || update.modelProvince !== f.province) {
    state.areaModel = buildAreaModel(state.scopeRows, state.index, {province: f.province});
    update.modelScope = state.scopeRows; update.modelProvince = f.province;
  }

  // Keep the panel honest: drop a store or building that left the filtered scope.
  const fallback = () => (area ? {mode: 'area', id: area.id} : district ? {mode: 'district', id: district.id} : overviewPanel());
  if (state.panel.mode === 'store' && !state.scopeRows.some(r => r.id === state.panel.id)) { state.panel = fallback(); state.history = []; }
  if (state.panel.mode === 'building') {
    // The building keeps its own footprint: its rows follow the filters; none left → back to the area.
    const b = state.buildingSel;
    const rows = b ? state.scopeRows.filter(r => hasPoint(r) && containsPoint(b.footprint, [r.longitude, r.latitude])) : [];
    if (rows.length) state.buildingSel = {...b, rows};
    else { state.panel = fallback(); state.history = []; state.buildingSel = null; }
  }
  if (state.panel.mode === 'area' && !area) state.panel = overviewPanel();
  if (state.panel.mode === 'district' && !district) state.panel = area ? {mode: 'area', id: area.id} : overviewPanel();
  if (state.panel.mode === 'overview' && (area || district)) state.panel = fallback();
  if (state.panel.mode !== 'store') { state.selectedId = ''; state.pins?.select(''); state.popup?.remove(); state.popup = null; }
  else state.selectedId = state.panel.id;
  ensureFrames();

  const s = summarize(state.rows);
  $('filter-count').textContent = activeFilterCount(f) ? String(activeFilterCount(f)) : '';
  $('filter-chips').innerHTML = renderFilterChips(f, {
    group: Object.fromEntries(state.data.groups.map(g => [g.id, g.th])),
    province: Object.fromEntries(provinceList().map(p => [p.code, p.th])), brand: Object.fromEntries(state.data.brands.map(b => [b.id, b.name]))});
  renderPanel(s);
  renderLegend();
  if (state.loaded) {
    updatePins();
    updateSpatialLayers();
    if (fit) fitMap();
    else if (state.lastPreset && cameraPreset() !== state.lastPreset) applyPreset(state.map, cameraPreset(), {animate: animate()});
    state.lastPreset = cameraPreset();
  }
  drawChart();
  syncList();
  saveURL();
  announce(`พบ ${num(s.count)} ${unit().one}`);
}

/** Rows with full detail on the map, in the counter and in the table: the open building's rows, else the focused rows. */
function detailRows() {
  const b = currentBuilding();
  return b ? b.rows : state.rows;
}

/** Counter + table follow the rows that carry detail. */
function syncList() {
  const rows = detailRows(), b = currentBuilding(), u = unit();
  const what = u.mode === 'all' ? 'รายการร้านยา' : 'ร้านยา';
  $('result-count').textContent = num(rows.length);
  $('results-title').textContent = b ? `${what}ที่จุดตกในอาคารนี้` : `${what}ตามตัวกรอง`;
  if (syncList.last !== rows) state.page = 0;
  syncList.last = rows;
  renderTable();
}

function updatePins() {
  if (!state.pins) return;
  const focus = detailRows();
  const selected = state.selectedId ? rowById(state.selectedId) : null;
  const ids = new Set(focus.map(r => r.id));
  const list = selected && !ids.has(selected.id) ? [...focus, selected] : focus;
  // Context = the whole scope (same array while the filters are unchanged → not re-sent); focus symbols cover their own dot.
  state.pins.update(list, {context: state.scopeRows});
  if (state.selectedId) state.pins.select(state.selectedId);
}

/* ---------- province frames on demand ---------- */
/** Provinces the current selection needs outlines for (fills, massing regions, hit targets). */
function wantedProvinces() {
  const codes = new Set();
  const f = $('province').value;
  if (f) codes.add(f);
  const area = state.selectedArea && areaById(state.selectedArea);
  if (area) codes.add(area.province);
  const district = state.selectedDistrict && districtById(state.selectedDistrict);
  if (district) codes.add(district.province);
  for (const id of state.focusIds) { const a = areaById(id); if (a) codes.add(a.province); }
  if (state.panel.mode === 'store') { const r = rowById(state.panel.id); if (r?.province) codes.add(r.province); }
  return [...codes];
}
function ensureFrames() { state.frames?.ensureMany(wantedProvinces()); }

/** Once the map shows subdistricts, load the provinces under it (nearest the centre first, bounded). */
function ensureFramesInView() {
  const map = state.map;
  if (!map || !state.frames || !state.provincesGeo?.features?.length || map.getZoom() < AREA_MIN_ZOOM - 0.5) return;
  state.locateProvince ||= provinceLocator(state.provincesGeo);
  const el = map.getContainer(), w = el.clientWidth, h = el.clientHeight;
  const found = new Map();
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
    const sx = ((i + 0.5) / 5) * w, sy = ((j + 0.5) / 4) * h;
    const code = state.locateProvince(map.unproject([sx, sy]).toArray());
    if (!code) continue;
    const d = Math.hypot(sx - w / 2, sy - h / 2);
    if (!found.has(code) || d < found.get(code)) found.set(code, d);
  }
  state.frames.ensureMany([...found].sort((a, b) => a[1] - b[1]).slice(0, 6).map(([code]) => code));
}

function onFramesLoaded() {
  state.locateArea = null;
  refreshLabelView.key = '';
  if (!state.loaded) return;
  state.areaLayers?.setFrames(state.frames.areas(), state.frames.districts());
  updateSpatialLayers();
  scheduleLabelView();
}

/* ---------- breadcrumb ---------- */
function renderCrumbs() {
  const {mode, id} = state.panel;
  let crumbs;
  if (mode === 'store' || mode === 'building') {
    const r = mode === 'store' ? rowById(id) : currentBuilding()?.rows[0];
    crumbs = buildBreadcrumb({area: r?.area ? areaById(r.area) : null, district: !r?.area && r?.district ? districtById(r.district) : null, province: r?.province || ''});
  } else {
    crumbs = buildBreadcrumb({province: $('province').value, area: state.selectedArea ? areaById(state.selectedArea) : null, district: state.selectedDistrict ? districtById(state.selectedDistrict) : null});
  }
  $('crumbs').innerHTML = renderBreadcrumb(crumbs);
  const title = mode === 'store' ? `${rowById(id)?.name || ''} · ` : mode === 'building' ? 'อาคาร · ' : '';
  document.title = `${title}${breadcrumbText(crumbs)} · Pharmacy · CityMETER`;
  return crumbs;
}

/* ---------- panel ---------- */
const densityClassOf = a => state.areaModel?.byId.get(a.id)?.fill || 'var(--scale-count-3)';

function panelCtx() {
  const f = values();
  return {meta: state.data.meta || {}, sources: state.data.sources || [], unit: unit(), index: state.index, filtered: NARROWING.some(k => f[k])};
}

/** Area of the comparison base: the filtered province, or the whole country (production areaSqm). */
function scopeArea(province) {
  if (province) return {km2: provinceRecord(province)?.km2 || null};
  return {km2: state.index.provinces.reduce((s, p) => s + (p.km2 || 0), 0) || null};
}

/** Rows for the province frames: current filters WITHOUT the province filter, so every frame keeps its own count. */
function provinceScopeRows() {
  const f = {...values(), province: ''}, key = JSON.stringify(f);
  if (key !== provinceScopeRows.key) { provinceScopeRows.key = key; provinceScopeRows.rows = filterRows(state.data.rows, f); }
  return provinceScopeRows.rows;
}
function provinceSummaries() {
  try {
    const list = state.provinceModel?.provinces || (state.provincesGeo?.features?.length ? buildProvinceModel(provinceScopeRows(), state.provincesGeo, {unit: unit().one}).provinces : []);
    return list.filter(p => p.count > 0).sort((a, b) => b.count - a.count || COLLATOR.compare(a.name, b.name));
  } catch { return []; }
}

function renderPanel(summary = summarize(state.rows)) {
  const view = $('panel-view');
  const {mode, id} = state.panel;
  renderCrumbs();
  const groups = state.data.groups, ctx = panelCtx();
  let html = '';
  if (mode === 'area') html = renderArea(buildAreaProfile(state.scopeRows, id, state.index, groups), ctx);
  else if (mode === 'district') html = renderDistrict(buildDistrictProfile(state.scopeRows, id, state.index, groups), densityClassOf, ctx);
  else if (mode === 'building') html = renderBuilding(buildBuildingProfile(currentBuilding(), state.index, groups), ctx);
  else if (mode === 'store') html = renderStore(buildStoreDetail(rowById(id), {scopeRows: state.scopeRows, allRows: state.data.rows, index: state.index, groups, building: storeBuilding(id)}), ctx);
  state.renderedSig = panelSpatialSig();
  if (!html) {
    const province = $('province').value;
    const overview = buildOverview(state.scopeRows, state.index, {province});
    const insight = focusMode() === 'explicit' ? summarizeAreaInsight(state.rows, state.index, {minRows: 1}) : state.insight;
    html = renderOverview({insight, summary, overview, focusMode: focusMode(), classOf: densityClassOf, provinces: province ? [] : provinceSummaries(), scope: scopeArea(province), province, ctx});
    renderMapAha(insight);
  } else {
    $('map-aha').hidden = true;
  }
  view.innerHTML = html;
  view.dataset.mode = mode;
  const key = `${mode}:${id}:${$('province').value}`;
  if (key !== renderPanel.lastKey) $('panel').scrollTop = 0;
  renderPanel.lastKey = key;
}

function renderMapAha(insight) {
  const el = $('map-aha'), u = unit();
  if (!insight.areas.length) { el.hidden = true; return; }
  const mode = focusMode();
  el.hidden = $('panel').classList.contains('is-open');
  const crumb = `<p class="map-aha-crumb">${esc(breadcrumbText(buildBreadcrumb({province: insight.home || $('province').value})))}</p>`;
  const names = insight.areas.map(a => esc(a.name)).join(' · ');
  el.innerHTML = mode === 'explicit'
    ? `<div>${crumb}<h2>กำลังสำรวจ ${num(insight.areas.length)} พื้นที่</h2><p>${num(insight.count)} ${esc(u.one)}</p></div><button type="button" class="btn" data-action="clear-focus">ดูทุกพื้นที่</button>`
    : `<div>${crumb}<h2>${insight.mode === 'density' ? `<span class="nowrap">${dens(insight.density)} ${esc(u.density)}</span> ใน ${num(insight.areas.length)} พื้นที่ที่แน่นที่สุด` : `${num(Math.round(insight.share))}% ของ${esc(u.one)}อยู่ใน ${num(insight.areas.length)} พื้นที่`}</h2><p>${names}</p></div>${mode === 'auto'
      ? '<button type="button" class="btn" data-action="clear-focus">ดูทุกพื้นที่</button>'
      : '<button type="button" class="btn primary" data-action="explore-top">โฟกัส</button>'}`;
}

function pushHistory() {
  state.history.push({...state.panel, area: state.selectedArea, district: state.selectedDistrict, building: state.buildingSel, province: $('province').value});
  if (state.history.length > 20) state.history.shift();
}

function goBack() {
  const previous = state.history.pop();
  if (!previous) { state.selectedArea = ''; state.selectedDistrict = ''; state.panel = overviewPanel(); update({fit: true}); return; }
  const fit = previous.area !== state.selectedArea || previous.district !== state.selectedDistrict || previous.province !== $('province').value;
  if (previous.province !== $('province').value) $('province').value = previous.province || '';
  state.selectedArea = previous.area || ''; state.selectedDistrict = previous.district || '';
  if (previous.mode === 'building') state.buildingSel = previous.building || null;
  state.panel = {mode: previous.mode, id: previous.id};
  update({fit});
}

/** A selection in another province moves the จังหวัด filter with it (the scope stays one coherent province). */
function alignProvince(code) {
  const current = $('province').value;
  if (current && code && current !== code) $('province').value = code;
}

function selectArea(id, {fromMap = false} = {}) {
  const area = areaById(id);
  if (!area) return;
  if (state.panel.mode !== 'area' || state.panel.id !== id) pushHistory();
  alignProvince(area.province);
  state.selectedArea = id; state.selectedDistrict = '';
  state.focusAreaIds = [];
  state.panel = {mode: 'area', id};
  update();
  if (!fromMap) openMobilePanel();
  if (state.loaded) fitRecord(area, {maxZoom: 17.5});
}

function selectDistrict(id) {
  const d = districtById(id);
  if (!d) return;
  if (state.panel.mode !== 'district' || state.panel.id !== id) pushHistory();
  alignProvince(d.province);
  state.selectedDistrict = id; state.selectedArea = '';
  state.focusAreaIds = [];
  state.panel = {mode: 'district', id};
  update();
  openMobilePanel();
  if (state.loaded) fitRecord(d, {maxZoom: 16});
}

function storePopup(r) {
  const wrap = document.createElement('div'), h = document.createElement('h3'), p = document.createElement('p');
  h.textContent = r.name || 'ไม่มีชื่อในแหล่งข้อมูล';
  p.textContent = [state.data.groups[r.group]?.th, r.brand?.name, r.quality ? 'ร้านยาคุณภาพ' : ''].filter(Boolean).join(' · ');
  wrap.append(h, p);
  return wrap;
}

function selectStore(id, {fly = true, showPopup = false, fromPin = false} = {}) {
  const r = rowById(id);
  if (!r) return;
  if (state.panel.mode !== 'store') pushHistory();
  // A row from another source (listed under "รายการอื่นของเครือนี้") is only in scope when every row counts.
  const needAll = !r.licensed && $('count').value !== 'all';
  if (needAll) $('count').value = 'all';
  state.panel = {mode: 'store', id};
  state.selectedId = id;
  if (needAll) { refreshOptionCounts(); update(); }
  else {
    ensureFrames();
    renderPanel();
    syncList();
    saveURL();
    if (state.loaded) { updatePins(); updateSpatialLayers(); state.pins?.select(id); }
  }
  state.popup?.remove(); state.popup = null;
  if (state.loaded) {
    if (hasPoint(r)) {
      if (fly || cameraPreset() !== state.lastPreset) framePoint(state.map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, offset: sheetOffset(), animate: animate()});
      if (showPopup && !mobilePortrait()) {
        state.popup = new maplibregl.Popup({maxWidth: '280px', offset: 14, closeButton: true}).setLngLat([r.longitude, r.latitude]).setDOMContent(storePopup(r)).addTo(state.map);
      }
    } else if (fly) {
      // No published point: frame the area (or district) the row is counted in.
      const record = r.area ? areaById(r.area) : r.district ? districtById(r.district) : null;
      if (record) fitRecord(record, {maxZoom: 16});
    }
    state.lastPreset = cameraPreset();
  }
  if (!fromPin || mobilePortrait()) openMobilePanel();
  announce(`เลือก ${r.name}`);
}

/**
 * A building the map draws, opened from a click (or the store panel): the rows whose published points fall
 * inside it. The camera stays (the building is where the user is looking).
 */
function selectBuilding(key) {
  const b = state.join?.buildings.get(key);
  const rows = state.join?.byBuilding.get(key) || [];
  if (!b || !rows.length) return;
  if (state.panel.mode !== 'building' || state.panel.id !== key) pushHistory();
  state.buildingSel = {key, kind: b.kind, footprint: b, rows, height: b.height};
  state.panel = {mode: 'building', id: key};
  state.selectedId = '';
  state.pins?.select('');
  state.popup?.remove(); state.popup = null;
  renderPanel();
  syncList();
  saveURL();
  if (state.loaded) { updatePins(); updateSpatialLayers(); }
  openMobilePanel();
  announce(`อาคารที่จุดของร้านตก ${num(rows.length)} ${unit().one}`);
}

/* ---------- spatial join (published points × drawn buildings) ---------- */

/** Join the scope's published points to the focus-tier OSM footprints on the map. Recomputed only when either side changes. */
function refreshJoin() {
  if (!state.loaded) return false;
  const osm = state.massing?.buildings() || [];
  const key = `${state.massing?.version ?? 0}|${state.scopeKey}`;
  if (key === refreshJoin.key && state.join) return false;
  refreshJoin.key = key;
  const footprints = osm.map(b => ({key: `osm:${b.id}`, kind: 'osm', ref: b.id, outer: b.outer, holes: b.holes, bbox: b.bbox, height: b.height}));
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const b of footprints) for (const [x, y] of b.outer) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const rows = footprints.length ? state.scopeRows.filter(r => hasPoint(r) && r.longitude >= w && r.longitude <= e && r.latitude >= s && r.latitude <= n) : [];
  state.join = joinRows(footprints, rows);
  return true;
}

/** Store panel: the drawn building its published point falls in (and how many other rows share it). */
function storeBuilding(id) {
  const key = state.join?.byRow.get(id);
  if (!key) return null;
  return {key, others: Math.max(0, (state.join.byBuilding.get(key) || []).length - 1)};
}

/** What the open panel shows from the join — re-render only when this changes. */
function panelSpatialSig() {
  if (state.panel.mode !== 'store') return '';
  const b = storeBuilding(state.panel.id);
  return b ? `${b.key}|${b.others}` : '';
}

/** OSM buildings drawn in the data colour: the open building, or the building the open store's point falls in. */
function highlightIds() {
  const j = state.join;
  if (!j) return [];
  const b = currentBuilding();
  if (b) return b.footprint?.ref != null ? [b.footprint.ref] : [];
  if (state.panel.mode === 'store') {
    const key = j.byRow.get(state.panel.id), fp = key ? j.buildings.get(key) : null;
    return fp ? [fp.ref] : [];
  }
  return [];
}

function applyJoin() {
  refreshJoin();
  const n = state.massing?.setHighlight(highlightIds()) || 0;
  state.blueBuildings = n > 0;
  document.querySelector('.map-panel')?.classList.toggle('has-open-building', state.blueBuildings);
  const label = $('legend-building-label');
  if (label) label.textContent = currentBuilding() ? 'อาคารที่เปิดอยู่' : 'อาคารที่จุดของร้านตก';
  if (state.panel.mode === 'store' && panelSpatialSig() !== state.renderedSig) renderPanel();
}

/** Focus the top areas of the current scope (auto mode; URL stays clean). */
function exploreTop() { state.autoFocus = true; state.focusAreaIds = []; update({fit: true}); closeMobilePanel(); }
/** Show every area with detail (no quiet context) — ?areas=all. */
function clearFocus() { state.autoFocus = false; state.focusAreaIds = []; update({fit: true}); }

function selectProvince(code) {
  const c = provinceCodeFrom(code);
  if (!c) return;
  $('province').value = c;
  state.selectedArea = ''; state.selectedDistrict = '';
  state.focusAreaIds = [];
  state.panel = overviewPanel();
  state.history = [];
  update({fit: true});
  announce(`จังหวัด${provinceByCode(c)?.th || c}`);
}

function resetToOverview({fit = true} = {}) {
  state.focusAreaIds = [];
  state.selectedArea = ''; state.selectedDistrict = '';
  state.panel = overviewPanel();
  state.history = [];
  update({fit});
}

function clearFilter(key) {
  if (key === 'all') { $('filters').reset(); refreshOptionCounts(); resetToOverview(); return; }
  if (FIELDS.includes(key)) $(key).value = '';
  if (key === 'count') refreshOptionCounts();
  update({fit: key !== 'search'});
}

function filterBrand(id) {
  if (![...$('brand').options].some(o => o.value === id)) return;
  $('brand').value = id;
  state.selectedArea = ''; state.selectedDistrict = '';
  state.focusAreaIds = [];
  state.panel = overviewPanel();
  state.history = [];
  update({fit: true});
  $('panel').scrollTop = 0;
}

function setCount(value) {
  $('count').value = value === 'all' ? 'all' : '';
  refreshOptionCounts();
  state.focusAreaIds = [];
  state.history = [];
  state.panel = state.selectedArea ? {mode: 'area', id: state.selectedArea} : state.selectedDistrict ? {mode: 'district', id: state.selectedDistrict} : overviewPanel();
  update({fit: true});
  announce(value === 'all' ? 'นับทุกรายการ (อาจซ้ำ)' : 'นับร้านที่มีใบอนุญาต ขย1');
}

function onPanelAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const {action, id, value} = target.dataset;
  switch (action) {
    case 'select-area': selectArea(id); break;
    case 'select-district': selectDistrict(id); break;
    case 'select-store': selectStore(id); break;
    case 'select-building': selectBuilding(id); break;
    case 'select-province': selectProvince(id); break;
    case 'filter-brand': filterBrand(value); break;
    case 'set-count': setCount(value); break;
    case 'back': goBack(); break;
    case 'explore-top': exploreTop(); break;
    case 'clear-focus': clearFocus(); break;
    // An empty selection under the filters: keep the filters, leave the area/district, fit to where they match.
    case 'leave-area': resetToOverview(); announce('แสดงทุกพื้นที่ตามตัวกรอง'); break;
    case 'open-charts': openInsights(true); closeMobilePanel(); break;
    case 'open-table': $('results').hidden = false; if (renderTable.stale) renderTable(); closeMobilePanel(); $('toggle-table').focus({preventScroll: true}); break;
    case 'clear-filter': clearFilter(id); break;
    case 'crumb-country': $('province').value = ''; resetToOverview(); break;
    case 'crumb-province': { const c = provinceCodeFrom(id); if (c) $('province').value = c; resetToOverview(); break; }
    case 'crumb-district': selectDistrict(id); break;
    case 'crumb-area': selectArea(id); break;
    case 'crumb-expand': { const ol = target.closest('.crumbs'); ol.classList.add('is-expanded'); target.setAttribute('aria-expanded', 'true'); ol.querySelector('.crumb:not(.crumb-more)')?.focus({preventScroll: true}); break; }
    default: break;
  }
}

/* ---------- legend ---------- */
/** Below subdistrict zoom (the province frames' window), whether or not a จังหวัด is selected. */
const belowAreaZoom = () => Boolean(state.provinceLayers) && (state.map?.getZoom?.() ?? 12) < PROVINCE_FILL_MAX_ZOOM;
/** The province frames carry the reading: below subdistrict zoom with no จังหวัด filter (else: province view). */
const provinceZoom = () => belowAreaZoom() && !$('province').value;
function renderLegend() {
  const u = unit(), atProvince = provinceZoom(), steps = $('legend-steps');
  const step = c => `<span class="legend-step"><i style="background:${c.fill}" aria-hidden="true"></i>${esc(c.label)}</span>`;
  if (atProvince) {
    const m = state.provinceModel;
    $('legend-title').textContent = `จังหวัด · จำนวน${u.one}`;
    steps.innerHTML = m?.classes.classes.length
      ? m.classes.classes.map(step).join('') + (m.zeroCount ? `<span class="legend-step" title="จังหวัดที่ไม่พบ${esc(u.one)}ตามตัวกรองนี้"><i class="legend-zero" style="background:${m.classes.zero.fill}" aria-hidden="true"></i>0</span>` : '')
      : `<span class="hint">ไม่มี${esc(u.one)}ในตัวกรองนี้</span>`;
    $('legend-areas').title = `${u.one}ต่อจังหวัด (ผลรวม ไม่ใช่ความหนาแน่น) · ${m?.classes.classCount || 0} ระดับเรขาคณิต 1–2–5 · สีเดียวกันทั้งสองธีม · ซูมเข้าเพื่อดูความหนาแน่นรายแขวง/ตำบล`;
  } else {
    const m = state.areaModel;
    $('legend-title').textContent = `แขวง/ตำบล · ${u.density}`;
    steps.innerHTML = (m?.classes.classes.length ? m.classes.classes.map(step).join('') : `<span class="hint">ไม่มี${esc(u.one)}ในตัวกรองนี้</span>`) +
      (m?.zeroCount ? `<span class="legend-step" title="${u.mode === 'all' ? 'ไม่มีรายการในชุดข้อมูลที่ระบุพื้นที่นี้' : 'ทะเบียน ขย1 ไม่มีร้านยาที่ระบุพื้นที่นี้'} ตามตัวกรองนี้ — ศูนย์ตามแหล่งข้อมูล"><i class="legend-zero" style="background:${m.classes.zero.fill}" aria-hidden="true"></i>0</span>` : '') +
      (m?.noDataCount ? '<span class="legend-step" title="แหล่งข้อมูลไม่ครอบคลุมพื้นที่นี้ ไม่ได้แปลว่าไม่มีร้านยา"><i class="legend-nodata" aria-hidden="true"></i>ไม่มีข้อมูล</span>' : '');
    $('legend-areas').title = `${u.densityLong}ของแขวง/ตำบล (${u.one} ÷ พื้นที่ตาม CityMETER) · ${m?.classes.classCount || 0} ระดับเรขาคณิต 1–2–5 แต่ละระดับห่างกันราว 3–5 เท่า [ล่าง, บน) ช่วงสุดท้ายปิดที่ค่าสูงสุด · สีเดียวกันทั้งสองธีม`;
  }
  $('legend-pin-label').textContent = `1 สัญลักษณ์ = 1 ${u.one}ที่มีพิกัด`;
  const panel = document.querySelector('.map-panel');
  panel.classList.toggle('is-3d', state.view3d);
  panel.classList.toggle('has-open-building', Boolean(state.blueBuildings));
  panel.classList.toggle('is-province-zoom', atProvince);
}

/* ---------- charts ---------- */
let chartDispose = null;
function drawChart() {
  if (!state.data) return;
  chartDispose?.(); chartDispose = null;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === state.view));
  $('chart').setAttribute('aria-labelledby', 'tab-' + state.view);
  const u = unit();
  const narrowed = state.selectedArea || state.selectedDistrict || state.focusIds.length;
  $('chart-scope').textContent = `${num(state.scopeRows.length)} ${u.one}ในตัวกรอง${narrowed ? ' · ทุกพื้นที่' : ''}`;
  if ($('insight-content').hidden) return;
  chartDispose = renderInsightChart({elementId: 'chart', view: state.view, rows: state.scopeRows, index: state.index, groups: state.data.groups, theme: theme(),
    selectedAreaId: state.selectedArea, unit: u, national: !$('province').value},
  selection => { if (selection.type === 'area') selectArea(selection.id, {fromMap: true}); });
}

function openInsights(open) {
  $('insight-content').hidden = !open;
  $('insights').classList.toggle('is-collapsed', !open);
  $('toggle-insights').setAttribute('aria-expanded', String(open));
  $('toggle-insights').textContent = open ? 'ย่อกราฟ' : 'เปิดกราฟ';
  requestAnimationFrame(() => { syncBottomPanel(); drawChart(); });
}

function syncBottomPanel() {
  const tray = $('insights');
  if (!tray) return;
  document.documentElement.style.setProperty('--bottom-panel-height', `${tray.getBoundingClientRect().height}px`);
  state.pins?.layout();
  state.labels?.layout();
}

/* ---------- table ---------- */
function areaCell(r) {
  const a = r.area ? areaById(r.area) : null;
  const province = provinceByCode(r.province)?.th || '';
  if (a) return `${esc(areaWord(a.province))}${esc(a.name)}<small>${esc(districtWord(a.province))}${esc(a.districtName)} · ${esc(province)}</small>`;
  const d = r.district ? districtById(r.district) : null;
  if (d) return `<span class="hint">ระบุได้ถึง${esc(districtWord(d.province))}</span><small>${esc(districtWord(d.province))}${esc(d.name)} · ${esc(province)}</small>`;
  return province ? `<span class="hint">ระบุได้ถึงจังหวัด</span><small>${esc(province)}</small>` : '<span class="hint">ไม่ระบุ</span>';
}

function renderTable() {
  if ($('results').hidden && renderTable.done) { renderTable.stale = true; return; }
  renderTable.done = true; renderTable.stale = false;
  const pageSize = 25, start = state.page * pageSize, u = unit();
  const list = detailRows();
  if (!renderTable.sorted || renderTable.source !== list) { renderTable.sorted = [...list].sort(listOrder); renderTable.source = list; }
  const rs = renderTable.sorted.slice(start, start + pageSize);
  $('result-rows').innerHTML = rs.map(r => `<tr>
      <td><button type="button" class="row-name brand-row" data-id="${esc(r.id)}">${cueMarkup(r.series, {className: 'row-cue'})}<span>${esc(r.name || 'ไม่มีชื่อในแหล่งข้อมูล')}</span></button><small>${esc(state.data.groups[r.group]?.th || '')}${u.mode === 'all' ? ` · ${esc(EVIDENCE_SHORT[r.evidence] || '')}` : ''}</small></td>
      <td>${r.brand ? esc(r.brand.name) : r.candidate ? `<span class="hint">ยังไม่ยืนยัน</span><small>ชื่อคล้าย ${esc(r.candidate.name)}</small>` : '<span class="hint">—</span>'}</td>
      <td>${r.licence ? `<span class="data-number nowrap">${esc(r.licence)}</span>` : '<span class="hint">ยังไม่จับคู่</span>'}</td>
      <td>${r.quality ? 'อยู่ในรายชื่อ' : '<span class="hint">ไม่พบในรายชื่อ</span>'}</td>
      <td>${areaCell(r)}</td>
      <td>${hasPoint(r) ? `<small class="data-number">${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}</small>` : '<span class="hint">ไม่มี</span>'}</td></tr>`).join('') ||
    `<tr><td colspan="6">ไม่พบ${esc(u.one)}ตามตัวกรอง</td></tr>`;
  $('page-label').textContent = list.length ? `${num(start + 1)}–${num(Math.min(start + pageSize, list.length))} / ${num(list.length)}` : `0 ${u.one}`;
  $('prev-page').disabled = state.page === 0;
  $('next-page').disabled = start + pageSize >= list.length;
  for (const b of $('result-rows').querySelectorAll('[data-id]')) b.onclick = () => { selectStore(b.dataset.id); $('panel').scrollTop = 0; };
}

/* ---------- map ---------- */
function cameraPadding() {
  const height = $('map').clientHeight, panel = $('insights').getBoundingClientRect().height;
  const edge = Math.min(48, Math.max(12, (height - panel) / 6));
  const mapTop = $('map').getBoundingClientRect().top, toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
  const aha = $('map-aha'), legend = $('map-legend');
  const chromeTop = !aha.hidden && aha.offsetHeight ? aha.getBoundingClientRect().top : legend.offsetHeight ? legend.getBoundingClientRect().top : null;
  let bottom = chromeTop != null ? height - (chromeTop - mapTop) + 12 : panel + edge;
  if (mobilePortrait() && $('panel').classList.contains('is-open')) bottom = Math.max(bottom, Math.round(window.innerHeight * 0.64) - (window.innerHeight - height - mapTop) + 8);
  return {top: Math.max(edge, toolbar.bottom - mapTop + 12), left: edge, right: edge, bottom: Math.min(height * 0.7, bottom)};
}

/** Padding for pitched fits: the legend is ignored (foreshortening already lifts the content). */
function pitchedPadding() {
  const mapTop = $('map').getBoundingClientRect().top, toolbar = document.querySelector('.map-toolbar').getBoundingClientRect();
  return {top: Math.round(toolbar.bottom - mapTop + 12), bottom: Math.round($('insights').getBoundingClientRect().height + 40), left: 24, right: 24};
}

function vertices(features) {
  const out = [];
  const walk = v => { if (typeof v[0] === 'number') out.push(v); else v.forEach(walk); };
  for (const f of features) walk(f.geometry.coordinates);
  return out;
}
/** Containment points of a record: its outline when loaded, else its bbox corners (the index has every bbox). */
function recordPoints(record) {
  if (record?.feature) return vertices([record.feature]);
  const b = recordBounds(record);
  return b ? [[b[0][0], b[0][1]], [b[1][0], b[0][1]], [b[1][0], b[1][1]], [b[0][0], b[1][1]]] : [];
}
/** LngLatBounds around [[w, s], [e, n]] boxes, or null. */
function boundsOf(boxes) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const b of boxes) if (b) { w = Math.min(w, b[0][0]); s = Math.min(s, b[0][1]); e = Math.max(e, b[1][0]); n = Math.max(n, b[1][1]); }
  return Number.isFinite(w) ? new maplibregl.LngLatBounds([w, s], [e, n]) : null;
}
const countryBox = () => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of state.index.provinces) if (p.bbox) { w = Math.min(w, p.bbox[0]); s = Math.min(s, p.bbox[1]); e = Math.max(e, p.bbox[2]); n = Math.max(n, p.bbox[3]); }
  return Number.isFinite(w) ? [[w, s], [e, n]] : [[97.34, 5.61], [105.64, 20.47]];
};

/** Frame one area or district (plan while the mobile sheet covers the map; 3D preset when it closes). */
function fitRecord(record, {maxZoom = 17.5, instant = false} = {}) {
  const bounds = boundsOf([recordBounds(record)]);
  if (!bounds) return;
  const preset = sheetOpen() ? 'plan' : cameraPreset();
  const pitched = preset !== 'plan' && !mobilePortrait();
  fitPitched(state.map, bounds, {preset, padding: pitched ? pitchedPadding() : cameraPadding(), maxZoom, minZoom: 6, animate: animate() && !instant, points: recordPoints(record), shift: mobilePortrait() ? -0.08 : null});
}

function fitCountry({instant = false} = {}) {
  fitPitched(state.map, boundsOf([countryBox()]), {preset: 'plan', padding: cameraPadding(), maxZoom: 7, minZoom: 4, animate: animate() && !instant});
}

function fitMap({instant = false} = {}) {
  if (!state.loaded) return;
  const area = state.selectedArea ? areaById(state.selectedArea) : null;
  if (area) { fitRecord(area, {instant}); return; }
  const district = state.selectedDistrict ? districtById(state.selectedDistrict) : null;
  if (district) { fitRecord(district, {maxZoom: 16, instant}); return; }
  const focus = state.focusIds.map(areaById).filter(Boolean);
  const province = $('province').value ? provinceRecord($('province').value) : null;
  if (!focus.length && !province) { fitCountry({instant}); return; }
  const b = boundsOf((focus.length ? focus : [province]).map(recordBounds));
  if (!b) return;
  const wide = b.getNorth() - b.getSouth() > 0.3 || b.getEast() - b.getWest() > 0.3;
  const preset = wide ? 'plan' : cameraPreset();
  const pitched = preset !== 'plan' && !mobilePortrait();
  const target = fitPitched(state.map, b, {preset, padding: pitched ? pitchedPadding() : cameraPadding(), maxZoom: 15, minZoom: 4.5, apply: false,
    points: focus.length ? focus.flatMap(recordPoints) : null, shift: mobilePortrait() && !wide ? -0.12 : null});
  if (!target) return;
  // A province is fitted whole: its แขวง/ตำบล are drawn at every zoom (province view), so no zoom floor is needed.
  if (animate() && !instant) state.map.easeTo({...target, duration: 650}); else state.map.jumpTo(target);
}

/**
 * Labels: the selection and the focus first (from AREA_MIN_ZOOM), then — once the map is close enough to
 * read them — the densest other areas of the scope as quiet chips (bounded: fewer on a phone). Each chip
 * carries the density value and a swatch of its class colour (the legend link).
 */
function areaLabelItems() {
  const m = state.areaModel;
  if (!m) return [];
  const u = unit(), zoom = state.map?.getZoom?.() ?? 12;
  // Below subdistrict zoom only the province view labels areas (its focus / selection; quiet chips need zoom ≥ 9.5).
  if (zoom < AREA_MIN_ZOOM && !$('province').value) return [];
  const focus = new Set(state.selectedArea ? [state.selectedArea] : state.focusIds);
  const district = state.selectedDistrict;
  const quietOK = zoom >= (district ? 9.5 : 11);
  const pool = m.areas.filter(a => a.count > 0 && (!district || a.district === district));
  // Eligible areas (≥ MIN_AREA_ROWS rows) first, so a tiny area's density on a handful of rows never outranks the Aha.
  const eligible = a => (a.count >= MIN_AREA_ROWS ? 1 : 0);
  const byRank = (a, b) => eligible(b) - eligible(a) || (b.density ?? 0) - (a.density ?? 0);
  // Navigating (an area, building or store is open): the frames on screen keep their label first,
  // so the neighbouring แขวง/ตำบล is one click away (refreshed on moveend).
  const navigating = Boolean(state.selectedArea) || ['building', 'store'].includes(state.panel.mode);
  const near = navigating && quietOK ? pool.filter(a => !focus.has(a.id) && state.labelView.has(a.id)).sort(byRank).slice(0, mobilePortrait() ? 4 : 16) : [];
  const nearIds = new Set(near.map(a => a.id));
  const quietLimit = !quietOK ? 0 : district ? 40 : focus.size ? (mobilePortrait() ? 0 : 12) : (mobilePortrait() ? 10 : 30);
  const others = quietLimit ? pool.filter(a => !focus.has(a.id) && !nearIds.has(a.id)).sort(byRank).slice(0, quietLimit) : [];
  const ordered = [...pool.filter(a => focus.has(a.id)), ...near, ...others];
  return ordered.map(a => ({id: a.id, name: a.name, value: dens(a.density || 0), state: a.state, quiet: focus.size > 0 && !focus.has(a.id) && !district,
    selected: a.id === state.selectedArea, center: navigating && state.labelView.has(a.id) ? state.labelView.get(a.id) : a.label, swatch: a.fill || '',
    title: `${areaWord(a.province)}${a.name} · ${dens(a.density || 0)} ${u.density} · ${num(a.count)} ${u.one}`}));
}

/**
 * Frames on screen and a visible anchor for each (after every camera move): its own label point when that is
 * on screen, else the grid point over the free part of the map that lies in the frame and is nearest its label
 * point. A neighbour whose centre is off screen still gets a label where it is visible.
 */
function refreshLabelView() {
  const map = state.map, m = state.areaModel;
  if (!map || !m || !state.index) return;
  state.locateArea ||= areaLocator(state.index);
  const el = map.getContainer(), w = el.clientWidth, h = el.clientHeight, zoom = map.getZoom();
  const top = 56, bottom = Math.min(h * 0.45, labelBottomSpace() + 8), left = 16, right = w - 16;
  const free = q => q.x >= left && q.x <= right && q.y >= top && q.y <= h - bottom;
  const best = new Map();
  if (zoom >= AREA_MIN_ZOOM) {
    const vb = map.getBounds(), W = vb.getWest(), E = vb.getEast(), S = vb.getSouth(), N = vb.getNorth();
    for (const a of m.areas) {
      if (!a.count || !Array.isArray(a.label)) continue;
      const [x, y] = a.label;
      if (x < W || x > E || y < S || y > N) continue;
      if (free(map.project(a.label))) best.set(a.id, {center: a.label, d: 0});
    }
    const cols = 9, rows = 6;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const sx = left + ((i + 0.5) / cols) * (right - left), sy = top + ((j + 0.5) / rows) * (h - bottom - top);
      const ll = map.unproject([sx, sy]).toArray();
      const id = state.locateArea(ll);
      const a = id && best.get(id)?.d !== 0 ? areaById(id) : null;
      if (!a) continue;
      const lp = Array.isArray(a.label) ? map.project(a.label) : {x: sx, y: sy};
      const d = Math.hypot(lp.x - sx, lp.y - sy);
      if (!best.has(id) || d < best.get(id).d) best.set(id, {center: ll, d});
    }
  }
  const bucket = `${zoom >= AREA_MIN_ZOOM ? 1 : 0}${zoom >= 9.5 ? 1 : 0}${zoom >= 11 ? 1 : 0}`;
  const key = `${bucket}|${[...best].map(([id, b]) => `${id}:${b.center.map(v => v.toFixed(5)).join(',')}`).sort().join('|')}`;
  if (key === refreshLabelView.key) return;
  refreshLabelView.key = key;
  state.labelView = new Map([...best].map(([id, b]) => [id, b.center]));
  state.labels?.update(state.showAreas ? areaLabelItems() : [], {visible: state.showAreas});
}
function scheduleLabelView() {
  clearTimeout(scheduleLabelView.timer);
  scheduleLabelView.timer = setTimeout(() => { if (state.loaded) { syncMapFocus(); refreshLabelView(); ensureFramesInView(); renderLegend(); } }, 60);
}

/**
 * National scale: the AUTOMATIC focus quiets the map only while one of its areas is on screen. Panned or zoomed
 * to another part of the country, the map fills every loaded frame (the panel keeps the Aha); a user-chosen
 * focus, a selected area or a district never releases.
 */
function mapFocusIds() {
  if (focusMode() !== 'auto' || !state.map || !state.loaded) return state.focusIds;
  const b = state.map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  const onScreen = state.focusIds.some(id => { const box = areaById(id)?.bbox; return Array.isArray(box) && !(box[2] < w || box[0] > e || box[3] < s || box[1] > n); });
  return onScreen ? state.focusIds : [];
}
/** After a camera move: re-apply the area layers only when the released/kept focus flips. */
function syncMapFocus() {
  const key = mapFocusIds().join(',');
  if (key !== syncMapFocus.key) updateSpatialLayers();
}

/** A small square (lon/lat ring) around a point: the massing region of a store outside the focused areas. */
function squareAround(lon, lat, metres = 250) {
  const dy = metres / 110574, dx = metres / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]];
}

/** Massing focus regions: the open store's area and surroundings, else the selected area, else the focus. */
function massingRegions() {
  if (state.panel.mode === 'store') {
    const r = rowById(state.panel.id), a = r?.area ? areaById(r.area) : null;
    const rings = a?.feature ? outerRings(a.feature) : [];
    if (hasPoint(r)) rings.push(squareAround(r.longitude, r.latitude));
    if (rings.length) return rings;
  }
  const records = state.selectedArea ? [areaById(state.selectedArea)] : state.selectedDistrict ? [] : state.focusIds.map(areaById);
  return records.map(a => a?.feature).filter(Boolean).flatMap(outerRings);
}

function updateSpatialLayers() {
  if (!state.loaded) return;
  const code = $('province').value, u = unit();
  const pm = state.provinceLayers?.update({rows: provinceScopeRows(), selectedCode: code, visible: true, unit: u.one}) || null;
  state.provinceModel = pm;
  state.provinceLabels?.update(pm ? pm.provinces.filter(p => p.count > 0 || p.code === code).sort((a, b) => (b.code === code) - (a.code === code) || b.count - a.count)
    .map(p => ({id: p.code, name: p.name, value: num(p.count), state: p.state, quiet: Boolean(code) && p.code !== code, selected: p.code === code, center: p.label, swatch: p.fill || '', title: `${p.name} · ${num(p.count)} ${u.one}`})) : [], {visible: true});
  const districtAreas = state.selectedDistrict ? (districtById(state.selectedDistrict)?.areas || []).map(a => a.id) : [];
  const focusIds = mapFocusIds();
  syncMapFocus.key = focusIds.join(',');
  state.areaLayers?.update({model: state.areaModel, selectedId: state.selectedArea, focusIds: state.selectedDistrict ? districtAreas : focusIds, outlineFocus: !state.selectedDistrict, districtId: state.selectedDistrict, visible: state.showAreas, provinceCode: code});
  state.labels?.update(state.showAreas ? areaLabelItems() : [], {visible: state.showAreas});
  renderLegend();
  const anchorRecords = (state.selectedArea ? [areaById(state.selectedArea)] : state.selectedDistrict ? [districtById(state.selectedDistrict)] : state.focusIds.map(areaById)).filter(Boolean);
  const anchors = anchorRecords.length ? anchorRecords.map(r => r.label).filter(Array.isArray) : [state.map.getCenter().toArray()];
  state.massing?.update({regions: massingRegions(), hosts: [], anchors: anchors.length ? anchors : [state.map.getCenter().toArray()], enabled: true, city: state.view3d, zoom: state.map.getZoom(), latitude: state.map.getCenter().lat})?.catch(e => console.warn('Massing', e));
  applyJoin();
  state.pins?.layout();
}

/** Below subdistrict zoom: the แขวง/ตำบล of the selected จังหวัด under a point ('' outside it or without a filter). */
function provinceViewArea(point) {
  const code = $('province').value;
  if (!code || !state.showAreas) return '';
  const id = state.areaLayers?.hitTest(point) || '';
  return id && areaById(id)?.province === code ? id : '';
}
/** The province frame under a point (its code, or ''). Quiet frames (opacity 0) still answer the query. */
function provinceAt(point) {
  const layers = ['province-fill'].filter(id => state.map.getLayer(id));
  const f = layers.length ? state.map.queryRenderedFeatures(point, {layers})[0] : null;
  return f ? String(f.id ?? f.properties?.id) : '';
}

/** What a building under the pointer would open (null: nothing → the click falls through). */
function buildingTarget(point) {
  const b = state.massing?.hitTest(point);
  if (!b || !state.join) return null;
  const key = `osm:${b.id}`, rows = state.join.byBuilding.get(key) || [];
  if (!rows.length) return null;
  return rows.length === 1 ? {kind: 'store', id: rows[0].id} : {kind: 'building', key};
}

/**
 * One click handler, in priority order: focus pin → focus building → province (country zoom) → area. A click
 * on another แขวง/ตำบล moves there at any zoom from AREA_MIN_ZOOM; a click inside the selected one changes
 * nothing (pan and tilt freely).
 */
function onMapClick(e) {
  const point = e.point;
  const r = state.pins?.hitTest(point);
  if (r) { selectStore(r.id, {fly: false, showPopup: true, fromPin: true}); return; }
  const hit = buildingTarget(point);
  if (hit?.kind === 'store') { if (state.panel.mode !== 'store' || state.panel.id !== hit.id) selectStore(hit.id, {fly: false, showPopup: true, fromPin: true}); return; }
  if (hit?.kind === 'building') { if (state.panel.mode !== 'building' || state.panel.id !== hit.key) selectBuilding(hit.key); return; }
  if (belowAreaZoom()) {
    // Province view: a แขวง/ตำบล of the selected จังหวัด; anywhere else a province frame (another จังหวัด).
    const area = provinceViewArea(point);
    if (area) { if (area !== state.selectedArea) selectArea(area, {fromMap: true}); return; }
    const code = provinceAt(point);
    if (code && code !== $('province').value) selectProvince(code);
    return;
  }
  if (!state.showAreas) return;
  const id = state.areaLayers?.hitTest(point) || '';
  if (id && id !== state.selectedArea) selectArea(id, {fromMap: true});
}

/** Pointer feedback (one query per frame): pointer over anything clickable, outline on another area. */
function onMapMove(e) {
  onMapMove.point = e.point;
  if (onMapMove.frame) return;
  onMapMove.frame = requestAnimationFrame(() => {
    onMapMove.frame = 0;
    const map = state.map, p = onMapMove.point;
    if (!map || !state.loaded || !p) return;
    let over = Boolean(state.pins?.hitTest(p)) || Boolean(buildingTarget(p));
    let area = '';
    if (!over && belowAreaZoom()) {
      const inProvince = provinceViewArea(p);
      if (inProvince) area = inProvince === state.selectedArea ? '' : inProvince;
      else { const code = provinceAt(p); over = Boolean(code) && code !== $('province').value; }
    } else if (!over && state.showAreas && map.getZoom() >= AREA_MIN_ZOOM) {
      area = state.areaLayers?.hitTest(p) || '';
      if (area === state.selectedArea) area = '';
    }
    state.areaLayers?.hover(area);
    over = over || Boolean(area);
    map.getCanvas().style.cursor = over ? 'pointer' : '';
  });
}

function installSpatialLayers() {
  const map = state.map;
  state.loaded = true;
  const palette = basemapPalette(theme());
  state.provinceLayers = state.provincesGeo?.features?.length ? installProvinceLayers(map, state.provincesGeo) : null;
  state.areaLayers = installAreaLayers(map, {areas: state.frames.areas(), districts: state.frames.districts()});
  state.massing = installMassing(map, {
    beforeId: MASSING_BEFORE,
    // The open building is drawn in the data colour (LDS map.activeLayer), read from the theme.
    colors: {quiet: palette.massingQuiet, focus: palette.massingFocus, ground: palette.ground, venue: cssVar('--map-active-layer') || undefined},
    tileUrl: t => (state.tileTemplate ? state.tileTemplate.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y) : ''),
    onResult: result => { $('map-status').dataset.massing = `${result.features || 0}`; applyJoin(); },
  });
  state.pins = installPharmacyPins(map, $('map'), {
    reservedBottom: bottomSpace,
    onSelect: r => selectStore(r.id, {fly: false, showPopup: true, fromPin: true}),
    // The context figure is every grey point of the selection outside the focus, not only those on screen.
    onLayout: stats => { $('map-status').textContent = `${num(stats.focusInView)} ${unit().one}ที่มีพิกัดในจอ${stats.contextRows ? ` · จุดนอกโฟกัสทั้งหมด ${num(stats.contextRows)}` : ''}`; },
  });
  updatePins();
  updateSpatialLayers();
  if (!state.initialCameraDone) {
    state.initialCameraDone = true;
    const r = state.panel.mode === 'store' ? rowById(state.panel.id) : null;
    if (r && hasPoint(r)) framePoint(map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, animate: false});
    else if (r && (r.area || r.district)) fitRecord(r.area ? areaById(r.area) : districtById(r.district), {maxZoom: 16, instant: true});
    else fitMap({instant: true});
    state.lastPreset = cameraPreset();
  }
  scheduleLabelView();
}

/**
 * The attribution (OpenStreetMap / OpenMapTiles / CityMETER) must stay readable: its live height — expanded on
 * load, compact after the first drag — becomes --attrib-height, which keeps the phone legend and Aha card above it.
 */
function trackAttribution(map) {
  const panel = map.getContainer().closest('.map-panel');
  const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
  if (!panel || !el) return null;
  const set = () => panel.style.setProperty('--attrib-height', `${Math.ceil(el.getBoundingClientRect().height) + 10}px`);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
  observer?.observe(el);
  set();
  return observer;
}

/** Thai labels for the map's own controls. */
const MAP_LOCALE = {
  'Map.Title': 'แผนที่ร้านยา', 'NavigationControl.ZoomIn': 'ซูมเข้า', 'NavigationControl.ZoomOut': 'ซูมออก',
  'NavigationControl.ResetBearing': 'หมุนกลับทิศเหนือ (ลากเพื่อหมุนหรือเอียง)', 'Popup.Close': 'ปิด', 'AttributionControl.ToggleAttribution': 'แสดงหรือซ่อนที่มาของแผนที่',
};

function initMap() {
  if (!window.maplibregl) throw new Error('Map library is unavailable');
  try {
    state.mapTheme = theme();
    state.map = new maplibregl.Map({container: 'map', center: BANGKOK.center, zoom: BANGKOK.zoom, pitch: 0, maxPitch: 85, attributionControl: {compact: true}, locale: MAP_LOCALE, style: buildMapStyle(state.mapTheme)});
    state.map.addControl(new maplibregl.NavigationControl({showCompass: true, visualizePitch: true}), 'top-right');
    state.attribObserver = trackAttribution(state.map);
    state.labels = installAreaLabels(state.map, $('map'), {className: 'neighborhood-label', hostId: 'area-labels', hostLabel: 'แขวง/ตำบลบนแผนที่', minZoom: PROVINCE_VIEW_MIN_ZOOM, verb: 'กดเพื่อสำรวจพื้นที่', onSelect: id => selectArea(id, {fromMap: true}), reservedBottom: labelBottomSpace, maxLabels: 40});
    state.provinceLabels = installAreaLabels(state.map, $('map'), {className: 'province-label', hostId: 'province-labels', hostLabel: 'จังหวัดบนแผนที่', minZoom: 0, maxZoom: PROVINCE_LABEL_MAX_ZOOM, verb: 'กดเพื่อดูจังหวัด', detailZoomClass: false, onSelect: code => selectProvince(code), reservedBottom: labelBottomSpace, maxLabels: 77});
    state.map.on('zoomend', () => { if (state.loaded) renderLegend(); });
    // Coalesced: a camera fit jumps the map many times in one task; labels and frame loading follow the last position.
    state.map.on('moveend', scheduleLabelView);
    state.map.on('mouseout', () => { state.areaLayers?.hover(''); });
    state.map.on('style.load', installSpatialLayers);
    state.map.on('click', onMapClick);
    state.map.on('mousemove', onMapMove);
    state.map.on('error', e => console.warn('Map resource', e.error?.message || e));
    fetch(TILEJSON_URL).then(r => r.json()).then(j => { state.tileTemplate = j.tiles?.[0] || ''; if (state.loaded) updateSpatialLayers(); }).catch(e => console.warn('TileJSON', e));
  } catch (e) {
    state.loaded = false; state.initialCameraDone = false;
    for (const cleanup of [() => state.attribObserver?.disconnect(), () => state.labels?.dispose(), () => state.provinceLabels?.dispose(), disposeSpatial, () => state.map?.remove()]) { try { cleanup(); } catch (err) { console.warn('Map cleanup', err); } }
    state.map = null; state.labels = null; state.provinceLabels = null; state.provinceModel = null;
    throw e;
  }
}

async function startMap() {
  const el = $('map-failure');
  try { await loadMapLibrary(); el.hidden = true; initMap(); }
  catch (e) {
    el.hidden = false;
    el.innerHTML = `<p>โหลดแผนที่ไม่สำเร็จ ข้อมูล ตาราง และกราฟยังใช้งานได้</p><p class="hint">${esc(e.message || '')}</p><button type="button" class="btn">ลองโหลดแผนที่ใหม่</button>`;
    el.querySelector('button').onclick = event => { event.target.disabled = true; startMap(); };
    console.warn(e);
  }
}

function toggle3d() {
  state.view3d = !state.view3d;
  $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
  renderLegend();
  updateSpatialLayers();
  if (state.map) { applyPreset(state.map, cameraPreset(), {animate: animate()}); state.lastPreset = cameraPreset(); }
  saveURL();
}

/* ---------- mobile sheet ---------- */
function openMobilePanel() {
  if (!mobilePortrait()) return;
  $('panel').classList.add('is-open');
  $('mobile-panel').setAttribute('aria-expanded', 'true');
  $('map-aha').hidden = true;
}
function closeMobilePanel() {
  const wasOpen = $('panel').classList.contains('is-open');
  $('panel').classList.remove('is-open');
  $('mobile-panel').setAttribute('aria-expanded', 'false');
  if (mobilePortrait()) {
    $('mobile-panel').focus({preventScroll: true});
    if (state.panel.mode === 'overview') renderPanel();
    else if (wasOpen && state.loaded && state.panel.mode === 'area') { const a = areaById(state.panel.id); if (a) fitRecord(a); }
    else if (wasOpen && state.loaded && state.panel.mode === 'district') { const d = districtById(state.panel.id); if (d) fitRecord(d, {maxZoom: 16}); }
    else if (wasOpen && state.loaded && state.panel.mode === 'store') { const r = rowById(state.panel.id); if (r && hasPoint(r)) framePoint(state.map, [r.longitude, r.latitude], {preset: cameraPreset(), zoom: 16.5, animate: animate()}); }
    updateSpatialLayers();
  }
}

/* ---------- data loading ---------- */
function validFeatureCollection(value) {
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)) return false;
  const position = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const ring = r => Array.isArray(r) && r.length >= 4 && r.every(position);
  const polygon = p => Array.isArray(p) && p.length > 0 && p.every(ring);
  return value.features.every(f => {
    const g = f?.geometry, id = f?.id ?? f?.properties?.id;
    return f?.type === 'Feature' && (typeof id === 'string' || typeof id === 'number') && (g?.type === 'Polygon' ? polygon(g.coordinates) : g?.type === 'MultiPolygon' && g.coordinates.every(polygon));
  });
}

async function fetchJSON(resource, {timeout = 20000} = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(resource, {signal: controller.signal, cache: 'no-cache'});
    if (!r.ok) { const e = new Error('โหลดข้อมูลไม่สำเร็จ'); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) { e.resource = resource; e.phase = 'data'; throw e; }
  finally { clearTimeout(timer); }
}

/** Replace a select's options after its first (empty) one. */
function setOptions(id, items) {
  const s = $(id), keep = s.value;
  while (s.options.length > 1) s.remove(1);
  for (const [value, label] of items) { const o = document.createElement('option'); o.value = value; o.textContent = label; s.append(o); }
  s.value = [...s.options].some(o => o.value === keep) ? keep : '';
}

/** Option labels carry their counts in the current counting unit (refreshed when the unit changes). */
function refreshOptionCounts() {
  const all = $('count').value === 'all';
  const rows = all ? state.data.rows : state.data.rows.filter(r => r.licensed);
  const u = unit();
  const groups = new Map(), provinces = new Map(), brands = new Map();
  let quality = 0;
  for (const r of rows) {
    groups.set(r.groupId, (groups.get(r.groupId) || 0) + 1);
    if (r.province) provinces.set(r.province, (provinces.get(r.province) || 0) + 1);
    if (r.brand) brands.set(r.brand.id, (brands.get(r.brand.id) || 0) + 1);
    if (r.quality) quality++;
  }
  setOptions('group', state.data.groups.map(g => [g.id, `${g.th} (${num(groups.get(g.id) || 0)})`]));
  setOptions('quality', [['listed', `เฉพาะร้านยาคุณภาพ (${num(quality)})`]]);
  setOptions('province', [...provinceList()].sort((a, b) => COLLATOR.compare(a.th, b.th)).map(p => [p.code, `${p.th} (${num(provinces.get(p.code) || 0)})`]));
  // Chains without a row in this unit stay listed (0): their outlets may be named only in other sources.
  // A chain with no row in any source is not offered (an empty map is not a finding).
  setOptions('brand', state.data.brands.filter(b => b.rows > 0).sort((a, b) => (brands.get(b.id) || 0) - (brands.get(a.id) || 0) || a.name.localeCompare(b.name)).map(b => [b.id, `${b.name} (${num(brands.get(b.id) || 0)})`]));
  setOptions('count', [['all', `ทุกรายการจากทุกแหล่ง — อาจซ้ำ (${num(state.data.rows.length)})`]]);
  if (all) $('count').value = 'all';
  $('count').options[0].textContent = `ร้านที่มีใบอนุญาต ขย1 — นับไม่ซ้ำ (${num(state.data.rows.filter(r => r.licensed).length)})`;
  $('category-items').innerHTML = state.data.groups.map(g => `<span>${cueMarkup(g.series)}${esc(g.th)}</span>`).join('');
  $('search').placeholder = `ค้นหา${u.mode === 'all' ? 'รายการ' : 'ร้านยา'} เครือร้าน เลขใบอนุญาต หรือพื้นที่`;
}

function restoreFromURL() {
  const p = new URLSearchParams(location.search);
  for (const f of FIELDS) if (p.has(f)) { const v = f === 'province' ? provinceCodeFrom(p.get(f)) : p.get(f); if ([...$(f).options].some(o => o.value === v) || f === 'search') $(f).value = v; }
  if (['density', 'mix', 'quality'].includes(p.get('view'))) state.view = p.get('view');
  if (p.get('district') && districtById(p.get('district'))) state.selectedDistrict = p.get('district');
  if (p.get('area') && areaById(p.get('area'))) { state.selectedArea = p.get('area'); state.selectedDistrict = ''; }
  const areas = p.get('areas') || '';
  if (areas === 'all') { state.autoFocus = false; state.focusAreaIds = []; }
  else state.focusAreaIds = [...new Set(areas.split(','))].filter(id => areaById(id)).slice(0, 3);
  state.view3d = p.get('view3d') !== '0';
  if (state.selectedArea) state.panel = {mode: 'area', id: state.selectedArea};
  else if (state.selectedDistrict) state.panel = {mode: 'district', id: state.selectedDistrict};
  const store = p.get('store') && rowById(p.get('store'));
  if (store) {
    if (!store.licensed) $('count').value = 'all';
    state.panel = {mode: 'store', id: store.id};
  }
}

function wireEvents() {
  let timer;
  for (const f of FIELDS) $(f).addEventListener(f === 'search' ? 'input' : 'change', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.focusAreaIds = [];
      state.history = [];
      if (f === 'province') { state.selectedArea = ''; state.selectedDistrict = ''; }
      if (f === 'count') refreshOptionCounts();
      state.panel = state.selectedArea ? {mode: 'area', id: state.selectedArea} : state.selectedDistrict ? {mode: 'district', id: state.selectedDistrict} : overviewPanel();
      update({fit: true});
    }, f === 'search' ? 450 : 0);
  });
  $('filters').addEventListener('reset', () => setTimeout(() => { refreshOptionCounts(); resetToOverview(); }, 0));
  $('panel-view').addEventListener('click', onPanelAction);
  $('filter-chips').addEventListener('click', onPanelAction);
  $('map-aha').addEventListener('click', onPanelAction);
  $('crumbs').addEventListener('click', onPanelAction);

  const tabs = [...document.querySelectorAll('[data-view]')];
  tabs.forEach((b, i) => {
    b.onclick = () => { state.view = b.dataset.view; drawChart(); saveURL(); };
    b.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].focus(); tabs[j].click();
    });
  });

  $('fit-map').onclick = () => { if (state.map) fitMap(); };
  // ทั้งประเทศ = the whole country with every area filled: no province filter, no focus (?areas=all).
  $('country-map').onclick = () => {
    $('province').value = '';
    state.autoFocus = false; state.focusAreaIds = []; state.selectedArea = ''; state.selectedDistrict = '';
    state.panel = overviewPanel(); state.history = [];
    update({fit: true});
    announce('ทั้งประเทศ · ทุกพื้นที่');
  };
  $('toggle-3d').onclick = toggle3d;
  $('toggle-neighborhoods').onclick = () => { state.showAreas = !state.showAreas; $('toggle-neighborhoods').setAttribute('aria-pressed', String(state.showAreas)); updateSpatialLayers(); };
  $('mobile-panel').onclick = () => { $('panel').classList.contains('is-open') ? closeMobilePanel() : openMobilePanel(); };
  $('close-mobile-panel').onclick = closeMobilePanel;
  document.querySelector('.skip').onclick = () => { openMobilePanel(); $('dataset-title').focus(); };
  $('toggle-insights').onclick = () => openInsights($('insight-content').hidden);
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncBottomPanel).observe($('insights')); else window.addEventListener('resize', syncBottomPanel);
  $('open-table').onclick = () => { $('results').hidden = false; if (renderTable.stale) renderTable(); closeMobilePanel(); $('toggle-table').focus(); };
  $('toggle-table').onclick = () => { $('results').hidden = true; $('open-table').focus(); };
  $('prev-page').onclick = () => { state.page--; renderTable(); };
  $('next-page').onclick = () => { state.page++; renderTable(); };
  $('theme').onchange = applyTheme;
  const colorMedia = matchMedia('(prefers-color-scheme: dark)');
  const onColorChange = () => { if ($('theme').value === 'auto') applyTheme(); };
  if (colorMedia.addEventListener) colorMedia.addEventListener('change', onColorChange); else colorMedia.addListener(onColorChange);
  matchMedia('(max-width: 760px) and (orientation: portrait)').addEventListener?.('change', () => { if (!mobilePortrait()) $('panel').classList.remove('is-open'); renderPanel(); });
}

async function init() {
  try {
    const [rowsJSON, indexJSON, provincesJSON] = await Promise.all([
      fetchJSON('data/pharmacies.json', {timeout: 45000}),
      fetchJSON('data/area-index.json', {timeout: 30000}),
      fetchJSON('data/provinces.geojson', {timeout: 30000}).catch(e => { console.warn('Province frames unavailable', e); return null; }),
    ]);
    if (!Array.isArray(indexJSON?.provinces) || !indexJSON.provinces.length || !Array.isArray(indexJSON?.areas?.id)) {
      const e = new Error('Invalid area index'); e.resource = 'data/area-index.json'; e.phase = 'data-schema'; throw e;
    }
    setProvinces(indexJSON.provinces);
    state.index = buildAreaIndex(indexJSON);
    state.provincesGeo = validFeatureCollection(provincesJSON) ? provincesJSON : {type: 'FeatureCollection', features: []};
    state.data = decodeDataset(rowsJSON, state.index);
    if (state.data.dropped) console.warn('Rows outside the area index', state.data.dropped);
    state.rowById = new Map(state.data.rows.map(r => [r.id, r]));
    state.frames = createFrameStore({index: state.index, fetchJSON, version: RELEASE, onLoad: onFramesLoaded,
      onError: (code, e) => { console.warn('Province outlines unavailable', code, e); $('map-status').dataset.framesError = code; }});

    refreshOptionCounts();
    restoreFromURL();
    refreshOptionCounts();
    $('toggle-3d').setAttribute('aria-pressed', String(state.view3d));
    try { $('theme').value = localStorage.getItem(THEME_KEY) || 'auto'; } catch {}
    applyTheme();
    wireEvents();
    update();
    if (state.panel.mode !== 'overview') openMobilePanel();
    window.dispatchEvent(new CustomEvent('citymeter:ready'));
    startMap();
  } catch (e) {
    window.dispatchEvent(new CustomEvent('citymeter:load-error', {detail: {message: 'โหลดข้อมูลร้านยาไม่สำเร็จ กรุณาลองอีกครั้ง', resource: e.resource, status: e.status, phase: e.phase || 'startup', diagnostic: e.message}}));
    console.error(e);
  }
}

// Developer hook for live tuning in a browser console (not an API; may change without notice).
window.__citymeter = {state, get map() { return state.map; }, update, fitMap, updateSpatialLayers, applyPreset: (name, opts) => state.map && applyPreset(state.map, name, opts), fitPitched: (b, opts) => state.map && fitPitched(state.map, b, opts), cameraPadding, buildMapStyle, productionLink};

init();
