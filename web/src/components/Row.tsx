import type { ReactNode } from 'react'
import { Collapsible } from '@astryxdesign/core/Collapsible'

// 変えられる物の 1 行。名前の右に今の値を出し、押すとその場で開く（「プランを変更」と入力の画面で同じ形）
export function Row({ name, value, open = false, children }: { name: string; value: string; open?: boolean; children: ReactNode }) {
  return (
    <Collapsible
      className="more"
      defaultIsOpen={open}
      trigger={
        <span className="more-label">
          <span className="more-name">{name}</span>
          <span className="more-sum num">{value}</span>
        </span>
      }
    >
      <div className="more-body">{children}</div>
    </Collapsible>
  )
}
