import React, { useState, useMemo, useCallback } from 'react'
import ankipapersLogo from '../assets/ankipapers-logo.svg'
import {
  FileText,
  Plus,
  Search,
  FileInput,
  Settings,
  Clock,
  FolderOpen,
  Sparkles,
  ChevronDown,
  BookOpen,
  Link2,
  Share2,
  Hash,
  Keyboard,
} from 'lucide-react'

function formatRelativeTime(modifiedAt) {
  const ts = typeof modifiedAt === 'number' ? modifiedAt : 0
  const sec = Math.floor(Date.now() / 1000 - ts)
  if (sec < 45) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
const PASTE_KEY = IS_MAC ? '⌘V' : 'Ctrl+V'

/** One row of the guide: the thing you type, and what it does for you. */
function Ref({ code, tone, children }) {
  return (
    <div className="welcome-ref-row">
      <code className={`welcome-ref-code${tone ? ` is-${tone}` : ''}`}>{code}</code>
      <span className="welcome-ref-text">{children}</span>
    </div>
  )
}

function RefGroup({ icon: Icon, title, blurb, children }) {
  return (
    <div className="welcome-ref-group">
      <h3 className="welcome-ref-group-title"><Icon size={13} /> {title}</h3>
      {blurb ? <p className="welcome-ref-blurb">{blurb}</p> : null}
      {children}
    </div>
  )
}

export default function WelcomeScreen({
  papers = [],
  selectedFolder = null,
  onSelectPaper,
  onCreatePaper,
  onImportMarkdown,
  onOpenSettings,
}) {
  const [newTitle, setNewTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const recentPapers = useMemo(() => {
    return [...papers].sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)).slice(0, 8)
  }, [papers])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return papers.filter((p) => {
      const title = (p.title || '').toLowerCase()
      const folder = (p.folder_path || '').toLowerCase()
      return title.includes(q) || folder.includes(q)
    }).slice(0, 12)
  }, [papers, searchQuery])

  const handleCreate = useCallback(() => {
    const title = newTitle.trim() || 'Untitled Paper'
    onCreatePaper?.(title, selectedFolder || '')
    setNewTitle('')
  }, [newTitle, onCreatePaper, selectedFolder])

  const folderHint =
    selectedFolder && selectedFolder.length > 0
      ? `New paper will be created in “${selectedFolder}” (sidebar folder filter).`
      : 'New paper goes to the library root unless a folder is selected in the sidebar.'

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-top">
          <div className="welcome-hero">
            <div className="welcome-icon">
              <img
                src={ankipapersLogo}
                alt="Anki Papers"
                className="welcome-logo"
                width={96}
                height={96}
                decoding="async"
              />
            </div>
            <h1 className="welcome-title">Anki Papers</h1>
            <p className="welcome-subtitle">
              Write your notes the way you always would. Mark the lines you want to
              remember, and Anki Papers turns those lines into flashcards for you —
              no copying, no second deck to keep in step.
            </p>
            <div className="welcome-stats">
              <span className="welcome-stat">
                <Sparkles size={14} />
                {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
              </span>
            </div>
          </div>

          <div className="welcome-syntax-wrap">
            <section className="welcome-card welcome-syntax-card-centered">
              <h2 className="welcome-card-title welcome-card-title-center">
                <FileText size={16} /> Start here
              </h2>
              <p className="welcome-card-hint welcome-card-hint-center">
                There are four ways to mark a line. Write the rest of your notes
                normally — anything you don't mark stays plain text.
              </p>
              <div className="welcome-ref welcome-ref-compact">
                <Ref code="Question >> Answer" tone="basic">
                  Asks you the question, shows the answer.
                </Ref>
                <Ref code="Term <> Definition" tone="reversible">
                  Asks you both ways round.
                </Ref>
                <Ref code="Blood loss causes {{anemia}}" tone="cloze">
                  Hides the words in braces and asks you to fill in the gap.
                </Ref>
                <Ref code="# Heading" tone="heading">
                  A title. It organises your notes and never becomes a card.
                </Ref>
              </div>
              <p className="welcome-card-hint welcome-card-hint-center">
                When you're ready, press <b>Ctrl+G</b> and your cards appear in Anki.
              </p>
            </section>
          </div>

          <p className="welcome-scroll-cue">
            <ChevronDown size={18} className="welcome-scroll-cue-icon" aria-hidden />
            Scroll down for the full guide, quick start, and your recent papers
          </p>
        </div>

        <div className="welcome-lower">
          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <BookOpen size={16} /> A guide to Anki Papers
            </h2>
            <p className="welcome-card-hint">
              You keep one document per subject and write in it the way you'd write
              anywhere else. Certain lines are special: when you press Generate, each
              of those lines becomes a flashcard in Anki, and pressing Generate again
              later updates the same cards rather than making new ones. Everything
              below is optional — you can get a long way with just the four marks above.
            </p>

            <div className="welcome-ref">
              <RefGroup
                icon={FileText}
                title="Making flashcards"
                blurb="Each of these turns one line into one card. You can mix them freely in the same document."
              >
                <Ref code="Question >> Answer" tone="basic">
                  The most common one. Everything before the two arrows becomes the
                  front of the card, everything after becomes the back.
                </Ref>
                <Ref code="Term <> Definition" tone="reversible">
                  Makes two cards from one line, so you get asked the term from the
                  definition as well as the other way round. Good for vocabulary and
                  for names of things.
                </Ref>
                <Ref code="{{words to hide}}" tone="cloze">
                  Keeps the sentence intact but blanks out the part in braces, so you
                  recall it with the rest of the sentence as a clue. Useful when the
                  surrounding wording is what makes the fact make sense.
                </Ref>
                <Ref code="{{c1::this}} {{c2::that}}" tone="cloze">
                  The same idea, but you choose how it's split up. Everything marked
                  c1 is hidden on one card, everything marked c2 on another. Give two
                  phrases the same number and they're hidden together.
                </Ref>
                <Ref code="&& Extra explanation" tone="muted">
                  Background reading rather than a question. Indent it underneath a
                  card and it appears alongside the answer when you're reviewing. It
                  never becomes a card of its own, so it's a good home for the
                  paragraph that explains why the answer is what it is.
                </Ref>
                <Ref code="[[tag]]" tone="muted">
                  Puts an Anki tag on that card, written as <code>AnkiPapers::tag</code>.
                  Anything you'd normally use tags for — searching, building a filtered
                  deck before an exam — works the same way here.
                </Ref>
                <Ref code="[[NH]]" tone="muted">
                  Short for “no heading”. Every card normally shows the headings it came
                  from at the top, which is helpful context. Add this when that context
                  would give the answer away.
                </Ref>
              </RefGroup>

              <RefGroup
                icon={Hash}
                title="Organising your notes"
                blurb="Headings and indenting do two jobs at once: they keep the document readable, and they tell each card where it came from."
              >
                <Ref code="# Topic" tone="heading">
                  The biggest heading — one subject or condition per topic.
                </Ref>
                <Ref code="## Section" tone="heading">
                  A part of that topic, like Diagnosis or Treatment.
                </Ref>
                <Ref code="### and smaller" tone="heading">
                  Finer divisions when you need them, down to six levels of heading.
                </Ref>
                <Ref code="Tab / Shift+Tab" tone="key">
                  Moves a line in or out one level, so it sits underneath the line above.
                  When a line has anything tucked under it, it starts folded up — click
                  the little arrow beside it to open it.
                </Ref>
                <Ref code="![caption](picture.jpg)" tone="muted">
                  A picture from your Anki media folder, which appears on the card too.
                  The picture button on the toolbar adds one wherever your cursor is,
                  so you rarely need to type this out.
                </Ref>
              </RefGroup>

              <RefGroup
                icon={Link2}
                title="Linking papers together"
                blurb="Any phrase in one paper can point at any heading in another, so related ideas are one click apart instead of one search apart."
              >
                <Ref code="Making a link" tone="key">
                  Select the words you want to turn into a link, right-click them, and
                  choose <b>Create link…</b> Then search for the paper or heading it
                  should point at. The words stay readable — they just become
                  underlined.
                </Ref>
                <Ref code="Following a link" tone="key">
                  Double-click it. You land on the exact line it points at, not just
                  the top of the other document.
                </Ref>
                <Ref code="Seeing your links" tone="key">
                  The link button in the toolbar opens a side panel with two lists:
                  everywhere that points <b>at</b> this document, and everywhere this
                  document points <b>to</b>. Click any entry to jump there.
                </Ref>
                <Ref code="Why they hold" tone="muted">
                  A link is attached to the line itself rather than to its position, so
                  you can reword it, move it, or rename the paper and the link still
                  finds it.
                </Ref>
              </RefGroup>

              <RefGroup
                icon={Share2}
                title="Seeing the whole picture"
                blurb="The Graph button inside the link panel draws every connection in your library at once — useful for spotting a subject you've written about in three places without noticing."
              >
                <Ref code="Documents / Headings" tone="key">
                  Switch between one dot per paper and one dot per linked section, with
                  the headings above it shown as its parents.
                </Ref>
                <Ref code="Getting around" tone="key">
                  Drag a dot to move it out of the way, double-click it to open that
                  paper. Drag the background to move the whole picture, scroll to zoom
                  in and out.
                </Ref>
                <Ref code="Broken links" tone="muted">
                  The line along the bottom counts any links whose destination no longer
                  exists, so you can find and mend them.
                </Ref>
              </RefGroup>

              <RefGroup
                icon={Keyboard}
                title="Keys worth knowing"
                blurb={IS_MAC
                  ? 'These use Ctrl on a Mac too, not the Command key.'
                  : 'The same keys work on Windows and Linux.'}
              >
                <Ref code="Ctrl+S" tone="key">Save the paper you're in.</Ref>
                <Ref code="Ctrl+G" tone="key">
                  Make the cards. It saves first, so nothing you've just typed is missed.
                </Ref>
                <Ref code="Ctrl+Shift+V" tone="key">
                  Switch between the normal editor and the plain text behind it. Handy
                  when you want to see exactly what you've written.
                </Ref>
                <Ref code="Ctrl+B / Ctrl+I" tone="key">Bold and italic.</Ref>
                <Ref code="Ctrl+Z / Ctrl+Shift+Z" tone="key">Undo and redo.</Ref>
                <Ref code="Ctrl+," tone="key">Open Settings.</Ref>
                {IS_MAC ? (
                  <Ref code="⇧⌘↓" tone="key">
                    Unfold everything below where your cursor is, all at once.
                  </Ref>
                ) : null}
                <Ref code={PASTE_KEY} tone="key">
                  Paste copied lines in as their own separate lines, below whichever
                  one you have selected.
                </Ref>
              </RefGroup>
            </div>
          </section>

          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <Plus size={16} /> Quick start
            </h2>
            <p className="welcome-card-hint">{folderHint}</p>
            <div className="welcome-create-row">
              <input
                className="welcome-input"
                placeholder="Title for a new paper…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <button type="button" className="welcome-btn welcome-btn-primary" onClick={handleCreate}>
                Create
              </button>
            </div>
            <div className="welcome-actions-row">
              <button type="button" className="welcome-btn welcome-btn-ghost" onClick={() => onImportMarkdown?.()}>
                <FileInput size={15} /> Import Markdown
              </button>
              <button type="button" className="welcome-btn welcome-btn-ghost" onClick={() => onOpenSettings?.()}>
                <Settings size={15} /> Settings
              </button>
            </div>
          </section>

          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <Search size={16} /> Find a paper
            </h2>
            <input
              className="welcome-input"
              placeholder="Search by title or folder…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.trim() && (
              <ul className="welcome-paper-list">
                {searchResults.length === 0 ? (
                  <li className="welcome-paper-empty">No matches</li>
                ) : (
                  searchResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="welcome-paper-btn"
                        onClick={() => onSelectPaper?.(p.id)}
                      >
                        <span className="welcome-paper-title">{p.title || 'Untitled'}</span>
                        {p.folder_path ? (
                          <span className="welcome-paper-meta">
                            <FolderOpen size={12} /> {p.folder_path}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </section>

          <section className="welcome-card">
            <h2 className="welcome-card-title">
              <Clock size={16} /> Recently edited
            </h2>
            {recentPapers.length === 0 ? (
              <p className="welcome-card-hint">No papers yet. Use Quick start above or the sidebar.</p>
            ) : (
              <ul className="welcome-paper-list">
                {recentPapers.map((p) => {
                  const n = p.card_refs?.length ?? 0
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="welcome-paper-btn"
                        onClick={() => onSelectPaper?.(p.id)}
                      >
                        <span className="welcome-paper-title">{p.title || 'Untitled'}</span>
                        <span className="welcome-paper-meta">
                          {formatRelativeTime(p.modified_at)}
                          {n > 0 ? ` · ${n} card${n === 1 ? '' : 's'}` : ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
