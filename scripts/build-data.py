#!/usr/bin/env python3
"""Build data/pharmacies.json from the research sheet of record and CityMETER production frames.

Inputs (internal, never committed):
  --sheet  xlsx export of “CityMETER Pharmacy Thailand — Research Master 2026-10-22”
           (tabs 00_README, 01_BRANDS, 02_STORES, 04_SOURCES, 05_REVIEW_QUEUE, 07_PROVINCE_COVERAGE)
  --api    production base info responses (base-lv0.json, base-{province uuid}.json) — the code lists
  --geom   production subdistrict geometry responses (SUBDISTRICT-{uuid}.json) — only for rows that
           carry a published source point but no usable administrative names (see ADMIN METHODS)
  --index  data/area-index.json from scripts/build-boundaries.py (every code written here must exist there)

Output (under --out): data/pharmacies.json — columnar rows + dictionaries + provenance.

One row = one row of 02_STORES (a source-qualified outlet candidate, as the sheet defines it). Nothing is
merged, split or moved here. What this script adds is only the join to production codes:

ADMIN METHODS (in order; the first that applies wins)
  names      province + district + subdistrict names of the row → production codes (normalised exact match:
             prefixes อำเภอ/ตำบล/เขต/แขวง/อ./ต./จ. dropped, spaces and zero-width marks removed, ํา → ำ;
             a district written without “เมือง” is accepted when only “เมือง…” exists in the province)
  unique     district name not found but the subdistrict name is unique inside the stated province
  point      no usable names, but the row carries a published source point: the production subdistrict
             polygon that contains the point (full-resolution production geometry), and only when it lies in
             the stated province (and stated district, if any)
  district   district matched, subdistrict not (old or misspelt name) → counted in the district only
  province   province only
  none       no province (row kept, outside every area count)

Personal and contact data are not copied: no phone numbers, no street addresses, no raw source records.
Licence numbers are public register identifiers and are kept as evidence.
"""
import argparse, collections, datetime, hashlib, json, math, os, re, sys, unicodedata
import openpyxl
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)

GROUPS = [
    # id, Thai label, English label, segments of 01_BRANDS / 02_STORES
    ('chain', 'เครือร้านยา', 'Pharmacy chain', ['chain', 'franchise_banner']),
    ('health_beauty', 'ร้านสุขภาพและความงาม', 'Health & beauty drugstore', ['health_beauty_drugstore']),
    ('regional', 'เครือภูมิภาค/ท้องถิ่น', 'Regional or local chain', ['regional_chain', 'local_chain', 'local_retailer', 'retail_wholesale_operator']),
    ('public', 'ร้านยาของรัฐและสถาบัน', 'Public or institutional pharmacy', ['public_pharmacy', 'institutional_pharmacy', 'university_pharmacy']),
    ('independent', 'ร้านยาท้องถิ่น/ยังไม่ยืนยันเครือ', 'Local or unresolved', ['local_or_chain_unresolved']),
]
SEGMENT_GROUP = {seg: i for i, g in enumerate(GROUPS) for seg in g[3]}
EVIDENCE = ['licensed', 'directory', 'chain_source']
STATUS = ['not_field_verified', 'source_temporary_closed', 'source_future_opening_review']
ADMIN = ['names', 'unique', 'point', 'district', 'province', 'none']
POINT_ROLES = ['source_published_pharmacy_location_point_unvalidated', 'official_outlet_point', 'retailer_api_store_point', 'retailer_locator_store_marker']
BRAND_STATUS = ['official_source_banner', 'distinctive_banner_in_source_name', 'banner_identity_review', 'local_or_chain_unresolved']
SOURCE_TYPES = ['fda_license_register', 'pharmacy_council_directory', 'official_brand_locator', 'official_supplier_stockist', 'official_brand_social_profile', 'employer_profile']
PUBLIC_BLOCK = re.compile(r'(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|googleusercontent\.com)$')
API_LIKE = re.compile(r'admin-ajax\.php|/api/|\.csv(\?|$)', re.I)
FDA_DATASET_PAGE = 'https://catalog.fda.moph.go.th/dataset/036fc96e-d1be-4ec6-bf79-bfe685e32f51'
PREFIX = re.compile(r'^(?:กิ่งอำเภอ|อำเภอ|ตำบล|แขวง|เขต|จังหวัด|อ\.|ต\.|จ\.)\s*')
PROV_ALIAS = {'กรุงเทพฯ': 'กรุงเทพมหานคร', 'กทม': 'กรุงเทพมหานคร', 'กทม.': 'กรุงเทพมหานคร'}


def norm(s):
    s = unicodedata.normalize('NFC', str(s or ''))
    s = s.replace('​', '').replace('\xa0', ' ').replace('ํา', 'ำ').strip()
    s = PREFIX.sub('', s)
    return re.sub(r'\s+', '', s)


def blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


def text(v):
    return '' if blank(v) else str(v).strip()


def public_url(value):
    if not isinstance(value, str) or not value.startswith('https://'):
        return ''
    host = re.sub(r'^https://([^/:?#]+).*$', r'\1', value).lower()
    return '' if PUBLIC_BLOCK.search(host) else value


def iso(v):
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    s = text(v)
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', s)
    if m:
        return m.group(1)
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        d, mo, y = map(int, m.groups())
        return f'{y:04d}-{mo:02d}-{d:02d}'
    return s


def read_tab(wb, name):
    ws = wb[name]
    it = ws.iter_rows(values_only=True)
    header = [str(h) if h is not None else '' for h in next(it)]
    out = []
    for r in it:
        if r is None or all(v is None for v in r):
            continue
        out.append(dict(zip(header, r)))
    return header, out


def value(doc):
    v = doc.get('value', doc)
    return json.loads(v) if isinstance(v, str) else v


def load_production(api):
    lv0 = value(json.load(open(os.path.join(api, 'base-lv0.json'), encoding='utf-8')))
    provinces, districts, subs = {}, {}, {}
    for p in lv0['provinceInfos']:
        provinces[p['code']] = p
        base = value(json.load(open(os.path.join(api, f"base-{p['id']}.json"), encoding='utf-8')))
        for d in base['districtInfos']:
            districts[d['code']] = {**d, 'province': p['code']}
        for s in base['subdistrictInfos']:
            subs[s['code']] = {**s, 'province': p['code']}
    return provinces, districts, subs


class Locator:
    """Point → production subdistrict code (full-resolution production polygons, ray casting)."""

    def __init__(self, geom_dir, subs):
        self.items = []
        for code, s in subs.items():
            path = os.path.join(geom_dir, f"SUBDISTRICT-{s['id']}.json")
            raw = open(path, 'rb').read()
            meta = json.load(open(path[:-5] + '.meta.json'))
            if meta.get('status') != 200 or meta.get('sha256') != hashlib.sha256(raw).hexdigest():
                sys.exit(f'unverified geometry receipt: {path}')
            g = value(json.loads(raw))
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
            xs = [x for poly in polys for x, _ in poly[0]]
            ys = [y for poly in polys for _, y in poly[0]]
            self.items.append((code, polys, min(xs), min(ys), max(xs), max(ys)))

    @staticmethod
    def _in_ring(x, y, ring):
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]; xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside

    def locate(self, lon, lat):
        for code, polys, w, s, e, n in self.items:
            if lon < w or lon > e or lat < s or lat > n:
                continue
            for poly in polys:
                if self._in_ring(lon, lat, poly[0]) and not any(self._in_ring(lon, lat, h) for h in poly[1:]):
                    return code
        return ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', required=True)
    ap.add_argument('--api', required=True)
    ap.add_argument('--geom', required=True)
    ap.add_argument('--index', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    sheet_bytes = open(a.sheet, 'rb').read()
    wb = openpyxl.load_workbook(a.sheet, read_only=True, data_only=True)
    _, readme = read_tab(wb, '00_README')
    _, brands_tab = read_tab(wb, '01_BRANDS')
    store_header, stores = read_tab(wb, '02_STORES')
    _, sources_tab = read_tab(wb, '04_SOURCES')
    _, review = read_tab(wb, '05_REVIEW_QUEUE')
    _, coverage_tab = read_tab(wb, '07_PROVINCE_COVERAGE')

    P, D, S = load_production(a.api)
    index = json.load(open(a.index, encoding='utf-8'))
    index_areas = set(index['areas']['id'])
    index_districts = set(index['districts']['id'])
    abbr = {p['code']: p['abbrEn'] for p in P.values()}

    prov_by_name = {norm(p['nameTh']): c for c, p in P.items()}
    dist_by_name = collections.defaultdict(dict)
    sub_by_name = collections.defaultdict(dict)
    sub_by_prov = collections.defaultdict(lambda: collections.defaultdict(list))
    for c, d in D.items():
        dist_by_name[d['province']][norm(d['nameTh'])] = c
    for c, s in S.items():
        sub_by_name[c[:4]][norm(s['nameTh'])] = c
        sub_by_prov[s['province']][norm(s['nameTh'])].append(c)
    locator = None

    def point_of(r):
        lat, lon = r.get('latitude'), r.get('longitude')
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            return None
        if not (5 <= lat <= 21 and 97 <= lon <= 106):
            return None
        return lat, lon

    def match(r, pt):
        nonlocal locator
        pn = norm(PROV_ALIAS.get(text(r.get('province')), r.get('province')))
        pc = prov_by_name.get(pn)
        dn, sn = norm(r.get('district')), norm(r.get('subdistrict'))
        dc = sc = None
        if pc and dn:
            dc = dist_by_name[pc].get(dn)
            if not dc and not dn.startswith('เมือง'):
                dc = dist_by_name[pc].get('เมือง' + dn)
            if not dc and dn == 'เมือง':
                dc = dist_by_name[pc].get('เมือง' + norm(P[pc]['nameTh']))
        if dc and sn:
            sc = sub_by_name[dc].get(sn)
            if sc:
                return pc, dc, sc, 'names'
        if pc and not dc and sn:
            cands = sub_by_prov[pc].get(sn, [])
            if len(cands) == 1:
                return pc, cands[0][:4], cands[0], 'unique'
        if pt:
            if locator is None:
                locator = Locator(a.geom, S)
            hit = locator.locate(pt[1], pt[0])
            if hit and (not pc or S[hit]['province'] == pc) and (not dc or hit[:4] == dc):
                return S[hit]['province'], hit[:4], hit, 'point'
        if dc:
            return pc, dc, None, 'district'
        if pc:
            return pc, None, None, 'province'
        return None, None, None, 'none'

    # ---- brands (01_BRANDS: approved names) ----
    brands, brand_index = [], {}
    for b in brands_tab:
        bid = text(b.get('brand_id'))
        if not bid:
            continue
        seg = text(b.get('segment'))
        if seg not in SEGMENT_GROUP:
            sys.exit(f'unknown brand segment {seg!r} for {bid}')
        brand_index[bid] = len(brands)
        brands.append({'id': bid, 'name': text(b.get('brand_name')), 'nameTh': text(b.get('name_th')), 'segment': seg,
                       'group': GROUPS[SEGMENT_GROUP[seg]][0], 'sourcePage': public_url(text(b.get('source_url'))),
                       'scope': text(b.get('scope_status')), 'coverage': text(b.get('branch_coverage')),
                       'checkedOn': iso(b.get('checked_on')), 'logo': 'not_collected' if 'ยังไม่ได้รวบรวม' in text(b.get('logo_status')) or not text(b.get('logo_sha256')) else 'listed'})
    brand_by_name = {b['name']: i for i, b in enumerate(brands)}

    # ---- sources ----
    src_rows = {text(s.get('source_id')): s for s in sources_tab}
    fda = src_rows.get('FDA_KHY1', {})
    sources = [
        {'id': 'FDA_KHY1', 'th': 'ทะเบียนผู้รับอนุญาตขายยาแผนปัจจุบัน (ขย1) สำนักงานคณะกรรมการอาหารและยา', 'short': 'ทะเบียน ขย1 อย.',
         'url': FDA_DATASET_PAGE, 'asOf': iso(fda.get('source_as_of')) or '2026-05-28', 'resourceModifiedOn': '2026-08-04',
         'retrievedOn': iso(fda.get('retrieved_on')) or '2026-10-22', 'rawRows': int(fda.get('raw_rows') or 0) or None},
        {'id': 'ACC_PHARM_DRUGSTORE', 'th': 'รายชื่อร้านยาในระบบรับรองคุณภาพ สภาเภสัชกรรม', 'short': 'รายชื่อร้านยา สภาเภสัชกรรม',
         'url': 'https://www.acc-pharm.com/DrugStore', 'asOf': None, 'retrievedOn': iso(src_rows.get('ACC_PHARM_DRUGSTORE', {}).get('retrieved_on')) or '2026-10-22',
         'rawRows': int(src_rows.get('ACC_PHARM_DRUGSTORE', {}).get('raw_rows') or 0) or None},
        {'id': 'ACC_PHARM_QUALITY', 'th': 'รายชื่อร้านยาคุณภาพ สภาเภสัชกรรม', 'short': 'ร้านยาคุณภาพ สภาเภสัชกรรม',
         'url': 'https://www.acc-pharm.com/Pharmacy', 'asOf': None, 'retrievedOn': iso(src_rows.get('ACC_PHARM_QUALITY', {}).get('retrieved_on')) or '2026-10-22',
         'rawRows': int(src_rows.get('ACC_PHARM_QUALITY', {}).get('raw_rows') or 0) or None},
        {'id': 'CHAIN_SOURCES', 'th': 'หน้าค้นหาสาขาและหน้าทางการของเครือร้าน', 'short': 'แหล่งของเครือร้าน',
         'url': None, 'asOf': None, 'retrievedOn': '2026-10-22', 'rawRows': None},
    ]

    # ---- rows ----
    urls, url_index = [], {}

    def url_id(u):
        if not u:
            return -1
        if u not in url_index:
            url_index[u] = len(urls); urls.append(u)
        return url_index[u]

    cols = {k: [] for k in ('key', 'name', 'brand', 'candidate', 'group', 'evidence', 'quality', 'province', 'district', 'area', 'admin',
                            'licence', 'source', 'url', 'sources', 'status', 'brandStatus')}
    points = []
    stats = collections.Counter()
    seen = set()
    for i, r in enumerate(stores):
        key = text(r.get('outlet_id'))
        if not key or key in seen:
            sys.exit(f'row {i + 2}: missing or duplicate outlet_id {key!r}')
        seen.add(key)
        seg = text(r.get('segment'))
        if seg not in SEGMENT_GROUP:
            sys.exit(f'row {i + 2}: unknown segment {seg!r}')
        bid = text(r.get('brand_id'))
        if bid and bid not in brand_index:
            sys.exit(f'row {i + 2}: brand_id {bid} not in 01_BRANDS')
        licence = text(r.get('license_number'))
        st = text(r.get('source_type'))
        if st not in SOURCE_TYPES:
            sys.exit(f'row {i + 2}: unknown source_type {st!r}')
        evidence = 0 if licence else (1 if st == 'pharmacy_council_directory' else 2)
        quality = 1 if text(r.get('quality_accreditation_status')) == 'listed_validity_dates_unknown' else 0
        pt = point_of(r)
        pc, dc, sc, method = match(r, pt)
        if sc and sc not in index_areas:
            sys.exit(f'row {i + 2}: subdistrict {sc} not in area index')
        if dc and dc not in index_districts:
            sys.exit(f'row {i + 2}: district {dc} not in area index')
        stats[f'admin.{method}'] += 1
        status = text(r.get('operating_status')) or 'not_field_verified'
        if status not in STATUS:
            sys.exit(f'row {i + 2}: unknown operating_status {status!r}')
        bstatus = text(r.get('brand_assignment_status'))
        if bstatus not in BRAND_STATUS:
            sys.exit(f'row {i + 2}: unknown brand_assignment_status {bstatus!r}')
        cand = text(r.get('candidate_brand_name'))
        # Source page for chain-source rows: the row's own public page; an API endpoint or file falls back to the brand's reference page.
        page = ''
        if evidence == 2:
            u = public_url(text(r.get('source_url')))
            page = u if u and not API_LIKE.search(u) else (brands[brand_index[bid]]['sourcePage'] if bid else '')
        cols['key'].append(key)
        cols['name'].append(text(r.get('store_name')))
        cols['brand'].append(brand_index[bid] if bid else -1)
        cols['candidate'].append(brand_by_name.get(cand, -1) if cand else -1)
        cols['group'].append(SEGMENT_GROUP[seg])
        cols['evidence'].append(evidence)
        cols['quality'].append(quality)
        cols['province'].append(abbr[pc] if pc else '')
        cols['district'].append(dc or '')
        cols['area'].append(sc or '')
        cols['admin'].append(ADMIN.index(method))
        cols['licence'].append(licence or None)
        cols['source'].append(SOURCE_TYPES.index(st))
        cols['url'].append(url_id(page))
        cols['sources'].append(int(float(r.get('source_count') or 1)))
        cols['status'].append(STATUS.index(status))
        cols['brandStatus'].append(BRAND_STATUS.index(bstatus))
        if pt:
            role = text(r.get('geometry_role'))
            if role not in POINT_ROLES:
                sys.exit(f'row {i + 2}: unknown geometry_role {role!r}')
            points.append([i, round(pt[0], 6), round(pt[1], 6), POINT_ROLES.index(role)])
        stats[f'evidence.{EVIDENCE[evidence]}'] += 1
        stats['quality'] += quality
        stats['points'] += 1 if pt else 0

    # Dictionary-encode the code columns (smaller file, same values).
    def encode(name):
        values = sorted(set(v for v in cols[name] if v))
        pos = {v: j for j, v in enumerate(values)}
        cols[name] = [pos[v] if v else -1 for v in cols[name]]
        return values
    province_codes, district_codes, area_codes = encode('province'), encode('district'), encode('area')

    n = len(cols['key'])
    licensed_by_province, all_by_province, stated_by_province = collections.Counter(), collections.Counter(), collections.Counter()
    for r in stores:
        pc = prov_by_name.get(norm(PROV_ALIAS.get(text(r.get('province')), r.get('province'))))
        stated_by_province[abbr[pc] if pc else ''] += 1
    for j in range(n):
        p = province_codes[cols['province'][j]] if cols['province'][j] >= 0 else ''
        all_by_province[p] += 1
        if cols['evidence'][j] == 0:
            licensed_by_province[p] += 1
    brand_rows = collections.Counter((cols['brand'][j], cols['evidence'][j] == 0) for j in range(n) if cols['brand'][j] >= 0)
    for bi, b in enumerate(brands):
        b['rowsLicensed'] = brand_rows[(bi, True)]
        b['rows'] = brand_rows[(bi, True)] + brand_rows[(bi, False)]

    # Cross-check against the sheet's own province coverage tab (candidate_outlet_records per province).
    coverage_check = []
    th_to_abbr = {p['nameTh']: p['abbrEn'] for p in P.values()}
    for c in coverage_tab:
        name = text(c.get('province'))
        expected = int(float(c.get('candidate_outlet_records') or 0))
        code = th_to_abbr.get(name)
        if code:
            coverage_check.append({'province': code, 'expected': expected, 'stated': stated_by_province.get(code, 0), 'placed': all_by_province.get(code, 0)})

    readme_map = {text(x.get('หัวข้อ')): text(x.get('รายละเอียด')) for x in readme}
    meta = {
        'dataset': 'CityMETER Pharmacy',
        'datasetTh': 'ร้านยาในประเทศไทย',
        'sheetTitle': 'CityMETER Pharmacy Thailand — Research Master 2026-10-22',
        'sheetSha256': hashlib.sha256(sheet_bytes).hexdigest(),
        'sheetStatus': 'research_only',
        'asOf': '2026-10-22',
        'checkedOn': iso(readme_map.get('วันที่ตรวจแหล่ง')) or '2026-10-22',
        'builtOn': datetime.date.today().isoformat(),
        'rows': n,
        'counts': dict(sorted(stats.items())),
        'unit': {
            'row': 'one row of 02_STORES — a source-qualified outlet candidate after the sheet’s documented merge rules; the same storefront can still appear in more than one row when identity evidence is insufficient',
            'licensed': 'rows that carry a ขย1 licence number of the FDA snapshot: one licence = one premises, so these rows are counted without cross-source duplicates',
            'default': 'licensed',
        },
        'readme': {k: readme_map.get(k, '') for k in ('หน่วยข้อมูล', 'ทะเบียน อย.', 'แก้ข้อจำกัดขอบเขตจากรอบเสนอ', 'วันหมดอายุใบอนุญาต', 'Acc-Pharm', 'พิกัด', 'Drugstore', 'สถานะการเปิด', 'การรวมหลักฐาน', 'ความครบถ้วน', 'การเผยแพร่')},
        'licence': {'type': 'ขย1', 'statusAsPublished': 'คงอยู่', 'expiryYearBE': 2569, 'sourceAsOf': sources[0]['asOf'], 'resourceModifiedOn': '2026-08-04'},
        'reviewQueue': dict(collections.Counter(text(x.get('status')) for x in review)),
        'rowsByProvince': {'licensed': dict(sorted(licensed_by_province.items())), 'all': dict(sorted(all_by_province.items()))},
        'coverageCheck': coverage_check,
        # Rows without a stated province that a published point placed in one (they explain placed − stated above).
        'provinceFromPoint': stated_by_province.get('', 0) - all_by_province.get('', 0),
        'adminMethods': {
            'names': 'province + district + subdistrict names of the row matched to production codes (normalised exact match)',
            'unique': 'subdistrict name unique inside the stated province (district name not found)',
            'point': 'published source point inside the production subdistrict polygon (no usable names); province/district agree with the row',
            'district': 'district only (subdistrict name not found in that district, e.g. a pre-split name)',
            'province': 'province only', 'none': 'no province in the source row',
        },
        'logos': 'not collected in this research round (01_BRANDS logo_status)',
        'venues': 'not collected in this research round (02_STORES venue/host columns empty)',
        'excludedFields': ['public_business_phone', 'address', 'map_url', 'notes', 'source_observation_ids', 'raw source records (08_SOURCE_RECORDS)'],
    }
    out = {
        'meta': meta,
        'groups': [{'id': g[0], 'th': g[1], 'en': g[2], 'segments': g[3]} for g in GROUPS],
        'brands': brands,
        'sources': sources,
        'urls': urls,
        'vocab': {'evidence': EVIDENCE, 'status': STATUS, 'admin': ADMIN, 'pointRoles': POINT_ROLES, 'brandStatus': BRAND_STATUS, 'sourceTypes': SOURCE_TYPES},
        'provinces': province_codes, 'districts': district_codes, 'areas': area_codes,
        'cols': cols,
        'points': points,
    }
    os.makedirs(os.path.join(a.out, 'data'), exist_ok=True)
    path = os.path.join(a.out, 'data', 'pharmacies.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print('data/pharmacies.json', n, 'rows', os.path.getsize(path), 'bytes')
    print(json.dumps(meta['counts'], ensure_ascii=False))
    bad = [c for c in coverage_check if c['expected'] != c['stated']]
    print('coverage check', len(coverage_check), 'provinces,', len(bad), 'differ', bad[:5])


if __name__ == '__main__':
    main()
