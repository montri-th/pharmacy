/**
 * Province frames on demand. The 7,436 subdistrict outlines of the country (≈ 50 MB as GeoJSON) are split
 * into one file per province (data/frames/{CODE}.json: {areas, districts}); the app loads a province when
 * it is needed — the Aha's province at start, a selected province/district/area, a deep link, or the
 * province under the middle of the map once the map is zoomed in far enough to read แขวง/ตำบล.
 *
 * The store keeps one merged FeatureCollection per level (a new object after every load, so a map source
 * can setData it) and attaches each outline to its index record (js/areas.js#attachFrames).
 * A failed load is reported and retried on the next request; data never depends on it (ranks, panels and
 * charts use the index and the rows).
 */
import {attachFrames} from './areas.js';

export function createFrameStore({index, base = 'data/frames/', fetchJSON, version = '', onLoad = () => {}, onError = () => {}, concurrency = 2} = {}) {
  const loaded = new Map(), pending = new Map(), queue = [];
  let active = 0, areas = {type: 'FeatureCollection', features: []}, districts = {type: 'FeatureCollection', features: []}, revision = 0;

  function valid(json) {
    const fc = v => v?.type === 'FeatureCollection' && Array.isArray(v.features) && v.features.every(f => f?.type === 'Feature' &&
      (typeof (f.id ?? f.properties?.id) === 'string') && ['Polygon', 'MultiPolygon'].includes(f.geometry?.type));
    return fc(json?.areas) && fc(json?.districts);
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      fetchJSON(`${base}${job.code}.json${version ? `?v=${version}` : ''}`, {timeout: 45000})
        .then(json => {
          if (!valid(json)) { const e = new Error('Invalid frame file'); e.resource = job.code; throw e; }
          attachFrames(index, json);
          loaded.set(job.code, json);
          areas = {type: 'FeatureCollection', features: [...areas.features, ...json.areas.features]};
          districts = {type: 'FeatureCollection', features: [...districts.features, ...json.districts.features]};
          revision++;
          job.resolve(json);
          onLoad(job.code, json);
        })
        .catch(error => { job.reject(error); onError(job.code, error); })
        .finally(() => { active--; pending.delete(job.code); pump(); });
    }
  }

  /** Load one province's frames (idempotent). Resolves with its frame file. */
  function ensure(code) {
    if (!code || !index.provinceById.has(code)) return Promise.resolve(null);
    if (loaded.has(code)) return Promise.resolve(loaded.get(code));
    if (pending.has(code)) return pending.get(code);
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {});
    pending.set(code, promise);
    queue.push({code, resolve, reject});
    pump();
    return promise;
  }

  return {
    ensure,
    ensureMany: codes => Promise.allSettled([...new Set(codes)].filter(Boolean).map(ensure)),
    isLoaded: code => loaded.has(code),
    isPending: code => pending.has(code),
    loadedCodes: () => [...loaded.keys()],
    areas: () => areas,
    districts: () => districts,
    revision: () => revision,
  };
}

/** Province code under a point (lng/lat) from the province frames (country view geometry), or ''. */
export function provinceLocator(provincesGeo) {
  const inRing = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const items = (provincesGeo?.features || []).map(f => {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    const [w, s, e, n] = f.properties?.bbox || [-180, -90, 180, 90];
    return {id: String(f.id ?? f.properties?.id), polys, w, s, e, n};
  });
  return ([x, y]) => {
    for (const it of items) {
      if (x < it.w || x > it.e || y < it.s || y > it.n) continue;
      if (it.polys.some(p => inRing([x, y], p[0]) && !p.slice(1).some(h => inRing([x, y], h)))) return it.id;
    }
    return '';
  };
}
