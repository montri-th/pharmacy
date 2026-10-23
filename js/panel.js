/**
 * Reading panel views as HTML strings. Pure: no DOM access, no map.
 *
 * Every actionable element carries data-action (+ data-id / data-value); the app binds one delegated
 * handler. Actions: select-area · select-district · select-store · select-building · select-province ·
 * filter-brand · back · explore-top · clear-focus · open-charts · open-table · clear-filter · leave-area ·
 * set-count.
 *
 * Copy is short, natural Thai. Units follow the counting mode (model.js#unitWords): ร้าน = one ขย1
 * licence of the FDA register (default) · รายการ = one dataset row (“ทุกรายการ”, may repeat a storefront).
 * Building wording: "จุดของร้านตกในอาคาร" — the published point falls inside the drawn outline; never
 * "ตั้งอยู่ใน". Missing is never shown as 0. Metric tiles and headings carry the pictogram subset
 * (js/navigation.js PICTOGRAM_CONTRACT); text is the meaning.
 */
import {productionLink, provinceByCode, hasPoint, EVIDENCE_LABEL, EVIDENCE_SHORT} from './model.js';
import {areaWord, districtWord} from './areas.js';
import {buildCountClasses, classify as classifyValue} from './scales.js';
import {cueMarkup, QUALITY_SERIES, seriesOf} from './cues.js';

const NUMBER = new Intl.NumberFormat('th-TH', {maximumFractionDigits: 0});
const DEC1 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const DEC2 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const DEC3 = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 3, maximumFractionDigits: 3});
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const num = n => NUMBER.format(n);
export const dec = n => DEC1.format(n);
/**
 * Density — one decimal from 1 up, two below 1, three below 0.1, "<0.001" below that: a measured non-zero
 * density never prints as 0 (one pharmacy in a 300 km² rural subdistrict is 0.003).
 */
export const dens = n => (n == null || !Number.isFinite(n) ? '—' : n === 0 ? '0' : n < 0.001 ? '<0.001' : n < 0.1 ? DEC3.format(n) : n < 1 ? DEC2.format(n) : DEC1.format(n));
export const pct = (part, whole) => (whole ? `${NUMBER.format(Math.round((part / whole) * 100))}%` : '—');
const km = n => (n >= 10 ? NUMBER.format(n) : DEC1.format(n));
const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

export function link(url, label, cls = 'source-link') {
  const u = safeURL(url);
  return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
}

export function thaiDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${months[m - 1]} ${y + 543}`;
}

/** Metric tile with a decorative pictogram; value may be a preformatted string. */
export function metricTile(value, label, kind = '') {
  const shown = typeof value === 'string' ? value : num(value);
  return `<div class="metric${kind ? ` metric-${kind}` : ''}"><i class="metric-symbol pictogram pic-${esc(kind || 'plain')}" aria-hidden="true"></i><strong class="data-number">${esc(shown)}</strong><span>${esc(label)}</span></div>`;
}
export const heading = (kind, text, id = '') => `<h3${id ? ` id="${esc(id)}"` : ''}><i class="pictogram pic-${esc(kind)}" aria-hidden="true"></i>${esc(text)}</h3>`;

const provinceName = code => provinceByCode(code)?.th || code || '';
const sourceOf = (ctx, id) => (ctx.sources || []).find(s => s.id === id) || {};

/**
 * Every view that shows numbers ends with dataset · source · date · boundary, and what one counted unit is.
 * ctx = {meta, sources, unit}
 */
export function provenance(ctx = {}, boundary = '') {
  const fda = sourceOf(ctx, 'FDA_KHY1'), acc = sourceOf(ctx, 'ACC_PHARM_DRUGSTORE');
  const all = ctx.unit?.mode === 'all';
  const source = all
    ? `${link(fda.url, 'ทะเบียน ขย1 อย.')} · ${link(acc.url, 'รายชื่อร้านยา สภาเภสัชกรรม')} · หน้าสาขาของเครือร้าน`
    : link(fda.url, 'ทะเบียนผู้รับอนุญาตขายยาแผนปัจจุบัน (ขย1) อย.');
  const note = all
    ? 'รายการ = แถวในชุดข้อมูลจากหลายแหล่ง ร้านเดียวกันอาจมีมากกว่าหนึ่งรายการ · ยังไม่ได้ตรวจภาคสนาม'
    : 'ร้าน = ใบอนุญาต ขย1 หนึ่งใบในทะเบียน · สถานะตามทะเบียน ไม่ได้ยืนยันว่าร้านเปิดอยู่วันนี้';
  return `<p class="hint panel-foot provenance"><span>ชุดข้อมูล CityMETER Pharmacy</span> · <span>แหล่ง ${source}</span> · <span>ทะเบียน ณ ${esc(thaiDate(fda.asOf))} · ตรวจแหล่ง ${esc(thaiDate(ctx.meta?.checkedOn || ''))}</span> · <span>ขอบเขต ${esc(boundary)}</span><br>${esc(note)}</p>`;
}

const words = areas => {
  const p = new Set(areas.map(a => a.province));
  return p.size === 1 ? areaWord([...p][0]) : 'พื้นที่';
};

function groupBars(byGroup, total, unit) {
  const list = byGroup.filter(g => g.count > 0).sort((a, b) => b.count - a.count);
  if (!list.length) return `<p class="hint">ไม่มี${esc(unit.one)}</p>`;
  const max = Math.max(1, ...list.map(g => g.count));
  return `<ul class="mix-list" aria-label="ประเภทร้าน (${esc(unit.one)})">${list.map(g => `
    <li><span class="mix-label">${cueMarkup(g.series)}${esc(g.th)}</span>
      <span class="mix-track" aria-hidden="true"><span class="mix-fill category-${g.series}" style="width:${Math.max(3, Math.round((g.count / max) * 100))}%"></span></span>
      <span class="mix-value data-number" title="${num(g.count)} จาก ${num(total)} ${esc(unit.one)}">${num(g.count)}</span></li>`).join('')}</ul>`;
}

/** Quality list share: a part-of-whole bar in the quality series, the rest as the plain track. */
function qualityBar(listed, total, unit) {
  if (!total) return `<p class="hint">ไม่มี${esc(unit.one)}</p>`;
  return `<div class="quality-bar"><span class="mix-label">${cueMarkup(QUALITY_SERIES)}อยู่ในรายชื่อร้านยาคุณภาพ</span>
    <span class="mix-track" aria-hidden="true"><span class="mix-fill category-${QUALITY_SERIES}" style="width:${listed ? Math.max(2, Math.round((listed / total) * 100)) : 0}%"></span></span>
    <span class="mix-value data-number">${num(listed)}<small> / ${num(total)}</small></span></div>
    <p class="hint">${pct(listed, total)} ของ${esc(unit.one)}ในพื้นที่นี้ · รายชื่อของสภาเภสัชกรรม ไม่ระบุวันหมดอายุการรับรอง</p>`;
}

function rowMeta(r, {showArea = false, index = null, unit} = {}) {
  const area = showArea && index && r.area ? index.byId.get(r.area) : null;
  return [r.brand ? r.brand.name : '', r.quality ? 'ร้านยาคุณภาพ' : '', unit?.mode === 'all' ? EVIDENCE_SHORT[r.evidence] : '',
    area ? `${areaWord(area.province)}${area.name}` : showArea && !r.area ? 'ระบุพื้นที่ได้ไม่ถึงตำบล' : '',
    hasPoint(r) ? '' : 'ไม่มีพิกัด'].filter(Boolean).join(' · ');
}

function pharmacyList(rows, opts = {}) {
  return `<ul class="outlet-list">${rows.map(r => `<li><button type="button" class="brand-row" data-action="select-store" data-id="${esc(r.id)}">${cueMarkup(r.series, {className: 'row-cue'})}<span><strong>${esc(r.name || 'ไม่มีชื่อในแหล่งข้อมูล')}</strong><br><span class="small muted">${esc(rowMeta(r, opts))}</span></span></button></li>`).join('')}</ul>`;
}

function chainChips(chains, unit) {
  if (!chains.length) return '<p class="hint">ไม่พบเครือร้านที่ยืนยันแล้วในพื้นที่นี้</p>';
  return `<ul class="chip-list">${chains.map(c => `<li><button type="button" class="brand-chip" data-action="filter-brand" data-value="${esc(c.brand.id)}" title="${esc(c.brand.name)} — ${num(c.count)} ${esc(unit.one)} (ดูเฉพาะเครือนี้)">${cueMarkup(seriesOf(c.brand.group), {className: 'chip-cue'})}<span>${esc(c.brand.name)}</span><small class="data-number">${num(c.count)}</small></button></li>`).join('')}</ul>`;
}

/**
 * Area list with bars. Areas that meet the eligibility threshold carry a rank and a density bar; areas
 * below it are listed after them without a rank. byCount (no eligible area at all): rank and bar by count.
 */
function areaRanking(list, classify, unit, {title = 'พื้นที่ที่ร้านยาแน่นที่สุด', note = '', limit = 10, minRows = 30, byCount = false, showProvince = false} = {}) {
  const top = list.slice(0, limit);
  if (!top.length) return '';
  const value = a => (byCount ? a.count : a.density || 0);
  const max = Math.max(1e-9, ...top.map(value));
  const countClasses = byCount ? buildCountClasses(top.map(a => a.count), 5, {unit: unit.one}) : null;
  const fillOf = a => (byCount ? classifyValue(a.count, countClasses).fill : classify(a));
  let rank = 0;
  return `<section class="panel-section" aria-labelledby="rank-title">
    <div class="section-heading">${heading('area', title, 'rank-title')}<span class="hint">${esc(note)}</span></div>
    <ol class="rank-list">${top.map(a => {
      const ranked = byCount || a.count >= minRows;
      const label = ranked ? `อันดับ ${++rank}` : `น้อยกว่า ${num(minRows)} ${unit.one} ไม่จัดอันดับ`;
      const shown = byCount ? num(a.count) : dens(a.density || 0);
      const where = `${districtWord(a.province)}${a.districtName}${showProvince ? ` · ${provinceName(a.province)}` : ''}`;
      return `<li><button type="button" class="rank-row${ranked ? '' : ' is-unranked'}" data-action="select-area" data-id="${esc(a.id)}" aria-label="${esc(label)} ${esc(areaWord(a.province))}${esc(a.name)} ${esc(where)} ${dens(a.density || 0)} ${esc(unit.densityLong)} ${num(a.count)} ${esc(unit.one)}">
        <span class="rank-index data-number" aria-hidden="true">${ranked ? rank : '·'}</span>
        <span class="rank-name">${esc(a.name)}<small>${esc(where)} · ${num(a.count)} ${esc(unit.one)}</small></span>
        <span class="rank-track" aria-hidden="true"><span class="rank-fill" style="width:${Math.max(3, Math.round((value(a) / max) * 100))}%;background:${fillOf(a)}"></span></span>
        <span class="rank-value data-number" aria-hidden="true">${shown}</span></button></li>`;
    }).join('')}</ol>
  </section>`;
}

/* ---------- Overview ---------- */

/** focusMode: 'auto' (default top areas) · 'explicit' (user-chosen) · 'none' (every area). */
export function renderOverview({insight, summary, overview, focusMode = 'auto', classOf, provinces = [], scope = null, province = '', ctx = {}}) {
  const unit = ctx.unit;
  const count = insight.areas.length;
  const w = words(insight.areas);
  const names = insight.areas.map(a => `<button type="button" class="link-button" data-action="select-area" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join(' · ');
  const home = provinceName(insight.home);
  let aha;
  if (!summary.count) {
    // In the licensed unit a chain may hold no row while its own branch list does: offer every row instead.
    const widen = unit.mode === 'all' ? '' : `<p class="aha-copy">ร้านที่ไม่พบชื่อเครือในทะเบียน ขย1 อาจอยู่ในรายชื่อสาขาของเครือหรือรายชื่อของสภาเภสัชกรรม — ดูได้เมื่อนับทุกรายการ</p>`;
    aha = `<section class="aha" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p><h2>ไม่พบ${esc(unit.one)}ตามตัวกรองนี้</h2>${widen}
      <div class="aha-actions">${unit.mode === 'all' ? '' : '<button type="button" data-action="set-count" data-value="all" class="btn primary">นับทุกรายการ</button>'}<button type="button" data-action="clear-filter" data-id="all" class="btn">ล้างตัวกรอง</button></div></section>`;
  } else if (focusMode === 'explicit') {
    aha = `<section class="aha is-focused" aria-label="ข้อค้นพบ"><p class="eyebrow">กำลังสำรวจ ${num(count)} ${esc(w)}</p>
      <h2>${insight.areas.map(a => esc(a.name)).join(' · ')}</h2>
      <p class="aha-copy"><strong class="data-number">${num(insight.count)}</strong> ${esc(unit.one)} · <strong class="data-number">${dens(insight.density || 0)}</strong> ${esc(unit.density)}</p>
      <div class="aha-actions"><button type="button" data-action="clear-focus" class="btn">ดูทุกพื้นที่</button><button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button></div></section>`;
  } else if (!count) {
    aha = `<section class="aha" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p><h2><span class="aha-number data-number">${num(summary.count)}</span><span class="aha-headline">${esc(unit.one)}ตามตัวกรอง — ยังระบุตำบลไม่ได้</span></h2>
      <p class="aha-copy">แหล่งข้อมูลระบุที่ตั้งของ${esc(unit.one)}เหล่านี้ได้ถึงอำเภอหรือจังหวัดเท่านั้น จึงยังจัดอันดับตำบลไม่ได้</p></section>`;
  } else {
    const toggle = focusMode === 'auto'
      ? '<button type="button" data-action="clear-focus" class="btn">ดูทุกพื้นที่</button>'
      : `<button type="button" data-action="explore-top" class="btn primary">โฟกัส ${num(count)} ${esc(w)}นี้</button>`;
    const outside = insight.outside && !province ? `<p class="aha-secondary">นอก${esc(home)} ${insight.mode === 'density' ? 'แน่นที่สุด' : 'มากที่สุด'}: <button type="button" class="link-button" data-action="select-area" data-id="${esc(insight.outside.id)}">${esc(areaWord(insight.outside.province))}${esc(insight.outside.name)}</button> ${esc(provinceName(insight.outside.province))} <span class="data-number">${insight.mode === 'density' ? dens(insight.outside.density) : num(insight.outside.count)}</span> ${esc(insight.mode === 'density' ? unit.density : unit.one)}</p>` : '';
    const rule = `<p class="hint">${unit.mode === 'all' ? 'นับทุกรายการในชุดข้อมูล (อาจซ้ำ)' : 'นับร้านที่มีใบอนุญาต ขย1 ในทะเบียน อย.'}${insight.mode === 'density' ? ` · จัดอันดับเฉพาะพื้นที่ที่มีอย่างน้อย ${num(insight.minRows)} ${esc(unit.one)}` : ''}</p>`;
    if (insight.mode === 'density') {
      aha = `<section class="aha${focusMode === 'auto' ? ' is-auto' : ''}" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p>
        <h2><span class="aha-number data-number">${dens(insight.density)}</span><span class="aha-headline">${esc(unit.density)} — ร้านยาแน่นที่สุดใน ${num(count)} ${esc(w)}นี้</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(insight.count)}</strong> ${esc(unit.one)} ใน ${km(insight.km2)} ตร.กม.${insight.baselineDensity ? ` · ทั้ง${esc(home)} <strong class="data-number">${dens(insight.baselineDensity)}</strong> ${esc(unit.density)}` : ''}</p>
        ${outside}${rule}
        <div class="aha-actions">${toggle}<button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button></div></section>`;
    } else {
      aha = `<section class="aha${focusMode === 'auto' ? ' is-auto' : ''}" aria-label="ข้อค้นพบ"><p class="eyebrow">ข้อค้นพบแรก</p>
        <h2><span class="aha-number data-number">${num(Math.round(insight.share))}%</span><span class="aha-headline">ของ${esc(unit.one)}ตามตัวกรองอยู่ใน ${num(count)} ${esc(w)}นี้</span></h2>
        <p class="aha-copy">${names}<br><strong class="data-number">${num(insight.count)}</strong> จาก ${num(insight.totalRows)} ${esc(unit.one)}${insight.home ? ` · ${esc(home)}` : ''}</p>
        ${outside}${rule}<div class="aha-actions">${toggle}<button type="button" data-action="open-charts" class="btn quiet">เปรียบเทียบพื้นที่</button></div></section>`;
    }
  }
  const narrowed = focusMode !== 'none' && count > 0 && summary.count !== insight.totalRows;
  const scopeDensity = scope?.km2 ? insight.totalRows / scope.km2 : null;
  const metrics = `<section class="metrics" aria-label="${narrowed ? 'ตัวเลขของพื้นที่ที่โฟกัส' : 'ตัวเลขรวมของข้อมูลที่เลือก'}">
    ${metricTile(summary.count, `${unit.one}${narrowed ? ' ในโฟกัส' : ''}`, 'store')}
    ${metricTile(narrowed ? dens(insight.density || 0) : (scopeDensity ? dens(scopeDensity) : '—'), narrowed ? `${unit.density} ในโฟกัส` : `${unit.density} ${province ? 'ทั้งจังหวัด' : 'ทั้งประเทศ'}`, 'gla')}
    ${metricTile(summary.quality, `ร้านยาคุณภาพ${narrowed ? ' ในโฟกัส' : ''}`, 'exclusive')}
    ${metricTile(summary.brands, `เครือร้าน${narrowed ? ' ในโฟกัส' : ''}`, 'brand')}
  </section>`;
  const scopeText = province ? `${provinceName(province)} (ขอบเขตแขวง/ตำบลของ CityMETER)` : 'ประเทศไทย 77 จังหวัด (ขอบเขตแขวง/ตำบลของ CityMETER)';
  const provinceRows = p => `<li><button type="button" class="province-row" data-action="select-province" data-id="${esc(p.code)}" aria-label="${esc(p.name)} ${num(p.count)} ${esc(unit.one)} กดเพื่อดูจังหวัด"><i class="province-swatch" style="background:${esc(p.fill)}" aria-hidden="true"></i><span class="province-name">${esc(p.name)}</span><span class="province-count data-number">${num(p.count)}<small>${esc(unit.one)}</small></span></button></li>`;
  const shown = provinces.slice(0, 8), rest = provinces.slice(8);
  const provinceList = provinces.length > 1 ? `<section class="panel-section" aria-labelledby="province-title">
    <div class="section-heading">${heading('province', `จังหวัดที่มี${unit.one}มากที่สุด`, 'province-title')}<span class="hint">${num(provinces.length)} จังหวัด</span></div>
    <ul class="province-list">${shown.map(provinceRows).join('')}</ul>
    ${rest.length ? `<details class="more-provinces"><summary>อีก ${num(rest.length)} จังหวัด</summary><ul class="province-list">${rest.map(provinceRows).join('')}</ul></details>` : ''}
  </section>` : '';
  const eligible = overview.ranking.eligible.length > 0;
  const rank = areaRanking(eligible ? overview.ranking.eligible : overview.ranking.small, classOf, unit,
    {title: eligible ? 'พื้นที่ที่ร้านยาแน่นที่สุด' : `พื้นที่ที่มี${unit.one}มากที่สุด`, minRows: overview.ranking.minRows, byCount: !eligible, showProvince: !province,
      note: eligible ? `${num(overview.ranking.eligible.length)} พื้นที่ ≥ ${num(overview.ranking.minRows)} ${unit.one} · ${unit.density}` : `ไม่มีพื้นที่ใดถึง ${num(overview.ranking.minRows)} ${unit.one} · เรียงตามจำนวน`});
  const chains = overview.chains.length ? `<section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้านที่พบมากที่สุด')}<span class="hint">${unit.mode === 'all' ? 'ทุกรายการที่ผูกกับเครือ' : 'ชื่อในทะเบียนระบุเครือ'}</span></div>${chainChips(overview.chains, unit)}
    ${unit.mode === 'all' ? '' : '<p class="hint">บางเครือไม่พบชื่อเครือในทะเบียน ดูได้เมื่อเลือกหน่วยนับ “ทุกรายการ” <button type="button" class="link-button" data-action="set-count" data-value="all">เปลี่ยนเป็นทุกรายการ</button></p>'}</section>` : '';
  return `${aha}${metrics}${provinceList}${rank}${chains}${provenance(ctx, scopeText)}`;
}

/* ---------- Empty selections (EVID-05) ---------- */

/**
 * measured_zero: the national register (or, in “ทุกรายการ”, every source of the dataset) lists none here
 * under the current filters — a measured 0, offered with the areas where the same filters match.
 */
function selectionNote(p, place, ctx) {
  const unit = ctx.unit;
  if (p.coverageState === 'no_data') {
    return `<div class="empty-note" role="note"><strong>ไม่มีข้อมูลจากแหล่งข้อมูลใน${esc(place)}</strong><span>แหล่งข้อมูลยังไม่ครอบคลุมพื้นที่นี้ จึงไม่ได้แปลว่าไม่มีร้านยา</span></div>`;
  }
  if (p.coverageState === 'measured_zero') {
    const fda = sourceOf(ctx, 'FDA_KHY1');
    const base = ctx.filtered
      ? `<span>0 ${esc(unit.one)}ภายใต้ตัวกรองนี้</span>`
      : `<span>${unit.mode === 'all' ? 'ไม่มีรายการใดในชุดข้อมูลที่ระบุพื้นที่นี้' : `ทะเบียน ขย1 ไม่มีร้านยาที่ระบุพื้นที่นี้ (ข้อมูล ณ ${esc(thaiDate(fda.asOf))})`} — เป็นศูนย์ตามแหล่งข้อมูล ไม่ใช่การสำรวจภาคสนาม</span>`;
    const elsewhere = ctx.filtered && p.scopeCount > 0
      ? `<span>ตัวกรองเดียวกันพบ <strong class="data-number">${num(p.scopeCount)}</strong> ${esc(unit.one)}ในพื้นที่อื่น</span><button type="button" class="btn quiet" data-action="leave-area">ดูพื้นที่ที่พบ</button>`
      : '';
    return `<div class="empty-note" role="note"><strong>ไม่พบ${esc(unit.subject)}ใน${esc(place)}</strong>${base}${elsewhere}</div>`;
  }
  return '';
}

/* ---------- District ---------- */

export function renderDistrict(p, classOf, ctx = {}) {
  if (!p) return '';
  const unit = ctx.unit, d = p.district, w = p.words;
  const ranked = p.areas.filter(a => a.count >= 1);
  const rankText = p.rank ? `อันดับความหนาแน่น ${num(p.rank)} จาก ${num(p.rankOf)}` : `น้อยกว่า ${num(p.minRows)} ${unit.one} · ไม่จัดอันดับ`;
  const place = `${w.district}${d.name}`;
  const head = `<section class="detail-head">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(w.district)} · ${esc(provinceName(d.province))} · ${esc(rankText)}</p>
      <h2>${esc(w.district)}${esc(d.name)}</h2>${d.nameEn ? `<p class="subtle">${esc(d.nameEn)}</p>` : ''}
      <div class="metrics compact">${metricTile(p.count, unit.one, 'store')}${metricTile(dens(p.density), unit.density, 'gla')}${metricTile(p.quality, 'ร้านยาคุณภาพ', 'exclusive')}${metricTile(`${num(ranked.length)}/${num(p.areaTotal)}`, `${w.area}ที่มี${unit.one}`, 'area')}</div>
      ${selectionNote(p, place, ctx)}
      <p class="hint">${km(p.km2 || 0)} ตร.กม. · ความหนาแน่น = ${esc(unit.one)} ÷ พื้นที่ตามขอบเขต CityMETER${p.unplaced ? ` · รวม ${num(p.unplaced)} ${esc(unit.one)}ที่ระบุ${esc(w.area)}ไม่ได้ (ไม่อยู่ในสีของ${esc(w.area)}ใด)` : ''}</p>
      <div class="detail-actions">${p.count ? '<button type="button" class="btn" data-action="open-table">ดูรายชื่อ</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบพื้นที่</button>' : ''}${link(productionLink({province: d.province, district: d.id}), 'ดูใน CityMETER', 'btn quiet source-link')}</div>
    </section>
`;
  if (!p.count) return `${head}${provenance(ctx, `${place} ${provinceName(d.province)} (ขอบเขต CityMETER)`)}`;
  return `${head}    ${areaRanking(ranked, classOf, unit, {title: `${w.area}ใน${w.district}นี้`, note: `${num(ranked.length)} ${w.area} · ${unit.density}`, limit: 40, minRows: p.minRows})}
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}<span class="hint">${esc(unit.one)}</span></div>${groupBars(p.byGroup, p.count, unit)}</section>
    <section class="panel-section"><div class="section-heading">${heading('exclusive', 'ร้านยาคุณภาพ')}</div>${qualityBar(p.quality, p.count, unit)}</section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้าน')}<span class="hint">${num(p.chains.length)}</span></div>${chainChips(p.chains, unit)}</section>
    ${provenance(ctx, `${w.district}${d.name} ${provinceName(d.province)} (ขอบเขต CityMETER)`)}`;
}

/* ---------- Area (แขวง/ตำบล) ---------- */

export function renderArea(p, ctx = {}) {
  if (!p) return '';
  const unit = ctx.unit, a = p.area, w = p.words;
  const rankText = p.rank ? `อันดับความหนาแน่น ${num(p.rank)} จาก ${num(p.rankOf)}` : p.count ? `น้อยกว่า ${num(p.minRows)} ${unit.one} · ไม่จัดอันดับ` : '';
  const place = `${w.area}${a.name}`;
  const listLimit = 30;
  const head = `<section class="detail-head">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">${esc(w.area)} · <button type="button" class="link-button" data-action="select-district" data-id="${esc(a.district)}">${esc(w.district)}${esc(a.districtName)}</button> · ${esc(provinceName(a.province))}${rankText ? ` · ${esc(rankText)}` : ''}</p>
      <h2>${esc(w.area)}${esc(a.name)}</h2>${a.nameEn ? `<p class="subtle">${esc(a.nameEn)}</p>` : ''}
      <div class="metrics compact">${metricTile(p.count, unit.one, 'store')}${metricTile(dens(p.density), unit.density, 'gla')}${metricTile(p.quality, 'ร้านยาคุณภาพ', 'exclusive')}${metricTile(`${num(p.points)}/${num(p.count)}`, 'มีพิกัดจากแหล่ง', 'area')}</div>
      ${selectionNote(p, place, ctx)}
      <p class="hint">${km(p.km2 || 0)} ตร.กม. · ความหนาแน่น = ${esc(unit.one)} ÷ พื้นที่ตามขอบเขต CityMETER${p.unplacedInDistrict ? ` · ไม่รวม ${num(p.unplacedInDistrict)} ${esc(unit.one)}ใน${esc(w.district)}${esc(a.districtName)}ที่ระบุ${esc(w.area)}ไม่ได้` : ''}</p>
      <div class="detail-actions">${p.count ? '<button type="button" class="btn" data-action="open-table">ดูรายชื่อ</button><button type="button" class="btn quiet" data-action="open-charts">เปรียบเทียบพื้นที่</button>' : ''}${link(productionLink({province: a.province, area: a.id}), 'ดูใน CityMETER', 'btn quiet source-link')}</div>
    </section>
`;
  if (!p.count) return `${head}${provenance(ctx, `${place} ${w.district}${a.districtName} ${provinceName(a.province)} (ขอบเขต CityMETER)`)}`;
  return `${head}    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}<span class="hint">${esc(unit.one)}</span></div>${groupBars(p.byGroup, p.count, unit)}</section>
    <section class="panel-section"><div class="section-heading">${heading('exclusive', 'ร้านยาคุณภาพ')}</div>${qualityBar(p.quality, p.count, unit)}</section>
    <section class="panel-section"><div class="section-heading">${heading('brand', 'เครือร้านในพื้นที่')}<span class="hint">${num(p.chains.length)}</span></div>${chainChips(p.chains, unit)}</section>
    <section class="panel-section"><div class="section-heading">${heading('store', `${unit.mode === 'all' ? 'รายการ' : 'ร้านยา'}ในพื้นที่`)}<span class="hint">${num(p.count)}</span></div>${pharmacyList(p.rows.slice(0, listLimit), {unit})}
      ${p.count > listLimit ? `<p class="hint">แสดง ${num(listLimit)} จาก ${num(p.count)} ${esc(unit.one)} (เครือร้านก่อน แล้วเรียงตามชื่อ) · <button type="button" class="link-button" data-action="open-table">ดูทั้งหมดในตาราง</button></p>` : ''}</section>
    ${provenance(ctx, `${place} ${w.district}${a.districtName} ${provinceName(a.province)} (ขอบเขต CityMETER)`)}`;
}

/* ---------- Building (spatial join) ---------- */

export function renderBuilding(b, ctx = {}) {
  if (!b) return '';
  const unit = ctx.unit, w = b.words;
  const area = b.area ? `${w.area}${b.area.name}` : '';
  const height = b.height != null ? `ความสูงบนแผนที่ราว ${num(Math.round(b.height))} ม. (OpenStreetMap ผ่าน OpenFreeMap ไม่ใช่ผลรังวัด)` : '';
  return `<section class="detail-head building">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow">อาคารบนแผนที่${b.area ? ` · <button type="button" class="link-button" data-action="select-area" data-id="${esc(b.area.id)}">${esc(area)}</button>` : ''}</p>
      <h2>${unit.mode === 'all' ? 'รายการ' : 'ร้านยา'}ที่จุดตกในอาคารนี้</h2>
      <div class="metrics compact">${metricTile(b.count, unit.one, 'store')}${metricTile(b.quality, 'ร้านยาคุณภาพ', 'exclusive')}</div>
      <p class="hint">จุดที่แหล่งข้อมูลเผยแพร่ตกในขอบอาคารที่แผนที่วาด ไม่ได้ยืนยันว่าร้านตั้งอยู่ในอาคารนี้หรือชั้นใด${height ? ` · ${esc(height)}` : ''}</p>
    </section>
    <section class="panel-section"><div class="section-heading">${heading('store', unit.mode === 'all' ? 'รายการ' : 'ร้านยา')}<span class="hint">${num(b.count)}</span></div>${pharmacyList(b.rows.slice(0, 40), {showArea: b.areaCount > 1, index: ctx.index, unit})}
      ${b.count > 40 ? `<p class="hint">แสดง ${num(40)} จาก ${num(b.count)} · ดูทั้งหมดในตาราง</p>` : ''}</section>
    <section class="panel-section"><div class="section-heading">${heading('segment', 'ประเภทร้าน')}</div>${groupBars(b.byGroup, b.count, unit)}</section>
    ${provenance(ctx, `จุดของร้านที่ตกในขอบอาคาร OpenStreetMap หนึ่งหลัง${area ? ` · ${area} (ขอบเขต CityMETER)` : ''}`)}`;
}

/* ---------- Store ---------- */

const ADMIN_NOTE = {
  names: 'จับคู่จากชื่อแขวง/ตำบล เขต/อำเภอ และจังหวัดในแหล่งข้อมูลกับรหัสของ CityMETER',
  unique: 'จับคู่จากชื่อตำบลที่มีชื่อเดียวในจังหวัด (ชื่ออำเภอในแหล่งไม่ตรง)',
  point: 'แหล่งไม่ระบุชื่อพื้นที่ที่ใช้ได้ จึงใช้จุดที่แหล่งเผยแพร่ซึ่งตกในขอบเขตตำบลของ CityMETER',
  district: 'แหล่งระบุได้ถึงเขต/อำเภอ (ชื่อแขวง/ตำบลไม่ตรงกับปัจจุบัน) จึงไม่อยู่ในสีของแขวง/ตำบลใด',
  province: 'แหล่งระบุได้ถึงจังหวัด จึงไม่อยู่ในสีของแขวง/ตำบลใด',
  none: 'แหล่งไม่ระบุจังหวัด',
};
const SOURCE_TYPE_TH = {
  fda_license_register: 'ทะเบียน ขย1 อย.', pharmacy_council_directory: 'รายชื่อร้านยา สภาเภสัชกรรม', official_brand_locator: 'หน้าค้นหาสาขาของเครือ',
  official_supplier_stockist: 'รายชื่อจุดจำหน่ายของผู้ผลิต', official_brand_social_profile: 'หน้าทางการของเครือ (LINE)', employer_profile: 'หน้าผู้ประกอบการบนเว็บหางาน',
};
const POINT_ROLE_TH = {
  source_published_pharmacy_location_point_unvalidated: 'จุดจากรายชื่อร้านยาคุณภาพ สภาเภสัชกรรม',
  official_outlet_point: 'จุดจากหน้าสาขาของเครือ', retailer_api_store_point: 'จุดจากระบบค้นหาสาขาของเครือ', retailer_locator_store_marker: 'หมุดจากแผนที่สาขาของเครือ',
};
const BRAND_NOTE = {
  official_source_banner: 'จากรายชื่อสาขาของเครือเอง', distinctive_banner_in_source_name: 'ชื่อร้านในแหล่งระบุชื่อเครือ',
};

export function renderStore(d, ctx = {}) {
  if (!d) return '';
  const unit = ctx.unit, r = d.row, w = d.words;
  const fda = sourceOf(ctx, 'FDA_KHY1'), acc = sourceOf(ctx, 'ACC_PHARM_QUALITY');
  const coords = hasPoint(r) ? `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}` : '';
  const brand = r.brand ? `<dt>เครือร้าน</dt><dd><button type="button" class="link-button" data-action="filter-brand" data-value="${esc(r.brand.id)}">${esc(r.brand.name)}</button><br><span class="hint">${esc(BRAND_NOTE[r.brandStatus] || 'จับคู่จากชื่อร้าน')}</span></dd>`
    : r.candidate ? `<dt>เครือร้าน</dt><dd>ยังไม่ยืนยัน<br><span class="hint">ชื่อคล้าย ${esc(r.candidate.name)} — แหล่งข้อมูลยังยืนยันไม่ได้ว่าเป็นสาขา จึงไม่นับรวมกับเครือ</span></dd>` : '';
  const licence = r.licence
    ? `<span class="data-number">${esc(r.licence)}</span><br><span class="hint">ทะเบียน ขย1 อย. ข้อมูล ณ ${esc(thaiDate(fda.asOf))} · สถานะตามที่เผยแพร่ “คงอยู่” · หมดอายุปี พ.ศ. 2569 (แหล่งให้เฉพาะปี)</span>`
    : '<span>ยังไม่จับคู่กับใบอนุญาตในทะเบียน</span><br><span class="hint">ไม่ได้แปลว่าร้านไม่มีใบอนุญาต — แหล่งนี้ไม่ให้เลขใบอนุญาต และยังยืนยันไม่ได้ว่าตรงกับใบอนุญาตใด</span>';
  const quality = r.quality ? `อยู่ในรายชื่อร้านยาคุณภาพ<br><span class="hint">${link(acc.url, 'รายชื่อร้านยาคุณภาพ สภาเภสัชกรรม')} · ตรวจ ${esc(thaiDate(acc.retrievedOn))} · ไม่ระบุวันเริ่มหรือวันหมดอายุการรับรอง</span>` : 'ไม่พบในรายชื่อร้านยาคุณภาพ';
  const area = d.area
    ? `<button type="button" class="link-button" data-action="select-area" data-id="${esc(d.area.id)}">${esc(w.area)}${esc(d.area.name)}</button> · <button type="button" class="link-button" data-action="select-district" data-id="${esc(d.area.district)}">${esc(w.district)}${esc(d.area.districtName)}</button> · ${esc(provinceName(r.province))}`
    : d.district ? `<button type="button" class="link-button" data-action="select-district" data-id="${esc(d.district.id)}">${esc(w.district)}${esc(d.district.name)}</button> · ${esc(provinceName(r.province))}`
    : r.province ? `<button type="button" class="link-button" data-action="select-province" data-id="${esc(r.province)}">${esc(provinceName(r.province))}</button>` : 'ไม่ระบุ';
  const point = coords
    ? `<span class="data-number">${esc(coords)}</span><br><span class="hint">${esc(POINT_ROLE_TH[r.pointRole] || 'จุดที่แหล่งเผยแพร่')} · ไม่ใช่ทางเข้าร้านหรือผลสำรวจ</span>`
    : '<span>แหล่งข้อมูลไม่เผยแพร่พิกัด</span><br><span class="hint">จึงไม่มีหมุดบนแผนที่ ร้านยังนับอยู่ในพื้นที่ตามที่แหล่งระบุ</span>';
  const bd = d.building;
  const building = bd ? `<dt>อาคาร</dt><dd>${bd.others ? `<button type="button" class="link-button" data-action="select-building" data-id="${esc(bd.key)}">จุดของร้านตกในอาคารเดียวกับอีก ${num(bd.others)} ${esc(unit.one)}</button>` : 'จุดของร้านตกในอาคารบนแผนที่ · ไม่มีร้านอื่นในอาคารนี้ตามตัวกรอง'}<br><span class="hint">ขอบอาคาร OpenStreetMap · ไม่ได้ยืนยันว่าตั้งอยู่ในอาคาร</span></dd>` : '';
  const status = r.status === 'source_temporary_closed' ? '<br><span class="hint">หน้าสาขาของเครือระบุว่าปิดชั่วคราว (ตรวจ 22 ต.ค. 2569)</span>'
    : r.status === 'source_future_opening_review' ? '<br><span class="hint">หน้าสาขาของเครือระบุว่าเป็นสาขาที่กำลังจะเปิด</span>' : '';
  const sourceLine = `${esc(SOURCE_TYPE_TH[r.sourceType] || 'แหล่งข้อมูล')}${r.url ? ` · ${link(r.url, 'เปิดหน้าแหล่ง')}` : ''}${r.sources > 1 ? ` · พบใน ${num(r.sources)} แหล่ง` : ''}`;
  return `<section class="detail-head store">
      <button type="button" class="btn quiet back" data-action="back">กลับ</button>
      <p class="eyebrow eyebrow-cue">${cueMarkup(r.series)}${esc(d.group?.th || '')}</p>
      <h2>${esc(r.name || 'ไม่มีชื่อในแหล่งข้อมูล')}</h2>
      ${unit.mode === 'all' ? `<p class="subtle">${esc(EVIDENCE_LABEL[r.evidence])}</p>` : ''}
      <dl class="facts">
        ${brand}
        <dt>ใบอนุญาต</dt><dd>${licence}</dd>
        <dt>ร้านยาคุณภาพ</dt><dd>${quality}</dd>
        <dt>พื้นที่</dt><dd>${area}<br><span class="hint">${esc(ADMIN_NOTE[r.admin] || '')}</span></dd>
        <dt>พิกัด</dt><dd>${point}</dd>
        ${building}
        <dt>แหล่งข้อมูล</dt><dd>${sourceLine}<br><span class="hint">สถานะเปิดร้านยังไม่ได้ตรวจภาคสนาม</span>${status}<br><span class="hint data-number" title="รหัสรายการในชุดข้อมูลนี้">รหัส ${esc(r.id)}</span></dd>
      </dl>
      <p class="links">${d.area ? link(productionLink({province: r.province, area: r.area}), 'ดูพื้นที่นี้ใน CityMETER') : ''}</p>
    </section>
    ${d.sameBrandHere.length ? `<section class="panel-section"><div class="section-heading">${heading('brand', `รายการอื่นของ ${r.brand.name} ใน${w.area}นี้`)}<span class="hint">${num(d.sameBrandHere.length)}</span></div>
      ${pharmacyList(d.sameBrandHere.slice(0, 8), {unit: {...unit, mode: 'all'}})}
      <p class="hint">อาจเป็นร้านเดียวกันที่พบในหลายแหล่ง ชีตวิจัยแยกไว้เพราะหลักฐานยืนยันตัวตนยังไม่พอ</p></section>` : ''}
    ${r.brand ? `<section class="panel-section"><div class="section-heading">${heading('brand', `${unit.one}อื่นของ ${r.brand.name}`)}<span class="hint">${num(d.sameBrand.count)} ${esc(unit.one)} · ${num(d.sameBrand.areas)} พื้นที่</span></div>
      ${d.sameBrand.rows.length ? pharmacyList(d.sameBrand.rows, {showArea: true, index: ctx.index, unit}) : '<p class="hint">ไม่มีในตัวกรองนี้</p>'}
      <div class="detail-actions"><button type="button" class="btn quiet" data-action="filter-brand" data-value="${esc(r.brand.id)}">ดูเฉพาะเครือนี้</button></div></section>` : ''}
    ${d.sameArea.length ? `<section class="panel-section"><div class="section-heading">${heading('segment', `${d.group?.th || 'ร้าน'}อื่นในพื้นที่`)}</div>${pharmacyList(d.sameArea, {unit})}</section>` : ''}
    ${provenance(ctx, d.area ? `${w.area}${d.area.name} ${provinceName(r.province)} (ขอบเขต CityMETER)` : provinceName(r.province) || 'ไม่ระบุจังหวัด')}`;
}

/* ---------- Active filter chips ---------- */

export function renderFilterChips(values, labels) {
  const chips = [];
  const push = (key, text) => chips.push(`<li><button type="button" class="filter-chip" data-action="clear-filter" data-id="${esc(key)}" aria-label="ล้างตัวกรอง ${esc(text)}"><span>${esc(text)}</span><i aria-hidden="true">×</i></button></li>`);
  if (values.search) push('search', `ค้นหา “${values.search}”`);
  if (values.group) push('group', labels.group[values.group] || values.group);
  if (values.quality) push('quality', 'เฉพาะร้านยาคุณภาพ');
  if (values.province) push('province', labels.province[values.province] || values.province);
  if (values.brand) push('brand', labels.brand[values.brand] || values.brand);
  if (values.count) push('count', 'นับทุกรายการ (อาจซ้ำ)');
  return chips.length ? `<ul class="filter-chips" aria-label="ตัวกรองที่ใช้อยู่">${chips.join('')}<li><button type="button" class="filter-chip clear-all" data-action="clear-filter" data-id="all">ล้างทั้งหมด</button></li></ul>` : '';
}
