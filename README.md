<p align="center">
  <img src="AnkiPapers logo.svg" alt="Anki Papers Logo" width="200"/>
</p>

# Anki Papers

Write notes as **markdown papers** inside Anki. Mark the lines worth remembering and press Generate — those lines become **Basic**, **reversible**, and **cloze** cards in your collection, and pressing Generate again later updates the same cards rather than making new ones.

Papers **link to each other**: highlight a phrase, point it at a heading in another document, and follow it with a double-click. A **Links panel** shows what cites the open paper, and a **graph view** shows how the whole library connects.

Your papers are **plain markdown files on your own disk**, in folders that match the ones in the sidebar — readable in any editor, diffable, and yours to back up however you like.

**Author:** Dr. Ahmed Benarab

---

## Contents

- [What's new](#whats-new)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Writing cards](#writing-cards)
- [Organising a paper](#organising-a-paper)
- [Context on your cards](#context-on-your-cards)
- [Linking papers](#linking-papers)
- [The hidden anchors](#the-hidden-anchors)
- [Links panel and graph](#links-panel-and-graph)
- [Searching](#searching)
- [Saving and generating](#saving-and-generating)
- [Where your papers live](#where-your-papers-live)
- [Exporting](#exporting)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Settings](#settings)
- [Building](#building)
- [Project layout](#project-layout)
- [Syntax quick reference](#syntax-quick-reference)

---

## What's new

**Papers are files on your disk.** Every paper is now written to `<profile>/ankipapers/papers/` as a `.md` file, in real folders mirroring the sidebar, with a small `.ap.json` beside it. The editor reads those files directly. A copy still goes into the Anki collection and rides along to AnkiWeb as a backup. See [Where your papers live](#where-your-papers-live) — and if you were using Anki Papers before this version, there is a **one-time step** to copy your existing papers out.

**Cards keep their identity when you reword them.** Generate used to recognise a card only by its text being byte-for-byte identical, so editing a line destroyed the old card and built a new one — losing its review history, and in some cases leaving a duplicate behind. Every card line now carries a permanent hidden name, so Generate updates the card you edited instead of replacing it. Existing papers adopt this silently on their next Generate: nothing is created, updated, or deleted.

**PDF export** renders the document as it appears in the editor — indentation, tables, images, and cards as clean question-and-answer blocks — on Letter paper with half-inch margins.

**Closing the window can't lose work.** Anki Papers now waits for an in-flight save or generate to finish before the window closes, and offers to keep waiting if it is taking a while.

**Expand-all works everywhere.** `Ctrl+Shift+↓` unfolds a whole document on Windows, Linux, and macOS. It was previously `⇧⌘↓` and macOS-only.

---

## Requirements

- **Anki** compatible with [`manifest.json`](manifest.json) → `min_point_version` (compare with **Help → About**; this repo currently targets **231000**).
- **Qt WebEngine** (bundled with standard Anki desktop builds).

## Install

### Option A — `.ankiaddon` package

1. Build the package (see [Building](#building)) or take a release artifact from GitHub.
2. In Anki: **Tools → Add-ons → Install from file…** and choose `Ankipapers.ankiaddon`.
3. Restart Anki if prompted.

### Option B — From this repository

1. Clone or download the repo.
2. Copy the **folder** (the one containing `__init__.py` and `manifest.json`) into your Anki add-ons directory:
   - **Windows:** `%APPDATA%\Anki2\addons21\Ankipapers`
   - **macOS:** `~/Library/Application Support/Anki2/addons21/Ankipapers`
   - **Linux:** `~/.local/share/Anki2/addons21/Ankipapers`
3. Make sure the built UI exists under `web/` (it is committed here). If you removed it, run a [UI build](#building-the-web-ui) first.
4. Restart Anki.

Open it from **Tools → 📝 Anki Papers**, the **📝 Papers** toolbar link, or **Ctrl+Shift+P**.

---

## Quick start

Make a paper, type this into it, and press **Ctrl+G**:

```markdown
# Iron deficiency anaemia

## Diagnosis
Most useful single test for iron deficiency >> Serum ferritin
Ferritin is an {{acute phase reactant}}, so it rises with inflammation
    && A normal ferritin does not exclude iron deficiency in active
       inflammation. Transferrin saturation helps in that setting.

## Treatment
Oral iron is best absorbed with {{c1::vitamin C}} and worst with {{c2::tea}}
Ferrous sulfate <> 65 mg elemental iron per 325 mg tablet
```

Five cards appear in Anki. Edit any line, press Ctrl+G again, and that same card updates — its review history intact.

---

## Writing cards

Each of these turns **one line into one card**. Mix them freely.

| You write | You get |
|---|---|
| `Question >> Answer` | A basic card. Everything before `>>` is the front, everything after is the back. |
| `Term <> Definition` | Two cards, asked both ways round. Good for vocabulary and names. |
| `Blood loss causes {{anemia}}` | A cloze card: the braced words are hidden, the rest of the sentence stays as the clue. |
| `{{c1::this}} and {{c2::that}}` | Numbered cloze — everything marked `c1` hides on one card, `c2` on another. Same number, hidden together. |

Anything you don't mark stays plain text and never becomes a card.

### `&&` supplements

A line beginning `&& ` is **background reading, not a question**. Indent it under a card and it rides along with that card's answer during review. It never becomes a card of its own.

```markdown
Drug of choice for Wolff-Parkinson-White with AF >> Procainamide
    && AV nodal blockers (adenosine, verapamil, beta blockers, digoxin) can
       accelerate conduction down the accessory pathway and precipitate VF.
```

This is the right home for the paragraph explaining *why* the answer is the answer — the part that makes a fact stick but would ruin the card if it were on the front.

### `[[tag]]` and `[[NH]]`

`[[tag]]` anywhere on a card line puts an Anki tag on that card, written as `AnkiPapers::tag`. Everything you'd normally use tags for — searching, building a filtered deck the week before an exam — works as usual.

`[[NH]]` is short for **no heading**. By default every card shows the headings it came from (see [Context on your cards](#context-on-your-cards)); add `[[NH]]` when that context would give the answer away.

```markdown
## Hypertrophic cardiomyopathy
Murmur increases with Valsalva >> Hypertrophic cardiomyopathy [[NH]]
```

Without `[[NH]]`, the card would helpfully announce the answer in its own header.

### Images, formatting, and maths

- `![caption](picture.jpg)` — a picture from your Anki media folder, which also appears on the card. The toolbar's picture button inserts one at the cursor, and pasting an image from the clipboard copies it into your media folder for you.
- `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` `` all work inline, in the editor and on the card.
- `$x^2$` and `$$\int_a^b f(x)\,dx$$` become Anki's MathJax on the generated note.
- Tables, blockquotes, and `---` rules render in the editor and print.

---

## Organising a paper

Headings and indentation do two jobs at once: they keep the document readable, and they tell each card where it came from.

- `#` through `######` — six heading levels. One subject per `#`, its parts as `##`.
- **Tab / Shift+Tab** indent and outdent a line **together with everything nested under it**.
- Any line with more-indented lines beneath it is a **parent**, and papers open with parents folded, so a long document greets you as an outline. Click the chevron to open one section, or press **`Ctrl+Shift+↓`** to unfold the entire document at once.
- **Drag a block by its handle** to move it and its children.
- **Right-click a block** for edit, duplicate, merge, delete, and **Create link…**.
- **Ctrl+V** — or **⌘V** on a Mac — pastes copied lines in as separate blocks below the selected one, rather than as one run-on line.

Large papers are fine: a document of ~1,100 lines with several hundred cards stays responsive while typing and while inserting lines.

The **Source** view (`Ctrl+Shift+V`) shows the whole document as plain text when you want to see exactly what you've written.

---

## Context on your cards

A generated card carries a **breadcrumb** of the headings it came from, so a bare fact arrives with the trail that makes it meaningful:

```
Cardiology › Electrophysiology › SVT › Atrial flutter
Ventricular rate in untreated typical flutter >> ~150 (2:1 block)
```

The breadcrumb is built from the heading structure above the line, and it updates when you reorganise the document. Add `[[NH]]` to a line to suppress it on that one card.

The same breadcrumb appears in the **Create link…** search results, so two headings called "Treatment" in different documents stay distinguishable — you see `Gastroenterology › IBD › Ulcerative colitis › Treatment`, not just "Treatment".

---

## Linking papers

### Creating a link

1. Click into a line and **highlight the phrase** you want to turn into a link.
2. **Right-click** it and choose **Create link…**.
3. Search for a target. Results are pre-filtered by the phrase you highlighted and show the full breadcrumb.
4. Pick one. The phrase becomes underlined.

You can link **from** body text or a heading, and **to** any heading at any depth or to a whole document. Typing `[[` in a line autocompletes a link to another paper by title.

### Following a link

**Double-click** any word in a linked phrase to jump to its target. The destination line is briefly highlighted when you arrive.

Because double-click opens links, a *single* click on a linked phrase deliberately does not place the cursor there. To edit a line containing a link, click outside the link, or use **Edit block** from the right-click menu.

If a link's target has been deleted, following it says so rather than failing silently.

### How links survive editing

A link stores a hidden, stable anchor on the target line rather than a line number, so it keeps working after you:

- rename or reword the target heading,
- indent, outdent, reorder, or drag it,
- insert or delete lines anywhere above it,
- rename the target paper or move it to another folder,
- even move the heading into a **different** document.

### Links inside flashcards

A link inside a card line renders on the Anki note as styled text — the phrase, never the raw markdown. Links are not clickable inside Anki itself. Adding a link changes the line, so that card counts as edited and will update on the next Generate.

---

## The hidden anchors

Open a paper in a text editor and you will see comments like this at the ends of some lines:

```markdown
Most useful single test for iron deficiency >> Serum ferritin<!--ap:9f2c1a84-...-->
```

That is the line's **permanent name**, and it is the mechanism behind two things at once:

- **Links** point at anchors, not at line numbers, which is why they survive every edit listed above.
- **Card generation** matches your document against your collection by anchor, which is why rewording a card updates it instead of destroying it and building a replacement.

Anki Papers writes them for you and hides them everywhere it matters — the editor, generated cards, and PDF export all strip them. Copying or duplicating a block deliberately drops the anchor, so two lines can never claim the same name.

You do not need to think about them. But if you are editing papers outside the app, or reviewing a git diff, it is worth knowing what they are: **leave them attached to their lines.** Delete one and anything pointing at that line loses it, and the card on that line will be treated as new.

The first line of each file carries the same kind of marker for the paper itself (`<!--ap-paper:…-->`), which is what lets you rename or move a file on disk without breaking the links that point into it.

---

## Links panel and graph

The **link icon** in the editor header opens the Links panel for the open paper:

- **Linked from** — every place that cites this paper, showing the citing sentence with the linked phrase highlighted and which heading it points at. Click to jump to that exact line in the citing document.
- **Links out** — what this paper points at, with broken targets flagged.

The panel's **Graph** button opens the link graph:

- **Documents** mode draws one node per connected paper; several links between the same pair merge into one thicker edge.
- **Headers** mode promotes each linked-to heading into its own node, tethered to its document, so you can see which section is actually being cited. Headings nobody links to stay out.

Hover a node to dim everything unrelated, type in **Find…** to highlight matches, drag nodes to rearrange, scroll to zoom, drag the background to pan, and click a node to open it. A counter along the bottom tallies links whose destination no longer exists, so you can find and mend them.

Both views are derived from the markdown itself — there is no separate link database that can drift out of sync with your text.

---

## Searching

The sidebar search takes more than plain words:

| Query | Meaning |
|---|---|
| `ferritin anemia` | Papers containing both words |
| `"acute phase reactant"` | An exact phrase |
| `title:cardiology` | Restrict to a field — `title`, `content`, `folder`, `deck`, or `tag` |
| `folder:"Cell Biology"` | Quote a field value containing spaces |
| `-pediatric` | Exclude papers matching this |
| `iron OR b12` | Alternative branches: `a b OR c d` matches `(a AND b)` or `(c AND d)` |

Matches come back with a snippet showing the hit in context.

---

## Saving and generating

- **Save** (`Ctrl+S`) writes the open paper. While it runs, both toolbar buttons grey out so a generate can't start mid-save.
- **Generate Cards** (`Ctrl+G`) saves first, then creates, updates, and removes Anki notes for that paper.
- **Autosave** runs on a timer (interval configurable in Settings).
- **Closing the window** waits for any in-flight save or generate to finish, and asks whether to keep waiting if it is slow.

If a save fails, the app says so rather than reporting success.

### What Generate actually does

For each card line in the document:

- **Unchanged** → left alone entirely.
- **Reworded** → the existing Anki note is updated in place. Its review history, scheduling, and note id are kept.
- **New** → a new note is created.
- **Line deleted from the paper** → its note is removed from Anki.

Cards are matched by their [hidden anchor](#the-hidden-anchors) first, falling back to exact text for papers written before anchors existed. Deletion is scoped to **the cards this paper created** — tracked individually, never by deck membership — so hand-made cards and other papers' cards sharing the same deck are never touched.

### When a card was edited in Anki instead

If you edit a generated note in Anki's own browser and then Generate, Anki Papers notices the note no longer matches the paper. Settings decides what happens: **preserve** leaves Anki's version alone, **overwrite** pushes the paper's text back over it, and **abort** stops the whole Generate and lists the conflicts before anything changes.

---

## Where your papers live

Every paper is two files under your Anki profile folder:

```
<profile>/ankipapers/papers/Medicine/GI/Gastroenterology.md
<profile>/ankipapers/papers/Medicine/GI/Gastroenterology.ap.json
```

- The **`.md`** is the document and nothing else, so it stays pleasant to read, diff, and keep in git.
- The **`.ap.json`** beside it holds what markdown can't: the deck, tags, the true unaltered title and folder path, and the map from each line to its Anki note. That map is what stops Generate from destroying cards.

Folders in the sidebar are **real directories** on disk. Making, renaming, moving, or deleting a folder in the app does the same on disk.

The profile folder is used rather than the add-on folder because **Anki wipes an add-on's directory when it updates**. Papers kept there would not survive an update; papers in the profile folder do.

**The disk is what you see.** The editor reads these files, so a change you make to a `.md` in another editor shows up in Anki Papers.

**The collection is your backup.** A copy of every paper still goes into the Anki collection, which means it syncs to AnkiWeb with everything else and lands on your other devices. Nothing about the previous behaviour was removed — disk storage was added in front of it.

> **A note on sync size.** The collection copy lives in a single collection-config entry, which Anki transmits on every sync and documents as intended for a few kilobytes. A large library will exceed that comfortably. It works, and it is a useful backstop, but if you sync often with a very large library, this is the part to watch.

### If you used Anki Papers before this version

Papers you wrote earlier live only in the collection until you copy them out once:

1. **Settings → Papers on disk**
2. **Preview** — reports how many papers would be written, how many card links they carry, and the exact folder, without changing anything.
3. **Write** — creates the files.

It only **adds** files. Nothing in your collection is modified or removed, so there is nothing to undo. Every save from then on writes itself to disk automatically.

Titles containing characters a filename can't hold (`/ \ : * ? " < > |`) get those characters replaced with `-` in the filename only; the true title is preserved in the `.ap.json` and is what you see in the app. Preview lists any title it adjusted.

### Deleting a paper

Deleting a paper removes its cards from Anki and moves its files into `ankipapers/papers/_deleted/` rather than erasing them, so a deletion you regret is recoverable from disk.

### Backing up

Because papers are ordinary files, any backup you already run covers them: Time Machine, a synced folder, or a private git repo pointed at `<profile>/ankipapers/`. The `.md` files diff cleanly, which makes git genuinely readable here.

---

## Exporting

The editor header has three:

- **Import Markdown** — bring an existing `.md` in as a paper.
- **Export Markdown** — write the paper back out as a `.md` file.
- **Export PDF** — render the document as a PDF.

The PDF is drawn by the same renderer as the editor, so what you see is what prints: indentation, tables, images, blockquotes, and inline formatting all carry over. Cards print as clean question-and-answer blocks. Editing marks — `[[tags]]`, `[[NH]]`, and hidden anchors — are stripped, images are embedded directly in the file so it stands alone, and the page is Letter with half-inch margins, always in light mode regardless of your editor theme.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Open Anki Papers (from Anki's main window) |
| `Ctrl+S` | Save the open paper |
| `Ctrl+G` | Generate cards |
| `Ctrl+Shift+V` | Toggle Editor / Source view |
| `Ctrl+Shift+↓` | Unfold every collapsed section in the document |
| `Tab` / `Shift+Tab` | Indent / outdent the line and its children |
| `Enter` | Split the line at the cursor |
| `Backspace` at line start | Outdent, then merge into the line above |
| `Ctrl+B` / `Ctrl+I` | Bold / italic |
| `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | Undo / redo |
| `Ctrl+V` / `⌘V` on a Mac | Paste copied lines as separate blocks |
| `Ctrl+,` | Settings |
| `[[` | Autocomplete a link to another paper by title |

> The `Ctrl` shortcuts above use the **Control** key on every platform, macOS included — pasting blocks is the one exception, which follows the system paste key. On a Mac, `Ctrl+Shift+↓` also accepts `⇧⌘↓`.

---

## Settings

**Tools → Add-ons → Anki Papers → Config**, or in-app **Settings** (`Ctrl+,`):

| Setting | What it does |
|---|---|
| `default_deck` | Deck for new papers |
| `auto_save_interval_seconds` | How often autosave runs |
| `font_family` / `font_size` | Editor typeface |
| `editor_theme` | `dark`, `light`, or `auto` |
| `show_card_indicators` | Card markers in the left margin |
| `anki_edit_conflict` | `ask`, `preserve`, `overwrite`, or `abort` when a note was edited in Anki |
| Papers on disk | Preview / Write, for the one-time migration above |

---

## Building

### Building the web UI

The interface is a **Vite + React** app in `web_src/`, built into `web/`:

```bash
cd web_src
npm install
npm run build
```

The add-on loads the **built** files in `web/`, so source edits have no effect until you rebuild.

### Building the add-on package

Creates `Ankipapers.ankiaddon` for sharing or "Install from file".

```powershell
.\_build.ps1          # Windows PowerShell
```

Or double-click `build_ankiaddon.bat`. The script bundles `__init__.py`, `manifest.json`, `config.json`, `config.md`, `core/`, `gui/`, and `web/` — not `web_src/`, `user_files/`, or `node_modules/`.

---

## Project layout

| Path | Purpose |
|------|--------|
| `__init__.py` | Add-on entry: menu, toolbar, shortcuts |
| `manifest.json` | Anki package metadata |
| `core/paper.py` | The `Paper` and `CardReference` data model |
| `core/parser.py` | Line parsing, card extraction, block anchors |
| `core/storage.py` | Papers on disk, folder tree, collection mirror |
| `core/card_manager.py` | Card generation, note types, markdown → note HTML |
| `core/search_query.py` | The search language |
| `gui/webview.py` | Qt window and close-safety handling |
| `gui/bridge.py` | `QWebChannel` bridge, PDF export, media |
| `web/` | Built static UI loaded by the webview |
| `web_src/` | React source; build output goes to `web/` |
| `web_src/src/docLinks.js` | Link anchors, `ap://` addressing, target search, backlink and graph index |
| `web_src/src/printDocument.js` | The PDF renderer |
| `web_src/src/components/BlockEditor.jsx` | The block editor |
| `web_src/src/components/LinkPicker.jsx` | "Create link…" search dialog |
| `web_src/src/components/LinksPanel.jsx` | Backlinks and outgoing links |
| `web_src/src/components/GraphView.jsx` | Link graph |
| `user_files/` | Local cache/fallback only (gitignored) |
| `_build.ps1` / `build_ankiaddon.bat` | Pack `Ankipapers.ankiaddon` |

---

## Syntax quick reference

| Kind | Example |
|------|--------|
| Basic card | `Question >> Answer` |
| Reversible card | `Term <> Definition` |
| Cloze | `Text with {{blank}}` |
| Numbered cloze | `{{c1::first}} … {{c2::second}}` |
| Supplement | `&& Background that rides along with the answer` |
| Tag a card | `[[tag]]` → `AnkiPapers::tag` |
| Suppress the heading breadcrumb | `[[NH]]` |
| Heading | `# Topic`, `## Section`, … to six levels |
| Image | `![caption](picture.jpg)` |
| Maths | `$inline$`, `$$block$$` |
| Link to a heading or paper | `[phrase](ap://…)` — via right-click → **Create link…** |
| Quick paper link | `[[Paper title]]` |
| Hidden line anchor | `<!--ap:uuid-->` — written for you; leave it be |

---

## Contributing / issues

Use [GitHub Issues](https://github.com/ahmedbenarab/Ankipapers/issues) for bug reports and feature ideas.

## License

[MIT](LICENSE) — Copyright (c) 2026 Dr. Ahmed Benarab.
