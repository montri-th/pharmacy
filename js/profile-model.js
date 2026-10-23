/**
 * Reading-panel view models. Pure: no DOM, no map.
 *
 * Every profile reads `scopeRows` (filters before any area selection) so ranks and comparisons keep the
 * whole selection as reference. A row is a licensed premises in the default counting mode, a dataset row
 * in “ทุกรายการ”. Chain links are the sheet's banner assignments; points are published source points and
 * are never upgraded; area membership is the matched administrative code (row.admin says how).
 */
import {mixOf, hasPoint} from './model.js';
import {summarizeAreas, summarizeDistricts, byDensity, byCount, levelWords} from './areas.js';
import {MIN_AREA_ROWS} from './area-insight.js';

/** Lists: chain rows first (by chain name), then by name — a neutral, stable order (no popularity data exists). */
const COLLATOR = new Intl.Collator('th');
export const listOrder = (a, b) => Number(Boolean(b.brand)) - Number(Boolean(a.brand)) || COLLATOR.compare(a.brand?.name || '', b.brand?.name || '') ||
  COLLATOR.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Chains (approved banners) present in rows, most rows first. */
export function chainsIn(rows, limit = 12) {
  const m = new Map();
  for (const r of rows) if (r.brand) { const e = m.get(r.brand.id) || {brand: r.brand, count: 0}; e.count++; m.set(r.brand.id, e); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.brand.name.localeCompare(b.brand.name)).slice(0, limit);
}

/** Density ranking of areas for a selection (eligible ≥ MIN_AREA_ROWS rows); the rest ranked by rows after. */
export function rankAreas(rows, index, {minRows = MIN_AREA_ROWS, province = '', district = ''} = {}) {
  const all = summarizeAreas(rows, index, {province, district});
  const eligible = all.filter(a => a.count >= minRows).sort(byDensity);
  const small = all.filter(a => a.count < minRows).sort(byCount);
  return {eligible, small, all: [...eligible, ...small], minRows};
}

export function buildOverview(scopeRows, index, {province = ''} = {}) {
  const ranking = rankAreas(scopeRows, index, {province});
  return {ranking, chains: chainsIn(scopeRows, 12), districts: summarizeDistricts(scopeRows, index, {province}).sort(byCount)};
}

/**
 * EVID-05 state of a selection. The ขย1 register is national, so an area with no row is a measured zero
 * (“0 ในทะเบียน”), never no_data; `noData` (optional) lets a caller mark uncovered frames.
 */
const selectionState = (count, noData = false) => (noData ? 'no_data' : count ? 'measured' : 'measured_zero');

/** Rows of the selection that are placed only at district / province level (their subdistrict is unknown). */
export function unplacedIn(rows, {district = '', province = ''} = {}) {
  let n = 0;
  for (const r of rows) {
    if (r.area) continue;
    if (district ? r.district === district : province ? r.province === province && !r.district : false) n++;
  }
  return n;
}

export function buildAreaProfile(scopeRows, areaId, index, groups) {
  const area = index.byId.get(areaId);
  if (!area) return null;
  const ranking = rankAreas(scopeRows, index);
  const mine = scopeRows.filter(r => r.area === areaId);
  const pos = ranking.eligible.findIndex(a => a.id === areaId);
  const district = index.districtById.get(area.district) || null;
  const coverageState = selectionState(mine.length);
  return {
    area, district, words: levelWords(area.province), count: mine.length, km2: area.km2,
    density: area.km2 ? mine.length / area.km2 : null, coverageState, scopeCount: scopeRows.length,
    rank: pos >= 0 ? pos + 1 : null, rankOf: ranking.eligible.length, minRows: ranking.minRows,
    points: mine.filter(hasPoint).length, unplacedInDistrict: unplacedIn(scopeRows, {district: area.district}),
    ...mixOf(mine, groups), chains: chainsIn(mine, 16), rows: [...mine].sort(listOrder),
  };
}

export function buildDistrictProfile(scopeRows, districtId, index, groups) {
  const district = index.districtById.get(districtId);
  if (!district) return null;
  const mine = scopeRows.filter(r => r.district === districtId);
  const ranking = rankAreas(mine, index, {district: districtId});
  // Same eligibility as the areas: only districts with ≥ MIN_AREA_ROWS rows compete on density.
  const all = summarizeDistricts(scopeRows, index).filter(d => d.count >= MIN_AREA_ROWS).sort(byDensity);
  const pos = all.findIndex(d => d.id === districtId);
  const coverageState = selectionState(mine.length);
  return {
    district, words: levelWords(district.province), count: mine.length, km2: district.km2,
    density: district.km2 ? mine.length / district.km2 : null, coverageState, scopeCount: scopeRows.length,
    rank: pos >= 0 ? pos + 1 : null, rankOf: all.length, minRows: MIN_AREA_ROWS, areas: ranking.all, areaTotal: district.areaTotal,
    points: mine.filter(hasPoint).length, unplaced: mine.filter(r => !r.area).length,
    ...mixOf(mine, groups), chains: chainsIn(mine, 16), rows: mine,
  };
}

/**
 * A building the map draws, with the rows whose published points fall inside it (building-join.js):
 * sel = {key, kind: 'osm', rows, height}. Not a venue: no name.
 */
export function buildBuildingProfile(sel, index, groups) {
  if (!sel?.rows?.length) return null;
  const rows = [...sel.rows].sort(listOrder);
  const area = index.byId.get(rows[0].area) || null;
  const areaIds = [...new Set(rows.map(r => r.area))];
  return {key: sel.key, kind: sel.kind || 'osm', rows, count: rows.length, area, areaCount: areaIds.length, words: levelWords(rows[0].province),
    height: Number.isFinite(sel.height) ? sel.height : null, chains: chainsIn(rows, 6), ...mixOf(rows, groups)};
}

/**
 * Store detail. `allRows` = every row of the dataset (both counting modes), used only to show the other
 * rows of the same chain in the same area — rows that may describe the same storefront (the sheet keeps
 * them apart when identity evidence is insufficient), always labelled as such.
 */
export function buildStoreDetail(row, {scopeRows, allRows = [], index, groups, building = null}) {
  if (!row) return null;
  const area = row.area ? index.byId.get(row.area) || null : null;
  const district = row.district ? index.districtById.get(row.district) || null : null;
  const sameBrand = row.brand ? scopeRows.filter(r => r.brand?.id === row.brand.id && r.id !== row.id) : [];
  const sameBrandHere = row.brand && row.area ? allRows.filter(r => r.brand?.id === row.brand.id && r.area === row.area && r.id !== row.id).sort(listOrder) : [];
  const sameArea = row.area ? scopeRows.filter(r => r.area === row.area && r.id !== row.id && r.group === row.group).sort(listOrder).slice(0, 6) : [];
  return {row, area, district, words: levelWords(row.province), group: groups[row.group], building,
    sameBrand: {count: sameBrand.length, rows: sameBrand.sort(listOrder).slice(0, 8), areas: new Set(sameBrand.map(r => r.area).filter(Boolean)).size},
    sameBrandHere, sameArea};
}
