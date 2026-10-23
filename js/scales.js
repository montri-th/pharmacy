/**
 * Analytical scales — LDS 0.9.7 (v0.9.7-owner.1, color-srgb-10), copied exactly from
 * machine.analyticalScales of Landometer-Design-System-v0.9.7.md (SHA-256 d3085cbc…96); parity is checked
 * by scripts/check-lds-parity.mjs against the source file (handoff/VERIFICATION.md). DATAVIZ-02/03: the
 * approved light 41-sample LUT is consumed unchanged on both themes; class colours are the LDS class
 * projections round(i × 40 / (n − 1)); nothing is interpolated here.
 *
 * Families used by this product (selected from metric + denominator):
 *  - density.area — rows per km² of a subdistrict (denominator = production area): the choropleth, the
 *    ranking bars and the area labels.
 *  - count — totals, never density: rows per province frame (country view) and matrix cells.
 *
 * Classification (declared by this consumer, DATAVIZ-02): pharmacy density across Thailand spans four
 * orders of magnitude (median subdistrict ≈ 0.06 licensed pharmacies/km², central Bangkok > 10). Equal
 * intervals would paint every area outside central Bangkok in the first class, so both families use
 * geometric classes with rounded 1–2–5 breaks: the top class starts at the largest ladder value ≤ max/3 and
 * every lower break is the largest ladder value ≤ the next break/3. Intervals are [lower, upper) except the
 * closed last one, which ends at the observed maximum (no clamping, no open end). Zero is measured_zero,
 * never a ramp class.
 */
const freeze = Object.freeze;

export const COUNT_SCALE = freeze({
  scaleId: 'count', kind: 'sequential', labelTh: 'จำนวนรวม',
  anchors: freeze(['#F4F0E7', '#7DBAC0', '#213E70']),
  lut: freeze(['#F4F0E7', '#EEEDE5', '#E8EBE3', '#E3E8E1', '#DDE5DF', '#D7E3DD', '#D1E0DB', '#CBDDD9', '#C5DAD7', '#C0D8D6',
    '#BAD5D4', '#B4D2D2', '#AED0D0', '#A8CDCE', '#A2CACC', '#9CC8CA', '#96C5C8', '#90C2C6', '#8ABFC4', '#83BDC2', '#7DBAC0',
    '#78B3BC', '#73ADB8', '#6EA7B4', '#69A0B0', '#649AAC', '#5F93A8', '#5A8DA4', '#5587A0', '#50809C', '#4C7A98', '#477494',
    '#436E90', '#3E688C', '#3A6288', '#355C84', '#315680', '#2D507C', '#294A78', '#254474', '#213E70']),
  noData: '#D5DAD6', zeroOutline: '#7D877F',
  scaleVersion: '4ff5c1fb4be71ecd13c48685b38371b528bcd4ce369ce964a75354c2eb4d0980',
  themePolicy: 'identical-light-values-on-both-themes',
});

export const DENSITY_SCALE = freeze({
  scaleId: 'density.area', kind: 'sequential', labelTh: 'ความหนาแน่นต่อพื้นที่',
  anchors: freeze(['#FFF1D9', '#E6AB30', '#D6600C']),
  lut: freeze(['#FFF1D9', '#FEEED2', '#FDEACA', '#FCE7C3', '#FAE3BC', '#F9E0B5', '#F8DCAD', '#F7D9A6', '#F6D59E', '#F4D297',
    '#F3CF8F', '#F2CB87', '#F1C87F', '#EFC477', '#EEC06F', '#EDBD66', '#EBB95D', '#EAB653', '#E9B249', '#E7AF3D', '#E6AB30',
    '#E5A72E', '#E5A42D', '#E4A02B', '#E49D2A', '#E39928', '#E29526', '#E29225', '#E18E23', '#E08A21', '#DF8720', '#DF831E',
    '#DE7F1C', '#DD7B1A', '#DC7818', '#DB7417', '#DA7015', '#D96C13', '#D86811', '#D7640E', '#D6600C']),
  noData: '#D5DAD6', zeroOutline: '#7D877F',
  scaleVersion: '554812a7c19107b3a9b8658ba541fc8e13519cb19708e885a425f32d5b30f101',
  themePolicy: 'identical-light-values-on-both-themes',
});

/** WCAG relative-luminance contrast ratio (used for ink choice and tests). */
export function contrastRatio(hexA, hexB) {
  const lum = hex => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(hexA), lum(hexB)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Label ink on a class fill: the foundation text pair that reaches the higher contrast. */
export function inkFor(fill) {
  const dark = '#182327', light = '#FFFFFF';
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light;
}

/** Exact class colours for n ∈ {3,5,7,9}: index round(i × 40 / (n − 1)). */
export function classColors(n = 5, scale = COUNT_SCALE) {
  if (![3, 5, 7, 9].includes(n)) throw new RangeError('Class count must be 3, 5, 7 or 9');
  return Array.from({length: n}, (_, i) => scale.lut[Math.round((i * 40) / (n - 1))]);
}

/** 1–2–5 ladder from 0.001 to 50,000. */
export const LADDER = freeze([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]);
const below = v => { let best = null; for (const x of LADDER) if (x <= v + 1e-12) best = x; return best; };

/**
 * Geometric breaks for (0, max]: [b1, b2, b3, b4] with b4 = ladder ≤ max/3 and b(k) = ladder ≤ b(k+1)/3.
 * `integer` keeps every break ≥ 1 and whole (count family). Duplicate or missing breaks are dropped, so a
 * narrow range yields fewer classes (each class then takes an evenly spread LDS class colour).
 */
export function geometricBreaks(max, n = 5, {integer = false} = {}) {
  if (!(max > 0)) return [];
  const breaks = [];
  let next = max;
  for (let i = 0; i < n - 1; i++) {
    const b = below(next / 3);
    if (b == null || (integer && b < 2) || (breaks.length && b >= breaks[0])) break;
    breaks.unshift(integer ? Math.round(b) : b);
    next = b;
  }
  return [...new Set(breaks)].filter(b => b < max);
}

const fmtFor = v => new Intl.NumberFormat('th-TH', {minimumFractionDigits: 0, maximumFractionDigits: v >= 1 ? 0 : v >= 0.1 ? 1 : v >= 0.01 ? 2 : 3});
const fmt = v => fmtFor(v).format(v);
/**
 * The closed top bound prints exactly as a density value prints (js/panel.js#dens: one decimal from 1, two
 * below 1, three below 0.1), so the densest area's own label never exceeds its class (live walk 2026-10-23:
 * the legend said “10–41” beside the label “สุริยวงศ์ 41.2”).
 */
const fmtTop = v => { const d = v >= 1 ? 1 : v >= 0.1 ? 2 : 3; return new Intl.NumberFormat('th-TH', {minimumFractionDigits: d, maximumFractionDigits: d}).format(v); };

function build(values, scale, {n = 5, integer = false, unit = ''} = {}) {
  const measured = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v) && v > 0);
  const max = measured.length ? Math.max(...measured) : 0;
  const colors = classColors(n, scale);
  const zero = {fill: colors[0], outline: scale.zeroOutline, label: '0'};
  if (!(max > 0)) return {scaleId: scale.scaleId, unit, method: 'geometric-1-2-5', classCount: 0, max: 0, classes: [], zero};
  const breaks = geometricBreaks(max, n, {integer});
  const edges = [0, ...breaks, max];
  const k = edges.length - 1;
  // Spread the k classes over the n LDS class colours (k = n → every colour in order).
  const picks = Array.from({length: k}, (_, i) => (k === 1 ? n - 1 : Math.round((i * (n - 1)) / (k - 1))));
  const classes = [];
  for (let i = 0; i < k; i++) {
    const lower = edges[i], upper = edges[i + 1], last = i === k - 1;
    let label;
    if (integer) {
      const lo = i === 0 ? 1 : lower, hi = last ? Math.round(upper) : upper - 1;
      label = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
    }
    else {
      const top = last ? fmtTop(upper) : fmt(upper);
      label = i === 0 ? `>0–${top}` : `${fmt(lower)}–${top}`;
    }
    classes.push({index: picks[i], lower, upper, closed: last, fill: colors[picks[i]], ink: inkFor(colors[picks[i]]), label});
  }
  return {scaleId: scale.scaleId, unit, method: 'geometric-1-2-5', classCount: classes.length, max, breaks, classes, zero};
}

/** Density classes (density.area). */
export const buildDensityClasses = (values, n = 5, opts = {}) => build(values, DENSITY_SCALE, {n, ...opts});
/** Count classes (count family): whole-number intervals; integer breaks. */
export const buildCountClasses = (values, n = 5, {unit = 'ร้าน'} = {}) => build(values, COUNT_SCALE, {n, integer: true, unit});

/**
 * Resolve one value to its EVID-05 state and treatment.
 *  measured: finite nonzero → class fill · measured_zero: 0 → lowest fill + zero outline
 *  no_data: null fill (caller draws the hatch) · out_of_scope: nothing drawn
 */
export function classify(value, model, state = 'measured') {
  const scale = model?.scaleId === 'density.area' ? DENSITY_SCALE : COUNT_SCALE;
  if (state === 'out_of_scope') return {state, fill: null, ink: null, label: 'นอกขอบเขตข้อมูล'};
  if (state === 'no_data' || value == null || !Number.isFinite(value)) return {state: 'no_data', fill: null, ink: null, label: 'ไม่มีข้อมูล'};
  if (value <= 0) return {state: 'measured_zero', fill: model.zero.fill, ink: inkFor(model.zero.fill), outline: model.zero.outline, label: '0'};
  const cls = model.classes.find(c => (c.closed ? value >= c.lower && value <= c.upper : value >= c.lower && value < c.upper)) || model.classes.at(-1);
  if (!cls) return {state: 'measured', fill: scale.lut[40], ink: inkFor(scale.lut[40]), label: String(value), classIndex: 4};
  return {state: 'measured', fill: cls.fill, ink: cls.ink, label: String(value), classIndex: cls.index};
}
