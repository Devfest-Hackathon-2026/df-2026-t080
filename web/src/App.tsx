import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AreaData, BusTrip, Condition, GeoHit, Point, Spot, TransitRoute, TransitTable, TripPoint } from './types'
import { nearCandidates, ROLE_TEXT, type BaseItem, type Pace, type Plan, type PlanInput, type Slot, type Stop, type TimeNote } from './lib/planner'
import { usePlan } from './lib/usePlan'
import { addFound, applyAdjust, looseOf, type AdjustState } from './lib/adjust'
import { useSlopes } from './lib/slope'
import { askAdjust, askTrip, hasServer, loadMatrix, pollJob, startJob, tripOf, type AdjustOp, type AdjustReply, type JobState, type TripAsk } from './lib/api'
import { nearOf, usePlaceField, type PlaceField } from './lib/placeField'
import { fetchWeather, wearFor, weatherLabel, weatherSky, type Weather } from './lib/weather'
import { dateLabel, fmt, fmtDur, isHoliday, isoDate, nextSaturday } from './lib/time'
import { GoogleMapView, MapView } from './components/LazyMap'
import { hasGoogleMaps, onMapsUnavailable } from './lib/gmaps'
import { CrowdSwap, CrowdSwapSheet } from './components/CrowdSwap'
import { Compare } from './components/Compare'
import { FavAsk } from './components/FavAsk'
import { WearCard } from './components/WearCard'
import { daysUntil } from './lib/highlight'
import { PenguinNote } from './components/PenguinNote'
import { penguinFacts, usePenguinNote } from './lib/penguin'
import { OsmCredit } from './components/OsmCredit'
import { ElevCredit } from './components/ElevCredit'
import { NextCard } from './components/NextCard'
import { LookForward } from './components/LookForward'
import { RouteList, legOpensBus } from './components/RouteList'
import { CrowdLegend } from './components/CrowdMark'
import { BusSheet } from './components/BusSheet'
import { placeDetails, useGoogleMapShown } from './lib/place'
import { searchArea, type AreaBox, type Found, type FoundError } from './lib/areaSearch'
import { foundHoursOn, needsRestore, restoreFound, spotOfFound } from './lib/found'
import { areaBox, busName, busRoute, fetchBus, isTrain, loadBusInfo, mergeSources, type BusInfo, type BusSource } from './lib/bus'
import { BusCredit } from './components/BusCredit'
import { syncBusLines } from './lib/busLines'
import { distM, goalId, goalOf, legKey, mapsDirUrl, mapsTourUrl, tableIds, tablePoints, type Leg, type LegMode } from './lib/geo'
import { fetchBusTable, type BusTable } from './lib/busTable'
import { sunsetMin } from './lib/sun'
import { StopSheet } from './components/StopSheet'
import { Sheet } from './components/Sheet'
import { GeminiMark, SparkIcon } from './components/GeminiMark'
import { CandidateSheet } from './components/CandidateSheet'
import { TripOdai } from './components/Odai'
import { ShareMenu } from './components/ShareMenu'
import { readCount, readLevel, saveCount, saveLevel, type OdaiLevel } from './lib/odai'
import { clearSaved, readOtherSaved, readSaved, writeSaved, type FocusAdd, type Pin, type Saved } from './lib/saved'
import { canSkip, dayWants, fitDays, fitEnd, joinWish, mergeTalk, nextQuestion, stayFieldsOf, talkReady, wantsOf, type Question, type Talk, type TripWants } from './lib/stayTalk'
import { LIMITS, noteStops, onTripNew, onTripOpen, queueCloudSave, reopenCurrent, startCloudSync, tripTitle, untouchedDemo } from './lib/trips'
import { addCarry, addDay as addDayTo, addDayAsk, allDays, dropCarried, usedWith, withCarry, canAddDay, DAYS_MAX, dayIndex, dayStopIds, dropUsed, nextDate, plannedDays, removeDay, stayEnds, switchDay, tabDates, stayTitle, tripGoal, usedPlaces, withStays, hasStay, nightStay, trimStays, dayGoal, stayTrip, metWishes, quietMet, type Stays } from './lib/days'
import { CarryLine, DAY_TEXT, DayStatus, DayTabs } from './components/DayTabs'
import { PlanForm, SearchWait, showSearchWait } from './components/PlanForm'
import { MAX_TRIP_KM, shownNights, stayFarTexts } from './lib/stayFar'
import { WeatherIcon } from './components/WeatherIcon'
import { StartPick, type Picked } from './components/StartPick'
import { DemoOwn } from './components/DemoOwn'
import { LegModeSheet } from './components/LegMode'
import { mentionsCar } from './lib/carTrip'
import { Home } from './components/Home'
import { homeBelow, useBackClose, useScreenBack } from './lib/backStack'
import { keepScroll, useViewScroll } from './lib/viewScroll'
import { askExample, clearRecapOnOpen, exampleAsked, openAfterLang, recapOnOpen } from './lib/homeIntent'
import { HomeButton } from './components/HomeButton'
import { SaveNudge } from './components/SaveNudge'
import { joinNames, lang, tr } from './lib/i18n'

// 押してから開くシートは、初めに読む量を減らすため後から読む
const TransitSheet = lazy(() => import('./components/TransitSheet').then((m) => ({ default: m.TransitSheet })))
const AreaSearchSheet = lazy(() => import('./components/AreaSearchSheet').then((m) => ({ default: m.AreaSearchSheet })))
const PlacePicker = lazy(() => import('./components/PlacePicker').then((m) => ({ default: m.PlacePicker })))
const Recap = lazy(() => import('./components/Recap').then((m) => ({ default: m.Recap })))
const PlanImage = lazy(() => import('./components/PlanImage').then((m) => ({ default: m.PlanImage })))
const AdjustSheet = lazy(() => import('./components/AdjustSheet').then((m) => ({ default: m.AdjustSheet })))

const T = tr({
  ja: {
    shareRide: (train: boolean, m: number) => `${train ? '電車' : 'バス'} ${m}分`,
    more: (two: string[], n: number) => `${two.join('・')}ほか${n}か所`,
    farWish: (n: string) => `${n}は遠いため、追加できませんでした`,
    tableFixed: '時刻表に合わせて移動時間を更新しました',
    railFixed: '電車の路線に合わせて移動時間を更新しました',
    quotaPlan: 'Gemini の利用上限に近いため、プランを作成できません。しばらくしてから、もう一度お試しください。',
    offline: 'サーバーに接続できませんでした。通信状況を確認して、もう一度お試しください。',
    noPlaces: '候補を取得できませんでした。場所を変えて、もう一度お試しください。',
    offer: 'より良い案があります',
    offerCrowd: (d: string, less: boolean) => `混雑する場所にいる時間が${d}${less ? '短く' : '長く'}なります`,
    offerMove: (d: string, less: boolean) => `移動の時間が${d}${less ? '短く' : '長く'}なります`,
    offerStops: (n: number) => `場所が${Math.abs(n)}か所${n > 0 ? '増えます' : '減ります'}`,
    offerSwap: (n: number) => `${n}か所が入れ替わります`,
    offerJoin: (parts: string[]) => `${parts.join('。')}。`,
    offerTake: '入れ替える',
    offerKeep: '変更しない',
    offerTaken: 'プランを入れ替えました',
    same: 'プランは変更されませんでした',
    moveUp: (d: string, after: string) => `${/[。！？]$/.test(after) ? '' : '。'}移動の時間が${d}長くなりました`,
    dropped: '時間に合わせて{n}を削除しました',
    filled: '空いた時間に{n}を追加しました',
    mealSwap: (label: string) => `${label}を{a}から{b}に変更しました`,
    moreMoved: (n: number) => `ほかに${n}か所が変更されました`,
    moreChanges: (n: number) => `ほかの変更（${n}件）`,
    fillMore: '空いた時間に場所を追加',
    fillDone: '空いた時間に場所を追加しました',
    changedTo: '{n}に変更しました',
    removed: '{n}をプランから削除しました',
    moved: (k: number) => `{n}を${k}番目に移動しました`,
    paceMany: '滞在を短くし、ゆとりをなくしました',
    paceSlow: '滞在とゆとりを長くしました',
    paceNormal: '見どころの滞在とゆとりを、標準に戻しました',
    moveLessOn: '移動を減らしてプランを更新しました',
    carOn: '車で回るようにプランを更新しました',
    carOff: '徒歩と電車・バスで回るようにプランを更新しました',
    moveLessOff: '移動を減らす設定をオフにしました',
    calmOn: '混雑を避けてプランを更新しました',
    calmOff: '混雑の避け方を、標準に戻しました',
    stayAt: (d: string) => `滞在を${d}にしました`,
    stayAuto: '滞在の長さを自動に戻しました',
    districtBack: '{n}を回る地区に戻しました',
    slotTo: (label: string) => `${label}を{n}に変更しました`,
    added: '{n}をプランに追加しました',
    focusOff: 'この近くの優先をオフにしました',
    gone: '{n}を削除しました',
    putBack: '{n}をプランに戻しました',
    noNear: 'この近くに追加できる場所はありません',
    nearAdded: '{n}を追加しました',
    districts: '回る地区を変更しました',
    quotaAsk: 'Gemini の利用上限に近いため、今は頼めません。しばらくしてから、もう一度お試しください。',
    finding: '候補を検索しています……（30〜40秒）',
    findFailed: '新しい候補を検索できませんでした。別の言い方で、もう一度お試しください。',
    noneFound: '条件に合う新しい候補は見つかりませんでした。',
    foundAdded: '{n}をプランに追加しました',
    askFailed: '頼んだ内容を認識できませんでした。別の言い方で、もう一度お試しください。',
    talkQuota: 'Gemini の利用上限に近いため、欄に入力してください。',
    talkOffline: 'サーバーに接続できないため、欄に入力してください。',
    talkFailed: 'Gemini で読み取れなかったため、欄に入力してください。',
    talkEmpty: '読み取れませんでした。別の言い方で書いてください。',
    nothing: '変更できる箇所が見つかりませんでした。',
    changed: 'プランを変更しました',
    shareDepart: (n: string) => `${n}を出発`,
    down: '　↓ ',
    shareEase: (m: number) => `・ゆとり ${m}分`,
    shareStop: (n: string, d: string) => `${n}（${d}）`,
    shareArrive: (n: string) => `${n}に到着`,
    shareMaps: 'Google マップで見る',
    shareTitle: (a: string) => `${a}のプラン`,
    copied: 'プランをコピーしました',
    copyFailed: 'プランをコピーできませんでした',
    findingMore: 'ほかの候補を検索しています……',
    partial: '一部の候補を取得できませんでした。',
    back: '戻る',
    backToPlan: 'プランに戻る',
    plan: 'プラン',
    adjust: 'Gemini に頼む',
    adjustPlain: '条件を変更',
    home: '自分の旅',
    making: 'プランを作成しています……',
    summary: '概要',
    firstAt: '最初は',
    toSched: 'スケジュールへ',
    toSchedOf: (t: string, n: string) => `スケジュールへ移動（最初は${t} ${n}）`,
    stopsN: (n: number) => `${n}か所`,
    movingN: (d: string) => `移動 ${d}`,
    breakdown: '時間の内訳',
    placesL: '場所',
    timeRange: (a: string, b: string) => `${a}から${b}まで`,
    stayN: '滞在',
    movingL: '移動',
    waitL: '待ち・ゆとり',
    sep: '・',
    late: (d: string, oneWay: boolean, t: string) => `${oneWay ? '設定した到着' : '希望の帰る時刻'}（${t}）より${d}${oneWay ? '遅れます' : '遅くなります'}。`,
    early: (d: string, oneWay: boolean, t: string) => `${oneWay ? '設定した到着' : '帰る時刻'}（${t}）まで${d}あります`,
    fitAsk: '時間内に収まりません。どの場所を削除しますか？',
    fitDrop: (n: string) => `${n}を削除`,
    wishFitN: (n: number) => `希望に合う場所を${n}か所追加しました`,
    fillShort: '場所を追加',
    listSep: '、',
    fitAskNext: (d: number) => `時間内に収まりません。${d}日目以降に回す場所を選んでください。`,
    fitCarry: (n: string, d: number) => `${n}を${d}日目以降に回す`,
    carriedOne: (d: number) => `{n}を${d}日目以降に回しました`,
    carried: (n: number, d: number) => `${n}か所を${d}日目以降に回しました`,
    carriedLast: (n: number) => `${n}か所が入りきりませんでした`,
    schedule: 'スケジュール',
    pick: '場所を追加・削除',
    editOrder: '並べ替え',
    doneOrder: '完了',
    footMore: 'ほかの候補を検索しています。より良い案が見つかった場合は、入れ替えるかどうかを確認します。',
    footChecking: '地図で位置を確認しています。',
    footPartial: '一部の候補を取得できませんでした。',
    footEstimate: '電車・バスの時間は目安です。',
    footCar: '車の時間は目安です。',
    osmRail: '経路・位置・電車の路線と駅:',
    busAdded: (t: string) => `${t}発の{n}を選択しました`,
    busRemoved: '便の選択を解除しました',
    routeAdded: '経路を追加しました',
    routeRemoved: '追加した経路を削除しました',
    legWalk: 'この区間を徒歩に変更しました',
    legTransit: 'この区間を電車・バスに変更しました',
    legCar: 'この区間を車に変更しました',
    legAuto: 'この区間の手段を自動に戻しました',
    undo: '元に戻す',
    recap: '旅の振り返り',
    recapOpen: '旅を振り返る',
    favBack: '一番楽しみな場所を選択',
  },
  en: {
    shareRide: (train: boolean, m: number) => `${train ? 'Train' : 'Bus'} ${m} min`,
    more: (two: string[], n: number) => `${two.join(', ')}, and ${n} more`,
    farWish: (n: string) => `Couldn’t add ${n} because it’s too far`,
    tableFixed: 'Travel times now match the timetables',
    railFixed: 'Travel times now match the rail lines',
    quotaPlan: 'Gemini is near its usage limit, so a plan can’t be created now. Please try again later.',
    offline: 'Couldn’t connect to the server. Check your connection and try again.',
    noPlaces: 'Couldn’t find places for this trip. Try a different place.',
    offer: 'A better plan is available',
    offerCrowd: (d: string, less: boolean) => `${d} ${less ? 'less' : 'more'} time in crowded places`,
    offerMove: (d: string, less: boolean) => `${d} ${less ? 'less' : 'more'} travel time`,
    offerStops: (n: number) => `${Math.abs(n)} ${n > 0 ? 'more' : 'fewer'} ${Math.abs(n) === 1 ? 'place' : 'places'}`,
    offerSwap: (n: number) => `${n} ${n === 1 ? 'place changes' : 'places change'}`,
    offerJoin: (parts: string[]) => `${parts.join('. ')}.`,
    offerTake: 'Switch Plans',
    offerKeep: 'Keep This Plan',
    offerTaken: 'Switched to the new plan',
    same: 'The plan didn’t change',
    moveUp: (d: string, after: string) => `${/[.!?]$/.test(after) ? ' ' : '. '}${d} more travel time`,
    dropped: 'Removed {n} to fit the time',
    filled: 'Added {n} to fill free time',
    mealSwap: (label: string) => `Changed ${label.toLowerCase()} from {a} to {b}`,
    moreMoved: (n: number) => `${n} more ${n === 1 ? 'place' : 'places'} changed`,
    moreChanges: (n: number) => `${n} more ${n === 1 ? 'change' : 'changes'}`,
    fillMore: 'Add places to free time',
    fillDone: 'Added places to free time',
    changedTo: 'Changed to {n}',
    removed: 'Removed {n} from the plan',
    moved: (k: number) => `Moved {n} to stop ${k}`,
    paceMany: 'Shortened stays at sights and removed buffers to see more places',
    paceSlow: 'Lengthened stays at sights and buffers for a slower pace',
    paceNormal: 'Stays at sights and buffers are back to normal',
    moveLessOn: 'Rebuilt the plan with less travel',
    carOn: 'Rebuilt the plan to get around by car',
    carOff: 'Rebuilt the plan to get around on foot and by transit',
    moveLessOff: 'No longer prioritizing less travel',
    calmOn: 'Rebuilt the plan to avoid more crowds',
    calmOff: 'Crowd avoidance is back to normal',
    stayAt: (d: string) => `Stay set to ${d}`,
    stayAuto: 'Stay length is back to automatic',
    districtBack: 'Turned {n} back on',
    slotTo: (label: string) => `Changed ${label.toLowerCase()} to {n}`,
    added: 'Added {n} to the plan',
    focusOff: 'No longer prioritizing this area',
    gone: 'Removed {n}',
    putBack: 'Put {n} back in the plan',
    noNear: 'No more places to add nearby',
    nearAdded: 'Added {n}',
    districts: 'Changed districts',
    quotaAsk: 'Gemini is near its usage limit, so your request can’t be sent now. Please try again later.',
    finding: 'Finding new places… (30–40 seconds)',
    findFailed: 'Couldn’t find new places. Try wording it differently.',
    noneFound: 'No new places matched your request.',
    foundAdded: 'Found {n} and added to the plan',
    askFailed: 'Couldn’t understand your request. Try wording it differently.',
    talkQuota: 'Gemini is near its usage limit. Enter your trip below.',
    talkOffline: 'Couldn’t connect to the server. Enter your trip below.',
    talkFailed: 'Gemini couldn’t read your trip. Enter it below.',
    talkEmpty: 'Couldn’t read that. Try writing it another way.',
    nothing: 'Nothing could be changed.',
    changed: 'Changed the plan',
    shareDepart: (n: string) => `Depart ${n}`,
    down: '  ↓ ',
    shareEase: (m: number) => ` · ${m} min buffer`,
    shareStop: (n: string, d: string) => `${n} (${d})`,
    shareArrive: (n: string) => `Arrive ${n}`,
    shareMaps: 'View in Google Maps',
    shareTitle: (a: string) => `${a} Plan`,
    copied: 'Plan copied',
    copyFailed: 'Couldn’t copy the plan',
    findingMore: 'Finding more places…',
    partial: 'Some places couldn’t be loaded.',
    back: 'Back',
    backToPlan: 'Back to Plan',
    plan: 'Plan',
    adjust: 'Ask Gemini',
    adjustPlain: 'Change Conditions',
    home: 'Your Trips',
    making: 'Creating your plan…',
    summary: 'Overview',
    firstAt: 'First',
    toSched: 'Schedule',
    toSchedOf: (t: string, n: string) => `Go to the schedule (first: ${n} at ${t})`,
    stopsN: (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`,
    movingN: (d: string) => `${d} travel`,
    breakdown: 'Time Breakdown',
    placesL: 'Places',
    timeRange: (a: string, b: string) => `${a} to ${b}`,
    stayN: 'Stays',
    movingL: 'Travel',
    waitL: 'Waits & Buffer',
    sep: ' · ',
    late: (d: string, oneWay: boolean, t: string) => `You’ll ${oneWay ? 'arrive' : 'return'} ${d} after your set time (${t}).`,
    early: (d: string, oneWay: boolean, t: string) => `${d} to spare before your ${oneWay ? 'arrival' : 'return'} time (${t})`,
    fitAsk: 'Not everything fits. Which place should go?',
    fitDrop: (n: string) => `Remove ${n}`,
    wishFitN: (n: number) => `Added ${n} ${n === 1 ? 'place' : 'places'} that ${n === 1 ? 'matches' : 'match'} your wish`,
    fillShort: 'Add Places',
    listSep: ', ',
    fitAskNext: (d: number) => `Not everything fits. Choose places to move to Day ${d} or later.`,
    fitCarry: (n: string, d: number) => `Move ${n} to Day ${d} or later`,
    carriedOne: (d: number) => `Moved {n} to Day ${d} or later`,
    carried: (n: number, d: number) => `Moved ${n} ${n === 1 ? 'place' : 'places'} to Day ${d} or later`,
    carriedLast: (n: number) => `${n} ${n === 1 ? 'place' : 'places'} didn’t fit`,
    schedule: 'Schedule',
    pick: 'Add or Remove Places',
    editOrder: 'Reorder',
    doneOrder: 'Done',
    footMore: 'Finding more places. If a better plan turns up, you can choose to switch. ',
    footChecking: 'Checking locations on the map. ',
    footPartial: 'Some places couldn’t be loaded. ',
    footEstimate: 'Train and bus times are estimates.',
    footCar: 'Driving times are estimates.',
    osmRail: 'Routes, locations, rail lines, and stations:',
    busAdded: (t: string) => `Added the ${t} {n}`,
    busRemoved: 'Removed the departure',
    routeAdded: 'Added the route',
    routeRemoved: 'Removed the added route',
    legWalk: 'You’ll walk this part',
    legTransit: 'You’ll take transit for this part',
    legCar: 'You’ll drive this part',
    legAuto: 'The app will choose how to get there',
    undo: 'Undo',
    recap: 'Trip Recap',
    recapOpen: 'Look Back on Your Trip',
    favBack: 'Pick the Place You Look Forward to Most',
  },
})

type Busy = { job: JobState; since: number } | null
// 「元に戻す」で戻す分（プランの選び直しに関わるものと、開いていた場所）
type Snapshot = {
  must: string[]
  pinned: Pin[]
  banned: string[]
  overrides: Record<string, TransitRoute>
  modes: Record<string, LegMode>
  stayFix: Record<string, number>
  focus: string[]
  focusAdds: Record<string, FocusAdd>
  skipDistricts: string[]
  base: BaseItem[] | null
  loose: string[]
  openId: string | null
  start: number
  end: number
  conds: Condition[]
  pace: Pace
  moveLess: boolean
  calm: boolean
  fill: boolean
  leeway: number
  car: boolean
}
// 帯の文。名前（nm）は長ければ省略し、文の途中で折り返さないように区切って並べる
type Part = { t: string; nm?: boolean; w?: boolean }
// same: 手を入れる前のプランの印（組み直して同じだったら、変わらなかったと出す）
// 帯の内訳の 1 行。n: その行で変わった場所の数（場所の変更でない知らせには無い）
type Line = { parts: Part[]; n?: number }
// from: 手を入れる前の並び（組み直したあとに、外れた店と入った店が同じ枠かを見る）
// keep: あとから来た知らせで置き換えず、1 行足す帯（入りきらない場所を回した知らせ）
type Toast = { id: number; parts: Part[]; subs: Line[]; undo?: Snapshot; follow?: boolean; same?: string; from?: BaseItem[]; moving?: number; keep?: boolean }

// 文の中の words（「2時間4分」「18:00」など）を、途中で折り返さない 1 かたまりにする
function keepWhole(text: string, ...words: string[]): ReactNode {
  const hit = words.filter(Boolean).sort((a, b) => b.length - a.length)
  if (!hit.length) return text
  const re = new RegExp(`(${hit.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
  return text.split(re).map((x, i) => (i % 2 ? <span key={i} className="nw">{x}</span> : x))
}

// 帯の文を、名前（{n} の所）とそれ以外に分ける
const say = (tmpl: string, name: string): Part[] => {
  const [a, b = ''] = tmpl.split('{n}')
  return [...(a ? [{ t: a }] : []), { t: name, nm: true }, ...(b ? [{ t: b }] : [])]
}
// 名前が 2 つの文（{a} と {b}）
const say2 = (tmpl: string, a: string, b: string): Part[] =>
  tmpl.split(/(\{[ab]\})/).filter(Boolean).map((x) => (x === '{a}' ? { t: a, nm: true } : x === '{b}' ? { t: b, nm: true } : { t: x }))
// 場所・順番・時刻を 1 つの文字列にした印
const planSig = (p: Plan) => [p.leave, ...p.stops.flatMap((s) => [s.spot.id, Math.round(s.arrive), Math.round(s.depart)]), p.finish].join('|')
// 区間ごとの前の場所・次の場所・前の場所を出る時刻（0 は出発地から、最後は到着地へ向かう区間。到着地が無ければ出発地へ戻る）
type LegInfo = { index: number; key: string; from: Point; to: Point; fromName: string; toName: string; after: number; leg: Leg; note: TimeNote }
function legInfos(data: AreaData, plan: Plan): LegInfo[] {
  const n = plan.stops.length
  const goal = goalOf(data)
  return Array.from({ length: n + 1 }, (_, i) => {
    const prev = i ? plan.stops[i - 1] : null
    const next = i < n ? plan.stops[i] : null
    return {
      index: i,
      key: legKey(prev ? prev.spot.id : 'start', next ? next.spot.id : goalId(data)),
      from: prev ? prev.spot : data.start,
      to: next ? next.spot : goal,
      fromName: prev ? prev.spot.name : data.start.name,
      toName: next ? next.spot.name : goal.name,
      after: prev ? prev.depart : plan.leave,
      leg: next ? next.leg : plan.back,
      note: next ? next.timeNote : plan.backTimeNote,
    }
  })
}
// 最初のプランを組む前に、時刻表の目安の表を待つ長さ（ミリ秒）
const TABLE_WAIT = 2500
// 候補がそろったあと、入れ替えるかを聞くプランの良さの差（組み立ての点数）
// 帰る時刻に入りきらないときに、外す候補として出す場所の数
const FIT_ASK_MAX = 4
// 外す場所を聞くのは、帰る時刻をこの分以上過ぎるときだけ（少しの遅れは滞在を短くすれば収まる）
const FIT_ASK_LATE = 15
const OFFER_GAIN = 5
// 入力の画面の出発の時刻の最初の値（0 時からの分）
const FIRST_START = 10 * 60
// 泊まりの旅の日の最初のプランで、入りきらない場所を外す前に、移動の表の作り直しを待つ上限（ミリ秒）
const CARRY_WAIT = 6000
// 例のプラン（sample.json）に同梱できる、時刻表の目安の表（/api/bus-table の答えと、頼んだ日付・時間帯）
type PackedTable = TransitTable & { date: string; start: number; end: number; sources: BusSource[] }
// 文をクリップボードに写す。写せたら true（クリップボードの API が断られたら、選んで写す古い形で試す）
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.appendChild(box)
    box.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      box.remove()
    }
  }
}
// 共有の文では、時刻表から選んだ便の中身（系統・停留所）を出さない
const shareLabel = (leg: Leg) => (leg.real?.bus ? T.shareRide(isTrain(leg.real.bus), leg.minutes) : leg.label)
const names = (list: string[]) => (list.length > 2 ? T.more(list.slice(0, 2), list.length - 2) : joinNames(list))
// ホーム画面から旅を開くと、App を作り直す（main.tsx）。作り直したあとはホーム画面を飛ばしてプランを出す
let reopened = false
onTripOpen(() => {
  reopened = true
})

// 送る出発地・到着地（欄に書いた文字と、引いた場所）
const tripPoint = (f: PlaceField, h: GeoHit): TripPoint => ({ text: f.text.trim(), name: h.name, ...(h.ja && { ja: h.ja }), lat: h.lat, lng: h.lng })
const hitOf = (p: TripPoint): GeoHit => ({ name: p.name, ...(p.ja && { ja: p.ja }), lat: p.lat, lng: p.lng })
// 作ったプランの頼みから、入力の画面の出発地と到着地を戻す（前の形はエリアの名前を出発地の欄に入れる）
function fillForm(q: NonNullable<AreaData['query']>, from: PlaceField, to: PlaceField, setBack: (v: boolean) => void, setPreset: (v: string | null) => void) {
  if (q.start) {
    from.set(q.start.text, hitOf(q.start))
    setPreset(q.area && q.area !== q.start.text ? q.area : null)
    setBack(!q.end)
    to.set(q.end?.text ?? '', q.end ? hitOf(q.end) : null)
  } else {
    from.set(q.area, null)
    setPreset(null)
    setBack(true)
    to.set('', null)
  }
}

const minutesNow = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

export default function App() {
  // Google マップのキーがあれば Google マップ、無い・通らなかった・読み込めなかったら MapLibre の地図
  const [google, setGoogle] = useState(hasGoogleMaps)
  useEffect(() => onMapsUnavailable(() => setGoogle(false)), [])
  const MapPart = google ? GoogleMapView : MapView
  const [data, setData] = useState<AreaData | null>(null)
  // このブラウザに取ってある、自分で作ったプラン（前の始まり方の例のプランは開かない）
  const [saved] = useState(() => {
    const s = readSaved()
    return s && !s.example ? s : null
  })
  // もう片方の言語で作った端末のプラン（言語を切り替えたあとも、ホーム画面に出す。例のプランを見ただけのものは出さない）
  const [other] = useState(() => {
    const o = readOtherSaved()
    return o && !untouchedDemo(o) ? o : null
  })
  // 開いたら、いつもホーム画面を出す（旅が無い人も、ホーム画面から新しい旅を作るか例のプランを見る）。
  // 旅を開いて作り直したときと、言語を変えてそのプランを開くと頼んで読み直したときは、プランを出す。
  // URL に ?start=pick があるときは、例のエリアの選ぶ画面から始める。?example があるときは、例のプランをすぐ組む。
  // 入力の画面で言語を変えたときは、空の入力の画面を出す
  const [view, setView] = useState<'home' | 'pick' | 'form' | 'plan'>(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.has('example')) {
      askExample()
      return 'pick'
    }
    if (q.get('start') === 'pick') return 'pick'
    if (openAfterLang() === 'form') return 'form'
    if (saved && (reopened || openAfterLang() === 'plan')) return 'plan'
    return 'home'
  })
  // 選ぶ画面から離れたら、URL の ?start=pick を外す（読み直したときに、例の選ぶ画面へ戻らないように）
  useEffect(() => {
    if (view === 'pick') return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('start')) return
    url.searchParams.delete('start')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [view])
  // 画面が替わったら先頭から見せる（markBack を呼んでから戻したときは、離れたときの位置に戻す）
  const markBack = useViewScroll(view)
  // 例のプランの URL で開いたら、URL から ?example を外し、「戻る」の先にホーム画面を置く（読み直しで、例のプランを組み直さないように）
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('example')) return
    url.searchParams.delete('example')
    homeBelow()
    window.history.replaceState(window.history.state, '', url.toString())
  }, [])
  // 新しい旅の入力の画面を開く前の欄（「戻る」で入力の画面を離れたら戻す。端末の旅の欄を空で保存し直さないため）
  const fieldsBefore = useRef<{ from: string; fromHit: GeoHit | null; to: string; toHit: GeoHit | null; back: boolean; preset: string | null; wish: string; car: boolean; date?: string; times?: { start: number; end: number; leeway: number } } | null>(null)
  // 入力の画面から旅を作って離れたら、取っておいた欄は使わない
  useEffect(() => {
    if (view !== 'form') fieldsBefore.current = null
  }, [view])
  // 入力の画面をどこから開いたか（「戻る」で戻す先）
  const [formFrom, setFormFrom] = useState<'home' | 'pick' | 'plan'>(() => (openAfterLang() === 'form' ? 'home' : 'plan'))
  // 行きたい場所を選ぶ画面に出すエリア（入力の画面で集めた候補。null なら例のエリア）。key: 新しいエリアが届くたびに選び直す
  const [pick, setPick] = useState<{ data: AreaData; key: number } | null>(null)
  // 選ぶ画面で候補を受け取っている作成の番号（プランを作ったら null）
  const pickJob = useRef<number | null>(null)
  // 入力の画面の出発地と到着地（back: 出発地に戻る。preset: 作ったプランから戻したときの、そのプランのエリアの名前）
  const from = usePlaceField()
  const to = usePlaceField()
  const [back, setBack] = useState(true)
  const [preset, setPreset] = useState<string | null>(null)
  const [wish, setWish] = useState('')
  // 車で回る旅か（入力の画面で選んでいる分と、作った旅の分。旅の全日で 1 つ）
  const [carTrip, setCarTrip] = useState(false)
  // 車で回る旅（例のプランは車で回らない）
  const car = carTrip && !data?.demo
  // 入力の画面で、車で回るかを本人が切り替えたか（切り替えるまでは、希望の文と 1 行の文に書いてあるかで決める）
  const carTouched = useRef(false)
  const [conds, setConds] = useState<Condition[]>([])
  const [must, setMust] = useState<string[]>([])
  // 選ぶ画面で見せた、希望に名前を書いた場所（あとから届いた分だけをプランに足すため）
  const namedSeen = useRef(new Set<string>())
  const [date, setDate] = useState(nextSaturday())
  const [tripSince, setTripSince] = useState(0)
  // この旅のプランに本人が手を入れたか（例のプランを、見ただけなら端末の棚とクラウドに残さないため）
  const [edited, setEdited] = useState(false)
  // 何日かある旅の全日（開いている日の位置は null）と、開いている日。1 日の旅は null
  const [days, setDays] = useState<(Saved | null)[] | null>(null)
  const [dayAt, setDayAt] = useState(0)
  // 予定している日数（作った日数より多ければ、まだ作っていない日も日の切り替えに出す）と、入力の画面で選んでいる日数
  const [planDays, setPlanDays] = useState(1)
  const [formDays, setFormDays] = useState(1)
  // 泊まる宿と、旅の最後に観光を終える場所（null なら 1日目の出発地。undefined はまだ決めていない）。
  // 入力の画面の宿の欄と、プランを変更のシートの宿の欄。作った直後に入れる宿（入力の画面で入れた分）
  const [stays, setStays] = useState<Stays>([])
  const [tripEnd, setTripEnd] = useState<TripPoint | null | undefined>(undefined)
  // 宿の欄は泊ごと（k 番目が、入力の画面では k+1 泊目、シートではこれから作る日に効く k+1 番目の泊）。毎晩同じ宿に泊まるか
  const stayForm1 = usePlaceField()
  const stayForm2 = usePlaceField()
  const stayForm3 = usePlaceField()
  const staySheet1 = usePlaceField()
  const staySheet2 = usePlaceField()
  const staySheet3 = usePlaceField()
  const stayForms = [stayForm1, stayForm2, stayForm3]
  const staySheets = [staySheet1, staySheet2, staySheet3]
  const [sameStay, setSameStay] = useState(true)
  const [sheetSame, setSheetSame] = useState(true)
  const formStay = useRef<{ stays: Stays; end: TripPoint | null } | null>(null)
  // 旅を作る画面の形（日帰り・泊まりを 1 行の文から・泊まりを欄で）と、1 行の文から読み取った旅のまとめ。
  // talkLast: 直前に送った文、talkPassed: もう聞いた任意の問い、formNote: 欄に切り替えたわけ（Gemini を使えなかったとき）
  const [formKind, setFormKind] = useState<'day' | 'talk' | 'form'>('day')
  const [talk, setTalk] = useState<Talk>({})
  const [talkLast, setTalkLast] = useState('')
  const [talkPassed, setTalkPassed] = useState<Question[]>([])
  const [talkBusy, setTalkBusy] = useState(false)
  const [talkError, setTalkError] = useState('')
  const talkBusyRef = useRef(false)
  // 1 行の文を送るたびの番号。切り替え・新しい旅・欄の形へ移ると進め、送った時と違う番号の返事は捨てる
  const talkSeq = useRef(0)
  const dropTalk = () => {
    talkSeq.current++
    talkBusyRef.current = false
    setTalkBusy(false)
  }
  const [formNote, setFormNote] = useState('')
  // 旅全体の希望と日ごとの希望と時刻（作った旅の分と、入力の画面から作った直後に入れる分）
  const [wants, setWants] = useState<TripWants | undefined>(undefined)
  const formWants = useRef<TripWants | undefined>(undefined)
  // 泊まりの旅で、入りきらずにプランから外した見どころ（旅の全日で 1 つ）と、
  // 選ぶ画面から作った日の最初のプランで、入りきらない見どころを外すか（next: 次の日。最終日は null）
  const [carry, setCarry] = useState<Spot[]>([])
  const carryAsk = useRef<{ next: number | null; at: number } | null>(null)
  const [carryTick, setCarryTick] = useState(0)
  // 次の日を加えている間（候補を選ぶ画面を開いてから、プランを作るまで）。n: 加える日（1 始まり）
  const [adding, setAdding] = useState<{ n: number; date: string } | null>(null)
  const [addError, setAddError] = useState('')
  // 選ぶ画面から作った直後に、一番楽しみな場所を聞く旅（その旅の since。0 は聞かない）と、聞き終えた旅
  const [favSince, setFavSince] = useState(0)
  const favDone = useRef(new Set<number>())
  // 閉じた「一番楽しみな場所は？」を、本人が開き直したか（開き直したときは、理由が入っていても聞く）
  const [favAgain, setFavAgain] = useState(false)
  const [nudgeSince, setNudgeSince] = useState(0) // 旅を作った直後の旅の since（開き直したときは 0 に戻る）
  const [start, setStart] = useState(FIRST_START)
  const [end, setEnd] = useState(18 * 60)
  const [pinned, setPinned] = useState<Pin[]>([])
  const [banned, setBanned] = useState<string[]>([])
  const [overrides, setOverrides] = useState<Record<string, TransitRoute>>({})
  // 本人が選んだ区間の手段（徒歩・電車とバス）。無い区間は自動で選ぶ
  const [modes, setModes] = useState<Record<string, LegMode>>({})
  // 歩く区間の、移動の手段を選ぶ画面（区間の番号）
  const [walkIdx, setWalkIdx] = useState<number | null>(null)
  const [crowdOpen, setCrowdOpen] = useState(false)
  const [stayFix, setStayFix] = useState<Record<string, number>>({})
  const [picker, setPicker] = useState(false)
  // ホーム画面の「振り返る」から旅を開いたときは、振り返りカードを開いて始める
  const [recap, setRecap] = useState(() => reopened && recapOnOpen())
  const [planImage, setPlanImage] = useState(false)
  const [focus, setFocus] = useState<string[]>([])
  const [focusAdds, setFocusAdds] = useState<Record<string, FocusAdd>>({})
  const [skipDistricts, setSkipDistricts] = useState<string[]>([])
  const [pace, setPace] = useState<Pace>('normal')
  const [moveLess, setMoveLess] = useState(false)
  const [calm, setCalm] = useState(false)
  // 空いた時間に、選んでいない場所も足すか（場所を選んで作ったときは足さない。「空いた時間に場所を追加」で足す）
  const [fill, setFill] = useState(true)
  // 帰る時刻（到着の時刻）より早く終わってもよい時間（分）
  const [leeway, setLeeway] = useState(0)
  const [base, setBase] = useState<BaseItem[] | null>(null)
  // 場所と並びを変えずに時刻だけを直す base（この集まりに入っている配列の base のとき）
  const held = useRef(new WeakSet<BaseItem[]>())
  const hold = (b: BaseItem[]) => {
    held.current.add(b)
    setBase(b)
  }
  // 候補がそろったあとの、より良い案（ask: 裏で組んで比べる番号。0 なら比べない）
  const [offerAsk, setOfferAsk] = useState(0)
  const [offer, setOffer] = useState<{ base: BaseItem[]; crowd: number; move: number; stops: number; swap: number } | null>(null)
  // 今見せているプランの並び（取っておき、開き直したときに同じプランを出す）
  const [shownOrder, setShownOrder] = useState<BaseItem[] | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const [loose, setLoose] = useState<string[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const [toastOpen, setToastOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [transitIdx, setTransitIdx] = useState<number | null>(null)
  // 時刻表から作った、場所どうしのバス・電車で戸口から戸口までの目安（プランの日ごと。エリアの場所と並びが合うものだけ使う）
  const [busTable, setBusTable] = useState<{ date: string; table: TransitTable; sources: BusSource[] } | null>(null)
  const tableFor = useRef('')
  // 例のプランに同梱の時刻表を当てたときの条件（同じ条件の間は、時刻表を取りに行かない）
  const packed = useRef<{ data: AreaData; date: string; start: number; end: number } | null>(null)
  const askedFor = useRef('')
  // 時刻表の便（区間ごと。探したときの日と出る時刻も覚え、今のプランと合うものだけを出す）
  const [busInfo, setBusInfo] = useState<BusInfo>({ on: false, sources: [], contact: null })
  // busInfo を聞き終えた日付とエリアの範囲（聞いている間は、時刻表が無いと言わない）
  const [busAsked, setBusAsked] = useState('')
  const [busFor, setBusFor] = useState<Record<string, { date: string; after: number; trips: BusTrip[] }>>({})
  const [busSheet, setBusSheet] = useState<{ idx: number; after: number; trips: BusTrip[] | null } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [candId, setCandId] = useState<string | null>(null)
  // 「場所を追加・削除」で開いている候補（地図にその候補を大きく出す）
  const [pickerShow, setPickerShow] = useState<string | null>(null)
  // この付近で検索（地図の「この付近を検索」から開く）。box: 探す範囲、q: 最後に探した言葉、picked: 開いている結果の place_id。
  // 結果は Google の Places の内容なので、保存しない（画面を閉じたら捨てる）
  const [area, setArea] = useState<{ box: AreaBox | null; q: string; busy: boolean; error: FoundError | null; found: Found[] | null; picked: string | null } | null>(null)
  const googleShown = useGoogleMapShown()
  // 画面やエリアが変わったら、この付近で検索の結果を捨てる（Places の内容を、ほかの旅や Google 以外の地図に残さない）
  const areaKey = `${view}|${data?.area.name ?? ''}|${googleShown}`
  useEffect(() => {
    setArea(null)
  }, [areaKey])
  // 地図が入れる、今見えている範囲を測る関数（探すときに測る）
  const areaBoxRef = useRef<(() => AreaBox | null) | null>(null)
  // 場所の画面の「ほかの候補」から開いた候補（from の場所と入れ替えるかを考えている間）
  const [peek, setPeek] = useState<{ from: string; id: string } | null>(null)
  const [odaiCount, setOdaiCount] = useState(readCount)
  const [odaiLevel, setOdaiLevel] = useState<OdaiLevel>(readLevel)
  // スケジュールの並べ替えのあいだ（「並べ替え」を押したあと）
  const [editing, setEditing] = useState(false)
  const [adjust, setAdjust] = useState(false)
  // シートを開いたら、宿の欄を旅の宿にする
  useEffect(() => {
    if (!adjust || !data) return
    const made = allDays(savedNow(data)).length
    staySheets.forEach((f, j) => {
      const at = stays[made + j] ?? null
      f.set(at?.text ?? '', at ? hitOf(at) : null)
    })
    setSheetSame(stays.slice(made + 1).every((t) => !t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust])
  // 振り返りの画面から、この場所の「選んだ理由」の欄へ送る（場所の画面が開いたら消す）
  const [whyFor, setWhyFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<{ more: boolean } | null>(null)
  const [partial, setPartial] = useState(false)
  const [error, setError] = useState('')
  const [weather, setWeather] = useState<Weather | null>(null)
  // 天気とバス・電車の時刻表を取りに行っている間（届くとプランの資料が変わるので、ペンギンの一言は届いてから頼む）
  const [weatherBusy, setWeatherBusy] = useState(true)
  const [tableBusy, setTableBusy] = useState(true)
  const [now, setNow] = useState(minutesNow)
  const [, tick] = useState(0)
  const timer = useRef<number | null>(null)
  const jobSeq = useRef(0)
  const condsTouched = useRef(false)

  const apply = useCallback((d: AreaData) => {
    setData(d)
    setConds(d.conditions)
    condsTouched.current = false
    setMust([])
    setPinned([])
    setBanned([])
    setOverrides({})
    setModes({})
    setStayFix({})
    setFocus([])
    setFocusAdds({})
    setSkipDistricts([])
    setBase(null)
    setOfferAsk(0)
    setOffer(null)
    setShownOrder(null)
    setLoose([])
    setToast(null)
    setOpenId(null)
    setPartial(false)
    setView('plan')
    if (d.query) {
      fillForm(d.query, from, to, setBack, setPreset)
      setWish(d.query.wish)
    }
    // from・to の set は作り直さない（usePlaceField）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 取ってあるプランは、最初の画面を描く前に戻す
  useLayoutEffect(() => {
    if (saved) {
      setData(saved.data)
      if (openAfterLang() !== 'form') {
        from.set(saved.areaText, saved.form?.fromHit ?? null)
        to.set(saved.form?.to ?? '', saved.form?.toHit ?? null)
        setBack(saved.form?.back ?? true)
        setPreset(saved.form?.preset ?? null)
        setWish(saved.wish)
      } else {
        fieldsBefore.current = { from: saved.areaText, fromHit: saved.form?.fromHit ?? null, to: saved.form?.to ?? '', toHit: saved.form?.toHit ?? null, back: saved.form?.back ?? true, preset: saved.form?.preset ?? null, wish: saved.wish, car: !!saved.car }
      }
      setConds(saved.conds)
      condsTouched.current = saved.condsTouched
      setDate(saved.date)
      setStart(saved.start)
      setEnd(saved.end)
      setMust(saved.must)
      setPinned(saved.pinned)
      setBanned(saved.banned)
      setOverrides(saved.overrides)
      setModes(saved.modes ?? {})
      setStayFix(saved.stayFix)
      setFocus(saved.focus)
      setFocusAdds(saved.focusAdds ?? {})
      setSkipDistricts(saved.skipDistricts)
      if (saved.shown?.length) hold(saved.shown)
      else setBase(saved.base)
      setLoose(saved.loose ?? [])
      setPace(saved.pace ?? 'normal')
      setMoveLess(!!saved.moveLess)
      setCalm(!!saved.calm)
      setFill(saved.fill ?? true)
      setLeeway(saved.leeway ?? 0)
      setTripSince(saved.since ?? 0)
      setEdited(!!saved.edited)
      setPlanDays(plannedDays(saved))
      setStays(saved.stays ?? [])
      setTripEnd(saved.tripEnd)
      setWants(saved.wants)
      setCarry(saved.carry ?? [])
      setCarTrip(!!saved.car && openAfterLang() !== 'form')
      dropTalk()
      if (saved.days && saved.days.length > 1) {
        setDays(saved.days)
        setDayAt(dayIndex(saved))
      }
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [saved])

  // 手を入れるたびに、このブラウザに取っておく
  const savedNow = (d: AreaData): Saved => {
    const form = { fromHit: from.hit, back, to: to.text, toHit: to.hit, preset }
    return { data: d, areaText: from.text, form, wish, conds, condsTouched: condsTouched.current, date, start, end, must, pinned, banned, overrides, ...(Object.keys(modes).length && { modes }), stayFix, focus, focusAdds, skipDistricts, base, ...(shownOrder && { shown: shownOrder }), loose, pace, moveLess, calm, ...(!fill && { fill }), ...(leeway > 0 && { leeway }), since: tripSince, ...(edited && { edited }), ...(days && days.length > 1 && { days, day: dayAt }), ...(!d.demo && planDays > (days && days.length > 1 ? days.length : 1) && { planDays }), ...(!d.demo && hasStay(stays) && { stays }), ...(!d.demo && tripEnd !== undefined && { tripEnd }), ...(!d.demo && wants && { wants }), ...(!d.demo && carry.length > 0 && { carry }), ...(!d.demo && carTrip && { car: true }) }
  }
  const savedNowRef = useRef(savedNow)
  savedNowRef.current = savedNow
  useEffect(() => {
    if (!data || view === 'form') return
    const t = window.setTimeout(() => {
      if (writeSaved(savedNowRef.current(data))) queueCloudSave()
    }, 400)
    return () => window.clearTimeout(t)
  }, [data, view, from.text, from.hit, back, to.text, to.hit, preset, wish, conds, date, start, end, must, pinned, banned, overrides, modes, stayFix, focus, focusAdds, skipDistricts, base, shownOrder, loose, pace, moveLess, calm, fill, leeway, tripSince, edited, days, dayAt, planDays, stays, tripEnd, wants, carry, carTrip])

  useEffect(() => {
    if (!data) return
    let alive = true
    setWeather(null)
    setWeatherBusy(true)
    fetchWeather(data.area.lat ? data.area : data.start, date).then((w) => {
      if (!alive) return
      setWeather(w)
      setWeatherBusy(false)
    })
    return () => {
      alive = false
    }
  }, [data, date])

  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  // 旅の当日は、「いま」「次」と残り時間を 30 秒ごとに進める
  const today = date === isoDate(new Date())
  useEffect(() => {
    if (!today) return
    setNow(minutesNow())
    const t = window.setInterval(() => setNow(minutesNow()), 30000)
    return () => window.clearInterval(t)
  }, [today])

  // エリアを開いて最初のプランは、目安の表を TABLE_WAIT ミリ秒まで待ってから組む（表が後から届くと、見ているプランが組み直されるため）
  const [ready, setReady] = useState('')
  const readyRef = useRef('')
  readyRef.current = ready
  const openRef = useRef<string | null>(null)
  openRef.current = openId
  const keepOpen = useRef<string | null>(null)
  const areaName = data?.area.name ?? ''
  useEffect(() => {
    if (!areaName || !hasServer) return
    const t = window.setTimeout(() => setReady(areaName), TABLE_WAIT)
    return () => window.clearTimeout(t)
  }, [areaName])
  // 移動の表に無い点（あとから足した候補など）があれば、今の点で表を作り直す（並びはそのままにして、移動時間だけ新しくする）
  const matrixFor = useRef('')
  // 表を作り直せなかった点の並び（入りきらない場所を外すのを、表を待たずに進める）
  const [matrixMiss, setMatrixMiss] = useState('')
  useEffect(() => {
    if (!data || !hasServer || progress) return
    const ids = tableIds(data)
    const have = new Set(data.matrix?.ids ?? [])
    if (data.matrix && ids.every((id) => have.has(id))) return
    const pts = tablePoints(data)
    const k = pts.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')
    if (matrixFor.current === k) return
    matrixFor.current = k
    void loadMatrix(pts).then((m) => {
      if (!m) {
        setMatrixMiss(ids.join('|'))
        return
      }
      setData((cur) => (cur && tableIds(cur).join('|') === ids.join('|') ? { ...cur, matrix: { ids, ...m } } : cur))
      if (planRef.current) setBase((b) => b ?? baseOf())
    })
  }, [data, progress])
  // 検索で入れた場所は、取っておいた旅に名前と営業時間が無いので、Google の地図が出たら place_id から聞き直す（1 か所 1 回）
  const restoring = useRef(new Set<string>())
  useEffect(() => {
    if (!data || !googleShown) return
    const need = data.places.filter((p) => needsRestore(p) && !restoring.current.has(p.id))
    if (!need.length) return
    need.forEach((p) => restoring.current.add(p.id))
    void Promise.all(need.map((p) => placeDetails(p.placeId!))).then((infos) => {
      setData((cur) => cur && { ...cur, places: cur.places.map((p) => { const i = need.findIndex((x) => x.id === p.id); return i < 0 ? p : restoreFound(p, infos[i], date) }) })
    })
  }, [data, googleShown, date])
  // 旅の日付を変えたら、検索で入れた場所の開く・閉まる時刻を、その日の営業時間にする
  useEffect(() => {
    setData((cur) => cur && foundHoursOn(cur, date))
  }, [date])
  // 候補が届くたびにエリアのデータが変わるので、落ち着いてから聞く（エリアを開いて最初の 1 回は、すぐに聞く）
  useEffect(() => {
    if (!data) return
    let alive = true
    const name = data.area.name
    const first = askedFor.current !== name
    askedFor.current = name
    const p = packed.current
    if (car || (p && p.data === data && p.date === date && p.start === start && p.end === end)) {
      setTableBusy(false)
      if (car) setReady(name)
      return
    }
    const stop = new AbortController()
    setTableBusy(true)
    const take = (got: BusTable, late = false) => {
      const { sources, ...table } = got
      // プランを出したあとに届いたときは、組み直すので知らせ、開いている場所の画面を残す
      const k = `${name}|${date}`
      if (readyRef.current === name) {
        if (late) notice(T.railFixed)
        else if (tableFor.current !== k) notice(sources.length || !table.rail ? T.tableFixed : T.railFixed)
        keepOpen.current = openRef.current
        // 見せているプランの場所と並びは変えず、時刻だけを表に合わせる
        if (currentRef.current && planRef.current?.stops.length) hold(baseOf())
      }
      tableFor.current = k
      setBusTable({ date, table, sources })
    }
    const t = window.setTimeout(() => {
      // 時刻表の表を先に使い、電車の路線が後から取れたら、電車の目安の入った表に替える
      fetchBusTable(data, date, start, end, stop.signal, (later) => {
        if (alive) take(later, true)
      }).then((got) => {
        if (!alive) return
        setTableBusy(false)
        if (got) take(got)
        setReady(name)
      })
    }, first ? 0 : 1200)
    return () => {
      alive = false
      stop.abort()
      window.clearTimeout(t)
    }
  }, [data, date, start, end, car])
  const table = useMemo(() => {
    if (car || !data || !busTable || busTable.date !== date) return null
    const ids = busTable.table.ids
    const want = new Set(tableIds(data))
    return ids.every((id) => want.has(id)) && ids.includes('end') === want.has('end') ? busTable.table : null
  }, [data, date, busTable, car])

  // 時刻表から選んだ便は、その日のプランにだけ使う（日を変えたら目安に戻す）
  const live = useMemo(() => {
    const out: Record<string, TransitRoute> = {}
    for (const [k, r] of Object.entries(overrides)) if (!r.bus || r.bus.date === date) out[k] = r
    return out
  }, [overrides, date])

  const day = isHoliday(date) ? 'holiday' : 'weekday'
  const sunset = useMemo(() => {
    const here = data ? (data.area.lat ? data.area : data.start) : null
    return here ? sunsetMin(date, here.lat, here.lng) : null
  }, [data, date])
  const input: PlanInput = useMemo(
    // 回り方の設定は、ふつうのときは入れない（入れると組み立ての乱数の種が変わり、同じ条件でも別のプランになる）
    () => ({
      conds, must, day, start, end, pinned, banned, overrides: live, stayFix, focus, skipDistricts, base,
      ...(Object.keys(modes).length && { modes }),
      ...(car && { car }),
      ...(loose.length && { loose }),
      ...(pace !== 'normal' && { pace }),
      ...(moveLess && { moveLess }),
      ...(calm && { calm }),
      ...(table && { busTable: table }),
      ...(sunset !== null && { sunset }),
      ...(!fill && { fill }),
      ...(leeway > 0 && { leeway }),
    }),
    [conds, must, day, start, end, pinned, banned, live, modes, car, stayFix, focus, skipDistricts, base, loose, pace, moveLess, calm, table, sunset, fill, leeway],
  )
  // base を固定しているときは、並びにない候補を計算のときだけ外す（食事の入れ替えや空いた時間への追加をさせない）
  const planInput: PlanInput = useMemo(() => {
    if (!data || !base?.length || !held.current.has(base)) return input
    const keep = new Set([...base.map((b) => b.id), ...must, ...pinned.map((p) => p.id), ...focus])
    return { ...input, banned: [...banned, ...data.places.filter((p) => !keep.has(p.id) && !banned.includes(p.id)).map((p) => p.id)] }
  }, [data, input, base, must, pinned, focus, banned])
  const { plan, usual, pending, current } = usePlan(data && (!hasServer || ready === data.area.name) ? data : null, planInput)
  const currentRef = useRef(current)
  currentRef.current = current
  useEffect(() => {
    if (plan && current) setShownOrder(plan.stops.map((s) => ({ id: s.spot.id, slot: s.slot })))
  }, [plan, current])
  // 候補がそろったら、はじめから組んだプランを裏で作り、今のプランよりはっきり良いときだけ入れ替えるかを聞く
  const offerInput: PlanInput = useMemo(() => ({ ...input, base: null }), [input])
  const [offerWait, setOfferWait] = useState(false)
  useEffect(() => {
    if (!offerAsk) return
    setOfferWait(true)
    const t = window.setTimeout(() => setOfferWait(false), TABLE_WAIT)
    return () => window.clearTimeout(t)
  }, [offerAsk])
  const rival = usePlan(offerAsk && data && (!tableBusy || !offerWait) ? data : null, offerInput)
  useEffect(() => {
    if (!offerAsk || !rival.plan || !rival.current || !plan || !current) return
    setOfferAsk(0)
    const a = plan.stops.map((s) => s.spot.id)
    const b = rival.plan.stops.map((s) => s.spot.id)
    if ((a.length === b.length && a.every((id, i) => id === b[i])) || rival.plan.score < plan.score + OFFER_GAIN) return
    setOffer({
      base: rival.plan.stops.map((s) => ({ id: s.spot.id, slot: s.slot })),
      crowd: rival.plan.crowded - plan.crowded,
      move: rival.plan.moving - plan.moving,
      stops: b.length - a.length,
      swap: b.filter((id) => !a.includes(id)).length,
    })
  }, [offerAsk, rival.plan, rival.current, plan, current])
  // ペンギンの一言（服装の目安の札の下に出す。服装と天気は資料に入れない。閉じたら頼まない）
  const [penguinOff, setPenguinOff] = useState(false)
  const penguinIn = useMemo(
    () => (data && plan && !penguinOff ? penguinFacts(data, plan, input, date, lang) : null),
    [data, plan, input, date, lang, penguinOff],
  )
  const penguinLines = usePenguinNote(penguinIn, pending || !current || weatherBusy || tableBusy)
  // ログインしているときは、今のプランを今の旅としてクラウドにも取っておく（場所の数も旅の一覧に出す）
  useEffect(() => startCloudSync(), [])
  useEffect(() => {
    if (plan && current) noteStops(plan.stops.length)
  }, [plan, current])
  // ホーム画面から「新しい旅」を始めたら、入力の画面を空で開く（「戻る」でホーム画面へ）
  const startNewRef = useRef<(src: 'home') => void>(() => {})
  useEffect(
    () =>
      onTripNew(() => {
        setPick(null)
        startNewRef.current('home')
      }),
    [],
  )
  // 目安の表が届いて組み直したとき、開いていた場所がプランから外れたら、閉じずに候補の画面にして残す
  useLayoutEffect(() => {
    const id = keepOpen.current
    if (!id || !current || !plan) return
    keepOpen.current = null
    if (openId === id && !plan.stops.some((s) => s.spot.id === id)) {
      setOpenId(null)
      setCandId(id)
    }
  }, [plan, current, openId])
  // 選んだ便の区間は、地図の線を路線の線にする（地図が描く前に入れておく）
  useMemo(() => data && syncBusLines(data, live), [data, live])
  // 便を出せるかを聞く（冷えたサーバーが時刻表を取り始めるので、プランを見ている間に温まる）
  useEffect(() => {
    if (!data || !hasServer || car) return
    let alive = true
    const box = areaBox(data)
    loadBusInfo(date, box).then((b) => {
      if (!alive) return
      setBusInfo(b)
      setBusAsked(`${date}|${box}`)
    })
    return () => {
      alive = false
    }
  }, [data, date, car])
  const busLegs = useMemo(() => (data && plan ? legInfos(data, plan) : []), [data, plan])
  const planLegs = useMemo(() => (plan ? [...plan.stops.map((s) => s.leg), plan.back] : []), [plan])
  const slope = useSlopes(planLegs, hasServer)
  // スケジュールが落ち着いたら、電車・バスの区間の便を聞く（経路を入れた区間は聞かない）
  useEffect(() => {
    if (!busInfo.on || !current || !busLegs.length) return
    let alive = true
    const t = window.setTimeout(() => {
      for (const l of busLegs) {
        if (l.leg.mode !== 'transit' || l.leg.real) continue
        const after = Math.round(l.after)
        const have = busFor[l.key]
        if (have && have.date === date && have.after === after) continue
        fetchBus(l.from, l.to, date, after).then((r) => {
          if (!alive || !r || r.loading) return
          setBusFor((m) => ({ ...m, [l.key]: { date, after, trips: r.trips ?? [] } }))
        })
      }
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
    // busFor は聞いた結果を入れる先なので、変わっても聞き直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busInfo.on, current, busLegs, date])
  // 今のプランの時刻で探した、区間のいちばん早く着く便
  const busOf = (l: LegInfo): BusTrip | undefined => {
    const b = busFor[l.key]
    return l.leg.mode === 'transit' && !l.leg.real && b && b.date === date && b.after === Math.round(l.after) ? b.trips[0] : undefined
  }
  // 出典に出す時刻表（使っている目安の表・区間に出している便・選んだ便・シートの便の時刻表だけ）
  const busSources = useMemo(() => {
    let out: BusSource[] = table && busTable ? busTable.sources : []
    for (const l of busLegs) {
      const t = busOf(l) ?? l.leg.real?.bus
      if (t?.source) out = mergeSources(out, [t.source])
    }
    for (const t of busSheet?.trips ?? []) if (t.source) out = mergeSources(out, [t.source])
    return out
    // busOf は busFor と date から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, busTable, busLegs, busFor, date, busSheet])
  // 区間ごとの見つけた便（スケジュールの区間の行と地図で同じ便を出す）
  const buses = useMemo(
    () => busLegs.map(busOf),
    // busOf は busFor と date から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busLegs, busFor, date],
  )
  // 出典は、便を出したか、時刻表の目安を使った電車・バスの区間があるときに出す
  const busShown = busInfo.on && busSources.length > 0 && busLegs.some((l) => busOf(l) || l.leg.real?.bus || (table && l.leg.mode === 'transit'))
  // 電車の目安（地図データの路線と駅）を出している区間があるか
  const railShown = busLegs.some((l) => l.leg.mode === 'transit' && !l.leg.real && !!l.leg.rail && !busOf(l))
  // 便のシートを開く。選んだ便があり、その時刻で回れているときは、選んだときの時刻でほかの便を探す
  const openBus = (index: number) => {
    const l = busLegs.find((x) => x.index === index)
    if (!l) return
    const chosen = l.leg.real?.bus
    const after = Math.round(chosen && !l.note ? chosen.after : l.after)
    const b = busFor[l.key]
    // 時刻表の無いエリアでは便を聞かない（電車の目安だけを出す）
    const have = !busInfo.on ? [] : b && b.date === date && b.after === after ? b.trips : null
    setBusSheet({ idx: index, after, trips: have })
    if (have) return
    fetchBus(l.from, l.to, date, after).then((r) => {
      setBusSheet((cur) => (cur && cur.idx === index && cur.after === after ? { ...cur, trips: r?.trips ?? [] } : cur))
    })
  }
  // プランが出たら、「プランを変更」のシートを先に読み込んでおく
  useEffect(() => {
    if (plan) void import('./components/AdjustSheet')
  }, [plan])
  const open = plan?.stops.find((s) => s.spot.id === openId) ?? null
  useEffect(() => setPeek(null), [openId])
  const peekSpot = open && peek && peek.from === open.spot.id ? (data?.places.find((p) => p.id === peek.id) ?? null) : null
  const peekId = peekSpot?.id ?? null
  // 地図に種類の印で出す、プランに入っていない候補（外した場所・回らない地区の場所は出さない。入れ替えを考えている候補は出す）
  const candidates = useMemo(() => {
    if (!data || !plan) return []
    const inPlan = new Set(plan.stops.map((s) => s.spot.id))
    return data.places.filter((p) => p.id === peekId || (!inPlan.has(p.id) && !banned.includes(p.id) && !p.unfound && !(p.district && skipDistricts.includes(p.district))))
  }, [data, plan, banned, skipDistricts, peekId])
  const cand = candId ? (data?.places.find((p) => p.id === candId) ?? null) : null
  const planRef = useRef(plan)
  planRef.current = plan
  // 手を入れる前の並び。組み直したあと、新しく入った場所と順番が動いた場所に数秒だけ印を付ける
  const markFrom = useRef<{ ids: string[]; touched: string | null } | null>(null)
  const markTouched = useRef<string | null>(null)
  const [changed, setChanged] = useState<Set<string>>(() => new Set())
  const changedTimer = useRef<number | null>(null)
  useEffect(() => {
    const prev = markFrom.current
    if (!prev || !plan) return
    markFrom.current = null
    const c = movedOrNew(prev.ids, plan.stops.map((s) => s.spot.id), prev.touched)
    if (!c.size) return
    setChanged(c)
    if (changedTimer.current !== null) window.clearTimeout(changedTimer.current)
    changedTimer.current = window.setTimeout(() => setChanged(new Set()), 2600)
  }, [plan])
  const baseOf = (): BaseItem[] => (planRef.current?.stops ?? []).map((s) => ({ id: s.spot.id, slot: s.slot }))

  // 知らせだけの帯。「元に戻す」の帯と、入りきらない場所を回した帯が出ているときは、その帯に 1 行足す（戻せなく・見落とさないように）
  const notice = (text: string) =>
    setToast((cur) => (cur?.undo || cur?.keep ? { ...cur, id: Date.now(), subs: [...cur.subs, { parts: [{ t: text }] }] } : { id: Date.now(), parts: [{ t: text }], subs: [] }))

  // 選ぶ画面から作った日の最初のプランが組み上がったら、希望に名前を書いたのに遠くて候補に入れなかった場所を知らせる（1 回だけ）
  const farAsk = useRef(false)
  useEffect(() => {
    if (!farAsk.current || !data || !plan || !current) return
    farAsk.current = false
    if (data.far?.length) notice(T.farWish(names(data.far)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plan, current])
  // 泊まりの旅の日の最初のプランが組み上がったら、入りきらずに外れた見どころを、まだ入れていない場所に回す（1 回だけ）。
  // そのあとは選んだ見どころを外さず、残った場所の並びもそのままにする。移動の表を作り直している間は待つ
  useEffect(() => {
    const ask = carryAsk.current
    if (!ask || !data || !plan || !current || pending) return
    if (hasServer && matrixMiss !== tableIds(data).join('|') && Date.now() - ask.at < CARRY_WAIT) {
      const have = new Set(data.matrix?.ids ?? [])
      if (must.some((id) => !have.has(id))) {
        const t = window.setTimeout(() => setCarryTick((n) => n + 1), 500)
        return () => window.clearTimeout(t)
      }
    }
    carryAsk.current = null
    const inPlan = new Set(plan.stops.map((s) => s.spot.id))
    const out = must.filter((id) => !inPlan.has(id))
    const spots = out.flatMap((id) => data.places.filter((p) => p.id === id))
    setLoose([])
    hold(baseOf())
    if (!out.length) return
    setMust((m) => m.filter((id) => !out.includes(id)))
    if (!spots.length) return
    setCarry((c) => addCarry(c, spots))
    // 先に出ていた知らせ（希望に合う場所を足したこと）は消さず、下の行に残す
    const said = { t: ask.next ? T.carried(spots.length, ask.next) : T.carriedLast(spots.length) }
    setToast((cur) => ({ id: Date.now(), parts: [said], subs: cur && !cur.undo ? [{ parts: cur.parts }, ...cur.subs] : [], keep: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plan, current, pending, must, matrixMiss, carryTick])
  // 旅のどれかの日のプランに入った場所は、まだ入れていない場所から除く（開いている日は、取っておいた並びではなく今のプラン）
  useEffect(() => {
    if (!data || !plan || !current || !carry.length) return
    const s = savedNowRef.current(data)
    const next = dropCarried(carry, usedWith(usedPlaces(s, dayIndex(s)), plan.stops.map((x) => x.spot)))
    if (next !== carry) setCarry(next)
  }, [data, plan, current, carry])

  // nextDay: 旅に次の日を加えるときの頼み（出発地・希望と、候補から除く場所）
  const create = async (nextDay?: { trip: TripAsk; wish: string; keep: (d: AreaData) => AreaData }) => {
    if ((!nextDay && !from.text.trim()) || busy) return
    setError('')
    setAddError('')
    if (timer.current) window.clearTimeout(timer.current)
    const seq = ++jobSeq.current
    const since = Date.now()
    let trip: TripAsk
    if (nextDay) trip = nextDay.trip
    else {
      // 出発地と到着地を引いていなければ引く（見つからなければ、欄の下に出して止める）
      setBusy({ job: { id: '', state: 'running' }, since })
      const fields = shownNights(Array.from({ length: Math.max(0, formDays - 1) }, (_, k) => k + 1), sameStay).map((n) => stayForms[n - 1])
      // 泊まりの旅の宿と観光を終える場所は、行き先のエリアの名前を前に付けて引く（行き先を先に引く）
      const near = formDays > 1 ? nearOf(await from.lookup(), from.text) : undefined
      const [s, e, st] = await Promise.all([from.lookup(), back ? Promise.resolve(null) : to.lookup(near), lookStays(fields, near)])
      if (seq !== jobSeq.current) return
      if (!s || (!back && !e) || (e && distM(s, e) > MAX_TRIP_KM * 1000) || !st || stayFarTexts(s, st, back ? s : e, false).some(Boolean)) {
        setBusy(null)
        return
      }
      const origin = tripPoint(from, s)
      const goal = e ? tripPoint(to, e) : null
      formStay.current = hasStay(st) ? { stays: trimStays(st), end: goal } : null
      const first = formStay.current && stayTrip(1, formDays, origin, formStay.current.stays, goal)
      trip = { start: origin, end: first ? first.end : goal, ...(preset && { area: preset }) }
      formWants.current = formKind !== 'day' && formDays > 1 ? wantsOf(wish, fitDays(talk.days, talk.nights, formDays - 1), formDays) : undefined
    }
    const firstWish = formKind !== 'day' && formDays > 1 ? joinWish(wish, talk.days?.[0]?.wish) : wish.trim()
    let applied = false
    let misses = 0
    const fail = (kind: 'quota' | 'network' | 'failed') => {
      setBusy(null)
      setProgress(null)
      const text = kind === 'quota' ? T.quotaPlan : kind === 'network' ? T.offline : T.noPlaces
      if (nextDay && !applied) {
        setAdding(null)
        setAddError(text)
      } else setError(text)
    }
    let version = -1
    let tag: string | undefined
    const handle = (j: JobState) => {
      if (seq !== jobSeq.current) return // キャンセルしたか、別の作成を始めた
      misses = 0
      tag = j.tag
      if (j.state === 'error') {
        if (applied) {
          setProgress(null)
          setPartial(true)
        } else fail(j.error === 'quota' ? 'quota' : 'failed')
        return
      }
      if ((j.state === 'ready' || j.state === 'done') && j.result) {
        const more = (j.steps ?? []).some((s) => s.key !== 'verify' && (s.state === 'wait' || s.state === 'run'))
        if ((j.version ?? 0) > version) {
          version = j.version ?? 0
          const result = nextDay ? nextDay.keep(j.result) : j.result
          if (!applied) {
            // 候補が届き始めたら、行きたい場所を選ぶ画面へ（届いた分から選べ、続きは届くたびに一覧に足す）
            applied = true
            setBusy(null)
            pickJob.current = seq
            setPick({ data: result, key: seq })
            setView('pick')
          } else if (pickJob.current === seq) {
            setPick({ data: result, key: seq })
          } else if (more) {
            // 候補が届いている途中は、見ているプランを組み替えない
          } else {
            // 見せているプランは、場所と並びをそのままにして、写真・移動時間・位置だけ新しくする。
            // 新しい候補が届いたときは、より良い案があるかを裏で比べる（手を入れたプランでは比べない）
            const b = baseRef.current
            const edited = b !== null && !held.current.has(b)
            if (planRef.current?.stops.length && currentRef.current) hold(baseOf())
            const known = new Set(dataRef.current?.places.map((p) => p.id) ?? [])
            if (!edited && result.places.some((p) => !known.has(p.id))) {
              setOffer(null)
              setOfferAsk((n) => n + 1)
            }
            setData(result)
            if (!condsTouched.current) setConds(result.conditions)
            // 選ぶ画面を閉じたあとに届いた、希望に名前を書いた見どころは、プランに必ず入れる
            const late = result.places.filter((p) => p.named && p.source === 'wish' && p.kind !== 'food' && p.kind !== 'cafe' && !namedSeen.current.has(p.id))
            if (late.length) {
              for (const p of late) namedSeen.current.add(p.id)
              setMust((cur) => [...cur, ...late.map((p) => p.id).filter((id) => !cur.includes(id))])
            }
          }
        }
        setProgress(j.state === 'ready' ? { more } : null)
        if (j.state === 'done') return
      } else {
        setBusy({ job: j, since })
      }
      timer.current = window.setTimeout(poll(j.id), j.tag ? 200 : applied ? 2500 : 1000)
    }
    const poll = (id: string) => async () => {
      try {
        handle(await pollJob(id, tag))
      } catch {
        if (seq !== jobSeq.current) return
        // 一時的に届かないだけのことがあるので、3 回まで待ってやり直す
        if (++misses < 3) {
          timer.current = window.setTimeout(poll(id), 2000)
          return
        }
        if (applied) {
          setProgress(null)
          setPartial(true)
        } else fail('network')
      }
    }
    setBusy({ job: { id: '', state: 'running' }, since })
    try {
      handle(await startJob(trip, nextDay ? nextDay.wish : firstWish, carTrip))
    } catch (e) {
      if (seq === jobSeq.current) fail(e instanceof TypeError ? 'network' : 'failed')
    }
  }
  // 入力の画面を「戻る」で離れる。新しい旅のために空にした欄は、開く前に戻す
  const leaveForm = (to2: 'home' | 'pick' | 'plan') => {
    const b = fieldsBefore.current
    fieldsBefore.current = null
    if (b) {
      from.set(b.from, b.fromHit)
      to.set(b.to, b.toHit)
      setBack(b.back)
      setPreset(b.preset)
      setWish(b.wish)
      setCarTrip(b.car)
      if (b.date) setDate(b.date)
      if (b.times) {
        setStart(b.times.start)
        setEnd(b.times.end)
        setLeeway(b.times.leeway)
      }
    }
    dropTalk()
    markBack()
    setView(to2)
  }
  const cancelJob = () => {
    jobSeq.current++
    if (timer.current) window.clearTimeout(timer.current)
    setBusy(null)
    setProgress(null)
    if (formFrom !== 'plan') leaveForm(formFrom)
    else if (data) leaveForm('plan')
  }

  const baseRef = useRef(base)
  baseRef.current = base
  // 探す頼みは返事に時間がかかるので、返ってきたときの状態を読む
  const adjRef = useRef<AdjustState>({ must, pinned, banned, focus, stayFix, conds, skipDistricts, start, end, base, loose })
  adjRef.current = { must, pinned, banned, focus, stayFix, conds, skipDistricts, start, end, base, loose }
  const snap = (): Snapshot => ({ must, pinned, banned, overrides, modes, stayFix, focus, focusAdds, skipDistricts, base, loose, openId, start, end, conds, pace, moveLess, calm, fill, leeway, car: carTrip })
  const restore = (x: Snapshot) => {
    setMust(x.must)
    setPinned(x.pinned)
    setBanned(x.banned)
    setOverrides(x.overrides)
    setModes(x.modes)
    setStayFix(x.stayFix)
    setFocus(x.focus)
    setFocusAdds(x.focusAdds)
    setSkipDistricts(x.skipDistricts)
    setBase(x.base)
    setLoose(x.loose)
    setOpenId(x.openId)
    setStart(x.start)
    setEnd(x.end)
    setConds(x.conds)
    setPace(x.pace)
    setMoveLess(x.moveLess)
    setCalm(x.calm)
    setFill(x.fill)
    setLeeway(x.leeway)
    setCarTrip(x.car)
  }
  // 手を入れる。帯が出ている間に続けた操作は、「元に戻す」で全部まとめて戻す。
  // 手を入れたあとのプランは、前のプランの並びを土台にする（base）
  // moving: 手を入れる前の移動の時間（渡したときは、組み直して移動が大きく増えたら帯で知らせる）
  const edit = (parts: Part[], fn: () => void, subs: Line[] = [], same?: string, moving?: number) => {
    const s = snap()
    setEdited(true)
    setToast((cur) => ({ id: Date.now(), parts, subs, undo: cur?.undo ?? s, follow: true, same, from: baseOf(), moving }))
    setToastOpen(false)
    setOffer(null)
    setOfferAsk(0)
    setBase(baseOf())
    markFrom.current = { ids: baseOf().map((b) => b.id), touched: markTouched.current }
    markTouched.current = null
    fn()
  }
  const stackRef = useRef<HTMLDivElement>(null)
  // プランの画面の見出しの高さ（半分の高さのシートを開いている間は、帯を見出しの下に出す）
  const topRo = useRef<ResizeObserver | null>(null)
  const topRef = useCallback((el: HTMLElement | null) => {
    topRo.current?.disconnect()
    topRo.current = null
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`)
    set()
    topRo.current = new ResizeObserver(set)
    topRo.current.observe(el)
  }, [])
  const showToast = !!toast && !(toast.follow && toast.same !== undefined)
  // 希望に合う場所を足したことは、プランを作ったときに知らせの帯で 1 回だけ伝える
  const wishTold = useRef<AreaData | null>(null)
  useEffect(() => {
    if (!data || !plan || wishTold.current === data) return
    // 例のプランでは知らせない（開いた人は希望を書いていないので、「希望に合う場所を追加しました」と出ると何の事か分からない）
    if (data.demo || data.example) return
    const labels = new Set(data.conditions.map((c) => c.label))
    const n = plan.stops.filter((s) => s.fits.some((f) => labels.has(f))).length
    if (!(data.query?.wish ?? wish).trim() || n === 0) return
    wishTold.current = data
    notice(T.wishFitN(n))
    // 新しいプランのときだけ知らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, plan])
  useEffect(() => {
    const el = stackRef.current
    const root = document.documentElement.style
    if (!showToast || !el) return
    const set = () => root.setProperty('--toast-room', `${el.offsetHeight + 16}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.removeProperty('--toast-room')
    }
  }, [showToast])
  // 内訳を開いている間は、帯を消さない
  useEffect(() => {
    if (!toast) {
      setToastOpen(false)
      return
    }
    if (toastOpen) return
    const t = window.setTimeout(() => setToast(null), toast.undo || toast.keep ? 7000 : 3500)
    return () => window.clearTimeout(t)
  }, [toast, toastOpen])
  // 組み直しが終わったら、時間に合わせて外した場所・足した場所を帯に書き足す
  useEffect(() => {
    if (!toast?.follow || !current || !plan || !data) return
    if (toast.same !== undefined && planSig(plan) === toast.same) {
      setToast({ ...toast, parts: [{ t: T.same }], subs: [], follow: false })
      return
    }
    const byId = new Map(data.places.map((p) => [p.id, p.name]))
    const subs = [...toast.subs]
    // 同じ枠（昼食・夕食・休憩）で外れた店と入った店は、店を替えたと 1 行で出す
    const slotWas = new Map((toast.from ?? []).map((b) => [b.id, b.slot]))
    const slotNow = new Map(plan.stops.map((x) => [x.spot.id, x.slot]))
    let dropIds = plan.dropped.filter((id) => byId.has(id))
    let addIds = plan.added.filter((id) => byId.has(id))
    for (const id of [...dropIds]) {
      const slot = slotWas.get(id)
      if (!slot || slot === 'sight') continue
      const to = addIds.find((x) => slotNow.get(x) === slot)
      if (!to) continue
      dropIds = dropIds.filter((x) => x !== id)
      addIds = addIds.filter((x) => x !== to)
      const label = slot === 'lunch' ? ROLE_TEXT['昼食'] : slot === 'dinner' ? ROLE_TEXT['夕食'] : ROLE_TEXT['休憩']
      subs.push({ parts: say2(T.mealSwap(label), byId.get(id)!, byId.get(to)!), n: 1 })
    }
    const dropped = dropIds.map((id) => byId.get(id)!)
    const added = addIds.map((id) => byId.get(id)!)
    if (dropped.length) subs.push({ parts: say(T.dropped, names(dropped)), n: dropped.length })
    if (added.length) subs.push({ parts: say(T.filled, names(added)), n: added.length })
    const more = toast.moving === undefined ? 0 : plan.moving - toast.moving
    const parts = more >= 30 ? [...toast.parts, { t: T.moveUp(fmtDur(more), toast.parts.at(-1)?.t ?? '') }] : toast.parts
    setToast({ ...toast, parts, subs, follow: false })
  }, [toast, current, plan, data])

  const removeFromPlan = (id: string) => {
    setMust((m) => m.filter((x) => x !== id))
    setPinned((p) => p.filter((x) => x.id !== id))
    setFocus((f) => f.filter((x) => x !== id))
    setBanned((b) => (b.includes(id) ? b : [...b, id]))
    setLoose((l) => l.filter((x) => x !== id))
    setBase(baseOf().filter((b) => b.id !== id))
  }
  // open: 入れ替えたあと、その場所の画面を開く
  const swap = (from: Stop, to: string, open = true) => {
    const name = data?.places.find((p) => p.id === to)?.name ?? ''
    edit(say(T.changedTo, name), () => {
      // 入れ替えた場所は、元の場所と同じ位置（時刻）に入れる
      setBase(baseOf().map((b) => (b.id === from.spot.id ? { id: to, slot: from.slot } : b)))
      setMust((m) => m.filter((x) => x !== from.spot.id))
      setBanned((b) => [...b.filter((x) => x !== to), from.spot.id])
      setPinned((p) => [...p.filter((x) => x.id !== from.spot.id && x.id !== to), { id: to, slot: from.slot }])
      setFocus((f) => f.filter((x) => x !== from.spot.id))
      setOpenId(open ? to : null)
    })
  }
  // 泊まりの旅で、入りきらない場所をプランから外し、まだ入れていない場所に回す（next: 次の日。最終日は null）
  const carryStop = (s: Stop, next: number | null) =>
    edit(say(next ? T.carriedOne(next) : T.removed, s.spot.name), () => {
      removeFromPlan(s.spot.id)
      setMust((m) => m.filter((x) => x !== s.spot.id))
      setCarry((c) => addCarry(c, [s.spot]))
      setOpenId(null)
    })
  const removeStop = (s: Stop) =>
    edit(say(T.removed, s.spot.name), () => {
      removeFromPlan(s.spot.id)
      setOpenId(null)
    })
  // 本人が手を入れた場所は、組み直しても外さない
  const keep = (id: string) => {
    const st = plan?.stops.find((x) => x.spot.id === id)
    if (st && !must.includes(id)) setPinned((p) => (p.some((x) => x.id === id) ? p : [...p, { id, slot: st.slot }]))
    setLoose((l) => l.filter((x) => x !== id))
  }
  // 順番を変える（その場所は、組み直しても外さない）
  const moveStop = (id: string, delta: number) => moveStopTo(id, baseOf().findIndex((x) => x.id === id) + delta)
  const moveStopTo = (id: string, j: number) => {
    const b = baseOf()
    const i = b.findIndex((x) => x.id === id)
    if (i < 0 || j < 0 || j >= b.length || i === j) return
    const name = data?.places.find((p) => p.id === id)?.name ?? ''
    markTouched.current = id
    edit(say(T.moved(j + 1), name), () => {
      const n = [...b]
      const [x] = n.splice(i, 1)
      n.splice(j, 0, x)
      setBase(n)
      keep(id)
    })
  }
  // 調整の「回り方」。Gemini を通さずに、その場で効かせる
  const changePace = (v: Pace) =>
    edit(
      [{ t: v === 'many' ? T.paceMany : v === 'slow' ? T.paceSlow : T.paceNormal }],
      () => setPace(v),
    )
  // 移動と混雑の重みを変えたときは、前の並びにこだわらず全体を組み直す（手で入れた場所は残る）
  const changeMoveLess = (on: boolean) =>
    edit([{ t: on ? T.moveLessOn : T.moveLessOff }], () => {
      setMoveLess(on)
      setBase(null)
    })
  const changeCar = (on: boolean) =>
    edit([{ t: on ? T.carOn : T.carOff }], () => {
      setCarTrip(on)
      setBase(null)
    })
  const changeCalm = (on: boolean) =>
    edit([{ t: on ? T.calmOn : T.calmOff }], () => {
      setCalm(on)
      setBase(null)
    })
  const changeStay = (id: string, minutes: number) => {
    const m = Math.min(240, Math.max(5, minutes))
    edit([{ t: T.stayAt(fmtDur(m)) }], () => {
      keep(id)
      setStayFix((a) => ({ ...a, [id]: m }))
    })
  }
  const autoStay = (id: string) =>
    edit([{ t: T.stayAuto }], () =>
      setStayFix((a) => {
        const n = { ...a }
        delete n[id]
        return n
      }),
    )
  // 食事はどの枠（昼食・夕食）に入れるか。営業時間で決め、両方に合うときはまだ本人が選んでいない枠。
  // taken: 同じ頼みですでに埋めた枠（2 つの店を同じ枠に入れないように）
  const mealSlot = (s: Spot, taken: Slot[] = []): Slot => {
    if (s.kind === 'cafe') return 'cafe'
    const fitsL = s.open <= 13 * 60 + 30 && s.close >= 11 * 60 + 45
    const fitsD = s.open <= 19 * 60 + 30 && s.close >= 18 * 60 + 15
    const has = (slot: Slot) => !!plan?.stops.some((x) => x.slot === slot)
    if (fitsD && !fitsL) return 'dinner'
    if (fitsL && !fitsD) return 'lunch'
    if (taken.includes('lunch') && fitsD) return 'dinner'
    if (taken.includes('dinner') && fitsL) return 'lunch'
    if (has('lunch') && has('dinner')) return pinned.some((p) => p.slot === 'lunch') && !pinned.some((p) => p.slot === 'dinner') ? 'dinner' : 'lunch'
    return has('dinner') && !has('lunch') ? 'dinner' : 'lunch'
  }
  // 行きたい場所を選ぶ：チェックを付けると必ず入れ、外すとプランから外す
  // spot: まだ data に入っていない候補（検索で見つけて、同じ操作で候補に足す場所）
  const togglePlace = (id: string, on: boolean, spot?: Spot) => {
    const s = spot ?? data?.places.find((p) => p.id === id)
    if (!s) return
    if (on) {
      edit(say(T.removed, s.name), () => removeFromPlan(id))
      return
    }
    const subs: Line[] = []
    const backDistrict = s.district && skipDistricts.includes(s.district) ? s.district : null
    if (backDistrict) subs.push({ parts: say(T.districtBack, backDistrict) })
    const slot: Slot = s.kind === 'cafe' || s.kind === 'food' ? mealSlot(s) : 'sight'
    const replaced = slot === 'sight' ? null : (plan?.stops.find((x) => x.slot === slot) ?? null)
    const label = slot === 'lunch' ? ROLE_TEXT['昼食'] : slot === 'dinner' ? ROLE_TEXT['夕食'] : ROLE_TEXT['休憩']
    edit(
      replaced ? say(T.slotTo(label), s.name) : say(T.added, s.name),
      () => {
        setBanned((b) => b.filter((x) => x !== id))
        setLoose((l) => l.filter((x) => x !== id))
        if (backDistrict) setSkipDistricts((d) => d.filter((x) => x !== backDistrict))
        if (slot === 'sight') setMust((m) => (m.includes(id) ? m : [...m, id]))
        else {
          setPinned((p) => [...p.filter((x) => x.id !== id && x.slot !== slot), { id, slot }])
          // 同じ枠の店は、その位置で入れ替える
          if (replaced) setBase(baseOf().map((b) => (b.id === replaced.spot.id ? { id, slot } : b)))
        }
      },
      subs,
    )
  }
  // この近くの場所を足す：近くの見どころを 2 か所まで、その場所のすぐあとに入れる。
  // もう一度押したら、足した場所を外し、そのときに時間に合わせて外した場所を元の位置に戻す
  const toggleFocus = (id: string) => {
    if (!data || !plan) return
    if (focus.includes(id)) {
      const fa = focusAdds[id]
      const stopFocus = () => {
        setFocus((f) => f.filter((x) => x !== id))
        setFocusAdds((a) => {
          const n = { ...a }
          delete n[id]
          return n
        })
      }
      if (!fa) {
        edit([{ t: T.focusOff }], stopFocus)
        return
      }
      const byId = new Map(data.places.map((p) => [p.id, p.name]))
      const added = new Set(fa.added)
      const b = baseOf().filter((x) => !added.has(x.id))
      const back: string[] = []
      fa.before.forEach((x, k) => {
        if (b.some((y) => y.id === x.id) || banned.includes(x.id)) return
        let at = 0
        for (let j = k - 1; j >= 0; j--) {
          const i = b.findIndex((y) => y.id === fa.before[j].id)
          if (i >= 0) {
            at = i + 1
            break
          }
        }
        b.splice(at, 0, x)
        back.push(x.id)
      })
      const gone = fa.added.map((x) => byId.get(x)).filter((x): x is string => !!x)
      const backNames = back.map((x) => byId.get(x)).filter((x): x is string => !!x)
      edit(
        gone.length ? say(T.gone, names(gone)) : [{ t: T.focusOff }],
        () => {
          stopFocus()
          setPinned((p) => p.filter((x) => !added.has(x.id) && !(fa.kept && x.id === id)))
          setBase(b)
        },
        backNames.length ? [{ parts: say(T.putBack, names(backNames)), n: backNames.length }] : [],
      )
      return
    }
    const near = nearCandidates(data, plan, input, id, 2)
    if (!near.length) {
      notice(T.noNear)
      return
    }
    edit(say(T.nearAdded, joinNames(near.map((n) => n.name))), () => {
      const kept = !must.includes(id) && !pinned.some((x) => x.id === id)
      setFocusAdds((a) => ({ ...a, [id]: { added: near.map((n) => n.id), before: baseOf(), kept } }))
      keep(id)
      setFocus((f) => [...f, id])
      const b = baseOf()
      const at = b.findIndex((x) => x.id === id)
      b.splice(at + 1, 0, ...near.map((n) => ({ id: n.id, slot: 'sight' as Slot })))
      setBase(b)
      setPinned((p) => [...p, ...near.filter((n) => !p.some((x) => x.id === n.id)).map((n) => ({ id: n.id, slot: 'sight' as Slot }))])
    })
  }
  const changeDistricts = (d: string[]) =>
    edit([{ t: T.districts }], () => {
      // 外した地区の場所は、行きたい場所に選んでいてもプランから外す
      const off = new Set(d.filter((x) => !skipDistricts.includes(x)))
      const inOff = new Set((data?.places ?? []).filter((p) => p.district && off.has(p.district)).map((p) => p.id))
      setMust((m) => m.filter((x) => !inOff.has(x)))
      setPinned((p) => p.filter((x) => !inOff.has(x.id)))
      setFocus((f) => f.filter((x) => !inOff.has(x)))
      setSkipDistricts(d)
    })
  // 日時・条件を変えたときは、はじめから組み直す
  const fresh = <T,>(set: (v: T) => void) => (v: T) => {
    setEdited(true)
    setBase(null)
    setOffer(null)
    setOfferAsk(0)
    set(v)
  }
  // より良い案に入れ替える（「元に戻す」で前のプランに戻せる）
  const takeOffer = () => {
    const o = offer
    if (!o) return
    edit([{ t: T.offerTaken }], () => hold(o.base))
  }
  // Gemini に頼む：返ってきた操作を、まとめて 1 回の手直しとして入れる（「元に戻す」で全部戻る）
  const applyOps = (reply: string, ops: AdjustOp[]) => {
    if (!data || !planRef.current) return
    const cur: AdjustState = { must, pinned, banned, focus, stayFix, conds, skipDistricts, start, end, base, loose }
    const n = applyAdjust(data.places, planRef.current, cur, ops, mealSlot)
    if (ops.some((o) => o.op === 'cond')) condsTouched.current = true
    // 回り方の好み（移動を少なく・混雑をもっと避ける）。調整の画面の切り替えと同じく、変わったら前の並びにこだわらず組み直す
    let moveLessN = moveLess
    let calmN = calm
    for (const o of ops) {
      if (o.op !== 'prefer') continue
      if (o.moveLess !== undefined) moveLessN = o.moveLess
      if (o.calm !== undefined) calmN = o.calm
    }
    const rebuild = (moveLessN !== moveLess || calmN !== calm) && !ops.some((o) => o.op === 'move')
    const was = planSig(planRef.current)
    // 時刻・条件を変えない頼みでは、頼んでいない場所を足したり食事の店を替えたりしない（並びを固定する）
    const fixed = !ops.some((o) => o.op === 'time' || o.op === 'cond')
    edit(
      [{ t: reply, w: true }],
      () => {
        if (rebuild) setBase(null)
        else if (fixed && n.base) hold(n.base)
        else setBase(n.base)
        setMoveLess(moveLessN)
        setCalm(calmN)
        setMust(n.must)
        setPinned(n.pinned)
        setBanned(n.banned)
        setFocus(n.focus)
        setStayFix(n.stayFix)
        setConds(n.conds)
        setSkipDistricts(n.skipDistricts)
        setStart(n.start)
        setEnd(n.end)
        setLoose(n.loose)
      },
      [],
      was,
      planRef.current.moving,
    )
  }
  const QUOTA = T.quotaAsk
  const OFFLINE = T.offline
  // 候補に合う場所が無いときは、頼みの内容で希望の読み取りだけをもう一度頼み、新しい候補を足してプランに入れる
  // alive: 調整の画面を閉じたら false（探している途中でも、結果をプランに入れない）
  const findMore = async (wishText: string, kind: 'sight' | 'food' | 'cafe', onStatus: (s: string) => void, alive: () => boolean, looseAtAsk: string[] | null): Promise<string | null> => {
    if (!data) return null
    onStatus(T.finding)
    let j: JobState
    try {
      j = await startJob(tripOf(data), wishText, car)
    } catch {
      return OFFLINE
    }
    const wishDone = (x: JobState) =>
      x.state === 'error' || x.state === 'done' || (x.state === 'ready' && !(x.steps ?? []).some((st) => st.key === 'wish' && (st.state === 'wait' || st.state === 'run')))
    const t0 = Date.now()
    while (!wishDone(j) && Date.now() - t0 < 90000) {
      if (!alive()) return null
      await new Promise((r) => window.setTimeout(r, j.tag ? 200 : 1500))
      try {
        j = await pollJob(j.id, j.tag)
      } catch {
        /* 次の回にもう一度 */
      }
    }
    if (!alive()) return null
    if (j.state === 'error' || !j.result) return j.error === 'quota' ? QUOTA : T.findFailed
    const known = new Set(data.places.map((p) => p.id))
    const found = j.result.places.filter((p) => !known.has(p.id))
    // 頼みで探した種類の場所だけを入れる（見どころは 2 か所まで・食事とカフェは 1 か所）
    const fits = (p: Spot) => (kind === 'sight' ? p.kind === 'sight' || p.kind === 'street' : p.kind === 'food' || p.kind === 'cafe')
    const sights = kind === 'sight' ? found.filter(fits).slice(0, 2) : []
    // 食事・休憩は、いまのプランでその枠にいる場所（無ければプランのいちばん近い場所）から近い店を選ぶ
    const stops = planRef.current?.stops ?? []
    const away = (p: Spot) => {
      const at = stops.find((s) => s.slot === mealSlot(p))
      return at ? distM(at.spot, p) : Math.min(Infinity, ...stops.map((s) => distM(s.spot, p)))
    }
    const meals = kind === 'sight' ? [] : found.filter(fits).map((p) => ({ p, d: away(p) })).sort((a, b) => a.d - b.d).slice(0, 1).map((x) => x.p)
    const pick = [...sights, ...meals]
    if (!pick.length) return T.noneFound
    // 探している間に届いた候補・写真を消さないよう、いまの候補に足す
    const newConds = j.result.conditions
    setData((cur) => {
      if (!cur || cur.area.name !== data.area.name) return cur
      const have = new Set(cur.places.map((p) => p.id))
      return {
        ...cur,
        places: [...cur.places, ...found.filter((p) => !have.has(p.id))],
        conditions: [...cur.conditions, ...newConds.filter((c) => !cur.conditions.some((x) => x.tag === c.tag))],
      }
    })
    edit(say(T.foundAdded, names(pick.map((p) => p.name))), () => {
      const now = planRef.current
      if (!now) return
      const cur = adjRef.current
      const n = addFound(now, { ...cur, loose: looseAtAsk ?? cur.loose }, sights, meals.map((p) => ({ id: p.id, slot: mealSlot(p) })))
      if (n.base) hold(n.base)
      setMust(n.must)
      setPinned(n.pinned)
      setLoose(n.loose)
    }, [], undefined, planRef.current?.moving)
    return null
  }
  const askSeq = useRef(0)
  const ask = async (text: string, onStatus: (s: string) => void): Promise<string | null> => {
    if (!data || !plan) return null
    const my = ++askSeq.current
    const alive = () => my === askSeq.current
    const body = {
      request: text,
      area: data.area.name,
      wish: data.query?.wish ?? wish,
      date: dateLabel(date),
      day,
      start,
      end,
      conds: conds.map((c) => c.tag),
      skip: skipDistricts,
      prefer: { moveLess, calm },
      ...(car && { car: true }),
      plan: plan.stops.map((st) => ({ id: st.spot.id, name: st.spot.name, slot: st.slot, district: st.spot.district, arrive: st.arrive, depart: st.depart, stay: st.stay, lat: st.spot.lat, lng: st.spot.lng })),
      places: data.places.map((p) => ({ id: p.id, name: p.name, kind: p.kind, role: p.role, district: p.district, tags: p.tags, open: p.open, close: p.close, why: p.why, lat: p.lat, lng: p.lng })),
    }
    let r: AdjustReply
    try {
      r = await askAdjust(body)
    } catch {
      return alive() ? OFFLINE : null
    }
    if (!alive()) return null
    if (r.error) return r.error === 'quota' ? QUOTA : T.askFailed
    const ops = r.ops ?? []
    const find = ops.find((o): o is Extract<AdjustOp, { op: 'find' }> => o.op === 'find')
    const rest = ops.filter((o) => o.op !== 'find')
    // 探すだけの頼みでは、頼んだときに選んでいた見どころを、時間が足りないときに外してよい場所にする
    const looseAtAsk = looseOf(must, pinned)
    if (!rest.length && !find) return r.reply || T.nothing
    if (rest.length) applyOps(r.reply || T.changed, rest)
    if (find) {
      const err = await findMore(find.wish, find.kind, onStatus, alive, rest.length ? null : looseAtAsk)
      if (!alive()) return null
      if (err && !rest.length) return err
      if (err) notice(err)
    }
    setAdjust(false)
    return null
  }
  const share = async () => {
    if (!data || !plan) return
    const legs = [...plan.stops.map((s) => s.leg), plan.back]
    const tour = legs.every((l) => l.mode === 'walk')
    const legLines = (leg: Leg) => [`${T.down}${shareLabel(leg)}`, ...(tour || leg.mode === 'walk' ? [] : [mapsDirUrl(leg)])]
    const name = stayTitle(savedNow(data)) ?? data.area.name
    const lines = [`${name} ${dateLabel(date)}`, `${fmt(plan.leave)} ${T.shareDepart(data.start.name)}`]
    plan.stops.forEach((s) => {
      const [move, ...url] = legLines(s.leg)
      lines.push(`${move}${s.ease > 0 ? T.shareEase(s.ease) : ''}`, ...url, `${fmt(s.arrive)} ${T.shareStop(s.spot.name, fmtDur(s.stay))}`)
    })
    const [backMove, ...backUrl] = legLines(plan.back)
    const goal = goalOf(data)
    lines.push(`${backMove}${plan.backEase > 0 ? T.shareEase(plan.backEase) : ''}`, ...backUrl, `${fmt(plan.finish)} ${T.shareArrive(goal.name)}`)
    if (tour) lines.push('', T.shareMaps, mapsTourUrl(data.start, plan.stops.map((s) => s.spot), goal))
    const text = lines.join('\n')
    // スマホは端末の共有の画面、PC（細かく指せる端末）と共有の画面が無い・開けないときはクリップボードに写す
    if (navigator.share && !window.matchMedia('(pointer: fine)').matches) {
      try {
        await navigator.share({ title: T.shareTitle(name), text })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    notice((await copyText(text)) ? T.copied : T.copyFailed)
  }
  const closeStop = useCallback(() => setOpenId(null), [])
  const pickCandidate = useCallback((id: string) => {
    setPeek(null)
    setCandId(id)
  }, [])
  // この付近で検索。範囲は探すときに地図から測る。探している間と、前と同じ範囲・同じ言葉で結果があるときは送らない
  const sameBox = (a: AreaBox | null, b: AreaBox) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 1e-4)
  const runAreaSearch = (q: string) => {
    const box = areaBoxRef.current?.()
    if (!box || area?.busy) return
    if (area && area.q === q && sameBox(area.box, box) && area.found && !area.error) return
    setArea((a) => ({ box, q, busy: true, error: null, found: a?.found ?? null, picked: null }))
    searchArea(q, box).then((r) => {
      setArea((cur) =>
        cur && cur.box === box && cur.q === q ? ('places' in r ? { ...cur, busy: false, found: r.places } : { ...cur, busy: false, error: r.error, found: null }) : cur,
      )
    })
  }
  const closeOthers = () => {
    setOpenId(null)
    setCandId(null)
    setBusSheet(null)
    setTransitIdx(null)
    setWalkIdx(null)
    setAdjust(false)
    setCrowdOpen(false)
  }
  // 地図の「この付近を検索」: シートを開く。もう探した言葉があれば、今見えている範囲で探し直す
  const openAreaSearch = () => {
    closeOthers()
    if (area?.q) runAreaSearch(area.q)
    else if (!area) setArea({ box: null, q: '', busy: false, error: null, found: null, picked: null })
  }
  // 入力の画面を空で開く（自分のプランを作る）。src: 「戻る」で戻す先
  const startNew = (src: 'home' | 'pick' | 'plan' = view === 'pick' ? 'pick' : 'plan') => {
    fieldsBefore.current ??= { from: from.text, fromHit: from.hit, to: to.text, toHit: to.hit, back, preset, wish, car: carTrip }
    // 開いていた旅の日付が今日より前なら、新しい旅は次の土曜から（「戻る」で離れたら戻す）
    if (date < isoDate(new Date())) {
      fieldsBefore.current.date ??= date
      setDate(nextSaturday())
    }
    // 開いていたのが例のプランなら、例の時刻（7:30〜15:00）を引き継がず、ふつうの時刻（10:00〜18:00）から（「戻る」で離れたら戻す）
    if (data?.example) {
      fieldsBefore.current.times ??= { start, end, leeway }
      setStart(FIRST_START)
      setEnd(18 * 60)
      setLeeway(0)
    }
    setFormFrom(src)
    setAdjust(false)
    setFormDays(1)
    stayForms.forEach((f) => f.set('', null))
    setSameStay(true)
    setFormKind('day')
    dropTalk()
    setTalk({})
    setTalkLast('')
    setTalkPassed([])
    setTalkError('')
    setFormNote('')
    from.set('', null)
    to.set('', null)
    setBack(true)
    setPreset(null)
    setWish('')
    setCarTrip(false)
    carTouched.current = false
    setError('')
    setView('form')
  }
  startNewRef.current = startNew
  // 泊まりの旅で行き先を引き直したら、宿と観光を終える場所も、新しい行き先のエリアの名前で引き直す
  useEffect(() => {
    if (formKind === 'day' || view !== 'form' || !from.hit) return
    const near = nearOf(from.hit, from.text)
    ;[...stayForms, ...(back ? [] : [to])].forEach((f) => {
      if (f.text.trim()) void f.lookup(near)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.hit, formKind, view])
  // 1 行の文から読み取った差分を、入力の画面の欄に入れる（next: 差分を入れたあとのまとめ）
  const putTalk = (d: Partial<Talk>, next: Talk) => {
    if (d.from && next.from) {
      from.setText(next.from)
      setPreset(null)
    }
    // 宿と観光を終える場所は、行き先を引いてから、そのエリアの名前を前に付けて引く
    const looks: PlaceField[] = []
    const nights = next.nights ?? 0
    if (d.nights && nights) setFormDays(nights + 1)
    if ((d.stays || d.nights) && next.stays) {
      const { same, texts } = stayFieldsOf(next.stays.slice(0, nights || next.stays.length))
      setSameStay(same)
      stayForms.forEach((f, k) => {
        const t = texts[k] ?? ''
        if (t.trim() !== f.text.trim()) f.setText(t)
        if (t.trim()) looks.push(f)
      })
    }
    if (d.date) setDate(d.date)
    if (d.end === null) setBack(true)
    else if (d.end && next.end) {
      setBack(false)
      to.setText(next.end)
      looks.push(to)
    }
    const fromText = next.from ?? from.text
    void from.lookup().then((h) => {
      const near = nearOf(h, fromText)
      looks.forEach((f) => void f.lookup(near))
    })
    if (d.wish && next.wish) setWish(next.wish)
    const first = d.days?.[0] && next.days?.[0]
    if (first && (first.start !== undefined || first.end !== undefined)) {
      const st = first.start ?? start
      setStart(st)
      setEnd(fitEnd(st, first.end ?? end))
    }
  }
  // 欄で入力する形に切り替える（note: 切り替えたわけ、text: 送れなかった文。消さずに希望の欄に入れる）
  const toStayForm = (note: string, text = '') => {
    dropTalk()
    setFormKind('form')
    setFormNote(note)
    setTalkError('')
    if (formDays < 2) setFormDays(2)
    if (text.trim()) setWish((w) => joinWish(w, text))
  }
  // 1 行の文を送る。読み取れたら true（箱を空にする）。何も読み取れなかったときは、任意の問いならスキップと同じにし、
  // 行き先・泊数の問いと全部そろったあとなら、問いかけを変えずに一言を出す（箱の文は残す）。サーバーに届かない・上限・口のエラーは欄へ
  const talkSend = async (text: string): Promise<boolean> => {
    if (talkBusyRef.current || busy) return false
    talkBusyRef.current = true
    const seq = ++talkSeq.current
    const asked = nextQuestion(talk, talkPassed, !!talkLast)
    setTalkBusy(true)
    setTalkError('')
    let r: { diff?: Partial<Talk>; error?: string } | null = null
    try {
      r = await askTrip(text, talk, isoDate(new Date()))
    } catch {
      r = null
    }
    if (seq !== talkSeq.current) return false
    talkBusyRef.current = false
    setTalkBusy(false)
    if (!r) {
      toStayForm(T.talkOffline, text)
      return false
    }
    if (r.error || !r.diff) {
      toStayForm(r.error === 'quota' ? T.talkQuota : T.talkFailed, text)
      return false
    }
    if (!Object.keys(r.diff).length) {
      if (talk.over) setTalk({ ...talk, over: false })
      if (!canSkip(asked)) {
        setTalkError(T.talkEmpty)
        return false
      }
      setTalkLast(text)
      setTalkPassed((x) => (x.includes(asked) ? x : [...x, asked]))
      return true
    }
    const next = mergeTalk(talk, r.diff)
    const said = mentionsCar(text)
    if (said !== null && !carTouched.current) setCarTrip(said)
    setTalk(next)
    putTalk(r.diff, next)
    setTalkLast(text)
    if (canSkip(asked)) setTalkPassed((x) => (x.includes(asked) ? x : [...x, asked]))
    return true
  }
  // 日帰りか泊まりかを切り替える。泊まりは 1 行の文から作る形で始め、それまでのまとめを欄に入れ直す
  const switchKind = (stay: boolean) => {
    if (busy && formKind === 'talk') return
    dropTalk()
    setFormNote('')
    setError('')
    if (!stay) {
      setFormKind('day')
      setFormDays(1)
      stayForms.forEach((f) => f.set('', null))
      setSameStay(true)
      return
    }
    setTalkError('')
    setFormKind('talk')
    // 日付と出発の時刻は、最初の値から変えてあるときだけ、入力した物としてまとめに入れる
    const next: Talk = {
      ...talk,
      ...(from.text.trim() && { from: from.text.trim() }),
      ...(wish.trim() && { wish: wish.trim() }),
      ...(date !== nextSaturday() && { date }),
      ...(start !== FIRST_START && { days: [{ ...talk.days?.[0], start }, ...(talk.days ?? []).slice(1)] }),
    }
    setTalk(next)
    const { from: _from, wish: _wish, ...rest } = next
    putTalk(rest, next)
  }
  // 調整の画面を閉じたら、送っている途中の頼みは取りやめる
  const closeAdjust = useCallback(() => {
    askSeq.current++
    setAdjust(false)
  }, [])
  // 選ぶ画面で集めている途中の候補を取りやめる
  const stopPicking = () => {
    if (pickJob.current === null) return
    jobSeq.current++
    if (timer.current) window.clearTimeout(timer.current)
    pickJob.current = null
    setProgress(null)
    setPartial(false)
  }
  // 旅に次の日を加える（前の日の終わりの場所から、次の日の候補を集めて選ぶ画面へ。前の日までに入れた場所は候補から除く）
  // （宿を入れた旅は、1日目は宿まで・中の日は宿から宿へ・最終日は宿から最後に観光を終える場所まで）
  const startAddDay = (over: (s: Saved) => Saved = (s) => s) => {
    if (!data || busy || adding) return
    const cur = over(savedNow(data))
    const list = allDays(cur)
    const last = list[list.length - 1]
    const used = usedPlaces(cur)
    setAdding({ n: list.length + 1, date: nextDate(last.date) })
    setPick(null)
    const want = dayWants(cur, list.length + 1)
    const left = cur.carry ?? []
    const met = metWishes(cur)
    void create({ trip: addDayAsk(cur), wish: want ? want.wish : (last.data.query?.wish ?? last.wish).trim(), keep: (d) => withCarry(quietMet(dropUsed(d, used), met), left).data })
  }
  // プランを変更のシートの宿を引くときに前に付ける、1日目の出発地のエリアの名前
  const sheetNear = (s: Saved) => nearOf(null, allDays(s)[0].data.query?.start?.text ?? '')
  // 宿の欄の宿を引く（空の欄は null）。引けない欄があれば null。near: 前に付けるエリアの名前
  const lookStays = async (fields: PlaceField[], near?: string): Promise<Stays | null> => {
    const hits = await Promise.all(fields.map((f) => (f.text.trim() ? f.lookup(near) : Promise.resolve(null))))
    if (fields.some((f, j) => f.text.trim() && !hits[j])) return null
    return hits.map((h, j) => (h ? tripPoint(fields[j], h) : null))
  }
  // プランを変更のシートで入れた宿を、旅に入れる。旅の取っておく形に宿を入れる関数を返し、引けなかったときは null。
  // 欄は、これから作る日に効く泊（作った日数 made より後の泊）だけ。空の欄と、毎晩同じ宿のときの 2 つめからの泊は、前の泊と同じ
  const commitStay = async (): Promise<((s: Saved) => Saved) | null> => {
    const keep = (s: Saved) => s
    if (!data) return keep
    const cur = savedNow(data)
    const made = allDays(cur).length
    const count = Math.max(0, plannedDays(cur) - 1 - made)
    if (!count) return keep
    const vals = await lookStays(staySheets.slice(0, sheetSame ? 1 : count), sheetNear(cur))
    if (!vals) return null
    const head: Stays = Array.from({ length: made }, (_, k) => stays[k] ?? null)
    const next: Stays = [...head, ...vals]
    if (JSON.stringify(trimStays(next)) === JSON.stringify(trimStays(stays))) return keep
    const put = (s: Saved) => withStays(s, next)
    const s = put(savedNow(data))
    setStays(s.stays ?? [])
    setTripEnd(s.tripEnd)
    return put
  }
  // プランを変更のシートで、注意の出ている宿の欄を見える所まで送る
  const showStayNote = () =>
    window.setTimeout(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      document.querySelector('.sheet .stay-field .note.warn')?.closest('.stay-field')?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    }, 50)
  // 次の日を加えるのをやめて、元の日のプランに戻る
  const cancelAdd = () => {
    stopPicking()
    jobSeq.current++
    if (timer.current) window.clearTimeout(timer.current)
    setBusy(null)
    setAdding(null)
    setPick(null)
  }
  // 開く日を替える（入れ替えた形を取っておき、旅を開き直す。窓の位置はそのまま）
  const openDay = (i: number) => {
    if (!data || i === dayAt) return
    const next = switchDay(savedNow(data), i)
    if (!writeSaved(next)) return
    keepScroll()
    reopenCurrent()
  }
  // 開いている日を消して、前の日を開く
  const deleteDay = () => {
    if (!data || !days || days.length < 2) return
    if (!window.confirm(DAY_TEXT.confirm(dayAt + 1))) return
    const next = removeDay(savedNow(data))
    if (!writeSaved(next)) return
    queueCloudSave()
    setAdjust(false)
    keepScroll()
    reopenCurrent()
  }
  // プランの画面で開いているシートを閉じる
  const closePlanSheets = () => {
    setOpenId(null)
    setCandId(null)
    setBusSheet(null)
    setTransitIdx(null)
    setWalkIdx(null)
    setAdjust(false)
  }
  // スマホの「戻る」で前の画面の段に来たら、画面の中の「戻る」・「キャンセル」と同じ処理で戻る。戻した先の画面を返す。
  // この App で出していない選ぶ画面（読み直す前の候補）には戻らず、ホーム画面へ
  const shown = useRef(new Set<string>())
  const screen = view === 'pick' && exampleAsked() ? null : view
  useEffect(() => {
    if (screen) shown.current.add(screen)
  }, [screen])
  useScreenBack(screen, (stack) => {
    markBack()
    const to = stack[stack.length - 1]
    const below = stack[stack.length - 2]
    if (view === 'form') {
      if (busy) {
        cancelJob()
        return formFrom !== 'plan' ? formFrom : data ? 'plan' : 'form'
      }
      if (formFrom === 'plan' && !data) return 'form'
      leaveForm(formFrom)
      return formFrom
    }
    if (view === 'pick' && adding) {
      cancelAdd()
      setView('plan')
      return 'plan'
    }
    if (view === 'pick') {
      stopPicking()
      const dest = to === 'form' && shown.current.has('form') ? 'form' : to === 'plan' && data ? 'plan' : 'home'
      if (dest === 'form') setFormFrom(below === 'pick' || (below === 'plan' && data) ? below : 'home')
      setView(dest)
      return dest
    }
    if (view === 'plan') {
      closePlanSheets()
      const dest = to === 'pick' && shown.current.has('pick') ? 'pick' : 'home'
      setView(dest)
      return dest
    }
    return view
  })
  // 次の日の候補を検索している間は、スマホの「戻る」で検索をやめて元の日のプランに戻る
  const addWait = view === 'plan' && !!adding && !!busy
  useBackClose(addWait, cancelAdd)

  if (view === 'home') {
    // 何日かある旅は、全日の場所の名前と日付（開いている日はプランの並び、ほかの日は取っておいた並び）
    const here = plan?.stops.map((s) => s.spot.name)
    const all = data && days && days.length > 1 ? allDays(savedNow(data)) : null
    const names = all
      ? all.flatMap((d, i) => {
          if (i === dayAt) return here ?? []
          const byId = new Map(d.data.places.map((p) => [p.id, p.name]))
          return dayStopIds(d).flatMap((id) => (byId.has(id) ? [byId.get(id) as string] : []))
        })
      : here
    // 例のプランを見ただけのときは、自分の旅として出さない
    const mine = !!data && !untouchedDemo(savedNow(data))
    return (
      <Home
        device={data && mine ? { title: stayTitle(savedNow(data)) ?? tripTitle(all ? all[0].data : data, all ? all[0].areaText : from.text), date: all ? all[0].date : date, ...(all && { dates: all.map((d) => d.date) }), places: names, first: all && dayAt > 0 ? (all[0].data.places.find((p) => p.id === dayStopIds(all[0])[0]) ?? null) : (plan?.stops[0]?.spot ?? null) } : null}
        onOpenDevice={() => setView(data ? 'plan' : 'pick')}
        onRecapDevice={() => {
          setView(data ? 'plan' : 'pick')
          if (data) setRecap(true)
        }}
        onRemoveDevice={() => {
          clearSaved()
          setDays(null)
          setDayAt(0)
          setPlanDays(1)
          setStays([])
          setTripEnd(undefined)
          setWants(undefined)
          setCarry([])
          setData(null)
          setPick(null)
        }}
        onExample={() => {
          askExample()
          setPick(null)
          setAdjust(false)
          setView('pick')
        }}
        other={other ? { title: stayTitle(other) ?? tripTitle(other.data, other.areaText), date: other.date } : null}
      />
    )
  }

  if (view === 'pick') {
    const picking = pickJob.current !== null
    // 泊まりの旅の何日目か・その日の時刻（加える日は、まとめにその日の時刻があればそれ）・前の日までに入りきらなかった場所
    const cur = adding && data ? savedNow(data) : null
    const total = cur ? plannedDays(cur) : formDays
    const dayNo = adding ? adding.n : pick && formDays > 1 ? 1 : undefined
    const want = cur && adding ? dayWants(cur, adding.n) : null
    const dayStart = want?.start ?? start
    const dayEnd = want && (want.start !== undefined || want.end !== undefined) ? fitEnd(dayStart, want.end ?? end) : end
    const carried = adding && pick ? withCarry(pick.data, carry).ids : undefined
    return (
      <StartPick
        key={pick?.key ?? 0}
        map={MapPart}
        area={pick?.data ?? null}
        {...(adding && data && { title: stayTitle(savedNow(data)) ?? undefined })}
        date={adding?.date ?? date}
        {...(adding && { back: { label: T.plan, aria: T.backToPlan } })}
        {...(dayNo && { dayNo })}
        {...(carried?.length && { chosen: carried })}
        span={{ start: dayStart, end: dayEnd }}
        {...(dayNo && dayNo < total && { room: { minutes: dayEnd - dayStart, next: dayNo + 1 } })}
        note={picking && progress?.more ? T.findingMore : picking && partial ? T.partial : ''}
        onDone={(d: AreaData, mustIds: string[], pins: Picked[], since: number, opts: { fill: boolean; start?: number; end?: number; example?: boolean }) => {
          const wasPartial = picking && partial
          pickJob.current = null
          const { busTable: pack, ...plain } = d as AreaData & { busTable?: PackedTable }
          const got: AreaData = pack ? plain : d
          const area: AreaData = opts.example ? { ...got, demo: true } : got
          apply(area)
          // 同じ曜日の種類と時間帯なら、同梱の時刻表をすぐに使う（取りに行って組み直さない）。例のプランは、例の出発と帰る時刻で比べる
          const st = opts.start ?? start
          const en = opts.end ?? end
          const day = opts.example ? nextSaturday() : (adding?.date ?? date)
          if (pack && isHoliday(pack.date) === isHoliday(day) && pack.start === st && pack.end === en) {
            const { date: _date, start: _start, end: _end, sources, ...table } = pack
            packed.current = { data: area, date: day, start: st, end: en }
            tableFor.current = `${area.area.name}|${day}`
            setBusTable({ date: day, table, sources })
            setReady(area.area.name)
          }
          if (adding && data) {
            // 旅に次の日を加える。since は旅の始まりのまま（全日で 1 つの旅）
            const cur = savedNow(data)
            const added = addDayTo(cur, cur)
            setDays(added.days ?? null)
            setDayAt(added.day ?? 0)
            setPlanDays(plannedDays(added))
            setDate(adding.date)
            // まとめにその日の時刻があれば使い、無ければ前の日の時刻を引き継ぐ
            const want = dayWants(cur, adding.n)
            if (want?.start !== undefined || want?.end !== undefined) {
              const st = want.start ?? start
              setStart(st)
              setEnd(fitEnd(st, want.end ?? end))
            }
            setNudgeSince(0)
            setFavSince(0)
            setAdding(null)
            const total = plannedDays(added)
            carryAsk.current = { next: adding.n < total ? adding.n + 1 : null, at: Date.now() }
          } else {
            setDays(null)
            setDayAt(0)
            setPlanDays(opts.example ? 1 : formDays)
            const st = !opts.example && formDays > 1 ? formStay.current : null
            setStays(st?.stays ?? [])
            setTripEnd(st ? st.end : undefined)
            setWants(!opts.example && formDays > 1 ? formWants.current : undefined)
            setCarry([])
            carryAsk.current = !opts.example && formDays > 1 ? { next: 2, at: Date.now() } : null
            setTripSince(since)
            setEdited(false)
            setNudgeSince(since)
            if (!favDone.current.has(since)) setFavSince(since)
          }
          farAsk.current = true
          setPartial(wasPartial)
          setMust(mustIds)
          if (carryAsk.current) setLoose(mustIds)
          setPinned(pins)
          setFill(opts.fill)
          if (opts.start !== undefined) setStart(opts.start)
          if (opts.end !== undefined) setEnd(opts.end)
          // 例のプランは、前の旅の日付と回り方を引き継がず、次の土曜・ふつうの回り方で開く（例のデータの時刻表と数字のとおりに出す）
          if (opts.example) {
            setDate(nextSaturday())
            setPace('normal')
            setMoveLess(false)
            setCalm(false)
            setLeeway(0)
          }
          namedSeen.current = new Set(d.places.filter((p) => p.named).map((p) => p.id))
        }}
        onOtherArea={() => {
          if (adding) cancelAdd()
          startNew(adding ? 'plan' : undefined)
        }}
        onHome={() => {
          // 集めている途中の候補は取りやめて、ホーム画面へ（次の日を加えている途中なら、元の日のプランへ）
          markBack()
          if (adding) {
            cancelAdd()
            setView('plan')
            return
          }
          stopPicking()
          setView('home')
        }}
        onFail={() => {
          setFormFrom('home')
          setView('form')
        }}
      />
    )
  }

  if (view === 'form' || !data) {
    return (
      <PlanForm
        from={from}
        to={to}
        stays={stayForms}
        sameStay={sameStay}
        onSameStay={(v) => {
          setSameStay(v)
          if (v) stayForms.slice(1).forEach((f) => f.set('', null))
        }}
        back={back}
        wish={wish}
        car={carTrip}
        onCar={(v) => {
          carTouched.current = true
          setCarTrip(v)
        }}
        date={date}
        start={start}
        end={end}
        busy={busy}
        error={error}
        canCancel={formFrom !== 'plan' || !!data}
        backLabel={formFrom === 'plan' ? T.backToPlan : T.back}
        onFrom={(v) => {
          from.setText(v)
          setPreset(null)
        }}
        onExample={(name, start) => {
          if (start) from.set(name, start)
          else {
            from.setText(name)
            void from.lookup()
          }
          setPreset(start ? name : null)
        }}
        onTo={to.setText}
        onBack={setBack}
        onWish={(v) => {
          setWish(v)
          const said = mentionsCar(v)
          if (said !== null && !carTouched.current) setCarTrip(said)
        }}
        onDate={setDate}
        onStart={setStart}
        onEnd={setEnd}
        days={formDays}
        onDays={(n) => {
          setFormDays(n)
          stayForms.forEach((f, k) => k >= n - 1 && f.set('', null))
        }}
        leeway={leeway}
        onLeeway={setLeeway}
        onSubmit={create}
        onCancel={busy ? cancelJob : () => leaveForm(formFrom)}
        kind={formKind}
        onKind={switchKind}
        formNote={formNote}
        talk={{
          talk,
          question: nextQuestion(talk, talkPassed, !!talkLast),
          last: talkLast,
          busy: talkBusy,
          error: talkError,
          ready: talkReady(talk),
          showDate: !!talk.date || talkPassed.includes('date'),
          onSend: talkSend,
          onSkip: () => {
            if (busy) return
            const q = nextQuestion(talk, talkPassed, !!talkLast)
            setTalkPassed((x) => (x.includes(q) ? x : [...x, q]))
          },
          onManual: () => {
            if (!busy) toStayForm('')
          },
        }}
      />
    )
  }

  const skyLabel = weather ? weatherLabel(weather.code) : ''
  // 上の見出しなどに見せる題（宿を入れた旅は全日で同じ）
  const shownName = stayTitle(savedNow(data)) ?? data.area.name
  const header = (
    <header className="top" ref={topRef}>
      <HomeButton
        onClick={() => {
          if (addWait) cancelAdd()
          closePlanSheets()
          setView('home')
        }}
      />
      <div className="top-title">
        <Heading level={1} maxLines={1} hasTruncateTooltip={false}>
          {shownName}
        </Heading>
        <Text as="p" display="block" type="supporting">
          <span className="num">{dateLabel(addWait && adding ? adding.date : date)}</span>
          {weather && !addWait && (
            <span className="num sky" title={skyLabel}>
              <WeatherIcon sky={weatherSky(weather.code)} label={skyLabel} />
              {weather.max}℃/{weather.min}℃
            </span>
          )}
        </Text>
      </div>
      <div className="top-actions">
        <ShareMenu disabled={!plan || addWait} onText={share} onImage={() => setPlanImage(true)} />
        <Button variant="secondary" label={hasServer ? T.adjust : T.adjustPlain} icon={hasServer ? <SparkIcon size={16} /> : undefined} isDisabled={!plan || addWait} onClick={() => { setOpenId(null); setCandId(null); setBusSheet(null); setTransitIdx(null); setWalkIdx(null); setAdjust(true) }} />
      </div>
    </header>
  )

  if (!plan) {
    return (
      <div className="plan-view">
        {header}
        <div className="map-pane">
          <MapPart data={data} plan={null} focusId={null} candidates={[]} onOpen={setOpenId} onCandidate={setCandId} onNotice={notice} />
        </div>
        <main className="panel" aria-busy="true">
          <Text as="p" display="block" type="supporting" className="note pulse">
            {T.making}
          </Text>
        </main>
      </div>
    )
  }

  const late = plan.finish - end
  // 何日かある旅の、予定している全日の日付（加えている途中の日も入れる）と、次の日を加えられるか。例のプランは作った日だけ
  const savedHere = savedNow(data)
  const made = allDays(savedHere).length
  const dayDates = tabDates(savedHere, adding?.n)
  const roomForDay = !data.demo && canAddDay(savedHere, LIMITS.state)
  const lastDay = !days || dayAt === days.length - 1
  // 開いている日の出発地・到着地が宿か。宿の欄は、これから作る日があるときだけシートに出す
  const ends = stayEnds({ data }, stays)
  const planned = plannedDays(savedHere)
  // シートの宿の欄: これから作る日に効く泊（made+1 泊目〜最後の泊）と、離れすぎの一言（前の泊の宿か前の日の終わりの場所から、最後は観光を終える場所まで）
  const sheetNights = Array.from({ length: Math.max(0, planned - 1 - made) }, (_, k) => made + 1 + k)
  const nightBefore = nightStay(stays, made - 1)
  const stayGoal = tripGoal(savedHere) ?? allDays(savedHere)[0].data.query?.start ?? null
  const sheetFields = shownNights(sheetNights, sheetSame).map((_, j) => staySheets[j])
  const stayFar = adjust && sheetNights.length ? stayFarTexts(hitOf(nightBefore ?? dayGoal(allDays(savedHere)[made - 1])), sheetFields.map((f) => (f.text.trim() ? f.hit : null)), stayGoal ? hitOf(stayGoal) : null, !!nightBefore) : []
  const canAdd = lastDay && plan.stops.length > 0 && roomForDay
  // 泊まりの旅か（入りきらない場所は消さずに、まだ入れていない場所に回す）と、開いている日の次の日（最終日は null）
  const multi = !data.demo && planned > 1
  const nextDay = multi && dayAt + 1 < planned ? dayAt + 2 : null
  const pickDay = (i: number) => {
    if (adding) return
    if (i < made) openDay(i)
    else if (i === made) startAddDay()
  }
  // スケジュールの見出しを、上に貼り付いた見出しのすぐ下まで送る
  const toSchedule = () => {
    const el = document.querySelector('.schedule')
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - (document.querySelector<HTMLElement>('header.top')?.offsetHeight ?? 0) - 8
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  // 時間の内訳（出発から帰着まで＝滞在＋移動＋待ち・ゆとり）。待ち・ゆとりは、開くまでの待ち・場所の間のゆとり・便を待つ分
  const stayTotal = plan.stops.reduce((n, s) => n + s.stay, 0)
  const slack = Math.max(0, plan.finish - plan.leave - stayTotal - plan.moving)
  // 帰る時刻に入りきらないとき、外す場所を本人に選んでもらう（滞在の長い順。食事は、ほかに無いときだけ）
  const fitAsk = (() => {
    if (late < FIT_ASK_LATE) return []
    const byLength = (list: Stop[]) => list.slice().sort((a, b) => b.stay + b.wait - (a.stay + a.wait)).slice(0, FIT_ASK_MAX)
    const light = plan.stops.filter((s) => s.slot === 'sight' || s.slot === 'cafe')
    return byLength(light.length ? light : plan.stops)
  })()
  const wear = weather ? wearFor(weather, plan.leave, plan.finish) : null
  const openIndex = open ? plan.stops.indexOf(open) : -1
  // 区間だけを見ている画面（便を選ぶ・乗換を入れる）の区間。地図はその区間を濃くし、映す範囲もその区間に合わせる
  const legView =
    busSheet && busSheet.idx <= plan.stops.length
      ? busSheet.idx
      : transitIdx !== null && transitIdx <= plan.stops.length
        ? transitIdx
        : walkIdx !== null && walkIdx <= plan.stops.length
          ? walkIdx
          : null
  // 区間の画面を開いている間に地図の場所や候補を押したら、区間の画面を閉じてそちらを開く
  const leaveLeg = () => {
    setBusSheet(null)
    setTransitIdx(null)
    setWalkIdx(null)
  }
  // 区間の名前（legKey）と両端の名前
  const legAt = (i: number) => {
    const from = i === 0 ? { id: 'start', name: data.start.name } : { id: plan.stops[i - 1].spot.id, name: plan.stops[i - 1].spot.name }
    const to = i === plan.stops.length ? { id: goalId(data), name: goalOf(data).name } : { id: plan.stops[i].spot.id, name: plan.stops[i].spot.name }
    return { key: legKey(from.id, to.id), from, to, leg: i === plan.stops.length ? plan.back : plan.stops[i].leg }
  }
  // 区間の手段を選ぶ（null は自動に戻す）。歩くにしても、その区間に入れた経路・便は取っておく（自動や電車・バスに戻すと、また使う）
  const chooseMode = (i: number, m: LegMode | null) => {
    const { key } = legAt(i)
    edit([{ t: m === 'walk' ? T.legWalk : m === 'transit' ? T.legTransit : m === 'car' ? T.legCar : T.legAuto }], () => {
      setModes((x) => {
        const n = { ...x }
        if (m) n[key] = m
        else delete n[key]
        return n
      })
    })
    setBusSheet(null)
    setTransitIdx(null)
    setWalkIdx(null)
  }

  // 次の日の候補を検索している間は、前の日のプランを見せず、1日目を作るときと同じ進み具合を出す
  if (addWait && busy) {
    return (
      <div className="plan-view">
        {header}
        <div className="map-pane">
          <MapPart data={data} plan={null} focusId={null} candidates={[]} onOpen={() => {}} onCandidate={() => {}} onNotice={notice} />
        </div>
        <main className="panel" aria-busy="true">
          {dayDates && <DayTabs dates={dayDates} made={made} at={adding ? adding.n - 1 : dayAt} next={false} onPick={pickDay} />}
          {showSearchWait(busy) ? <SearchWait busy={busy} onCancel={cancelAdd} /> : <DayStatus busy error="" />}
        </main>
      </div>
    )
  }

  return (
    <div className="plan-view">
      {header}
      <div className="map-pane">
        <MapPart
          data={data}
          plan={plan}
          car={car}
          focusId={openId}
          candidates={candidates}
          candId={peekId ?? pickerShow ?? candId}
          showId={peekId}
          legIdx={legView}
          buses={buses}
          changed={changed}
          onOpen={(id) => {
            leaveLeg()
            setOpenId(id)
          }}
          onCandidate={(id) => {
            leaveLeg()
            pickCandidate(id)
          }}
          onLeg={(i) => {
            const leg = i === plan.stops.length ? plan.back : plan.stops[i]?.leg
            if (!leg) return
            closeOthers()
            if (leg.mode !== 'transit') setWalkIdx(i)
            else if (legOpensBus(leg, buses[i])) openBus(i)
            else setTransitIdx(i)
          }}
          onNotice={notice}
          onAreaSearch={hasServer ? openAreaSearch : undefined}
          areaBox={areaBoxRef}
          searching={!!area?.busy}
          found={area?.found ?? undefined}
          foundId={area?.picked ?? null}
          onFound={(id) => {
            closeOthers()
            setArea((a) => (a ? { ...a, picked: id } : a))
          }}
        />
      </div>

      <main className="panel" aria-busy={pending}>
        {data.demo && <DemoOwn area={data.area.name} onOwn={() => startNew('plan')} />}
        {dayDates && <DayTabs dates={dayDates} made={made} at={adding ? adding.n - 1 : dayAt} next={roomForDay && !busy} onPick={pickDay} />}
        {!data.demo && <DayStatus busy={!!busy && !!adding} error={addError} />}
        {dayDates && carry.length > 0 && <CarryLine names={carry.map((p) => p.name)} />}
        {today && <NextCard plan={plan} now={now} onOpen={setOpenId} />}
        {offer && <PlanOffer offer={offer} onTake={takeOffer} onKeep={() => setOffer(null)} />}
        {!today && plan.stops[0] && (
          <button type="button" className="to-sched" aria-label={T.toSchedOf(fmt(plan.stops[0].arrive), plan.stops[0].spot.name)} onClick={toSchedule}>
            <span className="to-sched-first" aria-hidden="true">
              <span className="to-sched-label">{T.firstAt}</span>
              <span className="to-sched-time num">{fmt(plan.stops[0].arrive)}</span>
              <span className="to-sched-name">{plan.stops[0].spot.name}</span>
            </span>
            <span className="to-sched-go" aria-hidden="true">
              {T.toSched}
              <Icon icon="chevronDown" />
            </span>
          </button>
        )}
        <Card className="summary" role="region" aria-label={T.summary} padding={4}>
          <div className="sum-trip">
            <LookForward data={data} plan={plan} input={input} date={date} />
            <button type="button" className="sum-time-row" aria-label={`${T.timeRange(fmt(plan.leave), fmt(plan.finish))}${T.listSep}${T.stopsN(plan.stops.length)}${T.listSep}${T.breakdown}`} onClick={() => setStatsOpen(true)}>
              <span className="sum-time num" aria-hidden="true">
                {fmt(plan.leave)}–{fmt(plan.finish)}
              </span>
              <span className="sum-count num" aria-hidden="true">
                {T.stopsN(plan.stops.length)}
              </span>
              <Icon icon="chevronRight" color="inherit" size="xsm" />
            </button>
          </div>
          <Compare plan={plan} usual={usual} end={end} />
        </Card>
        <CrowdSwap
          data={data}
          plan={plan}
          input={input}
          onOpen={() => {
            closeOthers()
            setCrowdOpen(true)
          }}
        />
        {late > 0 && <p className="note sum-note warn num">{keepWhole(T.late(fmtDur(late), !!data.end || ends.to, fmt(end)), fmtDur(late), fmt(end))}</p>}
        {late > 0 && fitAsk.length > 0 && (
          <div className="sum-fit" role="group" aria-labelledby="sum-fit-q">
            <p className="note" id="sum-fit-q">
              {nextDay ? T.fitAskNext(nextDay) : T.fitAsk}
            </p>
            <div className="sum-fit-list">
              {fitAsk.map((s) => (
                <Button key={s.spot.id} variant="secondary" size="sm" label={nextDay ? T.fitCarry(s.spot.name, nextDay) : T.fitDrop(s.spot.name)} onClick={() => (multi ? carryStop(s, nextDay) : removeStop(s))}>
                  {s.spot.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        {-late - leeway >= 60 && !fill && (
          <button type="button" className="sum-link num" onClick={() => edit([{ t: T.fillDone }], () => setFill(true))}>
            <span>{keepWhole(T.early(fmtDur(-late), !!data.end || ends.to, fmt(end)), fmtDur(-late), fmt(end))}</span>
            <span className="sum-link-do">{T.fillShort}</span>
          </button>
        )}

        <section className="schedule" aria-labelledby="route-title">
          <div className="sec-head">
            <Heading level={2} id="route-title" className="sec-title">
              {T.schedule}
            </Heading>
            <div className="sec-head-actions">
              {!editing && <Button variant="secondary" size="sm" className="sched-pick" label={T.pick} onClick={() => { setOpenId(null); setCandId(null); setPicker(true) }} />}
              {plan.stops.length > 1 && (
                <Button variant={editing ? 'primary' : 'secondary'} size="sm" className="sched-edit" label={editing ? T.doneOrder : T.editOrder} onClick={() => { setOpenId(null); setCandId(null); setEditing(!editing) }} />
              )}
            </div>
          </div>
          {!editing && <CrowdLegend />}
          <RouteList
            data={data}
            plan={plan}
            date={date}
            changed={changed}
            buses={buses}
            slopes={slope.slopes}
            onOpen={setOpenId}
            onTransit={setTransitIdx}
            onBus={openBus}
            onWalk={(i) => {
              closeOthers()
              setWalkIdx(i)
            }}
            onMove={moveStop}
            onMoveTo={moveStopTo}
            editing={editing && plan.stops.length > 1}
            stay={ends}
          />
        </section>

        {favSince > 0 && favSince === tripSince ? (
          <FavAsk
            key={`${favSince}:${favAgain}`}
            area={data.area.name}
            plan={plan}
            since={favSince}
            force={favAgain}
            onNotice={notice}
            onClose={() => {
              favDone.current.add(favSince)
              setFavSince(0)
              setFavAgain(false)
            }}
          />
        ) : (
          tripSince > 0 &&
          favDone.current.has(tripSince) &&
          plan.stops.length > 0 && (
            <Button
              variant="ghost"
              className="fav-back"
              label={T.favBack}
              onClick={() => {
                setFavAgain(true)
                setFavSince(tripSince)
              }}
            />
          )
        )}
        {/* 服装の目安は、ペンギンの一言を開いていても閉じていても出す（開け閉めで別の札が消えないように） */}
        {wear && <WearCard wear={wear} />}
        {penguinLines && !penguinOff ? (
          <PenguinNote lines={penguinLines} open onToggle={() => setPenguinOff(true)} />
        ) : (
          penguinOff && hasServer && <PenguinNote lines={[]} open={false} onToggle={() => setPenguinOff(false)} />
        )}
        <TripOdai area={data.area.name} date={dateLabel(date)} plan={plan} count={odaiCount} level={odaiLevel} since={tripSince} early={daysUntil(date) > 0} onLevel={(v) => { setOdaiLevel(v); saveLevel(v) }} onOpen={setOpenId} onNotice={notice} />
        {/* 上の「旅のミッション」と同じ形の札。印は ›（その場で開くのではなく、振り返りの画面へ進む） */}
        <section className="recap-entry odai odai-fold" aria-label={T.recap}>
          <button type="button" className="odai-toggle recap-open" onClick={() => setRecap(true)}>
            {T.recapOpen}
          </button>
        </section>
        {/* ログインの勧めは、プランの中身を全部見せた後（一番下）に出す */}
        {nudgeSince > 0 && nudgeSince === tripSince && <SaveNudge since={nudgeSince} />}

        <footer className="plan-foot">
          <p className="note foot">
            {progress?.more
              ? T.footMore
              : progress
                ? T.footChecking
                : partial
                  ? T.footPartial
                  : ''}
            {car ? T.footCar : T.footEstimate}
          </p>
          {busShown && (
            <BusCredit sources={busSources} contact={busInfo.contact} className="note foot" />
          )}
          {slope.used && <ElevCredit className="note foot" />}
          <OsmCredit className="note foot" label={railShown ? T.osmRail : undefined} />
        </footer>
      </main>

      {area && googleShown && !openId && !candId && !busSheet && transitIdx === null && walkIdx === null && !adjust && (
        <Suspense fallback={null}><AreaSearchSheet
          q={area.q}
          busy={area.busy}
          error={area.error}
          found={area.found}
          picked={area.picked}
          date={date}
          span={[start, end]}
          visitAt={(pid) => plan.stops.find((s) => s.spot.placeId === pid)?.arrive ?? null}
          candidateOf={(pid) => data.places.find((p) => p.placeId === pid)?.id ?? null}
          inPlan={(id) => plan.stops.some((s) => s.spot.id === id)}
          onSearch={runAreaSearch}
          onPick={(pid) => setArea((a) => (a ? { ...a, picked: pid } : a))}
          onCandidate={(id) => {
            setArea(null)
            pickCandidate(id)
          }}
          onAdd={(id) => {
            setArea(null)
            togglePlace(id, false)
          }}
          onAddFound={(f) => {
            const s = spotOfFound(f, data.area, date)
            setArea(null)
            setData((cur) => (cur && !cur.places.some((p) => p.id === s.id) ? { ...cur, places: [...cur.places, s] } : cur))
            togglePlace(s.id, false, s)
          }}
          onClose={() => setArea(null)}
        /></Suspense>
      )}
      {busSheet && busSheet.idx <= plan.stops.length && (() => {
        const l = busLegs.find((x) => x.index === busSheet.idx)
        if (!l) return null
        const chosen = l.leg.real?.bus ?? null
        return (
          <BusSheet
            fromName={l.fromName}
            toName={l.toName}
            leg={l.leg}
            trips={busSheet.trips}
            chosen={chosen}
            current={buses[l.index]}
            rail={l.leg.rail}
            sources={busSources}
            contact={busInfo.contact}
            onChoose={(t) => {
              edit(say(T.busAdded(t.board.time), busName(t)), () =>
                setOverrides((o) => ({ ...o, [l.key]: busRoute(t, date, busSheet.after) })),
              )
              setBusSheet(null)
            }}
            onRemove={() => {
              edit([{ t: T.busRemoved }], () =>
                setOverrides((o) => {
                  const n = { ...o }
                  delete n[l.key]
                  return n
                }),
              )
              setBusSheet(null)
            }}
            onTransit={() => {
              setBusSheet(null)
              setTransitIdx(l.index)
            }}
            onMode={(m) => chooseMode(l.index, m)}
            onClose={() => setBusSheet(null)}
          />
        )
      })()}
      {transitIdx !== null && transitIdx <= plan.stops.length && (() => {
        const i = transitIdx
        const from = i === 0 ? { id: 'start', name: data.start.name } : { id: plan.stops[i - 1].spot.id, name: plan.stops[i - 1].spot.name }
        const to = i === plan.stops.length ? { id: goalId(data), name: goalOf(data).name } : { id: plan.stops[i].spot.id, name: plan.stops[i].spot.name }
        const leg = i === plan.stops.length ? plan.back : plan.stops[i].leg
        const key = legKey(from.id, to.id)
        return (
          <Suspense fallback={null}><TransitSheet
            fromName={from.name}
            toName={to.name}
            leg={leg}
            noTable={!busInfo.on && busAsked === `${date}|${areaBox(data)}`}
            onSave={(r) => {
              edit([{ t: T.routeAdded }], () => setOverrides((o) => ({ ...o, [key]: r })))
              setTransitIdx(null)
            }}
            onRemove={() => {
              edit([{ t: T.routeRemoved }], () =>
                setOverrides((o) => {
                  const n = { ...o }
                  delete n[key]
                  return n
                }),
              )
              setTransitIdx(null)
            }}
            onMode={(m) => chooseMode(i, m)}
            onClose={() => setTransitIdx(null)}
          /></Suspense>
        )
      })()}
      {/* 時間の内訳。ほかのシートと同じく一覧の外に置く（一覧の中だと、広い画面で上の帯の下に潜る） */}
      {statsOpen && (
        <Sheet title={T.breakdown} lead={`${fmt(plan.leave)}–${fmt(plan.finish)}`} onClose={() => setStatsOpen(false)} card>
          <dl className="sum-stats num">
            {(
              [
                [T.placesL, T.stopsN(plan.stops.length)],
                [T.stayN, fmtDur(stayTotal)],
                [T.movingL, fmtDur(plan.moving)],
                [T.waitL, fmtDur(slack)],
              ] as [string, string][]
            )
              .filter(([k]) => k !== T.waitL || slack > 0)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {-late - leeway >= 30 && (
            <Text as="p" display="block" type="supporting" className="note num">
              {T.early(fmtDur(-late), !!data.end || ends.to, fmt(end))}
            </Text>
          )}
        </Sheet>
      )}
      {crowdOpen && <CrowdSwapSheet data={data} plan={plan} input={input} onSwap={(from, to) => swap(from, to, false)} onClose={() => setCrowdOpen(false)} />}
      {walkIdx !== null && walkIdx <= plan.stops.length && (() => {
        const { from, to, leg } = legAt(walkIdx)
        return <LegModeSheet fromName={from.name} toName={to.name} leg={leg} slope={slope.slopes?.[walkIdx]} car={car} onMode={(m) => chooseMode(walkIdx, m)} onClose={() => setWalkIdx(null)} />
      })()}
      {open && peekSpot && (
        <CandidateSheet
          key={peekSpot.id}
          data={data}
          spot={peekSpot}
          day={day}
          planDate={date}
          visitHour={Math.floor((open.arrive + open.stay / 2) / 60)}
          onSwap={() => swap(open, peekSpot.id)}
          onClose={() => setPeek(null)}
          onNotice={notice}
        />
      )}
      {open && !peekSpot && (
        <StopSheet
          data={data}
          stop={open}
          index={openIndex}
          plan={plan}
          input={input}
          onClose={closeStop}
          onPeek={(id) => setPeek({ from: open.spot.id, id })}
          onStay={changeStay}
          onAutoStay={autoStay}
          onRemove={removeStop}
          onFocus={toggleFocus}
          focused={focus.includes(open.spot.id)}
          auto={!must.includes(open.spot.id) && !pinned.some((p) => p.id === open.spot.id)}
          fixed={stayFix[open.spot.id] !== undefined}
          date={dateLabel(date)}
          planDate={date}
          onNotice={notice}
          onMove={moveStop}
          onReorder={() => {
            setOpenId(null)
            setCandId(null)
            setEditing(true)
            window.setTimeout(() => document.querySelector('.schedule')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 80)
          }}
          odaiCount={odaiCount}
          whySince={tripSince}
          askWhy={whyFor === open.spot.id}
          onAskWhy={() => setWhyFor(null)}
        />
      )}
      {showToast && toast && (
        <div className="toast-stack" ref={stackRef}>
          <div className="toast toast-set" role="status">
            <div className="toast-main">
              <p className="toast-text">
                <span className="toast-line">
                  {toast.parts.map((p, i) => (
                    <span key={i} className={p.nm ? 'ts nm' : p.w ? 'ts w' : 'ts'}>
                      {p.w && <GeminiMark />}
                      {p.t}
                    </span>
                  ))}
                </span>
              </p>
              {toast.undo && (
                <button
                  type="button"
                  className="toast-undo"
                  onClick={() => {
                    restore(toast.undo!)
                    setToast(null)
                  }}
                >
                  {T.undo}
                </button>
              )}
            </div>
            {toast.subs.length > 0 && (
              <>
                <button type="button" className="toast-more" aria-expanded={toastOpen} aria-controls="toast-detail" onClick={() => setToastOpen((v) => !v)}>
                  {toast.subs.every((l) => l.n) ? T.moreMoved(toast.subs.reduce((n, l) => n + (l.n ?? 0), 0)) : T.moreChanges(toast.subs.length)}
                  <Icon icon="chevronDown" size="sm" />
                </button>
                {toastOpen && (
                  <ul className="toast-detail" id="toast-detail">
                    {toast.subs.map((line, j) => (
                      <li key={j} className="toast-line">
                        {line.parts.map((p, i) => (
                          <span key={i} className={p.nm ? 'ts nm' : 'ts'}>
                            {p.t}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {adjust && (
        <Suspense fallback={null}><AdjustSheet
          data={data}
          conds={conds}
          date={date}
          start={start}
          end={end}
          onConds={fresh((c: Condition[]) => {
            condsTouched.current = true
            setConds(c)
          })}
          onDate={fresh(setDate)}
          onStart={fresh(setStart)}
          onEnd={fresh(setEnd)}
          leeway={leeway}
          onLeeway={fresh(setLeeway)}
          onNew={() => startNew()}
          dayNo={dayAt + 1}
          {...(!data.demo && {
            days: {
              made,
              planned,
              max: roomForDay ? DAYS_MAX : made,
              onPlanned: (n: number) => {
                setPlanDays(n)
                if (n > 1) return
                staySheets.forEach((f) => f.set('', null))
                setStays([])
                setTripEnd(undefined)
                setWants(undefined)
                setCarry([])
              },
              ...(canAdd && {
                onAdd: () => {
                  if (stayFar.some(Boolean)) {
                    showStayNote()
                    return
                  }
                  void commitStay().then((put) => {
                    if (!put) {
                      showStayNote()
                      return
                    }
                    closeAdjust()
                    startAddDay(put)
                  })
                },
              }),
              ...(made > 1 && { onDelete: deleteDay }),
            },
          })}
          {...(!data.demo && sheetNights.length > 0 && {
            stay: {
              fields: staySheets,
              nights: sheetNights,
              same: sheetSame,
              onSame: (v: boolean) => {
                setSheetSame(v)
                if (v) staySheets.slice(1).forEach((f) => f.set('', null))
              },
              far: stayFar,
              near: sheetNear(savedNow(data)),
            },
          })}
          stayEnds={ends}
          onClose={() => {
            void commitStay().then((put) => {
              if (put) closeAdjust()
              else showStayNote()
            })
          }}
          pace={pace}
          moveLess={moveLess}
          calm={calm}
          onMoveLess={changeMoveLess}
          onCalm={changeCalm}
          onQuick={(f) => changePace(pace === f ? 'normal' : f)}
          {...(!data.demo && { car: { on: carTrip, onChange: changeCar } })}
          skipDistricts={skipDistricts}
          onSkipDistricts={changeDistricts}
          onPick={() => {
            setAdjust(false)
            setPicker(true)
          }}
          onAsk={hasServer ? ask : null}
          odaiCount={odaiCount}
          onOdaiCount={(n) => {
            setOdaiCount(n)
            saveCount(n)
          }}
          odaiLevel={odaiLevel}
          onOdaiLevel={(v) => {
            setOdaiLevel(v)
            saveLevel(v)
          }}
        /></Suspense>
      )}
      {cand && (
        <CandidateSheet
          data={data}
          spot={cand}
          day={day}
          planDate={date}
          onAdd={(id) => {
            setCandId(null)
            togglePlace(id, false)
            setOpenId(id)
          }}
          onClose={() => setCandId(null)}
          onNotice={notice}
        />
      )}
      {planImage && plan && <Suspense fallback={null}><PlanImage data={data} name={shownName} date={dateLabel(date)} plan={plan} buses={buses} onClose={() => setPlanImage(false)} onNotice={notice} /></Suspense>}
      {recap && plan && <Suspense fallback={null}><Recap area={data.area.name} name={shownName} date={dateLabel(date)} planDate={date} data={data} input={input} plan={plan} usual={usual} buses={buses} since={tripSince} onClose={() => {
            clearRecapOnOpen()
            setRecap(false)
          }} onNotice={notice} onWhy={(id) => {
            clearRecapOnOpen()
            setRecap(false)
            setOpenId(id)
            setWhyFor(id)
          }} /></Suspense>}
      {picker && (
        <Suspense fallback={null}><PlacePicker
          data={data}
          plan={plan}
          skipDistricts={skipDistricts}
          day={day}
          planDate={date}
          whySince={tripSince}
          onToggle={togglePlace}
          onNotice={notice}
          onClose={() => setPicker(false)}
          onShow={setPickerShow}
        /></Suspense>
      )}
    </div>
  )
}

// 前の並びから見て、新しく入った場所と、順番が入れ替わった場所。
// 前の順のまま残った一番長い並び（最長増加部分列）は動いていないとみなす。touched（手で動かした場所）は必ず動いた側に入れる
function movedOrNew(prev: string[], next: string[], touched: string | null = null): Set<string> {
  const kept = next.filter((id) => prev.includes(id) && id !== touched)
  const pos = kept.map((id) => prev.indexOf(id))
  const len = pos.map(() => 1)
  const from = pos.map(() => -1)
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < i; j++)
      if (pos[j] < pos[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1
        from[i] = j
      }
  const still = new Set<string>()
  for (let k = len.indexOf(Math.max(0, ...len)); k >= 0; k = from[k]) still.add(kept[k])
  return new Set(next.filter((id) => !prev.includes(id) || !still.has(id)))
}

// 候補がそろったあとの、より良い案の札（違いは 5 分以上のものだけ書く）
function PlanOffer({ offer, onTake, onKeep }: { offer: { crowd: number; move: number; stops: number; swap: number }; onTake: () => void; onKeep: () => void }) {
  const parts: string[] = []
  if (Math.abs(offer.crowd) >= 5) parts.push(T.offerCrowd(fmtDur(Math.abs(offer.crowd)), offer.crowd < 0))
  if (Math.abs(offer.move) >= 5) parts.push(T.offerMove(fmtDur(Math.abs(offer.move)), offer.move < 0))
  if (offer.stops) parts.push(T.offerStops(offer.stops))
  else if (!parts.length && offer.swap) parts.push(T.offerSwap(offer.swap))
  return (
    <section className="save-nudge plan-offer" aria-label={T.offer} role="status">
      <p>{T.offer}</p>
      {parts.length > 0 && (
        <Text as="p" display="block" type="supporting" className="note num">
          {T.offerJoin(parts)}
        </Text>
      )}
      <div className="save-nudge-actions">
        <Button variant="secondary" label={T.offerTake} onClick={onTake} />
        <Button variant="ghost" label={T.offerKeep} onClick={onKeep} />
      </div>
    </section>
  )
}
