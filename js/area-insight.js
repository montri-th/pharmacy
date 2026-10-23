/**
 * First Aha: where pharmacies are densest — the top แขวง/ตำบล of the leading province.
 *
 * Metric: rows per km² of the subdistrict (density.area; denominator = production areaSqm). In the
 * default counting mode a row is a licensed premises (ขย1 register), so the ranking is not inflated by a
 * storefront listed by several sources. Eligibility (declared, not a weight): only areas with at least
 * MIN_AREA_ROWS rows in the current selection compete, so a 0.2 km² subdistrict with a handful of rows
 * cannot top the list on noise.
 *
 * National data, one 3D frame: the leader is the best-ranked area; the Aha shows up to three best-ranked
 * areas of the LEADER'S PROVINCE (one coherent city to frame in 3D), and names the best-ranked area
 * outside that province as a second finding. The benchmark is the leader's whole province (its rows ÷ its
 * production km²) — a ratio of raw totals with a declared universe.
 *
 * Small selections (fewer than SMALL_SELECTION rows, e.g. one chain or one rural province) switch to a
 * count Aha: the province holding the most placed rows of the selection (one coherent frame), its areas
 * holding the most rows, with their share of the selection; the area with the most rows outside that
 * province is the second finding. Snapshot values in the handoff JSON are regression fixtures, never UI
 * constants.
 */
import {summarizeAreas, byDensity, byCount, combinedDensity} from './areas.js';

export const MIN_AREA_ROWS = 30;
export const SMALL_SELECTION = 1000;

export function summarizeAreaInsight(rows = [], index, {minRows = MIN_AREA_ROWS, limit = 3} = {}) {
  const selected = Array.isArray(rows) ? rows : [];
  const summaries = summarizeAreas(selected, index);
  const eligible = summaries.filter(a => a.count >= minRows);
  const mode = selected.length >= SMALL_SELECTION && eligible.length >= 3 ? 'density' : 'count';
  const ranked = mode === 'density' ? [...eligible].sort(byDensity) : [...summaries].sort(byCount);
  let home = ranked[0]?.province || '';
  if (mode === 'count') {
    const placed = new Map();
    for (const r of selected) if (r.area && r.province) placed.set(r.province, (placed.get(r.province) || 0) + 1);
    home = [...placed].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || home;
  }
  const areas = ranked.filter(a => a.province === home).slice(0, limit);
  const combined = combinedDensity(areas);
  const homeRows = home ? selected.filter(r => r.province === home).length : 0;
  const homeKm2 = index.provinceById.get(home)?.km2 || null;
  const baseline = homeKm2 ? homeRows / homeKm2 : null;
  const outsideArea = ranked.find(a => a.province !== home) || null;
  const placed = selected.filter(r => r.area).length;
  return {
    mode, minRows, areas, areaIds: areas.map(a => a.id), home,
    count: combined.count, km2: combined.km2, density: combined.density,
    homeRows, homeKm2, baselineDensity: baseline,
    ratio: baseline && combined.density ? combined.density / baseline : null,
    share: selected.length ? (combined.count / selected.length) * 100 : 0,
    totalRows: selected.length, placedRows: placed, areaCount: summaries.length, eligibleCount: eligible.length,
    outside: outsideArea ? {id: outsideArea.id, name: outsideArea.name, province: outsideArea.province, district: outsideArea.district,
      districtName: outsideArea.districtName, count: outsideArea.count, density: outsideArea.density} : null,
  };
}

/** Rows inside a set of area ids (membership = the row's own matched subdistrict). */
export function filterAreaRows(rows, areaIdsSet) {
  if (!(areaIdsSet instanceof Set) || !areaIdsSet.size) return [];
  return (Array.isArray(rows) ? rows : []).filter(r => areaIdsSet.has(r.area));
}
