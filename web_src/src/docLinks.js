/**
 * Document links: a phrase in one paper pointing at a header (or a whole
 * document) in another.
 *
 * ── Addressing ───────────────────────────────────────────────────────────
 * A link is stored inline in the markdown as:
 *
 *     [typical atrial flutter](ap://<paperId>#<blockId>)   → a header
 *     [see the flutter page](ap://<paperId>)               → a whole document
 *
 * The `blockId` is a stable per-line anchor written into the line itself as a
 * hidden `<!--ap:uuid-->` suffix — the same mechanism the card generator
 * already uses to keep an Anki note attached to its line. Anchors survive
 * editing the header's text, reordering, indenting and drag-and-drop, because
 * they travel with the line. (Copy and Duplicate deliberately strip them, so
 * two lines can never claim the same anchor.)
 *
 * `paperId` is only a fast-path hint. Resolution falls back to a global search
 * for the anchor, so a header that is later moved into a different document
 * still resolves.
 */

// Hidden stable-id suffix on a line: "<!--ap:uuid-->" at end of line.
export const AP_BLOCK_ID_TAIL = /\s*<!--ap:[0-9a-f-]{36}-->\s*$/i

export function stripApBlockId(line) {
  return (line ?? '').replace(AP_BLOCK_ID_TAIL, '')
}

export function extractApBlockSuffix(line) {
  const m = (line ?? '').match(AP_BLOCK_ID_TAIL)
  return m ? m[0] : ''
}

export function mergeEditedWithApSuffix(editedBody, originalLine) {
  const suf = extractApBlockSuffix(originalLine)
  if (!suf) return editedBody ?? ''
  return `${(editedBody ?? '').replace(/\s+$/, '')}${suf}`
}

/** The uuid inside a line's anchor suffix, or '' when the line has none. */
export function getApBlockId(line) {
  const m = (line ?? '').match(/<!--ap:([0-9a-f-]{36})-->\s*$/i)
  return m ? m[1].toLowerCase() : ''
}

function uuid4() {
  // crypto.randomUUID isn't available in every QtWebEngine build.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Return { line, blockId } for a line guaranteed to carry an anchor,
 * minting one only when the line doesn't already have it.
 */
export function ensureApBlockId(line) {
  const existing = getApBlockId(line)
  if (existing) return { line, blockId: existing, changed: false }
  const blockId = uuid4()
  const body = (line ?? '').replace(/\s+$/, '')
  return { line: `${body}<!--ap:${blockId}-->`, blockId, changed: true }
}

// ── Link syntax ──────────────────────────────────────────────────────────
// Matches [text](ap://target). The (?<!!) guard keeps ![alt](src) images from
// ever being read as links.
export const AP_LINK_RE = /(?<!!)\[([^\][]+)\]\(ap:\/\/([^)\s]+)\)/g

export function buildApUrl(paperId, blockId) {
  return blockId ? `ap://${paperId}#${blockId}` : `ap://${paperId}`
}

export function buildApLink(text, paperId, blockId) {
  return `[${text}](${buildApUrl(paperId, blockId)})`
}

/** "paperId#blockId" → { paperId, blockId }  ("" blockId means whole document) */
export function parseApTarget(target) {
  const raw = String(target || '').replace(/^ap:\/\//, '')
  const hash = raw.indexOf('#')
  if (hash === -1) return { paperId: raw, blockId: '' }
  return { paperId: raw.slice(0, hash), blockId: raw.slice(hash + 1).toLowerCase() }
}

/** Every link found in a paper's content, with the line each one sits on. */
export function extractLinks(content) {
  const out = []
  const lines = String(content || '').split('\n')
  lines.forEach((line, lineIndex) => {
    const re = new RegExp(AP_LINK_RE.source, 'g')
    let m
    while ((m = re.exec(line)) !== null) {
      const { paperId, blockId } = parseApTarget(m[2])
      out.push({
        text: m[1],
        target: m[2],
        targetPaperId: paperId,
        targetBlockId: blockId,
        lineIndex,
        sourceBlockId: getApBlockId(line),
      })
    }
  })
  return out
}

/** Index of the line carrying `blockId`, or -1. */
export function findAnchorLine(content, blockId) {
  if (!blockId) return -1
  const needle = `<!--ap:${blockId.toLowerCase()}-->`
  const lines = String(content || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) return i
  }
  return -1
}

/**
 * Resolve a link target against the known papers.
 *
 * Two-tier on purpose: try the paperId hint first (fast, and correct almost
 * always), then fall back to scanning every paper for the anchor so a header
 * that has since been moved to another document still resolves.
 *
 * Returns { paperId, lineIndex } or null when the target no longer exists.
 * lineIndex is -1 for a whole-document link.
 */
export function resolveApTarget(target, papers) {
  const { paperId, blockId } = parseApTarget(target)
  const list = Array.isArray(papers) ? papers : []

  if (!blockId) {
    const paper = list.find((p) => p.id === paperId)
    return paper ? { paperId: paper.id, lineIndex: -1 } : null
  }

  const hinted = list.find((p) => p.id === paperId)
  if (hinted) {
    const idx = findAnchorLine(hinted.content, blockId)
    if (idx !== -1) return { paperId: hinted.id, lineIndex: idx }
  }
  for (const p of list) {
    if (hinted && p.id === hinted.id) continue
    const idx = findAnchorLine(p.content, blockId)
    if (idx !== -1) return { paperId: p.id, lineIndex: idx }
  }
  return null
}

// ── Link targets: headers and whole documents ────────────────────────────
// One index serves the picker (step 2), backlinks (step 4) and the graph
// (step 5), so there is a single definition of "what can be linked to".

const HEADER_RE = /^(#{1,6})\s+(.+)$/

/** Replace [phrase](ap://…) with just the phrase, for display contexts. */
export function stripApLinkSyntax(text) {
  return String(text || '').replace(AP_LINK_RE, '$1')
}

/**
 * Every linkable target across all papers:
 *   - each 1st/2nd/3rd degree header, with its ancestor chain
 *   - each document as a whole
 * `ancestors` is what lets the picker show
 *   Cardiology › Electrophysiology › SVT › Atrial Flutter › Typical
 */
export function buildTargetIndex(papers) {
  const out = []
  for (const paper of papers || []) {
    const folderPath = paper.folder_path || ''
    out.push({
      key: `doc:${paper.id}`,
      paperId: paper.id,
      paperTitle: paper.title || 'Untitled',
      folderPath,
      lineIndex: -1,
      level: 0,
      text: paper.title || 'Untitled',
      ancestors: [],
      isDocument: true,
      blockId: '',
    })

    const lines = String(paper.content || '').split('\n')
    const stack = [] // [{ level, text }]
    lines.forEach((raw, lineIndex) => {
      const m = stripApBlockId(raw).trim().match(HEADER_RE)
      if (!m) return
      const level = m[1].length
      // A header can itself contain a link now; show its phrase, not markdown.
      const text = stripApLinkSyntax(m[2].trim())
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      out.push({
        key: `${paper.id}:${lineIndex}`,
        paperId: paper.id,
        paperTitle: paper.title || 'Untitled',
        folderPath,
        lineIndex,
        level,
        text,
        ancestors: stack.map((s) => s.text),
        isDocument: false,
        blockId: getApBlockId(raw),
      })
      stack.push({ level, text })
    })
  }
  return out
}

/** Full breadcrumb for display: folders › paper › ancestor headers. */
export function targetBreadcrumb(t) {
  const parts = []
  if (t.folderPath) parts.push(...t.folderPath.split('/').filter(Boolean))
  parts.push(t.paperTitle)
  if (!t.isDocument) parts.push(...t.ancestors)
  return parts
}

/**
 * Rank targets against a query. Ordering favours, in order: an exact match,
 * then a match at the start of the header, then any match; headers outrank
 * whole documents, and shallower headers outrank deeper ones, so searching
 * "atrial flutter" surfaces the H1 before its sub-sub-headers.
 */
export function searchTargets(index, query, limit = 60) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) {
    return index.filter((t) => t.isDocument || t.level <= 2).slice(0, limit)
  }
  const scored = []
  for (const t of index) {
    const text = t.text.toLowerCase()
    let score = -1
    if (text === q) score = 0
    else if (text.startsWith(q)) score = 1
    else if (text.includes(q)) score = 2
    else if (targetBreadcrumb(t).join(' / ').toLowerCase().includes(q)) score = 4
    if (score < 0) continue
    if (t.isDocument) score += 0.5
    score += Math.max(0, t.level - 1) * 0.1
    scored.push({ t, score })
  }
  scored.sort((a, b) => a.score - b.score || a.t.text.length - b.t.text.length)
  return scored.slice(0, limit).map((s) => s.t)
}

// ── The derived link index ───────────────────────────────────────────────
// Markdown is the single source of truth; this index is rebuilt from it.
// There is deliberately no separate link table to fall out of sync with the
// text. Backlinks (step 4) and the graph (step 5) both read this.

/** Header text at a line, without the leading #s or the hidden anchor. */
export function headerTextAt(content, lineIndex) {
  const lines = String(content || '').split('\n')
  const raw = lines[lineIndex]
  if (raw == null) return ''
  const t = stripApBlockId(raw).trim()
  const m = t.match(HEADER_RE)
  return stripApLinkSyntax(m ? m[2].trim() : t)
}

/**
 * Every link in the corpus, resolved against the papers.
 *
 * Each entry knows BOTH endpoints precisely — the source line (and its own
 * anchor) and the resolved target — which is what lets the graph draw an edge
 * between two specific ideas rather than just two documents.
 */
export function collectLinks(papers) {
  const list = Array.isArray(papers) ? papers : []
  const byId = new Map(list.map((p) => [p.id, p]))
  const out = []

  for (const paper of list) {
    for (const link of extractLinks(paper.content)) {
      const resolved = resolveApTarget(link.target, list)
      const targetPaper = resolved ? byId.get(resolved.paperId) : null
      out.push({
        id: `${paper.id}:${link.lineIndex}:${link.text}`,
        phrase: link.text,
        sourcePaperId: paper.id,
        sourcePaperTitle: paper.title || 'Untitled',
        sourceLineIndex: link.lineIndex,
        sourceBlockId: link.sourceBlockId,
        sourceLineText: stripApBlockId(
          String(paper.content || '').split('\n')[link.lineIndex] || ''
        ).trim(),
        targetPaperId: resolved ? resolved.paperId : link.targetPaperId,
        targetPaperTitle: targetPaper ? (targetPaper.title || 'Untitled') : '',
        targetLineIndex: resolved ? resolved.lineIndex : -1,
        targetBlockId: link.targetBlockId,
        targetLabel: !resolved
          ? ''
          : resolved.lineIndex >= 0
            ? headerTextAt(targetPaper?.content, resolved.lineIndex)
            : (targetPaper?.title || 'Untitled'),
        isDocumentLink: !link.targetBlockId,
        dangling: !resolved,
        rawTarget: link.target,
      })
    }
  }
  return out
}

/** Links pointing AT this paper — "what links here". */
export function backlinksFor(links, paperId) {
  return links.filter((l) => !l.dangling && l.targetPaperId === paperId)
}

/** Links leaving this paper. */
export function outgoingFrom(links, paperId) {
  return links.filter((l) => l.sourcePaperId === paperId)
}

/**
 * Nodes and edges for the graph view.
 *
 * mode 'documents' — one node per document; parallel links between the same
 *   pair are merged into a single weighted edge.
 * mode 'headers'   — documents plus every header that is actually linked to,
 *   with a faint "contains" edge back to its document, so you can see which
 *   part of a document is being cited.
 */
export function buildGraph(papers, links, mode = 'documents') {
  const list = Array.isArray(papers) ? papers : []
  const nodes = new Map()
  const edges = new Map()

  const addNode = (id, props) => {
    if (!nodes.has(id)) nodes.set(id, { id, degree: 0, ...props })
    return nodes.get(id)
  }
  const addEdge = (from, to, kind) => {
    if (from === to) return
    const key = `${kind}:${from}->${to}`
    const existing = edges.get(key)
    if (existing) { existing.weight += 1; return existing }
    const e = { key, from, to, kind, weight: 1 }
    edges.set(key, e)
    return e
  }

  for (const p of list) {
    addNode(`doc:${p.id}`, {
      kind: 'document',
      label: p.title || 'Untitled',
      paperId: p.id,
      folderPath: p.folder_path || '',
      lineIndex: -1,
    })
  }

  for (const l of links) {
    if (l.dangling) continue
    const srcId = `doc:${l.sourcePaperId}`
    if (!nodes.has(srcId)) continue

    if (mode === 'headers' && !l.isDocumentLink && l.targetLineIndex >= 0) {
      const hId = `hdr:${l.targetPaperId}:${l.targetLineIndex}`
      addNode(hId, {
        kind: 'header',
        label: l.targetLabel || 'Untitled section',
        paperId: l.targetPaperId,
        lineIndex: l.targetLineIndex,
        folderPath: '',
      })
      addEdge(hId, `doc:${l.targetPaperId}`, 'contains')
      addEdge(srcId, hId, 'link')
    } else {
      addEdge(srcId, `doc:${l.targetPaperId}`, 'link')
    }
  }

  const edgeList = [...edges.values()]
  for (const e of edgeList) {
    if (e.kind !== 'link') continue
    const a = nodes.get(e.from), b = nodes.get(e.to)
    if (a) a.degree += e.weight
    if (b) b.degree += e.weight
  }
  return { nodes: [...nodes.values()], edges: edgeList }
}
