# enrich.py の写真の作者とライセンスの試験。cd server && python3 -m unittest discover -s tests
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import enrich  # noqa: E402

URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Koto_in_zen_porche.jpg/500px-Koto_in_zen_porche.jpg?utm_source=x'
SRC = 'https://commons.wikimedia.org/wiki/File:Koto_in_zen_porche.jpg'


def info(short, url='', artist='<a href="//commons.wikimedia.org/wiki/User:A">A &amp; B</a>', nonfree=None, src=SRC):
    meta = {'LicenseShortName': {'value': short}, 'LicenseUrl': {'value': url}, 'Artist': {'value': artist}}
    if nonfree is not None:
        meta['NonFree'] = {'value': nonfree}
    return {'descriptionurl': src, 'extmetadata': meta}


class MatrixTest(unittest.TestCase):
    def setUp(self):
        self.saved = enrich.get_json
        self.urls = []

        def fake(url, lock, timeout=20):
            self.urls.append(url)
            d = {'code': 'Ok', 'durations': [[0, 600.0], [630.0, 0]]}
            if '/routed-foot/' in url:
                d['distances'] = [[0, 801.4], [None, 0]]
            return d
        enrich.get_json = fake

    def tearDown(self):
        enrich.get_json = self.saved

    def test_walk_distance_comes_with_the_walk_time(self):
        m = enrich.matrix([{'lat': 35.0, 'lng': 135.76}, {'lat': 35.0, 'lng': 135.77}])
        self.assertEqual(m['walk'], [[0, 10.0], [10.5, 0]])
        self.assertEqual(m['walkM'], [[0, 801], [None, 0]])
        self.assertIn('annotations=duration,distance', self.urls[0])
        self.assertTrue(self.urls[1].endswith('annotations=duration'))


class CreditTest(unittest.TestCase):
    def test_file_of(self):
        self.assertEqual(enrich.file_of(URL), 'Koto in zen porche.jpg')
        self.assertEqual(enrich.file_of('https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/%E5%A4%A9.JPG/500px-x.JPG'), '天.JPG')
        self.assertEqual(enrich.file_of('https://example.com/a.jpg'), '')

    def test_cc_by_sa(self):
        c = enrich.credit_of(info('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0'))
        self.assertEqual(c, {'author': 'A & B', 'license': 'CC BY-SA 4.0',
                             'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0', 'source': SRC})

    def test_ported_and_protocol_relative(self):
        c = enrich.credit_of(info('CC BY-SA 2.1 jp', '//creativecommons.org/licenses/by-sa/2.1/jp/'))
        self.assertEqual(c['licenseUrl'], 'https://creativecommons.org/licenses/by-sa/2.1/jp/')

    def test_cc_needs_author_and_link(self):
        self.assertIsNone(enrich.credit_of(info('CC BY 2.0', 'https://creativecommons.org/licenses/by/2.0', artist='')))
        self.assertIsNone(enrich.credit_of(info('CC BY 2.0', '')))

    def test_public_domain_without_author(self):
        c = enrich.credit_of(info('Public domain', '', artist=''))
        self.assertEqual((c['license'], c['author'], c['licenseUrl']), ('Public domain', '', ''))
        self.assertEqual(enrich.credit_of(info('CC0', ''))['licenseUrl'], enrich.CC0_URL)

    def test_rejects_other_licenses(self):
        for short in ('GFDL', 'CC BY-NC-SA 4.0', 'CC BY-ND 2.0', 'FAL', 'Attribution', ''):
            self.assertIsNone(enrich.credit_of(info(short, 'https://example.org/')), short)
        self.assertIsNone(enrich.credit_of(info('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0', nonfree='true')))
        self.assertIsNone(enrich.credit_of(info('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0', artist='x' * 81)))


class AddCreditsTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.orig = enrich.wiki

    def tearDown(self):
        enrich.wiki = self.orig

    def fake(self, pages):
        def wiki(params):
            self.calls.append(params)
            return {'query': {'pages': pages}}
        enrich.wiki = wiki

    def test_fills_and_drops(self):
        bad = URL.replace('0/08/Koto_in_zen_porche.jpg', 'a/ab/Bad.jpg')
        self.fake([
            {'title': 'File:Koto in zen porche.jpg', 'imageinfo': [info('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0')]},
            {'title': 'File:Bad.jpg', 'imageinfo': [info('GFDL', 'https://www.gnu.org/copyleft/fdl.html')]},
        ])
        at = {'lat': 35.0, 'lng': 135.7}
        plist = [{'name': 'a', **at, 'photo': {'url': URL, 'title': 't', 'page': 'p'}},
                 {'name': 'b', **at, 'photo': {'url': bad, 'title': 't', 'page': 'p'}},
                 {'name': 'c', **at, 'photo': None}]
        cache = {'a@35.00,135.70': {'url': URL, 'title': 't', 'page': 'p'}, 'b@35.00,135.70': {'url': bad}, 'z@35.00,135.70': {'url': URL}}
        enrich.add_credits(plist, cache)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0]['titles'], 'File:Bad.jpg|File:Koto in zen porche.jpg')
        self.assertEqual(plist[0]['photo']['license'], 'CC BY-SA 4.0')
        self.assertEqual(plist[0]['photo']['title'], 't')
        self.assertEqual(cache['a@35.00,135.70']['author'], 'A & B')
        self.assertIsNone(plist[1]['photo'])
        self.assertIsNone(cache['b@35.00,135.70'])
        self.assertNotIn('license', cache['z@35.00,135.70'])

    def test_skips_known_and_keeps_on_failure(self):
        self.fake([])
        done = {'url': URL, 'license': 'CC0', 'author': '', 'licenseUrl': enrich.CC0_URL, 'source': SRC}
        enrich.add_credits([{'name': 'a', 'lat': 35.0, 'lng': 135.7, 'photo': done}], {})
        self.assertEqual(self.calls, [])
        enrich.wiki = lambda params: None
        plist = [{'name': 'a', 'lat': 35.0, 'lng': 135.7, 'photo': {'url': URL}}]
        enrich.add_credits(plist, {})
        self.assertEqual(plist[0]['photo'], {'url': URL})


class NameScoreTest(unittest.TestCase):
    def test_first_word_only_is_another_place(self):
        self.assertEqual(enrich.name_score('輪王寺', '輪王寺 逍遥園'), 0)
        self.assertEqual(enrich.name_score('近江町市場', '近江町市場 寿し江の町'), 0)
        self.assertTrue(enrich.first_word_only('富士屋ホテル', '富士屋ホテル メインダイニングルーム ザ・フジヤ'))

    def test_same_place_words_and_last_word(self):
        self.assertEqual(enrich.name_score('珊瑚礁', '珊瑚礁 本店'), 2)
        self.assertEqual(enrich.name_score('清水寺', '清水寺 本堂'), 2)
        self.assertEqual(enrich.name_score('雲母', '茶房 雲母'), 2)
        self.assertFalse(enrich.first_word_only('珊瑚礁', '珊瑚礁 本店'))
        self.assertEqual(enrich.name_score('小町通り', '小町通り'), 3)
        self.assertFalse(enrich.first_word_only('小町通り', '小町通り'))

    def test_drops_cached_first_word_photo(self):
        orig = enrich.wiki
        enrich.wiki = lambda params: None
        try:
            ok = {'url': URL, 'title': '小町通り', 'page': 'p'}
            plist = [{'name': '輪王寺 逍遥園', 'lat': 36.75, 'lng': 139.6, 'photo': {'url': URL, 'title': '輪王寺', 'page': 'p'}},
                     {'name': '小町通り', 'lat': 35.32, 'lng': 139.55, 'photo': ok}]
            cache = {'輪王寺 逍遥園@36.75,139.60': {'url': URL, 'title': '輪王寺', 'page': 'p'}, '小町通り@35.32,139.55': ok}
            enrich.find_photos(plist, cache)
        finally:
            enrich.wiki = orig
        self.assertIsNone(plist[0]['photo'])
        self.assertIsNone(cache['輪王寺 逍遥園@36.75,139.60'])
        self.assertIs(plist[1]['photo'], ok)


class PhotoKeyTest(unittest.TestCase):
    def test_same_name_in_another_town_is_not_reused(self):
        kanazawa = {'name': '妙法寺', 'lat': 36.555, 'lng': 136.645}
        kamakura = {'name': '妙法寺', 'lat': 35.315, 'lng': 139.561}
        self.assertNotEqual(enrich.photo_key(kanazawa), enrich.photo_key(kamakura))
        cache = {enrich.photo_key(kanazawa): {'url': URL, 'title': '妙法寺 (金沢市)', 'page': 'p'}}
        orig = enrich.wiki
        enrich.wiki = lambda params: None
        try:
            enrich.find_photos([kamakura], cache)
        finally:
            enrich.wiki = orig
        self.assertNotIn('photo', kamakura)


class NameVariantsTest(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(enrich.name_variants('高徳院（鎌倉大仏）'), ['高徳院', '鎌倉大仏'])
        self.assertEqual(enrich.name_variants('芦ノ湖畔（元箱根港付近）'), ['芦ノ湖畔', '芦ノ湖'])
        self.assertEqual(enrich.name_variants('若草山山頂展望台'), ['若草山山頂展望台', '若草山山頂', '若草山'])
        self.assertEqual(enrich.name_variants('陣ケ下渓谷公園'), ['陣ケ下渓谷公園', '陣ヶ下渓谷公園'])
        self.assertEqual(enrich.name_variants('竹中稲荷神社'), ['竹中稲荷神社', '竹中稲荷社'])
        self.assertEqual(enrich.name_variants('中禅寺湖畔散策路'), ['中禅寺湖畔散策路', '中禅寺湖畔', '中禅寺湖'])
        self.assertEqual(enrich.name_variants('瓢亭 本店'), ['瓢亭 本店', '瓢亭本店', '瓢亭'])
        self.assertEqual(enrich.name_variants('長照山 雲龍院'), ['長照山 雲龍院', '長照山雲龍院', '雲龍院'])
        self.assertEqual(enrich.name_variants('本家 第一旭 本店'), ['本家 第一旭 本店', '本家第一旭本店', '本家 第一旭', '本家第一旭'])
        self.assertEqual(enrich.name_variants('四知堂 kanazawa'), ['四知堂 kanazawa', '四知堂kanazawa'])
        self.assertEqual(enrich.name_variants('A|B'), [])


def fake_wiki(titles_q, geo=None):
    """位置の検索・題の引き当て・記事の写真の問い合わせに答える偽の wiki（記事の写真は、聞かれた題ごとに 1 枚）"""
    calls = []

    def wiki(params):
        calls.append(params)
        if params.get('list') == 'geosearch':
            return {'query': {'geosearch': geo(len(calls)) if geo else []}}
        if 'coordinates' in params.get('prop', ''):
            return {'query': titles_q}
        if 'pageimages' in params.get('prop', ''):
            return {'query': {'pages': [{'title': t, 'pageimage': 'P.jpg', 'thumbnail': {'source': URL}} for t in params['titles'].split('|')]}}
        return None
    return wiki, calls


def photo_titles(plist):
    return {p['name']: p['photo']['title'] for p in plist if p.get('photo')}


class TitleMatchTest(unittest.TestCase):
    def setUp(self):
        self.orig = enrich.wiki

    def tearDown(self):
        enrich.wiki = self.orig

    def test_redirects_to_a_section_or_a_town_are_another_place(self):
        enrich.wiki, calls = fake_wiki({
            'redirects': [{'from': '英国大使館別荘記念公園', 'to': '栃木県立日光自然博物館', 'tofragment': '英国大使館別荘記念公園'},
                          {'from': '旧柳下邸', 'to': '根岸町'}, {'from': '金閣寺', 'to': '鹿苑寺'}],
            'pages': [{'title': '栃木県立日光自然博物館', 'coordinates': [{'lat': 36.7386, 'lon': 139.5}]},
                      {'title': '根岸町', 'coordinates': [{'lat': 35.4205, 'lon': 139.6305}]},
                      {'title': '鹿苑寺', 'coordinates': [{'lat': 35.0394, 'lon': 135.7292}]}]})
        plist = [{'name': '英国大使館別荘記念公園', 'lat': 36.738, 'lng': 139.501},
                 {'name': '旧柳下邸', 'lat': 35.42, 'lng': 139.63},
                 {'name': '金閣寺', 'lat': 35.039, 'lng': 135.729}]
        enrich.find_photos(plist, {})
        self.assertEqual(photo_titles(plist), {'金閣寺': '鹿苑寺'})

    def test_disambiguation_and_redirect_without_place_are_skipped(self):
        enrich.wiki, calls = fake_wiki({
            'redirects': [{'from': '三嶋亭', 'to': '三嶋亭 (料理店)'}],
            'pages': [{'title': '長建寺', 'pageprops': {'disambiguation': ''}, 'description': '京都'},
                      {'title': '三嶋亭 (料理店)', 'description': '京都市中京区の料理店'},
                      {'title': '瓢亭', 'description': '京都市左京区にある日本料理店'}]})
        plist = [{'name': '長建寺', 'lat': 34.928, 'lng': 135.76}, {'name': '三嶋亭', 'lat': 35.008, 'lng': 135.767},
                 {'name': '瓢亭', 'lat': 35.011, 'lng': 135.786}]
        enrich.find_photos(plist, {}, '京都')
        self.assertEqual(photo_titles(plist), {'瓢亭': '瓢亭'})

    def test_town_name_in_the_name_is_not_the_place(self):
        enrich.wiki, calls = fake_wiki({}, lambda n: [{'title': '箱根', 'lat': 35.233, 'lon': 139.105}])
        plist = [{'name': 'Bakery&Table 箱根', 'lat': 35.232, 'lng': 139.104, 'district': '芦ノ湖'}]
        enrich.find_photos(plist, {}, '箱根')
        self.assertEqual(photo_titles(plist), {})


class TitleVariantTest(unittest.TestCase):
    def setUp(self):
        self.orig = enrich.wiki

    def tearDown(self):
        enrich.wiki = self.orig

    def test_branch_word_and_last_word(self):
        enrich.wiki, calls = fake_wiki({'pages': [{'title': '瓢亭', 'coordinates': [{'lat': 35.0114, 'lon': 135.7865}]},
                                                  {'title': '雲龍院', 'coordinates': [{'lat': 34.9866, 'lon': 135.7795}]}]})
        plist = [{'name': '瓢亭 本店', 'lat': 35.011, 'lng': 135.786}, {'name': '長照山 雲龍院', 'lat': 34.9865, 'lng': 135.7794}]
        enrich.find_photos(plist, {}, '京都')
        self.assertEqual(photo_titles(plist), {'瓢亭 本店': '瓢亭', '長照山 雲龍院': '雲龍院'})

    def test_town_word_and_parent_article_are_not_the_place(self):
        enrich.wiki, calls = fake_wiki({
            'redirects': [{'from': '逍遥園', 'to': '輪王寺'}],
            'pages': [{'title': '箱根', 'coordinates': [{'lat': 35.233, 'lon': 139.105}]},
                      {'title': '輪王寺', 'coordinates': [{'lat': 36.7536, 'lon': 139.6003}]}]})
        plist = [{'name': 'Bakery&Table 箱根', 'lat': 35.232, 'lng': 139.104, 'district': '芦ノ湖'},
                 {'name': '輪王寺 逍遥園', 'lat': 36.7537, 'lng': 139.6004}]
        enrich.find_photos(plist, {}, '箱根')
        self.assertEqual(photo_titles(plist), {})
        asked = next(c for c in calls if 'coordinates' in c.get('prop', ''))['titles'].split('|')
        self.assertNotIn('箱根', asked)
        self.assertEqual(enrich.variants_of({'name': '先斗町', 'district': '先斗町'}, '京都'), ['先斗町'])

    def test_town_article_by_part_of_name(self):
        enrich.wiki, calls = fake_wiki({'pages': [{'title': '材木座', 'description': '神奈川県鎌倉市の地名',
                                                   'coordinates': [{'lat': 35.307, 'lon': 139.555}]}]})
        plist = [{'name': '材木座海岸', 'lat': 35.306, 'lng': 139.556}]
        enrich.find_photos(plist, {}, '鎌倉')
        self.assertEqual(photo_titles(plist), {})

    def test_capped_search_looks_again_in_smaller_areas(self):
        def geo(n):
            if n == 1:
                return [{'title': f'x{i}', 'lat': 35.0, 'lon': 135.7, 'dist': 1500} for i in range(500)]
            return [{'title': '詩仙堂', 'lat': 35.02, 'lon': 135.72, 'dist': 10}]
        enrich.wiki, calls = fake_wiki({}, geo)
        near = {'name': '近くの寺', 'lat': 35.0, 'lng': 135.7}
        far = {'name': '詩仙堂', 'lat': 35.02, 'lng': 135.72}
        enrich.find_photos([near, far], {})
        self.assertEqual(len(enrich._clusters([near, far])), 1)
        self.assertEqual([c['gscoord'] for c in calls if c.get('list') == 'geosearch'][1:], ['35.0|135.7', '35.02|135.72'])
        self.assertEqual(photo_titles([near, far]), {'詩仙堂': '詩仙堂'})


def row(qid, file, label=None, lng=None, lat=None):
    b = {'item': {'value': 'http://www.wikidata.org/entity/' + qid},
         'image': {'value': 'http://commons.wikimedia.org/wiki/Special:FilePath/' + enrich.urllib.parse.quote(file)}}
    if label:
        b['label'] = {'value': label}
        b['coord'] = {'value': f'Point({lng} {lat})'}
    return b


def ii(file, short='CC BY-SA 4.0', url='https://creativecommons.org/licenses/by-sa/4.0'):
    th = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/' + file.replace(' ', '_') + '/500px-' + file.replace(' ', '_')
    return {'title': 'ファイル:' + file, 'imageinfo': [{**info(short, url, src='https://commons.wikimedia.org/wiki/File:' + file.replace(' ', '_')),
                                                       'thumburl': th}]}


class WikidataPhotoTest(unittest.TestCase):
    def setUp(self):
        self.orig = enrich.wiki, enrich.wdqs
        self.queries = []

    def tearDown(self):
        enrich.wiki, enrich.wdqs = self.orig

    def run_with(self, rows, pages, plist, match=None, items=None):
        def wdqs(q):
            self.queries.append(q)
            return rows
        enrich.wdqs = wdqs
        self.calls = []

        def wiki(params):
            self.calls.append(params)
            return {'query': {'pages': pages}}
        enrich.wiki = wiki
        cache = {enrich.photo_key(p): None for p in plist}
        for p in plist:
            p['photo'] = None
        enrich.wikidata_photos(plist, cache, plist, match or {}, items or {})
        return cache

    def test_item_of_article_and_nearest_same_name(self):
        honen = {'name': '法然院', 'lat': 35.024, 'lng': 135.7974}
        choken = {'name': '長建寺', 'lat': 34.9284, 'lng': 135.7606}
        shop = {'name': '鳥岩楼', 'lat': 35.03, 'lng': 135.75}
        rows = [row('Q11555257', 'Honen-in.jpg'),
                row('Q106836924', 'Choken-ji (Adachi).jpg', '長建寺', 139.82, 35.79),
                row('Q11652982', 'Choken-ji fushimi kyoto.JPG', '長建寺', 135.760635, 34.928391),
                row('Q1', 'Kyoto map.svg', '鳥岩楼', 135.75, 35.03)]
        pages = [ii('Honen-in.jpg'), ii('Choken-ji fushimi kyoto.JPG'), ii('Choken-ji (Adachi).jpg')]
        plist = [honen, choken, shop]
        cache = self.run_with(rows, pages, plist, {enrich.photo_key(honen): '法然院'}, {'法然院': 'Q11555257'})
        self.assertIn('wd:Q11555257', self.queries[0])
        self.assertIn('"長建寺"@ja', self.queries[0])
        self.assertEqual((honen['photo']['title'], honen['photo']['page']), ('法然院', enrich.wiki_page('法然院')))
        self.assertIn('Choken-ji_fushimi_kyoto.JPG', choken['photo']['url'])
        self.assertEqual(choken['photo']['page'], 'https://www.wikidata.org/wiki/Q11652982')
        self.assertEqual(choken['photo']['license'], 'CC BY-SA 4.0')
        self.assertIs(cache[enrich.photo_key(choken)], choken['photo'])
        self.assertIsNone(shop['photo'])
        files = self.calls[0]['titles'].split('|')
        self.assertEqual(sorted(files), ['File:Choken-ji fushimi kyoto.JPG', 'File:Honen-in.jpg'])

    def test_far_or_unlicensed_is_dropped(self):
        far = {'name': '長建寺', 'lat': 34.90, 'lng': 135.76}
        gfdl = {'name': '石峰寺', 'lat': 34.9647, 'lng': 135.7751}
        rows = [row('Q11652982', 'Choken.jpg', '長建寺', 135.760635, 34.928391),
                row('Q11585586', 'Sekiho.jpg', '石峰寺', 135.775083, 34.964694)]
        self.run_with(rows, [ii('Sekiho.jpg', 'GFDL', 'https://www.gnu.org/copyleft/fdl.html')], [far, gfdl])
        self.assertIsNone(far['photo'])
        self.assertIsNone(gfdl['photo'])

    def test_town_items_only_for_streets_by_whole_name(self):
        street = {'name': 'かっぱ橋道具街', 'kind': 'street', 'lat': 35.7167, 'lng': 139.7891}
        beach = {'name': '材木座海岸', 'kind': 'sight', 'lat': 35.3075, 'lng': 139.552}
        town = {'town': {'value': 'http://www.wikidata.org/entity/Q486972'}}
        rows = [{**row('Q2977163', 'Kappabashi.jpg', 'かっぱ橋道具街', 139.78915, 35.71675), **town},
                {**row('Q121432378', 'Zaimokuza.jpg', '材木座', 139.552, 35.3077), **town}]
        self.run_with(rows, [ii('Kappabashi.jpg'), ii('Zaimokuza.jpg')], [street, beach])
        self.assertIn('Kappabashi.jpg', street['photo']['url'])
        self.assertIsNone(beach['photo'])

    def test_failure_leaves_places_to_retry(self):
        p = {'name': '長建寺', 'lat': 34.9284, 'lng': 135.7606}
        enrich.wdqs = lambda q: None
        cache = {enrich.photo_key(p): None}
        p['photo'] = None
        enrich.wikidata_photos([p], cache, [p], {}, {})
        self.assertNotIn('photo', p)
        self.assertEqual(cache, {})


class AgentTest(unittest.TestCase):
    def test_names_app_and_site(self):
        self.assertRegex(enrich.UA, r'^IntenTrip/\S+ \(\+https://\S+\)$')
        self.assertEqual(enrich.UA, enrich.places.UA)
        self.assertNotIn('@', enrich.UA)


class OsrmRateTest(unittest.TestCase):
    def test_one_at_a_time_with_gap(self):
        import io, threading, time
        times, active, peak = [], [0], [0]
        orig = enrich.urllib.request.urlopen

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                active[0] -= 1

        def fake(req, timeout=0):
            active[0] += 1
            peak[0] = max(peak[0], active[0])
            times.append(time.time())
            return Resp(b'{"code": "Ok"}')
        enrich.urllib.request.urlopen = fake
        gap = enrich.OSRM_GAP
        enrich.OSRM_GAP = 0.05
        try:
            th = [threading.Thread(target=enrich.get_json, args=('https://example.org/', enrich._osrm)) for _ in range(4)]
            for t in th:
                t.start()
            for t in th:
                t.join(5)
        finally:
            enrich.urllib.request.urlopen = orig
            enrich.OSRM_GAP = gap
        self.assertEqual(len(times), 4)
        self.assertEqual(peak[0], 1)
        times.sort()
        self.assertTrue(all(b - a >= 0.045 for a, b in zip(times, times[1:])))


if __name__ == '__main__':
    unittest.main()
