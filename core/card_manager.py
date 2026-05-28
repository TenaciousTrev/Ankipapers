"""
Card Manager for Anki Papers.

Handles creating, updating, and deleting Anki notes based on parsed cards.
Manages the synchronization between paper content and the Anki collection.
"""

import re
import uuid
from typing import List, Tuple, Optional, Dict, Any
from .paper import Paper, CardReference
from .parser import (
    ParsedCard,
    extract_cards,
    get_context_heading,
)


ANKIPAPERS_TAG = "AnkiPapers"
ANKIPAPERS_FIELD = "AnkiPapers_Source"

# Shared card styling — elegant, minimalistic, works in both Anki light & dark modes
_ANKIPAPERS_CSS = """
/* ─── Base Card ─────────────────────────────────── */
.ankipapers-card {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 20px;
  line-height: 1.65;
  color: #1a1a2e;
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 28px;
  text-align: left;
}

/* ─── Context / Heading ─────────────────────────── */
.ap-meta {
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(0,0,0,0.1);
}

.ap-meta-heading {
  font-size: 18px; /* Increased from 14px */
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #6c5ce7;
  margin-bottom: 4px;
}

.ap-meta-block {
  font-size: 16px; /* Increased from 12px */
  font-weight: 600;
  color: #000000;
}

/* Dark Mode Meta Support */
.nightMode .ap-meta {
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.nightMode .ap-meta-block {
  color: #e0e0e0;
}

/* ─── Revealed Text Colors ──────────────────────── */

/* Basic Cards (Default/Light: Forest Green) */
.ap-answer-basic {
  color: #228B22; 
}
/* Basic Cards (Dark: Light Green) */
.nightMode .ap-answer-basic {
  color: #82E0AA; 
}

/* Reversible Cards (Default/Light: Royal Blue) */
.ap-answer-reversible {
  color: #4169E1; 
}
/* Reversible Cards (Dark: Carolina Blue) */
.nightMode .ap-answer-reversible {
  color: #4B9CD3; 
}

/* Cloze Deletions (Reddish/Pink) */
.cloze {
  color: #e83e8c;
  font-weight: 600;
}
.nightMode .cloze {
  color: #ff8fb3; /* Slightly brighter so it pops on dark backgrounds */
}

/* ─── Question (Front) ──────────────────────────── */
.ap-question {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.55;
  color: inherit;
}

/* ─── Answer (Back) ─────────────────────────────── */
.ap-answer {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.55;
}

/* ─── Cloze ─────────────────────────────────────── */
.ap-cloze {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.55;
  color: inherit;
}

/* ─── Divider ───────────────────────────────────── */
.ap-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(108, 92, 231, 0.35), transparent);
  margin: 28px 0;
  border: none;
}

/* ─── Direction Badge (Reversible) ──────────────── */
.ap-direction {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #6c5ce7;
  background: rgba(108, 92, 231, 0.08);
  padding: 4px 10px;
  border-radius: 6px;
  margin-bottom: 14px;
}

/* ─── Footer & Jump Button ──────────────────────── */
.ap-footer {
  margin-top: 32px;
  text-align: center;
}
.ap-jump {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: transparent;
  border: 1px solid rgba(108, 92, 231, 0.22);
  border-radius: 8px;
  color: #6c5ce7;
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}
.ap-jump:hover {
  background: rgba(108, 92, 231, 0.08);
  border-color: #6c5ce7;
}
.ap-jump svg {
  opacity: 0.7;
}

/* ─── Inline Elements ───────────────────────────── */
b, strong { font-weight: 600; }
i, em { font-style: italic; }
code {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.82em;
  background: rgba(108, 92, 231, 0.07);
  padding: 2px 6px;
  border-radius: 4px;
  color: #6c5ce7;
}
img {
  max-width: 100%;
  border-radius: 8px;
  margin: 10px 0;
}

/* ─── Markdown Table ────────────────────────────── */
.ankipapers-md-table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 16px;
}
.ankipapers-md-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 2px solid rgba(108, 92, 231, 0.25);
  font-weight: 600;
  color: #6c5ce7;
}
.ankipapers-md-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

/* ─── Dark Mode (Anki native .nightMode / .night_mode) ─── */
.nightMode .ankipapers-card,
.night_mode .ankipapers-card {
  color: #e8e8f0;
}
.nightMode .ap-answer,
.night_mode .ap-answer {
  color: #6ecf8a;
}
.nightMode .ankipapers-md-table td,
.night_mode .ankipapers-md-table td {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}
"""

_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_STRIKE_RE = re.compile(r"~~(.+?)~~")
_CODE_RE = re.compile(r"`([^`]+?)`")
_MATH_BLOCK_RE = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
_MATH_INLINE_RE = re.compile(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)")


def _md_inline_to_html(text: str) -> str:
    """Convert lightweight inline markdown to HTML."""
    if not text:
        return text
    r = text
    r = _MATH_BLOCK_RE.sub(r"\\[\1\\]", r)
    r = _MATH_INLINE_RE.sub(r"\\(\1\\)", r)
    r = _IMG_RE.sub(r'<img src="\2">', r)
    r = _BOLD_RE.sub(r"<b>\1</b>", r)
    r = _ITALIC_RE.sub(r"<i>\1</i>", r)
    r = _STRIKE_RE.sub(r"<s>\1</s>", r)
    r = _CODE_RE.sub(r"<code>\1</code>", r)
    return r


def _split_md_table_row(line: str) -> List[str]:
    raw = line.strip()
    if raw.startswith("|"):
        raw = raw[1:]
    if raw.endswith("|"):
        raw = raw[:-1]
    return [c.strip() for c in raw.split("|")]


def _is_md_table_separator(line: str) -> bool:
    cells = _split_md_table_row(line)
    if len(cells) < 2:
        return False
    for c in cells:
        cc = c.strip()
        if not cc:
            return False
        if not re.fullmatch(r":?-{3,}:?", cc):
            return False
    return True


def _is_md_table_row(line: str) -> bool:
    s = line.strip()
    return s.startswith("|") and s.endswith("|") and "|" in s[1:-1]


def _md_to_html(text: str) -> str:
    """Convert lightweight markdown (including tables) to HTML for note fields."""
    if not text:
        return text

    lines = text.split("\n")
    out: List[str] = []
    i = 0
    n = len(lines)

    while i < n:
        if (
            i + 1 < n
            and _is_md_table_row(lines[i])
            and _is_md_table_separator(lines[i + 1])
        ):
            header_cells = _split_md_table_row(lines[i])
            body_rows: List[List[str]] = []
            j = i + 2
            while j < n and _is_md_table_row(lines[j]):
                body_rows.append(_split_md_table_row(lines[j]))
                j += 1

            head_html = "".join(
                f"<th>{_md_inline_to_html(cell)}</th>" for cell in header_cells
            )
            body_html = "".join(
                "<tr>"
                + "".join(f"<td>{_md_inline_to_html(cell)}</td>" for cell in row)
                + "</tr>"
                for row in body_rows
            )
            out.append(
                '<table class="ankipapers-md-table"><thead><tr>'
                + head_html
                + "</tr></thead><tbody>"
                + body_html
                + "</tbody></table>"
            )
            i = j
            continue

        out.append(_md_inline_to_html(lines[i]))
        i += 1

    return "\n".join(out)


class AnkiEditConflictAbort(Exception):
    """Raised when generate_cards(..., anki_edit_conflict='abort') and conflicts exist."""

    def __init__(self, conflicts: List[Dict[str, Any]]):
        self.conflicts = conflicts
        super().__init__(f"{len(conflicts)} anki_edit_conflicts")


def _normalize_field_value(text: str) -> str:
    """Compare Anki field HTML to plain paper text more reliably."""
    if not text:
        return ""
    s = re.sub(r"<[^>]+>", " ", text)
    return " ".join(s.split()).strip()


def _paper_derived_field_values(card: ParsedCard, paper: Paper) -> List[str]:
    """What the note fields would contain if generated right now."""
    context = get_context_heading(paper.content, card.line_index)
    if card.card_type in ("basic", "reversible"):
        return [_md_to_html(card.front), _md_to_html(card.back), context]
    if card.card_type == "cloze":
        return [_md_to_html(card.cloze_text), context]
    return []


def _note_semantic_match(note, card: ParsedCard, paper: Paper) -> bool:
    """True if note fields match what the current paper line would produce (ignoring source field)."""
    exp = _paper_derived_field_values(card, paper)
    if card.card_type in ("basic", "reversible"):
        actual = [note.fields[0], note.fields[1], note.fields[2]]
    elif card.card_type == "cloze":
        actual = [note.fields[0], note.fields[1]]
    else:
        return True
    if len(actual) != len(exp):
        return False
    return all(
        _normalize_field_value(a) == _normalize_field_value(e) for a, e in zip(actual, exp)
    )


def _resolve_existing_ref_for_card(
    card: ParsedCard,
    refs_by_block_id: Dict[str, CardReference],
    existing_by_hash: Dict[str, CardReference],
) -> Optional[CardReference]:
    if card.block_id and card.block_id in refs_by_block_id:
        return refs_by_block_id[card.block_id]
    if card.content_hash in existing_by_hash:
        return existing_by_hash[card.content_hash]
    return None


def list_anki_edit_conflicts(paper: Paper, col) -> List[Dict[str, Any]]:
    """
    Cards whose paper line text is unchanged (same content_hash as ref) but the Anki
    note's front/back/cloze/context no longer matches the paper (edited in Browser/Editor).
    """
    cards = extract_cards(paper.content)
    refs_by_block_id: Dict[str, CardReference] = {}
    existing_by_hash: Dict[str, CardReference] = {}
    for ref in paper.card_refs:
        if ref.block_id:
            refs_by_block_id[ref.block_id] = ref
        if ref.content_hash:
            existing_by_hash[ref.content_hash] = ref

    out: List[Dict[str, Any]] = []
    for card in cards:
        existing_ref = _resolve_existing_ref_for_card(
            card, refs_by_block_id, existing_by_hash
        )
        if not existing_ref or not existing_ref.anki_note_id:
            continue
        if existing_ref.content_hash != card.content_hash:
            continue
        try:
            note = col.get_note(existing_ref.anki_note_id)
        except Exception:
            continue
        if _note_semantic_match(note, card, paper):
            continue
        out.append(
            {
                "line_index": card.line_index,
                "block_id": existing_ref.block_id or card.block_id,
                "anki_note_id": existing_ref.anki_note_id,
                "card_type": card.card_type,
            }
        )
    return out


def ensure_note_types(col):
    """Ensure the required note types exist in the collection."""
    _ensure_basic_type(col)
    _ensure_reversible_type(col)
    _ensure_cloze_type(col)


def _ensure_basic_type(col):
    """Create the AnkiPapers Basic note type if it doesn't exist."""
    model_name = "AnkiPapers Basic"
    model = col.models.by_name(model_name)

    if model is None:
        model = col.models.new(model_name)

        # Add fields
        front_field = col.models.new_field("Front")
        col.models.add_field(model, front_field)

        back_field = col.models.new_field("Back")
        col.models.add_field(model, back_field)

        context_field = col.models.new_field("Context")
        col.models.add_field(model, context_field)

        source_field = col.models.new_field(ANKIPAPERS_FIELD)
        col.models.add_field(model, source_field)

        # Add template
        tmpl = col.models.new_template("Card 1")
        tmpl["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
<div class="ap-question">{{Front}}</div>
<script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-basic">{{Back}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl)

        model["css"] = _ANKIPAPERS_CSS
        col.models.add(model)
    else:
        model["css"] = _ANKIPAPERS_CSS
        tmpl = model["tmpls"][0]
        tmpl["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
<div class="ap-question">{{Front}}</div>
<script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-basic">{{Back}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.save(model)


def _ensure_cloze_type(col):
    """Create the AnkiPapers Cloze note type if it doesn't exist."""
    model_name = "AnkiPapers Cloze"
    model = col.models.by_name(model_name)

    if model is None:
        model = col.models.new(model_name)
        model["type"] = 1  # Cloze type

        # Add fields
        text_field = col.models.new_field("Text")
        col.models.add_field(model, text_field)

        context_field = col.models.new_field("Context")
        col.models.add_field(model, context_field)

        source_field = col.models.new_field(ANKIPAPERS_FIELD)
        col.models.add_field(model, source_field)

        # Add template
        tmpl = col.models.new_template("Cloze")
        tmpl["qfmt"] = '''<div class="ankipapers-card">
    <div class="ap-meta" id="ctx">{{Context}}</div>
    <div class="ap-cloze">{{cloze:Text}}</div>
    <script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
    </script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-cloze">{{cloze:Text}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl)

        model["css"] = _ANKIPAPERS_CSS
        col.models.add(model)
    else:
        model["css"] = _ANKIPAPERS_CSS
        tmpl = model["tmpls"][0]
        tmpl["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
  <div class="ap-cloze">{{cloze:Text}}</div>
  <script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-cloze">{{cloze:Text}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.save(model)


def _ensure_reversible_type(col):
    """Create the AnkiPapers Reversible note type if it doesn't exist."""
    model_name = "AnkiPapers Reversible"
    model = col.models.by_name(model_name)

    if model is None:
        model = col.models.new(model_name)

        # Add fields
        front_field = col.models.new_field("Front")
        col.models.add_field(model, front_field)

        back_field = col.models.new_field("Back")
        col.models.add_field(model, back_field)

        context_field = col.models.new_field("Context")
        col.models.add_field(model, context_field)

        source_field = col.models.new_field(ANKIPAPERS_FIELD)
        col.models.add_field(model, source_field)

        # Forward template (Front → Back)
        tmpl1 = col.models.new_template("Forward")
        tmpl1["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl1["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Back}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl1)

        # Reverse template (Back → Front)
        tmpl2 = col.models.new_template("Reverse")
        tmpl2["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl2["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Front}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl2)

        model["css"] = _ANKIPAPERS_CSS
        col.models.add(model)
    else:
        model["css"] = _ANKIPAPERS_CSS
        tmpl1 = model["tmpls"][0]
        tmpl1["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl1["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Back}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        
        tmpl2 = model["tmpls"][1]
        tmpl2["qfmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta" id="ctx">{{Context}}</div>
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <script>
(function() {
  var tags = "{{Tags}}".split(" ");
  if (tags.indexOf("ap-no-hierarchy") !== -1) {
    document.getElementById("ctx").style.display = "none";
  }
})();
</script>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl2["afmt"] = '''<div class="ankipapers-card">
  <div class="ap-meta">{{Context}}</div>
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Front}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.save(model)





def get_deck_id(col, deck_name: str) -> int:
    """Get or create a deck and return its ID."""
    deck = col.decks.by_name(deck_name)
    if deck:
        return deck["id"]
    # id_for_name creates the deck if it doesn't exist
    return col.decks.id_for_name(deck_name)


def _update_note_from_card(col, note, card: ParsedCard, paper: Paper, deck_id: int) -> bool:
    """Apply parsed card fields to an existing note. Returns True on success."""
    try:
        context = get_context_heading(paper.content, card.line_index)
        source_ref = f"{paper.id}:{card.line_index}"

        if card.card_type == "basic":
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref
        elif card.card_type == "reversible":
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref
        elif card.card_type == "cloze":
            note.fields[0] = _md_to_html(card.cloze_text)
            note.fields[1] = context
            note.fields[2] = source_ref
        else:
            return False

        note.model()["did"] = deck_id
        if hasattr(col, "update_note"):
            col.update_note(note)
        else:
            note.flush()
        return True
    except Exception as e:
        print(f"[Anki Papers] Error updating note: {e}")
        return False


def generate_cards(
    paper: Paper,
    col,
    anki_edit_conflict: str = "preserve",
) -> Tuple[int, int, int]:
    """
    Generate/update Anki cards from a paper.

    anki_edit_conflict:
        preserve — if the paper line is unchanged but Anki was edited, leave Anki as-is.
        overwrite — push paper text into Anki for those rows.
        abort — if any such conflict exists, raise AnkiEditConflictAbort before changes.

    Returns:
        Tuple of (created, updated, deleted) counts.
    """
    ensure_note_types(col)

    if anki_edit_conflict not in ("preserve", "overwrite", "abort"):
        anki_edit_conflict = "preserve"

    conflicts = list_anki_edit_conflicts(paper, col)
    if anki_edit_conflict == "abort" and conflicts:
        raise AnkiEditConflictAbort(conflicts)

    cards = extract_cards(paper.content)
    deck_id = get_deck_id(col, paper.deck_name)

    created = 0
    updated = 0
    deleted = 0

    old_refs = list(paper.card_refs)
    refs_by_block_id: Dict[str, CardReference] = {}
    existing_by_hash: Dict[str, CardReference] = {}
    for ref in old_refs:
        if ref.block_id:
            refs_by_block_id[ref.block_id] = ref
        if ref.content_hash:
            existing_by_hash[ref.content_hash] = ref

    new_card_refs: List[CardReference] = []

    for card in cards:
        existing_ref = _resolve_existing_ref_for_card(
            card, refs_by_block_id, existing_by_hash
        )

        reused = False
        if existing_ref and existing_ref.anki_note_id:
            try:
                note = col.get_note(existing_ref.anki_note_id)
            except Exception:
                note = None
            if note is not None:
                bid = card.block_id or existing_ref.block_id
                if existing_ref.content_hash != card.content_hash:
                    if _update_note_from_card(col, note, card, paper, deck_id):
                        updated += 1
                else:
                    if not _note_semantic_match(note, card, paper):
                        if anki_edit_conflict == "overwrite":
                            if _update_note_from_card(col, note, card, paper, deck_id):
                                updated += 1
                if not bid:
                    bid = str(uuid.uuid4())
                new_card_refs.append(
                    CardReference(
                        line_index=card.line_index,
                        card_type=card.card_type,
                        anki_note_id=existing_ref.anki_note_id,
                        content_hash=card.content_hash,
                        synced=True,
                        block_id=bid,
                    )
                )
                reused = True
        if reused:
            continue

        note_id = _create_note(col, card, paper, deck_id)
        if note_id:
            bid = card.block_id or str(uuid.uuid4())
            new_card_refs.append(
                CardReference(
                    line_index=card.line_index,
                    card_type=card.card_type,
                    anki_note_id=note_id,
                    content_hash=card.content_hash,
                    synced=True,
                    block_id=bid,
                )
            )
            created += 1

    kept = {r.anki_note_id for r in new_card_refs if r.anki_note_id}
    for old_ref in old_refs:
        if old_ref.anki_note_id and old_ref.anki_note_id not in kept:
            try:
                col.remove_notes([old_ref.anki_note_id])
                deleted += 1
            except Exception:
                pass

    paper.card_refs = new_card_refs
    return created, updated, deleted


def _create_note(col, card: ParsedCard, paper: Paper, deck_id: int) -> Optional[int]:
    """Create a single Anki note from a ParsedCard."""
    try:
        context = get_context_heading(paper.content, card.line_index)
        source_ref = f"{paper.id}:{card.line_index}"

        # Build tags
        tags = [ANKIPAPERS_TAG]
        if paper.tags:
            tags.extend(paper.tags)
        # Add paper title as tag (sanitized)
        paper_tag = f"AnkiPapers::{paper.title.replace(' ', '_')}"
        tags.append(paper_tag)

        if card.card_type == "basic":
            model = col.models.by_name("AnkiPapers Basic")
            if not model:
                return None
            note = col.new_note(model)
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref

        elif card.card_type == "reversible":
            model = col.models.by_name("AnkiPapers Reversible")
            if not model:
                return None
            note = col.new_note(model)
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref

        elif card.card_type == "cloze":
            model = col.models.by_name("AnkiPapers Cloze")
            if not model:
                return None
            note = col.new_note(model)
            note.fields[0] = _md_to_html(card.cloze_text)
            note.fields[1] = context
            note.fields[2] = source_ref

        else:
            return None

        note.tags = tags

        # Set the deck
        note.model()["did"] = deck_id

        col.add_note(note, deck_id)
        return note.id

    except Exception as e:
        print(f"[Anki Papers] Error creating note: {e}")
        return None


def remove_paper_cards(paper: Paper, col) -> int:
    """Remove all Anki cards associated with a paper."""
    removed = 0
    note_ids = []
    for ref in paper.card_refs:
        if ref.anki_note_id:
            note_ids.append(ref.anki_note_id)

    if note_ids:
        try:
            col.remove_notes(note_ids)
            removed = len(note_ids)
        except Exception as e:
            print(f"[Anki Papers] Error removing notes: {e}")

    paper.clear_card_refs()
    return removed
