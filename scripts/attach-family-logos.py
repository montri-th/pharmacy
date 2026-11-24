#!/usr/bin/env python3
"""Chain logos the CityMETER demo family already verified (owner 2026-11-24, D64 of CityMETER · Shopping Center).

  python3 -I scripts/attach-family-logos.py --family <dir holding the demo checkouts> --checked-on YYYY-MM-DD

Owner 2026-11-24 07:53, VERBATIM: “ทำไมหลายร้านในศูนย์การค้าเราควรจะมี logo แล้ว แต่เวบเดโมไม่แสดงโลโก้ แก้ให้ครบทุก venue
และตรวจใน dataset อื่นๆด้วยในเคสนี้หาวิธีแก้ที่แก้ได้ทุกที่เหมือนกัน”. This demo collected no chain logos (research round of
22 Oct 2026, meta.logos), yet the Beauty research master registered Watsons, Boots, matsukiyo and LAB Pharmacy under the
same brand ids (PHB-…) with verified files that CityMETER · Shopping Center ships. The shared kit
(scripts/logo-kit/citymeter_logos.py, citymeter-logos) finds them the same way in every demo: own id → the same id in another
dataset → a name a research sheet confirmed → one fixed rewrite; two different files give none.

Writes data/brand-logos.json (one record per chain that has a file, with the basis it was found by, the pool's demos and
commits, the chains still without a file) and copies the files to assets/brand-logos/<sha20>.<ext>, bytes as the source demo
shipped them. data/pharmacies.json is not changed; the page reads the logos as an optional file.
"""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts' / 'logo-kit'))
import citymeter_logos as kit  # noqa: E402

DATASET = 'research.TH.pharmacy'
EXT = {'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--family', required=True)
    ap.add_argument('--checked-on', required=True)
    a = ap.parse_args()
    family = os.path.abspath(a.family)
    if Path(family, 'pharmacy').resolve() != ROOT:
        sys.exit(f'--family must hold this checkout as pharmacy/ ({ROOT})')
    pool = kit.build_pool(family)
    if pool.issues:
        sys.exit(f'pool issues: {pool.issues[:5]}')
    data = json.loads((ROOT / 'data' / 'pharmacies.json').read_text(encoding='utf-8'))
    logos, without = {}, []
    out = ROOT / 'assets' / 'brand-logos'
    out.mkdir(parents=True, exist_ok=True)
    keep = set()
    for brand in data['brands']:
        digest, basis = pool.resolve(DATASET, brand['id'], [brand.get('name'), brand.get('nameTh')])
        if not digest:
            without.append({'id': brand['id'], 'name': brand.get('name'), 'reason': basis})
            continue
        rec = pool.files[digest]
        file = f'assets/brand-logos/{digest[:20]}.{EXT[rec["mime"]]}'
        target = ROOT / file
        if target.exists():
            if kit.sha256_file(target) != digest:
                sys.exit(f'{file} exists with other bytes')
        else:
            target.write_bytes(pool.read(digest))
        keep.add(target.name)
        logos[brand['id']] = {'name': brand.get('name'), 'file': file, 'sha256': digest, 'mime': rec['mime'],
                              'width': rec['width'], 'height': rec['height'], 'background': rec['background'],
                              'basis': basis, 'source': rec['source']}
    for stale in out.iterdir():
        if stale.name not in keep:
            sys.exit(f'{stale} is not used by any chain: remove it by hand after checking')
    body = {
        'meta': {
            'schemaVersion': '1', 'kit': f'{kit.KIT} {kit.VERSION}', 'checkedOn': a.checked_on, 'dataset': DATASET,
            'brands': len(data['brands']), 'withLogo': len(logos),
            'rule': 'D64 of CityMETER · Shopping Center (owner 2026-11-24): own id → the same id in another dataset → a name a '
                    'research sheet confirmed → one fixed rewrite; two different files give none',
            'rights': 'เครื่องหมายเป็นของเจ้าของแต่ละราย การแสดงเพื่อระบุเครือร้านไม่ใช่ใบอนุญาตเครื่องหมายการค้า',
            'pool': {repo: {'commit': s['commit'], 'files': s['files']} for repo, s in pool.sources.items()},
            'without': without,
        },
        'logos': dict(sorted(logos.items())),
    }
    (ROOT / 'data' / 'brand-logos.json').write_text(json.dumps(body, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'brands': len(data['brands']), 'withLogo': len(logos), 'by': {k: v['basis'] for k, v in logos.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
