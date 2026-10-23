/**
 * Dataset vocabulary, decoding, shared filter and summary helpers.
 *
 * Rows are the outlet candidates of “CityMETER Pharmacy Thailand — Research Master 2026-10-22”
 * (data/pharmacies.json, built by scripts/build-data.py). One row = one row of the sheet’s 02_STORES:
 * nothing here merges, moves or mutates a row.
 *
 * Counting unit (a contract, see DATA_METHOD.md §3):
 *   licensed (default) — rows that carry a ขย1 licence number of the FDA register snapshot. One licence =
 *                        one premises, so a storefront listed by several sources is counted once.
 *   all                — every row of the dataset. The same storefront can appear in more than one row (a
 *                        chain’s own branch list + the licence register), so “รายการ”, never “ร้าน”.
 * The unit words follow the mode everywhere (unitWords).
 *
 * Area membership is the row’s own administrative names matched to CityMETER production codes (or, for a
 * row without usable names, its published source point inside a production subdistrict) — see
 * row.admin. Points are published source points (not surveyed, not entrances); most rows have none.
 */
import {seriesOf} from './cues.js';

/** Short labels for tight places (matrix columns); the full Thai label stays in titles, legends and lists. */
export const GROUP_SHORT = Object.freeze({
  chain: 'เครือร้านยา', health_beauty: 'สุขภาพ/ความงาม', regional: 'เครือภูมิภาค', public: 'รัฐ/สถาบัน', independent: 'ท้องถิ่น',
});

/** Unit words for the counting mode. */
export function unitWords(mode = 'licensed') {
  return mode === 'all'
    ? {one: 'รายการ', density: 'รายการ/ตร.กม.', densityLong: 'รายการต่อตารางกิโลเมตร', subject: 'รายการร้านยา', mode}
    : {one: 'ร้าน', density: 'ร้าน/ตร.กม.', densityLong: 'ร้านต่อตารางกิโลเมตร', subject: 'ร้านยาที่มีใบอนุญาต', mode};
}

/** Every province of the production base info, keyed by the production route code (/v3/citymeter/{code}). */
let PROVINCE_LIST = [];
export function setProvinces(list) { PROVINCE_LIST = Object.freeze((list || []).map(p => Object.freeze({code: p.id, dopa: p.code, th: p.name, en: p.nameEn}))); }
export const provinces = () => PROVINCE_LIST;
export const provinceByCode = code => PROVINCE_LIST.find(p => p.code === String(code || '').toUpperCase()) || null;
/** Accept a production code (BKK), a DOPA code (10) or an English/Thai name; returns the production code or ''. */
export const provinceCodeFrom = value => {
  const v = String(value || '').trim();
  const p = PROVINCE_LIST.find(x => x.code === v.toUpperCase() || x.dopa === v || x.en.toLowerCase() === v.toLowerCase() || x.th === v);
  return p ? p.code : '';
};

/** A usable coordinate inside Thailand's bounding box (most rows have none — never invented). */
export const hasPoint = r => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude) &&
  r.latitude >= 5 && r.latitude <= 21 && r.longitude >= 97 && r.longitude <= 106;

const lower = v => String(v || '').toLocaleLowerCase('th-TH');

export const EVIDENCE_LABEL = Object.freeze({
  licensed: 'ใบอนุญาต ขย1 ในทะเบียน อย.',
  directory: 'รายชื่อร้านยาของสภาเภสัชกรรม (ยังไม่จับคู่ใบอนุญาต)',
  chain_source: 'รายชื่อสาขาจากแหล่งของเครือ (ยังไม่จับคู่ใบอนุญาต)',
});
export const EVIDENCE_SHORT = Object.freeze({licensed: 'ใบอนุญาต ขย1', directory: 'รายชื่อสภาเภสัชกรรม', chain_source: 'แหล่งของเครือ'});

/**
 * Decode data/pharmacies.json into row objects plus dictionaries.
 * `index` is the area index (js/areas.js#buildAreaIndex): every placed code must exist there.
 */
export function decodeDataset(json, index) {
  if (!json?.cols || !Array.isArray(json.cols.key)) throw new Error('Invalid pharmacy dataset');
  const c = json.cols, n = c.key.length, V = json.vocab || {};
  const groups = (json.groups || []).map((g, i) => ({...g, index: i, series: seriesOf(g.id), short: GROUP_SHORT[g.id] || g.th}));
  const brands = (json.brands || []).map((b, i) => ({...b, index: i}));
  const point = new Map((json.points || []).map(([i, lat, lon, role]) => [i, {lat, lon, role: V.pointRoles?.[role] || ''}]));
  const rows = [];
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    const area = c.area[i] >= 0 ? json.areas[c.area[i]] : '';
    const district = c.district[i] >= 0 ? json.districts[c.district[i]] : '';
    const province = c.province[i] >= 0 ? json.provinces[c.province[i]] : '';
    if ((area && !index?.byId.has(area)) || (district && !index?.districtById.has(district))) { dropped++; continue; }
    const group = groups[c.group[i]] || groups.at(-1);
    const brand = c.brand[i] >= 0 ? brands[c.brand[i]] : null;
    const pt = point.get(i);
    const evidence = V.evidence?.[c.evidence[i]] || 'licensed';
    const row = {
      id: c.key[i], name: c.name[i] || '', index: i,
      group: group.index, groupId: group.id, series: group.series,
      brand, candidate: c.candidate[i] >= 0 ? brands[c.candidate[i]] : null,
      evidence, licensed: evidence === 'licensed', licence: c.licence[i] || null, quality: c.quality[i] === 1,
      area, district, province, admin: V.admin?.[c.admin[i]] || 'none',
      sourceType: V.sourceTypes?.[c.source[i]] || '', url: c.url[i] >= 0 ? json.urls[c.url[i]] : '', sources: c.sources[i] || 1,
      status: V.status?.[c.status[i]] || 'not_field_verified', brandStatus: V.brandStatus?.[c.brandStatus[i]] || '',
      longitude: pt ? pt.lon : null, latitude: pt ? pt.lat : null, pointRole: pt ? pt.role : '',
    };
    const a = area ? index.byId.get(area) : null, d = district ? index.districtById.get(district) : null;
    row.haystack = lower([row.name, brand?.name, brand?.nameTh, row.candidate?.name, row.licence, a?.name, a?.nameEn, d?.name].filter(Boolean).join(' '));
    rows.push(row);
  }
  return {meta: json.meta || {}, rows, groups, brands, sources: json.sources || [], dropped};
}

/**
 * Shared filter used by map, counters, charts, panel and table.
 * f = {search, group, quality, province, brand, count}; count '' = licensed rows only (default), 'all' = every row.
 * Area selection and area focus are applied by the caller (row scopes, see app.js).
 */
export function filterRows(rows, f = {}) {
  const q = lower(f.search).trim();
  const all = f.count === 'all';
  return rows.filter(r => {
    if (!all && !r.licensed) return false;
    if (f.group && r.groupId !== f.group) return false;
    if (f.quality === 'listed' && !r.quality) return false;
    if (f.province && r.province !== f.province) return false;
    if (f.brand && r.brand?.id !== f.brand) return false;
    return !q || r.haystack.includes(q);
  });
}

/** Counts for a selection (every number is a count of rows in the current counting mode). */
export function summarize(rows) {
  let quality = 0, points = 0, placed = 0, licensed = 0;
  const brands = new Set(), areas = new Set();
  for (const r of rows) {
    if (r.quality) quality++;
    if (hasPoint(r)) points++;
    if (r.area) { placed++; areas.add(r.area); }
    if (r.licensed) licensed++;
    if (r.brand) brands.add(r.brand.id);
  }
  return {count: rows.length, quality, points, placed, licensed, brands: brands.size, areas: areas.size};
}

/** Rows per group for a selection (every group listed, zero kept as a measured 0). */
export function mixOf(rows, groups) {
  const byGroup = groups.map(g => ({id: g.id, index: g.index, series: g.series, th: g.th, short: g.short, count: 0}));
  let quality = 0;
  for (const r of rows) { byGroup[r.group].count++; if (r.quality) quality++; }
  return {byGroup, quality};
}

export const safeURL = value => {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; }
  catch { return ''; }
};

/**
 * Production CityMETER deep links (route scheme observed in the production bundle, 2026-10-22). Production has
 * no pharmacy dataset yet, so the link opens the same area without a dataset parameter.
 */
export const PRODUCTION = 'https://landometer.com/v3/citymeter';
export function productionLink({province = '', district = '', area = ''} = {}) {
  if (!province) return PRODUCTION;
  if (area) return `${PRODUCTION}/${province}/S/${area}`;
  if (district) return `${PRODUCTION}/${province}/D/${district}`;
  return `${PRODUCTION}/${province}`;
}
