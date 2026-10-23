import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON, frameFiles, sha256} from './helpers.js';
import {hasPoint, filterRows, provinces, unitWords} from '../js/model.js';

test('pharmacies.json decodes to the 23,246 rows of the research snapshot, nothing dropped, ids unique', () => {
  const {raw, data} = load();
  assert.equal(raw.meta.rows, 23246);
  assert.equal(raw.meta.sheetStatus, 'research_only', 'the source sheet is a research master: the demo says so in its handoff');
  for (const k of Object.keys(raw.cols)) assert.equal(raw.cols[k].length, 23246, `column ${k} is complete`);
  assert.equal(data.rows.length, 23246);
  assert.equal(data.dropped, 0, 'every placed row resolves to a production frame');
  assert.equal(new Set(data.rows.map(r => r.id)).size, data.rows.length, 'row keys are unique');
});

test('decoded rows reconcile with the build receipt: evidence, admin methods, points, quality list, provinces', () => {
  const {raw, data} = load();
  const counts = {};
  const add = k => { counts[k] = (counts[k] || 0) + 1; };
  for (const r of data.rows) { add(`evidence.${r.evidence}`); add(`admin.${r.admin}`); if (hasPoint(r)) add('points'); if (r.quality) add('quality'); }
  assert.deepEqual(counts, raw.meta.counts);
  // Snapshot values (regression fixtures, never UI constants).
  assert.deepEqual({licensed: counts['evidence.licensed'], directory: counts['evidence.directory'], chain: counts['evidence.chain_source']}, {licensed: 18136, directory: 3384, chain: 1726});
  for (const mode of ['licensed', 'all']) {
    const by = {};
    // Rows the source does not place in any province are counted under '' (never in a province frame).
    for (const r of filterRows(data.rows, {count: mode === 'all' ? 'all' : ''})) by[r.province] = (by[r.province] || 0) + 1;
    assert.deepEqual(by, raw.meta.rowsByProvince[mode], `rows by province (${mode})`);
  }
  assert.equal(raw.meta.rowsByProvince.licensed.BKK, 3232);
  assert.equal(Object.keys(raw.meta.rowsByProvince.licensed).length, 77, 'the licence register covers all 77 provinces; every licensed row has one');
  assert.equal(raw.meta.rowsByProvince.all[''], 111, 'rows without a stated province (directory/chain sources) stay outside every frame');
});

test('counting unit: one ขย1 licence = one premises — licensed rows carry unique licence numbers, the others none', () => {
  const {data, licensed} = load();
  assert.equal(licensed.length, 18136);
  assert.ok(licensed.every(r => typeof r.licence === 'string' && r.licence.startsWith('ขย1')), 'every licensed row has a ขย1 number');
  assert.equal(new Set(licensed.map(r => r.licence)).size, licensed.length, 'no licence counted twice');
  assert.ok(data.rows.filter(r => !r.licensed).every(r => r.licence === null), 'directory and chain rows carry no licence number');
  assert.equal(filterRows(data.rows, {}).length, 18136, 'the default unit is licensed rows');
  assert.equal(filterRows(data.rows, {count: 'all'}).length, 23246);
  assert.deepEqual(unitWords().one, 'ร้าน');
  assert.deepEqual(unitWords('all').one, 'รายการ', 'every row of every source may repeat a storefront: “รายการ”, never “ร้าน”');
});

test('membership: a placed row sits in an existing subdistrict of its own district and province; the rest stop at district or province', () => {
  const {raw, data, index} = load();
  const codes = new Set(provinces().map(p => p.code));
  assert.equal(codes.size, 77);
  for (const r of data.rows) {
    if (r.area) {
      const a = index.byId.get(r.area);
      assert.ok(a, `area ${r.area}`);
      assert.equal(r.district, a.district, `${r.id} district`);
      assert.equal(r.province, a.province, `${r.id} province`);
      assert.ok(['names', 'unique', 'point'].includes(r.admin), `${r.id} admin ${r.admin}`);
    } else if (r.district) {
      assert.equal(r.admin, 'district');
      assert.equal(index.districtById.get(r.district)?.province, r.province);
    } else if (r.province) assert.equal(r.admin, 'province');
    else assert.equal(r.admin, 'none');
    if (r.province) assert.ok(codes.has(r.province), r.province);
  }
  // Every province's stated rows were matched to that province (point fallback is reported apart).
  for (const c of raw.meta.coverageCheck) assert.equal(c.stated, c.expected, c.province);
  assert.equal(raw.meta.coverageCheck.length, 77);
  assert.equal(raw.meta.provinceFromPoint, 7);
});

test('points are published source points inside Thailand, never invented: most rows have none', () => {
  const {raw, data} = load();
  const withPoint = data.rows.filter(hasPoint);
  assert.equal(withPoint.length, raw.meta.counts.points);
  assert.ok(withPoint.length < data.rows.length * 0.2, 'about one row in six carries a point');
  for (const r of withPoint) {
    assert.ok(r.longitude > 97 && r.longitude < 106 && r.latitude > 5 && r.latitude < 21, `${r.id} inside Thailand`);
    assert.ok(r.pointRole, `${r.id} keeps the role of its point`);
  }
  assert.ok(data.rows.filter(r => !hasPoint(r)).every(r => r.longitude === null && r.latitude === null), 'no (0, 0) stand-ins');
  assert.equal(data.rows.filter(r => r.licensed && hasPoint(r)).length, 2573, 'licensed rows with a point (snapshot fixture)');
});

test('publication hygiene: no phone, address, map link, notes or raw records; links are https and never a private document', () => {
  const {raw} = load();
  assert.deepEqual(raw.meta.excludedFields, ['public_business_phone', 'address', 'map_url', 'notes', 'source_observation_ids', 'raw source records (08_SOURCE_RECORDS)']);
  const text = JSON.stringify(raw);
  for (const k of ['phone', 'address', 'map_url', 'source_observation_ids', 'latitude', 'longitude']) assert.ok(!Object.keys(raw.cols).includes(k), k);
  assert.ok(!/(docs|drive)\.google\.com/.test(text), 'no Google document link');
  assert.ok(raw.urls.every(u => /^https:\/\//.test(u)), 'source links are https');
  assert.ok(!/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/.test(text), 'no telephone-like numbers');
});

test('chains: 32 banners approved by the sheet; candidates that resemble a chain are kept apart, never counted in it', () => {
  const {raw, data} = load();
  assert.equal(data.brands.length, 32);
  const rows = new Map(), lic = new Map();
  for (const r of data.rows) if (r.brand) { rows.set(r.brand.id, (rows.get(r.brand.id) || 0) + 1); if (r.licensed) lic.set(r.brand.id, (lic.get(r.brand.id) || 0) + 1); }
  for (const b of data.brands) {
    assert.equal(b.scope, 'approved', b.name);
    assert.equal(rows.get(b.id) || 0, b.rows, `${b.name} rows`);
    assert.equal(lic.get(b.id) || 0, b.rowsLicensed, `${b.name} licensed rows`);
    assert.equal(b.logo, 'not_collected', 'no logos were collected in this round');
  }
  assert.ok(data.rows.every(r => !(r.brand && r.candidate)), 'a row is either linked to a banner or a pending candidate, never both');
  assert.match(raw.meta.logos, /not collected/);
});

test('boundaries: 7,436 subdistricts, 928 districts and 77 provinces from production; per-province frames match the index; receipts bound by hash', () => {
  const {index, indexJSON, provincesGeo} = load();
  assert.equal(index.areas.length, 7436);
  assert.equal(index.districts.length, 928);
  assert.equal(index.provinces.length, 77);
  assert.equal(provincesGeo.features.length, 77);
  assert.ok(index.areas.every(a => a.km2 > 0 && Array.isArray(a.label) && Array.isArray(a.bbox)), 'production area, label and bbox for every subdistrict');
  assert.equal(index.districts.reduce((s, d) => s + d.areas.length, 0), 7436, 'every subdistrict belongs to exactly one district');
  const files = frameFiles();
  assert.equal(files.length, 77);
  let areas = 0;
  for (const f of files) {
    const code = f.replace('.json', ''), frame = readJSON(`data/frames/${f}`), p = index.provinceById.get(code);
    assert.ok(p, code);
    assert.equal(frame.metadata.province, code);
    assert.equal(frame.areas.features.length, p.areaCount, `${code} subdistricts`);
    assert.equal(frame.districts.features.length, p.districtCount, `${code} districts`);
    for (const ft of frame.areas.features) {
      assert.equal(index.byId.get(String(ft.id ?? ft.properties.id))?.province, code);
      assert.ok(['Polygon', 'MultiPolygon'].includes(ft.geometry.type));
    }
    areas += frame.areas.features.length;
  }
  assert.equal(areas, 7436);
  const receipts = readJSON('data/boundary-receipts.json');
  assert.equal(receipts.receipts.length, 7514, '7,436 subdistrict geometries + 77 province attribute files + the country list');
  assert.equal(indexJSON.metadata.receipts, 7514);
  for (const r of receipts.receipts) { assert.match(r.sha256, /^[a-f0-9]{64}$/); assert.match(r.url, /^https:\/\/landometer\.com\/api\/v2\/citymeter-v3\/base\/info\//); }
  // Same recipe as scripts/build-boundaries.py: sha256(json.dumps(sorted((id, sha256) …))) with Python's default separators.
  const pairs = receipts.receipts.map(r => [r.id, r.sha256]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const python = `[${pairs.map(([id, h]) => `["${id}", "${h}"]`).join(', ')}]`;
  assert.equal(sha256(Buffer.from(python)), indexJSON.metadata.receiptsSha256);
});
