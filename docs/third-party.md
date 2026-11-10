# 著作物利用シートの下書き（使った素材・ライブラリ・データの出典とライセンス）

確認日: 2026-11-07（PR #112 までの `main` を反映。そのあとに入った物は、各行に書き足した）。この文書は、項目を**名前・用途・ライセンス・表示の要否・画面での表示・確認状態**で整理した下書き。提出した著作物利用シート（運営の指定様式。列は No.・著作物の名称・種類・入手元URL・権利者名・ライセンス形態・改変の有無）は、この内容を写したもの。
**確認状態**: ✅ 確認済み（コード・パッケージ情報・資料で確かめた）／❓ 未確認（一般に知られているが、この作業では原資料を確かめていない）／⚠️ 要対応（表示などが足りない可能性）。

## 1. ライブラリ

### 画面（`web/package.json`、`pnpm licenses list --prod` で確認）

| 名前 | 用途 | ライセンス | 確認 |
|---|---|---|---|
| React・React DOM（19.3.1） | 画面 | MIT | ✅ |
| maplibre-gl（6.16.0） | 地図の描画（キーが無いとき） | BSD-3-Clause | ✅ |
| 上記の依存（`@mapbox/*`、`@maplibre/*`、`earcut`、`gl-matrix`、`bidi-js` ほか） | 地図の描画 | MIT／ISC／BSD-2-Clause／BSD-3-Clause／(MIT OR Apache-2.0) | ✅（種類のみ） |
| **firebase**（JS SDK。^13.2.0。Google のログインと旅の保存） | Firebase Authentication・Firestore の呼び出し | 一般に Apache-2.0 | ❓（`pnpm licenses` は「Unknown」と表示。公式で確認する） |
| **Astryx**（`@astryxdesign/core`・`@astryxdesign/theme-neutral` 0.7.11。Meta のデザインシステム） | 画面の部品と見た目（PR #232。Neutral を土台に、IntenTrip のテーマ `web/src/themes/intentrip/` を作った） | MIT | ✅（2026-11-09、ロックファイルの版とパッケージのライセンス） |
| `@stylexjs/stylex`（0.19.1）と依存（`styleq`・`invariant`・`css-mediaquery`） | Astryx の見た目の仕組み | MIT（`css-mediaquery` は BSD） | ✅（同上） |
| `lucide-react`（1.70.0） | Astryx の部品のアイコン | ISC（Feather 由来の部分は MIT） | ✅（同上） |
| FormatJS（`intl-messageformat` 11.2.15・`@formatjs/*`） | Astryx の文言の仕組み | BSD-3-Clause（`@formatjs/*` は MIT、`tslib` は 0BSD） | ✅（同上） |
| Vite・@vitejs/plugin-react・TypeScript・@types/react・@types/google.maps・Astryx CLI（`@astryxdesign/cli` 0.7.11。テーマの組み立て） | ビルドと型（製品には含まれない開発用） | 一般に MIT／TypeScript は Apache-2.0／Astryx CLI は MIT | ❓（Astryx CLI は ✅） |

### サーバー（`server/requirements.txt`）

| 名前 | 用途 | ライセンス | 確認 |
|---|---|---|---|
| google-genai | Gemini（Vertex AI）の呼び出し | 一般に Apache-2.0 | ❓ |
| Python 標準ライブラリ（`http.server`、`urllib` ほか） | サーバー、外部 API の呼び出し | PSF License | ❓ |

## 2. データ・外部サービス（API）

| 名前 | 用途 | 利用条件・ライセンス | 表示の要否 | 画面での表示（現状） | 確認 |
|---|---|---|---|---|---|
| **公共交通オープンデータセンター（ODPT）**の時刻表（バス・電車） | 便と、目安の移動時間（`server/bus.py`） | **公共交通オープンデータ基本ライセンス**（出典の表示が必要）。**使うのは、出典表示で済むライセンスの時刻表だけ**（CC BY-SA・ODbL・NC、チャレンジ限定、事前承認が要るものは使わない）。7 日で取り直す。丸ごと取れる形にしない（1 回 3 便まで、回数の上限） | 要（事業者・版・ライセンス・正確性を保証しない旨・問い合わせ先） | ✅ 出す（`BusCredit.tsx`、シートの下とプランの下） | ✅（PR #38・#52 の説明とコード） |
| **Google Maps Platform**（Maps JavaScript API） | 地図（キーがあるとき） | Google Maps Platform の利用規約 | 要（Google の地図に組み込みの帰属表示） | ✅ 地図に組み込み（実機で目視は未） | ❓ |
| **Google Maps Platform**（Places API (New)） | 写真・評価・営業時間・位置、地図に写っている範囲の検索（この付近で検索。Text Search の `locationRestriction`。結果は保存しない）（`server/gplaces.py`） | Places の規約。Google 以外の地図と一緒に使えない。保存してよいのは `place_id`（期限なし）と緯度経度（30 日まで）だけ | 要（写真の投稿者名と、Google マップの帰属） | ✅ 出す（`GooglePlace.tsx`）。Google マップが地図のときだけ表示 | ✅（PR #17・#22 の説明とコード）。本番で有効かは未確認 |
| **Vertex AI（Gemini）** | 候補・混雑の推定・ミッション・頼みの解釈・画像の読み取り | Google Cloud の利用規約 | — | ✅ Gemini が作った文に記号を付ける | ✅ |
| **OpenFreeMap** と、地図データ（© OpenStreetMap contributors、OpenMapTiles） | 地図のタイルとスタイル（MapLibre） | 地図データは ODbL。OpenFreeMap の利用条件に従う | 要（帰属表示） | ✅ 地図の帰属表示を出す設定（`attributionControl: { compact: true }`。目視は未） | ❓ |
| **OSRM**（`routing.openstreetmap.de` の公開サーバー） | 徒歩・車の移動時間と経路の線（`server/enrich.py`） | 経路データは OpenStreetMap（ODbL）。公開サーバーの利用方針に従う（大量利用は想定されていない） | 要（OSM の帰属） | ✅ 「経路と位置: © OpenStreetMap contributors」を、プランと候補の一覧の下に出す（PR #57）。回数は 1 つずつ・1 秒あけて送る | ❓（FOSSGIS の規約の全文は読めていない） |
| **Overpass API**（`overpass-api.de`）と、OpenStreetMap の路線と駅（© OpenStreetMap contributors） | 時刻表の無いエリアの、乗換なしの電車の目安（`server/rail.py`） | データは **ODbL**。Overpass の公開サーバーの利用方針（1 日 1 万回・1 GB まで、定期的な利用はその 100 分の 1、並列にしない、名乗る、429 のあとは間をあける。商用は自前か有料のサーバー）に従う。範囲ごとに 14 日の作り置き・1 度に 1 つ・5 秒あける・1 日 100 回まで。名乗りは `IntenTrip/1.0` | 要（OSM の帰属と ODbL） | 出す（画面の出典の表示は本体が作る） | ✅（Overpass API の wiki と openstreetmap.org/copyright・OSMF の帰属の指針の原文、2026-11-07） |
| **Nominatim**（OpenStreetMap） | 位置の確認（`server/places.py`） | OpenStreetMap の Nominatim 利用方針（1 秒に 1 回まで、User-Agent の指定、大量利用の禁止） | 結果をそのまま表示しないため、基本は不要 | — | ✅（PR #57 で、1 秒に 1 回・1 つずつを確認し、User-Agent を `IntenTrip/1.0` にそろえた） |
| **Wikipedia / Wikimedia Commons** の写真 | 場所の写真（Places が無いとき・一覧）（`server/enrich.py`） | **写真ごとにライセンスが違う**（CC BY-SA、パブリックドメインなど）。著作者・ライセンスの表示が必要なものが多い | 要（写真ごと） | ✅ 「写真: 作者・ライセンス（Wikimedia Commons）」を出す。Commons の API から作者・ライセンスを取り、**CC BY・CC BY-SA・CC0・パブリックドメインだけ**を使う（それ以外は、種類のアイコンに戻る。PR #57） | ✅（PR #57 の説明）。写真を枠に合わせて切って見せることが改変に当たるかは、判断が分かれうる |
| **Wikidata**（`query.wikidata.org` の SPARQL） | 記事の写真が無い場所の、代表の写真（P18）と位置の引き当て（`server/enrich.py`） | 項目のデータは **CC0**（パブリックドメイン）。Wikidata Query Service の利用方針（User-Agent で名乗る、同じ住所から同時に 5 本まで、1 分あたり処理 60 秒まで、429 のあとは `Retry-After` だけ待つ）に従う。1 エリアで 1〜3 回（名前を 60 件ずつまとめる）・Wikipedia と同じ順番待ちで 1 つずつ 2.5 秒あける。名乗りは `IntenTrip/1.0` | データは不要。写真は上の「Wikipedia / Wikimedia Commons」と同じく写真ごと | ✅ 写真は Commons の作者・ライセンスを出す（上と同じ） | ✅（Wikidata:Licensing と Wikidata Query Service の User Manual の原文、2026-11-08） |
| **Open-Meteo** | 天気予報・体感温度（`web/src/lib/weather.ts`） | 非商用は無料。データは CC BY 4.0（帰属の表示が必要） | 要 | ✅ 出す（`WeatherCredit.tsx`。「天気: Open-Meteo.com・CC BY 4.0」、PR #57） | ❓（規約の原文は未確認）。データの元（気象庁など）の出典が要るかは未調査 |
| **国土地理院の標高タイル（地理院タイル）** | 坂の上り下り（`server/elev.py`） | 出典を示せば使える（加工したことも書く） | 要 | ✅ 出す（`ElevCredit.tsx`、坂のデータを使ったプランのとき。PR #63） | ✅（PR #63 の説明）。規約の原文は未確認 |
| **Firebase Authentication・Cloud Firestore** | Google のログイン（任意）と、旅のクラウド保存（`web/src/lib/auth.ts`・`trips.ts`） | Firebase の利用規約 | — | — | ✅（PR #83）。保存するのは uid と旅の中身だけ（名前・メールアドレスは保存しない） |

## 3. アイコン・ロゴ・画像

`web/src` の `<svg`・path の文字・Canvas の描画を、すべて調べた（2026-11-07、Issue #118）。既存のアイコン集かどうかは、アイコン集の SVG（`lucide-static` 1.70.0 と 0.469.0、`@tabler/icons` 3.50.0、`feather-icons` 4.29.2、Google の `material-design-icons` の原本、Material Symbols、MDI、Heroicons、Phosphor、Bootstrap Icons）と、path を絶対座標・小数 2 桁にそろえて比べた。どれとも一致しなかった物は、形が最初に入った commit と作業の記録で、誰が座標を書いたかを確かめた。

| 対象 | 出典・作者 | ライセンス | 確認 |
|---|---|---|---|
| Lucide の形のアイコン: `GeminiMark`（sparkles）、`MapsLink`（external-link）、`ModeIcon`・`lib/modeShape.ts`（bus・train-front・footprints。プランの画像の Canvas にも描く）、`Sheet`・`StopSheet` の矢印（chevron-left・chevron-right）、`WeatherIcon`（sun ほか 8 つ）、場所の種類のアイコン `lib/kindIcon.ts`（trees・landmark・store・utensils・coffee。一覧の写真の無い場所 `Thumb` と、地図の候補の印 `lib/mapLayer.ts` に使う）、`MapTools` の全画面（maximize-2・minimize-2） | **Lucide**（https://lucide.dev）。著作権は Lucide Icons and Contributors（一部は Feather に由来、Cole Bemis）。landmark・store・sparkles は v0.469.0 の形（今の版とは形が違う） | ISC（Feather 由来の部分は MIT） | ✅（コードのコメントと、path の一致） |
| 場所の種類のアイコン（`lib/kindIcon.ts`）の鳥居。一覧の写真の無い場所 `Thumb` と、地図の候補の印 `lib/mapLayer.ts` に使う | **Tabler Icons**（https://tabler.io/icons）の torii。著作権は Paweł Kuna | MIT | ✅（コードのコメントと、path の一致） |
| 地図の所要時間の札のアイコン（`lib/mapLayer.ts` の `ICON`。徒歩・電車・バス） | **Material Icons**（https://fonts.google.com/icons?icon.set=Material+Icons）の directions_walk・train・directions_transit。著作権は Google | Apache License 2.0（https://github.com/google/material-design-icons） | ✅（Google のリポジトリの原本と path の文字が一致。PR #8 の commit 3a0d136 の本文にも記載） |
| 星の評価（`GooglePlace.tsx` の `STAR`） | **Feather**（https://feathericons.com）の star を 0.94 倍にした形。座標は Claude が書き直したもので、path の文字は一致しないが、角の点が 0.03 以内で重なる。著作権は Cole Bemis | MIT | ✅（形の重ね合わせ） |
| 「Google でログイン」のボタンの G のロゴ（`GoogleMark.tsx`。ホーム画面・アカウント・保存の勧め） | **Google** が「Sign in with Google」のブランドの決まりで配っている G のロゴ（https://developers.google.com/identity/branding-guidelines）。著作権・商標は Google LLC | ブランドの決まりに従って使う（形と色は変えない） | ✅（PR #234） |
| 混雑の記号のペンギン（`CrowdMark.tsx` の `BODY`・`BELLY`・`FLIPPER`・`BEAK`・`FEET`・目の円・群れの並べ方 `LAYOUT`）と、調整の「Gemini に頼む」の 1 羽（`PenguinMark`。同じ形） | **AI が生成（Claude）**。Claude が作った見本の中から、作者（Omupp）が形を選んだ。群れの並べ方（後ろの列の頭が前の列の上からのぞく）は、万博のゲートの混雑の表示を参考にした（参考にしたのは並べ方だけ） | — | ✅（どのアイコン集とも一致しない。commit 5e01140・1b03341 の本文と、見本の記録） |
| 「戻る」の矢印（`HomeButton.tsx`） | **AI が生成（Claude）**。Lucide の chevron-left と同じ 45° の山形で、大きさが違う（path は一致しない） | — | ✅（commit c3b7f72） |
| 並べ替えのつまみの 3 本線（`RouteList.tsx`） | **AI が生成（Claude）**。Lucide の menu・Tabler の menu-2 と同じ種類の形だが、長さと間隔が違い、一致しない | — | ✅（commit d8f9c0b） |
| 地図の「全体を表示」（`MapTools.tsx` の 2 つ目） | **AI が生成（Claude）**。Tabler の maximize・border-corners に似るが、角が丸くなく、一致しない | — | ✅（commit 2215302） |
| 地図の「現在地」（`MapTools.tsx` の 3 つ目） | **AI が生成（Claude）**。Material Icons の near_me・Lucide の navigation に似るが、一致しない | — | ✅（commit 99bd43a） |
| プランの画像（`lib/planImage.ts`）・振り返りカード（`lib/recap.ts`）の Canvas の描画 | **AI が生成（Claude）**。描くのは線・円・角の丸い四角・文字と、使う人が撮った写真だけ。乗り物のアイコンは上の Lucide、プランの画像の下地の地図は OpenFreeMap・© OpenStreetMap contributors（「2」） | — | ✅（コードを読んで確認） |
| ファビコン・アプリアイコン（`web/public/`。「路線図と IT モノグラム」） | **Google の Antigravity（AI エージェント）が生成**（v76nl より） | 生成物の利用条件は未確認。第三者の素材を含まない見込み | ❓ |
| 構成図（`docs/architecture.png`、ダーク版も。main @ 6120b8a の構成） | 図の作成ツール **stack-diagram**（MIT）で作成（PR #18・#76・#102 の図も同じツール）。Google Cloud の製品は、Google が配る **Google Cloud の公式アイコン**（core products・category icons。作成時に services.google.com から取得）。ほかのロゴは、各社の公式ロゴを取得（svgl・Wikimedia Commons・MapLibre のリポジトリ）。抽象的な物（planner・地図タイル・天気・時刻表・標高）は **Lucide**（ISC）。**ロゴは、各社の商標・著作物** | ツールは MIT。ロゴは各社の商標で、構成図で技術を示す目的の使用。Google Cloud のアイコンは、構成図や資料での使用のために配られている（ツールの説明による。Google の原資料は未確認） | ❓ |
| 構成図に出ているロゴ | Google Cloud（Cloud Run・Vertex AI・Cloud Build・Firestore・Google Maps Platform の公式アイコン）、React、MapLibre GL、Firebase、GitHub、OpenStreetMap、Wikipedia。利用者・planner・GitHub Pages・OpenFreeMap・Open-Meteo・ODPT・GTFS・国土地理院は、ロゴではなく汎用の絵（Lucide・stack-diagram の利用者の絵） | 各社・各団体の商標・ロゴ | ✅（図から読み取り） |

## 4. フォント

欧文と数字は **Figtree** を Google Fonts から読み込む（`web/index.html`。PR #232 から）。和文は端末の字（ヒラギノ・Noto Sans JP など）で、フォントのファイルは配らない。PR #232 までは、日本語に M PLUS 2、時刻と数字に Barlow Semi Condensed（どちらも SIL Open Font License 1.1）を読み込んでいた。プランの画像・振り返りカードの Canvas（`lib/cardImage.ts`）は今もこの 2 つの名前で字を指定しているが、読み込まなくなったので、端末の字で描かれる。確かめた原文は、Google Fonts の配信元の google/fonts リポジトリの `OFL.txt` と `METADATA.pb`（Figtree は 2026-11-09、M PLUS 2・Barlow は 2026-11-07）。

| 名前 | 用途 | ライセンス | 著作権者・デザイナー | 確認 |
|---|---|---|---|---|
| **Figtree** | 欧文と数字（画面） | SIL Open Font License 1.1 | Copyright 2022 The Figtree Project Authors（https://github.com/erikdkennedy/figtree）。デザイナーは Erik Kennedy | ✅（https://github.com/google/fonts/tree/main/ofl/figtree の OFL.txt・METADATA.pb） |

OFL 1.1 では、フォントを使って作った物（画面・画像）は、このライセンスに縛られない（条件 5）。禁じられているのは、フォントだけを売ることなど（条件 1）。このアプリはフォントのファイルを配らず、Google Fonts から読み込むだけ。

## 5. 自作・チームが作った素材

| 名前 | 作者 | 備考 |
|---|---|---|
| ミッションの例 25 個（`web/src/data/odai.json`） | @karinkamonohashi | 場所の種類ごとに 5 つ。Gemini がミッションを作る際の例として使う（PR #44 で、言い方を調整） |
| 選んだ理由の定型（`web/src/lib/why.ts`） | チーム | 「人が少なそう」など 5 つ |
| 旅の幸福の研究を反映した規則 | チーム（Claude と作成） | 出典を確かめた研究だけを、規則として反映。出典の一覧は `data/travel-happiness-research.md`、反映の説明は `data/happiness-in-app.md`。画面に、論文の文章を転載していない |
| 例の京都のプラン（`server/sample.json`） | 生成物（Gemini・Places の `place_id`・Wikipedia の写真のデータを含む） | 写真は、上の「Wikipedia」の扱いに従う。Places の評価・営業時間・写真は含まない |

## 6. 要対応（提出の前に確かめる・直すこと）

優先度の高い順。**2026-11-07 に、PR #57 で、旧 1〜3（Open-Meteo・Wikipedia・OSRM／Nominatim）は対応済みと分かった。**

1. ~~アプリ内の `<svg` の出典を、すべて確かめる~~ → 2026-11-07 に確かめ、各コードのコメントと「3」に書いた（Issue #118）。
2. **Antigravity が生成したアイコンの利用条件**、**firebase の SDK のライセンス**を確かめる（フォントのライセンスは 2026-11-07 に確かめた。「4」）。
3. 構成図が、運営の要件「Google Cloud 公式のアイコン」を満たすか（今の図は、Google Cloud・Firebase・Maps・Gemini のアイコンを使っているが、公式の配布物かは未確認）。
4. 地図の帰属表示（OpenFreeMap／OpenStreetMap、Google）と、Open-Meteo・Wikipedia・国土地理院の出典を、**実機で目視**して確かめる（PR の時点で、iPhone の大きさで撮って確認したものはある）。
5. **共有する画像**（プランの画像・振り返りカード）の出典の扱い。OSM の下地には出典を入れてある（PR #79）。時刻表の便は、ライセンスに合わせて、共有の画像では「バス N分」だけにしてある。
6. Wikipedia の写真を、CSS で枠に合わせて切って見せることが、改変に当たるか（PR #57 で、判断が分かれうると記載）。

## 7. スライドとデモ動画で使った物

スライドとデモ動画は、提出物として別に出す（アプリには入らない）。画面の写しに写る地図・写真・データは、上の「2」の扱いのまま（Google の地図の表示・写真の作者とライセンスの表示ごと写す）。2026-11-09 に、各ライセンスの原文を確かめた。

| 名前 | 用途 | ライセンス | 著作権者 | 確認 |
|---|---|---|---|---|
| **BIZ UDPゴシック**（BIZ UDPGothic） | スライドの字・デモ動画の字幕と札 | SIL Open Font License 1.1 | Copyright 2022 The BIZ UDGothic Project Authors（株式会社モリサワ） | ✅（https://github.com/googlefonts/morisawa-biz-ud-gothic の OFL.txt） |
| Lucide のアイコン（`react-icons` 5.4.0 の `lu`） | スライドの札と行の印（色と大きさを変えて画像にした） | ISC（`react-icons` は MIT） | Lucide Contributors（`react-icons` は kamijin_fanta ほか） | ✅ |
| `qrcode`（1.5.4） | スライドの公開 URL の QR コード | MIT | Ryan Day ほか。QR コードは株式会社デンソーウェーブの登録商標 | ✅ |
| Remotion（4.0.541） | デモ動画の字幕と場面の札の合成（動画に素材として入らない） | Remotion License の Free License（個人は無料） | Remotion | ✅（https://github.com/remotion-dev/remotion の LICENSE.md） |
| pptxgenjs（3.12.0）・sharp（0.33.5）・Playwright・FFmpeg | スライドを作る・画面を撮る・動画を書き出す（作品に素材として入らない） | MIT（pptxgenjs）・Apache-2.0（sharp・Playwright）・LGPL 2.1 以降（FFmpeg） | 各作者 | ✅（種類のみ） |
| デモ動画の押した所の印 | 押す前に出す灰の丸（撮影の台本が描く） | 自作 | チーム | — |
