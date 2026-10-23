/**
 * Pharmacy points × building footprints — a display-time spatial join (same contract as CityMETER ·
 * Restaurants 0.2, owner decision 2026-10-23).
 *
 * Buildings are the ones the map draws: the focus-tier OpenStreetMap footprints (js/massing.js keeps each
 * original footprint, before rounding/offset). A row joins a building when its PUBLISHED SOURCE POINT lies
 * inside the footprint; inside several (an OSM part inside an outline) → the smallest. Only rows that carry
 * a point take part (most rows have none).
 *
 * What it is: "จุดของร้านตกในอาคาร" — the point the source published falls inside the outline. What it is
 * not: a verified located-inside relationship, an address, a floor or a unit. The result only (a) answers a
 * click on a building and (b) lists the other rows whose points fall in the same building, always labelled
 * as such. It never changes an area count.
 */
import {pointInRing} from './geometry.js';

/** Grid cell (degrees, ≈ 165 m) of the bbox index. */
const CELL = 0.0015;

const bboxOf = ring => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
};
/** Planar area in degree² (only compared between nearby footprints). */
const areaOf = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};

/**
 * Normalise a footprint: {key, outer, holes?, height?, kind?, ref?}.
 * `key` must be unique across the join ('osm:<id>').
 */
export function footprint(b) {
  const outer = b.outer, holes = b.holes || [];
  return {...b, holes, bbox: b.bbox || bboxOf(outer), area: areaOf(outer)};
}

export function containsPoint(b, [x, y]) {
  const [w, s, e, n] = b.bbox;
  if (x < w || x > e || y < s || y > n) return false;
  if (!pointInRing([x, y], b.outer)) return false;
  return !b.holes.some(h => pointInRing([x, y], h));
}

function indexOf(buildings) {
  const cells = new Map();
  for (const b of buildings) {
    const [w, s, e, n] = b.bbox;
    for (let i = Math.floor(w / CELL); i <= Math.floor(e / CELL); i++) {
      for (let j = Math.floor(s / CELL); j <= Math.floor(n / CELL); j++) {
        const k = `${i}:${j}`;
        const list = cells.get(k);
        if (list) list.push(b); else cells.set(k, [b]);
      }
    }
  }
  return cells;
}

/**
 * Join rows (with longitude/latitude) to footprints.
 * Returns {buildings: Map(key → footprint), byBuilding: Map(key → rows[]), byRow: Map(rowId → key)}.
 */
export function joinRows(footprints, rows) {
  const list = footprints.map(footprint);
  const buildings = new Map(list.map(b => [b.key, b]));
  const cells = indexOf(list);
  const byBuilding = new Map(), byRow = new Map();
  for (const r of rows) {
    const x = r.longitude, y = r.latitude;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const candidates = cells.get(`${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`);
    if (!candidates) continue;
    let best = null;
    for (const b of candidates) if ((!best || b.area < best.area) && containsPoint(b, [x, y])) best = b;
    if (!best) continue;
    byRow.set(r.id, best.key);
    const at = byBuilding.get(best.key);
    if (at) at.push(r); else byBuilding.set(best.key, [r]);
  }
  return {buildings, byBuilding, byRow};
}
