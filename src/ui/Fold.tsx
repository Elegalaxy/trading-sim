import { useState, type ReactNode } from 'react'

// A panel that can be folded to its title bar. The wrapped panel keeps its own heading, which CSS
// hides while the bar is showing, so the title is not drawn twice. The choice is remembered per
// title in localStorage; storage can be missing or blocked, so every access is guarded.

const KEY_PREFIX = 'trading-sim.fold.'

function readFolded(id: string, startFolded: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(KEY_PREFIX + id)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {
    // Storage is unavailable: use the default.
  }
  return startFolded
}

function writeFolded(id: string, folded: boolean): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + id, folded ? '1' : '0')
  } catch {
    // Not remembered, which only costs the convenience.
  }
}

export function Fold({
  id,
  title,
  startFolded = false,
  children,
}: {
  id: string
  title: string
  startFolded?: boolean
  children: ReactNode
}) {
  const [folded, setFolded] = useState(() => readFolded(id, startFolded))

  function toggle(): void {
    const next = !folded
    setFolded(next)
    writeFolded(id, next)
  }

  return (
    <div className={folded ? 'fold folded' : 'fold'}>
      <button type="button" className="fold-bar" aria-expanded={!folded} onClick={toggle}>
        <span className="fold-caret" aria-hidden="true">
          {folded ? '▸' : '▾'}
        </span>
        {title}
      </button>
      {folded ? null : <div className="fold-body">{children}</div>}
    </div>
  )
}
