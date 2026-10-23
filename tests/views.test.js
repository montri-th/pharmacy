import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './helpers.js';
import {buildOverview, buildAreaProfile, buildDistrictProfile, buildStoreDetail, buildBuildingProfile, listOrder, unplacedIn} from '../js/profile-model.js';
import {renderOverview, renderArea, renderDistrict, renderBuilding, renderStore, renderFilterChips, provenance, dens} from '../js/panel.js';
import {summarizeAreaInsight} from '../js/area-insight.js';
import {summarize, productionLink, filterRows, unitWords, hasPoint} from '../js/model.js';
import {buildChartModel, areaMatrix, areaQuality} from '../js/chart-model.js';
import {buildBreadcrumb, renderBreadcrumb, breadcrumbText, productionHref} from '../js/breadcrumb.js';
import {CUES, CUE_PATHS, GROUP_SERIES, QUALITY_SERIES, cueMarkup, seriesOf} from '../js/cues.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const ctxFor = (data, index, mode = 'licensed', filtered = false) => ({meta: data.meta, sources: data.sources, unit: unitWords(mode), index, filtered});

test('every panel view ends with dataset · source · date · boundary and says what one counted unit is', () => {
  const {data, index} = load();
  const rows = filterRows(data.rows, {});
  const ctx = ctxFor(data, index);
  const insight = summarizeAreaInsight(rows, index);
  const store = rows.find(r => r.brand && r.area && hasPoint(r));
  const views = {
    overview: renderOverview({insight, summary: summarize(insight.areas.flatMap(a => a.rows)), overview: buildOverview(rows, index), focusMode: 'auto', classOf: () => '#000', provinces: [], scope: {km2: 513000}, province: '', ctx}),
    area: renderArea(buildAreaProfile(rows, '102601', index, data.groups), ctx),
    district: renderDistrict(buildDistrictProfile(rows, '1026', index, data.groups), () => '#000', ctx),
    store: renderStore(buildStoreDetail(store, {scopeRows: rows, allRows: data.rows, index, groups: data.groups}), ctx),
    building: renderBuilding(buildBuildingProfile({key: 'osm:1', kind: 'osm', rows: rows.filter(r => r.area === '102601' && hasPoint(r)).slice(0, 3), height: 24}, index, data.groups), ctx),
  };
  for (const [name, html] of Object.entries(views)) {
    const t = text(html);
    assert.ok(t.includes('ชุดข้อมูล CityMETER Pharmacy'), `${name}: dataset`);
    assert.ok(t.includes('ทะเบียนผู้รับอนุญาตขายยาแผนปัจจุบัน (ขย1) อย.'), `${name}: source`);
    assert.ok(t.includes('ทะเบียน ณ 28 พ.ค. 2569') && t.includes('ตรวจแหล่ง 22 ต.ค. 2569'), `${name}: dates`);
    assert.ok(/ขอบเขต \S/.test(t), `${name}: boundary`);
    assert.ok(t.includes('ร้าน = ใบอนุญาต ขย1 หนึ่งใบในทะเบียน'), `${name}: unit`);
    assert.ok(t.includes('ไม่ได้ยืนยันว่าร้านเปิดอยู่วันนี้'), `${name}: licence status is not an opening check`);
  }
  const o = text(views.overview);
  assert.ok(o.includes('14.5 ร้าน/ตร.กม.'));
  assert.ok(o.includes('ทั้งกรุงเทพมหานคร 2.1 ร้าน/ตร.กม.'), 'the benchmark is the leading province');
  assert.ok(o.includes('นอกกรุงเทพมหานคร แน่นที่สุด: ตำบลหมากแข้ง อุดรธานี 11.7 ร้าน/ตร.กม.'));
  assert.ok(o.includes('จัดอันดับเฉพาะพื้นที่ที่มีอย่างน้อย 30 ร้าน'));
  assert.ok(text(views.building).includes('ไม่ได้ยืนยันว่าร้านตั้งอยู่ในอาคารนี้'));
  for (const html of Object.values(views)) assert.ok(!text(html).includes('ตั้งอยู่ใน อาคาร') && !/สาขาอื่น/.test(text(html)), 'no located-inside or branch claim');
  // “ทุกรายการ”: unit words and the provenance follow the counting mode.
  const all = provenance(ctxFor(data, index, 'all'), 'x');
  assert.ok(text(all).includes('รายการ = แถวในชุดข้อมูลจากหลายแหล่ง ร้านเดียวกันอาจมีมากกว่าหนึ่งรายการ'));
  assert.match(all, /href="https:\/\/www\.acc-pharm\.com\/DrugStore"/);
});

test('missing stays missing: a row without a point or a licence match says so — never 0, never “no licence”', () => {
  const {data, index} = load();
  const ctx = ctxFor(data, index, 'all');
  const r = data.rows.find(x => !x.licensed && !hasPoint(x) && x.area);
  const t = text(renderStore(buildStoreDetail(r, {scopeRows: data.rows, allRows: data.rows, index, groups: data.groups}), ctx));
  assert.ok(t.includes('แหล่งข้อมูลไม่เผยแพร่พิกัด'));
  assert.ok(t.includes('ยังไม่จับคู่กับใบอนุญาตในทะเบียน'));
  assert.ok(t.includes('ไม่ได้แปลว่าร้านไม่มีใบอนุญาต'));
  // An area with no licensed pharmacy in the register is a measured zero with its source date.
  const empty = index.areas.find(a => !data.rows.some(x => x.licensed && x.area === a.id));
  const z = text(renderArea(buildAreaProfile(filterRows(data.rows, {}), empty.id, index, data.groups), ctxFor(data, index)));
  assert.ok(z.includes('ทะเบียน ขย1 ไม่มีร้านยาที่ระบุพื้นที่นี้ (ข้อมูล ณ 28 พ.ค. 2569)'));
  assert.ok(z.includes('เป็นศูนย์ตามแหล่งข้อมูล ไม่ใช่การสำรวจภาคสนาม'));
});

test('a row placed only at district level is not inside any subdistrict colour, and the panels say how many', () => {
  const {data, index} = load();
  const rows = filterRows(data.rows, {count: 'all'});
  const r = rows.find(x => !x.area && x.district);
  assert.ok(r, 'district-level rows exist');
  const p = buildDistrictProfile(rows, r.district, index, data.groups);
  assert.equal(p.unplaced, unplacedIn(rows, {district: r.district}));
  assert.ok(p.unplaced >= 1);
  assert.ok(text(renderDistrict(p, () => '#000', ctxFor(data, index, 'all'))).includes('ที่ระบุ'));
});

test('charts: density bars over eligible areas, area × group matrix with equal cells, quality share per area', () => {
  const {data, index} = load();
  const rows = filterRows(data.rows, {});
  const m = buildChartModel(rows, index, data.groups);
  assert.equal(m.mode, 'density');
  assert.equal(m.areas.length, 20);
  for (let i = 1; i < m.areas.length; i++) assert.ok(m.areas[i - 1].density >= m.areas[i].density);
  assert.ok(m.areas.every(a => a.count >= m.minRows));
  const mx = areaMatrix(m);
  assert.equal(mx.cells.length, 12 * data.groups.length);
  for (const a of mx.areas) assert.equal(mx.cells.filter(c => c.areaId === a.id).reduce((s, c) => s + c.count, 0), a.count, 'cells add up to the area');
  for (const q of areaQuality(m)) { assert.ok(q.listed <= q.total); assert.ok(Math.abs(q.share - q.listed / q.total) < 1e-12); }
});

test('breadcrumb follows production: ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล with /D/ and /S/ deep links and no dataset parameter', () => {
  const {index} = load();
  const area = index.byId.get('102601');
  const crumbs = buildBreadcrumb({province: 'BKK', area});
  assert.equal(breadcrumbText(crumbs), 'ประเทศไทย › กรุงเทพมหานคร › เขตดินแดง › แขวงดินแดง');
  assert.equal(crumbs.at(-1).current, true);
  assert.equal(crumbs[2].href, 'https://landometer.com/v3/citymeter/BKK/D/1026');
  assert.equal(productionHref(crumbs), 'https://landometer.com/v3/citymeter/BKK/S/102601');
  const html = renderBreadcrumb(crumbs);
  assert.ok(html.includes('aria-current="location"') && html.includes('crumb-ellipsis'), 'four levels fold on narrow screens');
  assert.equal(breadcrumbText(buildBreadcrumb({area: index.byId.get('410101')})), 'ประเทศไทย › อุดรธานี › อำเภอเมืองอุดรธานี › ตำบลหมากแข้ง');
  assert.equal(productionLink(), 'https://landometer.com/v3/citymeter');
  assert.equal(productionLink({province: 'UDN'}), 'https://landometer.com/v3/citymeter/UDN');
});

test('pharmacy groups bind to LDS series by stable id with the series shape cue; the quality list has its own series', () => {
  const {data} = load();
  assert.deepEqual(CUES, ['circle', 'square', 'triangle', 'diamond', 'cross', 'star', 'hexagon', 'ring', 'dash', 'plus']);
  assert.deepEqual(GROUP_SERIES, {chain: 7, health_beauty: 1, regional: 3, public: 4, independent: 8});
  assert.ok(!Object.values(GROUP_SERIES).includes(QUALITY_SERIES) && !Object.values(GROUP_SERIES).includes(6), 'no star: it would read as a rating');
  for (const g of data.groups) assert.equal(g.series, seriesOf(g.id));
  for (const name of CUES) assert.ok(CUE_PATHS[name].startsWith('M'));
  assert.match(cueMarkup(8), /class="cue-shape category-8".*data-cue="ring".*aria-hidden="true"/);
});

test('lists are stable and neutral: chains first by name, then by name (no popularity data exists)', () => {
  const {data} = load();
  const rows = data.rows.filter(r => r.area === '102601').sort(listOrder);
  const firstPlain = rows.findIndex(r => !r.brand);
  assert.ok(firstPlain > 0 && rows.slice(firstPlain).every(r => !r.brand));
  assert.deepEqual([...rows].sort(listOrder).map(r => r.id), rows.map(r => r.id), 'deterministic');
});

test('filter chips escape user text, name the counting unit and offer one clear-all', () => {
  const html = renderFilterChips({search: '<b>ร้านยา</b>', group: 'chain', quality: 'listed', province: 'BKK', brand: '', count: 'all'},
    {group: {chain: 'เครือร้านยา'}, province: {BKK: 'กรุงเทพมหานคร'}, brand: {}});
  assert.ok(!html.includes('<b>'));
  assert.ok(text(html).includes('นับทุกรายการ (อาจซ้ำ)') && text(html).includes('เฉพาะร้านยาคุณภาพ'));
  assert.equal((html.match(/data-id="all"/g) || []).length, 1);
});

test('density format: a measured non-zero density never prints as zero; labels, panel and charts share it', () => {
  assert.equal(dens(1 / 300), '0.003', 'one pharmacy in a 300 km² rural subdistrict');
  assert.equal(dens(0.0004), '<0.001');
  assert.equal(dens(0.0549), '0.055');
  assert.equal(dens(0.42), '0.42');
  assert.equal(dens(16.73), '16.7');
  assert.equal(dens(0), '0');
  assert.equal(dens(null), '—');
});
