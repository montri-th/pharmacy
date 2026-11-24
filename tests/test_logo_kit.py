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


if __name__ == '__main__':
    unittest.main(verbosity=1)
