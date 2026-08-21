<p align="center">
  <img src="AnkiPapers logo.svg" alt="Anki Papers Logo" width="200"/>
</p>

# Anki Papers

Write notes as **markdown papers** inside Anki and turn lines into **Basic**, **reversible**, and **cloze** cards with simple syntax—then **generate** to sync notes to your collection. One document per topic, folders, block or source editing, import/export.

Papers can also **link to each other**: highlight a phrase, point it at a heading in another document, and follow it with a double-click. A **Links panel** shows what cites the open paper, and a **graph view** shows how the whole collection connects.

**Author:** Dr. Ahmed Benarab

## Requirements

- **Anki** version compatible with [`manifest.json`](manifest.json) → `min_point_version` (compare with **Help → About** in Anki; this repo currently targets **231000**).
- **Qt WebEngine** (bundled with standard Anki desktop builds).

## Install (end users)

### Option A — `.ankiaddon` package

1. Build the package (see [Building the add-on package](#building-the-add-on-package)) or use a release artifact from GitHub.
2. In Anki: **Tools → Add-ons → Install from file…** and choose `Ankipapers.ankiaddon`.
3. Restart Anki if prompted.

### Option B — From this repository

1. Clone or download the repo.
2. Copy the **folder** (the one that contains `__init__.py` and `manifest.json`) into your Anki add-ons directory, e.g.:

   - **Windows:** `%APPDATA%\Anki2\addons21\Ankipapers`
   - **macOS:** `~/Library/Application Support/Anki2/addons21/Ankipapers`
   - **Linux:** `~/.local/share/Anki2/addons21/Ankipapers`

3. Ensure the bundled UI exists under `web/` (it is committed in this repo). If you removed it, run a [UI build](#building-the-web-ui) first.
4. Restart Anki.

Open **Anki Papers** from **Tools → 📝 Anki Papers**, the **📝 Papers** toolbar link, or **Ctrl+Shift+P**.

## Writing and editing

The **Editor** view renders each line as a block: headings, bullets, tables, images, math, and cards all show as formatted content, and clicking a line opens it for editing as raw markdown. The **Source** view (Ctrl+Shift+V) shows the whole document as plain text.

**Outline collapsing.** Any line with more-indented lines beneath it is a parent, and papers open with those parents collapsed so a long document starts as a readable outline. Click the chevron to open one section, or press **⇧⌘↓** to expand the entire document at once.

Use **Tab** and **Shift+Tab** to indent and outdent a line together with everything nested under it. Drag a block by its handle to move it and its children; right-click a block for edit, duplicate, merge, delete, and **Create link…**.

Large papers are supported: a document of ~1,100 lines with several hundred cards stays responsive while typing and while inserting lines.

## Linking papers

### Creating a link

1. Click into a line and **highlight the phrase** you want to turn into a link.
2. **Right-click** the highlighted phrase and choose **Create link…**.
3. Search for a target. Results are pre-filtered by the phrase you highlighted and show the full path, e.g. `Cardiology › Electrophysiology › SVT › Atrial Flutter › Typical`, so headings that share a name stay distinguishable.
4. Pick a result. The phrase becomes an underlined link.

You can link **from** body text or from a heading, and link **to** a 1st/2nd/3rd degree heading or to a whole document.

### Following a link

**Double-click** any word in a linked phrase to jump to its target. The destination heading is briefly highlighted when you arrive.

Because double-click opens links, a *single* click on a linked phrase deliberately does not place the cursor there. To edit a line containing a link, click it anywhere outside the link, or use **Edit block** in the right-click menu.

If a link's target has been deleted, following it says so instead of failing silently.

### How links survive editing

A link stores a hidden, stable anchor on the target line rather than a line number, so it keeps working after you:

- rename or reword the target heading,
- indent, outdent, reorder, or drag the heading,
- insert or delete lines anywhere above it,
- rename the target paper or move it to another folder,
- even move the heading into a **different** document.

Anchors are written into the markdown as an invisible `<!--ap:…-->` suffix and are hidden everywhere in the UI. Copying or duplicating a block deliberately strips the anchor, so two lines can never claim the same one.

### Links in flashcards

A link inside a card line is rendered on the Anki note as styled text (the phrase, never the raw markdown). Links are not clickable inside Anki itself. Note that adding a link changes the line, so that card counts as edited and will update on the next **Generate**.

## Links panel and graph

The **link icon** in the editor header opens the Links panel for the open paper:

- **Linked from** — every place that cites this paper, showing the citing sentence with the linked phrase highlighted and which heading it points at. Click an entry to jump to that exact line in the citing document.
- **Links out** — what this paper points at, with any broken targets flagged.

The panel's **Graph** button opens the link graph:

- **Documents** mode draws one node per connected paper; several links between the same pair merge into one thicker edge.
- **Headers** mode promotes each linked-to heading into its own node, tethered to its document, so you can see exactly which section is being cited. Headings nobody links to stay out of the graph.

Hover a node to dim everything unrelated, type in **Find…** to highlight matches, drag nodes to rearrange, scroll to zoom, drag the background to pan, and click a node to open it.

Both views are derived from the markdown itself — there is no separate link database that can drift out of sync with your text.

## Saving and generating

- **Save** writes the currently open paper. While it runs, both toolbar buttons grey out so a generate can't start mid-save.
- **Generate Cards** saves first, then creates/updates/removes the Anki notes for that paper.
- **Autosave** runs on a timer (interval configurable in Settings).
- **Closing the window** flushes a final save first, so recent edits aren't lost.

If a save fails, the app says so rather than reporting success.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Open Anki Papers (from Anki's main window) |
| `Ctrl+S` | Save the open paper |
| `Ctrl+G` | Generate cards |
| `Ctrl+Shift+V` | Toggle Editor / Source view |
| `Ctrl+B` / `Ctrl+I` | Bold / italic |
| `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | Undo / redo |
| `Ctrl+,` | Settings |
| `⇧⌘↓` | Expand every collapsed section in the document |
| `Tab` / `Shift+Tab` | Indent / outdent the line and its children |
| `Enter` | Split the line at the cursor |
| `Backspace` at line start | Outdent, then merge into the line above |
| `[[` | Autocomplete a link to another paper by title |

> The `Ctrl` shortcuts use the **Control** key on every platform, including macOS. **⇧⌘↓** uses **Command** and currently works on macOS only.

## Building the web UI

The interface is a **Vite + React** app in `web_src/`. Production files are emitted to `web/` (configured in `web_src/vite.config.js`).

```bash
cd web_src
npm install
npm run build
```

After changing React/CSS, run `npm run build` again before packaging or testing in Anki. The add-on loads the **built** files in `web/`, so source edits have no effect until you rebuild.

## Building the add-on package

Creates `Ankipapers.ankiaddon` (zip) for sharing or “Install from file”.

**Windows (PowerShell):**

```powershell
.\_build.ps1
```

**Windows (double-click):** run `build_ankiaddon.bat`.

The script bundles `__init__.py`, `manifest.json`, `config.json`, `config.md`, `core/`, `gui/`, and `web/`. It does **not** include `web_src/`, `user_files/`, or `node_modules/`.

## Project layout

| Path | Purpose |
|------|--------|
| `__init__.py` | Add-on entry: menu, toolbar, shortcuts |
| `manifest.json` | Anki package metadata |
| `core/` | Papers, storage, parsing, card generation |
| `core/storage.py` | Reads/writes papers in the Anki collection config |
| `core/card_manager.py` | Card generation, note types, markdown → note HTML |
| `gui/` | Qt window, `QWebChannel` bridge to the UI |
| `web/` | Built static UI (HTML/JS/CSS) loaded by the webview |
| `web_src/` | React source; build output goes to `web/` |
| `web_src/src/docLinks.js` | Link anchors, `ap://` addressing, target search, backlink and graph index |
| `web_src/src/components/BlockEditor.jsx` | The block editor |
| `web_src/src/components/LinkPicker.jsx` | “Create link…” search dialog |
| `web_src/src/components/LinksPanel.jsx` | Backlinks and outgoing links |
| `web_src/src/components/GraphView.jsx` | Link graph |
| `user_files/` | Local cache/fallback files only (gitignored; runtime-created when needed) |
| `_build.ps1` / `build_ankiaddon.bat` | Pack `Ankipapers.ankiaddon` |

## Card syntax (quick reference)

| Kind | Example |
|------|--------|
| Basic | `Question >> Answer` |
| Reversible | `Term <> Definition` |
| Cloze | `Text with {{blank}}` or `{{c1::a}} {{c2::b}}` |
| Link to a heading / paper | `[phrase](ap://…)` — created via right-click → **Create link…** |
| Quick paper link | `[[Paper title]]` |

Headings (`#`), lists, blockquotes, `---`, images `![alt](file)`, and inline formatting (`**bold**`, `` `code` ``, etc.) work in the paper content. See the in-app **home** screen cheat sheet for more.

## Settings

**Tools → Add-ons → Anki Papers → Config** (or in-app **Settings**) for default deck, autosave, fonts, theme, and behavior when Anki notes differ from the paper during **Generate**.

## Data and sync behavior

- **Papers and folder structure:** stored in Anki collection config and synced with AnkiWeb.
- **Generated flashcards/notes:** normal Anki collection data, synced as usual.
- **Link anchors:** stored inside the paper's own markdown, so they travel with the text through export, import, and copy/paste.
- **Images:** copied into your collection media folder and synced through Anki media sync.
- **`user_files/`:** used only as local fallback/cache in edge cases (for example when collection access is unavailable).

> **Note on large collections.** All papers live in a single Anki collection-config entry, which Anki transmits on every sync and documents as intended for a few kilobytes. A large library of papers will exceed that comfortably. It works, but if you keep a very large collection and sync often, this is the part to watch.

## Contributing / issues

Use [GitHub Issues](https://github.com/ahmedbenarab/Ankipapers/issues) for bug reports and feature ideas.

## License

[MIT](LICENSE) — Copyright (c) 2026 Dr. Ahmed Benarab.
