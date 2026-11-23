import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Text } from '@astryxdesign/core/Text'
import { isEn, tr } from '../lib/i18n'
import { dateLabel } from '../lib/time'
import { DAYS_MAX } from '../lib/days'

const EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => new Date(`${iso}T00:00:00`)

const T = tr({
  ja: {
    label: '日',
    nth: (n: number) => `${n}日目`,
    short: (iso: string) => {
      const d = day(iso)
      return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`
    },
    mini: (iso: string) => `${day(iso).getMonth() + 1}/${day(iso).getDate()}`,
    tab: (n: string, d: string) => `${n}　${d}`,
    add: (n: number) => `${n}日目を追加`,
    count: '日数',
    dayTrip: '日帰り',
    stay: '泊まり',
    nightsLabel: '泊数',
    nights: (n: number) => `${n}泊${n + 1}日`,
    finding: '候補を検索しています……',
    remove: 'この日を削除',
    confirm: (n: number) => `${n}日目を削除しますか？`,
    days: (n: number) => `${n}日間`,
    carry: 'まだ入れていない場所',
    sep: '・',
  },
  en: {
    label: 'Day',
    nth: (n: number) => `Day ${n}`,
    short: (iso: string) => {
      const d = day(iso)
      return `${EN_DAY[d.getDay()]}, ${EN_MONTH[d.getMonth()]} ${d.getDate()}`
    },
    mini: (iso: string) => `${EN_MONTH[day(iso).getMonth()]} ${day(iso).getDate()}`,
    tab: (n: string, d: string) => `${n}  ${d}`,
    add: (n: number) => `Add Day ${n}`,
    count: 'Trip Length',
    dayTrip: 'Day Trip',
    stay: 'Overnight',
    nightsLabel: 'Days',
    nights: (n: number) => `${n + 1} Days`,
    finding: 'Finding places…',
    remove: 'Delete This Day',
    confirm: (n: number) => `Delete Day ${n}?`,
    days: (n: number) => `${n} days`,
    carry: 'Not in the plan yet',
    sep: ' · ',
  },
})

export const DAY_TEXT = { remove: T.remove, confirm: T.confirm, days: T.days, add: T.add, count: T.count, nightsLabel: T.nightsLabel, nights: T.nights }

// 旅の日付の幅。「11月21日（土）〜22日（日）」（月が替わるときは「11月30日（月）〜12月1日（火）」）
export function rangeLabel(dates: string[]): string {
  const a = dates[0]
  const b = dates[dates.length - 1]
  if (!a || dates.length < 2 || a === b) return dateLabel(a)
  if (isEn) return `${dateLabel(a)} – ${dateLabel(b)}`
  const tail = dateLabel(b)
  return `${dateLabel(a)}〜${a.slice(0, 7) === b.slice(0, 7) ? tail.replace(/^\d+月/, '') : tail}`
}

// 日の切り替えの札。3日なら曜日を省き、4日なら日目だけ（幅に収める）
const tabLabel = (i: number, d: string, n: number) => (n >= 4 ? T.nth(i + 1) : T.tab(T.nth(i + 1), n === 3 ? T.mini(d) : T.short(d)))

// 何日かある旅の、日の切り替え（地図の下）。made: 作った日数（その先の日は、次に作る日 next だけを押せる）
export function DayTabs({ dates, made, at, next, onPick }: { dates: string[]; made: number; at: number; next: boolean; onPick: (i: number) => void }) {
  return (
    <div className="day-tabs">
      <SegmentedControl value={String(at)} onChange={(v) => onPick(Number(v))} label={T.label} layout="fill" size="lg">
        {dates.map((d, i) => (
          <SegmentedControlItem key={i} value={String(i)} label={tabLabel(i, d, dates.length)} isDisabled={i !== at && (i > made || (i === made && !next))} />
        ))}
      </SegmentedControl>
    </div>
  )
}

// 次の日の候補を検索している間の一言と、検索できなかったときの知らせ（日の切り替えのすぐ下）
export function DayStatus({ busy, error }: { busy: boolean; error: string }) {
  return (
    <div className="day-status" aria-live="polite">
      {error ? (
        <p className="note warn" role="alert">
          {error}
        </p>
      ) : (
        busy && (
          <Text as="p" display="block" type="supporting" className="note pulse">
            {T.finding}
          </Text>
        )
      )}
    </div>
  )
}

// 泊まりの旅で、まだどの日にも入れていない場所の名前（日の切り替えの下に 1 行。長ければ切る）
export function CarryLine({ names }: { names: string[] }) {
  return (
    <p className="day-carry note">
      <span className="day-carry-label">{T.carry}</span>
      <span className="day-carry-names">{names.join(T.sep)}</span>
    </p>
  )
}

// 旅の日数を 1 本の切り替えで選ぶ（日帰り・1泊2日・2泊3日……）。value: 日数、made: 作った日数（これより少なくは選べない）、max: 選べる一番長い日数
export function DayCount({ value, onChange, made = 1, max = DAYS_MAX }: { value: number; onChange: (n: number) => void; made?: number; max?: number }) {
  return (
    <SegmentedControl value={String(value)} onChange={(v) => onChange(Number(v))} label={T.count} layout="fill">
      {Array.from({ length: DAYS_MAX }, (_, k) => k + 1).map((n) => (
        <SegmentedControlItem key={n} value={String(n)} label={n === 1 ? T.dayTrip : T.nights(n - 1)} isDisabled={n < made || (n > max && n !== value)} />
      ))}
    </SegmentedControl>
  )
}

// 日帰りか泊まりかの切り替え。dayOff・stayOff: 選べなくする、off: 両方とも選べなくする
export function TripKind({ stay, onChange, dayOff = false, stayOff = false, off = false }: { stay: boolean; onChange: (stay: boolean) => void; dayOff?: boolean; stayOff?: boolean; off?: boolean }) {
  return (
    <SegmentedControl value={stay ? 'stay' : 'day'} onChange={(v) => onChange(v === 'stay')} label={T.count} layout="fill" isDisabled={off}>
      <SegmentedControlItem value="day" label={T.dayTrip} isDisabled={dayOff} />
      <SegmentedControlItem value="stay" label={T.stay} isDisabled={stayOff} />
    </SegmentedControl>
  )
}

// 泊数の切り替え（value は日数）
export function NightCount({ value, onChange, made = 1, max = DAYS_MAX }: { value: number; onChange: (n: number) => void; made?: number; max?: number }) {
  return (
    <SegmentedControl value={String(value - 1)} onChange={(v) => onChange(Number(v) + 1)} label={T.nightsLabel} layout="fill">
      {Array.from({ length: DAYS_MAX - 1 }, (_, k) => k + 1).map((n) => (
        <SegmentedControlItem key={n} value={String(n)} label={T.nights(n)} isDisabled={n + 1 < made || (n + 1 > max && n + 1 !== value)} />
      ))}
    </SegmentedControl>
  )
}
