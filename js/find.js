/**
 * What the search box of CityMETER · Pharmacy knows by name: the entries js/shell/fuzzy.js matches and
 * js/shell/search.js lists (release 0.5.0; owner 2026-11-12 12:05, VERBATIM: “ศึกษาแนวคิดเรื่อง Fuzzy search แล้ว
 * implement กับ demo web ให้ได้ user benefit สูงสุดตาม user intent ในขณะนั้น และตาม product statement”).
 *
 * The product statement reads where pharmacies are, by area and by chain. So a name typed here opens the level that
 * answers it: a province, a เขต/อำเภอ or a แขวง/ตำบล (its pharmacies), a chain or a pharmacy type (where it is), or
 * one pharmacy (its page). A pharmacy is also found by its licence number. The order below is the order among equal
 * matches: places first, the larger place before the smaller.
 *
 * Pure: entries from the decoded dataset; no DOM, no numbers shown (a row names what it is and where).
 */
import {areaWord, districtWord} from './areas.js';
import {provinces} from './model.js';
import {PROVINCE_AKA, withoutMueang} from './shell/fuzzy.js';

export const SEARCH_KINDS = Object.freeze([
  {id: 'province', level: 'province', auto: true}, {id: 'district', level: 'district', auto: true}, {id: 'area', level: 'subdistrict', auto: true},
  {id: 'brand', auto: true}, {id: 'group', auto: true}, {id: 'store'},
]);
/** Words a name may begin with, or carry, that people add or leave out; an array is one word said two ways. */
export const SEARCH_HEADS = Object.freeze([['ร้านขายยา', 'ร้านยา'], 'ร้าน', 'ห้างขายยา', 'pharmacy', 'drugstore']);
/** What to try when nothing is found: the kinds of name this demo knows. */
export const SEARCH_HINT = 'ลองชื่อร้านยา เครือร้าน เลขใบอนุญาต แขวง/ตำบล เขต/อำเภอ หรือจังหวัด';

/** Every entry, the places and filters first, then the pharmacies (every row of every source). */
export function* searchEntries({data, index}) {
  const byCode = new Map(provinces().map(p => [p.code, p]));
  for (const p of provinces()) yield {id: p.code, kind: 'province', name: p.th, nameEn: p.en, aka: PROVINCE_AKA[p.th], codes: [p.code, p.dopa], province: p.code};
  const ofDistrict = new Map(), ofArea = new Map();
  for (const d of index.districtById.values()) {
    const p = byCode.get(d.province);
    ofDistrict.set(d.id, [d.name, d.nameEn, p?.th, p?.en]);
    yield {id: d.id, kind: 'district', name: d.name, nameEn: d.nameEn, also: withoutMueang(d.name), codes: [d.id], within: [p?.th, p?.en], province: d.province};
  }
  for (const a of index.byId.values()) {
    const p = byCode.get(a.province), d = index.districtById.get(a.district);
    ofArea.set(a.id, [a.name, a.nameEn, d?.name, d?.nameEn, p?.th, p?.en]);
    yield {id: a.id, kind: 'area', name: a.name, nameEn: a.nameEn, codes: [a.id], within: ofDistrict.get(a.district) || [p?.th, p?.en], province: a.province, area: a.id};
  }
  // A chain is listed when a row of some source names it (the filter offers no other).
  for (const b of data.brands) if (b.rows > 0) yield {id: b.id, kind: 'brand', name: b.name, aka: [b.nameTh]};
  for (const g of data.groups) yield {id: g.id, kind: 'group', name: g.th, nameEn: g.en, aka: [g.short]};
  const ofProvince = new Map();
  for (const r of data.rows) {
    let within = r.area ? ofArea.get(r.area) : r.district ? ofDistrict.get(r.district) : ofProvince.get(r.province);
    if (!within) { const p = byCode.get(r.province); within = [p?.th, p?.en]; ofProvince.set(r.province, within); }
    yield {id: r.id, kind: 'store', name: r.name, codes: r.licence ? [r.licence] : undefined, within, province: r.province, area: r.area, row: r};
  }
}

/** The line under a name in the list: what it is and where. Thai; an English page translates it part by part. */
export function searchNote(entry, {index, data}) {
  const province = code => provinces().find(p => p.code === code)?.th || '';
  if (entry.kind === 'province') return 'จังหวัด';
  if (entry.kind === 'district') return [districtWord(entry.province), province(entry.province)].filter(Boolean).join(' · ');
  if (entry.kind === 'area') return [areaWord(entry.province), index.byId.get(entry.id)?.districtName, province(entry.province)].filter(Boolean).join(' · ');
  if (entry.kind === 'brand') return 'เครือร้าน';
  if (entry.kind === 'group') return 'ประเภทร้าน';
  const r = entry.row, d = r.district ? index.districtById.get(r.district) : null;
  return [data.groups[r.group]?.short, d?.name, province(r.province)].filter(Boolean).join(' · ');
}
