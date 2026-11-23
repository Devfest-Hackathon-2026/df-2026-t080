import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Switch } from '@astryxdesign/core/Switch'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AREA_NAMES } from '../lib/areaNames'
import { loadAreaStarts, type GeoHit, type JobPreview, type JobState, type StepKey } from '../lib/api'
import { distM } from '../lib/geo'
import { FAR_TEXT, MAX_TRIP_KM, shownNights, stayFarTexts } from '../lib/stayFar'
import { nearOf, placeLabel, type PlaceField } from '../lib/placeField'
import { LeewayField, TimeRows } from './TimeRows'
import { tr } from '../lib/i18n'
import { OsmCredit } from './OsmCredit'
import { WaitSpots } from './WaitSpots'
import { DAY_TEXT, NightCount, TripKind } from './DayTabs'
import { StayTalk } from './StayTalk'
import type { Question, Talk } from '../lib/stayTalk'
import { keepPreview, stepLine } from '../lib/waitSpots'


const T = tr({
  ja: {
    steps: {
      famous: '人気|スポット',
      food: '飲食店',
      hidden: '隠れた|名所',
      cafe: 'カフェ',
      wish: '希望',
      verify: '位置の|確認',
    } as Record<StepKey, string>,
    tagline: '行く時間をずらして、混雑を避ける1日のプランを組みます。',
    from: '行き先の駅か地名',
    fromHint: '例: 京都駅、鎌倉駅',
    noDest: '行き先が決まっていなければ、ここから選べます。',
    dests: AREA_NAMES.map((a) => a.ja),
    to: '観光を終える場所',
    toHint: '例: 嵐山駅、金閣寺',
    back: '同じ場所に戻る',
    looking: '場所を検索しています……',
    miss: '場所が見つかりませんでした。日本の駅名か地名を入力してください。',
    fix: '違う場合は、都道府県名も入力してください。',
    lookFailed: '場所を確認できませんでした。',
    stay: '泊まる宿',
    stayHint: '宿の名前か最寄りの駅',
    stayNth: (n: number) => `${n}泊目の宿`,
    stayAsBefore: (n: number) => `${n}泊目と同じ`,
    sameStay: '毎晩同じ宿に泊まる',
    search: '場所の検索:',
    wish: '希望',
    wishHint: '例: 静かな場所を回りたい。昼はおいしいそばを食べたい……',
    car: '車で回る',
    creating: '検索しています……',
    finding: 'Gemini が候補を検索しています',
    status: (done: number, all: number, sec: number) => `${done}/${all} 完了・経過時間 ${sec}秒。初めてのエリアは30〜40秒かかります。`,
    cancel: 'キャンセル',
    create: '候補を検索',
  },
  en: {
    steps: {
      famous: 'Popular| Spots',
      food: 'Food',
      hidden: 'Hidden| Gems',
      cafe: 'Cafés',
      wish: 'Wishes',
      verify: 'Checking| Places',
    },
    tagline: 'Plan a day that avoids crowded times and places.',
    from: 'Destination Station or Area',
    fromHint: 'e.g. Kyoto Station, Kamakura Station',
    noDest: 'No destination yet? Pick one to start.',
    dests: AREA_NAMES.map((a) => a.en),
    to: 'End Sightseeing At',
    toHint: 'e.g. Arashiyama Station, Kinkaku-ji',
    back: 'Return to the same place',
    looking: 'Finding the place…',
    miss: 'Couldn’t find this place. Enter a station or place in Japan.',
    fix: 'Wrong place? Add the prefecture.',
    lookFailed: 'Couldn’t check this place.',
    stay: 'Where You’re Staying',
    stayHint: 'Hotel name or nearest station',
    stayNth: (n: number) => `Night ${n} Lodging`,
    stayAsBefore: (n: number) => `Same as Night ${n}`,
    sameStay: 'Same lodging every night',
    search: 'Place search:',
    wish: 'Wishes',
    wishHint: 'e.g. Quiet places. Good soba for lunch…',
    car: 'Get Around by Car',
    creating: 'Searching…',
    finding: 'Gemini is finding places',
    status: (done: number, all: number, sec: number) => `${done}/${all} done · ${sec} sec. A new area takes 30–40 seconds.`,
    cancel: 'Cancel',
    create: 'Find Places',
  },
})
const STEP_LABEL = T.steps
const ORDER: StepKey[] = ['famous', 'food', 'hidden', 'cafe', 'wish']

type Props = {
  // 出発地と到着地の欄。back: 出発地に戻る（このときは到着地の欄を出さない）
  from: PlaceField
  to: PlaceField
  // 泊ごとの宿の欄（泊まりのときだけ出す。k 番目が k+1 泊目）と、毎晩同じ宿に泊まるか
  stays: PlaceField[]
  sameStay: boolean
  onSameStay: (v: boolean) => void
  back: boolean
  wish: string
  // 車で回る旅か
  car: boolean
  onCar: (v: boolean) => void
  date: string
  start: number
  end: number
  busy: { job: JobState; since: number } | null
  error: string
  canCancel: boolean
  backLabel: string
  onFrom: (v: string) => void
  // 行き先の例を押した（start: そのエリアの候補を取ってあれば、そのときの出発地）
  onExample: (name: string, start: GeoHit | null) => void
  onTo: (v: string) => void
  onBack: (v: boolean) => void
  onWish: (v: string) => void
  onDate: (v: string) => void
  onStart: (v: number) => void
  onEnd: (v: number) => void
  // 旅の日数（1: 日帰り）
  days: number
  onDays: (n: number) => void
  leeway: number
  onLeeway: (v: number) => void
  onSubmit: () => void
  onCancel: () => void
  // 日帰りか、泊まりを 1 行の文で作るか、泊まりを欄で作るか
  kind: 'day' | 'talk' | 'form'
  onKind: (stay: boolean) => void
  // 泊まりの旅を欄で作るときの、上に出す一言（Gemini を使えなかったとき）
  formNote: string
  talk: {
    talk: Talk
    question: Question
    last: string
    busy: boolean
    error: string
    ready: boolean
    showDate: boolean
    onSend: (text: string) => Promise<boolean>
    onSkip: () => void
    onManual: () => void
  }
}

// 候補を検索している間の進み具合（Gemini が候補を検索しています・段の丸・経過時間・キャンセル）と、届いた見どころとお店。
// 取ってあるエリアはすぐできるので、1 秒たつまでは出さない（一瞬だけ出て消えるのを防ぐ）
export const showSearchWait = (busy: { since: number } | null) => !!busy && Date.now() - busy.since >= 1000

export function SearchWait({ busy, onCancel }: { busy: { job: JobState; since: number }; onCancel: () => void }) {
  const elapsed = Math.round((Date.now() - busy.since) / 1000)
  const seen = useRef<{ since: number; keys: string[] }>({ since: busy.since, keys: [] })
  if (seen.current.since !== busy.since) seen.current = { since: busy.since, keys: [] }
  const steps = stepLine(ORDER.map((k) => busy.job.steps?.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s), seen.current.keys)
  const doneCount = steps.filter((s) => s.state === 'done').length
  // 探している間に見せる見どころとお店（出した場所は探し終わるまで入れ替えず、まだ無い種類だけを足す）
  const [spots, setSpots] = useState<JobPreview | null>(null)
  const incoming = busy.job.preview
  useEffect(() => {
    setSpots((cur) => keepPreview(cur, incoming))
  }, [incoming])
  // 進み具合が出たとき・見どころとお店が最初に届いたときは、進み具合の見出しまで送る（下に一覧が続く）
  const progressRef = useRef<HTMLElement>(null)
  const hasSpots = !!spots
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    progressRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [hasSpots])
  return (
    <>
      <section className="progress" ref={progressRef} aria-live="polite" aria-busy="true">
        <Heading level={2} className="sec-title">
          {T.finding}
        </Heading>
        <ol className="progress-line">
          {(steps.length ? steps : ORDER.slice(0, 4).map((key) => ({ key, state: 'wait' as const }))).map((s) => (
            <li key={s.key} data-state={s.state}>
              <span className="progress-dot" aria-hidden="true" />
              <span className="progress-label">
                {(STEP_LABEL[s.key] ?? '').split('|').map((t, i) => (
                  <span key={i}>
                    {i > 0 && <wbr />}
                    {t}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <p className="note num">
          {T.status(doneCount, steps.length || 4, elapsed)}
        </p>
        <Button variant="secondary" size="lg" width="100%" label={T.cancel} onClick={onCancel} />
      </section>
      {spots && <WaitSpots preview={spots} />}
    </>
  )
}

export function PlanForm(p: Props) {
  const showSteps = showSearchWait(p.busy)
  // 片道で、出発地と到着地が離れすぎているとき（km）
  const km = !p.back && p.from.hit && p.to.hit ? Math.round(distM(p.from.hit, p.to.hit) / 1000) : 0
  const far = km > MAX_TRIP_KM
  // 欄に出す泊（毎晩同じ宿なら 1泊目の欄だけ）。1泊目に宿が入っていれば、1日目は宿に着く
  const nights = Array.from({ length: Math.max(0, p.days - 1) }, (_, k) => k + 1)
  const stayShown = shownNights(nights, p.sameStay)
  const stayFields = stayShown.map((n) => p.stays[n - 1])
  const staying = p.days > 1 && !!p.stays[0].text.trim()
  const stayFar = p.days > 1 ? stayFarTexts(p.from.hit, stayFields.map((f) => (f.text.trim() ? f.hit : null)), p.back ? p.from.hit : p.to.hit, false) : []
  // 泊まりの旅の宿と観光を終える場所を引くときに前に付ける、行き先のエリアの名前
  const near = p.days > 1 ? nearOf(p.from.hit, p.from.text) : undefined
  const toInput = useRef<HTMLInputElement>(null)
  const wasBack = useRef(p.back)
  useEffect(() => {
    if (wasBack.current && !p.back) toInput.current?.focus()
    wasBack.current = p.back
  }, [p.back])
  // 反映できない日付・時刻が入っている欄（id）
  const [badTimes, setBadTimes] = useState<string[]>([])
  const onInvalid = useCallback((id: string, bad: boolean) => setBadTimes((x) => (bad === x.includes(id) ? x : bad ? [...x, id] : x.filter((y) => y !== id))), [])
  const miss = p.from.state === 'miss' || (!p.back && p.to.state === 'miss') || stayFields.some((f) => !!f.text.trim() && f.state === 'miss')
  const talking = p.kind === 'talk'
  const placesOk = !!p.from.text.trim() && (p.back || !!p.to.text.trim()) && !far && !stayFar.some(Boolean) && !miss
  const ready = placesOk && (talking ? p.talk.ready && !p.talk.busy : badTimes.length === 0)
  const [starts, setStarts] = useState<Record<string, GeoHit>>({})
  useEffect(() => {
    loadAreaStarts().then(setStarts)
  }, [])
  const bottom =
    p.busy && !showSteps ? (
        <div className="submit">
          <Button variant="primary" size="lg" width="100%" label={T.creating} isDisabled />
        </div>
      ) : p.busy ? (
        <SearchWait busy={p.busy} onCancel={p.onCancel} />
      ) : (
        <div className="submit">
          <Button type={talking ? 'button' : 'submit'} variant="primary" size="lg" width="100%" label={T.create} isDisabled={!ready} {...(talking && { onClick: () => p.onSubmit() })} />
          {p.error && (
            <p className="error" role="alert">
              {p.error}
            </p>
          )}
        </div>
      )
  const carField = (
    <div className="field car-field">
      <Switch label={T.car} value={p.car} onChange={(v) => p.onCar(v)} isDisabled={!!p.busy} labelPosition="start" labelSpacing="spread" />
    </div>
  )
  const kindSwitch = (
    <div className="trip-kind">
      <TripKind stay={p.kind !== 'day'} onChange={p.onKind} off={talking && !!p.busy} />
    </div>
  )
  return (
    <main className="form-view">
      <header className="form-head">
        <Heading level={1} type="display-2" className="wordmark">
          IntenTrip
        </Heading>
        <Text as="p" display="block" type="supporting" className="tagline">
          {T.tagline}
        </Text>
        <div className="form-head-actions">
          {p.canCancel && !p.busy && <Button variant="ghost" className="back" label={p.backLabel} onClick={p.onCancel} />}
        </div>
      </header>

      {talking ? (
        <div className="form-body talk-body">
          {kindSwitch}
          <StayTalk {...p.talk} searching={!!p.busy} from={p.from} to={p.to} stays={p.stays} sameStay={p.sameStay} date={p.date} blocked={p.talk.ready && !placesOk} after={carField} />
          {bottom}
          <OsmCredit className="note foot" label={T.search} />
        </div>
      ) : (
        <form
          className="form-body"
          onSubmit={(e) => {
            e.preventDefault()
            p.onSubmit()
          }}
        >
          {kindSwitch}
          {p.kind === 'form' && p.formNote && (
            <p className="note trip-kind-note" role="status">
              {p.formNote}
            </p>
          )}
          <div className="form-group">
          <div className="field">
            <TextInput
              containerClassName="big-field"
              size="lg"
              label={T.from}
              htmlName="from"
              id="from"
              value={p.from.text}
              placeholder={T.fromHint}
              autoComplete="off"
              enterKeyHint="next"
              aria-describedby="from-note"
              onChange={(v) => p.onFrom(v)}
              onBlur={() => void p.from.lookup()}
            />
            <PlaceNote id="from-note" f={p.from} />
            {!p.from.text.trim() && !p.busy && (
              <div className="dests" role="group" aria-labelledby="dests-note">
                <Text as="p" display="block" type="supporting" id="dests-note" className="note">
                  {T.noDest}
                </Text>
                <div className="toggles">
                  {T.dests.map((d) => (
                    <Button key={d} variant="secondary" label={d} onClick={() => p.onExample(d, starts[d] ?? null)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="field" role="group" aria-labelledby="to-label">
            <span id="to-label" className="field-label">
              {T.to}
            </span>
            <div className="back-row">
              <CheckboxInput label={T.back} value={p.back} onChange={(on) => p.onBack(on)} />
            </div>
            {!p.back && (
              <>
                <TextInput
                  ref={toInput}
                  containerClassName="big-field"
                  size="lg"
                  label={T.to}
                  isLabelHidden
                  htmlName="to"
                  id="to"
                  value={p.to.text}
                  placeholder={T.toHint}
                  autoComplete="off"
                  enterKeyHint="next"
                  aria-describedby="to-note"
                  onChange={(v) => p.onTo(v)}
                  onBlur={() => void p.to.lookup(near)}
                />
                {far ? (
                  <div className="place-note-box">
                    <p id="to-note" className="note warn place-note" role="alert">
                      {FAR_TEXT.far(km)}
                    </p>
                  </div>
                ) : (
                  <PlaceNote id="to-note" f={p.to} />
                )}
              </>
            )}
          </div>
          </div>

          <div className="form-group">
          <div className="field">
            <TextArea label={T.wish} htmlName="wish" id="wish" rows={3} value={p.wish} placeholder={T.wishHint} onChange={(v) => p.onWish(v)} />
          </div>
          {carField}
          </div>

          <div className="form-group">
          {p.kind === 'form' && (
            <div className="field" role="group" aria-labelledby="days-label">
              <span id="days-label" className="field-label">
                {DAY_TEXT.nightsLabel}
              </span>
              <NightCount value={Math.max(2, p.days)} onChange={p.onDays} />
              <StayFields idPrefix="stay" fields={p.stays} nights={nights} same={p.sameStay} onSame={p.onSameStay} far={stayFar} near={near} />
            </div>
          )}

          <TimeRows idPrefix="form" date={p.date} start={p.start} end={p.end} onDate={p.onDate} onStart={p.onStart} onEnd={p.onEnd} oneWay={!p.back || staying} stayTo={staying} onInvalid={onInvalid} />
          <LeewayField start={p.start} end={p.end} value={p.leeway} onChange={p.onLeeway} oneWay={!p.back || staying} onInvalid={onInvalid} />
          </div>

          {bottom}
          <OsmCredit className="note foot" label={T.search} />
        </form>
      )}
    </main>
  )
}

// 泊まる宿の欄の組。nights: 選べる泊の番号（1 始まり。k 番目の欄 fields[k] が nights[k] 泊目）、same: 毎晩同じ宿に泊まる
// （泊が 2 つ以上のときだけチェックを出す）、far: 欄に出す泊ごとの離れすぎの一言、numbered: 欄が 1 つでも泊の番号を出す、
// near: 宿を引くときに前に付ける、行き先のエリアの名前
export function StayFields({ idPrefix, fields, nights, same, onSame, far, numbered = false, near }: { idPrefix: string; fields: PlaceField[]; nights: number[]; same: boolean; onSame: (v: boolean) => void; far: (string | null)[]; numbered?: boolean; near?: string }) {
  const shown = shownNights(nights, same)
  const many = nights.length >= 2
  return (
    <>
      {shown.map((n, j) => {
        const label = (many && same) || (!many && !numbered) ? T.stay : T.stayNth(n)
        return (
          <div key={n}>
            <StayField id={`${idPrefix}-${n}`} f={fields[j]} far={far[j] ?? null} label={label} placeholder={n === 1 ? T.stayHint : T.stayAsBefore(n - 1)} near={near} />
            {j === 0 && many && (
              <div className="back-row stay-same">
                <CheckboxInput label={T.sameStay} value={same} onChange={onSame} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// 泊まる宿の欄（観光を終える場所の欄と同じ形）。far: 離れすぎているときの一言
function StayField({ id, f, far, label, placeholder, near }: { id: string; f: PlaceField; far: string | null; label: string; placeholder: string; near?: string }) {
  return (
    <div className="stay-field">
      <TextInput
        containerClassName="big-field"
        size="lg"
        label={label}
        htmlName={id}
        id={id}
        value={f.text}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="next"
        aria-describedby={`${id}-note`}
        onChange={(v) => f.setText(v)}
        onBlur={() => void f.lookup(near)}
      />
      {far ? (
        <div className="place-note-box">
          <p id={`${id}-note`} className="note warn place-note" role="alert">
            {far}
          </p>
        </div>
      ) : (
        <PlaceNote id={`${id}-note`} f={f} />
      )}
    </div>
  )
}

// 欄の下の一言（引けた場所・探している・見つからない）。欄に文字があれば、一言の 2 行ぶんの高さを先に取る
function PlaceNote({ id, f }: { id: string; f: PlaceField }) {
  if (!f.text.trim()) return null
  return (
    <div className="place-note-box">
      <PlaceNoteText id={id} f={f} />
    </div>
  )
}

// 一言の中身。引けた場所が欄の文字と同じだけなら出さない
function PlaceNoteText({ id, f }: { id: string; f: PlaceField }) {
  if (f.state === 'finding')
    return (
      <p id={id} className="note place-note" aria-live="polite">
        {T.looking}
      </p>
    )
  if (f.state === 'miss' || f.state === 'error')
    return (
      <p id={id} className="note warn place-note" role="alert">
        {f.state === 'miss' ? T.miss : T.lookFailed}
      </p>
    )
  if (f.hit && placeLabel(f.hit) !== f.text.trim())
    return (
      <p id={id} className="note place-note">
        {placeLabel(f.hit)}
        <span className="place-fix">{T.fix}</span>
      </p>
    )
  return null
}
