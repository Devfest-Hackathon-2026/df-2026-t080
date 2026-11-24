# 実装済み／一部／未実装の表

確認日: 2026-11-24。確認した版: `main` の `af7cba1`（PR #356 まで。11-09 の表に、予選のあとの追加開発〔11-18〜24・PR #263〜#356〕を足した）。公開 URL（Cloud Run）は、この版と同じ中身。
**確認の方法**: コードの存在と中身を読み、PR の説明（確かめたこと）と照らした。**ブラウザでの通しの動作は、例のプランの流れだけ確かめた**: 2026-11-09 19:01 に、本番の公開 URL で、開く → 例のプラン → 候補の特徴と注意点・混む時間帯 → 理由 → 組み直し → バスの便と途中の停留所 → ペンギンの一言 → 振り返り、を通しで撮った（デモ動画）。2026-11-24 に、本番の京都の例を開いて、場所を追加・削除 → 候補の画面 → 便を見る → 場所の画面と、入力の画面（日帰り／泊まり）の言葉を確かめた（新しい旅は作っていない）。ほかの機能と追加開発の機能は、PR ごとの確認による。「できている」と断言できないものは、そう書く。

状態: ✅ 実装済み ／ 🔶 一部 ／ ❌ 未実装 ／ ❓ 未確認

## 機能（旅の流れ）

| 流れ | 機能 | 状態 | 根拠（ファイル） | 補足 |
|---|---|---|---|---|
| 出発前 | 開くとホーム画面（自分の旅）。新しい旅は、行き先を入れたあと「行きたい場所を選ぶ」画面から（AI が候補を出し、人が選ぶ）。入力は「出発地・到着地」で、片道の旅も組める | ✅ | `web/src/components/StartPick.tsx`、`Home.tsx`、`App.tsx` | PR #42・#43・#111・#223。URL を開くといつもホーム画面（旅が無い人も「新しい旅を作成」「京都のデモを試す」から）。`?start=pick` でデモ用に京都の例の選ぶ画面から |
| 旅の管理 | ホーム画面（自分の旅の一覧・開く・作る・消す） | ✅ | `web/src/components/Home.tsx`、`lib/trips.ts` | PR #103・#108・#109。**ログインした状態（クラウドの一覧・別の旅を開く・消す）の画面での通しは、PR の時点で未確認**（Emulator が動かせなかった） |
| 旅の管理 | **Google のログイン（任意）と、旅のクラウド保存**（Firebase Authentication・Firestore） | 🔶 | `web/src/lib/auth.ts`・`firebase.ts`・`firestore.ts`・`trips.ts`、`firestore.rules`、`web/tests/firestore-rules.test.mjs`、`data/auth-and-trips.md` | PR #83。ログインしなくても全部使える。本人の uid の下だけ読み書きできるルール。PR #83 で、Emulator により、ルールの試験 5 件と通しの試験 28 項目を確認。本番で Google のログインと旅の保存が動くのを、2026 年 11 月 10 日にチームが確かめた |
| 画面 | 英語への切り替え（画面・Gemini の文・例のプラン） | ✅ | `web/src/lib/i18n.ts`、`server/sample.en.json`、`server/gemini.py` | PR #58・#75。時刻表に英語名の無い事業者・系統は日本語のまま。iPhone 実機・Pages の公開版は PR の時点で未確認 |
| 画面 | **画面の作り直し**（Meta のデザインシステム Astryx。地は白・欧文と数字は Figtree・押せる高さ 44px・× で閉じるシート） | ✅ | `web/src/themes/intentrip/`、`web/src/astryx-app.css`、`web/package.json`（`@astryxdesign/core`） | PR #232（2026-11-09）。機能・API・保存の形は変えていない。明るい／暗い × 日本語／英語 × 390・375・1440 で撮り、axe のコントラストの違反 68 → 0。調整のシートの「回り方」のボタンは外した |
| 画面 | スマホの「戻る」（いちばん上のシートだけを閉じ、閉じきったら画面を来た順にさかのぼる） | ✅ | `web/src/lib/backStack.ts`、`App.tsx` | PR #187（Issue #174）・#230。「戻る」の試験 日本語 96 項目・英語 49 項目 |
| 出発前 | エリアと希望から、実在する場所の候補を集める（Gemini） | ✅ | `server/places.py`、`server/gemini.py` | Vertex AI。呼び出しの上限あり（`ZT_LLM_PER_HOUR`） |
| 出発前 | **泊まりの旅**（入力の画面の「日帰り／泊まり」。1 行の文から Gemini が行き先・泊数・日付・宿・希望・時刻を読み取る。1 日ずつ組んだプランを 1 つの旅にまとめ、「1日目」「2日目」で切り替える。3 泊 4 日まで。泊ごとの宿。入りきらない場所は次の日に回す） | ✅ | `web/src/components/StayTalk.tsx`・`DayTabs.tsx`、`web/src/lib/days.ts`・`stayTalk.ts`、`server/tripask.py` | PR #267・#271・#273〜#276・#285・#336。本番で 1 泊 2 日・宿ありを 2 日目まで通した（PR の時点）。読み取りは 8 秒・15 秒で打ち切ってやり直す |
| 出発前 | 車（レンタカー）で回る旅（入力の画面の「車で回る」。電車・バスを使わず、徒歩と車） | ✅ | `web/src/lib/carTrip.ts`、`server/adjust.py`、`server/places.py`（`WISH_KM_CAR`） | PR #288・#289 |
| 出発前 | 候補を検索している間の待ち画面に、行き先の見どころとお店（5 件まで。Gemini と Places は新しく呼ばない） | ✅ | `server/preview.py`、`WaitSpots.tsx` | PR #269・#270。初めてのエリアでは、先に届いた候補の答えから出す |
| 出発前 | 都道府県の名前だけの出発地を、県庁所在地の玄関口の駅にする | ✅ | `server/places.py`（`GATEWAYS`・`geocode`） | PR #280・#284 |
| 出発前 | 位置を確かめられなかった候補を、一覧とおまかせのプランに出さない。Google マップで臨時休業・閉業になっている場所を、候補から外す（希望に名指しした場所は除く） | ✅ | `server/places.py`（`unfound`）、`server/gplaces.py`、`web/src/lib/planner.ts` | PR #264・#341 |
| 出発前 | 候補ごとの「特徴」と「注意点（欠点）」の提示 | ✅ | `CandidateSheet.tsx`、`StopSheet.tsx`（`spot.why`・`spot.downside`） | AI の提案を鵜呑みにせず、欠点を見て選べる |
| 出発前 | 混雑の推定（時間帯ごと）と、混雑を避けた時間割 | ✅ | `web/src/lib/crowd.ts`、`planner.ts`、`CrowdMark.tsx`、`HourBars.tsx`、`Compare.tsx` | 混雑は Gemini の推定（実測ではない）。時刻の計算と順番は、規則で行い、Gemini にさせない（`planner.ts`） |
| 行き先決め | 選んだ理由を、定型＋一言で残す | ✅ | `web/src/lib/why.ts`、`WhyField.tsx`、`StopWhy.tsx`、`CandidateSheet.tsx` | PR #15。ブラウザの `localStorage` のみ。サーバーに送らない |
| 行き先決め | 場所の入れ替え・外す・順番の変更。入れ替える前に確認 | ✅ | `StopSheet.tsx`、`PlacePicker.tsx`、`App.tsx` | PR #45 |
| 行き先決め | プランへの頼み（「最後は嵐山に寄りたい」など）を、画面の操作に置き換える | ✅ | `server/adjust.py`、`AdjustSheet.tsx` | 操作は 8 個まで、入力の長さを制限して検証（`adjust.py` の `clean`） |
| 行き先決め | 希望に名指しした場所（「太宰府に行きたい」など）を、必ずプランに入れる | ✅ | `server/places.py`、`server/app.py` | PR #225 |
| 行き先決め | 旅の幸福の研究を、組み方と画面に入れる（締めくくり・ゆとり・楽しみ・ミッション） | ✅ | `planner.ts`、`LookForward.tsx`、`data/happiness-in-app.md` | PR #44。出典を確かめた研究のみ（`data/travel-happiness-research.md`） |
| 移動 | バス・電車の本物の便と、目安の移動時間（ODPT の時刻表）。地図に、乗る区間を路線の色、歩く区間を点線で描く | 🔶 | `server/bus.py`、`bus_feeds.py`、`bus_catalog.json`、`web/src/lib/bus*.ts`、`BusSheet.tsx`、`BusCredit.tsx` | PR #38・#52・#56・#59・#61・#64。時刻表があるエリアのみ。**金沢・鎌倉・奈良・大阪などは時刻表が無く、電車は OpenStreetMap の路線と駅からの目安（路線・乗る駅・降りる駅・約何分。発車の時刻は無い）、バスは式の目安**（`server/rail.py`）。電車は乗換なしの 1 路線のみ |
| 移動 | 乗換案内のスクリーンショットから、区間の実際の経路を取り込む | ✅ | `server/transit.py`、`TransitSheet.tsx`、`TransitSteps.tsx` | Gemini の画像認識 |
| 移動 | 時刻表の無いエリア（大阪・鎌倉など）の、乗換なしの電車の目安（OpenStreetMap の路線と駅。路線名・乗る駅・降りる駅・約何分。発車の時刻は無い） | ✅ | `server/rail.py`、`web/src/lib/busTable.ts`、`lib/geo.ts`、`BusSheet.tsx` | PR #150・#151・#152・#268。時刻表のあるエリアでも、便の無い組みはこの目安で埋める（#268）。路線は Overpass API から範囲ごとに 1 回取って作り置き。大都市は取れないことがあるので、大阪の路線の種を同梱（`server/rail_seed/`） |
| 移動 | バスの便の、途中の停留所と何停目で降りるか（時刻つき） | ✅ | `server/bus.py`、`BusSheet.tsx`、`TransitSteps.tsx` | PR #221 |
| 移動 | 区間ごとに、徒歩か電車・バスかを選ぶ | ✅ | `LegMode.tsx`、`web/src/lib/geo.ts`、`App.tsx` | PR #213・#218 |
| 地図 | 乗る駅・降りる駅の印と名前。歩く所を道に沿った点の線で描く | ✅ | `web/src/lib/legPieces.ts`、`lib/mapLayer.ts`、`lib/walkDots.ts`、`mapShared.ts` | PR #153・#215・#217・#222 |
| 移動 | Google マップを開く（区間・場所） | ✅ | `MapsLink.tsx`、`web/src/lib/geo.ts` | iPhone の Chrome など、アプリを直接開く工夫あり（PR #2） |
| 地図 | MapLibre と、Google マップ（キーがあれば）の両対応 | ✅ | `MapView.tsx`、`GoogleMapView.tsx`、`lib/gmaps.ts`、`lib/mapLayer.ts` | PR #14・#19・#31 |
| 場所の情報 | Google の写真・評価・営業時間（Places API） | ✅ | `server/gplaces.py`、`GooglePlace.tsx` | 本番で有効（2026-11-07 に、本番の「この付近を検索」が Places の結果を返すのを確かめた）。Google マップが地図のときだけ表示し、保存は `place_id` と緯度経度（30 日まで）だけ |
| 場所の情報 | 候補の一覧の小さな写真（画面に見えている行だけ Places から） | ✅ | `server/gplaces.py`、`web/src/lib/place.ts`、`Thumb.tsx` | PR #286。専用の枠（1 時間 150・1 日 300。`ZT_PLACES_LIST_PER_HOUR`・`_DAY`）。京都の例では頼まない（例の写真は、同梱の Wikipedia・Wikimedia Commons ほかの自由な写真。PR #290 で 4 か所を足した） |
| 場所の情報 | 地図に写っている範囲の店などを探す「この付近を検索」（Places の Text Search。結果は保存しない。候補にある店はプランに入れられる） | ✅ | `server/gplaces.py`（`area_search`）、`AreaSearchSheet.tsx`、`GoogleMapView.tsx` | PR #154・#209。専用の枠（1 日 100 回・1 人 1 時間 10 回）。Google マップが地図のときだけ |
| 計画 | 営業時間を守る時間割（開店前の待ち・閉店後に着く注意） | 🔶 | `server/places.py`（`open`・`close`）、`web/src/lib/planner.ts` | **営業時間は、Gemini が候補を出すときの推定で、実測ではない。** 取れなかった場合は 9:00〜17:00 にする。Places API の営業時間は、場所の画面に見せるだけで、時間割には使っていない。閉まる時刻の注意は「〇〇に営業終了（目安）」と出す（2026-11-24 の画面。「営業開始まで」には「（目安）」が付いていない） |
| 計画 | 混む時間を避ける効果の確かめ（「よくある回り方」との比べ。8 エリア 128 通り・京都の例のデータ 108 通り） | 🔶 | `submission/eval/`（台本・結果・`README.md`） | 2026-11-10（PR #250 の計画の部品・#251 の比べの判定）。8 エリアで、混雑と推定される時間帯の滞在（Gemini の推定）が 1 プランごとの中央値で 34% 減り、平均 67 分→41 分。減った 50%・同じくらい 45%・長くなった 0。8 エリアは移動を式で見積もった。**推定どうしの比べで、実測ではない**。測れるのは回る順と時刻の効果だけ。京都の例の大きな減り（本番の画面で 1時間40分 → 1分）は 7:30 発のためで、休日に 9:00 以降に出ると同じくらい。混雑の推定そのものは、京都の 5 地点で京都市観光協会の公開の予測と照らした（55 コマ中 44 コマで混雑かどうかが一致。合わないのは夕方。`submission/eval/crowd-check.md`）。 |
| 旅の最中 | ミッション（Gemini が場所に合わせて 1 つ）と、写真を撮って記録 | ✅ | `server/odai.py`、`web/src/lib/odai.ts`、`Odai.tsx`、`web/src/data/odai.json` | プランを変えるとミッションが追従（PR #37）。写真は端末内に保存 |
| 旅の最中 | 最初のミッションの前に、難しさを選ぶ | ✅ | `Odai.tsx`、`App.tsx` | PR #206 |
| 旅の最中 | 天気・服装の目安 | ✅ | `lib/weather.ts`、`WearCard.tsx`、`WeatherIcon.tsx` | Open-Meteo。ペンギンの一言を開いても消さずに出す（PR #353） |
| 旅の最中 | ペンギンの一言（プランに合わせた注意とその場でできること。閉まる時刻・混み方・日の入り・予約・足元など） | ✅ | `server/penguin.py`、`lib/penguin.ts`、`PenguinNote.tsx` | PR #183・#354。Gemini を 1 回呼ぶ（同じプランは作り置き）。服装と天気は服装の目安の札だけが出し、ペンギンの一言には書かせない（#354）。頼みの文は `prompts.md` の 6 章 |
| 旅のあと | **振り返りカード（理由と写真を並べ、画像で保存）** | 🔶 | `web/src/lib/recap.ts`、`web/src/components/Recap.tsx`、`lib/cardImage.ts` | **PR #55 で `main` に入った**（issue #12）。カードの描画は、実際の Chrome で確認。アプリ本体での通しの操作と、実機（iPhone の Safari での共有・保存）は未確認 |
| 旅のあと | 地図とスケジュール全体を 1 枚の画像で保存して共有 | 🔶 | `web/src/lib/planImage.ts`、`ShareMenu.tsx` | PR #65・#79（issue #49）。OSM の下地の地図と 1 列のスケジュール。**iPhone 実機での共有の画面は未確認**。CC BY の時刻表の便は未確認（作り物で試した） |
| 移動 | 徒歩の区間に、距離と坂の線・言葉（なだらかな上り など）を出す | ✅ | `web/src/lib/slope.ts`、`lib/walkDist.ts`、`server/elev.py`、`ElevCredit.tsx`、`RouteList.tsx` | PR #63・#216。標高は国土地理院の標高タイル、距離は道に沿った線の長さ |
| 画面 | 混雑の記号（前後に重なったペンギンの群れ 1〜5 羽） | ✅ | `web/src/components/CrowdMark.tsx` | PR #53 |
| 画面 | 画面の日本語を、Apple と Google のアプリの言い方にそろえる（「新しい旅を作成」「候補を検索」「プランに追加」「場所を追加・削除」など） | ✅ | `web/src/` の各画面の `tr({ ja, en })` | PR #265 ほか |

## 品質・運用（審査軸 2c「安全性・拡張性・保守性」の材料）

| 観点 | 内容 | 状態 | 根拠 |
|---|---|---|---|
| 秘密情報 | キー・トークンを、リポジトリに入れない。`.env` は git に入れない。全履歴を確認した | ✅ | `.gitignore`、`.env.example`、2026-11-06 の履歴の確認 |
| 呼び出しの上限（費用の歯止め） | Gemini・Places・時刻表の呼び出しに、1 時間あたりの上限 | ✅ | `server/app.py`（`Limited`、`ZT_LLM_PER_HOUR`・`ZT_LLM_PER_DAY`）、`gplaces.py`（`ZT_PLACES_PER_HOUR`）、`bus.py`（`ZT_BUS_PER_HOUR`）。PR #77・#104 で、1 人が枠を使い切る穴を塞いだ |
| 入力の検証 | リクエストの大きさの上限、`place_id` などの形式の検証、Gemini の返す操作の検証 | ✅ | `server/app.py`（`do_POST` のサイズ制限）、`gplaces.py`（`PLACE_ID` 等）、`adjust.py`（`clean`） |
| 縮退（失敗時の動き） | Gemini・Places・時刻表が使えないとき、今までの動作に戻る | ✅ | `gemini.py`（`Skip`）、`gplaces.py`（`Off`）、`bus.py` |
| テスト | サーバーの試験 491 本（2026-11-24 の `main`・`af7cba1`）（`python -m unittest discover -s tests`。時刻表・ミッション・入力の守り・言語・Places・標高・泊まりの旅の読み取り・電車の路線ほか。外の API は試験の中で差し替えるので、鍵もネットワークも要らない）。画面は型チェックと、CI で回す 4 つの試験（`web/tests/` の `geo-cutoff`・`line-edge`・`photo-load`・`quiet-hint`。25 項目）。ほかに、Firestore のルールの試験（`firestore-rules.test.mjs`、Emulator が要るので CI の外）など、手で回す試験が `web/tests/` にある | ✅ | `server/tests/`、`web/tests/` | `af7cba1` の CI（2026-11-23）で、サーバー 491 本が通過（3 本は、京都市バスの GTFS の zip が無いと省略）、画面の 25 項目が通過 |
| CI | PR と `main` への push で、画面の型チェック・ビルド・試験、サーバーの構文と試験（491 本）、Dockerfile の組み立て | ✅ | `.github/workflows/ci.yml` | 提出先の Organization では GitHub Actions が使えないので、CI は開発用のリポジトリで回す。設定のファイルは、提出用リポジトリにも入れる（中身を読めるように） |
| 継続的デプロイ | `main` から Cloud Run への自動デプロイ | ✅ | `main` への更新のたびに、Cloud Build のトリガーがビルドして Cloud Run に置き直す（2026-11-07 に Cloud Build の履歴で確認）。ビルドの取りこぼしと、続けたマージで古い版が後に入ることがあったので、提出の前に、本番の Cloud Run のイメージのコミットと、Cloud Build の結果を確かめる |
| ログ・監視（observability） | 構造化ログ・稼働監視 | ❌ | 標準出力の `print` のみ（Cloud Run のログには出る）。稼働監視（uptime check）は未設定 |
| スケーラビリティ | 最大インスタンス数 1。ジョブの状態はメモリ、作り置きはファイル | 🔶 | `server/app.py`。**複数台に増やすと、ジョブの状態と回数の上限を見失う。限界として明記する。**旅の保存は Firestore に入ったが（上）、ジョブの状態は、まだメモリ（未実装） |
| 開発の記録 | 判断の理由を PR に残す | ✅ | PR #1〜#356 の説明 |

## インフラ（必須条件）

| 項目 | 状態 | 根拠 |
|---|---|---|
| 実行基盤 Cloud Run（`asia-northeast1`）で公開 | ✅ | 公開 URL が 200 を返し、`/api/health` も `ok`。2026-11-09 に、PR #232（画面の作り直し）が本番に入ったことを、Cloud Build の結果と、本番で撮ったデモ動画（画面の JS の版）で確かめた。2026-11-24 に、本番が `main` の `af7cba1`（PR #356）と同じ中身であることを確かめた |
| AI は Vertex AI（Gemini）。他社の AI は製品に使っていない | ✅ | `server/gemini.py` |
| Google 技術: Gemini（Vertex AI）、Cloud Run、Maps JavaScript API、Places API（本番で有効）、Firebase Authentication・Firestore（本番でログインと旅の保存が動くのを 2026 年 11 月 10 日に確かめた） | ✅ | 上記 |
| デプロイ URL を、2026 年 11 月 27 日（金）の Demo Day の終わりまで、追加開発の締切（11 月 24 日）の時点の状態のまま動かし続ける | ❓ | クレジット残高と、Cloud Run の稼働の確認が要る |

## この表の限界

- 「✅」は、コードがあり、PR で確かめた記述があることを指す。**最新の `main` を、ブラウザと実機で通しで試した結果ではない。** 提出の前に、デモの流れ（開く → 候補と注意点 → 理由を書いて選ぶ → 時間割と便 → ミッションと写真 → 振り返り）を、実機で通しで確認して、表を更新する。
- この更新（2026-11-07）は、PR #53〜#112 の説明と、コード・公開 URL の確認による。ブラウザでの再確認はしていない。
- 2026-11-24 の更新（追加開発の行と数字）は、PR #263〜#356 の説明とコード、CI の結果、本番の京都の例を読むだけで開いた確認による。泊まりの旅・車で回る旅・待ち画面は、この日には本番で新しく通していない（PR の時点の確認による）。
