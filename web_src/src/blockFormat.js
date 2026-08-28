/**
 * Block parsing and inline formatting — the single definition of how an
 * AnkiPapers document turns into HTML.
 *
 * This used to live inside BlockEditor.jsx, which meant the PDF exporter had
 * its own separate implementation in gui/bridge.py. The two drifted: the
 * exporter printed "dyspepsia::epigastric sx" instead of the hint form, showed
 * raw ap:// markup, discarded indentation, and — because it never escaped HTML
 * — silently deleted the rest of any line containing a "<" followed by a
 * letter ("Ferritin <normal range ..." printed as "Ferritin").
 *
 * Both the editor and the exporter now import from here, so the two views of a
 * document cannot disagree.
 */
import { AP_LINK_RE } from './docLinks'

// ─── Block type detection ───────────────────────────
export function getBlockType(line) {
  const t = line.trim()
  if (!t) return 'empty'
  if (/^\|(?:[^|]*\|)+\s*$/.test(t) && /\|/.test(t.slice(1, -1))) {
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t)) return 'table-separator'
    return 'table-row'
  }
  if (t.match(/^#{1,6}\s/)) return 'heading'
  if (t.match(/^```/)) return 'code-fence'
  if (t.match(/^---$|^\*\*\*$|^___$/)) return 'divider'
  if (t.match(/^>\s/)) return 'blockquote'
  const stripped = t.replace(/^\s*[-*]\s+/, '')
  if (stripped.match(/^.+?\s*<>\s*.+$/)) return 'reversible'
  if (stripped.match(/^.+?\s*>>\s*.+$/)) return 'basic'
  if (t.match(/\{\{.+?\}\}/)) return 'cloze'
  if (t.match(/^https?:\/\/[^\s]+$/)) return 'link-preview'
  if (t.match(/^!\[/)) return 'image'
  if (t.match(/^\s*[-*]\s+/)) return 'bullet'
  if (t.match(/^\s*\d+\.\s+/)) return 'numbered'
  return 'text'
}

export function parseTableRow(line) {
  const t = (line || '').trim()
  if (!(t.startsWith('|') && t.endsWith('|'))) return null
  return t.slice(1, -1).split('|').map((c) => c.trim())
}

export function isTableSeparatorRow(line) {
  const cells = parseTableRow(line)
  if (!cells || cells.length < 2) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

/**
 * An image's markdown source turned into a URL the webview can load.
 *
 * A bare filename in a document means "a file in Anki's collection.media
 * folder"; anything already carrying a scheme is passed through untouched.
 *
 * This lives here, exported, because the same four lines used to be written
 * out three times — in the editor's block-image branch, in formatInlineRaw
 * below, and in the PDF exporter. The exporter's copy was the one that was
 * missing, so an image on its own line printed as a broken-image icon while
 * the identical image inside a sentence printed fine. One definition now.
 */
export function resolveMediaSrc(src, mediaDir) {
  const s = String(src ?? '')
  if (!mediaDir) return s
  if (s.startsWith('http') || s.startsWith('file://') || s.startsWith('data:')) return s
  return `file:///${mediaDir}/${s}`
}

export function formatInlineRaw(text, mediaDir) {
  let r = text
    .replace(/&/g, '&amp;')
  // Images inline — must run before < > escaping
  r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    let width = ''
    const wm = alt.match(/^(.+?)\|(\d+)$/)
    if (wm) {
      alt = wm[1]
      width = ` style="max-width:${wm[2]}px"`
    }
    src = resolveMediaSrc(src, mediaDir)
    return `<img src="${src}" alt="${alt}" class="inline-img"${width} />`
  })
  // Math: $$block$$ and $inline$ — before HTML escaping
  const mathBlocks = []
  r = r.replace(/\$\$(.+?)\$\$/gs, (_, tex) => {
    const idx = mathBlocks.length
    mathBlocks.push(`<span class="math-block" title="Block math">$$${tex}$$</span>`)
    return `\x00MATH${idx}\x00`
  })
  r = r.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, tex) => {
    const idx = mathBlocks.length
    mathBlocks.push(`<span class="math-inline" title="Inline math">$${tex}$</span>`)
    return `\x00MATH${idx}\x00`
  })
  // Escape HTML (after images and math extracted)
  r = r.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Restore img tags
  r = r.replace(/&lt;img /g, '<img ').replace(/\/&gt;/g, '/>')
  // Restore math placeholders
  mathBlocks.forEach((html, i) => { r = r.replace(`\x00MATH${i}\x00`, html) })
  // Cloze numbered. A cloze may carry a hint after a second "::", e.g.
  // {{c1::.title()::string method}}. Anki shows that hint as "[string method]"
  // while you review, so show it the same way here instead of printing the
  // raw "::" separator in the middle of the phrase.
  r = r.replace(/\{\{(c\d+)::(.+?)\}\}/g, (_m, num, body) => {
    const at = body.indexOf('::')
    const text = at === -1 ? body : body.slice(0, at)
    const hint = at === -1 ? '' : body.slice(at + 2)
    return `<span class="cloze-badge">${num}</span><span class="cloze-text">${text}</span>`
      + (hint ? ` <span class="cloze-hint">[${hint}]</span>` : '')
  })
  // Cloze simple
  r = r.replace(/\{\{([^}:]+?)\}\}/g, '<span class="cloze-badge">c</span><span class="cloze-text">$1</span>')
  // Bold
  r = r.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  r = r.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // Strikethrough
  r = r.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Inline code
  r = r.replace(/`([^`]+?)`/g, '<code>$1</code>')
  // Zettelkasten links
  r = r.replace(/\[\[(.+?)\]\]/g, '<span class="block-zettel-link" data-title="$1">[[$1]]</span>')
  // Document links: [text](ap://paperId#blockId)
  r = r.replace(AP_LINK_RE, (_m, text, target) => {
    const safe = String(target).replace(/["'<>]/g, '')
    return `<span class="ap-link" data-ap-target="${safe}" title="Double-click to open">${text}</span>`
  })
  return r
}
