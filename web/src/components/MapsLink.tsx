import type { ReactNode } from 'react'
import { Icon } from '@astryxdesign/core/Icon'
import { Link } from '@astryxdesign/core/Link'
import { isIosOtherBrowser } from '../lib/geo'
import { tr } from '../lib/i18n'

const T = tr({ ja: { open: 'ブラウザで開く', short: 'ブラウザ' }, en: { open: 'Open in Browser', short: 'Browser' } })

// 外のサイトやアプリへ開くことを示す矢印（Astryx のテーマの externalLink。Lucide の external-link）
function OpenMark() {
  return <Icon icon="externalLink" size="xsm" className="open-mark" />
}

// Google マップを開くボタン。押すと外へ出るので、矢印を添える。
// iPhone の Safari 以外のブラウザでは、アプリを直接開き、ブラウザで開く道も添える（compact は狭い行向けの短い言い方）
export function MapsLink({ web, app, className, label, compact = false, children }: { web: string; app: string; className: string; label?: string; compact?: boolean; children: ReactNode }) {
  if (!isIosOtherBrowser()) {
    return (
      <Link className={className} href={web} target="_blank" rel="noreferrer" label={label} weight="bold">
        {children}
        <OpenMark />
      </Link>
    )
  }
  return (
    <span className="maps-pair">
      <Link className={className} href={app} label={label} weight="bold">
        {children}
        <OpenMark />
      </Link>
      <Link className="maps-web" href={web} target="_blank" rel="noreferrer" label={T.open}>
        {compact ? T.short : T.open}
      </Link>
    </span>
  )
}
