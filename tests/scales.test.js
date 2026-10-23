import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './helpers.js';
import {COUNT_SCALE, DENSITY_SCALE, LADDER, classColors, buildCountClasses, buildDensityClasses, geometricBreaks, classify, inkFor, contrastRatio} from '../js/scales.js';

test('the two families are exact 41-sample LUTs with anchors at 0/20/40, same HEX on both themes', () => {
  for (const s of [COUNT_SCALE, DENSITY_SCALE]) {
    assert.equal(s.lut.length, 41, s.scaleId);
    assert.deepEqual([s.lut[0], s.lut[20], s.lut[40]], [...s.anchors], `${s.scaleId} anchors`);
    assert.ok(s.lut.every(h => /^#[0-9A-F]{6}$/.test(h)));
    assert.equal(s.themePolicy, 'identical-light-values-on-both-themes');
    assert.match(s.scaleVersion, /^[0-9a-f]{64}$/);
  }
  assert.equal(DENSITY_SCALE.scaleId, 'density.area');
  assert.equal(COUNT_SCALE.scaleId, 'count');
});

test('class colours are LUT[round(i·40/(n−1))] for n ∈ {3,5,7,9}; other n are refused', () => {
  for (const n of [3, 5, 7, 9]) assert.deepEqual(classColors(n, DENSITY_SCALE), Array.from({length: n}, (_, i) => DENSITY_SCALE.lut[Math.round((i * 40) / (n - 1))]));
  assert.throws(() => classColors(4), /3, 5, 7 or 9/);
});

test('theme.css carries the count classes once (no dark override of analytical values)', () => {
  const css = readFileSync(join(ROOT, 'assets/theme.css'), 'utf8');
  const [light, dark] = css.split(':root[data-theme="dark"]');
  classColors(5, COUNT_SCALE).forEach((hex, i) => assert.match(light, new RegExp(`--scale-count-${i + 1}: ${hex};`)));
  assert.ok(!/--scale-/.test(dark), 'no analytical token is redefined for dark');
});

test('geometric 1–2–5 breaks: each break is the largest ladder value ≤ the next one ÷ 3', () => {
  assert.deepEqual(LADDER.slice(0, 4), [0.001, 0.002, 0.005, 0.01]);
  assert.deepEqual(geometricBreaks(41.2), [0.1, 0.5, 2, 10], 'the national licensed maximum spans four orders of magnitude');
  assert.deepEqual(geometricBreaks(16.7), [0.05, 0.2, 1, 5]);
  assert.deepEqual(geometricBreaks(3232, 5, {integer: true}), [10, 50, 200, 1000]);
  assert.deepEqual(geometricBreaks(5, 5, {integer: true}), [], 'a narrow integer range yields fewer classes');
  assert.deepEqual(geometricBreaks(0), []);
});

test('density classes: [lower, upper) with the last closed at the observed maximum; zero and no data stay outside the ramp', () => {
  const m = buildDensityClasses([0, 0.004, 0.3, 2.6, 41.2]);
  assert.equal(m.classCount, 5);
  assert.equal(m.method, 'geometric-1-2-5');
  assert.deepEqual(m.classes.map(c => c.label), ['>0–0.1', '0.1–0.5', '0.5–2', '2–10', '10–41']);
  assert.deepEqual(m.classes.map(c => c.fill), classColors(5, DENSITY_SCALE));
  assert.equal(m.classes.at(-1).closed, true);
  assert.equal(classify(41.2, m).classIndex, 4, 'the maximum is inside the closed last class');
  assert.equal(classify(2, m).classIndex, 3, 'a breakpoint opens the next class');
  assert.equal(classify(0.004, m).classIndex, 0);
  assert.equal(classify(0, m).state, 'measured_zero');
  assert.equal(classify(0, m).fill, DENSITY_SCALE.lut[0]);
  assert.equal(classify(null, m).state, 'no_data');
  assert.equal(classify(null, m).fill, null, 'no_data never takes a ramp colour');
  assert.equal(buildDensityClasses([0, 0]).classCount, 0);
  // A narrow integer range yields fewer classes; they take evenly spread LDS class colours (first and last).
  const narrow = buildCountClasses([1, 7]);
  assert.deepEqual(narrow.classes.map(c => c.label), ['1', '2–7']);
  assert.deepEqual(narrow.classes.map(c => c.fill), [classColors(5, COUNT_SCALE)[0], classColors(5, COUNT_SCALE)[4]]);
});

test('count classes: closed integer intervals from 1 to the maximum; zero is measured_zero', () => {
  const m = buildCountClasses([0, 1, 9, 3232]);
  assert.deepEqual(m.classes.map(c => c.label), ['1–9', '10–49', '50–199', '200–999', '1,000–3,232']);
  assert.equal(m.classes[0].lower, 0);
  assert.equal(m.classes.at(-1).upper, 3232);
  assert.equal(classify(0, m).state, 'measured_zero');
  assert.equal(classify(10, m).classIndex, 1);
  assert.equal(buildCountClasses([2]).classCount, 1);
});

test('label ink is the foundation pair with the higher contrast; numbers printed on fills (matrix = count) reach 4.5:1', () => {
  for (const s of [COUNT_SCALE, DENSITY_SCALE]) for (const hex of classColors(5, s)) {
    const ink = inkFor(hex), other = ink === '#182327' ? '#FFFFFF' : '#182327';
    assert.ok(contrastRatio(hex, ink) >= contrastRatio(hex, other));
  }
  // Only the count family carries text on its fill (matrix cells); density fills never hold text.
  for (const hex of classColors(5, COUNT_SCALE)) assert.ok(contrastRatio(hex, inkFor(hex)) >= 4.5, hex);
  assert.ok(contrastRatio('#D6600C', inkFor('#D6600C')) < 4.5, 'documented: no text on the top density class');
});
