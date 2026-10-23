/**
 * Area charts rendered as plain HTML — no chart vendor.
 *
 * Three views share one model (chart-model.js) and the committed selection:
 *  - density (URL view key `density`): rows per km² of each แขวง/ตำบล, bars in the density.area class
 *    colour of the map legend
 *  - mix: area × pharmacy group, a numeric table with equal cells (count classes)
 *  - quality: the share of each area's rows that are on the Pharmacy Council quality list (a part-of-whole
 *    bar in the quality series with its cue; the count beside it)
 * Every mark is a <button> emitting {type:'area', id}.
 */
import {buildChartModel, areaMatrix, areaQuality} from './chart-model.js';
import {buildCountClasses, buildDensityClasses, classify} from './scales.js';
import {cueMarkup, QUALITY_SERIES} from './cues.js';
import {districtWord} from './areas.js';
import {provinceByCode} from './model.js';

const NUMBER = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});
const DEC = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const DEC2 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const DEC3 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 3, maximumFractionDigits: 3});
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = n => NUMBER.format(n);
/** Same density format as the panel (panel.js dens): a measured non-zero density never prints as 0. */
const dens = n => (n == null || !Number.isFinite(n) ? '—' : n === 0 ? '0' : n < 0.001 ? '<0.001' : n < 0.1 ? DEC3.format(n) : n < 1 ? DEC2.format(n) : DEC.format(n));
const where = (a, national) => `${districtWord(a.province)}${a.districtName}${national ? ` · ${provinceByCode(a.province)?.th || ''}` : ''}`;

function empty(element, message) {
  element.innerHTML = `<div class="chart-empty"><p>${esc(message)}</p></div>`;
}

function density(element, model, select, selectedId, unit, national) {
  // No area reaches the eligibility threshold (a small selection): rank and draw by count — a density of
  // one or two pharmacies in a tiny area would read as a finding it is not.
  const byCount = model.mode === 'count';
  const value = a => (byCount ? a.count : a.density || 0);
  const classes = byCount ? buildCountClasses(model.areas.map(a => a.count), 5, {unit: unit.one}) : buildDensityClasses(model.areas.map(a => a.density));
  const max = Math.max(1e-9, ...model.areas.map(value));
  const rows = model.areas.map((a, i) => {
    const cls = classify(value(a), classes);
    const pressed = a.id === selectedId;
    const label = byCount ? `${num(a.count)} ${unit.one} (${dens(a.density)} ${unit.densityLong})` : `${dens(a.density)} ${unit.densityLong}, ${num(a.count)} ${unit.one}`;
    return `<li><button type="button" class="bar-row${pressed ? ' is-selected' : ''}" data-area="${esc(a.id)}" aria-pressed="${pressed}"
      aria-label="อันดับ ${i + 1} ${esc(a.name)} ${esc(where(a, national))}: ${label} กดเพื่อดูพื้นที่นี้">
      <span class="bar-rank data-number" aria-hidden="true">${i + 1}</span>
      <span class="bar-label">${esc(a.name)}<small>${esc(where(a, national))}</small></span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(2, Math.round((value(a) / max) * 100))}%;background:${cls.fill}"></span></span>
      <span class="bar-value" aria-hidden="true">${byCount ? `<b class="data-number">${num(a.count)}</b><small>${dens(a.density)}/ตร.กม.</small>` : `<b class="data-number">${dens(a.density)}</b><small>${num(a.count)} ${esc(unit.one)}</small>`}</span>
    </button></li>`;
  }).join('');
  const caption = byCount
    ? `จำนวน${unit.one}ต่อพื้นที่ · ไม่มีพื้นที่ใดถึง ${num(model.minRows)} ${unit.one} จึงเรียงตามจำนวน · ${num(model.areas.length)} พื้นที่`
    : `${unit.density} · ${num(model.areas.length)}/${num(model.eligibleAreas)} พื้นที่ที่มีอย่างน้อย ${num(model.minRows)} ${unit.one} · สีเดียวกับแผนที่`;
  element.innerHTML = `<p class="chart-caption">${esc(caption)}</p><ol class="chart-bars">${rows}</ol>`;
  element.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => select({type: 'area', id: b.dataset.area})));
}

function matrix(element, model, select, selectedId, unit) {
  const m = areaMatrix(model, {areaLimit: 12});
  const classes = buildCountClasses(m.cells.map(c => c.count), 5, {unit: unit.one});
  const head = m.groups.map(g => `<th scope="col" title="${esc(g.th)}"><span class="matrix-col">${cueMarkup(g.series)}<span>${esc(g.short || g.th)}</span></span></th>`).join('');
  const body = m.areas.map(a => {
    const pressed = a.id === selectedId;
    const cells = m.groups.map(g => {
      const cell = m.cells.find(c => c.areaId === a.id && c.group === g.index);
      const cls = classify(cell.count, classes);
      // measured_zero: lowest class fill + the theme's dataState.zero outline (EVID-05 treatment), never a blank cell.
      const style = cls.state === 'measured_zero' ? `background:${cls.fill};color:${cls.ink};box-shadow:inset 0 0 0 2px var(--data-zero-outline)` : `background:${cls.fill};color:${cls.ink}`;
      return `<td><button type="button" class="matrix-cell is-${cls.state}" data-area="${esc(a.id)}" style="${style}"
        aria-label="${esc(a.name)} × ${esc(g.th)}: ${num(cell.count)} ${esc(unit.one)} กดเพื่อดูพื้นที่นี้" title="${esc(a.name)} × ${esc(g.th)} — ${num(cell.count)} จาก ${num(cell.total)} ${esc(unit.one)}"><span class="data-number">${num(cell.count)}</span></button></td>`;
    }).join('');
    return `<tr${pressed ? ' class="is-selected"' : ''}><th scope="row"><button type="button" class="matrix-row" data-area="${esc(a.id)}" aria-pressed="${pressed}">${esc(a.name)}<small class="data-number">${num(a.count)}</small></button></th>${cells}</tr>`;
  }).join('');
  const legend = classes.classes.map(c => `<span class="legend-step"><i style="background:${c.fill}" aria-hidden="true"></i>${esc(c.label)}</span>`).join('');
  const columns = `<colgroup><col class="matrix-head-col">${m.groups.map(() => '<col class="matrix-cell-col">').join('')}</colgroup>`;
  element.innerHTML = `<p class="chart-caption">${num(m.areas.length)} พื้นที่${model.mode === 'density' ? 'ที่ร้านยาแน่นที่สุด' : `ที่มี${esc(unit.one)}มากที่สุด`} × ${num(m.groups.length)} ประเภท · ตัวเลข = ${esc(unit.one)} · ทุกช่องขนาดเท่ากัน ขนาดไม่มีความหมาย</p>
    <div class="matrix-scroll"><table class="matrix" style="--matrix-columns:${m.groups.length}">${columns}<thead><tr><th scope="col" class="matrix-corner">พื้นที่ · ${esc(unit.one)}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="chart-legend"><span class="legend-title">ระดับสี (${esc(unit.one)}ในช่อง, ${num(classes.classCount)} ระดับเรขาคณิต):</span>${legend}<span class="legend-step"><i class="legend-zero" aria-hidden="true"></i>0 = ไม่พบในตัวกรองนี้</span></p>`;
  element.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => select({type: 'area', id: b.dataset.area})));
}

function quality(element, model, select, selectedId, unit, national) {
  const list = areaQuality(model, {areaLimit: 12});
  const rows = list.map(a => {
    const pressed = a.id === selectedId;
    const share = Math.round(a.share * 100);
    return `<li><button type="button" class="bar-row is-share${pressed ? ' is-selected' : ''}" data-area="${esc(a.id)}" aria-pressed="${pressed}"
      aria-label="${esc(a.name)}: อยู่ในรายชื่อร้านยาคุณภาพ ${num(a.listed)} จาก ${num(a.total)} ${esc(unit.one)} (${share}%) กดเพื่อดูพื้นที่นี้">
      <span class="bar-label">${esc(a.name)}<small>${esc(where(a, national))}</small></span>
      <span class="bar-track" aria-hidden="true">${a.listed ? `<span class="bar-fill category-${QUALITY_SERIES} quality-fill" style="width:${Math.max(2, share)}%"></span>` : ''}</span>
      <span class="bar-value" aria-hidden="true"><b class="data-number">${share}%</b><small>${num(a.listed)}/${num(a.total)}</small></span>
    </button></li>`;
  }).join('');
  element.innerHTML = `<p class="chart-caption">สัดส่วน${esc(unit.one)}ที่อยู่ในรายชื่อร้านยาคุณภาพของสภาเภสัชกรรม · ความยาวแท่ง = ร้อยละของ${esc(unit.one)}ในพื้นที่ · ${model.mode === 'density' ? 'พื้นที่เดียวกับกราฟความหนาแน่น' : 'พื้นที่ที่มีร้านมากที่สุด'}</p>
    <p class="chart-legend"><span class="legend-step">${cueMarkup(QUALITY_SERIES)}อยู่ในรายชื่อร้านยาคุณภาพ</span><span class="legend-step"><i class="legend-track" aria-hidden="true"></i>ไม่พบในรายชื่อ</span><span class="hint">รายชื่อไม่ระบุวันหมดอายุการรับรอง</span></p>
    <ol class="chart-bars">${rows}</ol>`;
  element.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => select({type: 'area', id: b.dataset.area})));
}

/** Render one view into #elementId. Returns an idempotent disposer. */
export function renderInsightChart({elementId, view = 'density', rows = [], index, groups, theme, selectedAreaId = '', unit, national = true} = {}, onSelect = () => {}) {
  const element = document.getElementById(elementId);
  if (!element) return () => {};
  const select = typeof onSelect === 'function' ? onSelect : () => {};
  element.replaceChildren();
  if (theme) element.dataset.chartTheme = theme;
  const labels = {density: 'พื้นที่เรียงตามความหนาแน่นของร้านยา', mix: 'ประเภทร้านยาในแต่ละพื้นที่', quality: 'สัดส่วนร้านยาคุณภาพในแต่ละพื้นที่'};
  element.setAttribute('aria-label', labels[view] || labels.density);
  if (!Array.isArray(rows) || !rows.length) { empty(element, `ไม่พบ${unit.one}ตามตัวกรอง`); return () => element.replaceChildren(); }
  const model = buildChartModel(rows, index, groups);
  if (!model.areas.length) { empty(element, 'ยังไม่มีพื้นที่ระดับตำบลในตัวกรองนี้'); return () => element.replaceChildren(); }
  try {
    if (view === 'mix') matrix(element, model, select, selectedAreaId, unit);
    else if (view === 'quality') quality(element, model, select, selectedAreaId, unit, national);
    else density(element, model, select, selectedAreaId, unit, national);
  } catch (error) {
    console.error('CityMETER insight chart could not render:', error);
    empty(element, 'แสดงกราฟไม่ได้ในขณะนี้ โปรดดูข้อมูลเดียวกันในตาราง');
  }
  return () => element.replaceChildren();
}
