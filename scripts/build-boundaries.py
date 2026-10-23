#!/usr/bin/env python3
"""Build the demo's administrative frames from CityMETER production boundaries (all 77 provinces).

Inputs (not committed — public, read-only responses saved with their receipts):
  --api   directory with base-lv0.json and base-{province uuid}.json (+ .meta.json receipts)
          GET https://landometer.com/api/v2/citymeter-v3/base/info/lv0 and /lv1/{province uuid}
  --geom  directory with SUBDISTRICT-{uuid}.json (+ .meta.json receipts: url, status, bytes, sha256, retrieved_at)
          GET https://landometer.com/api/v2/citymeter-v3/base/info/geom/{uuid}/SUBDISTRICT
  --mapshaper  command for mapshaper 0.6.x (default: "npx mapshaper")

Outputs (under --out):
  data/provinces.geojson         77 PROVINCE frames (country view), dissolved from the subdistricts
  data/frames/{ABBR}.json        one file per province, loaded on demand by the app:
                                 {"areas": FeatureCollection (แขวง/ตำบล), "districts": FeatureCollection (เขต/อำเภอ)}
  data/area-index.json           attributes of every subdistrict, district and province (no geometry):
                                 names, production codes, areaSqm, label point and bbox — search, ranks,
                                 breadcrumbs and camera fits work before a frame file is loaded
  data/boundary-receipts.json    one receipt per production response used

Rules: ids and names come from the production base info (code = DOPA code used by the production route
/v3/citymeter/{abbrEn}/S/{code}); areaSqm is the production value, never recomputed from a simplified
outline. Simplification is display-only and topology-preserving (shared borders stay shared, across
provinces too, because every subdistrict is simplified in one pass); districts and provinces are
dissolved from the simplified subdistricts so every level nests exactly.
"""
import argparse, datetime, hashlib, json, os, shlex, subprocess, sys, tempfile


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def value(doc):
    v = doc.get('value', doc)
    return json.loads(v) if isinstance(v, str) else v


def verified(path):
    """Bytes of a saved response whose receipt (status 200, sha256) matches; exit otherwise."""
    raw = open(path, 'rb').read()
    meta = load(path[:-5] + '.meta.json')
    if meta.get('status') != 200 or meta.get('sha256') != hashlib.sha256(raw).hexdigest():
        sys.exit(f'unverified receipt: {path}')
    return raw, meta


def bbox_of(geometry):
    w = s = 1e9; e = n = -1e9
    polys = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    for poly in polys:
        for x, y in poly[0]:
            w, e, s, n = min(w, x), max(e, x), min(s, y), max(n, y)
    return [round(w, 4), round(s, 4), round(e, 4), round(n, 4)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', required=True)
    ap.add_argument('--geom', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--mapshaper', default='npx mapshaper')
    ap.add_argument('--interval', default='30', help='subdistrict simplification interval in metres (display only)')
    ap.add_argument('--province-interval', default='250', help='province frame simplification interval in metres (display only)')
    a = ap.parse_args()

    receipts = []
    raw, meta = verified(os.path.join(a.api, 'base-lv0.json'))
    receipts.append({'id': 'lv0', 'url': meta['url'], 'sha256': meta['sha256'], 'bytes': meta['bytes'], 'retrievedAt': meta['retrieved_at']})
    lv0 = value(json.loads(raw))
    provinces, districts_meta, features = {}, {}, []
    for p in lv0['provinceInfos']:
        raw, meta = verified(os.path.join(a.api, f"base-{p['id']}.json"))
        receipts.append({'id': p['id'], 'url': meta['url'], 'sha256': meta['sha256'], 'bytes': meta['bytes'], 'retrievedAt': meta['retrieved_at']})
        base = value(json.loads(raw))
        provinces[p['abbrEn']] = {'id': p['abbrEn'], 'code': p['code'], 'uuid': p['id'], 'name': p['nameTh'], 'nameEn': p['nameEn'], 'areaSqm': p['areaSqm'],
                                  'districts': len(base['districtInfos']), 'subdistricts': len(base['subdistrictInfos'])}
        dist = {d['code']: d for d in base['districtInfos']}
        subs_per_district = {}
        for s in base['subdistrictInfos']:
            subs_per_district[s['code'][:4]] = subs_per_district.get(s['code'][:4], 0) + 1
        for d in base['districtInfos']:
            districts_meta[d['code']] = {'id': d['code'], 'uuid': d['id'], 'name': d['nameTh'], 'nameEn': d.get('nameEn') or '',
                                         'province': p['abbrEn'], 'areaSqm': d['areaSqm'], 'subdistricts': subs_per_district.get(d['code'], 0)}
        for s in base['subdistrictInfos']:
            graw, gmeta = verified(os.path.join(a.geom, f"SUBDISTRICT-{s['id']}.json"))
            geom = value(json.loads(graw))
            if not geom or geom.get('type') not in ('Polygon', 'MultiPolygon'):
                sys.exit(f'missing geometry for subdistrict {s["code"]}')
            receipts.append({'id': s['id'], 'url': gmeta['url'], 'sha256': gmeta['sha256'], 'bytes': gmeta['bytes'], 'retrievedAt': gmeta['retrieved_at']})
            d = dist.get(s['code'][:4], {})
            features.append({'type': 'Feature', 'geometry': geom, 'properties': {
                'id': s['code'], 'uuid': s['id'], 'name': s['nameTh'], 'nameEn': s.get('nameEn') or '',
                'district': s['code'][:4], 'districtName': d.get('nameTh', ''), 'province': p['abbrEn'],
                'provinceDopa': p['code'], 'areaSqm': s['areaSqm']}})

    tmp = tempfile.mkdtemp(prefix='boundaries-')
    raw_path = os.path.join(tmp, 'subdistricts.raw.json')
    with open(raw_path, 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'features': features}, fh, ensure_ascii=False)
    ms = shlex.split(a.mapshaper)

    def run(*args):
        cmd = ms + list(args)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            sys.exit('mapshaper failed: ' + ' '.join(cmd) + '\n' + r.stderr)
        return r.stderr

    simp = os.path.join(tmp, 'subdistricts.json')
    run('-i', raw_path, '-simplify', f'interval={a.interval}', 'keep-shapes', '-clean', '-o', simp, 'precision=0.00001', 'format=geojson')
    dis = os.path.join(tmp, 'districts.json')
    run('-i', simp, '-dissolve', 'district', 'copy-fields=province', '-o', dis, 'precision=0.00001', 'format=geojson')
    pro = os.path.join(tmp, 'provinces.json')
    # Province frames are read at country zoom: a coarser display interval keeps them light.
    run('-i', simp, '-dissolve', 'province', '-simplify', f'interval={a.province_interval}', 'keep-shapes', '-clean', '-o', pro, 'precision=0.0001', 'format=geojson')

    def labels(path, field):
        pts = os.path.join(tmp, os.path.basename(path) + '.points.json')
        run('-i', path, '-points', 'inner', '-o', pts, 'precision=0.00001', 'format=geojson')
        return {f['properties'][field]: f['geometry']['coordinates'] for f in load(pts)['features']}

    sub, dfc, pfc = load(simp), load(dis), load(pro)
    sl, dl, pl = labels(simp, 'id'), labels(dis, 'district'), labels(pro, 'province')
    if len(sub['features']) != len(features):
        sys.exit(f'simplification dropped features: {len(sub["features"])} of {len(features)}')
    now = datetime.date.today().isoformat()
    prov = {
        'source': 'CityMETER production boundaries (public read-only API)',
        'geometryEndpoint': 'https://landometer.com/api/v2/citymeter-v3/base/info/geom/{uuid}/SUBDISTRICT',
        'attributeEndpoint': 'https://landometer.com/api/v2/citymeter-v3/base/info/lv1/{province uuid}',
        'retrievedOn': min(r['retrievedAt'] for r in receipts)[:10],
        'builtOn': now,
        'simplification': f'mapshaper -simplify interval={a.interval} keep-shapes -clean over all 7,436 subdistricts in one pass (display only, topology preserved); districts dissolved from the simplified subdistricts; provinces dissolved then simplified at interval={a.province_interval} for the country view',
        'areaSqm': 'production value from base info; never recomputed from the simplified outline',
        'receipts': len(receipts),
        'receiptsSha256': hashlib.sha256(json.dumps(sorted((r['id'], r['sha256']) for r in receipts)).encode()).hexdigest(),
        'limits': 'Administrative frames for navigation and aggregation of this dataset; not an official boundary certificate.',
    }

    by_province_areas, by_province_districts = {}, {}
    area_index = {'id': [], 'name': [], 'nameEn': [], 'areaSqm': [], 'label': [], 'bbox': []}
    for f in sorted(sub['features'], key=lambda f: f['properties']['id']):
        pid = f['properties']['id']
        f['id'] = pid
        f['properties']['label'] = sl.get(pid)
        f['properties']['bbox'] = bbox_of(f['geometry'])
        by_province_areas.setdefault(f['properties']['province'], []).append(f)
        area_index['id'].append(pid); area_index['name'].append(f['properties']['name']); area_index['nameEn'].append(f['properties']['nameEn'])
        area_index['areaSqm'].append(round(f['properties']['areaSqm'], 2)); area_index['label'].append(sl.get(pid)); area_index['bbox'].append(f['properties']['bbox'])
    district_index = {'id': [], 'name': [], 'nameEn': [], 'province': [], 'areaSqm': [], 'subdistricts': [], 'label': [], 'bbox': []}
    for f in sorted(dfc['features'], key=lambda f: f['properties']['district']):
        m = districts_meta[f['properties']['district']]
        f['id'] = m['id']
        f['properties'] = {**m, 'label': dl.get(m['id']), 'bbox': bbox_of(f['geometry'])}
        by_province_districts.setdefault(m['province'], []).append(f)
        for k in ('id', 'name', 'nameEn', 'province', 'subdistricts'):
            district_index[k].append(m[k])
        district_index['areaSqm'].append(round(m['areaSqm'], 2)); district_index['label'].append(dl.get(m['id'])); district_index['bbox'].append(f['properties']['bbox'])
    province_list = []
    for f in sorted(pfc['features'], key=lambda f: provinces[f['properties']['province']]['code']):
        m = provinces[f['properties']['province']]
        f['id'] = m['id']
        f['properties'] = {**m, 'label': pl.get(m['id']), 'bbox': bbox_of(f['geometry'])}
        province_list.append(f['properties'])

    os.makedirs(os.path.join(a.out, 'data', 'frames'), exist_ok=True)

    def dump(path, obj):
        with open(os.path.join(a.out, path), 'w', encoding='utf-8') as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
        return os.path.getsize(os.path.join(a.out, path))

    print('data/provinces.geojson', len(pfc['features']), dump('data/provinces.geojson', {'type': 'FeatureCollection', 'metadata': {**prov, 'level': 'PROVINCE', 'features': len(pfc['features'])}, 'features': pfc['features']}))
    total = 0
    for code, feats in sorted(by_province_areas.items()):
        doc = {'metadata': {**prov, 'province': code, 'areas': len(feats), 'districts': len(by_province_districts.get(code, []))},
               'areas': {'type': 'FeatureCollection', 'features': feats},
               'districts': {'type': 'FeatureCollection', 'features': by_province_districts.get(code, [])}}
        total += dump(f'data/frames/{code}.json', doc)
    print('data/frames/*.json', len(by_province_areas), total)
    print('data/area-index.json', dump('data/area-index.json', {'metadata': {**prov, 'areas': len(area_index['id']), 'districts': len(district_index['id']), 'provinces': len(province_list)},
                                                               'provinces': province_list, 'districts': district_index, 'areas': area_index}))
    with open(os.path.join(a.out, 'data', 'boundary-receipts.json'), 'w', encoding='utf-8') as fh:
        json.dump({'metadata': prov, 'receipts': sorted(receipts, key=lambda r: r['id'])}, fh, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main()
