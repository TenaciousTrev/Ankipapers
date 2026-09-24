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
  HardDrive,
  Layers,
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
const PLAIN_PASTE_KEY = IS_MAC ? '⇧⌘V' : 'Ctrl+Shift+V'

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
          <section className="welcome-card welcome-card-notice">
            <h2 className="welcome-card-title">
              <HardDrive size={16} /> Your papers are files on your computer
            </h2>
            <p className="welcome-card-hint">
              Every paper is an ordinary markdown file kept in your Anki profile
              folder, arranged in the same folders you see in the sidebar. You can
              open them in any editor, put them in Dropbox, or track them with git.
              The editor reads those files directly, so what is on your disk is what
              you see here. A copy still goes into your Anki collection and travels
              to AnkiWeb with the rest of your sync, as a backup.
            </p>
            <p className="welcome-card-hint">
              <b>Already been using Anki Papers?</b> Papers you wrote before this
              version live only in the collection until you copy them out, and it is
              a one-time job. Open <b>Settings → Papers on disk</b> and press{' '}
              <b>Preview</b>: it tells you how many papers would be written, how many
              card links they carry, and the exact folder they would go to, without
              touching anything. When that looks right, press <b>Write</b>. It only
              adds files — nothing in your collection is changed or removed, so there
              is nothing to undo. From then on every save writes itself to disk.
            </p>
            <div className="welcome-actions-row">
              <button
                type="button"
                className="welcome-btn welcome-btn-primary"
                onClick={() => onOpenSettings?.()}
              >
                <Settings size={15} /> Open Settings
              </button>
            </div>
          </section>

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
                <Ref code="![](scan.png) under a card" tone="muted">
                  A picture indented under a card rides along with it, in the same
                  place the <code>&&</code> notes appear. It needs no <code>&&</code>{' '}
                  of its own — a line holding nothing but a picture can only mean
                  “show this with the card above”. Put as many as you like, and mix
                  them with <code>&&</code> lines in whatever order reads best; they
                  arrive on the card in the order you wrote them.
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
                  Anything tucked under that line comes with it. A blank line is the
                  exception — it moves on its own, so nudging one never drags along
                  whatever happens to sit below it. When a line has anything tucked
                  under it, it starts folded up — click the little arrow beside it to
                  open it.
                </Ref>
                <Ref code="| Column | Column |" tone="muted">
                  A table. Write the rows with pipes between the cells and put a row
                  of <code>| --- | --- |</code> under the first one to make it the
                  header. Tables are only as wide as they need to be and sit centred;
                  hover one for <b>S / M / L / Full</b> buttons that decide how wide
                  it may grow before the cells start wrapping. Pressing Enter inside a
                  table adds a row, and pressing it at the very end steps back out.
                </Ref>
                <Ref code="![caption](picture.jpg)" tone="muted">
                  A picture from your Anki media folder. The picture button on the
                  toolbar adds one wherever your cursor is, and pasting an image
                  copies it into the media folder for you, so you rarely type this
                  out. Where you put the line decides what it does: on its own at
                  any level it is just part of the document, and indented under a
                  card it travels onto that card.
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
                <Ref code="Renaming a heading" tone="muted">
                  Links quote the heading they point at. If you rename a heading that
                  other papers link to, saving (or leaving the paper) offers to update
                  every link that still reads the old name. Links whose words you chose
                  yourself are left as you wrote them.
                </Ref>
                <Ref code="<!--ap:…-->" tone="muted">
                  If you open a paper in a text editor you'll see these on some lines.
                  They are the name that makes a line findable — links point at them,
                  and card generation uses them to recognise a card you have reworded
                  instead of replacing it. The editor hides them and keeps them out of
                  your cards and PDFs. Leave them alone and they look after
                  themselves; delete one and whatever pointed at that line loses it.
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
                icon={Layers}
                title="Several papers at once"
                blurb="Every paper you open gets a tab above the editor, so the ones you are working across stay one click apart."
              >
                <Ref code="Tabs" tone="key">
                  Open a paper from the sidebar, a link, or the search and it joins the
                  strip. Following a link puts the new paper right next to the one you
                  came from, and the one you left stays open. Close a tab with its × or
                  a middle-click. Five tabs fit across the window; beyond that the strip
                  scrolls sideways. Your open tabs are remembered next time.
                </Ref>
                <Ref code="Back / forward" tone="key">
                  The two arrows at the left of the tab strip retrace your steps through
                  every paper you have visited, landing on the same line each time — so
                  you can chase a chain of links and find your way back. A mouse's back
                  and forward buttons do the same.
                </Ref>
                <Ref code="●" tone="key">
                  A dot on the active tab means that paper has edits not yet saved to
                  disk. It clears when you press Ctrl+S, when autosave runs, and whenever
                  you switch papers, since switching always saves first.
                </Ref>
              </RefGroup>

              <RefGroup
                icon={Keyboard}
                title="Keys worth knowing"
                blurb={IS_MAC
                  ? 'On a Mac these use Ctrl, not Command — except the two pasting keys, which follow the usual ⌘ you already use everywhere else.'
                  : 'The same keys work on Windows and Linux.'}
              >
                <Ref code="Ctrl+S" tone="key">Save the paper you're in.</Ref>
                <Ref code="Ctrl+G" tone="key">
                  Make the cards. It saves first, so nothing you've just typed is missed.
                </Ref>
                <Ref code="Ctrl+Shift+E" tone="key">
                  Switch between the normal editor and the plain text behind it. Handy
                  when you want to see exactly what you've written.
                </Ref>
                <Ref code="Ctrl+B / Ctrl+I" tone="key">Bold and italic.</Ref>
                <Ref code="Ctrl+Z / Ctrl+Shift+Z" tone="key">Undo and redo.</Ref>
                <Ref code="Ctrl+," tone="key">Open Settings.</Ref>
                <Ref code="Ctrl+Tab / Ctrl+Shift+Tab" tone="key">
                  Step to the next or previous tab.
                </Ref>
                <Ref code="Ctrl+Alt+← / Ctrl+Alt+→" tone="key">
                  Back and forward through the papers you have visited, the same as the
                  arrows on the tab strip.
                </Ref>
                <Ref code={'Ctrl+\\'} tone="key">
                  Fold the folder list away and give the whole window to what you're
                  writing. It shrinks to a narrow strip of icons rather than
                  vanishing, so New Paper and Search stay one click away — and
                  resting your pointer on the strip slides the list back out over
                  the page without moving your text. You can also drag the edge of
                  the list to any width you like; drag it far enough left and it
                  folds away on its own.
                </Ref>
                <Ref code={IS_MAC ? 'Ctrl+Shift+↓ or ⇧⌘↓' : 'Ctrl+Shift+↓'} tone="key">
                  Unfold the whole document at once. Papers open with every nested
                  section folded up so a long one reads as an outline, and this opens
                  all of it in one press when you want the full text back.
                </Ref>
                <Ref code={IS_MAC ? 'Ctrl+Shift+↑ or ⇧⌘↑' : 'Ctrl+Shift+↑'} tone="key">
                  The mirror image: fold every section back up to the same outline
                  the document opens with. Handy after unfolding everything to skim,
                  when you want to collapse it again without reopening the paper.
                </Ref>
                <Ref code={PASTE_KEY} tone="key">
                  Paste as it was copied. Text that came with line breaks in it
                  arrives as separate lines, one block each, below whichever block
                  you have selected.
                </Ref>
                <Ref code={PLAIN_PASTE_KEY} tone="key">
                  Paste as plain text, all on one line. Every line break in what you
                  copied becomes a space. This is the one to use for a paragraph
                  lifted out of a textbook or a PDF, where the breaks are just
                  where the column happened to end — it also rejoins words split
                  across a line, so <code>propa-</code> and <code>gation</code> come
                  back as one word. It's in the right-click menu too.
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
