/**
 * Breadcrumb — ประเทศไทย › จังหวัด › เขต/อำเภอ › แขวง/ตำบล — the CityMETER production hierarchy, through the shared
 * shell (js/shell/breadcrumb.js, citymeter-shell 0.4.0). Every administrative crumb carries its production deep
 * link `/v3/citymeter/{province}[/D/{district} | /S/{subdistrict}]`; production has no pharmacy dataset yet, so the
 * links carry no `d` parameter. A store is the panel heading, never a crumb — its crumbs are its own matched
 * subdistrict, district and province (a row placed only at district or province level stops there).
 */
import {provinceByCode} from './model.js';
import {areaWord, levelWords} from './areas.js';
import {buildBreadcrumb as shellBreadcrumb, renderBreadcrumb, breadcrumbText, deepestHref} from './shell/breadcrumb.js';

/** Production carries no pharmacy dataset yet: crumbs link the place alone (no `?d=`). */
const PRODUCTION_DATASET = '';
const subWord = province => levelWords(province).area;

/** Pure model. province = production code or ''; district = a district record, area = a subdistrict record, or null. */
export const buildBreadcrumb = ({province = '', district = null, area = null} = {}) =>
  shellBreadcrumb({province, area: area ? null : district, sub: area}, {dataset: PRODUCTION_DATASET, provinceByCode, areaWord: p => levelWords(p).district, subWord});
export {renderBreadcrumb, breadcrumbText};

/** Production deep link of the deepest administrative crumb (for “ดูใน CityMETER”). */
export const productionHref = crumbs => deepestHref(crumbs, PRODUCTION_DATASET);
