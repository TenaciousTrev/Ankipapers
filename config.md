# Anki Papers Configuration

- **default_deck**: The default Anki deck where generated cards will be added.
- **auto_save_interval_seconds**: How often papers are auto-saved (in seconds).
- **theme**: UI theme - "auto" (follows Anki), "dark", or "light".
- **font_size**: Editor font size in pixels.
- **font_family**: Editor font family.
- **show_line_numbers**: Show each line's number in a gutter on the left of the editor and Source view. The number is the line's real position in the paper, so folded sections leave a gap. On by default.
- **basic_card_separator**: The separator syntax for basic cards (default: ">>").
- **cloze_syntax**: Cloze syntax style - "curly_braces" uses {{text}}.
- **text_replacements_enabled**: macOS only. Apply your macOS Text Replacements (System Settings → Keyboard → Text Replacements) as you type in the editor — type a shortcut, then Space or Return. On by default; Anki's web engine doesn't do this on its own.
- **color_scheme**: The app's colours, which the Basic card style follows too: `"carolina"` (Carolina blue and #19468D), `"purple"` (the original purple) or `"mono"` (black & white, keeping the green / amber / pink card-type colours). Changing it in Settings restyles every Anki Papers card at once.
- **card_style**: How your Anki cards look. `"basic"` is the built-in style; `"solarized"` is Solarized Styling (light in Anki's light mode, dark in dark mode). Changing it in Settings restyles every Anki Papers card at once.
