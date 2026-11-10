import { creditItems, fetchedText, odptCredit, type BusSource } from '../lib/bus'
import { tr } from '../lib/i18n'

const T = tr({
  ja: { sep: '・', via: (v: string) => `（${v}）`, edited: '時刻表は便を探すために加工しています', at: (t: string) => `（${t}に取得）`, end: '。' },
  en: { sep: ' · ', via: (v: string) => ` (${v})`, edited: 'Timetables are processed to find departures', at: (t: string) => `\u00a0(retrieved ${t})`, end: '.' },
})

type Props = { sources: BusSource[]; contact: string | null; className?: string }

// 時刻表の出典。ODPT から取った物があればガイドライン 3.1 の文、続けて時刻表ごとの事業者・版・ライセンス
export function BusCredit({ sources, contact, className }: Props) {
  const items = creditItems(sources)
  const odpt = odptCredit(sources, contact)
  const at = fetchedText(sources)
  if (!items.length && !odpt) return null
  return (
    <div className={className ? `bus-credit ${className}` : 'bus-credit'}>
      {odpt && <p>{odpt}</p>}
      {items.length > 0 && (
        <ul className="bus-sources">
          {items.map((c) => (
            <li key={c.text}>
              {c.text}
              {c.license &&
                (c.url ? (
                  <>
                    {T.sep}
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.license}
                    </a>
                  </>
                ) : (
                  `${T.sep}${c.license}`
                ))}
              {c.via && T.via(c.via)}
            </li>
          ))}
        </ul>
      )}
      <p>
        {T.edited}
        {at && <span className="num">{T.at(at)}</span>}
        {T.end}
      </p>
    </div>
  )
}
