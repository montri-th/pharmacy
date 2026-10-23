import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers.js';
import {summarizeAreaInsight, filterAreaRows, MIN_AREA_ROWS, SMALL_SELECTION} from '../js/area-insight.js';
import {summarizeAreas, combinedDensity, levelWords, byDensity} from '../js/areas.js';
import {filterRows} from '../js/model.js';
import {buildAreaModel} from '../js/map-layers.js';
import {buildProvinceModel} from '../js/provinces.js';

test('first Aha (snapshot fixture): the three densest แขวง of the leading province with ≥ 30 licensed pharmacies, Σrows ÷ Σkm²', () => {
  const {data, index, licensed} = load();
  const i = summarizeAreaInsight(filterRows(data.rows, {}), index);
  assert.equal(i.mode, 'density');
  assert.equal(i.minRows, MIN_AREA_ROWS);
  assert.equal(i.home, 'BKK');
  assert.deepEqual(i.areaIds, ['102601', '103901', '100704'], 'ดินแดง · คลองเตยเหนือ · ลุมพินี');
  assert.deepEqual(i.areas.map(a => a.count), [75, 36, 34]);
  assert.equal(i.count, 145);
  const km2 = i.areas.reduce((s, a) => s + a.km2, 0);
  assert.ok(Math.abs(i.density - 145 / km2) < 1e-9, 'combined density is a ratio of totals, not a mean of ratios');
  assert.ok(Math.abs(i.density - 14.5) < 0.05, `${i.density}`);
  // Benchmark: the whole leading province (its licensed rows ÷ its production km²).
  assert.equal(i.homeRows, 3232);
  assert.ok(Math.abs(i.baselineDensity - 3232 / index.provinceById.get('BKK').km2) < 1e-9);
  assert.ok(Math.abs(i.baselineDensity - 2.06) < 0.01, `${i.baselineDensity}`);
  // Second finding: the densest eligible area outside the leading province.
  assert.equal(i.outside.id, '410101', 'ตำบลหมากแข้ง อุดรธานี');
  assert.ok(Math.abs(i.outside.density - 11.7) < 0.05);
  // Every eligible area is ranked; the three are the top of the leading province.
  const all = summarizeAreas(licensed, index).filter(a => a.count >= MIN_AREA_ROWS).sort(byDensity);
  assert.deepEqual(all.filter(a => a.province === 'BKK').slice(0, 3).map(a => a.id), i.areaIds);
  assert.equal(all[0].id, i.areaIds[0], 'the leader is the densest eligible area in the country');
  assert.ok(i.areas.every(a => a.count >= MIN_AREA_ROWS));
});

test('every row (“ทุกรายการ”) changes the finding and says so: chain branch lists concentrate in central Bangkok', () => {
  const {data, index} = load();
  const i = summarizeAreaInsight(filterRows(data.rows, {count: 'all'}), index);
  assert.equal(i.mode, 'density');
  assert.deepEqual(i.areas.map(a => a.name), ['สุริยวงศ์', 'ถนนพญาไท', 'สีลม']);
  assert.equal(i.count, 101);
});

test('small selections switch to a count Aha in the province holding the most placed rows', () => {
  const {data, index} = load();
  const boots = filterRows(data.rows, {brand: data.brands.find(b => b.name === 'Boots').id, count: 'all'});
  assert.ok(boots.length > 0 && boots.length < SMALL_SELECTION);
  const i = summarizeAreaInsight(boots, index);
  assert.equal(i.mode, 'count');
  assert.equal(i.home, 'BKK', 'Bangkok holds the most Boots rows');
  assert.equal(i.areas.length, 3);
  assert.ok(i.areas.every(a => a.province === 'BKK'));
  assert.ok(Math.abs(i.share - (i.count / boots.length) * 100) < 1e-9);
  assert.equal(filterAreaRows(boots, new Set(i.areaIds)).length, i.count);
  const udn = summarizeAreaInsight(filterRows(data.rows, {province: 'UDN'}), index);
  assert.equal(udn.mode, 'count', 'one rural province is a small selection');
  assert.equal(udn.home, 'UDN');
  assert.equal(summarizeAreaInsight([], index).areas.length, 0);
});

test('area model: EVID-05 states — the national register makes an empty subdistrict a measured zero, never no data', () => {
  const {data, index} = load();
  const rows = filterRows(data.rows, {});
  const all = buildAreaModel(rows, index);
  assert.equal(all.areas.length, 7436);
  assert.equal(all.noDataCount, 0);
  assert.ok(all.zeroCount > 0);
  assert.ok(all.areas.filter(a => a.state === 'measured_zero').every(a => a.count === 0 && a.fill === all.classes.zero.fill));
  assert.equal(all.classes.scaleId, 'density.area');
  assert.equal(all.classes.method, 'geometric-1-2-5');
  const bkk = buildAreaModel(rows, index, {province: 'BKK'});
  assert.equal(bkk.areas.length, 180, 'Bangkok has 180 แขวง frames');
  const uncovered = new Set(['100101']);
  assert.equal(buildAreaModel(rows, index, {province: 'BKK', noDataIds: uncovered}).byId.get('100101').state, 'no_data', 'the no_data treatment stays available');
  assert.deepEqual(combinedDensity([{count: 10, km2: 1}, {count: 0, km2: 4}]), {count: 10, km2: 5, density: 2});
});

test('province frames count rows per province (a total, not a density) in the counting unit', () => {
  const {data, provincesGeo, raw} = load();
  const m = buildProvinceModel(filterRows(data.rows, {}), provincesGeo);
  assert.equal(m.provinces.length, 77);
  for (const p of m.provinces) assert.equal(p.count, raw.meta.rowsByProvince.licensed[p.code] || 0, p.code);
  assert.equal(m.classes.scaleId, 'count');
  assert.equal(m.zeroCount, 0);
  const none = buildProvinceModel([], provincesGeo);
  assert.ok(none.provinces.every(p => p.state === 'measured_zero'));
});

test('level words follow the province: เขต/แขวง in Bangkok, อำเภอ/ตำบล elsewhere', () => {
  assert.deepEqual(levelWords('BKK'), {district: 'เขต', area: 'แขวง'});
  assert.deepEqual(levelWords('UDN'), {district: 'อำเภอ', area: 'ตำบล'});
});
