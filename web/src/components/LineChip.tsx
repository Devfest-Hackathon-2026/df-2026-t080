import { inkOn } from '../lib/lineColor'
import { ModeIcon } from './ModeIcon'

// 路線名を路線の色で塗った札（色が分からない路線は線の枠だけ）。乗り物のアイコンは札の字の色で頭に付ける
export function LineChip({ name, color, text, mode }: { name: string; color: string | null; text?: string | null; mode?: 'bus' | 'train' }) {
  const style = color ? { background: color, color: inkOn(color, text) } : undefined
  return (
    <span className="line-chip" data-plain={color ? undefined : ''} style={style}>
      {mode && <ModeIcon mode={mode} />}
      {name}
    </span>
  )
}
