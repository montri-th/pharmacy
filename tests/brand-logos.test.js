/**
 * D64 of CityMETER · Shopping Center (owner 2026-11-24 07:53, VERBATIM: “ทำไมหลายร้านในศูนย์การค้าเราควรจะมี logo แล้ว แต่
 * เวบเดโมไม่แสดงโลโก้ แก้ให้ครบทุก venue และตรวจใน dataset อื่นๆด้วยในเคสนี้หาวิธีแก้ที่แก้ได้ทุกที่เหมือนกัน”): chain logos the
 * CityMETER family already verified, found by the shared kit (scripts/logo-kit/, citymeter-logos) the same way as in every demo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, readJSON} from './helpers.js';
import {setBrandLogos, brandLogo, brandLogoMarkup} from '../js/brand-logos.js';

const sha = buf => createHash('sha256').update(buf).digest('hex');

test('the kit is the same bytes as its record (change it in every repository at once)', () => {
  const kit = readJSON('scripts/logo-kit/kit.json');
  assert.equal(kit.name, 'citymeter-logos');
  for (const [path, hash] of Object.entries(kit.files)) assert.equal(sha(readFileSync(join(ROOT, path))), hash, `${path} differs from citymeter-logos ${kit.version}`);
});

test('the kit rules hold (tests/test_logo_kit.py)', () => {
  const run = spawnSync('python3', ['-I', join(ROOT, 'tests/test_logo_kit.py')], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('every chain logo is a verified file of a chain of this dataset, and every file is used', () => {
  const logos = readJSON('data/brand-logos.json');
  const brands = new Map(readJSON('data/pharmacies.json').brands.map(b => [b.id, b]));
  const files = new Set();
  for (const [id, r] of Object.entries(logos.logos)) {
    assert.ok(brands.has(id), `${id} is not a chain of this dataset`);
    assert.match(r.file, /^assets\/brand-logos\/[a-f0-9]{20}\.(svg|png|jpe?g|webp|gif)$/);
    assert.equal(sha(readFileSync(join(ROOT, r.file))), r.sha256, r.file);
    assert.ok(['#E5E9E6', '#FFFFFF', '#182327'].includes(r.background), `${id}: plate ${r.background}`);
    assert.ok(['own', 'same-id', 'label', 'bilingual', 'legal', 'descriptor', 'bank'].includes(r.basis), `${id}: ${r.basis}`);
    files.add(r.file.split('/').pop());
  }
  assert.deepEqual(readdirSync(join(ROOT, 'assets/brand-logos')).sort(), [...files].sort(), 'no file in assets/brand-logos without a chain');
  assert.equal(logos.meta.withLogo, Object.keys(logos.logos).length);
  assert.equal(logos.meta.brands, brands.size);
  assert.equal(logos.meta.withLogo + logos.meta.without.length, brands.size);
  // The four chains the Beauty master registered under the same PHB ids (Shopping Center ships their verified files).
  for (const name of ['Watsons', 'Boots', 'matsukiyo', 'LAB Pharmacy']) {
    assert.ok(Object.values(logos.logos).some(r => r.name === name), `${name} has no logo`);
  }
});

test('the page draws only safe records, beside the name', () => {
  assert.equal(setBrandLogos({logos: {
    a: {file: 'assets/brand-logos/0123456789abcdef0123.png', sha256: 'a'.repeat(64), background: '#FFFFFF', width: 100, height: 50},
    b: {file: 'https://evil.example/x.png', sha256: 'a'.repeat(64), background: '#FFFFFF'},
    c: {file: 'assets/brand-logos/0123456789abcdef0123.png', sha256: 'a'.repeat(64), background: 'red'},
  }}), 1);
  assert.match(brandLogoMarkup('a'), /class="brand-logo brand-logo-chip".*alt=""/);
  assert.match(brandLogoMarkup('a', {size: 'store'}), /brand-logo-store/);
  assert.equal(brandLogoMarkup('b'), '');
  assert.equal(brandLogo('c'), null);
  assert.equal(setBrandLogos(null), 0);
  assert.equal(brandLogoMarkup('a'), '');
  setBrandLogos(readJSON('data/brand-logos.json'));
});
