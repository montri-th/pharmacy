#!/usr/bin/env node
/**
 * LDS parity: compare every LDS value this product ships with the approved LDS 0.9.7 source file.
 * The full LDS library is NOT in this repository (owner rule): pass the file you hold.
 *
 *   node scripts/check-lds-parity.mjs --lds /path/Landometer-Design-System-v0.9.7.md [--out evidence/lds-parity.json]
 *
 * Checks (each one is a line in the report):
 *  - the source file SHA-256 is the approved d3085cbc…96 and its embedded machine JSON parses
 *  - density.area and count, light AND dark records: 41-sample LUT, anchors, scaleVersion, classes 3/5/7/9
 *    (identical on both themes) = js/scales.js; noData / zeroOutline of the light record = js/scales.js
 *  - assets/theme.css: foundation (17 roles), map roles (6), dataState noData/zero, series 1–10 fill + ink,
 *    each for light and dark; the five count classes (light only — analytical values have no dark override)
 *  - js/cues.js: the ten cue shapes in the LDS order (series.01 … series.10)
 * Exits non-zero on any mismatch.
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COUNT_SCALE, DENSITY_SCALE, classColors} from '../js/scales.js';
import {CUES} from '../js/cues.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const ldsPath = opt('--lds', process.env.LDS_FILE || '');
const out = resolve(opt('--out', join(root, 'evidence/lds-parity.json')));
const APPROVED = 'd3085cbc0a50195f1cbf0c77b1d77c0d19b84364daf2948eb367348d65432d96';
if (!ldsPath) { console.error('usage: node scripts/check-lds-parity.mjs --lds <Landometer-Design-System-v0.9.7.md>'); process.exit(2); }

const checks = [];
const check = (id, expected, actual) => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  checks.push({id, ok, ...(ok ? {} : {expected, actual})});
};

const bytes = readFileSync(ldsPath);
check('lds.file.sha256', APPROVED, createHash('sha256').update(bytes).digest('hex'));
const text = bytes.toString('utf8');
const begin = text.indexOf('<!-- LDS_MACHINE_BEGIN -->');
const open = text.indexOf('```json\n', begin) + 8;
const machine = JSON.parse(text.slice(open, text.indexOf('\n```', open)));
check('lds.machine.release', ['0.9.7', 'v0.9.7-owner.1', 'color-srgb-10'], [machine.release.dsVersion, machine.analyticalScales.releaseRef, machine.analyticalScales.colorSetId]);

// Analytical families: both theme records, compared with the shipped constants.
for (const shipped of [DENSITY_SCALE, COUNT_SCALE]) {
  for (const theme of ['light', 'dark']) {
    const rec = machine.analyticalScales.scales.find(s => s.scaleId === shipped.scaleId && s.theme === theme);
    const id = `${shipped.scaleId}.${theme}`;
    check(`${id}.lut41`, [...shipped.lut], rec?.lut);
    check(`${id}.anchors`, [...shipped.anchors], rec?.anchors);
    check(`${id}.scaleVersion`, shipped.scaleVersion, rec?.scaleVersion);
    for (const n of [3, 5, 7, 9]) check(`${id}.classes.${n}`, classColors(n, shipped), rec?.classes?.[String(n)]);
  }
  const light = machine.analyticalScales.scales.find(s => s.scaleId === shipped.scaleId && s.theme === 'light');
  check(`${shipped.scaleId}.light.noData+zeroOutline`, [shipped.noData, shipped.zeroOutline], [light.noData, light.zeroOutline]);
}

// theme.css: light block, then the dark block.
const css = readFileSync(join(root, 'assets/theme.css'), 'utf8');
const [lightCss, darkCss] = css.split(':root[data-theme="dark"]');
const cssValue = (block, name) => (block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1]?.toUpperCase() || null;
const tokenName = key => key.replace(/\./g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
for (const [key, value] of Object.entries(machine.tokens.foundation)) {
  check(`theme.foundation.${key}.light`, value.light.toUpperCase(), cssValue(lightCss, tokenName(key)));
  check(`theme.foundation.${key}.dark`, value.dark.toUpperCase(), cssValue(darkCss, tokenName(key)));
}
for (const [key, value] of Object.entries(machine.tokens.map)) {
  check(`theme.map.${key}.light`, value.light.toUpperCase(), cssValue(lightCss, `map-${tokenName(key)}`));
  check(`theme.map.${key}.dark`, value.dark.toUpperCase(), cssValue(darkCss, `map-${tokenName(key)}`));
}
for (const [key, css] of [['noData', 'data-no-data'], ['zero', 'data-zero-outline']]) {
  check(`theme.dataState.${key}.light`, machine.tokens.dataState[key].light.toUpperCase(), cssValue(lightCss, css));
  check(`theme.dataState.${key}.dark`, machine.tokens.dataState[key].dark.toUpperCase(), cssValue(darkCss, css));
}
const series = machine.colorRegistry.values.series;
check('series.registry', 'landometer-series-10-v8', series.registryId);
series.values.forEach((s, i) => {
  for (const theme of ['light', 'dark']) {
    check(`series.${i + 1}.${theme}.fill`, s[theme].fill.toUpperCase(), cssValue(theme === 'light' ? lightCss : darkCss, `series-${i + 1}-fill`));
    check(`series.${i + 1}.${theme}.ink`, s[theme].ink.toUpperCase(), cssValue(theme === 'light' ? lightCss : darkCss, `series-${i + 1}-ink`));
  }
});
check('cues.order', series.values.map(s => s.cue), [...CUES]);
classColors(5, COUNT_SCALE).forEach((hex, i) => check(`theme.scale-count-${i + 1}`, hex, cssValue(lightCss, `scale-count-${i + 1}`)));
check('theme.no-dark-analytical-override', false, /--scale-/.test(darkCss));

const report = {checkedAt: new Date().toISOString(), ldsFile: ldsPath.split('/').pop(), ldsSha256: APPROVED,
  passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).length, checks};
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(`LDS parity: ${report.passed} ok, ${report.failed} failed → ${out}`);
for (const c of checks.filter(c => !c.ok)) console.log(`  MISMATCH ${c.id}: expected ${JSON.stringify(c.expected)} got ${JSON.stringify(c.actual)}`);
process.exit(report.failed ? 1 : 0);
