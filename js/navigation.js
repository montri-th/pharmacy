/**
 * This demo's navigation on the shared header code: the titles of its controls and its pictogram subset. The
 * nav-7 glyphs and the help dialog are js/shell/navigation.js, the dataset picker js/shell/header.js
 * (citymeter-shell: edit those in every repository at once, js/shell/manifest.json).
 */
import {installNavigation, NAV_GLYPHS, NAV_ICON_CONTRACT} from './shell/navigation.js';
import {installHeader} from './shell/header.js';

export {NAV_GLYPHS, NAV_ICON_CONTRACT};

/**
 * Metric-tile pictograms (test exception approved by the owner 2026-10-22 for the
 * Luxury Brands demo, reused here byte-for-byte; to be registered in LDS if it
 * proves itself). Same family and axes as nav-7, a separate subset so the
 * approved nav-7 bytes stay unchanged. Glyph → meaning in Pharmacy:
 * brand (diamond) = เครือร้าน · store (storefront) = ร้านยา · area (map) = แขวง/ตำบล ·
 * province (location_city) = จังหวัด · exclusive (star) = ร้านยาคุณภาพ (an accreditation
 * list of the Pharmacy Council, not a rating) · gla (square_foot) = ร้าน/ตร.กม. ·
 * segment (category) = ประเภทร้าน. venue (local_mall) is not used.
 */
export const PICTOGRAM_CONTRACT = Object.freeze({
  family: 'LDS Material Symbols Rounded Pictogram',
  file: 'assets/icons/material-pictogram-300.woff2', bytes: 1732,
  sha256: '33d9084bbd26b976d5c42002a0c669618573c21123567247816e9e694671c7b0',
  manifest: 'assets/icons/material-pictogram-300.json',
  axes: Object.freeze({FILL: 0, wght: 300, GRAD: 0, opsz: 24}),
  glyphs: Object.freeze({brand: '\uEAD5', store: '\uEA12', venue: '\uE54C', area: '\uE55B', province: '\uE7F1', exclusive: '\uF09A', gla: '\uEA49', segment: '\uE72C'}),
  status: 'test exception to LDS nav-7 (owner 2026-10-22)',
  fallback: 'Text labels carry the meaning; pictograms stay hidden until the font has loaded.',
});
const TITLES = {
  'fit-map': 'ปรับแผนที่ให้เห็นพื้นที่ที่โฟกัสหรือพื้นที่ที่เลือก',
  'country-map': 'ดูทั้งประเทศ: กรอบจังหวัดแสดงจำนวนร้าน ทุกพื้นที่มีสี (ล้างตัวกรองจังหวัดและโฟกัส)',
  'toggle-3d': 'สลับมุมมอง 3 มิติ (อาคารทั้งเมือง) กับแผนผัง 2 มิติ',
  'toggle-neighborhoods': 'แสดงหรือซ่อนสีและขอบเขตแขวง/ตำบล',
  'mobile-panel': 'เปิดแผงข้อมูลและตัวกรอง',
  'open-help': 'เปิดวิธีใช้',
  'open-help-sheet': 'เปิดวิธีใช้',
  'toggle-insights': 'เปิดหรือย่อกราฟเปรียบเทียบพื้นที่',
  'open-table': 'เปิดตารางร้านยาตามตัวกรอง',
  'toggle-table': 'ปิดตารางและกลับไปแผนที่',
  'search': 'ค้นหาชื่อร้านยา เครือร้าน เลขใบอนุญาต แขวง/ตำบล หรือเขต/อำเภอ',
  'group': 'กรองตามประเภทร้าน (จัดกลุ่มจากประเภทในชีตวิจัย)',
  'quality': 'กรองเฉพาะร้านที่อยู่ในรายชื่อร้านยาคุณภาพของสภาเภสัชกรรม',
  'province': 'กรองตามจังหวัด',
  'brand': 'กรองตามเครือร้าน (เฉพาะชื่อเครือที่ชีตวิจัยยืนยันแล้ว)',
  'count': 'หน่วยนับ: ร้านที่มีใบอนุญาต ขย1 (นับไม่ซ้ำ) หรือทุกรายการจากทุกแหล่ง (อาจซ้ำ)',
  'prev-page': 'ดูหน้าก่อนหน้าของตาราง',
  'next-page': 'ดูหน้าถัดไปของตาราง',
  'tab-density': 'เปรียบเทียบร้านต่อตารางกิโลเมตรของแต่ละพื้นที่',
  'tab-mix': 'ดูประเภทร้านในแต่ละพื้นที่',
  'tab-quality': 'ดูสัดส่วนร้านยาคุณภาพในแต่ละพื้นที่',
};

if (typeof document !== 'undefined') {
  installNavigation({titles: TITLES, pictogramProbe: PICTOGRAM_CONTRACT.glyphs.store});
  installHeader();
}
