import { useId } from 'react'
import { LEVEL_LABEL } from '../lib/crowd'
import { tr } from '../lib/i18n'
import { BEAK, BELLY, BODY, EYE, FEET, FLIPPER, FLIPPER_W, GAP, H, LAYOUT, LEFT, RIGHT } from '../lib/penguinShape'

const TO = tr({ ja: '〜', en: '–' })

// 混雑の段階（0〜4）を、ペンギンの群れの数と色で表す。言葉は word で決め、決めなければ混む段階（2〜4）だけ、すぐ右に添える（読み上げと title にはどの段階も言葉を入れる）。
// 形と並べ方は lib/penguinShape.ts。体の色は段階ごと（0・1 は青、2 は黄、3 は橙、4 は赤）、くちばしと足は黄色（2 だけは濃い橙）
const PX = 19 / H

export function CrowdMark({ level, word: showWord }: { level: number; word?: boolean }) {
  const flock = LAYOUT[level] ?? LAYOUT[0]
  const id = `crowd${useId().replace(/[^\w-]/g, '')}`
  const word = LEVEL_LABEL[level] ?? LEVEL_LABEL[0]
  const x0 = Math.min(...flock.map(([x, , s]) => x + s * LEFT))
  const w = Math.max(...flock.map(([x, , s]) => x + s * RIGHT)) - x0
  return (
    <span className="crowd" data-level={level} role="img" aria-label={word} title={word}>
      <svg width={w * PX} height={H * PX} viewBox={`${x0} 0 ${w} ${H}`} aria-hidden="true">
        <defs>
          <mask id={`${id}h`} maskUnits="userSpaceOnUse" x="-9" y="-9" width="18" height="18">
            <rect x="-9" y="-9" width="18" height="18" fill="#fff" />
            <path d={BELLY} fill="#000" />
            <circle cx={EYE.x} cy={EYE.y} r={EYE.r} fill="#000" />
            <path d={FLIPPER} fill="none" stroke="#000" strokeWidth={FLIPPER_W} />
          </mask>
          {flock.map((_, i) =>
            i < flock.length - 1 ? (
              <mask key={i} id={`${id}c${i}`} maskUnits="userSpaceOnUse" x={x0 - 4} y="-4" width={w + 8} height={H + 8}>
                <rect x={x0 - 4} y="-4" width={w + 8} height={H + 8} fill="#fff" />
                {flock.slice(i + 1).map(([fx, fy, fs], j) => (
                  <path
                    key={j}
                    d={BODY}
                    transform={`translate(${fx} ${fy}) scale(${fs})`}
                    fill="#000"
                    stroke="#000"
                    strokeWidth={GAP / fs}
                    strokeLinejoin="round"
                  />
                ))}
              </mask>
            ) : null,
          )}
        </defs>
        {flock.map(([x, y, s], i) => (
          <g key={i} mask={i < flock.length - 1 ? `url(#${id}c${i})` : undefined}>
            <g transform={`translate(${x} ${y}) scale(${s})`}>
              <path className="crowd-body" d={BODY} mask={`url(#${id}h)`} />
              <path className="crowd-beak" d={BEAK} />
              <path className="crowd-feet" d={FEET} />
            </g>
          </g>
        ))}
      </svg>
      {(showWord ?? level >= 2) && <span className="crowd-word">{word}</span>}
    </span>
  )
}

// 混雑の印の凡例。いちばん空いている段階といちばん混む段階の印を、言葉と並べる。
// 一覧の印には読み上げの言葉があるので、凡例は読み上げない
export function CrowdLegend() {
  return (
    <p className="crowd-legend" aria-hidden="true">
      <span className="crowd-legend-end">
        <CrowdMark level={0} word={false} />
        {LEVEL_LABEL[0]}
      </span>
      <span>{TO}</span>
      <span className="crowd-legend-end">
        <CrowdMark level={4} word={false} />
        {LEVEL_LABEL[4]}
      </span>
    </p>
  )
}

// ペンギン 1 羽だけの絵（右を向く）。Gemini に頼む欄の横に置く。色は混雑の印の「空いている」と同じ
// 形の出所: lib/penguinShape.ts の BODY ほかと同じ（AI が生成（Claude））
export function PenguinMark({ size = 44 }: { size?: number }) {
  const id = `pg${useId().replace(/[^\w-]/g, '')}`
  const w = RIGHT - LEFT
  return (
    <svg className="penguin-mark" width={(size * w) / 14} height={size} viewBox={`${LEFT} -7.4 ${w} 14.8`} aria-hidden="true">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="-9" y="-9" width="18" height="18">
          <rect x="-9" y="-9" width="18" height="18" fill="#fff" />
          <path d={BELLY} fill="#000" />
          <circle cx={EYE.x} cy={EYE.y} r={EYE.r} fill="#000" />
          <path d={FLIPPER} fill="none" stroke="#000" strokeWidth={FLIPPER_W} />
        </mask>
      </defs>
      <path className="crowd-body" d={BODY} mask={`url(#${id})`} />
      <path className="crowd-beak" d={BEAK} />
      <path className="crowd-feet" d={FEET} />
    </svg>
  )
}
