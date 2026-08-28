import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { GripVertical, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { openInBrowser, pasteImage, getClipboardText } from '../bridge'
import { buildCardRefIndex, resolveNoteIdFromIndex } from '../crossLink'
import {
  formatInlineRaw,
  getBlockType,
  parseTableRow,
  isTableSeparatorRow,
} from '../blockFormat'
import {
  AP_LINK_RE,
  stripApBlockId,
  extractApBlockSuffix,
  mergeEditedWithApSuffix,
  ensureApBlockId,
  buildApUrl,
} from '../docLinks'

// Shown next to "Paste blocks" and used in its error message.
const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
const PASTE_HINT = IS_MAC ? '\u2318V' : 'Ctrl+V'
// Modifier on its own, for the menu row that tells you how to paste.
const PASTE_MOD = IS_MAC ? '\u2318' : 'Ctrl'

function ZettelkastenSearch({ query, selected, papers }) {
  const results = useMemo(() => {
    return papers.filter(p => p.title.toLowerCase().includes(query.toLowerCase()))
  }, [papers, query])

  if (results.length === 0) {
    return (
      <div className="zettel-popup">
        <div className="zettel-popup-item" style={{ opacity: 0.5 }}>No papers found</div>
      </div>
    )
  }

  return (
    <div className="zettel-popup">
      {results.map((p, i) => (
        <div key={p.id} className={`zettel-popup-item ${i === selected ? 'selected' : ''}`}>
          {p.title}
        </div>
      ))}
    </div>
  )
}

/**
 * Block Editor — Notion-like editing experience.
 * Each line is a "block" that shows rendered content.
 * Clicking a block makes it editable inline.
 */

// Stable block-id suffix (hidden in editor UI; kept in stored markdown)
function findTableBounds(lines, rowIndex) {
  const isTableRow = (ln) => parseTableRow(ln) !== null
  if (!isTableRow(lines[rowIndex])) return null
  let start = rowIndex
  while (start > 0 && isTableRow(lines[start - 1])) start--
  let end = rowIndex
  while (end + 1 < lines.length && isTableRow(lines[end + 1])) end++
  if (start + 1 > end || !isTableSeparatorRow(lines[start + 1])) return null
  return { start, end }
}

function isTableHeadRow(lines, rowIndex) {
  const b = findTableBounds(lines, rowIndex)
  return !!b && b.start === rowIndex
}

function getNextClozeNumberInLine(line) {
  const matches = [...(line || '').matchAll(/\{\{c(\d+)::/g)]
  let max = 0
  for (const m of matches) max = Math.max(max, parseInt(m[1], 10) || 0)
  return max + 1
}

function countCards(blocks) {
  let basic = 0, reversible = 0, cloze = 0
  for (const b of blocks) {
    if (b.type === 'basic') basic++
    else if (b.type === 'reversible') reversible++
    else if (b.type === 'cloze') cloze++
  }
  return { basic, reversible, cloze }
}

/** Wrap selection in a single-line block (same idea as SourceEditor textarea). */
function wrapLineSegment(line, selStart, selEnd, prefix, suffix, emptyPlaceholder = 'text') {
  const len = line.length
  let a = Math.max(0, Math.min(selStart ?? 0, len))
  let b = Math.max(0, Math.min(selEnd ?? 0, len))
  if (b < a) [a, b] = [b, a]
  const before = line.slice(0, a)
  const selected = line.slice(a, b)
  const after = line.slice(b)
  if (selected.length > 0) {
    return {
      line: before + prefix + selected + suffix + after,
      selStart: a + prefix.length,
      selEnd: a + prefix.length + selected.length,
    }
  }
  const ph = emptyPlaceholder
  return {
    line: before + prefix + ph + suffix + after,
    selStart: a + prefix.length,
    selEnd: a + prefix.length + ph.length,
  }
}

function scheduleRestoreSelection(inputRef, start, end) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el || typeof el.setSelectionRange !== 'function') return
      const max = el.value.length
      const s = Math.max(0, Math.min(start, max))
      const e = Math.max(0, Math.min(end, max))
      el.focus()
      el.setSelectionRange(s, e)
    })
  })
}

// ─── Inline formatting ─────────────────────────────
// formatInline() is called from every card/heading/bullet/paragraph render
// (12 call sites in RenderBlock below) — including for blocks whose text
// hasn't changed but whose position in the document has (e.g. every line
// after a single Enter/paste/drag-reorder/duplicate/merge/delete). It's a
// pure function — the same (text, mediaDir) always produces the same HTML —
// so those re-renders can hit a cache instead of re-running the full regex
// chain above. No eviction: at realistic document sizes the memory cost is
// negligible (roughly 200 bytes/line — even tens of thousands of distinct
// lines across a long session stays in the tens-of-MB range).
//
// Critically, what is cached is the whole `{ __html }` PROP OBJECT, not just
// the HTML string. React 19 decides whether to touch dangerouslySetInnerHTML
// by comparing that prop by OBJECT IDENTITY, not by the string inside it: a
// fresh `{ __html: sameString }` literal on each render makes React re-set
// innerHTML anyway, and the browser then destroys and re-parses the whole
// subtree. On a large document that was thousands of DOM nodes torn down and
// rebuilt per keystroke. Handing React back the identical object lets it skip
// the DOM entirely whenever a block's text has not changed.
const formatInlineCache = new Map()
function formatInlineProp(text, mediaDir) {
  const cacheKey = (mediaDir || '') + '\u0000' + text
  let prop = formatInlineCache.get(cacheKey)
  if (prop === undefined) {
    prop = { __html: formatInlineRaw(text, mediaDir) }
    formatInlineCache.set(cacheKey, prop)
  }
  return prop
}

// Kept for callers that want the HTML string rather than the prop object.
function formatInline(text, mediaDir) {
  return formatInlineProp(text, mediaDir).__html
}

// ─── Link Preview ─────────────────────────────────────
function LinkPreview({ url }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  
  useEffect(() => {
    let active = true
    fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`)
      .then(res => res.json())
      .then(json => {
         if (active && json.status === 'success') setData(json.data)
         else if (active) setError(true)
      })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [url])

  if (error) return <a href={url} target="_blank" rel="noopener noreferrer" className="block-link-fallback">{url}</a>
  if (!data) return <div className="block-link-loading">Loading preview... <span className="block-link-url">{url}</span></div>
  
  return (
    <a className="block-link-card" href={url} target="_blank" rel="noopener noreferrer">
      <div className="block-link-content">
         <div className="block-link-title">{data.title || url}</div>
         <div className="block-link-desc">{data.description || ''}</div>
         <div className="block-link-url-text">{url}</div>
      </div>
      {data.image && (
         <div className="block-link-image" style={{ backgroundImage: `url(${data.image.url})` }} />
      )}
    </a>
  )
}

// ─── Rendered block ─────────────────────────────────
function RenderBlock({ line, type, mediaDir, onResize, noteId }) {
  const t = stripApBlockId(line).trim()

  const parseTableCells = (rowLine) => {
    const raw = rowLine.trim().replace(/^\|/, '').replace(/\|$/, '')
    return raw.split('|').map((cell) => cell.trim())
  }

  if (type === 'empty') return <div className="block-spacer" />

  if (type === 'divider') return <hr className="block-divider" />

  if (type === 'heading') {
    const m = t.match(/^(#{1,6})\s+(.+)$/)
    const level = m[1].length
    const Tag = `h${level}`
    return <Tag className={`block-heading block-h${level}`} dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} />
  }

  if (type === 'blockquote') {
    return <blockquote className="block-blockquote" dangerouslySetInnerHTML={formatInlineProp(t.slice(2), mediaDir)} />
  }

  if (type === 'link-preview') {
    return <LinkPreview url={t} />
  }

  if (type === 'image') {
    // Support ![alt|width](src) syntax (use raw line so filenames stay intact)
    const m = stripApBlockId(line).trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (m) {
      let altText = m[1]
      let width = null
      // Parse width from alt: ![alt|300](src)
      const widthMatch = altText.match(/^(.+?)\|(\d+)$/)
      if (widthMatch) {
        altText = widthMatch[1]
        width = parseInt(widthMatch[2])
      }
      let src = m[2]
      if (mediaDir && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
        src = `file:///${mediaDir}/${src}`
      }
      const imgStyle = { maxWidth: width ? `${width}px` : '400px' }
      return (
        <div className="block-image">
          <img src={src} alt={altText} style={imgStyle} />
          {altText && <div className="block-image-caption">{altText}{width && <span className="block-image-size"> · {width}px</span>}</div>}
          <div className="block-image-resize">
            <button className="resize-btn" onClick={() => onResize?.('150')}>S</button>
            <button className="resize-btn" onClick={() => onResize?.('300')}>M</button>
            <button className="resize-btn" onClick={() => onResize?.('500')}>L</button>
            <button className="resize-btn" onClick={() => onResize?.('')}>Full</button>
          </div>
        </div>
      )
    }
  }

  if (type === 'table') {
    const rows = line.split('\n').map((row) => stripApBlockId(row))
    return (
      <div>
        {rows.map((row, rowIdx) => {
          if (isTableSeparatorRow(row)) return <div key={rowIdx} className="block-table-separator" />
          const cells = parseTableCells(row)
          return (
            <div key={rowIdx} className="block-table-row">
              {cells.map((cell, idx) => (
                <div key={idx} className="block-table-cell" dangerouslySetInnerHTML={formatInlineProp(cell, mediaDir)} />
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  if (type === 'basic') {
    const content = t.replace(/^\s*[-*]\s+/, '')
    const m = content.match(/^(.+?)\s*>>\s*(.+)$/)
    if (m) return (
      <div className="block-card block-card-basic">
        <div className="block-card-type">
          <span>BASIC</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-card-front" dangerouslySetInnerHTML={formatInlineProp(m[1], mediaDir)} />
        <div className="block-card-sep">▼</div>
        <div className="block-card-back" dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} />
      </div>
    )
  }

  if (type === 'reversible') {
    const content = t.replace(/^\s*[-*]\s+/, '')
    const m = content.match(/^(.+?)\s*<>\s*(.+)$/)
    if (m) return (
      <div className="block-card block-card-reversible">
        <div className="block-card-type reversible">
          <span>REVERSIBLE</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-card-front" dangerouslySetInnerHTML={formatInlineProp(m[1], mediaDir)} />
        <div className="block-card-sep">⇅</div>
        <div className="block-card-back" dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} />
      </div>
    )
  }

  if (type === 'cloze') {
    return (
      <div className="block-cloze-wrapper">
        {/* Injected the standard card type container with a specific cloze class */}
        <div className="block-card-type cloze-type">
          <span>CLOZE</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-cloze" dangerouslySetInnerHTML={formatInlineProp(t, mediaDir)} />
      </div>
    )
  }

  if (type === 'bullet') {
    const m = t.match(/^\s*[-*]\s+(.+)$/)
    return <div className="block-list-item"><span className="block-bullet">•</span><span dangerouslySetInnerHTML={formatInlineProp(m[1], mediaDir)} /></div>
  }

  if (type === 'numbered') {
    const m = t.match(/^\s*(\d+)\.\s+(.+)$/)
    return <div className="block-list-item"><span className="block-num">{m[1]}.</span><span dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} /></div>
  }

  if (t.startsWith('&& ')) {
    return (
      <p className="block-paragraph block-supplement">
        <em dangerouslySetInnerHTML={formatInlineProp(t.slice(3), mediaDir)} />
      </p>
    )
  }

  // Default: paragraph
  return <p className="block-paragraph" dangerouslySetInnerHTML={formatInlineProp(t, mediaDir)} />
}


// ─── Block context menu ─────────────────────────────
function BlockContextMenu({
  x,
  y,
  menuRef,
  onClose,
  onEdit,
  onCopy,
  onPasteBlocks,
  onDuplicate,
  onMerge,
  onDelete,
  onEditTable,
  canEditTable,
  onGoToSource,
  canGoToSource,
  onCreateLink,
  canCreateLink,
  createLinkHint,
  selectionCount,
}) {
  const multi = selectionCount > 1
  useEffect(() => {
    let cancelled = false
    const onDocPointer = (e) => {
      if (cancelled) return
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const raf = requestAnimationFrame(() => {
      if (!cancelled) {
        document.addEventListener('pointerdown', onDocPointer, true)
        document.addEventListener('keydown', onKey, true)
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuRef, onClose])

  const pad = 8
  const w = 200
  const h = 200
  const left = Math.max(pad, Math.min(x, window.innerWidth - w - pad))
  const top = Math.max(pad, Math.min(y, window.innerHeight - h - pad))

  return (
    <div
      ref={menuRef}
      className="block-context-menu"
      style={{ left, top }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {multi && (
        <div className="block-context-menu-hint" role="presentation">
          {selectionCount} blocks selected
        </div>
      )}
      <button
        type="button"
        className="block-context-menu-item"
        role="menuitem"
        disabled={multi}
        onClick={onEdit}
      >
        Edit block
      </button>
      {createLinkHint !== null && (
        <button
          type="button"
          className="block-context-menu-item"
          role="menuitem"
          disabled={multi || !canCreateLink}
          title={canCreateLink ? 'Point this phrase at a header or document' : createLinkHint}
          onClick={onCreateLink}
        >
          Create link…
        </button>
      )}
      {canEditTable && (
        <button
          type="button"
          className="block-context-menu-item"
          role="menuitem"
          disabled={multi}
          onClick={onEditTable}
        >
          Edit table
        </button>
      )}
      {canGoToSource && (
        <button
          type="button"
          className="block-context-menu-item"
          role="menuitem"
          disabled={multi}
          onClick={onGoToSource}
        >
          Go to source
        </button>
      )}
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onPasteBlocks}>
        Press {PASTE_MOD} + V to Paste
      </button>
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onCopy}>
        {multi ? 'Copy blocks' : 'Copy line'}
      </button>
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onDuplicate}>
        Duplicate below
      </button>
      {multi && (
        <button type="button" className="block-context-menu-item" role="menuitem" onClick={onMerge}>
          Merge into one block
        </button>
      )}
      <div className="block-context-menu-sep" />
      <button type="button" className="block-context-menu-item danger" role="menuitem" onClick={onDelete}>
        {multi ? 'Delete blocks' : 'Delete block'}
      </button>
    </div>
  )
}

// ─── Single Block Component ─────────────────────────
function syncBlockTextareaHeight(el) {
  if (!el || el.tagName !== 'TEXTAREA') return
  el.style.height = 'auto'
  const max = Math.min(Math.floor(window.innerHeight * 0.55), 520)
  el.style.maxHeight = `${max}px`
  const h = Math.min(el.scrollHeight, max)
  el.style.height = `${h}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

const Block = React.memo(function Block({
  blockId,
  line,
  type,
  focused,
  isSelected,
  isRevealed,
  dragDisabled,
  onRowClick,
  onChange,
  onKeyDown,
  mediaDir,
  onImageResize,
  noteId,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
  onBlockContextMenu,
  onOpenLink,
  activeBlockInputRef,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
  blockKey,
  onZettelSearch,
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (!focused) return
    const el = inputRef.current
    if (!el) return
    if (activeBlockInputRef) activeBlockInputRef.current = el
    return () => {
      if (activeBlockInputRef && activeBlockInputRef.current === el) activeBlockInputRef.current = null
    }
  }, [focused, activeBlockInputRef])

  useEffect(() => {
    if (focused && inputRef.current) {
      inputRef.current.focus()
      // Put cursor at end
      const len = inputRef.current.value.length
      inputRef.current.setSelectionRange(len, len)
    }
  }, [focused])

  useLayoutEffect(() => {
    if (!focused) return
    syncBlockTextareaHeight(inputRef.current)
  }, [focused, line])

  const rawDisplay = stripApBlockId(line)
  const spacesMatch = type !== 'table' ? rawDisplay.match(/^[ \t]*/) : null
  const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
  const actualText = type !== 'table' ? rawDisplay.slice(leadingSpaces.length) : rawDisplay
  const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
  const indentPx = indentLevel * 24

  return (
    <div
      className={`block-row ${isDragOver ? 'drag-over' : ''} ${isSelected && !focused ? 'block-row-selected' : ''} ${isRevealed ? 'block-row-revealed' : ''}`}
      style={{ marginLeft: indentPx }}
      data-block-id={blockId}
      draggable={!focused && !dragDisabled}
      onClick={(e) => {
        const zettelEl = e.target.closest('.block-zettel-link')
        if (zettelEl) {
          // Allow jump if not focused OR if Ctrl/Cmd is held while focused
          if (!focused || e.ctrlKey || e.metaKey) {
            e.preventDefault()
            e.stopPropagation()
            if (window.openZettel) window.openZettel(zettelEl.dataset.title)
            return
          }
        }
        // Document links open on DOUBLE-click (see onDoubleClick below), so a
        // single click on one must not swap the block into an editing textarea
        // — the second click would then have no link element to land on. To
        // edit a line containing a link, click it anywhere outside the link,
        // or use "Edit block" in the right-click menu.
        if (!focused && e.target.closest('.ap-link')) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (!focused) {
          onRowClick(e, blockId, type)
        }
      }}
      onDoubleClick={(e) => {
        const linkEl = e.target.closest('.ap-link')
        if (!linkEl) return
        e.preventDefault()
        e.stopPropagation()
        onOpenLink?.(linkEl.dataset.apTarget)
      }}
      onDragStart={(e) => onDragStart(e, blockId)}
      onDragOver={(e) => onDragOver(e, blockId)}
      onDrop={(e) => onDrop(e, blockId)}
      onContextMenu={(e) => {
        e.preventDefault()
        onBlockContextMenu?.(e, blockId)
      }}
    >
      {Array.from({ length: indentLevel }).map((_, i) => (
         <div 
           key={i} 
           className="thread-line" 
           style={{ left: (i - indentLevel) * 24 + 8 }} 
         />
      ))}
      <div className="block-collapse-wrapper">
         {hasChildren && (
            <div className="block-collapse-btn" onClick={(e) => onToggleCollapse(e, blockKey)}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
         )}
      </div>
      <div className="block-handle"><GripVertical size={12} /></div>
      <div className="block-bullet-indicator">
         {(type === 'text' || type === 'empty') && <div className="block-dot" />}
      </div>
      <div className={`block type-${type} ${focused ? 'block-editing' : ''} ${focused && isSelected ? 'block-editing-selected' : ''}`}>
        {focused ? (
          <textarea
            ref={inputRef}
            className="block-input block-input-textarea"
            value={actualText}
            rows={1}
            wrap="soft"
            spellCheck={true}
            autoComplete="off"
            onChange={e => {
              const val = type !== 'table' ? leadingSpaces + e.target.value : e.target.value
              onChange(blockId, mergeEditedWithApSuffix(val, line))
              if (onZettelSearch) {
                const selStart = e.target.selectionStart
                const textBefore = e.target.value.slice(0, selStart)
                const lastO = textBefore.lastIndexOf('[[')
                const lastC = textBefore.lastIndexOf(']]')
                if (lastO !== -1 && lastO > lastC) {
                  onZettelSearch(blockId, textBefore.slice(lastO + 2))
                } else {
                  onZettelSearch(blockId, null)
                }
              }
            }}
            onInput={(e) => syncBlockTextareaHeight(e.target)}
            onKeyDown={e => onKeyDown(e, blockId)}
          />
        ) : (
          <RenderBlock line={actualText} type={type} mediaDir={mediaDir} onResize={(w) => onImageResize(blockId, w)} noteId={noteId} />
        )}
      </div>
    </div>
  )
})


function getBlockRangeAndIndent(lines, idx) {
  const spaces = (lines[idx].match(/^[ \t]*/) || [''])[0]
  const indent = Math.floor(spaces.replace(/\t/g, '    ').length / 4)
  let end = idx
  while (end + 1 < lines.length) {
    const nextIndent = Math.floor((lines[end + 1].match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length / 4)
    if (nextIndent > indent) end++
    else break
  }
  return { start: idx, end, indent }
}

// ─── Block Editor ───────────────────────────────────
const BlockEditor = forwardRef(function BlockEditor({ content, onChange, onCardCountChange, settings, mediaDir, cardRefs, onTableEditRequest, onGoToSource, onOpenDocLink, onRequestCreateLink, onNotify, papers = [] }, ref) {
  const [focusedIndex, setFocusedIndex] = useState(null)
  const [selectedIndices, setSelectedIndices] = useState(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [blockMenu, setBlockMenu] = useState(null)
  // ── Collapse-by-default: compute which keys should start collapsed ──────────
  // A block is auto-collapsed on mount if it has at least one child (i.e. the
  // next line is indented deeper).  We only re-run this initialiser when the
  // *identity* of the content prop changes (new document loaded), not on every
  // keystroke — that's why we track a stable "document id" via useRef so the
  // reset effect below can distinguish a real document swap from an edit.
  const computeInitialCollapsed = useCallback((rawContent) => {
    const lines = rawContent.split('\n')
    const initial = new Set()
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]
      const rawDisplay = stripApBlockId(line)
      const spacesMatch = rawDisplay.match(/^[ \t]*/)
      const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
      const actualText = rawDisplay.slice(leadingSpaces.length)
      const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const nextLine = lines[i + 1]
      const nextSpacesMatch = stripApBlockId(nextLine).match(/^[ \t]*/)
      const nextLeading = nextSpacesMatch ? nextSpacesMatch[0] : ''
      const nextIndent = Math.floor(nextLeading.replace(/\t/g, '    ').length / 4)
      if (nextIndent > indentLevel) {
        initial.add(`${indentLevel}:${actualText.trim()}`)
      }
    }
    return initial
  }, [])

  const [collapsedKeys, setCollapsedKeys] = useState(() => computeInitialCollapsed(content))

  // When the document itself is swapped in (not just edited), reset collapse
  // state so the new document also opens collapsed-by-default.
  const prevContentRef = useRef(content)
  useEffect(() => {
    const prev = prevContentRef.current
    // Heuristic: a "new document" swap produces a large diff.  Edits are
    // character-level; a full document replacement typically changes ≥50 chars
    // in the first 200 characters OR the line-count changes significantly.
    const prevHead = prev.slice(0, 200)
    const nextHead = content.slice(0, 200)
    const prevLines = prev.split('\n').length
    const nextLines = content.split('\n').length
    // Ignore leading whitespace changes (like Tab indentation) to prevent false positives
    const prevHeadTrimmed = prevHead.replace(/^[ \t]+/gm, '')
    const nextHeadTrimmed = nextHead.replace(/^[ \t]+/gm, '')
    
    // Require a significant structural change (≥50 chars or ≥15 lines) to trigger a full collapse reset
    const isDocumentSwap = (prevHeadTrimmed !== nextHeadTrimmed && Math.abs(prev.length - content.length) >= 50) || Math.abs(prevLines - nextLines) >= 15
    if (isDocumentSwap) {
      setCollapsedKeys(computeInitialCollapsed(content))
    }
    prevContentRef.current = content
  }, [content, computeInitialCollapsed])

  const [lasso, setLasso] = useState(null)
  const [zettelSearch, setZettelSearch] = useState(null)
  const containerRef = useRef(null)
  const blockMenuRef = useRef(null)
  const activeBlockInputRef = useRef(null)

  useEffect(() => {
    if (!lasso) return
    const onMouseMove = (e) => {
      e.preventDefault()
      setLasso(prev => prev ? { ...prev, curX: e.clientX, curY: e.clientY } : null)
      if (!containerRef.current) return
      const startX = lasso.startX
      const startY = lasso.startY
      const curX = e.clientX
      const curY = e.clientY
      const top = Math.min(startY, curY)
      const bottom = Math.max(startY, curY)
      const left = Math.min(startX, curX)
      const right = Math.max(startX, curX)

      const nextSelection = new Set()
      const children = containerRef.current.querySelectorAll('.block-row')
      children.forEach((child) => {
        const cRect = child.getBoundingClientRect()
        // Determine overlap
        if (cRect.top <= bottom && cRect.bottom >= top && cRect.left <= right && cRect.right >= left) {
          const idx = idToIndexRef.current.get(child.dataset.blockId)
          if (idx !== undefined) nextSelection.add(idx)
        }
      })
      setSelectedIndices(nextSelection)
    }
    const onMouseUp = () => {
      setLasso(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [lasso])

// ── Expand All Shortcut ──────────────────────────────────────────
  useEffect(() => {
    const handleExpandAll = (e) => {
      // Listens for Shift + Command (metaKey) + Down Arrow
      if (e.shiftKey && e.metaKey && e.key === 'ArrowDown') {
        e.preventDefault()
        // Passing an empty Set clears all collapsed states globally
        setCollapsedKeys(new Set())
      }
    }

    // Attach to the window to catch the command even if a specific block isn't focused
    window.addEventListener('keydown', handleExpandAll)
    
    return () => {
      window.removeEventListener('keydown', handleExpandAll)
    }
  }, [])

  const toggleCollapse = useCallback((e, key) => {
    e.stopPropagation()
    setFocusedIndex(null)
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Built once per cardRefs change (not per keystroke — cardRefs only
  // changes after generating/syncing cards) so note-ID lookups below are
  // O(1) Map reads instead of rescanning the whole card_refs array for
  // every card line in the document. See crossLink.js for details.
  const cardRefIndex = useMemo(() => buildCardRefIndex(cardRefs), [cardRefs])

  // ── Stable per-line identity for React keys ──────────────────────────
  // Keying blocks by array position means that inserting or deleting a line
  // hands every block below it a DIFFERENT line's text, forcing them all to
  // re-render (and re-parse their HTML). Instead, give each line an id that
  // survives edits above it: match the unchanged prefix and suffix of the
  // document against the previous version, and reuse ids positionally in the
  // changed middle. Typing reuses the id for the edited line (so the focused
  // textarea is never remounted and never loses the cursor), and pressing
  // Enter reuses every id below the insertion point.
  const lineIdsRef = useRef({ lines: [], ids: [] })
  const nextLineIdRef = useRef(1)
  const lineIds = useMemo(() => {
    const newLines = content.split('\n')
    const { lines: oldLines, ids: oldIds } = lineIdsRef.current
    const n = newLines.length
    const m = oldLines.length
    // Longest common prefix, then longest common suffix of what remains.
    // Bounding the suffix by (n - p) and (m - p) keeps the two regions from
    // overlapping, which guarantees no id is reused twice.
    let p = 0
    while (p < n && p < m && newLines[p] === oldLines[p]) p++
    let suf = 0
    while (suf < (n - p) && suf < (m - p) && newLines[n - 1 - suf] === oldLines[m - 1 - suf]) suf++
    const ids = new Array(n)
    for (let i = 0; i < p; i++) ids[i] = oldIds[i]
    for (let i = 0; i < suf; i++) ids[n - 1 - i] = oldIds[m - 1 - i]
    const newMid = n - p - suf
    const oldMid = m - p - suf
    for (let i = 0; i < newMid; i++) {
      ids[p + i] = i < oldMid ? oldIds[p + i] : 'L' + (nextLineIdRef.current++)
    }
    lineIdsRef.current = { lines: newLines, ids }
    return ids
  }, [content])

  // id -> current line index. Callbacks below take a stable blockId and look
  // the index up here at event time, so they never need the index as a prop
  // (a prop that shifts for every block below an edit, which would defeat
  // Block's React.memo and re-render the whole document).
  const idToIndex = useMemo(() => {
    const m = new Map()
    for (let i = 0; i < lineIds.length; i++) m.set(lineIds[i], i)
    return m
  }, [lineIds])
  const idToIndexRef = useRef(idToIndex)
  idToIndexRef.current = idToIndex

  // Entrance-animation delay, assigned once per line id and then held steady.
  // Deriving it from the row's position meant the inline style changed for
  // every block below an edit, causing a wave of style writes.
  const staggerRef = useRef(new Map())
  const staggerDelays = useMemo(() => {
    const m = staggerRef.current
    lineIds.forEach((id, i) => {
      if (!m.has(id)) m.set(id, Math.min((i % 40) * 25, 800))
    })
    return m
  }, [lineIds])

  const blocks = useMemo(() => {
    const lines = content.split('\n')
    const parsed = lines.map((line, i) => {
      const type = getBlockType(line)
      const rawDisplay = stripApBlockId(line)
      const spacesMatch = type !== 'table' ? rawDisplay.match(/^[ \t]*/) : null
      const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
      const actualText = type !== 'table' ? rawDisplay.slice(leadingSpaces.length) : rawDisplay
      const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const key = `${indentLevel}:${actualText.trim()}`
      // Resolve the linked Anki note ID here, in the single pass we already
      // make over every line, instead of a separate lookup per card block
      // during render (which used to re-split the whole document and
      // rescan card_refs for every single card — see crossLink.js).
      const noteId = (type === 'basic' || type === 'reversible' || type === 'cloze')
        ? resolveNoteIdFromIndex(i, line, cardRefIndex)
        : null
      return { line, type, key, indentLevel, actualText, noteId, id: lineIds[i] }
    })

    const hiddenIndices = new Set()
    for (let i = 0; i < parsed.length; i++) {
        const current = parsed[i]
        
        let hasChildren = false
        if (i < parsed.length - 1) {
            const next = parsed[i + 1]
            if (next.indentLevel > current.indentLevel) {
               hasChildren = true
            }
        }
        current.hasChildren = hasChildren

        if (hasChildren && collapsedKeys.has(current.key)) {
            for (let j = i + 1; j < parsed.length; j++) {
                if (parsed[j].indentLevel <= current.indentLevel) break
                hiddenIndices.add(j)
            }
        }
    }
    
    parsed.forEach((b, i) => { b.isHidden = hiddenIndices.has(i) })
    
    return parsed
  }, [content, collapsedKeys, cardRefIndex, lineIds])

  // Update card counts
  useEffect(() => {
    onCardCountChange(countCards(blocks))
  }, [blocks])

  // ── "Latest value" refs ──────────────────────────────────────────
  // content/cardRefs/papers/blocks/zettelSearch all change frequently
  // (content on every keystroke, blocks right alongside it). The
  // callbacks below used to close over those values directly and list
  // them as useCallback deps — which meant the callbacks were rebuilt
  // every keystroke too, handing every <Block/> a brand-new
  // onChange/onRowClick/onKeyDown/onImageResize prop each time and
  // defeating Block's React.memo for the whole document. Reading from
  // refs (kept in sync every render, below) lets these callbacks stay
  // referentially stable while still always seeing the latest value.
  const contentRef = useRef(content)
  contentRef.current = content
  const papersRef = useRef(papers)
  papersRef.current = papers
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const zettelSearchRef = useRef(zettelSearch)
  zettelSearchRef.current = zettelSearch
  const focusedIndexRef = useRef(focusedIndex)
  focusedIndexRef.current = focusedIndex
  const selectionAnchorRef = useRef(selectionAnchor)
  selectionAnchorRef.current = selectionAnchor

  const handleZettelSearch = useCallback((blockId, query) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    if (query !== null) {
      setZettelSearch(prev => (prev?.index === index && prev?.query === query) ? prev : { index, query, selected: 0 })
    } else {
      setZettelSearch(null)
    }
  }, [])

  const handleBlockChange = useCallback((blockId, newValue) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    const lines = contentRef.current.split('\n')
    const b = findTableBounds(lines, index)
    if (b && b.start === index) {
      lines.splice(b.start, b.end - b.start + 1, ...newValue.split('\n'))
    } else {
      lines[index] = newValue
    }
    onChange(lines.join('\n'))
  }, [onChange])

  const handleBlockRowClick = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    if (e.button !== 0) return
    const el = e.target
    if (el.closest && el.closest('button, a, [role="button"]')) return

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setFocusedIndex(null)
      setSelectedIndices((prev) => {
        const next = new Set(prev)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
      setSelectionAnchor(index)
      return
    }
    if (e.shiftKey) {
      const anchor = selectionAnchorRef.current !== null ? selectionAnchorRef.current : focusedIndexRef.current
      if (anchor !== null && anchor !== undefined) {
        e.preventDefault()
        setFocusedIndex(null)
        const a = Math.min(anchor, index)
        const b = Math.max(anchor, index)
        const next = new Set()
        for (let i = a; i <= b; i++) next.add(i)
        setSelectedIndices(next)
        return
      }
    }
    const lines = contentRef.current.split('\n')
    const b = findTableBounds(lines, index)
    const targetIndex = b ? b.start : index
    setSelectedIndices(new Set())
    setSelectionAnchor(targetIndex)
    setFocusedIndex(targetIndex)
  }, [])

  const handleImageResize = useCallback((blockId, newWidth) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    const lines = contentRef.current.split('\n')
    const line = lines[index]
    // Parse existing image syntax
    const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (!m) return
    let alt = m[1]
    const src = m[2]
    // Remove existing width from alt
    alt = alt.replace(/\|\d+$/, '')
    // Build new line
    if (newWidth) {
      lines[index] = `![${alt}|${newWidth}](${src})`
    } else {
      lines[index] = `![${alt}](${src})`
    }
    onChange(lines.join('\n'))
  }, [onChange])

  const handleKeyDown = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    // Read the latest values via ref instead of closing over the state/props
    // directly. This keeps the callback's identity stable across keystrokes
    // (see the refs declared above) instead of rebuilding it — and every
    // <Block/>'s onKeyDown prop along with it — on every character typed.
    // blocks/zettelSearch/papers were never in the old dependency array
    // either, so simply dropping `content` from it without doing this would
    // have frozen this closure on stale collapse/autocomplete state instead.
    const content = contentRef.current
    const blocks = blocksRef.current
    const zettelSearch = zettelSearchRef.current
    const papers = papersRef.current
    const lines = content.split('\n')

    const currentLine = lines[index]
    const currentApSuf = extractApBlockSuffix(currentLine)
    const currentDisplay = stripApBlockId(currentLine)
    const currentSpacesMatch = currentDisplay.match(/^[ \t]*/)
    const leadingSpaces = currentSpacesMatch ? currentSpacesMatch[0] : ''
    const actualText = currentDisplay.slice(leadingSpaces.length)

    if (zettelSearch && zettelSearch.index === index) {
      const results = papers.filter(p => p.title.toLowerCase().includes(zettelSearch.query.toLowerCase()))
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setZettelSearch(prev => ({ ...prev, selected: Math.min(prev.selected + 1, results.length - 1) }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setZettelSearch(prev => ({ ...prev, selected: Math.max(prev.selected - 1, 0) }))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setZettelSearch(null)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const chosen = results[zettelSearch.selected]
        if (chosen) {
          const selStart = e.target.selectionStart
          const before = e.target.value.slice(0, selStart)
          const lastOpen = before.lastIndexOf('[[')
          const startStr = e.target.value.slice(0, lastOpen)
          const endStr = e.target.value.slice(selStart)
          
          const finalVal = startStr + `[[${chosen.title}]]` + endStr
          lines[index] = mergeEditedWithApSuffix(leadingSpaces + finalVal, currentLine)
          onChange(lines.join('\n'))
          
          const nxtPos = startStr.length + 4 + chosen.title.length
          scheduleRestoreSelection(activeBlockInputRef, nxtPos, nxtPos)
        }
        setZettelSearch(null)
        return
      }
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) return
      e.preventDefault()
      const cursorPos = e.target.selectionStart
      const before = actualText.slice(0, cursorPos)
      const after = actualText.slice(cursorPos)
      const newLineBefore = leadingSpaces + before
      const newLineAfter = leadingSpaces + after
      
      lines[index] = currentApSuf ? newLineBefore.replace(/\s+$/, '') + currentApSuf : newLineBefore
      lines.splice(index + 1, 0, newLineAfter)
      onChange(lines.join('\n'))
      setTimeout(() => setFocusedIndex(index + 1), 10)
      return
    }

    if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      if (leadingSpaces.length > 0) {
        e.preventDefault()
        lines[index] = currentApSuf ? (lines[index].replace(/^( {1,4}|\t)/, '')).replace(/\s+$/, '') + currentApSuf : lines[index].replace(/^( {1,4}|\t)/, '')
        onChange(lines.join('\n'))
        return
      }
      if (index > 0) {
        e.preventDefault()
        const prevLine = lines[index - 1]
        const suf = extractApBlockSuffix(prevLine)
        const prevDisplay = stripApBlockId(prevLine)
        
        const merged = prevDisplay + actualText
        lines[index - 1] = suf ? merged.replace(/\s+$/, '') + suf : merged
        
        lines.splice(index, 1)
        
        onChange(lines.join('\n'))
        setFocusedIndex(index - 1)
        return
      }
    }

    if (e.key === 'ArrowUp' && index > 0) {
      const ta = e.target
      const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0
      if (atStart) {
        e.preventDefault()
        let nextIndex = index - 1
        while (nextIndex > 0 && blocks[nextIndex]?.isHidden) {
           nextIndex--
        }
        setFocusedIndex(nextIndex)
      }
    }

    if (e.key === 'ArrowDown' && index < lines.length - 1) {
      const ta = e.target
      const len = ta.value.length
      const atEnd = ta.selectionStart === len && ta.selectionEnd === len
      if (atEnd) {
        e.preventDefault()
        let nextIndex = index + 1
        while (nextIndex < lines.length - 1 && blocks[nextIndex]?.isHidden) {
           nextIndex++
        }
        setFocusedIndex(nextIndex)
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      
      const currentIndent = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const prevIndent = index > 0 ? Math.floor((lines[index - 1].match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length / 4) : -1
      const maxAllowed = prevIndent + 1
      
      const toIndent = [index]
      for (let i = index + 1; i < lines.length; i++) {
        const iSpaces = (lines[i].match(/^[ \t]*/) || [''])[0]
        const iIndent = Math.floor(iSpaces.replace(/\t/g, '    ').length / 4)
        if (iIndent > currentIndent) toIndent.push(i)
        else break
      }
      
      if (e.shiftKey) {
        if (currentIndent === 0) return
        toIndent.forEach(i => {
           const iApSuf = extractApBlockSuffix(lines[i])
           lines[i] = iApSuf ? (lines[i].replace(/^( {1,4}|\t)/, '')).replace(/\s+$/, '') + iApSuf : lines[i].replace(/^( {1,4}|\t)/, '')
        })
      } else {
        if (currentIndent >= maxAllowed) return
        toIndent.forEach(i => {
           const iApSuf = extractApBlockSuffix(lines[i])
           lines[i] = iApSuf ? ('    ' + lines[i]).replace(/\s+$/, '') + iApSuf : '    ' + lines[i]
        })
      }
      onChange(lines.join('\n'))
    }
  }, [onChange])

  const handleDragStart = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    e.dataTransfer.setData('text/plain', index.toString())
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((e, blockId) => {
    const targetIndex = idToIndexRef.current.get(blockId)
    if (targetIndex === undefined) return
    e.preventDefault()
    setDragOverIndex(null)
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'))
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return

    let lines = contentRef.current.split('\n')
    
    // Logic for dragging block & children under target block
    const { start: sStart, end: sEnd, indent: sIndent } = getBlockRangeAndIndent(lines, sourceIndex)
    if (targetIndex >= sStart && targetIndex <= sEnd) return // Cannot drop into itself!

    const { indent: tIndent, end: tEnd } = getBlockRangeAndIndent(lines, targetIndex)
    
    // Desired new indent is the target block's indent + 1
    const diffIndent = (tIndent + 1) - sIndent
    const diffSpaces = diffIndent >= 0 ? ' '.repeat(diffIndent * 4) : ''
    
    let extracted = lines.splice(sStart, sEnd - sStart + 1)
    
    extracted = extracted.map(line => {
       const curSpacesMatch = line.match(/^[ \t]*/)
       const curSpaces = curSpacesMatch ? curSpacesMatch[0] : ''
       const curIndent = Math.floor(curSpaces.replace(/\t/g, '    ').length / 4)
       const newIndent = Math.max(0, curIndent + diffIndent)
       return ' '.repeat(newIndent * 4) + line.slice(curSpaces.length)
    })

    const adjustedTEnd = sStart < targetIndex ? tEnd - (sEnd - sStart + 1) : tEnd
    const insertPos = adjustedTEnd + 1

    lines.splice(insertPos, 0, ...extracted)
    onChange(lines.join('\n'))
    setSelectedIndices(new Set())
  }, [onChange])

  // Opening a document link is delegated to App, which owns paper switching.
  // Kept stable via a ref so every <Block/> keeps its memoized props.
  const onOpenDocLinkRef = useRef(onOpenDocLink)
  onOpenDocLinkRef.current = onOpenDocLink
  const handleOpenLink = useCallback((target) => {
    if (target) onOpenDocLinkRef.current?.(target)
  }, [])

  // Transient highlight used when arriving at a link's target, so the reader's
  // eye lands on the right line without the block flipping into edit mode.
  const [revealedIndex, setRevealedIndex] = useState(null)
  const revealTimerRef = useRef(null)
  const revealBlock = useCallback((index) => {
    setSelectedIndices(new Set())
    setFocusedIndex(null)
    setRevealedIndex(index)
    setTimeout(() => {
      const el = containerRef.current?.children[index]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    clearTimeout(revealTimerRef.current)
    revealTimerRef.current = setTimeout(() => setRevealedIndex(null), 2400)
  }, [])
  useEffect(() => () => clearTimeout(revealTimerRef.current), [])

  const closeBlockMenu = useCallback(() => setBlockMenu(null), [])

  const handleBlockContextMenu = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    e.preventDefault()
    e.stopPropagation()
    // Snapshot the highlighted phrase now: opening the menu moves focus away
    // from the textarea, so reading its selection later is unreliable.
    const input = activeBlockInputRef.current
    const isFocusedBlock = focusedIndexRef.current === index && !!input
    const textSel =
      isFocusedBlock && input.selectionStart !== input.selectionEnd
        ? {
            start: input.selectionStart,
            end: input.selectionEnd,
            text: input.value.slice(input.selectionStart, input.selectionEnd),
          }
        : null
    setSelectedIndices((prev) => {
      const next = prev.has(index) && prev.size > 1 ? new Set(prev) : new Set([index])
      queueMicrotask(() => {
        const sorted = [...next].sort((a, b) => a - b)
        setBlockMenu({ x: e.clientX, y: e.clientY, index, selection: sorted, textSel })
      })
      return next
    })
  }, [])

  // Hand the request up to App, which owns the picker and paper switching.
  const onRequestCreateLinkRef = useRef(onRequestCreateLink)
  onRequestCreateLinkRef.current = onRequestCreateLink
  const createLinkAtMenu = useCallback(() => {
    const menu = blockMenu
    if (!menu?.textSel?.text) return
    closeBlockMenu()
    onRequestCreateLinkRef.current?.({
      phrase: menu.textSel.text,
      index: menu.index,
      selStart: menu.textSel.start,
      selEnd: menu.textSel.end,
    })
  }, [blockMenu, closeBlockMenu])

  /**
   * Write the link into the document in ONE content update:
   *   - anchor the target header when it lives in this same document,
   *   - replace the highlighted phrase with [phrase](ap://…),
   *   - anchor the SOURCE line too, so a future graph can address both ends.
   * Doing it as a single edit avoids a half-applied link if anything throws.
   */
  const insertDocLink = useCallback((opts) => {
    const { index, selStart, selEnd, targetPaperId, targetLineIndex } = opts || {}
    const lines = contentRef.current.split('\n')
    if (index == null || index < 0 || index >= lines.length) return null

    let blockId = opts.targetBlockId || ''
    if (targetLineIndex != null && targetLineIndex >= 0 && targetLineIndex < lines.length
        && targetLineIndex !== index) {
      const anchored = ensureApBlockId(lines[targetLineIndex])
      lines[targetLineIndex] = anchored.line
      blockId = anchored.blockId
    }

    const full = lines[index]
    const apSuffix = extractApBlockSuffix(full)
    const display = stripApBlockId(full)
    const spaces = (display.match(/^[ \t]*/) || [''])[0]
    const body = display.slice(spaces.length)
    // Never let a link swallow the line's markdown marker. Wrapping the "##"
    // of a header (or a bullet's "-") in link syntax would stop the line being
    // a header/bullet at all, so the selection is clamped past the marker.
    const markerMatch = body.match(/^(#{1,6}\s+|[-*]\s+|\d+\.\s+|>\s+)/)
    const markerLen = markerMatch ? markerMatch[0].length : 0
    const from = Math.max(markerLen, Math.min(selStart ?? 0, body.length))
    const to = Math.max(from, Math.min(selEnd ?? 0, body.length))
    const phrase = body.slice(from, to)
    if (!phrase) return null

    const url = buildApUrl(targetPaperId, blockId)
    const newBody = `${body.slice(0, from)}[${phrase}](${url})${body.slice(to)}`
    let newLine = spaces + newBody
    if (apSuffix) newLine = newLine.replace(/\s+$/, '') + apSuffix
    const withSourceAnchor = ensureApBlockId(newLine)
    lines[index] = withSourceAnchor.line

    onChange(lines.join('\n'))
    setFocusedIndex(null)
    return { targetBlockId: blockId, sourceBlockId: withSourceAnchor.blockId }
  }, [onChange])

  const editBlockAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length !== 1) return
    const idx = sel[0]
    const lines = content.split('\n')
    const b = findTableBounds(lines, idx)
    setFocusedIndex(b ? b.start : idx)
    setSelectedIndices(new Set())
    closeBlockMenu()
  }, [blockMenu, closeBlockMenu, content])

  const editTableAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length !== 1) return
    const idx = sel[0]
    const lines = content.split('\n')
    const t = getBlockType(lines[idx] || '')
    if (t !== 'table-row' && t !== 'table-separator') return
    const bounds = findTableBounds(lines, idx)
    if (!bounds) return
    // Lock editing target to this table head so dialog "Apply" updates same table.
    setFocusedIndex(bounds.start)
    setSelectionAnchor(bounds.start)
    setSelectedIndices(new Set([bounds.start]))
    const cols = (parseTableRow(lines[bounds.start]) || []).length
    const rows = Math.max(1, bounds.end - bounds.start)
    onTableEditRequest?.({ rows, cols, mode: 'edit' })
    closeBlockMenu()
  }, [blockMenu, content, onTableEditRequest, closeBlockMenu])

  const goToSourceAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length !== 1) return
    onGoToSource?.({ lineIndex: sel[0] })
    closeBlockMenu()
  }, [blockMenu, onGoToSource, closeBlockMenu])

  const copyBlockAtMenu = useCallback(async () => {
    const sel = blockMenu?.selection
    if (!sel?.length) return
    const lines = content.split('\n')
    const text = [...sel].sort((a, b) => a - b).map((i) => stripApBlockId(lines[i] ?? '')).join('\n')
    
    closeBlockMenu()
    // In QtWebEngine (Anki), navigator.clipboard and window.isSecureContext are
    // both unreliable. Always use the execCommand path; just force focus first.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, ta.value.length) // iOS + QtWebEngine belt-and-suspenders
    try { document.execCommand('copy') } catch (err) { console.error('copy failed', err) }
    document.body.removeChild(ta)
  }, [blockMenu, content, closeBlockMenu])

  /**
   * Insert the clipboard's lines as blocks BELOW the selection.
   *
   * Non-destructive on purpose: it never overwrites what you right-clicked,
   * matching "Duplicate below". Any hidden <!--ap:…--> anchors are stripped so
   * a pasted copy can never claim the same link anchor as the line it came
   * from (Copy strips them too — this is belt-and-braces for text pasted in
   * from elsewhere).
   */
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify

  /** Insert `text` as blocks directly below the last selected block. */
  const pasteLinesBelow = useCallback((text, selection) => {
    const cleaned = String(text || '').replace(/\r\n/g, '\n').replace(/\n+$/, '')
    if (!cleaned || !selection || !selection.length) return false
    const lines = contentRef.current.split('\n')
    const sorted = [...selection].sort((a, b) => a - b)
    const insertAt = Math.min(lines.length, sorted[sorted.length - 1] + 1)
    const pasted = cleaned.split('\n').map((l) => stripApBlockId(l))
    lines.splice(insertAt, 0, ...pasted)
    onChange(lines.join('\n'))
    setSelectedIndices(new Set())
    setFocusedIndex(null)
    return true
  }, [onChange])

  // ⌘V / Ctrl+V with whole blocks selected pastes them below the selection.
  //
  // This listens for the real paste EVENT on the window rather than reading
  // the clipboard on demand: the event carries the data with it, so it works
  // even where programmatic clipboard reads are blocked. It deliberately does
  // nothing while a block's textarea has focus, so ordinary text pasting into
  // a line is untouched.
  const selectedIndicesRef = useRef(selectedIndices)
  selectedIndicesRef.current = selectedIndices
  useEffect(() => {
    const onWindowPaste = (e) => {
      const sel = selectedIndicesRef.current
      if (!sel || sel.size === 0) return
      const active = document.activeElement
      if (active && active.classList && active.classList.contains('block-input')) return
      const text = e.clipboardData?.getData('text/plain') || ''
      if (!text) return
      e.preventDefault()
      pasteLinesBelow(text, [...sel])
    }
    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [pasteLinesBelow])

  const pasteBlocksAtMenu = useCallback(async () => {
    const sel = blockMenu?.selection
    closeBlockMenu()
    if (!sel?.length) return
    // Reading the clipboard programmatically is unreliable inside Anki's
    // webview, so try the Qt bridge, then the web API, and if neither can
    // read it, SAY so and point at the keystroke — which always works,
    // because a real paste event carries the data with it.
    let text = ''
    try {
      const res = await getClipboardText()
      text = (res && res.text) || ''
    } catch { /* fall through */ }
    if (!text) {
      try { text = (await navigator.clipboard.readText()) || '' } catch { /* fall through */ }
    }
    if (!text) {
      notifyRef.current?.(`Couldn't read the clipboard — press ${PASTE_HINT} instead`, 'error')
      return
    }
    pasteLinesBelow(text, sel)
  }, [blockMenu, closeBlockMenu, pasteLinesBelow])

  const duplicateBlockAtMenu = useCallback(() => {
  const sel = blockMenu?.selection
  if (!sel?.length) return
  const lines = content.split('\n')
  const sorted = [...sel].sort((a, b) => a - b)
  
  // FIX: Strip the ID so the new block generates a fresh Anki Note
  const slice = sorted.map((i) => stripApBlockId(lines[i] ?? ''))
  
  const insertAt = sorted[sorted.length - 1] + 1
  lines.splice(insertAt, 0, ...slice)
  onChange(lines.join('\n'))
  setSelectedIndices(new Set())
  setFocusedIndex(null)
  closeBlockMenu()
}, [blockMenu, content, onChange, closeBlockMenu])

  const mergeBlocksAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length < 2) return
    const lines = content.split('\n')
    const sorted = [...sel].sort((a, b) => a - b)
    const keep = sorted[0]
    const keepSuf = extractApBlockSuffix(lines[keep] ?? '')
    const merged = sorted.map((i) => stripApBlockId(lines[i] ?? '')).join(' ').replace(/\s+/g, ' ').trim()
    const mergedLine = keepSuf ? merged.replace(/\s+$/, '') + keepSuf : merged
    const toRemove = sorted.slice(1).sort((a, b) => b - a)
    toRemove.forEach((i) => lines.splice(i, 1))
    lines[keep] = mergedLine
    onChange(lines.join('\n'))
    setSelectedIndices(new Set())
    setFocusedIndex(keep)
    closeBlockMenu()
  }, [blockMenu, content, onChange, closeBlockMenu])

  const deleteBlockAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel?.length) return
    const lines = content.split('\n')
    
    let indicesToRemove = new Set()
    sel.forEach(idx => {
       const { start, end } = getBlockRangeAndIndent(lines, idx)
       for (let i = start; i <= end; i++) {
          indicesToRemove.add(i)
       }
    })

    const sortedDesc = [...indicesToRemove].sort((a, b) => b - a)
    sortedDesc.forEach((i) => lines.splice(i, 1))

    if (lines.length === 0) {
      onChange('')
      setFocusedIndex(0)
      setSelectedIndices(new Set())
      closeBlockMenu()
      return
    }

    onChange(lines.join('\n'))
    const minIdx = Math.min(...sel)
    setFocusedIndex(Math.min(minIdx, lines.length - 1))
    setSelectedIndices(new Set())
    closeBlockMenu()
  }, [blockMenu, content, onChange, closeBlockMenu])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || blockMenu) return
      setSelectedIndices((prev) => (prev.size ? new Set() : prev))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blockMenu])

  useEffect(() => {
    if (!blockMenu || !containerRef.current) return
    const el = containerRef.current
    const onScroll = () => closeBlockMenu()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [blockMenu, closeBlockMenu])

  const handlePaste = useCallback(async (e) => {
    const items = Array.from((e.clipboardData ?? e.nativeEvent?.clipboardData)?.items ?? [])
    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault()
        const result = await pasteImage()
        if (result.markdown) {
          const lines = content.split('\n')
          if (focusedIndex !== null) {
            const tableBounds = findTableBounds(lines, focusedIndex)
            const tableHead = tableBounds && tableBounds.start === focusedIndex
            
            let apSuffix = ''
            let fullText = tableHead
              ? lines.slice(tableBounds.start, tableBounds.end + 1).join('\n')
              : (() => {
                  const full = lines[focusedIndex]
                  apSuffix = extractApBlockSuffix(full)
                  return stripApBlockId(full)
                })()

            const spacesMatch = fullText.match(/^[ \t]*/)
            const leadingSpaces = tableHead ? '' : (spacesMatch ? spacesMatch[0] : '')
            let actualText = tableHead ? fullText : fullText.slice(leadingSpaces.length)

            const input = activeBlockInputRef.current
            let selStart = 0
            let selEnd = 0
            if (input && typeof input.selectionStart === 'number') {
              selStart = input.selectionStart
              selEnd = input.selectionEnd
            }

            const before = actualText.slice(0, selStart)
            const after = actualText.slice(selEnd)
            actualText = before + result.markdown + after

            const storeLine = (s) => (apSuffix ? s.replace(/\s+$/, '') + apSuffix : s)
            const newLine = tableHead ? actualText : leadingSpaces + actualText

            if (tableHead) {
              lines.splice(tableBounds.start, tableBounds.end - tableBounds.start + 1, ...newLine.split('\n'))
            } else {
              lines[focusedIndex] = storeLine(newLine)
            }
            
            onChange(lines.join('\n'))
            
            const pos = selStart + result.markdown.length
            scheduleRestoreSelection(activeBlockInputRef, pos, pos)
          } else {
            lines.push(result.markdown)
            onChange(lines.join('\n'))
            setFocusedIndex(lines.length - 1)
          }
        }
        return
      }
    }
    // ── Plain-text paste with newline splitting ──────────────────────────
    // Only intercept when a block textarea is focused; otherwise let the
    // browser handle it so native undo inside a focused textarea is preserved.
    if (focusedIndex === null) return
    const plainItem = Array.from(
      (e.clipboardData || e.originalEvent?.clipboardData)?.items ?? []
    ).find(it => it.type === 'text/plain')
    if (!plainItem) return
    plainItem.getAsString((pastedText) => {
      if (!pastedText.includes('\n')) return // single-line: let browser handle it natively
      e.preventDefault()
      const lines = content.split('\n')
      const input = activeBlockInputRef.current
      const cursorPos = input ? input.selectionStart ?? 0 : 0
      const cursorEnd = input ? input.selectionEnd ?? cursorPos : cursorPos

      const full = lines[focusedIndex] ?? ''
      const apSuf = extractApBlockSuffix(full)
      const display = stripApBlockId(full)
      const spacesMatch = display.match(/^[ \t]*/)
      const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
      const actualText = display.slice(leadingSpaces.length)

      const beforeCursor = actualText.slice(0, cursorPos)
      const afterCursor = actualText.slice(cursorEnd)

      const pastedLines = pastedText.split('\n')
      // First pasted segment is appended to the current block's text before cursor
      const firstSegment = leadingSpaces + beforeCursor + pastedLines[0]
      // Last pasted segment gets the text that was after the cursor
      const lastSegment = leadingSpaces + pastedLines[pastedLines.length - 1] + afterCursor

      const newLines = [
        apSuf ? firstSegment.replace(/\s+$/, '') + apSuf : firstSegment,
        ...pastedLines.slice(1, -1).map(seg => leadingSpaces + seg),
        lastSegment,
      ]

      lines.splice(focusedIndex, 1, ...newLines)
      onChange(lines.join('\n'))
      // Move focus to the end of the last inserted segment
      const newFocusIndex = focusedIndex + newLines.length - 1
      const newCursorPos = leadingSpaces.length + pastedLines[pastedLines.length - 1].length + afterCursor.length
      setTimeout(() => { 
        setFocusedIndex(newFocusIndex)
        scheduleRestoreSelection(activeBlockInputRef, newCursorPos, newCursorPos)
      }, 10)
    })
  }, [content, onChange, focusedIndex])

  // Apply formatting to focused block
  const applyFormat = useCallback((action, extra) => {
    if (focusedIndex === null) {
      // No block has been focused yet (e.g. image inserted before clicking
      // into the editor) — fall back to appending at the end instead of
      // silently doing nothing.
      if (action === 'insertImageMd' && extra) {
        const lines = content.split('\n')
        lines.push(extra)
        onChange(lines.join('\n'))
      }
      return
    }
    const lines = content.split('\n')
    const focusedTable = findTableBounds(lines, focusedIndex)
    const tableHead = focusedTable && focusedTable.start === focusedIndex
    let apSuffix = ''
    let fullText = tableHead
      ? lines.slice(focusedTable.start, focusedTable.end + 1).join('\n')
      : (() => {
          const full = lines[focusedIndex]
          apSuffix = extractApBlockSuffix(full)
          return stripApBlockId(full)
        })()
        
    const spacesMatch = fullText.match(/^[ \t]*/)
    const leadingSpaces = tableHead ? '' : (spacesMatch ? spacesMatch[0] : '')
    let line = tableHead ? fullText : fullText.slice(leadingSpaces.length)

    const input = activeBlockInputRef.current
    let selStart = 0
    let selEnd = 0
    if (input && typeof input.selectionStart === 'number') {
      selStart = input.selectionStart
      selEnd = input.selectionEnd
    }

    const storeLine = (s) => (apSuffix ? s.replace(/\s+$/, '') + apSuffix : s)

    const applyWrap = (prefix, suffix, emptyPh) => {
      const r = wrapLineSegment(line, selStart, selEnd, prefix, suffix, emptyPh)
      const newLine = tableHead ? r.line : leadingSpaces + r.line
      if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
      else lines[focusedIndex] = storeLine(newLine)
      onChange(lines.join('\n'))
      scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
    }

    switch (action) {
      case 'bold':
        applyWrap('**', '**', 'text')
        return
      case 'italic':
        applyWrap('*', '*', 'text')
        return
      case 'strikethrough':
        applyWrap('~~', '~~', 'text')
        return
      case 'inlineCode':
        applyWrap('`', '`', 'code')
        return
      case 'math': {
        const r = wrapLineSegment(line, selStart, selEnd, '$', '$', 'x^2')
        const newLine = tableHead ? r.line : leadingSpaces + r.line
        if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
        else lines[focusedIndex] = storeLine(newLine)
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        return
      }
      case 'cloze': {
        const hasSel = selStart !== selEnd
        if (hasSel) {
          const r = wrapLineSegment(line, selStart, selEnd, '{{', '}}', 'cloze text')
          const newLine = tableHead ? r.line : leadingSpaces + r.line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        } else {
          line = line + ' {{cloze text}}'
          const newLine = tableHead ? line : leadingSpaces + line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
        }
        return
      }
      case 'multiCloze': {
        const next = getNextClozeNumberInLine(line)
        if (selStart !== selEnd) {
          const selected = line.slice(selStart, selEnd)
          const before = line.slice(0, selStart)
          const after = line.slice(selEnd)
          const inserted = `{{c${next}::${selected}}}`
          line = before + inserted + after
          const newLine = tableHead ? line : leadingSpaces + line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          const caret = before.length + inserted.length
          scheduleRestoreSelection(activeBlockInputRef, caret, caret)
        } else {
          const snippet = `{{c${next}::cloze text}}`
          line = line ? `${line} ${snippet}` : snippet
          const newLine = tableHead ? line : leadingSpaces + line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
        }
        return
      }
      case 'insertTable': {
        lines.splice(
          focusedIndex + 1,
          0,
          leadingSpaces + '| Column 1 | Column 2 |',
          leadingSpaces + '| --- | --- |',
          leadingSpaces + '| Value 1 | Value 2 |'
        )
        onChange(lines.join('\n'))
        setFocusedIndex(focusedIndex + 1)
        return
      }
      case 'tableApply': {
        const targetRows = Math.max(1, parseInt(extra?.rows || 2, 10))
        const targetCols = Math.max(1, parseInt(extra?.cols || 2, 10))
        const bounds = findTableBounds(lines, focusedIndex ?? 0)
        if (!bounds) {
          const newBlock = [
            `| ${Array.from({ length: targetCols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`,
            `| ${Array.from({ length: targetCols }, () => '---').join(' | ')} |`,
            ...Array.from({ length: Math.max(0, targetRows - 1) }, (_, r) =>
              `| ${Array.from({ length: targetCols }, (_, c) => `Value ${r + 1}.${c + 1}`).join(' | ')} |`
            ),
          ].map(s => leadingSpaces + s)
          const at = focusedIndex !== null ? focusedIndex + 1 : lines.length
          lines.splice(at, 0, ...newBlock)
          onChange(lines.join('\n'))
          setFocusedIndex(at)
          return
        }

        const current = lines.slice(bounds.start, bounds.end + 1).map((ln) => parseTableRow(ln) || [])
        const currentCols = (parseTableRow(lines[bounds.start]) || []).length
        const currentBodyRows = Math.max(0, bounds.end - (bounds.start + 1))
        const rebuilt = []
        const header = Array.from({ length: targetCols }, (_, i) => (
          i < currentCols ? (current[0][i] || `Column ${i + 1}`) : `Column ${i + 1}`
        ))
        rebuilt.push(`| ${header.join(' | ')} |`)
        rebuilt.push(`| ${Array.from({ length: targetCols }, () => '---').join(' | ')} |`)
        for (let r = 0; r < Math.max(0, targetRows - 1); r++) {
          const old = r < currentBodyRows ? current[r + 2] : []
          const row = Array.from({ length: targetCols }, (_, c) => (
            c < currentCols ? (old[c] || `Value ${r + 1}.${c + 1}`) : `Value ${r + 1}.${c + 1}`
          ))
          rebuilt.push(`| ${row.join(' | ')} |`)
        }
        lines.splice(bounds.start, bounds.end - bounds.start + 1, ...rebuilt)
        onChange(lines.join('\n'))
        setFocusedIndex(bounds.start)
        return
      }
      case 'tableAddRow': {
        const bounds = findTableBounds(lines, focusedIndex)
        if (!bounds) return
        const headerCells = parseTableRow(lines[bounds.start]) || []
        const newRow = `| ${headerCells.map((_, i) => `Value ${i + 1}`).join(' | ')} |`
        const insertAt = Math.max(focusedIndex + 1, bounds.start + 2)
        lines.splice(insertAt, 0, newRow)
        onChange(lines.join('\n'))
        setFocusedIndex(insertAt)
        return
      }
      case 'tableAddColumn': {
        const bounds = findTableBounds(lines, focusedIndex)
        if (!bounds) return
        for (let i = bounds.start; i <= bounds.end; i++) {
          const cells = parseTableRow(lines[i])
          if (!cells) continue
          if (i === bounds.start) cells.push(`Column ${cells.length + 1}`)
          else if (i === bounds.start + 1) cells.push('---')
          else cells.push(`Value ${cells.length + 1}`)
          lines[i] = `| ${cells.join(' | ')} |`
        }
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, 0, 0)
        return
      }
      case 'h1': line = '# ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'h2': line = '## ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'h3': line = '### ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'bullet': line = line.startsWith('- ') ? line.slice(2) : '- ' + line; break
      case 'numbered': line = line.match(/^\d+\.\s/) ? line.replace(/^\d+\.\s/, '') : '1. ' + line; break
      case 'blockquote': line = line.startsWith('> ') ? line.slice(2) : '> ' + line; break
      case 'hr':
        lines.splice(focusedIndex + 1, 0, leadingSpaces + '---')
        onChange(lines.join('\n'))
        return
      case 'codeBlock':
        lines.splice(focusedIndex + 1, 0, leadingSpaces + '```', leadingSpaces + '', leadingSpaces + '```')
        onChange(lines.join('\n'))
        setFocusedIndex(focusedIndex + 2)
        return
      case 'basicCard': line = 'Question >> Answer'; break
      case 'reversibleCard': line = 'Term <> Definition'; break
      case 'insertImageMd':
        if (extra) {
          const before = line.slice(0, selStart)
          const after = line.slice(selEnd)
          line = before + extra + after
          const pos = selStart + extra.length
          lines[focusedIndex] = storeLine(line)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, pos, pos)
        }
        return
      default: break
    }

    if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...line.split('\n'))
    else lines[focusedIndex] = storeLine(line)
    onChange(lines.join('\n'))
    scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
  }, [content, onChange, focusedIndex])

  // Expose applyFormat via ref
  useImperativeHandle(ref, () => ({
    applyFormat,
    getTableContext: () => {
      const lines = content.split('\n')
      const idx = focusedIndex ?? 0
      const bounds = findTableBounds(lines, idx)
      if (!bounds) return null
      const cols = (parseTableRow(lines[bounds.start]) || []).length
      const rows = Math.max(1, bounds.end - bounds.start)
      return { rows, cols }
    },
    focusBlock: (index) => {
      setSelectedIndices(new Set())
      setFocusedIndex(index)
      setTimeout(() => {
        const el = containerRef.current?.children[index]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    },
    revealBlock,
    insertDocLink,
  }), [applyFormat, content, focusedIndex, revealBlock, insertDocLink])

  const multiSelectCount = selectedIndices.size

  const handleEditorMouseDown = (e) => {
    // Only capture background clicks, not input or inner elements
    if (e.target.closest('button, a, [role="button"], .block-input, .block-handle, .block-collapse-btn')) return
    if (e.button === 0) {
      setLasso({ startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY })
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setSelectedIndices(new Set())
        setFocusedIndex(null)
      }
    }
  }

  const allLines = useMemo(() => blocks.map(b => b.line), [blocks])

  return (
    <div className="block-editor" ref={containerRef} onPaste={handlePaste} onMouseDown={handleEditorMouseDown} onClick={(e) => {
      if ((e.target === containerRef.current || e.target.classList.contains('block-editor-pad')) && selectedIndices.size === 0) {
        const lines = content.split('\n')
        if (lines[lines.length - 1].trim() !== '') {
          onChange(content + '\n')
          setTimeout(() => setFocusedIndex(lines.length), 10)
        } else {
          setFocusedIndex(lines.length - 1)
        }
      }
    }}>
      {blocks.map((b, i) => {
        if ((b.type === 'table-row' || b.type === 'table-separator') && !isTableHeadRow(allLines, i)) {
          if (focusedIndex !== i && b.isHidden) return null // Hide nested table rows strictly
          if (focusedIndex !== i) return null
        }
        const bounds = findTableBounds(allLines, i)
        const isTableHead = !!bounds && bounds.start === i
        const displayLine = isTableHead ? allLines.slice(bounds.start, bounds.end + 1).join('\n') : b.line
        const displayType = isTableHead ? 'table' : b.type
        return (
          <div key={b.id} className={`block-row-wrapper ${b.isHidden ? 'block-row-hidden' : 'stagger-in'}`} style={{ animationDelay: `${staggerDelays.get(b.id) ?? 0}ms` }}>
            <div className="block-row-inner">
              <Block
                blockId={b.id}
                line={displayLine}
                type={displayType}
                focused={focusedIndex === i}
                isSelected={selectedIndices.has(i)}
                isRevealed={revealedIndex === i}
                dragDisabled={multiSelectCount > 1}
                onRowClick={handleBlockRowClick}
                onChange={handleBlockChange}
                onKeyDown={handleKeyDown}
                mediaDir={mediaDir}
                onImageResize={handleImageResize}
                noteId={(displayType === 'basic' || displayType === 'reversible' || displayType === 'cloze') ? b.noteId : null}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDragOver={dragOverIndex === i}
                onBlockContextMenu={handleBlockContextMenu}
                onOpenLink={handleOpenLink}
                activeBlockInputRef={activeBlockInputRef}
                hasChildren={b.hasChildren}
                isCollapsed={collapsedKeys.has(b.key)}
                onToggleCollapse={toggleCollapse}
                blockKey={b.key}
                onZettelSearch={handleZettelSearch}
              />
              {zettelSearch?.index === i && (
                 <ZettelkastenSearch 
                    query={zettelSearch.query} 
                    selected={zettelSearch.selected} 
                    papers={papers} 
                 />
              )}
            </div>
          </div>
        )
      })}
      <div className="block-editor-pad" />
      {blockMenu && (
        <BlockContextMenu
          x={blockMenu.x}
          y={blockMenu.y}
          menuRef={blockMenuRef}
          onClose={closeBlockMenu}
          onEdit={editBlockAtMenu}
          onCopy={copyBlockAtMenu}
          onPasteBlocks={pasteBlocksAtMenu}
          onDuplicate={duplicateBlockAtMenu}
          onMerge={mergeBlocksAtMenu}
          onDelete={deleteBlockAtMenu}
          onEditTable={editTableAtMenu}
          onGoToSource={goToSourceAtMenu}
          canEditTable={(() => {
            const sel = blockMenu.selection
            if (!sel || sel.length !== 1) return false
            const idx = sel[0]
            const lines = content.split('\n')
            return !!findTableBounds(lines, idx)
          })()}
          canGoToSource={blockMenu.selection?.length === 1}
          onCreateLink={createLinkAtMenu}
          canCreateLink={!!blockMenu.textSel?.text}
          createLinkHint={
            blockMenu.textSel?.text
              ? ''
              : 'Click into the line, highlight a phrase, then right-click it'
          }
          selectionCount={blockMenu.selection?.length ?? 1}
        />
      )}
      {lasso && (
        <div
          className="lasso-selection-box"
          style={{
            position: 'fixed',
            top: Math.min(lasso.startY, lasso.curY),
            left: Math.min(lasso.startX, lasso.curX),
            width: Math.abs(lasso.curX - lasso.startX),
            height: Math.abs(lasso.curY - lasso.startY),
            backgroundColor: 'rgba(116, 185, 255, 0.25)',
            border: '1px solid rgba(116, 185, 255, 0.5)',
            pointerEvents: 'none',
            zIndex: 9999
          }}
        />
      )}
    </div>
  )
})

export default BlockEditor
