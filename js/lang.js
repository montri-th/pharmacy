/**
 * Pharmacy · page language (citymeter-shell, js/shell/i18n.js). js/app.js imports this module first, so an English page
 * is translated before anything renders. The words are in js/lang-en.js. Names come from the data's own English and
 * are never translated here (demo-platform-review §5.8): provinces and subdistricts from production base info,
 * districts from OpenGISData-Thailand (DOPA-credited, data/area-index.json metadata.englishNames), the pharmacy types
 * from groups[].en; chains are named in English by the data. A pharmacy's name stays as its source writes it
 * (keepThai), and so does a place the data gives no English for, or two different English names.
 */
import {LANG, registerDictionary, registerNames, keepThai, startTranslation} from './shell/i18n.js';
import PHARMACY_EN from './lang-en.js';

const THAI = /[ก-ฺเ-๎]/;

if (LANG === 'en') {
  registerDictionary(PHARMACY_EN);
  startTranslation();
  // The English is a draft until reviewed (demo-platform-review §5.8): the help dialog says so.
  const note = () => {
    const intro = document.querySelector('.usage-dialog .help-intro');
    if (!intro || document.getElementById('draft-english-note')) return;
    const p = document.createElement('p');
    p.id = 'draft-english-note';
    p.className = 'help-intro';
    p.textContent = 'English is a draft translation from the Thai. Pharmacy names stay as their sources write them, and so does a place name with no English in the data. KhY1 is the licence to sell modern medicines in the FDA register. The product statement is in Thai.';
    intro.after(p);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', note, {once: true}); else note();
}

/** Register the English the data carries. index = js/areas.js buildAreaIndex, data = js/model.js decodeDataset. */
export function registerDataNames({index, data}) {
  if (LANG !== 'en') return;
  const labels = {};
  for (const g of data?.groups || []) if (g.th && g.en) labels[g.th] = g.en;
  registerDictionary({exact: labels});
  // A Thai name the data spells in more than one English way stays Thai (no guess between them).
  const english = new Map(), thai = new Set();
  const add = (th, en) => {
    if (!th || !THAI.test(th)) return;
    if (!en || THAI.test(en)) { thai.add(th); return; }
    const seen = english.get(th);
    if (seen === undefined) english.set(th, en); else if (seen !== en) english.set(th, null);
  };
  for (const p of index?.provinces || []) { add(p.name, p.nameEn); add(`จังหวัด${p.name}`, p.nameEn); }
  const bangkok = (index?.provinces || []).find(p => p.id === 'BKK')?.nameEn;
  add('กรุงเทพฯ', bangkok); add('กรุงเทพ', bangkok);
  // Districts first, then subdistricts: a bare name shared by both reads as the subdistrict (the bare names on the page
  // are subdistricts: ranks, labels, the first finding); with its word (เขต/อำเภอ, แขวง/ตำบล) each reads as itself.
  const plain = new Map();
  for (const d of index?.districts || []) {
    add(`${d.province === 'BKK' ? 'เขต' : 'อำเภอ'}${d.name}`, d.nameEn);
    plain.set(d.name, d.nameEn);
  }
  for (const a of index?.areas || []) {
    add(`${a.province === 'BKK' ? 'แขวง' : 'ตำบล'}${a.name}`, a.nameEn);
    plain.set(a.name, a.nameEn);
  }
  const subNames = new Map();
  for (const a of index?.areas || []) {
    const seen = subNames.get(a.name);
    subNames.set(a.name, seen === undefined ? a.nameEn || '' : seen === (a.nameEn || '') ? seen : null);
  }
  for (const [th, en] of plain) {
    const sub = subNames.get(th);
    if (sub === null) { thai.add(th); continue; }
    add(th, sub !== undefined ? sub : en);
  }
  const pairs = [];
  for (const [th, en] of english) { if (en) pairs.push([th, en]); else thai.add(th); }
  // As the sources write them: pharmacy names (rows without a name read “no name in the source”, a dictionary phrase).
  for (const r of data?.rows || []) if (r.name && THAI.test(r.name)) thai.add(r.name);
  registerNames(pairs);
  keepThai([...thai].filter(th => !english.get(th)));
}
