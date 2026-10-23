/**
 * Administrative areas: แขวง/ตำบล (SUBDISTRICT, the analytical unit), เขต/อำเภอ (DISTRICT) and จังหวัด
 * (PROVINCE), all from CityMETER production base info and boundaries.
 *
 * The index (data/area-index.json) holds every one of the 7,436 subdistricts, 928 districts and 77
 * provinces — names, production codes, production areaSqm, a label point and a bbox — without geometry,
 * so ranks, search, breadcrumbs and camera fits work at once. Outlines arrive per province from
 * data/frames/{CODE}.json (js/frames.js) and are attached to the same records (`feature`).
 *
 * Membership is the row's own: the codes the build matched from its administrative names (row.admin).
 * Nothing is re-assigned here by the displayed point.
 *
 * Density = rows ÷ production areaSqm (km²) — a ratio of raw totals per area; combined densities of
 * several areas are Σrows ÷ Σkm², never an average of per-area ratios.
 */
const km2 = sqm => (Number.isFinite(sqm) && sqm > 0 ? sqm / 1e6 : null);

export function buildAreaIndex(json) {
  const byId = new Map(), districtById = new Map(), provinceById = new Map();
  for (const p of json?.provinces || []) {
    provinceById.set(p.id, {id: p.id, code: p.id, dopa: p.code, uuid: p.uuid, name: p.name, nameEn: p.nameEn, km2: km2(p.areaSqm),
      label: p.label || null, bbox: p.bbox || null, districtCount: p.districts, areaCount: p.subdistricts});
  }
  const d = json?.districts || {id: []};
  for (let i = 0; i < d.id.length; i++) {
    districtById.set(d.id[i], {id: d.id[i], name: d.name[i], nameEn: d.nameEn[i] || '', province: d.province[i], km2: km2(d.areaSqm[i]),
      label: d.label[i] || null, bbox: d.bbox[i] || null, areaTotal: d.subdistricts[i] || 0, areas: [], feature: null});
  }
  const a = json?.areas || {id: []};
  for (let i = 0; i < a.id.length; i++) {
    const id = a.id[i], dist = districtById.get(id.slice(0, 4));
    const area = {id, name: a.name[i], nameEn: a.nameEn[i] || '', district: dist?.id || id.slice(0, 4), districtName: dist?.name || '',
      province: dist?.province || '', km2: km2(a.areaSqm[i]), label: a.label[i] || null, bbox: a.bbox[i] || null, feature: null};
    byId.set(id, area);
    dist?.areas.push(area);
  }
  return {byId, districtById, provinceById, areas: [...byId.values()], districts: [...districtById.values()], provinces: [...provinceById.values()]};
}

/** Attach the outlines of one province (data/frames/{CODE}.json) to the index records. Returns the area ids attached. */
export function attachFrames(index, frames) {
  const ids = [];
  for (const f of frames?.areas?.features || []) {
    const a = index.byId.get(String(f.id ?? f.properties?.id));
    if (a) { a.feature = f; ids.push(a.id); }
  }
  for (const f of frames?.districts?.features || []) {
    const d = index.districtById.get(String(f.id ?? f.properties?.id));
    if (d) d.feature = f;
  }
  return ids;
}

/** District label for a subdistrict/district in Bangkok (เขต/แขวง) vs elsewhere (อำเภอ/ตำบล). */
export const levelWords = province => (province === 'BKK' ? {district: 'เขต', area: 'แขวง'} : {district: 'อำเภอ', area: 'ตำบล'});
export const areaWord = province => levelWords(province).area;
export const districtWord = province => levelWords(province).district;

/** Group rows by a key function into Map<key, rows[]>. */
export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = key(r); let a = m.get(k); if (!a) m.set(k, a = []); a.push(r); }
  return m;
}

function stats(rows) {
  let quality = 0, points = 0;
  for (const r of rows) { if (r.quality) quality++; if (Number.isFinite(r.latitude)) points++; }
  return {quality, points};
}

/**
 * Per-area summaries for `rows`. With includeEmpty, every frame of `index` (optionally limited to a
 * province/district) is listed, zero included.
 */
export function summarizeAreas(rows, index, {includeEmpty = false, province = '', district = '', grouped = null} = {}) {
  const by = grouped || groupBy(rows.filter(r => r.area), r => r.area);
  const list = [];
  const pool = district ? (index.districtById.get(district)?.areas || []) : index.areas;
  for (const area of pool) {
    if (province && area.province !== province) continue;
    const members = by.get(area.id) || [];
    if (!includeEmpty && !members.length) continue;
    list.push({...area, rows: members, count: members.length, density: area.km2 ? members.length / area.km2 : null, ...stats(members)});
  }
  return list;
}

export function summarizeDistricts(rows, index, {includeEmpty = false, province = ''} = {}) {
  const by = groupBy(rows.filter(r => r.district), r => r.district);
  const list = [];
  for (const d of index.districts) {
    if (province && d.province !== province) continue;
    const members = by.get(d.id) || [];
    if (!includeEmpty && !members.length) continue;
    list.push({...d, rows: members, count: members.length, density: d.km2 ? members.length / d.km2 : null, ...stats(members)});
  }
  return list;
}

/** Stable ordering by density (desc), then rows, then id. */
export const byDensity = (a, b) => (b.density ?? -1) - (a.density ?? -1) || b.count - a.count || String(a.id).localeCompare(String(b.id));
export const byCount = (a, b) => b.count - a.count || (b.density ?? -1) - (a.density ?? -1) || String(a.id).localeCompare(String(b.id));

/** Combined density of several areas: Σrows ÷ Σkm² (raw totals, not an average of ratios). */
export function combinedDensity(areas) {
  const count = areas.reduce((s, a) => s + a.count, 0), area = areas.reduce((s, a) => s + (a.km2 || 0), 0);
  return {count, km2: area, density: area ? count / area : null};
}

/** Bounds-like [[w, s], [e, n]] of a record: its loaded outline, else its index bbox. */
export function recordBounds(record) {
  const g = record?.feature?.geometry;
  if (g) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = v => { if (typeof v[0] === 'number') { if (v[0] < w) w = v[0]; if (v[0] > e) e = v[0]; if (v[1] < s) s = v[1]; if (v[1] > n) n = v[1]; } else v.forEach(walk); };
    walk(g.coordinates);
    return [[w, s], [e, n]];
  }
  const b = record?.bbox;
  return Array.isArray(b) ? [[b[0], b[1]], [b[2], b[3]]] : null;
}

/**
 * Point → แขวง/ตำบล id among the LOADED outlines, for DISPLAY only (where to anchor a label that is on
 * screen). Never membership: a row's area is always the code matched at build time.
 */
export function areaLocator(index) {
  const inRing = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const items = index.areas.filter(a => a.feature).map(a => {
    const g = a.feature.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of polys) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return {id: a.id, polys, w, s, e, n};
  });
  return ([x, y]) => {
    for (const it of items) {
      if (x < it.w || x > it.e || y < it.s || y > it.n) continue;
      if (it.polys.some(p => inRing([x, y], p[0]) && !p.slice(1).some(h => inRing([x, y], h)))) return it.id;
    }
    return '';
  };
}
