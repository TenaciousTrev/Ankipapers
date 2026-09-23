import React, { useEffect, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// A strip of open papers above the editor. Tabs are nothing more than an
// ordered list of paper ids — only one paper is ever loaded in memory, and
// switching tabs goes through the same save-then-load path as the sidebar.
export default function TabBar({
  tabs, papers, activePaperId, activeTitle, activeDirty,
  canBack, canForward, onBack, onForward, onSelect, onClose,
}) {
  const titles = new Map(papers.map((p) => [p.id, p.title]))

  // Tabs have a fixed width and the strip scrolls (the arrows stay put), so
  // keep the active tab in view when it changes.
  const stripRef = useRef(null)
  useEffect(() => {
    const el = stripRef.current?.querySelector('.tab.active')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activePaperId])

  const labelFor = (id) => {
    const title = id === activePaperId ? activeTitle : titles.get(id)
    return (title || '').trim() || 'Untitled'
  }

  // Drop ids for papers that no longer exist (the active one is always shown,
  // even if the papers list hasn't refreshed yet).
  const visible = tabs.filter((id) => id === activePaperId || titles.has(id))
  if (visible.length === 0) return null

  return (
    <div className="tab-bar">
      <div className="tab-nav">
        <button className="tab-nav-btn" title="Back (Ctrl+Alt+←)" aria-label="Back"
          disabled={!canBack} onClick={onBack}>
          <ChevronLeft size={14} />
        </button>
        <button className="tab-nav-btn" title="Forward (Ctrl+Alt+→)" aria-label="Forward"
          disabled={!canForward} onClick={onForward}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="tab-strip" role="tablist" ref={stripRef}>
      {visible.map((id) => {
        const active = id === activePaperId
        const dirty = active && activeDirty
        const label = labelFor(id)
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={`tab ${active ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
            title={dirty ? `${label} (unsaved changes)` : label}
            onClick={() => { if (!active) onSelect(id) }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(id) } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
          >
            <span className="tab-label">{label}</span>
            {/* The dot stands in for the close button until you hover. */}
            <span className="tab-dirty" aria-hidden="true" />
            <button
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${label}`}
              onClick={(e) => { e.stopPropagation(); onClose(id) }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      </div>
    </div>
  )
}
