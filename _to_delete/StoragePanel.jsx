import React, { useState, useEffect, useCallback } from 'react'
import { Database, AlertTriangle, Check, Loader } from 'lucide-react'
import {
  getStorageReport, migrateStorage, rollbackStorage, retireOldStorage,
} from '../bridge'

function kb(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString()} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * How papers are stored, and the three actions that can change it.
 *
 * Every one of them is a deliberate press. The add-on never changes the layout
 * on its own — an earlier version migrated silently on startup, and being
 * unable to see what had happened to your own library was worse than the
 * problem it fixed.
 */
export default function StoragePanel() {
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setReport(await getStorageReport())
    } catch {
      setReport({ available: false })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const run = async (name, fn, describe) => {
    setBusy(name); setResult(null)
    try {
      const res = await fn()
      setResult(describe(res))
    } catch (e) {
      setResult({ tone: 'bad', text: String(e?.message || e) })
    } finally {
      setBusy(''); refresh()
    }
  }

  if (!report) {
    return (
      <div className="settings-storage">
        <div className="settings-shortcuts-title"><Database size={13} /> Storage</div>
        <p className="settings-field-hint">Checking…</p>
      </div>
    )
  }

  if (!report.available) {
    return (
      <div className="settings-storage">
        <div className="settings-shortcuts-title"><Database size={13} /> Storage</div>
        <p className="settings-field-hint">No collection is open, so there is nothing to report.</p>
      </div>
    )
  }

  const split = report.mode === 'split'

  return (
    <div className="settings-storage">
      <div className="settings-shortcuts-title"><Database size={13} /> Storage</div>

      <p className="settings-field-hint">
        {split ? (
          <>Each paper has its own entry. Saving a paper rewrites only that
            paper — about <b>{kb(report.largest_save)}</b> — however many you own.</>
        ) : (
          <>Every paper is kept in a single entry, so saving any paper rewrites
            your whole library: about <b>{kb(report.largest_save)}</b> every time,
            growing as you add papers.</>
        )}
      </p>

      <div className="settings-storage-stats">
        <span>{split ? report.papers : report.legacy_papers} papers</span>
        <span>{kb(split ? report.bytes : report.legacy_bytes)} stored</span>
        {split && report.legacy_papers > 0 && (
          <span>{kb(report.legacy_bytes)} still held by the old copy</span>
        )}
      </div>

      {report.missing?.length > 0 && (
        <p className="settings-storage-warn">
          <AlertTriangle size={13} /> Listed but unreadable: {report.missing.join(', ')}.
          Nothing will be removed while this is unresolved.
        </p>
      )}

      {!split && (
        <>
          <p className="settings-field-hint">
            Giving each paper its own entry makes every save small and fast. Your
            papers are copied, read back, and compared one by one; the change only
            takes effect if every paper survives that check. Nothing is deleted, a
            plain JSON copy is saved to your Anki profile folder first, and you can
            switch back at any time.
          </p>
          <button
            className="modal-btn primary settings-storage-btn"
            disabled={busy === 'migrate'}
            onClick={() => run('migrate', migrateStorage, (r) => r.ok
              ? { tone: 'good', text: `${r.verified} papers moved and verified. A copy of the old layout is in your profile folder.` }
              : { tone: 'bad', text: `Nothing was changed. ${(r.failed || []).join('; ')}` })}
          >
            {busy === 'migrate' ? <Loader size={14} /> : <Database size={14} />}
            Give each paper its own entry
          </button>
        </>
      )}

      {split && report.legacy_papers > 0 && (
        <>
          <p className="settings-field-hint">
            The old combined copy is still here. That is what lets you switch back,
            and it is also what is taking {kb(report.legacy_bytes)}.
          </p>
          <div className="settings-storage-actions">
            <button
              className="modal-btn settings-storage-btn"
              disabled={busy === 'rollback'}
              onClick={() => run('rollback', rollbackStorage, (r) => r.ok
                ? { tone: 'good', text: 'Back to the old layout. Papers saved since the change stay where they are until you switch forward again.' }
                : { tone: 'bad', text: r.reason || 'Could not switch back.' })}
            >
              Switch back
            </button>
            <button
              className="modal-btn settings-storage-btn"
              disabled={busy === 'retire' || !report.can_retire}
              title={report.can_retire ? '' : 'Every paper has to read cleanly from the new layout first'}
              onClick={() => run('retire', retireOldStorage, (r) => r.ok
                ? { tone: 'good', text: `Old copy removed, ${kb(r.freed)} freed. Switching back is no longer possible.` }
                : { tone: 'bad', text: r.reason || 'Refused.' })}
            >
              Delete the old copy, free {kb(report.legacy_bytes)}
            </button>
          </div>
        </>
      )}

      {result && (
        <p className={`settings-storage-result is-${result.tone}`}>
          {result.tone === 'good' ? <Check size={13} /> : <AlertTriangle size={13} />}
          {result.text}
        </p>
      )}
    </div>
  )
}
