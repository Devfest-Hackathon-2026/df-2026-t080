import { tr } from '../lib/i18n'

// 区間の線が道に沿った線に置き換わるまでの間、地図の左上に出す小さな表示。
// 押せず、地図をなぞる・拡大する操作はそのまま下の地図に届く
export function RouteWait({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <div className="route-wait" role="status">
      <span className="route-wait-ring" aria-hidden="true" />
      {tr({ ja: '道を調べています……', en: 'Finding routes…' })}
    </div>
  )
}

// 道の線が届かないまま長く待つときも、この時間で表示を消す（ミリ秒）
export const ROUTE_WAIT_MAX = 20000
