/**
 * Chain logos the CityMETER demo family already verified (data/brand-logos.json, written by scripts/attach-family-logos.py
 * with the shared kit citymeter-logos — D64 of CityMETER · Shopping Center, owner 2026-11-24 07:53: “… หาวิธีแก้ที่แก้ได้
 * ทุกที่เหมือนกัน”). This research round collected no chain logos; Watsons, Boots, matsukiyo and LAB Pharmacy carry the same
 * brand ids in the Beauty research master, whose verified files CityMETER · Shopping Center ships.
 * Optional: until the file loads, or if it fails, a chain reads by its name alone. A logo sits beside the name, which stays
 * the identity; it changes no count, filter or rank. Collecting a file is not a trademark licence.
 */
const FILE = /^assets\/brand-logos\/[a-f0-9]{20}\.(svg|png|jpe?g|webp|gif)$/;
const PLATES = new Set(['#E5E9E6', '#FFFFFF', '#182327']);
let logos = new Map();

/** Keep the records that are safe to draw; returns how many chains have a logo. */
export function setBrandLogos(json) {
  logos = new Map();
  for (const [id, r] of Object.entries(json?.logos || {})) {
    if (FILE.test(r?.file || '') && /^[a-f0-9]{64}$/.test(r?.sha256 || '') && PLATES.has(r?.background)) logos.set(id, r);
  }
  return logos.size;
}

export const brandLogo = id => logos.get(id) || null;

/** The plate and its image (decorative: the chain's name is always beside it). '' when the chain has no logo. */
export function brandLogoMarkup(id, {size = 'chip'} = {}) {
  const r = brandLogo(id);
  if (!r) return '';
  const w = r.width > 0 ? Math.round(r.width) : 0, h = r.height > 0 ? Math.round(r.height) : 0;
  return `<span class="brand-logo brand-logo-${size === 'store' ? 'store' : 'chip'}" style="--brand-logo-bg:${r.background}" aria-hidden="true"><img src="${r.file}" alt="" loading="lazy" decoding="async"${w && h ? ` width="${w}" height="${h}"` : ''}></span>`;
}
