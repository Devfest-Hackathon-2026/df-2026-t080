import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AREA_NAMES } from '../lib/areaNames'
import { loadAreaStarts, type GeoHit, type JobState, type StepKey } from '../lib/api'
import { distM } from '../lib/geo'
import { placeLabel, type PlaceField } from '../lib/placeField'
import { LeewayField, TimeRows } from './TimeRows'
import { tr } from '../lib/i18n'
import { OsmCredit } from './OsmCredit'

// 片道の出発地と到着地は、これより離れていたら作らない（サーバーの places.MAX_TRIP_KM と同じ）
export const MAX_TRIP_KM = 30

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
    looking: '場所を探しています……',
    miss: '場所が見つかりませんでした。日本の駅名か地名を入れてください。',
    fix: '違うときは、都道府県名も書いてください。',
    lookFailed: '場所を確かめられませんでした。',
    far: (km: number) => `最初の場所から${km} km あります。${MAX_TRIP_KM} km までにしてください。`,
    search: '場所の検索:',
    wish: '希望',
    wishHint: '例: 静かな場所を回りたい。昼はおいしいそばを食べたい……',
    creating: '探しています……',
    finding: 'Gemini が候補を探しています',
    status: (done: number, all: number, sec: number) => `${done}/${all} 完了・経過時間 ${sec}秒。初めてのエリアは 30〜40 秒かかります。`,
    cancel: 'キャンセル',
    create: '候補を探す',
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
    far: (km: number) => `${km} km from the start. Choose a place within ${MAX_TRIP_KM} km.`,
    search: 'Place search:',
    wish: 'Wishes',
    wishHint: 'e.g. Quiet places. Good soba for lunch…',
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
  back: boolean
  wish: string
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
  leeway: number
  onLeeway: (v: number) => void
  onSubmit: () => void
  onCancel: () => void
}

export function PlanForm(p: Props) {
  const elapsedMs = p.busy ? Date.now() - p.busy.since : 0
  const elapsed = Math.round(elapsedMs / 1000)
  // 取ってあるエリアはすぐできるので、1 秒たつまでは進み具合を出さない（一瞬だけ出て消えるのを防ぐ）
  const showSteps = !!p.busy && elapsedMs >= 1000
  const steps = ORDER.map((k) => p.busy?.job.steps?.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s)
  const doneCount = steps.filter((s) => s.state === 'done').length
  // 片道で、出発地と到着地が離れすぎているとき（km）
  const km = !p.back && p.from.hit && p.to.hit ? Math.round(distM(p.from.hit, p.to.hit) / 1000) : 0
  const far = km > MAX_TRIP_KM
  const toInput = useRef<HTMLInputElement>(null)
  const wasBack = useRef(p.back)
  useEffect(() => {
    if (wasBack.current && !p.back) toInput.current?.focus()
    wasBack.current = p.back
  }, [p.back])
  // 反映できない日付・時刻が入っている欄（id）
  const [badTimes, setBadTimes] = useState<string[]>([])
  const onInvalid = useCallback((id: string, bad: boolean) => setBadTimes((x) => (bad === x.includes(id) ? x : bad ? [...x, id] : x.filter((y) => y !== id))), [])
  const miss = p.from.state === 'miss' || (!p.back && p.to.state === 'miss')
  const ready = !!p.from.text.trim() && (p.back || !!p.to.text.trim()) && !far && !miss && badTimes.length === 0
  // 進み具合が出たら、その見出しまで送る
  const progressRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!showSteps) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    progressRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [showSteps])
  const [starts, setStarts] = useState<Record<string, GeoHit>>({})
  useEffect(() => {
    loadAreaStarts().then(setStarts)
  }, [])
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

      <form
        className="form-body"
        onSubmit={(e) => {
          e.preventDefault()
          p.onSubmit()
        }}
      >
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
                onBlur={() => void p.to.lookup()}
              />
              {far ? (
                <div className="place-note-box">
                  <p id="to-note" className="note warn place-note" role="alert">
                    {T.far(km)}
                  </p>
                </div>
              ) : (
                <PlaceNote id="to-note" f={p.to} />
              )}
            </>
          )}
        </div>

        <div className="field">
          <TextArea label={T.wish} htmlName="wish" id="wish" rows={3} value={p.wish} placeholder={T.wishHint} onChange={(v) => p.onWish(v)} />
        </div>

        <TimeRows idPrefix="form" date={p.date} start={p.start} end={p.end} onDate={p.onDate} onStart={p.onStart} onEnd={p.onEnd} oneWay={!p.back} onInvalid={onInvalid} />
        <LeewayField start={p.start} end={p.end} value={p.leeway} onChange={p.onLeeway} oneWay={!p.back} onInvalid={onInvalid} />

        {p.busy && !showSteps ? (
          <div className="submit">
            <Button variant="primary" size="lg" width="100%" label={T.creating} isDisabled />
          </div>
        ) : p.busy ? (
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
            <Button variant="secondary" size="lg" width="100%" label={T.cancel} onClick={p.onCancel} />
          </section>
        ) : (
          <div className="submit">
            <Button type="submit" variant="primary" size="lg" width="100%" label={T.create} isDisabled={!ready} />
            {p.error && (
              <p className="error" role="alert">
                {p.error}
              </p>
            )}
          </div>
        )}
        <OsmCredit className="note foot" label={T.search} />
      </form>
    </main>
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
