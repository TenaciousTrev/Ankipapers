"""The "Solarized Styling" card style option (Settings → Card style).

Card styling lives on the three Anki Papers note types. The chosen style is
written onto all three whenever note types are ensured (every Generate, and
when the setting changes), so switching restyles every existing card at once.

Run with:  python3 -m unittest discover -s tests
"""
import copy
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.card_manager as cm  # noqa: E402

NAMES = ("AnkiPapers Basic", "AnkiPapers Reversible", "AnkiPapers Cloze")
FIELDS = ["Front", "Back", "Text", "Context", "AnkiPapers_Source", "Supplement"]


class FakeModels:
    """Just enough of col.models for ensure_note_types on existing types."""
    def __init__(self):
        self.models = {
            n: {"name": n, "css": "old", "flds": [{"name": f} for f in FIELDS],
                "tmpls": [{"qfmt": "", "afmt": ""}, {"qfmt": "", "afmt": ""}]}
            for n in NAMES
        }
        self.saved = []

    def by_name(self, name):
        return self.models.get(name)

    def save(self, model):
        self.saved.append(model["name"])

    def __getattr__(self, name):  # anything that would create/alter structure
        raise AssertionError(f"unexpected col.models.{name} call")


class FakeCol:
    def __init__(self):
        self.models = FakeModels()


class CardCss(unittest.TestCase):
    def test_basic_is_the_builtin_stylesheet_unchanged(self):
        self.assertEqual(cm.card_css("basic"), cm._ANKIPAPERS_CSS)

    def test_solarized_layers_on_top_of_basic(self):
        css = cm.card_css("solarized")
        self.assertTrue(css.startswith(cm._ANKIPAPERS_CSS))
        self.assertIn("--ap-bg", css)
        self.assertIn(".card.nightMode", css)          # dark version in dark mode
        self.assertGreater(len(css), len(cm._ANKIPAPERS_CSS))

    def test_unknown_or_missing_style_falls_back_to_basic(self):
        for s in (None, "", "nope", "SOLARIZED "):
            self.assertEqual(cm.card_css(s), cm._ANKIPAPERS_CSS if s != "SOLARIZED " else cm.card_css("solarized"))


class EnsureNoteTypes(unittest.TestCase):
    def test_style_is_written_to_all_three_note_types(self):
        for style in ("solarized", "basic"):
            col = FakeCol()
            cm.ensure_note_types(col, style)
            for n in NAMES:
                self.assertEqual(col.models.models[n]["css"], cm.card_css(style), (style, n))
            self.assertEqual(sorted(col.models.saved), sorted(NAMES))

    def test_default_is_basic(self):
        col = FakeCol()
        cm.ensure_note_types(col)
        self.assertEqual(col.models.models["AnkiPapers Basic"]["css"], cm._ANKIPAPERS_CSS)

    def test_switching_back_restores_basic_exactly(self):
        col = FakeCol()
        cm.ensure_note_types(col, "solarized")
        cm.ensure_note_types(col, "basic")
        for n in NAMES:
            self.assertEqual(col.models.models[n]["css"], cm._ANKIPAPERS_CSS)


if __name__ == "__main__":
    unittest.main()
