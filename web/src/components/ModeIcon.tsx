// 乗り物の小さな線のアイコン（文字の頭に付ける）。形の出典: Lucide（https://lucide.dev）の bus・train-front・footprints。
// ISC ライセンス（https://lucide.dev/license）。著作権は Lucide Contributors にある
import { MODE_SHAPE, type Mode } from '../lib/modeShape'

export function ModeIcon({ mode }: { mode: Mode }) {
  const s = MODE_SHAPE[mode]
  return (
    <svg className="mode-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      {s.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {s.circles?.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />
      ))}
    </svg>
  )
}
