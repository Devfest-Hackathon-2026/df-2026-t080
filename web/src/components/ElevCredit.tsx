import { tr } from '../lib/i18n'

const T = tr({
  ja: { label: '標高:', name: '国土地理院（地理院タイル）', edited: 'を加工して作成' },
  en: { label: 'Slopes:', name: 'GSI Japan (GSI Tiles)', edited: ', processed' },
})

// 坂の上り下りに使った国土地理院の標高タイルの出典（出典の明示と、地理院タイル一覧へのリンク。加工したことも書く）
export function ElevCredit({ className }: { className?: string }) {
  return (
    <p className={className ? `elev-credit ${className}` : 'elev-credit'}>
      {T.label}{' '}
      <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">
        {T.name}
      </a>
      {T.edited}
    </p>
  )
}
