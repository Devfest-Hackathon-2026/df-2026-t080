# Google Maps Platform & Gemini マップ関連機能 調査まとめ

DevFest GDGoC Hackathon 2026 のプロダクト開発（旅ガチャ・穴場スポット提案・ミッション散歩など）に向け、Google Maps Platform (API) で取得できるデータ、最新の料金体系、および Gemini API のマップグラウンディング機能を調査・整理したドキュメントです。

---

## 1. Google Maps Platform で取得できるデータ

Google Maps Platform の主要API（特にスポット探索の中核となる **Places API (New)** およびルート探索の **Routes API**）で取得可能なデータ項目です。

### 1-1. Places API (New) で取得できる情報

2023年末に刷新された Places API (New) では、**フィールドマスク（Field Mask: `X-Goog-FieldMask`）** で取得したい項目を指定します。指定したフィールドのカテゴリ（階層）に応じて課金SKUが決定されます。

| カテゴリ / 階層 | 主な取得可能データ | 具体的なフィールド例 |
| :--- | :--- | :--- |
| **基本情報 (Essentials / Basic)** | 場所の基本識別・座標・住所 | `id`（Place ID）、`displayName`（施設・店舗名）、`formattedAddress`（住所）、`location`（緯度・経度）、`types` / `primaryType`（施設種別・カテゴリ）、`addressComponents` |
| **連絡先・営業情報 (Pro / Contact)** | 連絡手段・営業時間・営業状態 | `regularOpeningHours`（曜日別営業時間）、`currentOpeningHours`（本日・現在の営業時間、特別営業日）、`businessStatus`（営業中・休業・閉業）、`websiteUri`（公式HP）、`internationalPhoneNumber`（電話番号） |
| **雰囲気・評価情報 (Enterprise / Atmosphere)** | 評判・口コミ・価格帯・サマリー | `rating`（平均評価: 1.0〜5.0）、`userRatingCount`（口コミ件数）、`priceLevel`（価格帯: 安価〜高級）、`reviews`（最新・主要な口コミ最大5件）、`editorialSummary`（Google等による場所の概要・紹介文） |
| **メディア (Photos)** | 写真リファレンス | `photos`（写真のリファレンスID、撮影者クレジット、幅・高さ）。※実画像は `places.googleapis.com/v1/{name}/media` で取得 |
| **付帯設備・属性情報** | バリアフリー・設備・決済・飲食特徴 | `accessibilityOptions`（車椅子対応など）、`parkingOptions`（駐車場の有無）、`paymentOptions`（クレカ/電子マネー/現金）、`outdoorSeating`（テラス席）、`restroom`、`servesVegetarianFood` など |

> [!NOTE]
> **Field Mask の注意点**: 1回のリクエスト内で複数の階層にまたがるフィールドを指定した場合、**指定した中で最も高い階層（SKU）の単価**で課金されます。必要な項目だけを絞って指定することがコスト抑制の鍵です。

---

### 1-2. Routes API で取得できる情報

出発地から目的地（経由地）へのルートや所要時間を計算するAPIです。

- **移動手段別の経路**: 車（DRIVE）、徒歩（WALK）、自転車（BICYCLE）、公共交通機関（TRANSIT）、二輪車（TWO_WHEELER）
- **所要時間と距離**: `duration`（所要時間）、`distanceMeters`（移動距離）、リアルタイム渋滞を考慮した所要時間（`TRAFFIC_AWARE`）
- **運賃・有料道路料金**: 公共交通機関の運賃情報（`transitFare`）、有料道路の料金推定（`tollInfo`）
- **ナビゲーションステップ**: ターンバイターンの道順案内、乗り換え案内ステップ
- **描画用ポリライン**: 地図上にルート線を描画するためのエンコード済みポリライン（`encodedPolyline`）

---

### 1-3. 【重要】APIで直接取得できないデータとその代替策

ハッカソンの企画検討（「穴場スポット」や「混雑回避」）に関連して、APIの仕様上**取得できないデータ**が存在します。

| 取得できないデータ | 理由・制限 | ハッカソンでの代替アプローチ |
| :--- | :--- | :--- |
| **リアルタイム混雑度・混雑する時間帯グラフ** | Google マップアプリでは「混雑する時間帯」「現在やや混雑」が表示されるが、**公式APIでは一切提供されていない**。 | ① **評価件数（口コミ数）** を人気度の代替指標とする。<br>② 営業時間・曜日・店舗カテゴリの実データを元に、**Gemini に混雑傾向を推定させる**（「推定」と明記して理由を提示）。 |
| **全件のレビューデータ** | APIで取得できる口コミは最新・主要な**最大5件**のみ。 | 5件のレビュー要約＋`editorialSummary`（概要文）＋`rating` で全体の雰囲気をGeminiに解釈させる。 |
| **非公式な穴場スコア** | 「穴場」という概念自体が主観的であり、Googleの公式指標にはない。 | **「高評価（例: rating >= 4.0）かつ 口コミ数が少なめ（例: userRatingCount 15〜80件）」** などのフィルタリング条件を独自ロジックとして定義する。 |

---

## 2. Google Maps Platform の料金体系（最新）

> [!IMPORTANT]
> **2025年3月1日の大幅改定**:
> 従来の「毎月一律 $200 の無料クレジット」は**廃止**されました。
> 現在は、**SKUごとの月間無料枠（Per-SKU Free Monthly Tier）** に移行しています。

### 2-1. 月間無料枠（Per-SKU Free Usage Caps）

Google Cloud プロジェクトごとに、以下の無料枠が毎月自動付与されます（SKU間で合算は不可）。

| SKUカテゴリ | 主な対象機能 | 月間無料リクエスト数 |
| :--- | :--- | :--- |
| **Essentials** | Places Autocomplete、Geocoding、Dynamic Maps（地図表示）など | **10,000 回 / 月（無料）** |
| **Pro** | Places Nearby Search / Text Search、Routes Advanced など | **5,000 回 / 月（無料）** |
| **Enterprise** | Places API (Atmosphere/Enterprise フィールドを含む詳細取得) など | **1,000 回 / 月（無料）** |
| **Maps Embed** | シンプルな埋め込み地図（iframe） | **無制限（無料）** |

### 2-2. 無料枠超過時の従量課金目安（1,000回あたり）

- **Places Nearby Search / Text Search (Pro)**: 約 $20.00 〜 $25.00 / 1,000回
- **Place Details (Essentialsのみ)**: 約 $5.00 / 1,000回
- **Place Details (Atmosphere/Reviews含むEnterprise)**: 約 $20.00 〜 $25.00 / 1,000回
- **Place Photos (写真取得)**: 約 $7.00 / 1,000回
- **Routes API (Compute Routes)**: 約 $5.00 〜 $10.00 / 1,000回

### 2-3. ハッカソンでのコスト懸念に対する結論

- **結論: 無料枠内で開発・デモ・審査が十分に完結可能。**
    - ハッカソン期間中のテストや審査時のAPI呼び出しは数百回〜千回程度と想定されるため、Pro枠（5,000回/月）やEnterprise枠（1,000回/月）に十分収まります。
    - さらに、Google Cloud の新規登録アカウントであれば **$300 分の無料トライアルクレジット（90日間有効）** も利用可能です。
    - ※ただし、課金設定（クレジットカード登録）のある有効な Google Cloud プロジェクトと API Key の作成が必要です。

---

## 3. Gemini のマップ関連機能

Gemini には、Google マップのリアルタイム地理情報と連携できる強力な機能が用意されています。

### 3-1. Grounding with Google Maps（Google マップによるグラウンディング）

Gemini API（Google AI Studio / Vertex AI）の標準機能として提供されているツールです。

- **概要**:
    - Gemini のプロンプト生成時に Google マップの膨大なスポットデータ（2億5,000万件以上）を参照させ、ハルシネーション（嘘の店舗名・存在しない場所）を防ぐ機能。
    - プロンプトとともにユーザーの現在地（緯度・経度）を渡すことで、「ここから徒歩15分のおすすめカフェ」のような文脈に応じた回答を生成可能。
- **取得できるメタデータ (`grounding_metadata`)**:
    - 回答の根拠となった Google マップのスポット名（`title`）
    - Google マップの直接リンク URI（`uri`）
    - 地点IDや住所などのコンテキスト
- **Gemini API での実装イメージ (Python - google-genai SDK)**:

  ```python
  from google import genai
  from google.genai import types

  client = genai.Client()

  response = client.models.generate_content(
      model='gemini-2.5-flash', # または gemini-3.x 系
      contents="ここから徒歩15分圏内にある、落ち着いて読書ができる穴場カフェを理由付きで3つ提案して。",
      config=types.GenerateContentConfig(
          tools=[types.Tool(google_maps=types.GoogleMaps())],
          tool_config=types.ToolConfig(
              retrieval_config=types.RetrievalConfig(
                  lat_lng=types.LatLng(latitude=35.681236, longitude=139.767125) # 例: 東京駅周辺
              )
          ),
      ),
  )

  print(response.text)

  # グラウンディングされたマップの出典URLを取り出す
  if response.candidates[0].grounding_metadata:
      for chunk in response.candidates[0].grounding_metadata.grounding_chunks:
          print(f"- {chunk.maps.title}: {chunk.maps.uri}")
  ```

### 3-2. Gemini マップグラウンディングの料金

- **Gemini 3 系 / 最新モデル**:
    - **無料枠**: プロジェクトあたり **月間 5,000 クエリまで無料**。
    - **超過時**: 1,000 検索クエリあたり **$14.00**。
    - ※通常のモデル入力/出力トークン費用は別途かかりますが、Gemini Flash 系列であれば極めて安価です。

### 3-3. 一般向け Gemini アプリの Google Maps 拡張機能

- エンドユーザー向けの Gemini（gemini.google.com やスマホアプリ）では、`@Google Maps` を付けることでマップ内の場所検索やナビ案内を対話型で行えます。
- 開発者としてアプリに組み込む場合は、これではなく **3-1 の Gemini API (Grounding with Google Maps)** または **Places API** を使用します。

---

## 4. ハッカソン開発での使い分け・アーキテクチャ提案

チームのアイデア（「理由を書く旅ガチャ」「穴場スポット推薦」「ミッション散歩」）において、APIをどのように組み合わせるべきかの整理です。

| 方式 | 概要 | メリット | デメリット・注意点 | 推奨ユースケース |
| :--- | :--- | :--- | :--- | :--- |
| **方式A: Places API (New) ＋ Gemini（推論）** | Places API で構造化データ（店舗一覧、評価、口コミ数、営業時間）を取得し、その JSON データをプロンプトに流し込んで Gemini に推論・理由付けさせる。 | ・「口コミ件数 20〜60件」「評価 4.0以上」など厳密なフィルタリングが可能。<br>・座標やPlace IDを直接フロントエンドで扱える。 | ・Places API と Gemini API の2つの呼び出しが必要。<br>・Field Mask の設定に注意が必要。 | **穴場スポットの厳密な抽出、旅ガチャの候補選定** |
| **方式B: Gemini API (Grounding with Google Maps)** | Gemini に自然言語で「周辺の穴場スポット」を尋ね、Gemini が自動で Google マップをグラウンディングして回答と地図リンクを出力する。 | ・実装が最もシンプル（API 1回で場所の推薦文とマップURLが完結）。<br>・Gemini側の無料枠（月5,000回）が使える。 | ・「口コミ数〇件以下」のような厳密な条件抽出が意図通りにならない場合がある。<br>・レスポンスから緯度経度を直接取り出す形式がプロンプト依存になる。 | **曖昧な要望からの提案（「なんかいい感じの所」）、旅先でのアドリブミッション生成** |

> [!TIP]
> **おすすめのハイブリッド構成**:
>
> 1. **行き先選定（旅ガチャ）**: **方式A**。Places API で現在地周辺の候補を取得し、評価数・口コミ件数で「穴場候補」を絞り込んだ後、Gemini に「対立する3案とそのメリット・デメリット・選ぶべき理由」を言語化させる。
> 2. **旅のミッション・散歩ミッション生成**: **方式B**。Gemini に現在地や目的地の特徴を渡して、その場に合ったユニークなミッション（例:「地元民しか知らない看板を見つける」等）を出題させる。
> 3. **移動**: **Google Maps URL スキーム**（`https://www.google.com/maps/dir/?api=1&destination=...`）を使用すれば、Routes API の課金を使わずにユーザーのスマホのGoogle マップアプリを直接起動して無料案内できる。

---

## 5. 公式ドキュメント・ソースURL一覧

- **Google Maps Platform 全般**
    - [Google Maps Platform 料金公式](https://mapsplatform.google.com/pricing/)
    - [Google Maps Platform 料金改定・請求ドキュメント](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- **Places API (New)**
    - [Places API (New) 概要](https://developers.google.com/maps/documentation/places/web-service/op-overview)
    - [Place Details (New) とフィールド一覧](https://developers.google.com/maps/documentation/places/web-service/place-details)
    - [Nearby Search (New) 周辺検索](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- **Routes API**
    - [Routes API 概要・ドキュメント](https://developers.google.com/maps/documentation/routes)
- **Gemini API & Grounding**
    - [Gemini API ドキュメント トップ](https://ai.google.dev/gemini-api/docs)
    - [Grounding with Google Maps ガイド](https://ai.google.dev/gemini-api/docs/grounding)
    - [Gemini API 料金体系](https://ai.google.dev/pricing)
