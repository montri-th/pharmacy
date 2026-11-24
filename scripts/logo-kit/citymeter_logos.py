#!/usr/bin/env python3
"""citymeter-logos — one logo pool and one resolver for every CityMETER demo.

Why (owner 2026-11-24, VERBATIM: “ทำไมหลายร้านในศูนย์การค้าเราควรจะมี logo แล้ว แต่เวบเดโมไม่แสดงโลโก้ แก้ให้ครบทุก venue
และตรวจใน dataset อื่นๆด้วยในเคสนี้หาวิธีแก้ที่แก้ได้ทุกที่เหมือนกัน”): every demo kept its own logo folder and looked a
logo up only by its own dataset id. A brand checked in one demo (Starbucks, After You, Mister Donut in Restaurants;
Watsons and Boots in Beauty) stayed invisible to the others, and a shop the centre's directory lists by name never got the
logo of its brand. This kit is the one place that answers “which verified file is this brand's logo”, the same way in
every demo.

Pool — every logo file already shipped by a demo of the family, read from the demos' own checkouts, each file's SHA-256
checked against the record that shipped it (a file that does not match is left out and reported). Sprite symbols of Luxury
Brands and Grocery carry the original artwork as a data URI; it is used only when its SHA-256 equals the brand record's
`sourceSHA256`. Nothing is downloaded, redrawn, recoloured or cropped: bytes stay as the source demo shipped them.

Resolver — first hit wins; a step that finds two different files gives no logo (reported as ambiguous):
  1. own        the record's registry key (dataset|id) has a file
  2. same-id    the same entity id has a file under another dataset (the research masters reuse ids across datasets:
                PHB-… in Beauty and Pharmacy, BR-… in Luxury and Apparel); several files of one id → the first source
                in POOL_ORDER
  3. label      the record's name equals, after norm(), a name a research sheet confirmed for an entity with a file — the
                registry name of a dataset record, or a centre-directory label the sheet linked to that brand id
  4. variant    one fixed rewrite of the name, then step 3:
                  bilingual   “A / B”, “A (B)”: one side Latin, the other Thai; one side matches, the other matches no
                              other file
                  legal       a legal suffix dropped (จำกัด (มหาชน) · (มหาชน) · จำกัด · Public Company Limited · Company
                              Limited · Co., Ltd. · PCL · PLC)
                  descriptor  one trailing word dropped: shop · store · express · kiosk · thailand for any brand; coffee ·
                              cafe · tea · bakery · restaurant(s) only for a food-and-drink brand (a Restaurants-dataset key)
                  bank        “ธนาคาร” in front or “bank” at the end dropped — only for a bank (a Bank-dataset key)
Never: fuzzy or partial matching, a name to a file that another entity of the same name also claims, a record marked
`suppressManufacturerLogo` (a retailer that sells a brand is not the brand), or a logo that changes a name, a count or an
identity. A logo identifies a name on screen; collecting a file is not a trademark licence.

Venue (mall) logos — since 1.1.0. The same fragmentation hid mall logos: Camera Shops shipped the logos of Seacon Square,
Future Park and some 30 Robinson Lifestyle and Lotus's branches, which Shopping Center itself did not show, and Luxury Brands
left 17 files “pending transfer” whose exact bytes other demos already shipped. VenuePool reads every venue-logo registry of
the family (each file checked against its record) and links a logo to a venue only by the venue id CityMETER · Shopping
Center gives it (SC-…, VN-…): Shopping Center's own registry, a Camera or Luxury Brands centre's externalId, a Fitness
venue's scId. resolve(id): the files of that id from the other demos must be one artwork (Fitness ships uniform downscales
and keeps the original's SHA-256, which counts as the same artwork) with one role (venue_specific · parent_complex ·
shared_department_store_banner · shared_chain_banner), else none; the original bytes win over a downscale. by_sha(digest):
the family's copy of a file a registry already names by its SHA-256. Never by name or distance.

    python3 -I scripts/logo-kit/citymeter_logos.py pool --family <dir holding the demo checkouts> --out <pool.json>
"""
import argparse
import base64
import collections
import hashlib
import json
import os
import re
import subprocess
import unicodedata

KIT = 'citymeter-logos'
VERSION = '1.1.0'

# Source order when one entity id has several files (step 2) — the demo whose research master owns the brand first.
POOL_ORDER = ('restaurant', 'fitness', 'hotel', 'camera', 'luxurybrands', 'grocery', 'university', 'shoppingcenter')
LDS_PLATES = {'#E5E9E6', '#182327', '#FFFFFF'}
FNB_DATASETS = {'research.TH.restaurants'}
BANK_DATASETS = {'research.TH.bank'}
QUOTES = str.maketrans({'’': "'", '‘': "'", '`': "'", '´': "'", 'ʼ': "'"})
THAI = re.compile(r'[฀-๿]')
LATIN = re.compile(r'[A-Za-z]')
LEGAL_SUFFIXES = ('จำกัด (มหาชน)', 'จำกัด(มหาชน)', '(มหาชน)', 'จำกัด', 'public company limited', 'company limited',
                  'co., ltd.', 'co.,ltd.', 'co., ltd', 'co.,ltd', 'co. ltd.', 'co ltd', 'pcl.', 'pcl', 'plc.', 'plc')
STORE_WORDS = ('shop', 'store', 'express', 'kiosk', 'thailand')
FNB_WORDS = ('coffee', 'cafe', 'tea', 'bakery', 'restaurant', 'restaurants')
MIME_EXT = {'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}


def norm(name):
    """The one name key: NFKC, one apostrophe, Latin accents folded (U+0300–U+036F only, so Thai marks stay), one space,
    case folded. “Café Amazon” and “Cafe Amazon” meet; “ธนาคารกรุงไทย” keeps every Thai mark. NFKC writes SARA AM
    (U+0E33) as NIKHAHIT + SARA AA, so every fixed word is compared through norm() too."""
    s = unicodedata.normalize('NFKC', str(name or '')).translate(QUOTES).strip()
    s = unicodedata.normalize('NFKC', ''.join(c for c in unicodedata.normalize('NFKD', s) if not 0x300 <= ord(c) <= 0x36F))
    return re.sub(r'\s+', ' ', s).casefold()


def variants(name):
    """The fixed rewrites of step 4: (kind, [names]) — a bilingual pair gives both sides."""
    n = norm(name)
    out = []
    for sep in (' / ', '/', ' | '):
        if sep in n:
            parts = [p.strip() for p in n.split(sep)]
            if len(parts) == 2 and all(parts) and bool(THAI.search(parts[0])) != bool(THAI.search(parts[1])):
                out.append(('bilingual', parts))
            break
    m = re.match(r'^(.+?)\s*\((.+)\)$', n)
    if m and bool(THAI.search(m.group(1))) != bool(THAI.search(m.group(2))) and LATIN.search(m.group(1) + m.group(2)):
        out.append(('bilingual', [m.group(1).strip(), m.group(2).strip()]))
    for suffix in sorted({norm(x) for x in LEGAL_SUFFIXES}, key=len, reverse=True):
        if n.endswith(' ' + suffix) or (suffix.startswith('(') and n.endswith(suffix) and len(n) > len(suffix)):
            out.append(('legal', [n[:-len(suffix)].strip()]))
            break
    words = n.rsplit(' ', 1)
    if len(words) == 2 and len(words[0]) >= 2:
        if words[1] in STORE_WORDS:
            out.append(('descriptor', [words[0]]))
        elif words[1] in FNB_WORDS:
            out.append(('descriptor-fnb', [words[0]]))
    bank = norm('ธนาคาร')
    if n.startswith(bank) and len(n) > len(bank) + 1:
        out.append(('bank', [n[len(bank):].strip()]))
    if n.endswith(' bank') and len(n) > 6:
        out.append(('bank', [n[:-5].strip()]))
    return out


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def git_head(repo_dir):
    try:
        return subprocess.run(['git', '-C', repo_dir, 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ''


def dimensions(data, mime):
    """Width and height from the file itself when the source record has none (SVG: viewBox, else width/height)."""
    if mime == 'image/svg+xml':
        text = data[:4096].decode('utf-8', 'replace')
        m = re.search(r'viewBox\s*=\s*["\']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)', text)
        if m:
            return float(m.group(1)), float(m.group(2))
        w, h = re.search(r'\swidth\s*=\s*["\']([\d.]+)', text), re.search(r'\sheight\s*=\s*["\']([\d.]+)', text)
        return (float(w.group(1)), float(h.group(1))) if w and h else (None, None)
    try:
        from io import BytesIO
        from PIL import Image
        with Image.open(BytesIO(data)) as im:
            return im.size
    except Exception:  # noqa: BLE001 — a file PIL cannot read keeps no size; the page then sizes it by CSS
        return (None, None)


class Pool:
    """Every verified file of the family (by SHA-256), the entities that use it and the names that reach it."""

    def __init__(self):
        self.files = {}                                   # sha256 -> record (no bytes)
        self.blobs = {}                                   # sha256 -> (repo dir, path) or ('data', bytes)
        self.keys = collections.defaultdict(list)         # 'dataset|id' -> [sha256] in POOL_ORDER
        self.ids = collections.defaultdict(list)          # id -> [sha256]
        self.names = collections.defaultdict(set)         # norm(name) -> {sha256}
        self.key_names = collections.defaultdict(set)     # 'dataset|id' -> {names}
        self.fnb = set()
        self.bank = set()
        self.sources = {}                                 # repo -> {commit, files, issues}
        self.issues = []

    # ---- building ----
    def _source(self, repo, root):
        return self.sources.setdefault(repo, {'commit': git_head(os.path.join(root, repo)), 'files': 0, 'entities': 0, 'issues': 0})

    def add(self, repo, root, dataset, entity_id, name, data=None, path=None, expect=None, meta=None, derived=None):
        """One entity's logo. `path` is relative to the repo; `data` is used instead for a sprite's embedded original.
        `expect` is the SHA-256 the shipping record states; a file that does not match it is not used."""
        src = self._source(repo, root)
        meta = meta or {}
        if data is None:
            full = os.path.join(root, repo, path)
            if not os.path.isfile(full):
                self.issues.append({'repo': repo, 'path': path, 'reason': 'file missing'}); src['issues'] += 1
                return None
            digest = sha256_file(full)
        else:
            digest = sha256_bytes(data)
        if expect and digest != expect:
            self.issues.append({'repo': repo, 'path': path or derived, 'reason': 'sha256 differs from the record'}); src['issues'] += 1
            return None
        key = f'{dataset}|{entity_id}'
        if digest not in self.files:
            raw = data if data is not None else open(os.path.join(root, repo, path), 'rb').read()
            mime = meta.get('mime') or guess_mime(path or '', raw)
            width, height = meta.get('width'), meta.get('height')
            if not (isinstance(width, (int, float)) and isinstance(height, (int, float)) and width > 0 and height > 0):
                width, height = dimensions(raw, mime)
            background = meta.get('background') if str(meta.get('background', '')).upper() in LDS_PLATES else plate_for(raw, mime)
            self.files[digest] = {
                'sha256': digest, 'bytes': len(raw), 'mime': mime,
                'width': round(float(width), 2) if width else None, 'height': round(float(height), 2) if height else None,
                'background': background,
                'source': {'repo': f'montri-th/{repo}', 'commit': src['commit'], 'path': path or derived},
            }
            for k in ('sourcePage', 'sourceUrl', 'assetUrl', 'assetURL', 'checkedOn'):
                if meta.get(k):
                    self.files[digest].setdefault('provenance', {})[k.replace('URL', 'Url')] = meta[k]
            self.blobs[digest] = ('data', data) if data is not None else (os.path.join(root, repo), path)
            src['files'] += 1
        if digest not in self.keys[key]:
            self.keys[key].append(digest)
            self.ids[str(entity_id)].append(digest)
            src['entities'] += 1
        if name:
            self.name(key, name, digest)
        if dataset in FNB_DATASETS:
            self.fnb.add(digest)
        if dataset in BANK_DATASETS:
            self.bank.add(digest)
        return digest

    def name(self, key, name, digest=None):
        """A name a registry or a research sheet gives this entity."""
        n = norm(name)
        if not n:
            return
        self.key_names[key].add(name)
        for d in ([digest] if digest else self.keys.get(key, [])):
            self.names[n].add(d)

    def read(self, data):
        """Bytes of a pool file (for copying into a demo)."""
        where = self.blobs[data]
        if where[0] == 'data':
            return where[1]
        return open(os.path.join(where[0], where[1]), 'rb').read()

    # ---- resolving ----
    def resolve(self, dataset=None, entity_id=None, names=(), suppress=False):
        """(sha256 or None, basis). basis: own · same-id · label · bilingual · legal · descriptor · bank;
        when nothing is attached: suppressed · ambiguous · identity-without-file · none."""
        if suppress:
            return None, 'suppressed'
        key = f'{dataset}|{entity_id}' if dataset and entity_id else None
        if key and self.keys.get(key):
            return self.keys[key][0], 'own'
        if entity_id and self.ids.get(str(entity_id)):
            return self.ids[str(entity_id)][0], 'same-id'
        ambiguous = False
        for name in names:
            hit = self.names.get(norm(name), set())
            if len(hit) == 1:
                return next(iter(hit)), 'label'
            ambiguous |= len(hit) > 1
        for name in names:
            for kind, parts in variants(name):
                if kind == 'bilingual':
                    hits = [self.names.get(p, set()) for p in parts]
                    found = set().union(*hits)
                    if len(found) == 1 and all(len(h) <= 1 for h in hits):
                        return next(iter(found)), 'bilingual'
                    ambiguous |= len(found) > 1
                    continue
                hit = self.names.get(parts[0], set())
                if kind == 'descriptor-fnb':
                    hit = hit & self.fnb
                    kind = 'descriptor'
                elif kind == 'bank':
                    hit = hit & self.bank
                if len(hit) == 1:
                    return next(iter(hit)), kind
                ambiguous |= len(hit) > 1
        if ambiguous:
            return None, 'ambiguous'
        return None, 'none'

    def summary(self):
        return {'kit': f'{KIT} {VERSION}', 'files': len(self.files), 'entities': sum(1 for v in self.keys.values() if v),
                'names': len(self.names), 'sources': self.sources, 'issues': self.issues}


def guess_mime(path, raw):
    ext = os.path.splitext(path)[1].lower().lstrip('.')
    by_ext = {'svg': 'image/svg+xml', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif'}
    if ext in by_ext:
        return by_ext[ext]
    if raw[:4] == b'\x89PNG':
        return 'image/png'
    if raw[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'image/webp'
    if raw[:3] == b'GIF':
        return 'image/gif'
    return 'image/svg+xml'


LIGHT, PLATE, DARK = '#E5E9E6', '#FFFFFF', '#182327'   # LDS surface-soft, white, the dark plate


def luminance(rgb):
    def ch(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


L_LIGHT, L_DARK = (luminance(tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))) for c in (LIGHT, DARK))


def contrast(a, b):
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def lost_shares(lums):
    """(on the soft surface, on the dark plate): the share of the mark's outline that would nearly vanish (under 2:1)."""
    if not lums:
        return 0.0, 0.0
    return (sum(1 for v in lums if contrast(v, L_LIGHT) < 2) / len(lums), sum(1 for v in lums if contrast(v, L_DARK) < 2) / len(lums))


def choose(lost):
    """The dark plate when a fifth of the outline vanishes on the soft surface and 5 % or less on the dark plate."""
    return DARK if lost[0] >= 0.2 and lost[1] <= 0.05 else LIGHT


NOT_DRAWN = re.compile(r'<(clipPath|mask|defs|title|desc|metadata)\b.*?</\1>', re.I | re.S)
SHAPE = re.compile(r'<(path|rect|circle|ellipse|polygon|polyline|text|use)\b([^>]*)>', re.I | re.S)


def svg_colours(text):
    out = []
    for m in re.finditer(r'(?:fill|stroke|stop-color|color)\s*[:=]\s*["\']?\s*(#[0-9a-f]{3,8}\b|rgb\([^)]*\)|white|black)', text, re.I):
        v = m.group(1).lower()
        if v == 'white':
            out.append((255, 255, 255))
        elif v == 'black':
            out.append((0, 0, 0))
        elif v.startswith('#'):
            h = v[1:]
            if len(h) in (3, 4):
                h = ''.join(c * 2 for c in h[:3])
            if len(h) >= 6:
                out.append(tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)))
        else:
            nums = [float(x) for x in re.findall(r'[0-9.]+', v)[:3]]
            if len(nums) == 3:
                out.append(tuple(int(x) for x in nums))
    return out


def plate_for(raw, mime):
    """The plate behind a logo, by Shopping Center's rule (scripts/collect-research-logos.py, 0.1.9): an opaque canvas keeps
    its tone (white plate when light, dark plate when dark, else the soft surface); on a transparent canvas only the
    mark's outline votes; an SVG votes with the colours it paints (what is not drawn left out, an unfilled shape paints
    black). Bytes never change; the plate is the same on both themes."""
    if mime == 'image/svg+xml':
        text = raw.decode('utf-8', 'replace')
        drawn = NOT_DRAWN.sub('', text)
        drawn = re.sub(r'(fill|stroke)\s*[:=]\s*["\']?\s*none\b', '', drawn, flags=re.I)
        colours = svg_colours(drawn)
        colours += [(0, 0, 0)] * len(re.findall(r'(?:fill|stroke)\s*[:=]\s*["\']?\s*currentColor', drawn, re.I))
        if not re.search(r'<style\b[^>]*>[^<]*fill\s*:', drawn, re.I):
            colours += [(0, 0, 0) for _, attrs in SHAPE.findall(drawn) if not re.search(r'\bfill\s*=|fill\s*:', attrs, re.I)]
        return choose(lost_shares([luminance(c) for c in colours]))
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(raw))
        if getattr(im, 'n_frames', 1) > 1:
            im.seek(0)
        im = im.convert('RGBA')
        im.thumbnail((256, 256))
        px = im.load()
        W, H = im.size
    except Exception:  # noqa: BLE001 — a file PIL cannot read sits on the soft surface
        return LIGHT
    ring = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    border = [px[x, y] for x, y in ring]
    opaque = [p for p in border if p[3] >= 250]
    if len(opaque) >= 0.9 * len(border):
        lum = sum(luminance(p) for p in opaque) / len(opaque)
        return PLATE if lum >= 0.85 else DARK if lum <= 0.2 else LIGHT
    edge = []
    for y in range(H):
        for x in range(W):
            if px[x, y][3] >= 128 and (x in (0, W - 1) or y in (0, H - 1) or min(px[x - 1, y][3], px[x + 1, y][3], px[x, y - 1][3], px[x, y + 1][3]) < 128):
                edge.append(luminance(px[x, y]))
    return choose(lost_shares(edge))


# ---- adapters: each demo's own logo registry, read as that demo shipped it ----

def _json(root, repo, path):
    full = os.path.join(root, repo, path)
    return json.load(open(full, encoding='utf-8')) if os.path.isfile(full) else None


def from_restaurant(pool, root):
    logos, chains = _json(root, 'restaurant', 'data/brand-logos.json'), _json(root, 'restaurant', 'data/chains.json')
    if not logos:
        return
    assets = {a['key']: a for a in logos['assets']}
    names = {b['id']: b.get('name') for b in (chains or {}).get('brands', [])}
    for b in logos['brands']:
        a = assets.get(b['key'])
        if a:
            pool.add('restaurant', root, 'research.TH.restaurants', b['id'], names.get(b['id']), path=a['file'], expect=a['sha256'], meta=a)


def from_list(repo, dataset, path, id_field='brand'):
    def adapter(pool, root):
        data = _json(root, repo, path)
        for rec in (data or {}).get('logos', []):
            pool.add(repo, root, dataset, rec[id_field], rec.get('name'), path=rec['file'], expect=rec['sha256'], meta=rec)
    return adapter


def from_camera(pool, root):
    data = _json(root, 'camera', 'data/brand-logos.json')
    for rec in (data or {}).get('brands', []):
        if rec.get('file'):
            pool.add('camera', root, 'research.TH.camera', rec['id'], rec.get('name'), path=rec['file'], expect=rec.get('sourceSHA256'), meta=rec)


def from_sprite(repo, dataset):
    """Luxury Brands and Grocery ship one sprite whose symbols embed the source artwork; the embedded bytes are used only
    when their SHA-256 equals the brand record's sourceSHA256."""
    def adapter(pool, root):
        data = _json(root, repo, 'data/brand-logos.json')
        sprite_path = os.path.join(root, repo, (data or {}).get('meta', {}).get('spriteURL') or 'assets/brand-logos.svg')
        if not data or not os.path.isfile(sprite_path):
            return
        svg = open(sprite_path, encoding='utf-8').read()
        symbols = {m.group(1): m.group(2) for m in re.finditer(r'<symbol id="([^"]+)"[^>]*>(.*?)</symbol>', svg, re.S)}
        sprite_sha = sha256_file(sprite_path)
        for rec in data.get('brands', []) + data.get('formats', []):
            body = symbols.get(rec.get('spriteId'), '')
            images = re.findall(r'<image[^>]*href="data:([^;"]+);base64,([^"]+)"', body)
            if len(images) != 1:
                pool.issues.append({'repo': repo, 'path': f'sprite#{rec.get("spriteId")}', 'reason': 'symbol without one embedded image'})
                continue
            mime, b64 = images[0]
            raw = base64.b64decode(b64, validate=True)
            meta = dict(rec, mime=mime)
            pool.add(repo, root, dataset, rec['id'], rec.get('name'), data=raw, expect=rec.get('sourceSHA256'), meta=meta,
                     derived=f'{os.path.relpath(sprite_path, os.path.join(root, repo))}#{rec["spriteId"]} (sprite SHA-256 {sprite_sha[:16]}…, embedded original)')
    return adapter


def from_university(pool, root):
    data = _json(root, 'university', 'data/universities.json')
    for u in (data or {}).get('universities', []):
        logo = u.get('logo')
        if logo and logo.get('file'):
            pool.add('university', root, 'research.TH.university', u['key'], u.get('name'), path=logo['file'], expect=logo.get('sha256'),
                     meta={'width': logo.get('w'), 'height': logo.get('h'), 'sourcePage': logo.get('page'), 'checkedOn': logo.get('checked')})


def from_shoppingcenter(pool, root):
    """Shopping Center's tenant-logo manifest (dataset|id), then the names its data gives those ids: the brand of a dataset
    record and a centre-directory label the Research Master linked to the brand id (brand_match_status
    registry_brand_membership_linked)."""
    manifest = _json(root, 'shoppingcenter', 'assets/tenant-logos-manifest.json') or {}
    for key, rec in manifest.items():
        dataset, _, entity = key.partition('|')
        pool.add('shoppingcenter', root, dataset, entity, None, path=rec['file'], expect=rec['sha256'], meta=rec)
    confirmed_names(pool, root)


def confirmed_names(pool, root):
    base = os.path.join(root, 'shoppingcenter', 'data')
    for folder in ('tenants', 'directory'):
        for n in range(32):
            path = os.path.join(base, folder, f'{n:02d}.json')
            if not os.path.isfile(path):
                continue
            for venue in json.load(open(path, encoding='utf-8')).get('venues', {}).values():
                for item in venue.get('items', []):
                    if item.get('suppressManufacturerLogo') or not item.get('brandId'):
                        continue
                    if item.get('dataset') == 'research.TH.shopping_directory':
                        dataset, _, entity = item['brandId'].partition(':')
                        label = item.get('name')
                    else:
                        dataset, entity, label = item.get('dataset'), item['brandId'], item.get('brand')
                    key = f'{dataset}|{entity}'
                    digest = (pool.keys.get(key) or pool.ids.get(entity) or [None])[0]
                    if digest and label:
                        pool.name(key, label, digest)


ADAPTERS = (
    ('restaurant', from_restaurant),
    ('fitness', from_list('fitness', 'research.TH.fitness', 'data/brand-logos.json')),
    ('hotel', from_list('hotel', 'research.TH.hotel', 'data/brand-logos.json')),
    ('camera', from_camera),
    ('luxurybrands', from_sprite('luxurybrands', 'research.TH.luxury')),
    ('grocery', from_sprite('grocery', 'research.TH.grocery')),
    ('university', from_university),
    ('shoppingcenter', from_shoppingcenter),
)


def build_pool(root, skip=()):
    pool = Pool()
    for repo, adapter in ADAPTERS:
        if repo in skip or not os.path.isdir(os.path.join(root, repo)):
            continue
        adapter(pool, root)
    return pool


# ── Venue (mall) logos, kit 1.1.0 ─────────────────────────────────────────────────────────────────────────────────────
VENUE_ORDER = ('shoppingcenter', 'camera', 'luxurybrands', 'fitness', 'grocery', 'restaurant')
VENUE_ROLES = ('venue_specific', 'parent_complex', 'shared_department_store_banner', 'shared_chain_banner')


class VenuePool:
    """Mall logos of the family: files by SHA-256, links by the Shopping Center venue id."""

    def __init__(self):
        self.files, self.by_id, self.issues, self.sources = {}, collections.defaultdict(list), [], {}

    def add_file(self, repo, root, rec, original=None):
        path = rec.get('file') or ''
        full = os.path.join(root, repo, path)
        src = self.sources.setdefault(repo, {'commit': git_head(os.path.join(root, repo)), 'files': 0, 'links': 0, 'issues': 0})
        if not path or not os.path.isfile(full):
            self.issues.append({'repo': repo, 'path': path, 'reason': 'missing'}); src['issues'] += 1
            return None
        digest = sha256_file(full)
        if rec.get('sha256') and rec['sha256'].lower() != digest:
            self.issues.append({'repo': repo, 'path': path, 'reason': 'sha256 mismatch'}); src['issues'] += 1
            return None
        if digest not in self.files:
            raw = open(full, 'rb').read()
            mime = rec.get('mime') or guess_mime(full, raw)
            w, h = rec.get('width'), rec.get('height')
            if not (w and h):
                w, h = dimensions(raw, mime)
            plate = rec.get('background') if rec.get('background') in LDS_PLATES else plate_for(raw, mime)
            self.files[digest] = {'sha256': digest, 'repo': repo, 'path': path, 'mime': mime, 'bytes': len(raw), 'width': w,
                                  'height': h, 'background': plate, 'original': (original or digest).lower(),
                                  'sourcePage': rec.get('sourcePage') or ''}
            src['files'] += 1
        return digest

    def link(self, repo, venue_id, digest, role):
        if venue_id and digest and role in VENUE_ROLES:
            self.by_id[venue_id].append({'sha256': digest, 'original': self.files[digest]['original'], 'role': role, 'repo': repo})
            self.sources[repo]['links'] += 1

    def resolve(self, venue_id, exclude=()):
        found = [x for x in self.by_id.get(venue_id, []) if x['repo'] not in exclude]
        if not found:
            return None, 'none'
        if len({x['original'] for x in found}) > 1:
            return None, 'ambiguous'
        if len({x['role'] for x in found}) > 1:
            return None, 'role-conflict'
        found.sort(key=lambda x: (x['sha256'] != x['original'], VENUE_ORDER.index(x['repo']) if x['repo'] in VENUE_ORDER else 99))
        return found[0], 'same-id'

    def by_sha(self, digest):
        return self.files.get((digest or '').lower())

    def summary(self):
        return {'kit': f'{KIT} {VERSION}', 'files': len(self.files), 'venues': len(self.by_id), 'sources': self.sources, 'issues': self.issues}


def _venue_centres(pool, root, repo, data_path):
    """Camera Shops and Luxury Brands: centre uuid → logo key in venue-logos.json, uuid → externalId in the dataset."""
    reg, data = _json(root, repo, 'data/venue-logos.json'), _json(root, repo, data_path)
    if not reg:
        return
    keys = {a['key']: pool.add_file(repo, root, a) for a in reg.get('assets', [])}
    external = {c['id']: c.get('externalId') for c in (data or {}).get('centers', [])}
    for c in reg.get('centers', []):
        pool.link(repo, external.get(c['id']), keys.get(c.get('key')), c.get('role') or 'venue_specific')


def build_venue_pool(root):
    pool = VenuePool()
    reg = _json(root, 'shoppingcenter', 'data/venue-logos.json')
    if reg:
        keys = {a['key']: pool.add_file('shoppingcenter', root, a) for a in reg.get('assets', [])}
        for v in reg.get('venues', []):
            pool.link('shoppingcenter', v.get('id'), keys.get(v.get('key')), v.get('role') or 'venue_specific')
    _venue_centres(pool, root, 'camera', 'data/camera.json')
    _venue_centres(pool, root, 'luxurybrands', 'data/luxury.json')
    reg, data = _json(root, 'fitness', 'data/venue-logos.json'), _json(root, 'fitness', 'data/fitness.json')
    if reg:
        keys = {a['key']: pool.add_file('fitness', root, a, original=(a.get('original') or {}).get('sha256')) for a in reg.get('logos', [])}
        roles = {a['key']: a.get('role') or 'venue_specific' for a in reg.get('logos', [])}
        for v in (data or {}).get('venues', []):
            pool.link('fitness', v.get('scId'), keys.get(v.get('logo')), roles.get(v.get('logo')))
    for repo in ('grocery', 'restaurant'):      # files only (their venue ids are their own): exact-SHA-256 lookups
        for a in (_json(root, repo, 'data/venue-logos.json') or {}).get('assets', []):
            pool.add_file(repo, root, a)
    return pool


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('pool', help='read every demo checkout under --family and write the pool summary')
    p.add_argument('--family', required=True)
    p.add_argument('--out', required=True)
    a = ap.parse_args()
    if a.cmd == 'pool':
        pool = build_pool(a.family)
        body = pool.summary()
        body['files'] = sorted(pool.files.values(), key=lambda r: r['sha256'])
        body['entities'] = {k: v for k, v in sorted(pool.keys.items()) if v}
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump(body, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print(json.dumps(pool.summary(), ensure_ascii=False)[:2000])


if __name__ == '__main__':
    main()
