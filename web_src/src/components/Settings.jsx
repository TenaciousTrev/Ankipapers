import React, { useState } from 'react'
import { Settings as SettingsIcon, Save, Sun, Moon, HardDrive } from 'lucide-react'
import { exportPapersToDisk } from '../bridge'

export default function Settings({ settings, onSave, onClose }) {
  const [local, setLocal] = useState({ ...settings })
  const update = (key, value) => setLocal(prev => ({ ...prev, [key]: value }))

  // ── Papers on disk (phase 1) ────────────────────────────────────────────
  // Writes a copy of every paper to the Anki profile folder. Nothing reads
  // those files yet — they exist so their contents can be checked against
  // what the collection holds before anything starts depending on them.
  const [diskReport, setDiskReport] = useState(null)
  const [diskBusy, setDiskBusy] = useState(false)
  const runDiskExport = async (mode) => {
    setDiskBusy(true)
    try { setDiskReport(await exportPapersToDisk(mode)) }
    finally { setDiskBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title"><SettingsIcon size={18} /> Settings</div>

        <div className="settings-grid">
          <label className="settings-label">Default Deck</label>
          <input className="modal-input" value={local.default_deck || 'Default'}
            onChange={e => update('default_deck', e.target.value)} />

          <label className="settings-label">Auto-save Interval (seconds)</label>
          <input className="modal-input" type="number" min={5} max={300}
            value={local.auto_save_interval_seconds || 30}
            onChange={e => update('auto_save_interval_seconds', parseInt(e.target.value) || 30)} />

          <label className="settings-label">Editor Font Size</label>
          <input className="modal-input" type="number" min={10} max={24}
            value={local.font_size || 14}
            onChange={e => update('font_size', parseInt(e.target.value) || 14)} />

          <label className="settings-label">Editor Font Family</label>
          <select className="deck-select" style={{ width: '100%', marginBottom: 12 }}
            value={local.font_family || 'JetBrains Mono'}
            onChange={e => update('font_family', e.target.value)}>
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Cascadia Code">Cascadia Code</option>
            <option value="Fira Code">Fira Code</option>
            <option value="Consolas">Consolas</option>
            <option value="Source Code Pro">Source Code Pro</option>
            <option value="monospace">System Monospace</option>
          </select>

          <label className="settings-label">Theme</label>
          <div className="theme-toggle-group">
            <button
              className={`theme-btn ${(local.editor_theme || 'dark') === 'dark' ? 'active' : ''}`}
              onClick={() => update('editor_theme', 'dark')}>
              <Moon size={14} /> Dark
            </button>
            <button
              className={`theme-btn ${local.editor_theme === 'light' ? 'active' : ''}`}
              onClick={() => update('editor_theme', 'light')}>
              <Sun size={14} /> Light
            </button>
          </div>

          <label className="settings-label">Show Card Indicators</label>
          <label className="settings-toggle">
            <input type="checkbox" checked={local.show_card_indicators !== false}
              onChange={e => update('show_card_indicators', e.target.checked)} />
            <span className="toggle-slider" />
            <span className="toggle-text">{local.show_card_indicators !== false ? 'Enabled' : 'Disabled'}</span>
          </label>

          <label className="settings-label">When Anki note differs from paper</label>
          <p className="settings-field-hint">
            Applies when the paper line is unchanged but the note was edited in Browse / note editor.
          </p>
          <select
            className="deck-select"
            style={{ width: '100%', marginBottom: 12 }}
            value={local.anki_edit_conflict || 'ask'}
            onChange={(e) => update('anki_edit_conflict', e.target.value)}
          >
            <option value="ask">Ask me each time (recommended)</option>
            <option value="preserve">Always keep Anki edits (no prompt)</option>
            <option value="overwrite">Always use paper text (no prompt)</option>
            <option value="abort">Stop generate and show error (no changes)</option>
          </select>
        </div>

        <div className="settings-info">
          <div className="settings-shortcuts-title">
            <HardDrive size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Papers on disk
          </div>
          <p className="settings-field-hint">
            Writes a copy of every paper into your Anki profile folder as one
            markdown file each, so you can read, back up and version them.
            Your papers stay exactly where they are — this only adds files.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="modal-btn" disabled={diskBusy}
                    onClick={() => runDiskExport('preview')}>
              {diskBusy ? 'Working…' : 'Preview'}
            </button>
            <button className="modal-btn" disabled={diskBusy}
                    onClick={() => runDiskExport('write')}>
              Write files
            </button>
          </div>
          {diskReport && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
              {diskReport.error ? (
                <div style={{ color: 'var(--red)' }}>{diskReport.error}</div>
              ) : (
                <>
                  <div>
                    {diskReport.dry_run ? 'Would write' : 'Wrote'}{' '}
                    <b>{diskReport.written?.length ?? 0}</b> papers
                    {' '}({diskReport.card_ref_count} card links)
                    {diskReport.failed?.length ? (
                      <span style={{ color: 'var(--red)' }}>
                        {' '}· {diskReport.failed.length} failed
                      </span>
                    ) : null}
                  </div>
                  <div style={{ opacity: .7, wordBreak: 'break-all' }}>{diskReport.root}</div>
                  {diskReport.renamed?.length > 0 && (
                    <div style={{ marginTop: 6, color: 'var(--orange)' }}>
                      {diskReport.renamed.length} title(s) adjusted to fit a filename —
                      the full title is kept inside each file.
                    </div>
                  )}
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16, maxHeight: 150, overflowY: 'auto' }}>
                    {(diskReport.written || []).map((w) => (
                      <li key={w.id} style={{ opacity: .85 }}>
                        {w.path || w.md} <span style={{ opacity: .6 }}>· {w.cards ?? 0} cards</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="settings-info">
          <div className="settings-shortcuts-title">Keyboard Shortcuts</div>
          <div className="settings-shortcut"><kbd>Ctrl+S</kbd> Save</div>
          <div className="settings-shortcut"><kbd>Ctrl+G</kbd> Generate Cards</div>
          <div className="settings-shortcut"><kbd>Ctrl+B</kbd> Bold</div>
          <div className="settings-shortcut"><kbd>Ctrl+I</kbd> Italic</div>
          <div className="settings-shortcut"><kbd>Ctrl+Shift+V</kbd> Toggle View</div>
        </div>

        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose}>Cancel</button>
          <button className="modal-btn primary" onClick={() => { onSave(local); onClose() }}>
            <Save size={14} /> Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
