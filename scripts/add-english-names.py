#!/usr/bin/env python3
"""Add the English names production does not give to data/area-index.json (run after scripts/build-boundaries.py).

CityMETER production base info names provinces in English and most subdistricts, but no district (all 928 empty) and
290 of 7,436 subdistricts (163 of Bangkok's 180). The English page reads places by name, so this step fills the gaps
from OpenGISData-Thailand at commit fafcea1 (CC BY 4.0, DOPA-credited), the same files, commit and joins the other
CityMETER demos use (area-index.json → metadata.englishNames):
  districts     districts.geojson amp_code → amp_en, joined by production code (as Hotel, Office, Hospital, School,
                Government Office and Factory)
  subdistricts  subdistricts.geojson tam_code → tam_en, only where production gives no English and the code and the
                Thai name both match (as Fitness, scripts/admin_text.py#Gazetteer); production's English always stays
Names only: codes, Thai names, areaSqm and every outline stay production's. A place no file names keeps an empty
nameEn (the page then keeps the Thai name). data/frames/*.json are not rewritten: the app reads names from the index.

Usage: python3 scripts/add-english-names.py --ogd <directory with districts.geojson and subdistricts.geojson at fafcea1>
Idempotent: a second run changes nothing.
"""
import argparse, hashlib, json, os, re, sys, unicodedata

OGD_COMMIT = 'fafcea179cda88b689f5697c3866a449e79cd298'
OGD_SHA256 = {
    'districts.geojson': '329315c2d1ee067b42abc2fe2ac24e825fac4cdb02257a530afb62c6903de995',
    'subdistricts.geojson': '34ee32a6b6dde019e4fef8706f186206ddb7959ff869e6712b355ba83433c326',
}
INDEX = 'data/area-index.json'
PREFIX_TH = re.compile(r'^(?:กิ่งอำเภอ|อำเภอ|ตำบล|แขวง|เขต|จังหวัด|อ\.|ต\.|จ\.)\s*')


def th_norm(s):
    """The Thai-name comparison of Fitness (scripts/admin_text.py#th_norm): NFC, no prefix, no spaces."""
    s = unicodedata.normalize('NFC', str(s or ''))
    s = s.replace('​', '').replace('\xa0', ' ').replace('ํา', 'ำ').strip()
    return re.sub(r'\s+', '', PREFIX_TH.sub('', s))


def features(directory, name):
    path = os.path.join(directory, name)
    raw = open(path, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != OGD_SHA256[name]:
        sys.exit(f'{path} is not OpenGISData-Thailand {name} @ {OGD_COMMIT[:7]} (sha256 differs)')
    return [f['properties'] for f in json.loads(raw)['features']]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ogd', required=True)
    a = ap.parse_args()
    amp = {p['amp_code']: (p.get('amp_en') or '').strip() for p in features(a.ogd, 'districts.geojson')}
    tam = {p['tam_code']: p for p in features(a.ogd, 'subdistricts.geojson')}

    index = json.load(open(INDEX, encoding='utf-8'))
    meta = index['metadata']
    districts, areas = index['districts'], index['areas']
    # The subdistricts this step named before (a second run recomputes them; production's own English always stays).
    before = set(meta.get('subdistrictEnglishFromOgd') or [])
    districts['nameEn'] = [amp.get(code, '') for code in districts['id']]
    from_ogd, mismatch, names = [], 0, []
    for code, th, en in zip(areas['id'], areas['name'], areas['nameEn']):
        if en and code not in before:
            names.append(en)
            continue
        o = tam.get(code)
        if o and o.get('tam_en') and th_norm(o.get('tam_th')) == th_norm(th):
            names.append(o['tam_en'].strip()); from_ogd.append(code)
        else:
            names.append('')
            if o and th_norm(o.get('tam_th')) != th_norm(th):
                mismatch += 1
    areas['nameEn'] = names
    meta['englishNames'] = (f'OpenGISData-Thailand @ {OGD_COMMIT[:7]} (CC BY 4.0, DOPA-credited), scripts/add-english-names.py: '
                            f'districts.geojson sha256 {OGD_SHA256["districts.geojson"]} for every district, joined by production code; '
                            f'subdistricts.geojson sha256 {OGD_SHA256["subdistricts.geojson"]} only where production gives no English and '
                            'the code and the Thai name match (metadata.subdistrictEnglishFromOgd); provinces and the other subdistricts: '
                            'production base info')
    meta['subdistrictEnglishFromOgd'] = sorted(from_ogd)
    with open(INDEX, 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))
    without_d = [f'{c} {n}' for c, n, e in zip(districts['id'], districts['name'], districts['nameEn']) if not e]
    without_s = sum(1 for e in names if not e)
    print(f'{INDEX}: districts {len(districts["id"]) - len(without_d)}/{len(districts["id"])} with English (without: {", ".join(without_d) or "none"}); '
          f'subdistricts {len(names) - without_s}/{len(names)} ({len(names) - without_s - len(from_ogd)} from production, '
          f'{len(from_ogd)} from OpenGISData, {mismatch} where the Thai name differs, {without_s} without)')

if __name__ == '__main__':
    main()
