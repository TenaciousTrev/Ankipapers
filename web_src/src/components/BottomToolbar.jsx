import React, { useState } from 'react'
import { Save, Zap } from 'lucide-react'

export default function BottomToolbar({ cardCounts, onSave, onGenerate, isSaving: externalIsSaving }) {
  // Local state to track if an operation is currently running
  const [localIsSaving, setLocalIsSaving] = useState(false)
  const [localIsGenerating, setLocalIsGenerating] = useState(false)

  const total = (cardCounts?.basic || 0) + (cardCounts?.reversible || 0) + (cardCounts?.cloze || 0)
  const parts = []
  if (cardCounts?.basic) parts.push(`${cardCounts.basic} basic`)
  if (cardCounts?.reversible) parts.push(`${cardCounts.reversible} reversible`)
  if (cardCounts?.cloze) parts.push(`${cardCounts.cloze} cloze`)

  // Wrap the save function to trigger the UI lock
  const handleSave = async (e) => {
    if (localIsSaving || localIsGenerating) return; // Prevent double-clicks
    setLocalIsSaving(true)
    try {
      const res = onSave(e)
      if (res && typeof res.then === 'function') {
        // If your parent component returns a promise, wait for it natively
        await res
      } else {
        // Fail-safe: Force a 1.5-second lock so the QWebChannel backend has time to write heavy files
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    } finally {
      setLocalIsSaving(false)
    }
  }

  // Wrap the generate function to trigger the UI lock
  const handleGenerate = async (e) => {
    if (localIsSaving || localIsGenerating) return; // Prevent double-clicks
    setLocalIsGenerating(true)
    try {
      const res = onGenerate(e)
      if (res && typeof res.then === 'function') {
        await res
      } else {
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    } finally {
      setLocalIsGenerating(false)
    }
  }

  // The toolbar is busy if either a local process is running OR the parent passed down a busy state
  const isBusy = externalIsSaving || localIsSaving || localIsGenerating

  return (
    <div className="bottom-toolbar">
      <span className="card-count">
        {total > 0 ? (
          <>
            <Zap size={13} className="card-count-icon" />
            {total} cards ({parts.join(', ')})
          </>
        ) : (
          <span className="no-cards">No cards detected</span>
        )}
      </span>
      <div className="spacer" />
      
      <button 
        className={`toolbar-btn ${isBusy ? 'disabled' : ''}`} 
        onClick={handleSave} 
        title="Save (Ctrl+S)"
        disabled={isBusy}
        style={{ opacity: isBusy ? 0.5 : 1, cursor: isBusy ? 'not-allowed' : 'pointer' }}
      >
        <Save size={14} />
        <span>{localIsSaving ? 'Saving...' : 'Save'}</span>
      </button>
      
      <button 
        className={`generate-btn ${isBusy ? 'disabled' : ''}`} 
        onClick={handleGenerate} 
        title="Generate Cards (Ctrl+G)"
        disabled={isBusy}
        style={{ opacity: isBusy ? 0.5 : 1, cursor: isBusy ? 'not-allowed' : 'pointer' }}
      >
        <Zap size={14} />
        <span>{localIsGenerating ? 'Generating...' : 'Generate Cards'}</span>
      </button>
    </div>
  )
}