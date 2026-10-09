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



class ColourSchemes(unittest.TestCase):
    """Settings → Colour scheme also colours the Basic card style. Carolina is
    the base stylesheet itself; the others layer on top of it; Solarized comes
    last so it looks the same in every scheme."""

    def test_carolina_is_the_base_stylesheet(self):
        self.assertEqual(cm.card_css("basic", "carolina"), cm._ANKIPAPERS_CSS)

    def test_other_schemes_layer_after_the_base(self):
        for scheme, layer in (("purple", cm._PURPLE_CSS), ("mono", cm._MONO_CSS)):
            css = cm.card_css("basic", scheme)
            self.assertEqual(css, cm._ANKIPAPERS_CSS + layer, scheme)

    def test_purple_restores_the_original_colours(self):
        css = cm.card_css("basic", "purple")
        for colour in ("#6c5ce7", "#4169E1", "#123a8a", "#7aa7ff"):
            self.assertIn(colour, css)

    def test_mono_keeps_the_answer_colours(self):
        # Greyscale chrome, but the card-type colours come from the base sheet.
        self.assertNotIn("ap-answer-basic", cm._MONO_CSS)
        self.assertNotIn("ap-answer-reversible", cm._MONO_CSS)
        self.assertNotIn(".cloze", cm._MONO_CSS)

    def test_solarized_comes_after_the_scheme(self):
        for scheme in cm.COLOR_SCHEMES:
            css = cm.card_css("solarized", scheme)
            self.assertTrue(css.endswith(cm._SOLARIZED_CSS), scheme)

    def test_unknown_scheme_falls_back_to_carolina(self):
        for scheme in (None, "", "nope"):
            self.assertEqual(cm.card_css("basic", scheme), cm._ANKIPAPERS_CSS)
        self.assertEqual(cm.card_css("basic", " PURPLE "), cm.card_css("basic", "purple"))

    def test_scheme_is_written_to_all_three_note_types(self):
        col = FakeCol()
        cm.ensure_note_types(col, "basic", "mono")
        for n in NAMES:
            self.assertEqual(col.models.models[n]["css"], cm.card_css("basic", "mono"))


if __name__ == "__main__":
    unittest.main()
