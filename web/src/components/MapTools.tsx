import { tr } from '../lib/i18n'

const LOCATE = tr({ ja: '現在地を表示', en: 'Show My Location' })
const BIG = tr({ ja: { on: '地図を全画面で表示', off: '全画面表示を終了' }, en: { on: 'Show Map Full Screen', off: 'Exit Full Screen' } })
const ZOOM = tr({ ja: { in: '拡大', out: '縮小' }, en: { in: 'Zoom In', out: 'Zoom Out' } })

// 右下のボタン（全画面・全体・現在地）。1 本の縦長の板にまとめる。fitLabel: 全体のボタンの読み上げ（プラン全体か候補全体か）。
// 全画面のボタンは狭い画面だけに出す（広い画面では地図がもう画面の高さいっぱい）。
// その上に、拡大と縮小の板（広い画面・マウスのある画面・全画面の地図だけ。指で広げられるスマホのふだんの地図では出さない）と、
// 現在地を取れなかったときの知らせ（note。ボタンのすぐ上に出す）を置く
export function MapTools({
  locating,
  fitLabel,
  onFit,
  onLocate,
  big,
  onBig,
  onZoom,
  note,
}: {
  locating: 'off' | 'wait' | 'on'
  fitLabel: string
  onFit: (() => void) | null
  onLocate: () => void
  big: boolean
  onBig: (v: boolean) => void
  onZoom: (d: 1 | -1) => void
  note: string | null
}) {
  const bigLabel = big ? BIG.off : BIG.on
  return (
    <div className="map-tools-col">
      <p className="map-note" role="status">
        {note}
      </p>
      <div className="map-tools map-zoom">
        <button type="button" className="map-tool" onClick={() => onZoom(1)} aria-label={ZOOM.in} title={ZOOM.in}>
          {/* 形の出典: Lucide（https://lucide.dev）の plus・minus。ISC ライセンス */}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
        <button type="button" className="map-tool" onClick={() => onZoom(-1)} aria-label={ZOOM.out} title={ZOOM.out}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="map-tools">
        <button type="button" className="map-tool expand" onClick={() => onBig(!big)} aria-label={bigLabel} title={bigLabel}>
          {/* 形の出典: Lucide（https://lucide.dev）の maximize-2・minimize-2。ISC ライセンス */}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d={big ? 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' : 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'} />
          </svg>
        </button>
        {onFit && (
          <button type="button" className="map-tool" onClick={onFit} aria-label={fitLabel} title={fitLabel}>
            {/* 形の出所: AI が生成（Claude）。四隅のかぎ（Tabler の maximize・border-corners に似るが、角が丸くなく、一致しない） */}
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
            </svg>
          </button>
        )}
        <button type="button" className="map-tool locate" data-state={locating} onClick={onLocate} aria-label={LOCATE} title={LOCATE}>
          {/* 形の出所: AI が生成（Claude）。矢印（Material Icons の near_me・Lucide の navigation に似るが、一致しない） */}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M20.5 3.5 3.8 10.4c-.8.3-.7 1.4.1 1.6l6.6 1.5 1.5 6.6c.2.8 1.3.9 1.6.1z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
