/**
 * Bridge module — talks to the Python backend over AnkiWebView's pycmd()
 * channel (aqt.webview.AnkiWebView injects window.pycmd(arg, cb) once its
 * internal message channel is up; cb receives the handler's return value
 * already JSON.parse()'d — see gui/bridge.py's handle()).
 *
 * Every command is sent as "ankipapers:" + JSON.stringify({cmd, args}); the
 * prefix keeps our messages from being mistaken for another add-on's or for
 * AnkiWebView's own "domDone"/"close" commands.
 */

import { searchPapersAdvanced } from './searchQuery.js';

const CMD_PREFIX = 'ankipapers:';
const PYCMD_POLL_MS = 25;
const PYCMD_WARN_MS = 10000;

let _mockBridge = null;
let _readyPromise = null;
let _warnedSlow = false;

function _sendToPycmd(name, args) {
  return new Promise((resolve) => {
    window.pycmd(CMD_PREFIX + JSON.stringify({ cmd: name, args }), resolve);
  });
}

/** Core transport: one call for every bridge command. */
export function call(name, args = {}) {
  if (typeof window.pycmd === 'function') {
    return _sendToPycmd(name, args);
  }

  // Vite dev server with no Anki behind it: use the mock table so the UI is
  // usable standalone. Never falls back to the mock in a production build —
  // if pycmd hasn't shown up yet there, we just keep waiting for it.
  if (import.meta.env.DEV) {
    if (!_mockBridge) _mockBridge = createMockBridge();
    const fn = _mockBridge[name];
    if (!fn) return Promise.resolve({ error: `${name} not available (mock bridge)` });
    return Promise.resolve(fn(args));
  }

  return new Promise((resolve) => {
    let waited = 0;
    const iv = setInterval(() => {
      if (typeof window.pycmd === 'function') {
        clearInterval(iv);
        _sendToPycmd(name, args).then(resolve);
        return;
      }
      waited += PYCMD_POLL_MS;
      if (!_warnedSlow && waited >= PYCMD_WARN_MS) {
        _warnedSlow = true;
        console.error('[AnkiPapers] window.pycmd has not appeared after 10s; still waiting (cmd:', name, ')');
      }
    }, PYCMD_POLL_MS);
  });
}

/** Resolves once the bridge (real pycmd, or the DEV mock) is usable. */
export function initBridge() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = new Promise((resolve) => {
    if (typeof window.pycmd === 'function') {
      resolve();
      return;
    }
    if (import.meta.env.DEV) {
      if (!_mockBridge) _mockBridge = createMockBridge();
      resolve();
      return;
    }
    const iv = setInterval(() => {
      if (typeof window.pycmd === 'function') {
        clearInterval(iv);
        resolve();
      }
    }, PYCMD_POLL_MS);
  });
  return _readyPromise;
}

// Paper API
export async function listPapers() {
  return call('list_papers');
}
export async function loadPaper(id) {
  const d = await call('load_paper', { paper_id: id });
  return d && d.error ? null : d;
}
export async function savePaper(data) {
  return call('save_paper', { paper: data });
}
export async function createPaper(title, folderPath = '') {
  return call('create_paper', { title, folder_path: folderPath });
}
export async function deletePaper(id) {
  return call('delete_paper', { paper_id: id });
}
export async function movePaperToFolder(id, folder) {
  return call('move_paper_to_folder', { paper_id: id, folder_path: folder });
}
/** @param {string} ankiEditConflict preserve | overwrite | abort */
export async function generateCards(id, ankiEditConflict = 'preserve') {
  const policy = ankiEditConflict || 'preserve';
  return call('generate_cards', { paper_id: id, anki_edit_conflict: policy });
}

export async function checkAnkiEditConflicts(paperId) {
  return call('check_anki_edit_conflicts', { paper_id: paperId });
}

// Decks & Folders
export async function getDecks() {
  return call('get_decks');
}
export async function getFolders() {
  return call('get_folders');
}
export async function createFolder(name, parentPath = '') {
  return call('create_folder', { name, parent_path: parentPath });
}
export async function deleteFolder(folderPath) {
  return call('delete_folder', { folder_path: folderPath || '' });
}
export async function renameFolder(oldPath, newName) {
  return call('rename_folder', { old_path: oldPath || '', new_name: (newName || '').trim() });
}
export async function moveFolder(folderPath, newParentPath) {
  return call('move_folder', { folder_path: folderPath || '', new_parent_path: newParentPath || '' });
}

// Images
export async function getMediaDir() {
  return call('get_media_dir');
}
export async function pickImage() {
  return call('pick_image');
}
/** Plain text from the system clipboard, for "Paste blocks". */
export async function getClipboardText() {
  return call('get_clipboard_text');
}

export async function pasteImage() {
  return call('paste_image');
}

// Browser linking — Python runs Browser.search_for("nid:" + id), same as manual Anki search
export async function openInBrowser(noteId) {
  const n = Number(noteId);
  if (noteId == null || noteId === '' || !Number.isFinite(n) || n <= 0) {
    console.warn('[AnkiPapers] openInBrowser: invalid note id', noteId);
    return;
  }
  await call('open_in_browser', { note_id: String(Math.trunc(n)) });
}

/** Parsed object: verify nid: search and Browser APIs (Settings debug). */
export async function diagnoseCrosslink(noteId) {
  return call('diagnose_crosslink', { note_id: String(noteId).trim() });
}

export async function moveCardsToDeck(paperId, deckName) {
  return call('move_cards_to_deck', { paper_id: paperId, deck_name: deckName });
}

// Search
export async function searchPapers(query) {
  return call('search_papers', { query });
}

// Markdown Import/Export
export async function importMarkdown() {
  return call('import_markdown');
}
export async function exportMarkdown(id) {
  return call('export_markdown', { paper_id: id });
}

// PDF Export
//
// `html` is the printable document built by printDocument.js, using the same
// parsing and inline formatting the editor uses. Python receives it through
// export_pdf_html() and only runs the save dialog and printToPdf().
//
// The older export_pdf() slot — where Python rendered the markdown itself with
// a separate, long-since-drifted converter — stays as a fallback, so a new web/
// build still exports on an install whose gui/ has not been replaced yet. The
// two halves are copied into the add-on by hand and can lag each other.
export async function exportPdf(id, html = '') {
  if (html) {
    return call('export_pdf_html', { paper_id: id, html });
  }
  return call('export_pdf', { paper_id: id });
}

// Papers on disk (phase 1: write only — the collection stays authoritative)
export async function exportPapersToDisk(mode = 'preview') {
  return call('export_papers_to_disk', { mode });
}

// Settings
export async function getSettings() {
  return call('get_settings');
}
export async function saveSettings(settings) {
  return call('save_settings', { settings });
}

export async function openUrl(url) {
  await call('open_url', { url });
}

// Source panel
export async function pickPdfFile() {
  return call('pick_pdf_file');
}
export async function getPdfViewerUrl() {
  return call('pdf_viewer_url');
}
export async function getPdfUrl(path) {
  return call('pdf_url', { path });
}
export async function extractPdfText(path, page = 1) {
  return call('extract_pdf_text', { pdf_path: path, page: Number(page || 1) });
}
export async function extractWebText(url) {
  return call('extract_web_text', { url });
}
export async function saveSourceLink(paperId, blockId, linkData) {
  return call('save_source_link', { paper_id: paperId, block_id: blockId, link: linkData || {} });
}
export async function loadSourceLink(paperId, blockId) {
  return call('load_source_link', { paper_id: paperId, block_id: blockId });
}
export async function openSourceAtLocation(linkData) {
  return call('open_source_at_location', { source: linkData || {} });
}

// ─── Mock Bridge (Vite dev server only; import.meta.env.DEV) ──────────────
// Table shape: { [name]: (args) => value }, mirroring the real dispatch dict
// in gui/bridge.py so `call(name, args)` can use either transparently.
function createMockBridge() {
  const papers = [
    {
      id: 'demo-1', title: 'Cell Biology',
      content: '# Cell Biology\n\n## Organelles\n\nWhat is the powerhouse of the cell? >> Mitochondria\n\nATP <> Adenosine Triphosphate\n\nThe {{mitochondria}} is the powerhouse of the cell.\n\n{{c1::ATP}} is produced through {{c2::oxidative phosphorylation}}.\n\n## Cell Membrane\n\n- **Phospholipid bilayer** forms the basic structure\n\n> The fluid mosaic model describes membrane structure\n\n---\n\nWhat is endocytosis? >> The process by which cells absorb molecules\n',
      deck_name: 'Biology', folder_path: 'Biology', card_refs: [], tags: [],
      created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
    },
  ];
  return {
    list_papers: () => papers,
    load_paper: ({ paper_id }) => papers.find(x => x.id === paper_id) || { error: 'not found' },
    save_paper: ({ paper }) => {
      const i = papers.findIndex(x => x.id === paper.id);
      if (i >= 0) Object.assign(papers[i], paper);
      return { ok: true };
    },
    create_paper: ({ title, folder_path }) => {
      const p = {
        id: 'p-' + Date.now(), title, content: `# ${title}\n\n`, deck_name: 'Default',
        folder_path, card_refs: [], tags: [], created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
      };
      papers.push(p);
      return p;
    },
    delete_paper: ({ paper_id }) => {
      const i = papers.findIndex(x => x.id === paper_id);
      if (i >= 0) papers.splice(i, 1);
      return { ok: true };
    },
    move_paper_to_folder: ({ paper_id, folder_path }) => {
      const p = papers.find(x => x.id === paper_id);
      if (p) p.folder_path = folder_path;
      return { ok: true };
    },
    generate_cards: () => ({ created: 3, updated: 0, deleted: 0 }),
    check_anki_edit_conflicts: () => ({ conflicts: [] }),
    get_decks: () => ['Default', 'Biology', 'Medicine'],
    get_folders: () => ({ name: 'Root', children: [{ type: 'folder', name: 'Biology', path: 'Biology', children: [] }] }),
    create_folder: () => ({ ok: true }),
    delete_folder: () => ({ ok: true }),
    rename_folder: () => ({ ok: true }),
    move_folder: () => ({ ok: true }),
    get_media_dir: () => ({ path: '', base_url: '' }),
    pick_image: () => ({ cancelled: true }),
    paste_image: () => ({ cancelled: true }),
    get_clipboard_text: () => ({ text: (typeof window !== 'undefined' && window.__clipboardText) || '' }),
    open_in_browser: ({ note_id }) => { console.log('Mock: Open in browser', note_id); return { ok: true }; },
    diagnose_crosslink: ({ note_id }) => ({
      note_id: Number(note_id) || 0,
      query: `nid:${note_id}`,
      note_found: true,
      find_cards_count: 1,
      first_cid: 1,
      browser_open: false,
      has_select_single_card: true,
    }),
    move_cards_to_deck: () => ({ ok: true }),
    search_papers: ({ query }) => searchPapersAdvanced(papers, query),
    import_markdown: () => ({ cancelled: true }),
    export_markdown: () => ({ cancelled: true }),
    export_pdf: () => ({ cancelled: true }),
    export_pdf_html: () => ({ cancelled: true }),
    export_papers_to_disk: () => ({ root: '', written: [] }),
    get_settings: () => ({
      default_deck: 'Default', auto_save_interval_seconds: 30, font_size: 14,
      font_family: 'JetBrains Mono', editor_theme: 'dark', show_card_indicators: true,
      anki_edit_conflict: 'ask',
    }),
    save_settings: () => ({ ok: true }),
    open_url: ({ url }) => { console.log('Mock: Open URL', url); return { ok: true }; },
    pick_pdf_file: () => ({ cancelled: true }),
    pdf_viewer_url: () => ({ error: 'not implemented' }),
    pdf_url: () => ({ error: 'not implemented' }),
    extract_pdf_text: ({ pdf_path, page }) => ({ ok: true, title: 'Demo PDF', text: `Extracted text from page ${page}`, path: pdf_path, page }),
    extract_web_text: ({ url }) => ({ ok: true, title: url, text: 'Extracted web content demo', url }),
    save_source_link: () => ({ ok: true }),
    load_source_link: () => ({ error: 'Source link not found' }),
    open_source_at_location: () => ({ ok: true }),
  };
}

// Expose the wrapper module on window for the Stage 4 automated regression
// driver (drives the UI purely through window.ankiPapersBridge via CDP).
if (typeof window !== 'undefined') {
  window.ankiPapersBridge = {
    call,
    initBridge,
    listPapers, loadPaper, savePaper, createPaper, deletePaper, movePaperToFolder,
    generateCards, checkAnkiEditConflicts,
    getDecks, getFolders, createFolder, deleteFolder, renameFolder, moveFolder,
    getMediaDir, pickImage, getClipboardText, pasteImage,
    openInBrowser, diagnoseCrosslink, moveCardsToDeck,
    searchPapers,
    importMarkdown, exportMarkdown, exportPdf, exportPapersToDisk,
    getSettings, saveSettings, openUrl,
    pickPdfFile, getPdfViewerUrl, getPdfUrl, extractPdfText, extractWebText,
    saveSourceLink, loadSourceLink, openSourceAtLocation,
  };
}
