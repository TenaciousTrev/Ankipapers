import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { X, Search, Layers, FileText } from 'lucide-react'
import { collectLinks, buildGraph } from '../docLinks'

/**
 * Graph of how the documents connect.
 *
 * The layout is a small force simulation (repulsion + edge springs + a gentle
 * pull to centre) run on an SVG. Hand-rolled rather than pulled from a
 * charting library so the add-on bundle stays small and there is no runtime
 * dependency to keep working inside Anki's webview.
 */
export default function GraphView({ papers, currentPaperId, onOpen, onClose }) {
  const [mode, setMode] = useState('documents')
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [, setTick] = useState(0)

  const svgRef = useRef(null)
  const simRef = useRef({ nodes: [], edges: [], byId: new Map() })
  const dragRef = useRef(null)
  const panRef = useRef(null)
  const rafRef = useRef(null)

  const links = useMemo(() => collectLinks(papers), [papers])
  const graph = useMemo(() => buildGraph(papers, links, mode), [papers, links, mode])

  // Only show documents that actually participate; an atlas of isolated dots
  // is noise. Documents with no links at all are hidden.
  const visible = useMemo(() => {
    const connected = new Set()
    for (const e of graph.edges) { connected.add(e.from); connected.add(e.to) }
    const nodes = graph.nodes.filter((n) => connected.has(n.id) || n.paperId === currentPaperId)
    const ids = new Set(nodes.map((n) => n.id))
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }
  }, [graph, currentPaperId])

  // ── force simulation ──
  useEffect(() => {
    // Centre on the ACTUAL canvas, not a guess — otherwise the cluster settles
    // in a corner on wide screens.
    const box = svgRef.current?.getBoundingClientRect()
    const W = Math.max(320, box?.width || 900)
    const H = Math.max(240, box?.height || 600)
    const nodes = visible.nodes.map((n, i) => {
      const prev = simRef.current.byId.get(n.id)
      const angle = (i / Math.max(1, visible.nodes.length)) * Math.PI * 2
      return {
        ...n,
        x: prev?.x ?? W / 2 + Math.cos(angle) * (140 + (i % 5) * 26),
        y: prev?.y ?? H / 2 + Math.sin(angle) * (140 + (i % 7) * 22),
        vx: 0, vy: 0, fixed: false,
      }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    simRef.current = { nodes, edges: visible.edges, byId }

    let alpha = 1
    const step = () => {
      const { nodes: ns, edges: es } = simRef.current
      // repulsion
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1 }
          const d = Math.sqrt(d2)
          const rep = 5200 / d2
          const fx = (dx / d) * rep, fy = (dy / d) * rep
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
        }
      }
      // springs
      for (const e of es) {
        const a = byId.get(e.from), b = byId.get(e.to)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const rest = e.kind === 'contains' ? 60 : 150
        const k = e.kind === 'contains' ? 0.06 : 0.03
        const f = (d - rest) * k
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
      }
      // centre + integrate
      for (const n of ns) {
        n.vx += (W / 2 - n.x) * 0.004
        n.vy += (H / 2 - n.y) * 0.004
        if (n.fixed) { n.vx = 0; n.vy = 0; continue }
        n.vx *= 0.82; n.vy *= 0.82
        n.x += Math.max(-24, Math.min(24, n.vx * alpha))
        n.y += Math.max(-24, Math.min(24, n.vy * alpha))
      }
      alpha = Math.max(0.02, alpha * 0.985)
      setTick((t) => (t + 1) % 100000)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [visible])

  // ── pointer interaction ──
  const toLocal = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }
  }, [view])

  const onNodeDown = (e, node) => {
    e.stopPropagation()
    const p = toLocal(e)
    dragRef.current = { id: node.id, dx: node.x - p.x, dy: node.y - p.y, moved: false }
    node.fixed = true
  }
  const onMove = (e) => {
    if (dragRef.current) {
      const n = simRef.current.byId.get(dragRef.current.id)
      if (n) {
        const p = toLocal(e)
        n.x = p.x + dragRef.current.dx
        n.y = p.y + dragRef.current.dy
        dragRef.current.moved = true
      }
      return
    }
    if (panRef.current) {
      setView((v) => ({ ...v, x: panRef.current.ox + (e.clientX - panRef.current.sx), y: panRef.current.oy + (e.clientY - panRef.current.sy) }))
    }
  }
  const onUp = () => {
    if (dragRef.current) {
      const n = simRef.current.byId.get(dragRef.current.id)
      if (n) n.fixed = false
    }
    dragRef.current = null
    panRef.current = null
  }
  const onBgDown = (e) => {
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
  }
  const onWheel = (e) => {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setView((v) => ({ ...v, k: Math.max(0.25, Math.min(3, v.k * factor)) }))
  }

  const q = query.trim().toLowerCase()
  const matches = (n) => q && n.label.toLowerCase().includes(q)
  const neighbours = useMemo(() => {
    if (!hover) return null
    const set = new Set([hover])
    for (const e of visible.edges) {
      if (e.from === hover) set.add(e.to)
      if (e.to === hover) set.add(e.from)
    }
    return set
  }, [hover, visible.edges])

  const { nodes } = simRef.current
  const linkCount = links.filter((l) => !l.dangling).length
  const danglingCount = links.filter((l) => l.dangling).length

  return (
    <div className="graph-backdrop">
      <div className="graph-window">
        <div className="graph-head">
          <span className="graph-title">Link graph</span>
          <div className="graph-modes">
            <button className={mode === 'documents' ? 'is-active' : ''} onClick={() => setMode('documents')}>
              <FileText size={12} /> Documents
            </button>
            <button className={mode === 'headers' ? 'is-active' : ''} onClick={() => setMode('headers')}>
              <Layers size={12} /> Headers
            </button>
          </div>
          <div className="graph-search">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find…" />
          </div>
          <button className="graph-close" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <svg
          ref={svgRef}
          className="graph-svg"
          onMouseDown={onBgDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {visible.edges.map((e) => {
              const a = simRef.current.byId.get(e.from)
              const b = simRef.current.byId.get(e.to)
              if (!a || !b) return null
              const dim = neighbours && !(neighbours.has(e.from) && neighbours.has(e.to))
              return (
                <line
                  key={e.key}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className={`graph-edge ${e.kind === 'contains' ? 'is-contains' : ''} ${dim ? 'is-dim' : ''}`}
                  strokeWidth={e.kind === 'contains' ? 1 : Math.min(5, 1 + e.weight)}
                />
              )
            })}
            {nodes.map((n) => {
              const r = n.kind === 'header' ? 6 : Math.min(20, 9 + Math.sqrt(n.degree) * 2.5)
              const dim = neighbours && !neighbours.has(n.id)
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  className={`graph-node ${n.kind} ${dim ? 'is-dim' : ''} ${matches(n) ? 'is-match' : ''} ${n.paperId === currentPaperId ? 'is-current' : ''}`}
                  onMouseDown={(e) => onNodeDown(e, n)}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragRef.current?.moved) return
                    onOpen(n.paperId, n.lineIndex)
                  }}
                >
                  <circle r={r} />
                  <text y={r + 12} textAnchor="middle">
                    {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="graph-foot">
          <span>{visible.nodes.length} nodes · {linkCount} links{danglingCount ? ` · ${danglingCount} broken` : ''}</span>
          <span>drag to pan · scroll to zoom · drag a node to move it · click to open</span>
        </div>
      </div>
    </div>
  )
}
