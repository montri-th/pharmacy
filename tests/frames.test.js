import test from 'node:test';
import assert from 'node:assert/strict';
import {load, readJSON} from './helpers.js';
import {createFrameStore, provinceLocator} from '../js/frames.js';
import {buildAreaIndex, areaLocator, recordBounds} from '../js/areas.js';

const fresh = () => buildAreaIndex(readJSON('data/area-index.json'));

test('frames load on demand per province: idempotent, merged per level, outlines attached to the index records', async () => {
  const index = fresh(), calls = [], loads = [];
  const store = createFrameStore({index, version: '20261023-r1', fetchJSON: async url => { calls.push(url); return readJSON(`data/frames/${url.match(/frames\/(\w+)\.json/)[1]}.json`); }, onLoad: code => loads.push(code)});
  assert.equal(index.byId.get('102601').feature, null, 'the index works without geometry');
  assert.deepEqual(recordBounds(index.byId.get('102601')), [[100.5434, 13.7551], [100.5738, 13.7786]], 'bbox fallback before the outline arrives');
  await Promise.all([store.ensure('BKK'), store.ensure('BKK')]);
  assert.deepEqual(calls, ['data/frames/BKK.json?v=20261023-r1'], 'one request per province, versioned by the release');
  assert.deepEqual(loads, ['BKK']);
  assert.ok(index.byId.get('102601').feature, 'outline attached');
  assert.equal(store.areas().features.length, 180);
  assert.equal(store.districts().features.length, 50);
  const before = store.areas();
  await store.ensureMany(['NBI', 'BKK', '', 'XXX']);
  assert.notEqual(store.areas(), before, 'a new FeatureCollection after each load (setData sees a new object)');
  assert.deepEqual(store.loadedCodes().sort(), ['BKK', 'NBI']);
  const locate = areaLocator(index);
  assert.equal(locate([100.56, 13.77]), '102601', 'display locator over the loaded outlines (labels only, never membership)');
});

test('a failed province load is reported, never cached, and retried on the next request', async () => {
  const index = fresh();
  let fail = true;
  const errors = [];
  const store = createFrameStore({index, fetchJSON: async () => { if (fail) throw new Error('offline'); return readJSON('data/frames/UDN.json'); }, onError: (code, e) => errors.push([code, e.message])});
  await assert.rejects(store.ensure('UDN'), /offline/);
  assert.deepEqual(errors, [['UDN', 'offline']]);
  assert.equal(store.isLoaded('UDN'), false);
  fail = false;
  await store.ensure('UDN');
  assert.equal(store.isLoaded('UDN'), true);
  const bad = createFrameStore({index, fetchJSON: async () => ({areas: {}, districts: {}})});
  await assert.rejects(bad.ensure('UDN'), /Invalid frame file/);
});

test('province locator: the frame under a point, from the country-view geometry', () => {
  const {provincesGeo} = load();
  const at = provinceLocator(provincesGeo);
  assert.equal(at([100.5018, 13.7563]), 'BKK');
  assert.equal(at([98.9853, 18.7883]), 'CMI');
  assert.equal(at([102.7859, 17.4138]), 'UDN');
  assert.equal(at([90, 0]), '', 'outside Thailand');
});
