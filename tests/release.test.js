/**
 * Release consistency: one cache tag on every entry file AND every ES module (import map), one product version
 * across package.json, design-intent.json and the handoff JSON, and publication hygiene of the whole tree.
 * A browser must never pair an entry from this release with a module cached from the previous one (GitHub Pages
 * caches ~10 min); the province frame files take the same tag from import.meta.url (js/app.js#RELEASE).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {ROOT, readJSON} from './helpers.js';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const modules = () => [
  ...readdirSync(join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'launch.js').map(f => `js/${f}`),
  ...readdirSync(join(ROOT, 'js/vendor')).filter(f => f.endsWith('.js')).map(f => `js/vendor/${f}`),
];

test('one cache tag on every entry file and every module in the import map', () => {
  const tags = [...html.matchAll(/\?v=([0-9A-Za-z-]+)/g)].map(m => m[1]);
  assert.ok(tags.length >= 6 + modules().length, `${tags.length} tags`);
  const tag = tags[0];
  assert.match(tag, /^\d{8}-r\d{1,2}$/);
  assert.deepEqual([...new Set(tags)], [tag], 'a single cache tag across index.html');

  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const expected = Object.fromEntries(modules().sort().map(m => [`./${m}`, `./${m}?v=${tag}`]));
  assert.deepEqual(map, expected, 'every ES module (except the classic launch.js) is mapped to its tagged URL');
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'the import map precedes every module script');

  // Every static relative import in js/ resolves to a mapped module.
  for (const m of modules()) {
    const src = readFileSync(join(ROOT, m), 'utf8');
    for (const [, spec] of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const resolved = new URL(spec, `https://x.test/${m}`).pathname.slice(1);
      assert.ok(map[`./${resolved}`], `${m} imports ${spec} → ${resolved} is not in the import map`);
    }
  }
  // The frame files are versioned with the same tag, read from the module URL (not a second constant).
  assert.match(readFileSync(join(ROOT, 'js/app.js'), 'utf8'), /new URL\(import\.meta\.url\)\.searchParams\.get\('v'\)/);
  assert.equal(readJSON('handoff/product-brief.json').delivery.cacheTag.slice(3, 3 + tag.length), tag, 'the brief names the shipped tag');
});

test('one product version across package.json, design intent and the handoff JSON', () => {
  const version = readJSON('package.json').version;
  for (const f of ['design-intent.json', 'handoff/product-brief.json', 'handoff/implementation-plan.json', 'handoff/product-statement.json']) {
    assert.equal(readJSON(f).productVersion, version, f);
  }
  for (const f of ['handoff/product-brief.json', 'handoff/implementation-plan.json', 'handoff/product-statement.json']) {
    const doc = readJSON(f);
    assert.equal(doc.schemaVersion, '1.5.0', f);
    assert.equal(doc.productId, 'citymeter-pharmacy', f);
  }
  assert.equal(readJSON('handoff/handoff.schema.json').properties.productId.const, 'citymeter-pharmacy');
});

test('publication hygiene: no private document links, credentials, research sheet or LDS library in the tree', () => {
  const skip = new Set(['.git', 'node_modules', 'evidence', 'dist', '.handoff-stage']);
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { if (skip.has(name)) continue; const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(ROOT);
  const google = ['docs', 'drive'].map(h => `${h}.${['google', 'com'].join('.')}`);
  const secret = /(gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  for (const p of files) {
    const rel = relative(ROOT, p);
    assert.ok(!/\.(xlsx|xls|ods|csv)$/i.test(rel), `${rel}: no spreadsheet in the tree`);
    assert.ok(!/Landometer-Design-System|Location-Intelligence-Profile/.test(rel), `${rel}: the LDS library is not distributed`);
    if (!/\.(js|mjs|json|geojson|md|html|css|py|txt|webmanifest)$/.test(rel)) continue;
    const text = readFileSync(p, 'utf8');
    for (const host of google) assert.ok(!text.includes(host), `${rel}: no ${host} link`);
    assert.ok(!secret.test(text), `${rel}: no credential-like string`);
  }
});
