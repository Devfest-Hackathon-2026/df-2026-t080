import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { useEffect, useState } from 'react'
import type { Spot } from '../types'
import { daysUntil } from '../lib/highlight'
import { tr, isEn, lang, setLang, type Lang } from '../lib/i18n'
import { dateLabel } from '../lib/time'
import { localTitle } from '../lib/areaNames'
import { askOpenAfterLang, askRecapOnOpen, openAfterLang } from '../lib/homeIntent'
import { currentTripId, deleteTrip, DEVICE_MAX, loadTrip, newTrip, openTrip, removeFromShelf, shelfTrip, useShelf, useTrips, type TripMeta } from '../lib/trips'
import { ACCOUNT_TEXT, useAccount } from './Account'
import { LangSwitch } from './LangSwitch'
import { Thumb } from './Thumb'
import { GoogleMark } from './GoogleMark'
import { PenguinMark } from './CrowdMark'
import { loadSample } from '../lib/api'

const T = tr({
  ja: {
    tagline: '行く時間をずらして、混雑を避ける1日のプランを組みます。',
    lead: 'Gemini が候補と注意点を出し、行く場所はあなたが理由を持って選びます。',
    demoLine: '清水寺に朝いちばんに着く、京都の1日',
    mine: '自分の旅',
    device: 'この端末の旅',
    now: '今開いている旅',
    sep: '・',
    stops: (n: number) => `${n}か所`,
    edited: (t: string) => `${t}に保存`,
    open: (title: string) => `${title}を開く`,
    remove: '削除',
    removeOf: (title: string) => `${title}を削除`,
    confirm: (title: string) => `「${title}」を削除しますか？この端末で開いているプランは残ります。`,
    confirmLocal: (title: string) => `「${title}」をこの端末から削除しますか？`,
    removeFailed: '削除できませんでした。もう一度お試しください。',
    openFailed: '旅を開けませんでした。もう一度お試しください。',
    opening: '開いています……',
    loading: '旅を読み込んでいます……',
    empty: 'まだ旅がありません。',
    create: '新しい旅を作る',
    hint: 'ログインすると、別の端末でも同じ旅が開けます。',
    keep: (n: number) => `この端末には旅を${n}件まで残せます。超えると古い旅から消えます。`,
    upcoming: 'これからの旅',
    past: '行った旅',
    today: '今日',
    tomorrow: '明日',
    left: (n: number): [string, string, string] => ['あと', `${n}`, '日'],
    leftLabel: (n: number) => `あと${n}日`,
    recap: '振り返る',
    recapOf: (title: string) => `${title}を振り返る`,
    places: (names: string[], more: number) => names.join('・') + (more > 0 ? ` ほか${more}か所` : ''),
    example: '京都のデモを試す',
    exampleNote: 'ログイン不要',
    madeIn: (l: Lang): string => (l === 'en' ? 'English' : '日本語'),
  },
  en: {
    tagline: 'Plan a day that avoids crowded times and places.',
    lead: 'Gemini suggests places and cautions. You choose where to go, and why.',
    demoLine: 'A Kyoto day that reaches Kiyomizu-dera before the crowds',
    mine: 'Your Trips',
    device: 'Trip on This Device',
    now: 'Open Now',
    sep: ' · ',
    stops: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
    edited: (t: string) => `Saved ${t}`,
    open: (title: string) => `Open ${title}`,
    remove: 'Delete',
    removeOf: (title: string) => `Delete ${title}`,
    confirm: (title: string) => `Delete “${title}”? The plan open on this device stays.`,
    confirmLocal: (title: string) => `Delete “${title}” from this device?`,
    removeFailed: 'Couldn’t delete the trip. Please try again.',
    openFailed: 'Couldn’t open the trip. Please try again.',
    opening: 'Opening…',
    loading: 'Loading your trips…',
    empty: 'No trips yet.',
    create: 'Plan a New Trip',
    hint: 'Sign in to open the same trips on your other devices.',
    keep: (n: number) => `This device keeps up to ${n} trips. Older trips are removed first.`,
    upcoming: 'Upcoming Trips',
    past: 'Past Trips',
    today: 'Today',
    tomorrow: 'Tomorrow',
    left: (n: number): [string, string, string] => ['in', `${n}`, n === 1 ? 'day' : 'days'],
    leftLabel: (n: number) => `in ${n} ${n === 1 ? 'day' : 'days'}`,
    recap: 'Look Back',
    recapOf: (title: string) => `Look back on ${title}`,
    places: (names: string[], more: number) => names.join(' · ') + (more > 0 ? ` + ${more} more` : ''),
    example: 'Try the Kyoto Demo',
    exampleNote: 'No sign-in needed',
    madeIn: (l: Lang): string => (l === 'en' ? 'English' : '日本語'),
  },
})

// 直した時刻（日本時間）。「11月7日 14:05」「Nov 7, 14:05」
const editedFmt = new Intl.DateTimeFormat(isEn ? 'en-US' : 'ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: isEn ? 'short' : 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// 端末にある今のプラン（ログインしていなくても開ける）。places・first はプランを組めていれば（回る場所の名前と、最初の場所）
export type DeviceTrip = { title: string; date: string; places?: string[]; first?: Spot | null }

// もう片方の言語で作った、端末のプラン（押すと、その言語に切り替えて開く）
export type OtherTrip = { title: string; date: string }

type Props = {
  device: DeviceTrip | null
  onOpenDevice: () => void
  onRecapDevice: () => void
  onRemoveDevice: () => void
  onExample: () => void
  other: OtherTrip | null
}

// 一覧の 1 件（端末の今の旅か、クラウドの旅）
// foreign: もう片方の言語で作った旅（その言語に切り替えて開く）
// local: この端末の棚にだけある旅
type Entry = { key: string; title: string; date: string; now: boolean; trip: TripMeta | null; local?: boolean; places?: string[]; first?: Spot | null; foreign?: Lang }

const otherLang: Lang = isEn ? 'ja' : 'en'

const PLACES_MAX = isEn ? 2 : 3

// 旅の日までの残り（これからの旅の札の右）。「あと 7 日」の数を大きく
function Countdown({ date }: { date: string }) {
  const d = daysUntil(date)
  if (d === 0) return <span className="home-left home-left-word">{T.today}</span>
  if (d === 1) return <span className="home-left home-left-word">{T.tomorrow}</span>
  const [a, n, b] = T.left(d)
  return (
    <span className="home-left" aria-label={T.leftLabel(d)}>
      <span aria-hidden="true">{a}</span>
      <span className="home-left-n num" aria-hidden="true">
        {n}
      </span>
      <span aria-hidden="true">{b}</span>
    </span>
  )
}

// 京都のデモ（例のプラン）の札。旅の札と同じ形で、例の最初の場所の写真を上に出す。押すと例のプランを開く。
// 端末の旅の札が同じ写真のとき（デモを開いたあと）は、写真を出さない小さな札にする
function DemoCard({ onExample, disabled, shownId }: { onExample: () => void; disabled: boolean; shownId?: string }) {
  const [first, setFirst] = useState<Spot | null>(null)
  useEffect(() => {
    let alive = true
    void loadSample().then((d) => {
      if (!alive || !d) return
      const id = d.example?.must[0]
      setFirst(d.places.find((p) => p.id === id) ?? null)
    })
    return () => {
      alive = false
    }
  }, [])
  const small = !!first && first.id === shownId
  return (
    <div className="home-item home-demo" data-small={small || undefined}>
      <button type="button" className="home-open" disabled={disabled} onClick={onExample}>
        {!small && <span className="home-thumb">{first && <Thumb spot={first} wide photoOnly />}</span>}
        <span className="home-text">
          <span className="home-title">{T.example}</span>
          <span className="home-places">{T.demoLine}</span>
          <span className="home-meta">{T.exampleNote}</span>
        </span>
      </button>
    </div>
  )
}

// ホーム画面：自分の旅を選んで開く・新しく作る・消す（data/auth-and-trips.md の 1 章の部品を使う）
export function Home({ device, onOpenDevice, onRecapDevice, onRemoveDevice, onExample, other }: Props) {
  const account = useAccount()
  const { available, ready, user } = account
  const trips = useTrips()
  const shelf = useShelf()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const now = currentTripId()
  const signedIn = available && ready && !!user
  const list = signedIn ? trips : null
  // 旅が無いと分かった（ログインしているかを確かめ終え、ログインしていれば一覧も届いた）
  const none = ready && !(signedIn && !trips)
  // 端末の今の旅が、まだクラウドの一覧に無いとき（ログインしていない・保存の途中・消したあと）は、別に出す
  const showDevice = !!device && !(list && now && list.some((t) => t.id === now))
  // これからの旅（近い順）と、行った旅（新しい順）に分ける。今の旅には、端末のプランの場所の名前と写真を添える
  const entries: Entry[] = [
    ...(showDevice && device ? [{ key: 'device', title: localTitle(device.title), date: device.date, now: true, trip: null, places: device.places, first: device.first }] : []),
    ...(list ?? []).map((t) => {
      const isNow = t.id === now && !!device
      return {
        key: t.id,
        title: localTitle(t.title),
        date: t.date,
        now: isNow,
        trip: t,
        ...(isNow && device ? { places: device.places, first: device.first } : {}),
        ...(t.lang !== lang ? { foreign: t.lang } : {}),
      }
    }),
    ...shelf
      .filter((t) => t.id !== now && !(list ?? []).some((c) => c.id === t.id))
      .map((t) => ({ key: t.id, title: t.title, date: t.date, now: false, trip: t, local: true })),
    // もう片方の言語の端末のプラン（同じ旅がクラウドの一覧にあれば、そちらに任せる）
    ...(other && !(list ?? []).some((t) => t.lang === otherLang && t.date === other.date && t.title === other.title)
      ? [{ key: 'other', title: localTitle(other.title), date: other.date, now: false, trip: null, foreign: otherLang }]
      : []),
  ]
  const upcoming = entries.filter((e) => daysUntil(e.date) >= 0).sort((x, y) => x.date.localeCompare(y.date))
  const past = entries.filter((e) => daysUntil(e.date) < 0).sort((x, y) => y.date.localeCompare(x.date))
  const groups = [
    { key: 'upcoming', title: T.upcoming, items: upcoming },
    { key: 'past', title: T.past, items: past },
  ].filter((g) => g.items.length)

  // もう片方の言語の旅は、その言語に切り替えて読み直してから開く（地名などが、作ったときの言語で取ってあるため）
  const openForeign = (e: Entry) => {
    if (!e.foreign) return
    askOpenAfterLang(e.trip ? e.trip.id : 'plan')
    setLang(e.foreign)
  }
  // 棚の写しがクラウドの旅より新しければ（クラウドへ書く前に別の旅に移ったとき）、棚の写しを開く
  const fetchTrip = async (t: TripMeta) => {
    const kept = shelfTrip(t.id)
    return kept && kept.updatedAt >= t.updatedAt ? kept : ((await loadTrip(t.id)) ?? kept)
  }
  const open = async (t: TripMeta) => {
    if (busyId) return
    if (t.lang !== lang) return openForeign({ key: t.id, title: t.title, date: t.date, now: false, trip: t, foreign: t.lang })
    if (t.id === now && device) return onOpenDevice()
    setMsg('')
    setBusyId(t.id)
    const trip = await fetchTrip(t)
    if (!trip || !openTrip(trip)) {
      setBusyId(null)
      setMsg(T.openFailed)
    }
  }
  // 言語を変えて読み直したあとに、頼まれていたクラウドの旅を開く（一覧が届いてから 1 回だけ）
  const [wanted, setWanted] = useState(() => {
    const id = openAfterLang()
    return id && id !== 'plan' && id !== 'form' ? id : null
  })
  useEffect(() => {
    if (!wanted || !trips) return
    const t = trips.find((x) => x.id === wanted)
    setWanted(null)
    if (t) void open(t)
    // 一覧が届いたときの 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, trips])
  // 行った旅を振り返る（振り返りカードを開く）。端末の今の旅はそのまま、ほかの旅は開いてから
  const recap = async (e: Entry) => {
    if (busyId) return
    if (e.now && device) return onRecapDevice()
    if (!e.trip) return
    setMsg('')
    setBusyId(e.trip.id)
    const trip = await fetchTrip(e.trip)
    askRecapOnOpen()
    if (!trip || !openTrip(trip)) {
      setBusyId(null)
      setMsg(T.openFailed)
    }
  }
  const remove = async (e: Entry) => {
    const t = e.trip
    if (busyId) return
    // 端末の今の旅（クラウドに無い旅）は、この端末から消す
    if (!t) {
      if (e.key === 'device' && window.confirm(T.confirmLocal(e.title))) onRemoveDevice()
      return
    }
    if (e.local) {
      if (window.confirm(T.confirmLocal(localTitle(t.title)))) removeFromShelf(t.id)
      return
    }
    if (!window.confirm(T.confirm(localTitle(t.title)))) return
    setMsg('')
    setBusyId(t.id)
    const ok = await deleteTrip(t.id)
    setBusyId(null)
    if (!ok) setMsg(T.removeFailed)
  }

  // 旅がまだ無い人（初めて開いた人）には、デモを上に出す。旅がある人には、新しい旅を作るボタンを一覧の上に出す（ボタンはいつも主の色）
  const first = entries.length === 0 && none
  const create = <Button variant="primary" size="lg" width="100%" className="home-new" label={T.create} isDisabled={!!busyId} onClick={newTrip} />

  return (
    <main className="form-view home">
      <header className="form-head">
        <Heading level={1} type="display-2" className="wordmark">
          <PenguinMark size={34} />
          IntenTrip
        </Heading>
        <Text as="p" display="block" type="supporting" className="tagline">
          {T.tagline}
        </Text>
        <Text as="p" display="block" type="supporting" className="tagline home-lead">
          {T.lead}
        </Text>
        <div className="form-head-actions">
          <LangSwitch />
        </div>
      </header>

      {first ? <DemoCard onExample={onExample} disabled={!!busyId} /> : <div className="home-create home-create-top">{create}</div>}

      <Heading level={2} className="sec-title home-mine">
        {T.mine}
      </Heading>
      {entries.length > 0 &&
        groups.map((g) => (
          <section key={g.key} className="home-trips" aria-labelledby={`home-${g.key}`}>
            <Heading level={5} accessibilityLevel={3} id={`home-${g.key}`} color="secondary" className="home-group">
              {g.title}
            </Heading>
            <ul className="home-list">
              {g.items.map((e) => {
                const busy = !!e.trip && busyId === e.trip.id
                const past = g.key === 'past'
                const names = e.places ?? []
                return (
                  <li key={e.key} className="home-item" data-now={e.now || undefined}>
                    <button
                      type="button"
                      className="home-open"
                      aria-label={T.open(e.title)}
                      aria-busy={busy || undefined}
                      disabled={!!busyId}
                      onClick={() => (e.foreign ? openForeign(e) : e.trip ? void open(e.trip) : onOpenDevice())}
                    >
                      {e.first && (
                        <span className="home-thumb">
                          <Thumb spot={e.first} wide photoOnly />
                        </span>
                      )}
                      <span className="home-text">
                        <span className="home-title">{e.title}</span>
                        <span className="home-date num">{dateLabel(e.date)}</span>
                        {names.length > 0 && <span className="home-places">{T.places(names.slice(0, PLACES_MAX), 0)}</span>}
                        <span className="home-meta">
                          {busy ? (
                            T.opening
                          ) : (
                            <>
                              {e.foreign && <span className="home-foreign" lang={e.foreign}>{T.madeIn(e.foreign)}</span>}
                              {e.foreign && e.trip && T.sep}
                              {e.now && <span className="home-now">{T.now}</span>}
                              {e.now && !e.trip && names.length > 0 && (
                                <>
                                  {T.sep}
                                  <span className="num">{T.stops(names.length)}</span>
                                </>
                              )}
                              {e.now && e.trip && T.sep}
                              {e.trip && (
                                <>
                                  <span className="num">{T.stops(e.trip.stops)}</span>
                                  {T.sep}
                                  <span className="num">{T.edited(editedFmt.format(e.trip.updatedAt))}</span>
                                </>
                              )}
                            </>
                          )}
                        </span>
                      </span>
                      {!past && <Countdown date={e.date} />}
                    </button>
                    {(past || e.trip || e.key === 'device') && (
                      <span className="home-side">
                        {past && !e.foreign && (
                          <Button variant="ghost" className="home-recap" label={T.recapOf(e.title)} isDisabled={!!busyId} onClick={() => void recap(e)}>
                            {T.recap}
                          </Button>
                        )}
                        {(e.trip || e.key === 'device') && (
                          <Button variant="ghost" className="home-remove" label={T.removeOf(e.title)} isDisabled={!!busyId} onClick={() => void remove(e)}>
                            {T.remove}
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      <div aria-live="polite">
        {signedIn && !trips && (
          <Text as="p" display="block" type="supporting" className="note pulse">
            {T.loading}
          </Text>
        )}
        {entries.length === 0 && none && (
          <Text as="p" display="block" type="supporting" className="note">
            {T.empty}
          </Text>
        )}
        {msg && (
          <p className="note warn" role="status">
            {msg}
          </p>
        )}
      </div>
      {entries.length > 0 && !signedIn && (
        <Text as="p" display="block" type="supporting" className="note home-keep">
          {T.keep(DEVICE_MAX)}
        </Text>
      )}

      <div className="home-create">
        {first && create}
        {!first && <DemoCard onExample={onExample} disabled={!!busyId} shownId={entries.find((e) => e.first)?.first?.id} />}
      </div>

      {available && (
        <section className="home-account">
          {user ? (
            <div className="home-who">
              <Text as="p" display="block" type="supporting" className="note account-who">
                {ACCOUNT_TEXT.who(user.name)}
              </Text>
              <Button variant="ghost" label={ACCOUNT_TEXT.signOut} onClick={account.onOut} />
            </div>
          ) : (
            <>
              <Text as="p" display="block" type="supporting" className="note">
                {T.hint}
              </Text>
              <Button variant="secondary" size="lg" width="100%" className="home-signin" label={ACCOUNT_TEXT.signIn} icon={<GoogleMark />} isDisabled={!ready || account.busy} onClick={account.onIn} />
            </>
          )}
          {account.msg && (
            <p className="note warn" role="status">
              {account.msg}
            </p>
          )}
        </section>
      )}
    </main>
  )
}
