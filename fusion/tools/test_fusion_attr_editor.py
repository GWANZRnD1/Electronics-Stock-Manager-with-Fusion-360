"""Tests for fusion_attr_editor. Run: python -m unittest -v (from this folder)."""

import unittest

from fusion_attr_editor import generate_scr, row_key, quote


def edited_row(ds="0.068_OHMS", variant="0603(1608METRIC)", tech="0603(1608METRIC)", **attrs):
    return {"deviceset": ds, "variant": variant, "technology": tech, "attributes": attrs}


def original(attrs, ds="0.068_OHMS", variant="0603(1608METRIC)", tech="0603(1608METRIC)"):
    return {(ds, variant, tech): attrs}


class GenerateScrTest(unittest.TestCase):
    def test_renaming_a_column_sets_new_and_deletes_old(self):
        orig = original({"DIGIKEY": "273-ND"})
        scr, sets, dels, blocks = generate_scr(orig, [edited_row(SPN="273-ND")])
        self.assertEqual((sets, dels, blocks), (1, 1, 1))
        self.assertIn("ATTRIBUTE SPN '273-ND';", scr)
        self.assertIn("ATTRIBUTE DIGIKEY DELETE;", scr)
        self.assertIn("EDIT '0.068_OHMS.dev';", scr)
        self.assertIn("PACKAGE '0603(1608METRIC)';", scr)

    def test_adding_supplier_classification_is_a_single_set(self):
        orig = original({"SPN": "273-ND"})
        scr, sets, dels, _ = generate_scr(orig, [edited_row(SPN="273-ND", SUPPLIER="Digikey")])
        self.assertEqual((sets, dels), (1, 0))
        self.assertIn("ATTRIBUTE SUPPLIER 'Digikey';", scr)

    def test_no_changes_produces_no_blocks(self):
        orig = original({"SPN": "273-ND"})
        scr, _, _, blocks = generate_scr(orig, [edited_row(SPN="273-ND")])
        self.assertEqual(blocks, 0)
        self.assertNotIn("EDIT", scr)

    def test_unnamed_variant_and_technology_omit_navigation(self):
        orig = original({"DIGIKEY": "x"}, variant="", tech="")
        scr, _, _, _ = generate_scr(orig, [edited_row(variant="", tech="", SPN="x")])
        self.assertNotIn("PACKAGE", scr)
        self.assertNotIn("TECHNOLOGY", scr)
        self.assertIn("EDIT '0.068_OHMS.dev';", scr)

    def test_clearing_a_cell_deletes_the_attribute(self):
        orig = original({"NOTES": "old"})
        scr, _, dels, _ = generate_scr(orig, [edited_row(NOTES="")])
        self.assertEqual(dels, 1)
        self.assertIn("ATTRIBUTE NOTES DELETE;", scr)

    def test_purge_deletes_even_empty_keys(self):
        orig = original({"DIGIKEY": "", "SPN": "273-ND"})
        scr, sets, dels, _ = generate_scr(
            orig, [edited_row(DIGIKEY="", SPN="273-ND")], purge=frozenset({"DIGIKEY"})
        )
        self.assertEqual(dels, 1)
        self.assertIn("ATTRIBUTE DIGIKEY DELETE;", scr)

    def test_quote_doubles_internal_apostrophe(self):
        self.assertEqual(quote("a'b"), "'a''b'")

    def test_row_key_uses_three_identity_fields(self):
        self.assertEqual(
            row_key({"deviceset": "D", "variant": "V", "technology": "T", "package": "P"}),
            ("D", "V", "T"),
        )


if __name__ == "__main__":
    unittest.main()
