import React from 'react'
import { Pencil, Eye, FileDown, FileInput, FileText, PanelRight, Link2, ChevronLeft, ChevronRight } from 'lucide-react'
import FormattingButtons from './FormattingToolbar'

// The one toolbar under the tabs: back/forward, deck picker and formatting
// buttons on the left (the deck picker stretches to fill the row), view
// mode / import-export / panel toggles pinned to the right. The paper is
// renamed from its tab (right-click → Rename), not from here.
export default function EditorHeader({ canBack, canForward, onBack, onForward, deckName, decks, viewMode, showSourcePanel, showLinksPanel, onFormat, onDeckChange, onViewChange, onToggleSource, onToggleLinks, onExportPdf, onExportMarkdown, onImportMarkdown }) {
  return (
    <div className="editor-toolbar">
      <button className="header-icon-btn" title="Back (Ctrl+Alt+←)" aria-label="Back"
        disabled={!canBack} onClick={onBack}>
        <ChevronLeft size={16} />
      </button>
      <button className="header-icon-btn" title="Forward (Ctrl+Alt+→)" aria-label="Forward"
        disabled={!canForward} onClick={onForward}>
        <ChevronRight size={16} />
      </button>

      <div className="fmt-sep" />

      <label className="header-label">Deck:</label>
      <select className="deck-select" value={deckName} title={deckName}
        onChange={e => onDeckChange(e.target.value)}>
        {decks.map(d => <option key={d} value={d}>{d}</option>)}
        {!decks.includes(deckName) && <option value={deckName}>{deckName}</option>}
      </select>

      <div className="fmt-sep" />

      <FormattingButtons onFormat={onFormat} />

      {/* margin-left: auto pushes this group to the right end, and it wraps
          as one unit when the window is too narrow for a single row. */}
      <div className="editor-toolbar-end">
        <div className="fmt-sep" />

        <div className="view-toggle">
          <button className={`view-toggle-btn ${viewMode === 'blocks' ? 'active' : ''}`}
            onClick={() => onViewChange('blocks')}>
            <Eye size={13} />
            <span>Editor</span>
          </button>
          <button className={`view-toggle-btn ${viewMode === 'source' ? 'active' : ''}`}
            onClick={() => onViewChange('source')}>
            <Pencil size={13} />
            <span>Source</span>
          </button>
        </div>

        <div className="fmt-sep" />

        <button className="header-icon-btn" title="Import Markdown" onClick={onImportMarkdown}>
          <FileInput size={16} />
        </button>
        <button className="header-icon-btn" title="Export Markdown" onClick={onExportMarkdown}>
          <FileText size={16} />
        </button>
        <button className="header-icon-btn" title="Export PDF" onClick={onExportPdf}>
          <FileDown size={16} />
        </button>

        <div className="fmt-sep" />

        <button
          className={`header-icon-btn ${showLinksPanel ? 'active' : ''}`}
          title="Links to and from this document"
          onClick={onToggleLinks}
        >
          <Link2 size={16} />
        </button>

        <button
          className={`header-icon-btn ${showSourcePanel ? 'active' : ''}`}
          title="Toggle source panel"
          onClick={onToggleSource}
        >
          <PanelRight size={16} />
        </button>
      </div>
    </div>
  )
}
