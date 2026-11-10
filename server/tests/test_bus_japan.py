# エリアに合わせて時刻表を選ぶ係（bus_feeds.py）と、大きな時刻表を近くだけの形にする係の試験。
# cd server && python3 -m unittest discover -s tests
import csv, io, json, os, sys, tempfile, threading, time, unittest, zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bus  # noqa: E402
import bus_feeds as bf  # noqa: E402
from test_bus import DEST, ORIGIN, make_zip  # noqa: E402

KYOTO_BOX = bf.box_of([(34.98, 135.75), (35.02, 135.79)], 1000)


def portal_ds(label, license_type='ODPT基本', explain='', name='テストバス', modes=('bus',), license_name=None, dates=('20261101',)):
    return {'label': label, 'name_ja': name, 'explain_ja': explain, 'license_type': license_type, 'license_name_ja': license_name,
            'license_url_ja': None, 'license_explain': None, 'format_type': 'GTFS/GTFS-JP', 'mode_list': list(modes),
            'dataresource': [{'url': f'https://api.odpt.org/api/v4/files/odpt/X/{label}.zip?date={d}&acl:consumerKey=[x]',
                              'uploaded_at': f'{d[:4]}-{d[4:6]}-{d[6:]}T10:00', 'feed_end_date': '2027-03-31', 'feed_version': d} for d in dates]}


class Licenses(unittest.TestCase):
    def test_odpt(self):
        self.assertEqual(bf.odpt_license(portal_ds('A')), 'odpt')
        self.assertEqual(bf.odpt_license(portal_ds('A', 'CC BY 4.0')), 'CC BY 4.0')
        self.assertEqual(bf.odpt_license(portal_ds('A', 'CC0')), 'CC0 1.0')
        # 基本ライセンスと書いてあっても、チャレンジ限定・事前の承認が要る物は使わない
        self.assertIsNone(bf.odpt_license(portal_ds('A', explain='【チャレンジ2026期間限定公開】京都市営地下鉄')))
        self.assertIsNone(bf.odpt_license(portal_ds('A', explain='案内用途に利用する場合は、必ず事前に連絡し、承認を得てください。')))
        self.assertIsNone(bf.odpt_license(portal_ds('A', 'その他ライセンス(認証なし)', license_name='GTFS-RU')))
        self.assertIsNone(bf.odpt_license(portal_ds('A', name='デマンド交通「のりあい」')))
        # 「特定利用条件をよく読んで」は、どの物にも付く決まり文句なので外さない
        self.assertEqual(bf.odpt_license(portal_ds('A', explain='公共交通オープンデータ基本ライセンス、および、その特定利用条件をよく読んで、ご利用ください。')), 'odpt')

    def test_gtfsjp(self):
        lic = lambda s, url='': bf.gtfsjp_license({'feed_license_id': s, 'feed_license_url': url})
        self.assertEqual(lic('CC BY 4.0'), 'CC BY 4.0')
        self.assertEqual(lic('CC0 1.0'), 'CC0 1.0')
        self.assertEqual(lic('CC BY 2.1 JP'), 'CC BY 2.1 JP')
        self.assertEqual(lic('CC-BY', 'https://creativecommons.org/licenses/by/4.0/'), 'CC BY 4.0')
        self.assertIsNone(lic('CC BY-SA 4.0'))                         # 同じ条件で再配布を求める物は使わない
        self.assertIsNone(lic('CC-BY', 'https://creativecommons.org/licenses/by-sa/4.0/'))
        self.assertIsNone(lic('ODbL'))
        self.assertIsNone(lic('CC BY-NC 4.0'))
        self.assertIsNone(lic(''))

    def test_not_for_visitors(self):
        x = {'organization_id': 'o', 'feed_id': 'f', 'organization_name': '八重瀬町', 'feed_name': '八重瀬町バス', 'feed_license_id': 'CC BY 4.0',
             'file_uid': 'u1', 'file_from_date': '2026-04-01', 'file_to_date': '2027-03-31'}
        self.assertIsNotNone(bf.gtfsjp_feed(x, {'feed_memo': ''}))
        self.assertIsNone(bf.gtfsjp_feed(x, {'feed_memo': '利用対象者の制限があります。'}))
        self.assertIsNone(bf.gtfsjp_feed(x, {'feed_is_discontinued': True}))
        self.assertIsNone(bf.gtfsjp_feed({**x, 'feed_name': 'AIデマンド交通「いつモ」'}, {}))


class UserAgent(unittest.TestCase):
    def test_same_name_as_other_requests(self):
        import places
        self.assertEqual(bf.UA, places.UA)
        self.assertEqual(bus.UA, places.UA)
        self.assertTrue(places.UA.startswith('IntenTrip/1.0 '))


class Names(unittest.TestCase):
    def test_short_name(self):
        self.assertEqual(bf.short_name('伊豆箱根バス株式会社'), '伊豆箱根バス')
        self.assertEqual(bf.short_name('永井バス（永井運輸株式会社）'), '永井バス')
        self.assertEqual(bf.short_name('千代田区地域福祉交通「風ぐるま」'), '風ぐるま')
        self.assertEqual(bf.short_name('拓殖バス　都市間高速バス・空港連絡バス（市内ホテル回り線）'), '拓殖バス')
        self.assertEqual(bf.short_name('コミュニティバス（江戸バス）'), '江戸バス')
        self.assertEqual(bf.short_name('青森市営バス路線情報'), '青森市営バス')
        self.assertEqual(bf.gtfsjp_short({'feed_name': 'コミュニティバス', 'organization_name': '野々市市'}), '野々市市コミュニティバス')

    def test_route_label(self):
        feed = {'agency': '東京メトロ'}
        self.assertEqual(bus._route_label(feed, {'route_short_name': 'G', 'route_long_name': '銀座線', 'route_type': '1'}), '銀座線')
        self.assertEqual(bus._route_label({'agency': '都営バス'}, {'route_short_name': '草３９', 'route_type': '3'}), '草39')
        self.assertEqual(bus._route_label({'agency': '市バス'}, {'route_short_name': '市バス２０６', 'route_type': '3'}), '206')


def fake_json(responses, calls):
    def get(url, timeout=20):
        calls.append(url)
        for k, v in responses.items():
            if k in url:
                return v() if callable(v) else v
        raise OSError('none')
    return get


def gtfsjp_row(org, feed, name, org_name, lic='CC BY 4.0'):
    return {'organization_id': org, 'feed_id': feed, 'organization_name': org_name, 'feed_name': name, 'feed_license_id': lic,
            'feed_license_url': '', 'file_uid': f'{feed}-uid', 'file_from_date': '2026-04-01', 'file_to_date': '2027-12-31',
            'file_published_at': '2026-03-30T10:00', 'file_stop_url': f'https://api.gtfs-data.jp/stops/{feed}.geojson'}


def geojson(points):
    return {'features': [{'geometry': {'coordinates': [lo, la]}, 'properties': {'location_type': '0'}} for la, lo in points]}


class Choose(unittest.TestCase):
    def make(self):
        seed = {
            'odpt:City/Bus': {'bbox': [34.95, 135.70, 35.05, 135.80], 'stops': 40, 'cells': {'349:1357': 20, '350:1357': 20}},
            'odpt:Highway/All': {'bbox': [33.0, 132.0, 35.7, 139.8], 'stops': 12, 'cells': {'349:1357': 1, '356:1397': 1, '338:1327': 10}},
            'odpt:Far/Bus': {'bbox': [43.0, 141.3, 43.1, 141.4], 'stops': 30, 'cells': {'430:1413': 30}},
            'odpt:Dup/A': {'bbox': [34.95, 135.70, 35.05, 135.80], 'stops': 5, 'cells': {'349:1357': 5}},
            'odpt:Dup/B': {'bbox': [34.95, 135.70, 35.05, 135.80], 'stops': 5, 'cells': {'349:1357': 5}},
        }
        portal = lambda org, dss, name='市交通局': [{'label': org, 'name_ja': name, 'datasets': dss}]
        responses = {
            'organization=City': portal('City', [portal_ds('Bus', name='市営バス')]),
            'organization=Highway': portal('Highway', [portal_ds('All', 'CC BY 4.0', name='高速バス')], '高速バス株式会社'),
            'organization=Dup': portal('Dup', [portal_ds('A', 'ODPT基本', name='ちょこバス'), portal_ds('B', 'CC0', name='ちょこバス')], '東大和市'),
            'v2/files?extent': {'body': [gtfsjp_row('town', 'loop', '町内循環バス', '近くの町'),
                                         gtfsjp_row('far', 'one', '高速線', '遠くの会社'),
                                         gtfsjp_row('city2', 'x', '市営バス', '市交通局'),
                                         gtfsjp_row('gone', 'y', '廃止バス', '終わった町'),
                                         gtfsjp_row('sa', 'z', '別のバス', '別の町', 'CC BY-SA 4.0')]},
            'v2/feeds': {'body': [{'organization_id': 'gone', 'feed_id': 'y', 'feed_is_discontinued': True}]},
            'stops/loop': geojson([(35.0, 135.75), (35.01, 135.76)]),
            'stops/one': geojson([(35.0, 135.75), (33.8, 132.7), (33.9, 132.8)]),
        }
        calls = []
        d = bf.Directory(tempfile.mkdtemp(), get_json=fake_json(responses, calls), seed=seed)
        return d, calls

    def test_pick_by_area(self):
        d, calls = self.make()
        keys = [f['key'] for f in d.feeds(KYOTO_BOX)]
        self.assertIn('odpt:City/Bus', keys)
        self.assertNotIn('odpt:Highway/All', keys)          # エリアの中の停留所が 1 つだけ
        self.assertNotIn('odpt:Far/Bus', keys)
        self.assertNotIn('Far', ' '.join(calls))             # 関わらない事業者の一覧は聞かない
        self.assertIn('gtfsjp:town/loop', keys)
        self.assertNotIn('gtfsjp:far/one', keys)            # GTFS データリポジトリの物も、停留所が 1 つだけの物は使わない
        self.assertNotIn('gtfsjp:gone/y', keys)             # 終わった物
        self.assertNotIn('gtfsjp:sa/z', keys)               # CC BY-SA
        self.assertNotIn('gtfsjp:city2/x', keys)            # 同じ事業者が ODPT にもある
        self.assertEqual([k for k in keys if k.startswith('odpt:Dup')], ['odpt:Dup/B'])   # 同じ物の別のライセンスは CC0 を使う

    def test_lists_are_reused(self):
        d, calls = self.make()
        d.feeds(KYOTO_BOX)
        n = len(calls)
        d.feeds(KYOTO_BOX)
        self.assertEqual(len(calls), n)                     # 1 日の間は聞き直さない
        d2 = bf.Directory(d.dir, get_json=fake_json({}, calls), seed=d.seed)
        self.assertTrue(d2.feeds(KYOTO_BOX))               # 置いた一覧を使う（聞けなくても動く）

    def test_credit(self):
        d, _ = self.make()
        fs = {f['key']: f for f in d.feeds(KYOTO_BOX)}
        c = bf.credit(fs['gtfsjp:town/loop'])
        self.assertEqual((c['name'], c['title'], c['license'], c['via']), ('近くの町', '町内循環バス', 'CC BY 4.0', 'GTFSデータリポジトリ'))
        self.assertTrue(c['licenseUrl'].startswith('https://creativecommons.org/licenses/by/4.0'))
        c = bf.credit(fs['odpt:City/Bus'])
        self.assertEqual((c['name'], c['license'], c['via']), ('市交通局', 'odpt', 'ODPT'))


class Boxes(unittest.TestCase):
    def test_parse_box(self):
        self.assertEqual(bus.parse_box('34.9,135.7,35.1,135.9'), (34.9, 135.7, 35.1, 135.9))
        self.assertIsNone(bus.parse_box('35.1,135.7,34.9,135.9'))      # 逆さま
        self.assertIsNone(bus.parse_box('30,130,35,136'))               # 広すぎる
        self.assertIsNone(bus.parse_box('0,0,1,1'))                     # 日本の外
        self.assertIsNone(bus.parse_box('a,b,c,d'))

    def test_region_contains_area(self):
        box = bus.area_box([(35.71, 139.79), (35.72, 139.80)])
        r = bus.region_for(box)
        self.assertTrue(bf.contains(r, box))
        self.assertLessEqual(r[2] - r[0], bf.MAX_SIDE + 0.3)


class Regional(unittest.TestCase):
    """大きな時刻表は、エリアの近くの停留所だけの形にし、zip を残して別のエリアにも使う"""

    def make(self):
        tmp = tempfile.mkdtemp()
        calls = []
        feed = {**bus.FEEDS[0], 'id': 'big', 'bytes': bus.LARGE + 1}

        def fetch(f, res, dest):
            calls.append(res)
            make_zip(dest)
        store = bus.Store(tmp, key_fn=lambda: 'k', fetch=fetch, catalog=lambda f: [], directory=bus.Fixed([feed]))
        return store, calls, feed

    def test_region_drops_far_stops(self):
        path = os.path.join(tempfile.mkdtemp(), 'f.zip')
        make_zip(path)
        idx = bus.build(path, bus.FEEDS[0], {'res': 'current', 'fetched': time.time()}, region=(34.99, 135.745, 35.01, 135.80))
        self.assertNotIn('西の端', idx.stop_name)            # 135.70 は範囲から 4 km 離れている
        self.assertEqual(len(idx.stop_name), 3)
        self.assertEqual([t['board']['time'] for t in idx.search(ORIGIN, DEST, 20261109, 9 * 60)], ['10:05'])
        self.assertTrue(all(135.73 <= x <= 135.82 for x, _ in idx.search(ORIGIN, DEST, 20261109, 9 * 60)[0]['line']))

    def test_store_builds_region(self):
        store, calls, feed = self.make()
        idx = store.get(feed, 20261109, box=bus.area_box([ORIGIN, DEST]))
        self.assertTrue(idx.meta['region'])
        self.assertTrue(bf.contains(idx.meta['region'], bus.area_box([ORIGIN, DEST])))

    def test_reuse_region_and_zip(self):
        store, calls, feed = self.make()
        box = bus.area_box([ORIGIN, DEST])
        a = store.get(feed, 20261109, box=box)
        b = store.get(feed, 20261109, box=bus.area_box([ORIGIN]))
        self.assertIs(a, b)                                  # 範囲の中の区間は、同じ形を使う
        far = store.get(feed, 20261109, box=bus.area_box([(35.6, 139.7)]))
        self.assertIsNot(far, a)
        self.assertEqual(calls, ['current'])                 # 別のエリアの形も、残した zip から作る（取り直さない）

    def test_pending_only_for_this_area(self):
        store, calls, feed = self.make()
        box = bus.area_box([ORIGIN, DEST])
        here = ('big', 'current', bus.region_for(box))
        store.failed[here] = store.now()
        store.busy[('big', 'current', bus.region_for(bus.area_box([(35.6, 139.7)])))] = threading.Event()
        self.assertEqual(store.indexes(box, 20261109, wait=0), ([], False))     # 別のエリアの表を作っている最中でも、ここは読み込み中にしない
        store.busy[here] = threading.Event()
        self.assertEqual(store.indexes(box, 20261109, wait=0), ([], True))

    def test_evict_counts_versions_not_regions(self):
        store, _, _ = self.make()

        class Tiny:
            def nbytes(self):
                return 1
        regions = [(34.9, 135.7, 35.1, 135.9), (35.5, 139.6, 35.7, 139.8), (43.0, 141.3, 43.1, 141.4)]
        clock = 1000
        for res in ('a', 'b', 'c', 'e'):
            for r in (regions if res == 'a' else regions[:1]):
                store.loaded[('big', res, r)] = Tiny()
                store.used[('big', res, r)] = clock
                clock += 1
        now = ('big', 'd', regions[0])
        store.loaded[now] = Tiny()
        store.used[now] = clock
        with store.lock:
            store._evict(now)
        self.assertEqual(sorted({kk[1] for kk in store.loaded}), ['c', 'd', 'e'])     # 範囲が 3 つある版も 1 版と数え、古い 2 版を外す
        self.assertEqual(set(store.used), set(store.loaded))

    def test_failed_areas_leave_no_marks(self):
        store, _, feed = self.make()
        clock = [1_800_000_000.0]
        store.now = lambda: clock[0]
        store.fetch_zip = lambda f, res, dest: (_ for _ in ()).throw(RuntimeError('down'))
        for i in range(5):
            store.get(feed, 20261109, box=bus.area_box([(35.0 + i * 0.3, 135.7)]))
        self.assertEqual((store.loaded, store.used, store.busy), ({}, {}, {}))   # 取れなかった範囲の、使った印は残さない
        self.assertEqual(len(store.failed), 5)
        clock[0] += bus.RETRY_AFTER
        store.fetch_zip = lambda f, res, dest: make_zip(dest)
        store.get(feed, 20261109, box=bus.area_box([ORIGIN, DEST]))
        self.assertEqual(len(store.failed), 0)                                   # 取り直してよくなった失敗の印は消す
        self.assertEqual(set(store.used), set(store.loaded))

    def test_shifted_boxes_do_not_build_forever(self):
        store, _, feed = self.make()
        clock = [1_800_000_000.0]
        store.now = lambda: clock[0]
        boxes = [bus.area_box([(33.0 + i * 0.5, 135.0)]) for i in range(bus.REGIONS)]
        made = [store.get(feed, 20261109, box=b) for b in boxes]
        self.assertEqual(len({id(x) for x in made}), bus.REGIONS)
        clock[0] += 60
        near = store.get(feed, 20261109, box=bus.area_box([(33.0 + bus.REGIONS * 0.5, 135.0)]))
        self.assertIs(near, made[-1])                        # 上限なら新しく作らず、いちばん近い範囲の形を使う
        self.assertEqual(len(store.loaded), bus.REGIONS)
        for b in boxes[1:]:
            store.get(feed, 20261109, box=b)
        clock[0] += bus.REGION_IDLE
        store.get(feed, 20261109, box=boxes[-1])
        fresh = store.get(feed, 20261109, box=bus.area_box([(33.0 + bus.REGIONS * 0.5, 135.0)]))
        self.assertNotIn(fresh, made)                        # 長く使われていない形があれば、入れ替えて作る
        self.assertEqual(len(store.loaded), bus.REGIONS)
        self.assertNotIn(('big', 'current', bus.region_for(boxes[0])), store.loaded)   # 入れ替えたのは、いちばん長く使われていない形

    def test_region_files_are_capped(self):
        store, _, feed = self.make()
        whole = os.path.join(store.dir, 'other-current.idx')
        open(whole, 'wb').close()
        saved = bus.DISK_REGIONS
        bus.DISK_REGIONS = 3
        try:
            for i in range(5):
                store.get(feed, 20261109, box=bus.area_box([(33.0 + i * 0.5, 135.0)]))
                time.sleep(0.01)
        finally:
            bus.DISK_REGIONS = saved
        left = sorted(n for n in os.listdir(store.dir) if bus.REGION_FILE.search(n))
        self.assertEqual(len(left), 3)                       # 古く使った形の作り置きから消す
        self.assertEqual(left, sorted(os.path.basename(store._path(feed, 'current', bus.region_for(bus.area_box([(33.0 + i * 0.5, 135.0)]))))
                                      for i in (2, 3, 4)))
        self.assertTrue(os.path.exists(whole))               # 丸ごとの形の作り置きは消さない
        saved = bus.DISK_CAP
        bus.DISK_CAP = 1
        try:
            store.get(feed, 20261109, box=bus.area_box([(40.0, 140.0)]))
        finally:
            bus.DISK_CAP = saved
        self.assertEqual([n for n in os.listdir(store.dir) if bus.REGION_FILE.search(n)],
                         [os.path.basename(store._path(feed, 'current', bus.region_for(bus.area_box([(40.0, 140.0)]))))])   # 大きさの上限を超えても、今作った物は残す

    def test_small_feed_is_whole(self):
        store, calls, _ = self.make()
        feed = bus.FEEDS[0]
        store.directory = bus.Fixed([feed])
        idx = store.get(feed, 20261109, box=bus.area_box([ORIGIN, DEST]))
        self.assertIn('西の端', idx.stop_name)
        self.assertIsNone(idx.meta['region'])


def make_far_zip(path):
    """別の所の 2 つの停留所だけの時刻表"""
    with zipfile.ZipFile(path, 'w') as zf:
        zf.writestr('stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\nX,遠く1,43.0,141.3\nY,遠く2,43.01,141.31\n')
        zf.writestr('routes.txt', 'route_id,route_short_name\nR,1\n')
        zf.writestr('calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,1,1,20260101,20271231\n')
        zf.writestr('trips.txt', 'route_id,service_id,trip_id\nR,S,T\n')
        zf.writestr('stop_times.txt', 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT,10:00:00,10:00:00,X,1\nT,10:10:00,10:10:00,Y,2\n')


class Sources(unittest.TestCase):
    def test_find_merges_feeds(self):
        tmp = tempfile.mkdtemp()
        a = {**bus.FEEDS[0], 'id': 'a', 'agency': '甲バス', 'name': '甲市', 'title': '甲市営バス', 'license': 'odpt', 'via': 'ODPT'}
        b = {**bus.FEEDS[0], 'id': 'b', 'agency': '甲バス', 'name': '乙町', 'title': '乙町バス', 'license': 'CC BY 4.0', 'via': 'GTFSデータリポジトリ',
             'kind': 'gtfsjp', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/deed.ja'}
        store = bus.Store(tmp, key_fn=lambda: 'k', fetch=lambda f, r, d: make_zip(d), catalog=lambda f: [], directory=bus.Fixed([a, b]))
        trips, used = bus.find(store, ORIGIN, DEST, 20261109, 9 * 60)
        self.assertEqual(len(trips), 1)                     # 同じ名前・同じ時刻の便は 1 つ
        self.assertEqual([(s['name'], s['license']) for s in used], [('甲市', 'odpt')])   # 出典は、返す便の時刻表だけ
        self.assertEqual(trips[0]['source']['name'], '甲市')                              # 便ごとにも、その時刻表の出典
        self.assertTrue(all('fetched' in s and 'licenseUrl' in s for s in used))
        self.assertEqual(bus.find(store, ORIGIN, DEST, 20261109, 20 * 60), ([], []))

    def test_table_credits_only_used(self):
        tmp = tempfile.mkdtemp()
        a = {**bus.FEEDS[0], 'id': 'a', 'name': '甲市'}
        far = {**bus.FEEDS[0], 'id': 'far', 'name': '遠い町'}

        def fetch(f, r, d):
            make_zip(d) if f['id'] == 'a' else make_far_zip(d)
        store = bus.Store(tmp, key_fn=lambda: 'k', fetch=fetch, catalog=lambda f: [], directory=bus.Fixed([a, far]))
        used = []
        tb = bus.door_table(store, [ORIGIN, DEST], 20261109, 600, 720, used=used)
        self.assertEqual(tb[0][1], 16)
        self.assertEqual([i.meta['feed'] for i in used], ['a'])        # 便を出さなかった時刻表は出典に出さない

    def test_trip_mode(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, 'f.zip')
        make_zip(path)
        idx = bus.build(path, bus.FEEDS[0], {'res': 'current', 'fetched': time.time()})
        self.assertEqual(idx.search(ORIGIN, DEST, 20261109, 9 * 60)[0]['mode'], 'bus')

    def test_route_color_as_written(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, 'c.zip')
        make_zip(path)
        with zipfile.ZipFile(path) as zf:
            files = {n: zf.read(n) for n in zf.namelist()}
        files['routes.txt'] = 'route_id,route_short_name,route_color,route_text_color\nR1,２０６,a1B2c3,FFFFFF\nR2,特１７,#00FF00,\n'.encode()
        with zipfile.ZipFile(path, 'w') as zf:
            for n, v in files.items():
                zf.writestr(n, v)
        idx = bus.build(path, bus.FEEDS[0], {'res': 'current', 'fetched': time.time()})
        t = idx.search(ORIGIN, DEST, 20261109, 9 * 60)[0]
        self.assertEqual((t['color'], t['textColor']), ('a1B2c3', 'FFFFFF'))     # 書いてあるとおり（大文字・小文字も変えない）
        other = [x for x in idx.search(ORIGIN, DEST, 20261109, 10 * 60 + 6) if x['route'] == '特17']
        self.assertTrue(all(x['color'] is None for x in other))                  # 「#」付きは GTFS の形ではないので無いものとする
        self.assertIsNone(bus._color('#00FF00'))
        self.assertIsNone(bus._color(''))

    def test_no_color(self):
        path = os.path.join(tempfile.mkdtemp(), 'f.zip')
        make_zip(path)
        t = bus.build(path, bus.FEEDS[0], {'res': 'current', 'fetched': time.time()}).search(ORIGIN, DEST, 20261109, 9 * 60)[0]
        self.assertIsNone(t['color'])
        self.assertIsNone(t['textColor'])

    def test_parts(self):
        path = os.path.join(tempfile.mkdtemp(), 'f.zip')
        make_zip(path)
        t = bus.build(path, bus.FEEDS[0], {'res': 'current', 'fetched': time.time()}).search(ORIGIN, DEST, 20261109, 9 * 60)[0]
        bus.with_parts(t, ORIGIN, DEST)
        p = t['parts']
        self.assertEqual(p['walkTo'][0], [round(ORIGIN[1], 5), round(ORIGIN[0], 5)])
        self.assertEqual(p['walkTo'][-1], [t['board']['lng'], t['board']['lat']])
        self.assertEqual(p['walkFrom'][0], [t['alight']['lng'], t['alight']['lat']])
        self.assertEqual(p['walkFrom'][-1], [round(DEST[1], 5), round(DEST[0], 5)])
        self.assertEqual(p['ride'], t['line'])
        self.assertLess(bus.dist_m(p['ride'][0][1], p['ride'][0][0], t['board']['lat'], t['board']['lng']), 5)

    def test_gtfsjp_version_by_start(self):
        store = bus.Store(tempfile.mkdtemp(), key_fn=lambda: 'k', fetch=lambda *a: None,
                          catalog=lambda f: [{'res': 'uid-old', 'start': '20260401'}, {'res': 'uid-new', 'start': '20261201'}])
        f = {**bus.FEEDS[0], 'kind': 'gtfsjp'}
        self.assertEqual(store.pick(f, 20261109), 'uid-old')
        self.assertEqual(store.pick(f, 20261215), 'uid-new')


if __name__ == '__main__':
    unittest.main()
