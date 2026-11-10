# ログインと旅の保存（Firebase Authentication と Firestore）

Google でログインすると、旅（プラン・選んだ理由・ミッションの文と当たったか、など）がクラウドに保存され、別の端末からも同じ旅を開けます。
ログインは任意です。ログインしなくても、今までどおり全部使えます（保存はその端末の localStorage だけ）。

- ログイン: Firebase Authentication の Google のログイン（`web/src/lib/auth.ts`）
- 保存: Cloud Firestore の `users/{uid}/trips/{tripId}`（`web/src/lib/trips.ts`）
- ルール: 一番上の `firestore.rules`（本人の uid の下だけ読み書きできる）
- 設定: サーバーが実行のときに `/api/config` で渡す（Cloud Run の環境変数 `ZT_FIREBASE_CONFIG`）。設定が無いときは、ログインの部品を出さず、Firebase の JS も読み込みません（今の本番と同じ動き）。

ログインの主な入口は、ホーム画面（`web/src/components/Home.tsx`。旅を選ぶ・作る・消す画面）です。調整のシートの一番下（言語の切り替えの横）からもログインできます。

- ページを開くと、いつもホーム画面から始まります（初めての人も、ここから新しい旅を作るか、例のプランを見ます）。URL に `?start=pick` を付けたときだけ、例のエリアの行きたい場所を選ぶ画面から始まります。
- ほかに、調整のシートの「自分の旅」と、ログインしていて端末にプランが無いときの、行きたい場所を選ぶ画面の「自分の旅」から開けます。
- ホーム画面から旅を開くと App を作り直し、そのあとはホーム画面を飛ばしてプランを出します。
- ログインしていない人には、旅を作った直後に、プランの画面の一番上へ「この旅は、この端末にだけ保存されています」の一言とログインのボタンを出します（`web/src/components/SaveNudge.tsx`）。閉じた旅は、`since` ごとに端末に覚え（`web/src/lib/nudge.ts`）、開き直したときやホーム画面から開いたときは出しません。ログインしたら消えます。

## 1. 部品の使い方（ホーム画面を作る人へ）

### ログイン

```tsx
import { useAuth } from '../lib/auth'

function HomeHeader() {
  const { available, ready, user, signIn, signOut } = useAuth()
  if (!available) return null // 設定が無い（ログインを使わない）
  if (!ready) return null // ログインしているかを確かめている途中
  return user ? (
    <button type="button" className="btn-line" onClick={() => void signOut()}>ログアウト</button>
  ) : (
    // r が 'blocked' などのときは、一言で知らせる（言葉は components/Account.tsx）
    <button type="button" className="btn-line" onClick={() => void signIn().then((r) => console.log(r))}>
      Google でログイン
    </button>
  )
}
```

- `user` は `{ uid, name }` だけです。名前は画面に出すだけにして、どこにも保存しないでください。
- `signIn()` の結果は `'ok' | 'cancelled' | 'blocked' | 'unsupported' | 'failed'` です。言葉は `components/Account.tsx` のものを使えます。
- `signIn()` は、押したときの処理の中で、何も待たずに（`await` の前に）呼んでください。iPhone の Safari は、押してからログインの窓を開くまでの間に待ちがあると、窓を止めます。Firebase の JS は設定が届いた時点で先に読み込んであるので、すぐに窓が開きます。

### 旅の一覧・開く・作る・消す

```tsx
import { currentTripId, deleteTrip, loadTrip, newTrip, openTrip, saveTrip, useTrips } from '../lib/trips'

function TripList() {
  const trips = useTrips() // 届くまで null。ログインしていないときは []
  if (!trips) return null
  const now = currentTripId()
  return (
    <ul>
      {trips.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={async () => { const trip = await loadTrip(t.id); if (trip) openTrip(trip) }}>
            {t.title}・{t.date}・{t.stops}か所{t.id === now ? '（今の旅）' : ''}
          </button>
          <button type="button" onClick={() => void deleteTrip(t.id)}>削除</button>
        </li>
      ))}
      <li><button type="button" onClick={newTrip}>新しい旅を作る</button></li>
    </ul>
  )
}
```

| 部品 | すること |
|---|---|
| `useTrips()` | 自分の旅の一覧（直した時刻の新しい順・50 件まで）。変わるたびに描き直す。届くまで `null` |
| `watchTrips(f)` | 同じ一覧を、変わるたびに `f(trips)` で知らせる。止める関数を返す（React 以外から使うとき） |
| `listTrips()` | 同じ一覧を 1 回だけ読む |
| `loadTrip(id)` | 旅を 1 つ、中身ごと読む（無い・読めないときは `null`） |
| `openTrip(trip)` | 旅を端末に入れて、画面ごと開き直す（App を作り直す。開いた旅が端末の今の旅になる） |
| `newTrip()` | 入力の画面を開く（「戻る」でホーム画面へ）。そこでプランを作ると、新しい旅として保存する |
| `saveTrip(trip)` | 旅を書く（題名を変えるときなど。`{ ...trip, title: '新しい題名' }`） |
| `deleteTrip(id)` | 旅を消す。端末の今の旅なら、プランは端末に残し、その旅の自動の保存だけを止める |
| `currentTripId()` | 端末の今のプランの旅の id |
| `tripFromDevice()` | 端末の今の状態を旅の形にする（クラウドには書かない） |
| `tripToDevice(trip)` | 旅を端末の今の状態にする（画面は開き直さない。ふつうは `openTrip`） |

- どの部品も、ログインしていないときは何もしません（一覧は空、読む・書くは `null`・`false`）。
- 一覧の `TripMeta` は `{ id, title, area, date, createdAt, updatedAt, stops, lang }` です。一覧を出すだけなら、中身（プラン）を読み解く必要はありません。

### 自動の保存（App がしていること）

- ログインしているときは、端末の今のプランを、今の旅へ自動で保存します。
  - 手が止まって 4 秒たったら（続けて直していても 30 秒ごとに）、まとめて 1 回書きます。中身が前に書いたときと同じなら書きません。ページを隠す・閉じるときは、待たずに書きます。
  - 選んだ理由とミッションを直したときも、同じように書きます。
- 今のプランがどの旅かは、旅を作り始めた時刻（`since`）で結び付けて、端末に覚えます（`intentrip:trip:v1`。英語の画面は `:en` 付き）。新しいプランを作ると、新しい旅になります。
- ログインしたときに端末にある今のプランは、消さずに 1 つの旅としてクラウドに足します。
- ログアウトしても、端末のプランと理由・ミッションは消しません。
- ホーム画面からは、自動の保存を呼ぶ必要はありません。

## 2. データの形

`users/{uid}/trips/{tripId}`（`tripId` は端末で作る 20 文字の英数字）

| 項目 | 型 | 中身 |
|---|---|---|
| `v` | 数 | 形の版（今は `1`） |
| `title` | 文字（120 字まで） | 題名。入力したエリアの文（無ければエリアの名前）。`saveTrip` で変えられる |
| `area` | 文字（120 字まで） | エリアの名前（`data.area.name`。理由とミッションは端末でこの名前ごとに取ってある） |
| `date` | 文字 | 旅の日（`YYYY-MM-DD`） |
| `createdAt`・`updatedAt` | 数 | 作った時刻・直した時刻（ミリ秒） |
| `stops` | 数 | プランの場所の数 |
| `lang` | 文字 | 作ったときの画面の言語（`ja`・`en`） |
| `since` | 数 | 旅を作り始めた時刻（理由とミッションは、これより後の分がこの旅の物。#60 の絞りと同じ） |
| `state` | 文字（JSON・90 万字まで） | 端末に取ってあるプラン（`web/src/lib/saved.ts` の `Saved`）を丸ごと |
| `why` | 文字（JSON・6 万字まで） | その旅の選んだ理由（`Why[]`。旅のあとの「当たったか」も入る） |
| `odai` | 文字（JSON・6 万字まで） | その旅のミッション（`OdaiItem[]` から写真を除いた物） |

- 大きい物を JSON の文字にしているのは、ルールで大きさを確かめやすく、Firestore に中身の索引を作らせないためです。1 件の上限は 1 MiB です（京都の例で 1 件 約 60 KB）。
- 入れない物
  - ミッションの写真（端末の base64）。大きいので、端末にだけ残します。入れるなら Cloud Storage が要ります（このあとの課題）。
  - 名前・メールアドレス・アイコン。画面に出すときは Auth の `user` から取ります。
  - Google で照合した位置・評価・写真（Places の決まり）。旅に入れるのは place_id だけで、照合した場所の位置は照合の前の位置（`guess`）に戻して入れます。開いた端末では、30 日の期限が切れた場所と同じ扱いになり（`expireGoogleLocations`）、サーバーが place_id で位置を取り直します。
- ログインの情報は Gemini に渡しません（サーバーにも送りません）。

## 3. ルール（`firestore.rules`）

- `users/{uid}/trips/{tripId}` は、ログインした本人（`request.auth.uid == uid`）だけが読み・書き・消しできます。
- 書くときは、上の表の項目だけがそろっていること、型と大きさを確かめます（名前・メールアドレスなどの項目は入れられません）。
- 一覧は 50 件までに絞った問い合わせだけを許します。直すときに `createdAt` は変えられません。
- それ以外の場所は、だれも読み書きできません。

## 4. Emulator での試し方

本番の Firebase が無くても、Emulator Suite（Auth と Firestore）で試せます。java（21 以上）と firebase-tools が要ります（firebase-tools はリポジトリの外に入れる。例: `npm install firebase-tools` を別のフォルダで）。

1. リポジトリの一番上で、Emulator を動かします（ポートは `firebase.json`。Auth 9099・Firestore 8180）。プロジェクト ID は `demo-` で始めると、本物のプロジェクトにつながりません。
   ```
   firebase emulators:start --only auth,firestore --project demo-intentrip
   ```
2. 別の端末で、サーバーに試しの設定を入れて動かします。
   ```
   cd server
   ZT_FIREBASE_CONFIG='{"apiKey":"demo-api-key","authDomain":"demo-intentrip.firebaseapp.com","projectId":"demo-intentrip","appId":"1:1:web:demo"}' \
   ZT_FIREBASE_EMULATOR='{"auth":"http://127.0.0.1:9099","firestore":"127.0.0.1:8180"}' \
   uv run python app.py
   ```
3. 画面を開き、プランを作って「調整」→「Google でログイン」を押すと、Emulator のログインの窓が出ます（「Add new account」で、好きなメールアドレスと名前で入れます）。
4. ルールの試験（ほかの人の旅を読めない・書けないことなど）は、次で動かします。
   ```
   firebase emulators:exec --only auth,firestore --project demo-intentrip "node --test web/tests/firestore-rules.test.mjs"
   ```

`ZT_FIREBASE_EMULATOR` は手元の試しだけに使います（本番の Cloud Run には入れない）。

## 5. 本番の設定（Cloud Run）

コンソールの手順（6 章）が終わったら、Cloud Run のサービスに環境変数を 1 つ足します。組み立て（Cloud Build のトリガー）は変えません。設定を変えても組み直しは要りません。

1. Cloud Run の `intentrip` サービスを開き、「新しいリビジョンの編集とデプロイ」を押します。
2. 「変数とシークレット」で「変数を追加」を押し、名前を `ZT_FIREBASE_CONFIG`、値を 6 章の 4 で控えた設定の JSON にします（1 行で。例: `{"apiKey":"AIza…","authDomain":"<プロジェクト ID>.firebaseapp.com","projectId":"<プロジェクト ID>","appId":"1:…:web:…","messagingSenderId":"…","storageBucket":"…"}`）。
   - Web の設定の `apiKey` は秘密ではありません（ブラウザに配る種類）。Secret Manager に入れなくてかまいません。
3. 「デプロイ」を押します。開き直すと、調整のシートの一番下に「Google でログイン」が出ます。
4. ルールを本番に入れます（6 章の 5 の最後）。

- 置き直し（`main` へのマージ）では、Cloud Run の環境変数はそのまま残ります。
- やめるときは、`ZT_FIREBASE_CONFIG` を消してデプロイすると、今までどおりログインの部品が出なくなります（端末のプランはそのまま）。

## 6. コンソールでする手順

サイト用のプロジェクト（`project-02d75b21-7ece-4a2a-900`）に Firebase を足します。どれも 1 回だけです。

### 6-1. Firebase を足す

1. https://console.firebase.google.com/ を開き、「Firebase プロジェクトを作成」（または「プロジェクトを追加」）を押します。
2. 一番下の「既存の Google Cloud プロジェクトに Firebase を追加」を押し、`project-02d75b21-7ece-4a2a-900` を選びます。
3. 規約に同意して進みます。Google アナリティクスは「有効にしない」にします（使いません）。
4. 料金プランの確認が出たら、そのまま進みます。請求先アカウントのあるプロジェクトなので Blaze（従量制）と表示されますが、Authentication と Firestore は無料の枠の中で使います（7 章）。
5. 「Gemini in Firebase」・App Check・Analytics など、ほかの機能をすすめられても、有効にしません。

### 6-2. Google のログインを有効にする

1. Firebase のコンソールの左のメニューで「Authentication」（「構築」か「セキュリティ」の中）を開き、「始める」を押します。
2. 「Sign-in method」（ログイン方法）のタブで、「Google」を選びます。
3. 「有効にする」をオンにし、「プロジェクトのサポートメール」に自分のメールアドレスを選びます。
4. 「保存」を押します。
5. 「Identity Platform にアップグレード」をすすめられても、アップグレードしません（料金が変わるため）。

### 6-3. 承認済みドメインに Cloud Run の住所を足す

1. 同じ「Authentication」の「設定」のタブを開き、「承認済みドメイン」を選びます。
2. 「ドメインの追加」を押し、Cloud Run の住所のホスト名だけ（`https://` と最後の `/` を除く。例: `intentrip-xxxxxxxxxx.asia-northeast1.run.app`）を入れて「追加」を押します。
   - Cloud Run の住所が 2 つ（`…-<番号>.asia-northeast1.run.app` と `…-<文字>-an.a.run.app`）出ているときは、両方を足します。
3. `localhost` と `<プロジェクト ID>.firebaseapp.com` は最初から入っています。消さないでください。

### 6-4. Web アプリを登録する

1. 左上の歯車から「プロジェクトの設定」を開き、「全般」のタブの下の「マイアプリ」で、Web の印（`</>`）を押します。
2. 「アプリのニックネーム」を `IntenTrip` にします。「Firebase Hosting も設定する」は付けません（Cloud Run で配るため）。
3. 「アプリを登録」を押すと、`const firebaseConfig = { … }` が出ます。この中の `apiKey`・`authDomain`・`projectId`・`storageBucket`・`messagingSenderId`・`appId` を控えます（5 章の 2 で JSON にして入れる）。
   - あとから見るときも、同じ「マイアプリ」の「SDK の設定と構成」で「構成」を選ぶと出ます。
4. 「npm を使用」などの手順は飛ばして「コンソールに進む」を押します（組み込みはリポジトリでしてあります）。

### 6-5. Firestore を作る

1. 左のメニューで「Firestore Database」を開き、「データベースの作成」を押します。
2. エディションを選ぶ画面が出たら「Standard エディション」を選びます（無料の枠があるのは Standard の 1 つ目のデータベースだけ）。
3. データベース ID は `(default)` のままにします。
4. ロケーションは `asia-northeast1`（東京）にします。あとから変えられません。
5. 「本番環境モードで開始」を選んで「作成」を押します（テストモードは、だれでも読み書きできるので選ばない）。
6. できたら「ルール」のタブを開き、リポジトリの `firestore.rules` の中身を全部貼り付けて「公開」を押します。

### 6-6. OAuth の同意画面（Google でログインするときに出る画面）

Google のログインを有効にすると、OAuth の同意画面が作られます。Google Cloud のコンソールで、次の 2 つを直します。

1. https://console.cloud.google.com/ でサイト用のプロジェクトを選び、「Google Auth Platform」（「API とサービス」の「OAuth 同意画面」）を開きます。
2. 「ブランディング」で、「アプリ名」を `IntenTrip` にし、「ユーザー サポートメール」と「デベロッパーの連絡先情報」に自分のメールアドレスを入れて保存します。
   - アプリのロゴは入れません（入れると、Google の確認の審査が要ることがあります）。
3. 「対象」（オーディエンス）で、「ユーザーの種類」が「外部」になっていることを確かめます。
4. 同じ「対象」で、公開の状態を「テスト」から「本番環境」にします（「アプリを公開」を押して確定）。
   - テストのままだと、テストユーザーに登録した人（100 人まで）しかログインできず、審査員がログインできません。
   - 使うのは名前とメールアドレスの基本の範囲（`openid`・`email`・`profile`）だけなので、確認の審査は要らない見込みです。審査を求められたら、先に知らせてください。

### 6-7. 確かめる

1. Cloud Run の住所を iPhone の Safari と PC の Chrome で開き、プランを作って「調整」→「Google でログイン」を押します。
2. ログインの画面に「IntenTrip」と出て、ログインすると「ログアウト」と自分の名前が出れば、ログインはできています。
3. 少し手を入れて 5 秒ほど待ち、Firestore の「データ」のタブで `users` → 自分の uid → `trips` に旅が 1 件あれば、保存はできています。
4. 別の端末で同じアカウントでログインし、ホーム画面で同じ旅が開けることを確かめます。

## 7. お金（無料の枠の中で使う）

- Authentication: Google のログインは、Identity Platform にアップグレードしなければ料金は掛からない見込みです（アップグレードしても、月 5 万人までは無料）。Firebase の料金のページの「Authentication」で確かめてください。
- Firestore（Standard の 1 つ目のデータベース）の無料の枠: 1 日に読む 5 万回・書く 2 万回・消す 2 万回、保存 1 GiB、外への転送 月 10 GiB。
  - 書くのは、手が止まってから 1 回（続けて直していても 30 秒に 1 回まで）で、同じ中身は書きません。1 人が 1 日に旅を 1 つ作っていじっても、数十回ほどです。
  - 読むのは、旅を開くときの 1 回と、一覧を見張っている間の変わった分（1 件ごとに 1 回）です。一覧は 50 件までに絞ってあります。
  - 1 件は約 60 KB なので、1 GiB に 1 万 5 千件ほど入ります。
- 有料の物（Cloud Storage・App Check・Analytics など）は足していません。

## 8. 決まりと、まだできていないこと

- 同じ旅を 2 つの端末で同時に直すと、後から書いた方が残ります（混ぜません）。
- ほかの端末で消した旅を、まだ開いている端末で直すと、その端末がもう一度書いて、旅が戻ります（その端末で `deleteTrip` したときは戻りません）。
- 理由とミッションは、端末ではエリアの名前ごとに取ってあり、`since` で旅を分けています。同じエリアの旅を 2 つ以上作り、古い方を開くと、新しい方の、写真を撮ったミッションが残って見えることがあります（写真を消さないため）。
- ミッションの写真は、旅を作った端末にだけあります。ほかの端末では、ミッションの文と当たったかだけが出ます。
- ログインは signInWithPopup だけです。Cloud Run の住所と `authDomain`（`<プロジェクト ID>.firebaseapp.com`）が違うので、signInWithRedirect は、第三者の保存を止めるブラウザ（Safari 16.1 以降・Chrome 115 以降など）で動きません（Firebase の説明「Best practices for using signInWithRedirect on browsers that block third-party storage access」）。
  - LINE や X の中のブラウザなど、窓を開けないブラウザでは、ログインできないことがあります（「Safari か Chrome で開いてください」と出します）。
  - 窓を止めるブラウザが多いと分かったら、Cloud Run のサーバーで `/__/auth/` を `<プロジェクト ID>.firebaseapp.com` へ取り次ぎ、`authDomain` を Cloud Run の住所にして、signInWithRedirect も使えるようにします（同じ説明の「Option 3」）。
