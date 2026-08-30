"""
Syntax parser for Anki Papers.

Parses paper content and extracts flashcard definitions using special syntax:

- Basic cards:      Question >> Answer
- Reversible cards: Front <> Back  (creates forward AND reverse cards)
- Cloze cards:      Text with {{cloze deletion}} in it
- Numbered cloze:   Text with {{c1::first}} and {{c2::second}}
- Headings:         # Heading (not a card, used for organization)
"""

import re
import hashlib
from typing import List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class ParsedCard:
    """Represents a parsed card extracted from text."""

    line_index: int
    card_type: str  # "basic", "reversible", or "cloze"
    raw_text: str
    front: str  # For basic cards
    back: str  # For basic cards
    cloze_text: str  # For cloze cards (with Anki {{c1::...}} syntax)
    content_hash: str
    block_id: Optional[str] = None  # stable id from <!--ap:uuid--> suffix
    supplement: str = ""
    inline_tags: List[str] = None  # Add this to store our [[tags]]
    
    @property
    def is_valid(self) -> bool:
        if self.card_type in ("basic", "reversible"):
            return bool(self.front.strip() and self.back.strip())
        elif self.card_type == "cloze":
            return bool(self.cloze_text.strip())
        return False


@dataclass
class ParsedLine:
    """Represents a parsed line from the document."""

    index: int
    raw_text: str
    line_type: str  # "heading", "basic", "reversible", "cloze", "text"
    heading_level: int  # 0 if not a heading
    indent_level: int  # Number of indent levels
    card: Optional[ParsedCard]


# ─── Regex Patterns ────────────────────────────────────────────

# Basic card: "Question >> Answer"
BASIC_CARD_PATTERN = re.compile(r"^(.*?)\s*>>\s*(.+)$")

# Reversible card: "Front <> Back"
REVERSIBLE_CARD_PATTERN = re.compile(r"^(.*?)\s*<>\s*(.+)$")

# Cloze with explicit numbering: {{c1::text}}
CLOZE_NUMBERED_PATTERN = re.compile(r"\{\{c(\d+)::(.+?)\}\}")

# Cloze without numbering: {{text}}
CLOZE_SIMPLE_PATTERN = re.compile(r"\{\{([^}:]+?)\}\}")

# Heading: # Heading, ## Heading, etc.
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+)$")

# Bullet point: - text or * text
BULLET_PATTERN = re.compile(r"^(\s*)([-*])\s+(.+)$")

# Stable block id suffix (hidden in source; stripped before card patterns / hash)
BLOCK_ID_SUFFIX = re.compile(
    r"\s*<!--ap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-->\s*$",
    re.IGNORECASE,
)

# Inline tags: [[tag]]
INLINE_TAG_PATTERN = re.compile(r"\[\[(.*?)\]\]")


def split_stable_block_id(text: str) -> Tuple[str, Optional[str]]:
    """Remove trailing <!--ap:uuid--> from a line; return (body, uuid or None)."""
    if not text:
        return text, None
    m = BLOCK_ID_SUFFIX.search(text)
    if not m:
        return text, None
    return text[: m.start()].rstrip(), m.group(1)


def inject_stable_block_id(content: str, line_index: int, block_id: str) -> str:
    """Append <!--ap:uuid--> to a line if not already present.

    The anchor is written flush against the text, with no separating space.
    This matches ensureApBlockId() in web_src/src/docLinks.js, and it is not
    cosmetic: the editor's AP_BLOCK_ID_TAIL regex deliberately does not
    swallow whitespace in front of the anchor (a space typed at the end of a
    line is the last character at the moment it is pressed, so stripping it
    made the space bar appear dead on any anchored line). An anchor written
    as "text <!--ap:...-->" would therefore leave a trailing space visible in
    the editor on every card line. Write it the way the editor writes it.
    """
    lines = content.split("\n")
    if line_index < 0 or line_index >= len(lines):
        return content
    line = lines[line_index]
    if BLOCK_ID_SUFFIX.search(line):
        return content
    lines[line_index] = line.rstrip() + f"<!--ap:{block_id}-->"
    return "\n".join(lines)


def inject_stable_block_ids(content: str, assignments) -> str:
    """Apply inject_stable_block_id for many (line_index, block_id) pairs.

    Injection never changes the number of lines, so line indices stay valid
    across the whole batch. Lines that already carry an anchor are left
    untouched, so this is idempotent.
    """
    for line_index, block_id in assignments:
        if not block_id:
            continue
        content = inject_stable_block_id(content, line_index, block_id)
    return content


def compute_hash(text: str) -> str:
    """Compute a content hash for change detection."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


def parse_line(index: int, line: str) -> ParsedLine:
    """Parse a single line and determine its type and card content."""

    stripped = line.rstrip()

    # Count indent level (tabs or 4 spaces)
    indent_level = 0
    temp = stripped
    while temp.startswith("    ") or temp.startswith("\t"):
        indent_level += 1
        if temp.startswith("\t"):
            temp = temp[1:]
        else:
            temp = temp[4:]

    content = stripped.lstrip()

    # Empty line
    if not content:
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="text",
            heading_level=0,
            indent_level=indent_level,
            card=None,
        )

    # Check for heading
    heading_match = HEADING_PATTERN.match(content)
    if heading_match:
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="heading",
            heading_level=len(heading_match.group(1)),
            indent_level=indent_level,
            card=None,
        )

    # Strip bullet prefix for card detection
    bullet_match = BULLET_PATTERN.match(stripped)
    card_content = content
    if bullet_match:
        card_content = bullet_match.group(3)
        indent_level = len(bullet_match.group(1)) // 4

    card_content, stable_block_id = split_stable_block_id(card_content)

    # If the line is meant to be a Supplement (&&), treat it as plain text 
    # so it bypasses the card-creation regex below.
    if card_content.startswith("&& "):
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="text",
            heading_level=0,
            indent_level=indent_level,
            card=None,
        )
        
    # Extract and remove inline tags (e.g., [[nh]])
    inline_tags = []
    def extract_tag(match):
        inline_tags.append(match.group(1).strip())
        return ""
        
    card_content = INLINE_TAG_PATTERN.sub(extract_tag, card_content).strip()
    
    # Check for reversible card (Front <> Back) - must check before basic
    reversible_match = REVERSIBLE_CARD_PATTERN.match(card_content)
    if reversible_match:
        front = reversible_match.group(1).strip()
        back = reversible_match.group(2).strip()        
        content_hash = compute_hash(card_content)
        card = ParsedCard(
            line_index=index,
            card_type="reversible",
            raw_text=card_content,
            front=front,
            back=back,
            cloze_text="",
            content_hash=content_hash,
            block_id=stable_block_id,
            inline_tags=inline_tags,
        )
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="reversible",
            heading_level=0,
            indent_level=indent_level,
            card=card,
        )

    # Check for basic card (Question >> Answer)
    basic_match = BASIC_CARD_PATTERN.match(card_content)
    if basic_match:
        front = basic_match.group(1).strip()
        back = basic_match.group(2).strip()
        content_hash = compute_hash(card_content)
        card = ParsedCard(
            line_index=index,
            card_type="basic",
            raw_text=card_content,
            front=front,
            back=back,
            cloze_text="",
            content_hash=content_hash,
            block_id=stable_block_id,
            inline_tags=inline_tags,
        )
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="basic",
            heading_level=0,
            indent_level=indent_level,
            card=card,
        )

    # Check for cloze card ({{...}} syntax)
    has_numbered = CLOZE_NUMBERED_PATTERN.search(card_content)
    has_simple = CLOZE_SIMPLE_PATTERN.search(card_content)

    if has_numbered or has_simple:
        cloze_text = convert_to_anki_cloze(card_content)
        content_hash = compute_hash(card_content)
        card = ParsedCard(
            line_index=index,
            card_type="cloze",
            raw_text=card_content,
            front="",
            back="",
            cloze_text=cloze_text,
            content_hash=content_hash,
            block_id=stable_block_id,
            inline_tags=inline_tags,
        )
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="cloze",
            heading_level=0,
            indent_level=indent_level,
            card=card,
        )

    # Plain text (not a card)
    return ParsedLine(
        index=index,
        raw_text=line,
        line_type="text",
        heading_level=0,
        indent_level=indent_level,
        card=None,
    )


def convert_to_anki_cloze(text: str) -> str:
    """
    Convert paper cloze syntax to Anki cloze format.

    - {{c1::text}} → {{c1::text}}  (already in Anki format)
    - {{text}} → {{c<N>::text}}  (auto-numbered)
    """
    result = text

    # First pass: leave already-numbered clozes as-is, find max number
    numbered_matches = list(CLOZE_NUMBERED_PATTERN.finditer(result))
    max_num = 0
    for match in numbered_matches:
        num = int(match.group(1))
        max_num = max(max_num, num)

    # Second pass: auto-number simple clozes
    counter = max_num

    def replace_simple(match):
        nonlocal counter
        counter += 1
        return "{{" + f"c{counter}::{match.group(1)}" + "}}"

    result = CLOZE_SIMPLE_PATTERN.sub(replace_simple, result)

    return result


def parse_document(content: str) -> List[ParsedLine]:
    """Parse an entire document and return a list of ParsedLine objects."""
    lines = content.split("\n")
    return [parse_line(i, line) for i, line in enumerate(lines)]


def extract_cards(content: str) -> List[ParsedCard]:
    """Extract all cards from a document."""
    parsed_lines = parse_document(content)
    cards = []
    for i, line in enumerate(parsed_lines):
        if line.card and line.card.is_valid:
            supplement_texts = []
            card_indent = line.indent_level
            
            # Lookahead for child lines
            for j in range(i + 1, len(parsed_lines)):
                next_line = parsed_lines[j]
                stripped_raw = next_line.raw_text.rstrip()
                
                # Skip completely empty lines
                if not stripped_raw.strip():
                    continue
                    
                # Stop if we hit a line at the same or higher hierarchy level
                if next_line.indent_level <= card_indent:
                    break
                    
                # Process ONLY direct children (exactly 1 level deeper)
                if next_line.indent_level == card_indent + 1:
                    # Extract content (removing potential bullet prefixes)
                    child_content = stripped_raw.lstrip()
                    bullet_match = BULLET_PATTERN.match(stripped_raw)
                    if bullet_match:
                        child_content = bullet_match.group(3)
                        
                    # Check for the strict "&& " prefix
                    if child_content.startswith("&& "):
                        supplement_texts.append(child_content[3:].strip())
            
            # Assign to the card and append
            line.card.supplement = "<br>".join(supplement_texts)
            cards.append(line.card)
            
    return cards

def _strip_breadcrumb_tags(text: str) -> str:
    """Remove [[tags]] from a line that is being shown as a breadcrumb.

    A tag such as [[NH]] is an instruction to Anki Papers, not something the
    author wrote to read back. It already does its job by tagging the card, so
    printing the literal "[[NH]]" in a child card's breadcrumb is just noise.
    Everything else on the line is kept exactly as written -- that text is the
    context the breadcrumb exists to show.
    """
    cleaned = INLINE_TAG_PATTERN.sub(" ", text)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def get_block_breadcrumbs(content: str, line_index: int) -> List[str]:
    lines = content.split("\n")
    if line_index >= len(lines):
        return []

    def get_indent(text: str) -> int:
        stripped = text.rstrip()
        indent = 0
        while stripped.startswith("    ") or stripped.startswith("\t"):
            indent += 1
            stripped = stripped[1:] if stripped.startswith("\t") else stripped[4:]
        return indent

    card_level = get_indent(lines[line_index])
    if card_level == 0:
        return []

    breadcrumbs = []
    current_indent = card_level

    for i in range(line_index - 1, -1, -1):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith('#'):
            break

        line_level = get_indent(line)
            
        # Look for ANY strictly smaller indent to catch skipped levels
        if line_level < current_indent:
            # Remove bullet/number prefixes
            clean_text = re.sub(r'^[-*+]\s+', '', stripped)
            clean_text = re.sub(r'^\d+\.\s+', '', clean_text)
            # A supplement line ("&& a note") can be the parent of a card. The
            # ampersands are Anki Papers syntax marking the line as a comment,
            # not part of what was written, so they must not show up in the
            # breadcrumb on the card. Stripped after the bullet prefixes, which
            # is the same order parse_line() uses.
            clean_text = re.sub(r'^&&\s*', '', clean_text)
            clean_text = _strip_breadcrumb_tags(clean_text)

            # ----- IMPROVED IMAGE HANDLING (Markdown + HTML) -----
            def markdown_replacer(m):
                alt = m.group(1).strip()
                url = m.group(2).strip()
                if url.startswith('data:'):
                    filename = 'screenshot'
                else:
                    filename = url.split('/')[-1].split('?')[0] or 'image'
                # Show filename, optionally with alt if it's meaningful
                if alt and alt.lower() not in ('', 'pasted', 'image', 'screenshot'):
                    return f"[Image: {alt} ({filename})]"
                return f"[Image: {filename}]"

            clean_text = re.sub(r'!\[([^\]]*)\]\(([^\)]+)\)', markdown_replacer, clean_text)

            def html_img_replacer(m):
                attrs = m.group(0)
                # Try src first, then alt, then title
                src_match = re.search(r'src=["\']([^"\']+)["\']', attrs, re.I)
                filename = ''
                if src_match:
                    url = src_match.group(1)
                    filename = url.split('/')[-1].split('?')[0] if not url.startswith('data:') else 'screenshot'
                alt_match = re.search(r'alt=["\']([^"\']+)["\']', attrs, re.I)
                alt = alt_match.group(1) if alt_match else ''
                if alt and alt.lower() not in ('', 'pasted', 'image', 'screenshot') and filename:
                    return f"[Image: {alt} ({filename})]"
                elif filename:
                    return f"[Image: {filename}]"
                elif alt:
                    return f"[Image: {alt}]"
                return "[Image]"

            clean_text = re.sub(r'<img[^>]*>', html_img_replacer, clean_text, flags=re.IGNORECASE)

            # Clean up any remaining empty placeholder
            clean_text = re.sub(r'\[Image:\s*\]', '[Image]', clean_text)

            # Strip other markdown formatting
            clean_text = re.sub(r'\*\*(.*?)\*\*', r'\1', clean_text)
            clean_text = re.sub(r'__(.*?)__', r'\1', clean_text)
            clean_text = re.sub(r'\*(.*?)\*', r'\1', clean_text)
            clean_text = re.sub(r'_(.*?)_', r'\1', clean_text)

            if clean_text:
                breadcrumbs.insert(0, clean_text)

            # Update current indent so we only look for even higher parents
            current_indent = line_level

        if current_indent == 0:
            break

    return breadcrumbs

def get_context_heading(content: str, line_index: int) -> str:
    """
    Get the full heading breadcrumb path above a given line index.
    Walks upward collecting the nearest heading at each level,
    AND the parent indented blocks leading down to the line.
    """
    lines = content.split("\n")
    headings = {}  # level -> heading text
    current_min_level = 4  # Track the highest hierarchy level we've seen (1 is highest)

    for i in range(line_index, -1, -1):
        heading_match = HEADING_PATTERN.match(lines[i].strip())
        if heading_match:
            level = len(heading_match.group(1))
            # Restrict to H1-H3, and ONLY accept if it's a structural parent of what we already have
            if level <= 3 and level < current_min_level:
                text = _strip_breadcrumb_tags(heading_match.group(2))
                headings[level] = text
                current_min_level = level
                if level == 1:
                    break

    # 1. Build the heading path
    heading_path = ""
    if headings:
        sorted_levels = sorted(headings.keys())
        heading_path = " > ".join(headings[l] for l in sorted_levels)

    # 2. Get the block parent path
    block_path_list = get_block_breadcrumbs(content, line_index)

    # 3. Stitch them together using distinct HTML elements for separate styling
    context_html = ""
    if heading_path:
        context_html += f'<div class="ap-meta-heading">{heading_path}</div>'
    if block_path_list:
        block_path_str = " > ".join(block_path_list)
        context_html += f'<div class="ap-meta-block">{block_path_str}</div>'
        
    return context_html
