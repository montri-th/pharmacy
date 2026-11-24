"""citymeter-logos kit: the one name key and the resolver's rules (run by tests/logo-kit.test.js, python3 -I)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts', 'logo-kit'))
import citymeter_logos as kit  # noqa: E402


def pool_with(entries):
    """entries: (dataset, id, name, digest) — a pool without files on disk."""
    pool = kit.Pool()
    for dataset, entity, name, digest in entries:
        key = f'{dataset}|{entity}'
        pool.files[digest] = {'sha256': digest}
        pool.keys[key].append(digest)
        pool.ids[entity].append(digest)
        if name:
            pool.name(key, name, digest)
        if dataset in kit.FNB_DATASETS:
            pool.fnb.add(digest)
        if dataset in kit.BANK_DATASETS:
            pool.bank.add(digest)
    return pool


SB, MK, CPS, KTB, BOOTS, A1, A2 = ('a' * 64, 'b' * 64, 'c' * 64, 'd' * 64, 'e' * 64, 'f' * 64, '0' * 64)
POOL = pool_with([
    ('research.TH.restaurants', 'RBR-starbucks', 'Starbucks', SB),
    ('research.TH.restaurants', 'RBR-mk', 'MK', MK),
    ('research.TH.apparel', 'BR-AP-cps', 'CPS', CPS),
    ('research.TH.bank', 'BANK-0006', 'กรุงไทย', KTB),
    ('research.TH.beauty', 'PHB-boots', 'Boots', BOOTS),
    ('research.TH.restaurants', 'RBR-a', 'Same Name', A1),
    ('research.TH.sport', 'BR-SP-a', 'Same Name', A2),
    ('research.TH.restaurants', 'RBR-amazon', 'Café Amazon', 'f' * 63 + '1'),
])


class NameKey(unittest.TestCase):
    def test_accents_fold_thai_marks_stay(self):
        self.assertEqual(kit.norm('Café  Amazon'), kit.norm('CAFE AMAZON'))
        self.assertEqual(kit.norm('McDonald’s'), kit.norm("MCDONALD'S"))
        self.assertEqual(kit.norm('MK Restaurants'), 'mk restaurants')
        self.assertNotEqual(kit.norm('กรุงไทย'), kit.norm('กรุงไท'))
        self.assertEqual(kit.norm('ธนาคารกรุงไทย'), 'ธนาคารกรุงไทย')


class Resolver(unittest.TestCase):
    def test_order(self):
        self.assertEqual(POOL.resolve('research.TH.restaurants', 'RBR-mk', ['anything']), (MK, 'own'))
        self.assertEqual(POOL.resolve('research.TH.pharmacy', 'PHB-boots', ['บู๊ทส์']), (BOOTS, 'same-id'))
        self.assertEqual(POOL.resolve(None, None, ['STARBUCKS']), (SB, 'label'))
        self.assertEqual(POOL.resolve(None, None, ['Cafe Amazon'])[1], 'label')

    def test_variants(self):
        self.assertEqual(POOL.resolve(None, None, ['STARBUCKS COFFEE']), (SB, 'descriptor'))
        self.assertEqual(POOL.resolve(None, None, ['MK RESTAURANTS']), (MK, 'descriptor'))
        self.assertEqual(POOL.resolve(None, None, ['MK / เอ็มเค']), (MK, 'bilingual'))
        self.assertEqual(POOL.resolve(None, None, ['Starbucks (สตาร์บัคส์)']), (SB, 'bilingual'))
        self.assertEqual(POOL.resolve(None, None, ['ธนาคารกรุงไทย']), (KTB, 'bank'))
        self.assertEqual(POOL.resolve(None, None, ['กรุงไทย จำกัด (มหาชน)']), (KTB, 'legal'))
        self.assertEqual(POOL.resolve(None, None, ['MK Store']), (MK, 'descriptor'))

    def test_food_words_only_for_food_brands_bank_words_only_for_banks(self):
        self.assertEqual(POOL.resolve(None, None, ['CPS Coffee']), (None, 'none'))
        self.assertEqual(POOL.resolve(None, None, ['CPS Shop']), (CPS, 'descriptor'))
        self.assertEqual(POOL.resolve(None, None, ['Starbucks Bank']), (None, 'none'))

    def test_never(self):
        self.assertEqual(POOL.resolve(None, None, ['Same Name']), (None, 'ambiguous'))
        self.assertEqual(POOL.resolve(None, None, ['Starbuck']), (None, 'none'))
        self.assertEqual(POOL.resolve(None, None, ['Starbucks Reserve Roastery']), (None, 'none'))
        self.assertEqual(POOL.resolve('research.TH.restaurants', 'RBR-starbucks', ['Starbucks'], suppress=True), (None, 'suppressed'))
        self.assertEqual(POOL.resolve(None, None, ['Boots / Watsons']), (None, 'none'), 'two Latin sides are not a bilingual pair')


class Plates(unittest.TestCase):
    def test_plates_are_lds(self):
        svg_white = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#ffffff" d="M0 0h10v10H0z"/></svg>'
        svg_black = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>'
        self.assertEqual(kit.plate_for(svg_white, 'image/svg+xml'), kit.DARK)
        self.assertEqual(kit.plate_for(svg_black, 'image/svg+xml'), kit.LIGHT)
        self.assertEqual(kit.dimensions(svg_black, 'image/svg+xml'), (10.0, 10.0))



class Venues(unittest.TestCase):
    """VenuePool (1.1.0): a venue takes another demo's logo only by its venue id, one artwork with one role."""

    @staticmethod
    def pool(links):
        vp = kit.VenuePool()
        for repo, venue, digest, original, role in links:
            vp.sources.setdefault(repo, {'files': 0, 'links': 0, 'issues': 0})
            vp.files.setdefault(digest, {'sha256': digest, 'repo': repo, 'original': original})
            vp.link(repo, venue, digest, role)
        return vp

    def test_one_artwork_one_role(self):
        o, d = 'a' * 64, 'b' * 64     # d: a downscale whose record keeps the original's SHA-256
        vp = self.pool([('fitness', 'SC-1', d, o, 'venue_specific'), ('camera', 'SC-1', o, o, 'venue_specific'),
                        ('camera', 'SC-2', o, o, 'venue_specific'), ('luxurybrands', 'SC-2', 'c' * 64, 'c' * 64, 'venue_specific'),
                        ('camera', 'SC-3', o, o, 'venue_specific'), ('fitness', 'SC-3', d, o, 'shared_chain_banner'),
                        ('shoppingcenter', 'SC-4', o, o, 'venue_specific')])
        hit, why = vp.resolve('SC-1')
        self.assertEqual((hit['sha256'], why), (o, 'same-id'), 'the original bytes win over a downscale of them')
        self.assertEqual(vp.resolve('SC-2'), (None, 'ambiguous'), 'two artworks for one venue give none')
        self.assertEqual(vp.resolve('SC-3'), (None, 'role-conflict'), 'one artwork with two roles gives none')
        self.assertEqual(vp.resolve('SC-4', exclude=('shoppingcenter',)), (None, 'none'), 'a demo never takes its own links back')
        self.assertEqual(vp.resolve('Central Ladprao'), (None, 'none'), 'never by name')
        vp.link('camera', 'SC-5', o, 'logo')
        self.assertEqual(vp.resolve('SC-5'), (None, 'none'), 'a role outside the four is no link')
        self.assertEqual(vp.by_sha(o.upper())['sha256'], o)
        self.assertIsNone(vp.by_sha('e' * 64))


if __name__ == '__main__':
    unittest.main(verbosity=1)
