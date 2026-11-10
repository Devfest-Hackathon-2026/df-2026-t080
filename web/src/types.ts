export type Point = { lat: number; lng: number }

export type Kind = 'sight' | 'street' | 'food' | 'cafe'
export type Role = 'famous' | 'hidden'

export type Spot = Point & {
  id: string
  name: string
  ja?: string // 英語の候補の日本語の名前（Google マップで探すときに使う）
  kind: Kind
  role: Role
  district?: string
  source?: 'famous' | 'hidden' | 'food' | 'wish' | 'search' // search: 「この付近を検索」で見つけて入れた場所（lib/found.ts）
  named?: boolean // 希望に名前を書いた場所（「太宰府に行きたい」の太宰府天満宮など。選ぶ画面で最初から選んでおく）
  stay: number
  open: number // 0 時からの分
  close: number
  tags: string[]
  crowd: number[] // 休日の 8〜18 時（0〜4）
  weekdayDrop: number
  // Gemini が答えず、サーバーが決まった値で埋めた所（crowd は 8 時台を 0 とする時間帯の番号）
  filled?: { crowd?: number[]; stay?: boolean; weekdayDrop?: boolean; hours?: boolean }
  popularity?: number // 1〜5
  best?: 'morning' | 'daytime' | 'evening' | 'any'
  why: string
  downside: string
  basis: string
  theme?: string // 隠れた名所の切り口（エリアごとに Gemini が出す。作り置きの古い候補には無い）
  verified?: boolean
  photo?: WikiPhoto | null
  placeId?: string // Google の Places の place_id（照合できた場所だけ）
  placeMiss?: boolean // Places で照合して見つからなかった
  locatedAt?: number // 位置を Places から取った時刻（秒）
  guess?: [number, number] // Places で照合する前の位置
  // 検索で入れた場所の、曜日ごとの営業時間（lib/hours.ts の Period。Places の内容なので取っておかない。null は分からない、無ければまだ聞き直していない）
  week?: [number, number, number | null, number | null][] | null
}

export type Condition = { tag: string; label: string }

// 出発地・到着地として送る場所（text は欄に書いた文字、name・位置は地図のデータで引いたもの）
export type TripPoint = Point & { text: string; name: string; ja?: string }
// 地図のデータで引いた場所（pref・city は都道府県と市区町村。欄の下に出して、本人が確かめる）
export type GeoHit = Point & { name: string; ja?: string; pref?: string; city?: string }

export type AreaData = {
  area: Point & { name: string; ja?: string; radius?: number }
  start: Point & { name: string; ja?: string }
  // 到着地（出発地に戻らない旅だけ。無ければ出発地に戻る）
  end?: Point & { name: string; ja?: string }
  districts?: string[]
  // 隠れた名所の切り口の名前と、その切り口で探した場所の種類（新しく集めたエリアだけ）
  themes?: { label: string; hint: string }[]
  conditions: Condition[]
  places: Spot[]
  // 頼んだ内容（start・end は出発地と到着地で頼んだ旅だけ。前の形はエリアの名前だけ）
  query?: { area: string; wish: string; start?: TripPoint; end?: TripPoint | null }
  example?: { start: number; end?: number; must: string[] } // 例のプランを開いたときの出発と帰る時刻（0 時からの分）と、選んだ場所
  demo?: boolean // 「京都のデモを試す」・?example で組んだ例のプラン（端末とクラウドに 1 件だけ残す）
  // 全部の点どうしの移動時間（分）。ids は出発地（'start'）・到着地（'end'。ある旅だけ）・候補の順
  // heights: 地点ごとの地面の高さ（m。ids と同じ並び。データが無い所は null）
  matrix?: { ids: string[]; walk: (number | null)[][]; drive: (number | null)[][]; walkM?: (number | null)[][]; heights?: (number | null)[] } | null
}

// 時刻表の無い区間の、乗り換えなしの電車の目安（OpenStreetMap の路線と駅から。何時何分発は無い）。
// color は路線の色（# の無い 6 桁の 16 進。無ければ null）。分は整数。stops は乗る区間の数。path は乗る駅から降りる駅までの駅（[経度, 緯度]）
export type RailStation = { name: string; lat: number; lng: number }
export type RailOpt = {
  line: string
  color: string | null
  mode: 'subway' | 'train' | 'tram' | 'light_rail' | 'monorail'
  board: RailStation
  alight: RailStation
  walkTo: number
  wait: number
  ride: number
  walkFrom: number
  stops: number
  path: [number, number][]
}

// 場所どうしの、乗換なしのバス・電車で戸口から戸口までの目安（分。直通の便が無い組みは null）。ids の並びは移動時間の表と同じ。
// rail: 時刻表に便が無く、電車の目安を使った組み（via[i][j] は opts の番号）
export type TransitTable = { ids: string[]; minutes: (number | null)[][]; rail?: { opts: RailOpt[]; via: (number | null)[][] } }

// 区間の実際の経路（乗換案内のスクリーンショットから読み取ったものと、時刻表から選んだ便）
export type TransitStep = { mode: 'walk' | 'train' | 'bus' | 'other'; line: string; from: string; to: string; depart: string; arrive: string; minutes: number }
export type TransitRoute = {
  origin?: string
  destination?: string
  depart: string
  arrive: string
  minutes: number
  fare: number
  steps: TransitStep[]
  bus?: BusPick // 時刻表から選んだ便（スクリーンショットから入れた経路には無い）
}

// 時刻表（GTFS）から探した、乗換なしのバス・電車の便
export type BusStopAt = { name: string; platform: string; lat: number; lng: number; time: string }
// 乗る所と降りる所の間の停留所・駅（時刻表の順。サーバーは 40 件まで返す）
export type BusVia = { name: string; time: string }
export type BusTrip = {
  agency: string // 事業者の短い名前（都営バス・東京メトロ など）
  route: string // 系統・線（草39・銀座線 など）
  mode?: 'bus' | 'train'
  headsign: string
  board: BusStopAt
  alight: BusStopAt
  walkTo: number // 停留所までの徒歩（分）
  walkFrom: number
  stops: number // 乗っている停留所の数
  via?: BusVia[] // 途中の停留所（前の形で取っておいた便には無い）
  line: [number, number][] // 乗る区間の路線の線（[経度, 緯度]）
  shape: boolean // 時刻表の路線の形か（false は停留所をつないだ道の線）
  color?: string | null // 路線の色（routes.txt の route_color。6 桁の 16 進で、書いてあるとおり。無ければ null）
  textColor?: string | null // 路線の文字の色（route_text_color）
  parts?: BusParts // 線を、停留所まで歩く・乗る・停留所から歩くの 3 つに分けた物
  source?: BusSource // その便の時刻表の出典
}
// 出典の表示に使う、時刻表ごとの情報（事業者・データの名前・ライセンス・版・取得日時）
export type BusSource = {
  agency: string
  version: string
  fetched: string
  name?: string
  title?: string
  nameEn?: string // 英語の画面に出す名前（分かる物だけ）
  titleEn?: string
  license?: string
  licenseName?: string
  licenseUrl?: string
  via?: string
}
// 便の線の 3 つの部分（どれも [経度, 緯度] の並び）
export type BusParts = { walkTo: [number, number][]; ride: [number, number][]; walkFrom: [number, number][] }
// 選んだ便と、その日・探したときの出る時刻（ほかの便を探し直すときに使う）
export type BusPick = BusTrip & { date: string; after: number }

// Wikipedia の写真。author・license・licenseUrl・source は Wikimedia Commons のファイルの説明のページから取る
export type WikiPhoto = {
  url: string
  page: string
  title: string
  author?: string
  license?: string
  licenseUrl?: string
  source?: string
}
