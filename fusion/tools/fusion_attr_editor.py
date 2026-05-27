#!/usr/bin/env python3
"""Fusion Electronics library attribute editor (round-trip via CSV).

Manage library attributes as a plain spreadsheet instead of clicking through the
editor. Fusion is only the in/out gate (Run ULP to export, Run Script to apply);
all editing happens in a CSV you can open in Excel / any editor.

Workflow:
  1. In Fusion (Library editor):  RUN export-library.ulp  -> library.json
  2. python fusion_attr_editor.py to-csv  library.json  library.csv
  3. Edit library.csv:
       - rename a COLUMN header  -> renames that attribute on EVERY part at once
       - change a cell           -> sets a new value
       - clear a cell            -> removes that attribute on that part
       - add a column            -> adds a new attribute
     Do NOT edit the identity columns (deviceset, variant, package, technology)
     and do NOT add or remove rows.
  4. python fusion_attr_editor.py to-scr  library.json  library.csv  apply.scr
       (optional: --purge DIGIKEY  to delete an attribute entirely, even empties)
  5. In Fusion: BACK UP the library, then Automate -> Run Script -> apply.scr -> save.

Standard library only. No install, no dependencies.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
from typing import Iterable

# Identity columns are not attributes and must not be edited by the user.
IDENTITY = ("deviceset", "variant", "package", "technology")
# A row is identified by these three (package is context only).
KEY_FIELDS = ("deviceset", "variant", "technology")


def row_key(row: dict) -> tuple:
    return tuple(row.get(field, "") for field in KEY_FIELDS)


def quote(value: str) -> str:
    """Eagle single-quoted string literal (embedded ' doubled, best-effort)."""
    return "'" + str(value).replace("'", "''") + "'"


def _read_text(path: str) -> str:
    """Read a file as text, tolerating the encoding the ULP / Excel used.

    Fusion's ULP output() writes the Windows code page (cp1252), not UTF-8, so
    values like '±1%' or 'µF' are not valid UTF-8. Try strict UTF-8 first, then
    cp1252, then latin-1 (which never fails)."""
    with open(path, "rb") as handle:
        data = handle.read()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _load_rows(json_path: str) -> list[dict]:
    return json.loads(_read_text(json_path)).get("rows", [])


def to_csv(json_path: str, csv_path: str) -> int:
    """Export the library JSON to an editable CSV. Returns the row count."""
    rows = _load_rows(json_path)
    attribute_names: set[str] = set()
    for row in rows:
        attribute_names.update((row.get("attributes") or {}).keys())
    columns = list(IDENTITY) + sorted(attribute_names)

    with open(csv_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            record = {field: row.get(field, "") for field in IDENTITY}
            record.update(row.get("attributes") or {})
            writer.writerow(record)
    return len(rows)


def read_csv_rows(csv_path: str) -> list[dict]:
    """Read the edited CSV back into rows of {identity..., attributes: {...}}."""
    rows = []
    for raw in csv.DictReader(io.StringIO(_read_text(csv_path))):
        identity = {field: (raw.get(field) or "") for field in IDENTITY}
        attributes = {
            key.strip(): (value or "")
            for key, value in raw.items()
            if key and key not in IDENTITY
        }
        rows.append({**identity, "attributes": attributes})
    return rows


def original_index(json_path: str) -> dict:
    return {row_key(row): (row.get("attributes") or {}) for row in _load_rows(json_path)}


def generate_scr(
    original_by_key: dict,
    edited_rows: Iterable[dict],
    purge: frozenset = frozenset(),
) -> tuple[str, int, int, int]:
    """Diff edited rows against the original export and build the apply script.

    Returns (scr_text, set_count, delete_count, block_count).
    """
    blocks: list[str] = []
    set_count = 0
    delete_count = 0

    for row in edited_rows:
        original = original_by_key.get(row_key(row), {})
        edited = row.get("attributes") or {}
        commands: list[str] = []

        for name in sorted(set(edited) | set(original)):
            original_value = original.get(name, "")
            new_value = edited.get(name, "")

            if name in purge:
                if name in original:  # delete the key entirely, even if empty
                    commands.append(f"ATTRIBUTE {name} DELETE;")
                    delete_count += 1
                continue
            if new_value != "" and new_value != original_value:
                commands.append(f"ATTRIBUTE {name} {quote(new_value)};")
                set_count += 1
            elif new_value == "" and original_value != "":
                commands.append(f"ATTRIBUTE {name} DELETE;")
                delete_count += 1

        if not commands:
            continue

        navigation = [f"EDIT {quote(row['deviceset'] + '.dev')};"]
        if row.get("variant"):  # omit PACKAGE for an unnamed/default variant
            navigation.append(f"PACKAGE {quote(row['variant'])};")
        if row.get("technology"):  # omit TECHNOLOGY for an unnamed technology
            navigation.append(f"TECHNOLOGY {quote(row['technology'])};")
        blocks.append("\n".join(navigation + commands))

    header = (
        "# Generated by fusion_attr_editor.py\n"
        f"# {set_count} attribute set(s), {delete_count} delete(s) "
        f"across {len(blocks)} block(s).\n"
        "# BACK UP the library, then in the Library editor: "
        "Automate -> Run Script -> this file.\n\n"
    )
    scr = header + "\n\n".join(blocks) + ("\n" if blocks else "")
    return scr, set_count, delete_count, len(blocks)


def default_baseline(csv_path: str) -> str:
    """The original export sits next to the CSV: library.csv -> library.json."""
    return os.path.splitext(csv_path)[0] + ".json"


def to_scr(csv_path: str, scr_path: str, baseline_path: str, purge: Iterable[str]) -> tuple[int, int, int]:
    if not os.path.exists(baseline_path):
        raise SystemExit(
            f"Baseline JSON not found: {baseline_path}\n"
            "to-scr diffs your CSV against the original export. Pass it with "
            "--baseline <library.json>, or keep library.json next to library.csv."
        )
    try:
        original = original_index(baseline_path)
    except json.JSONDecodeError:
        raise SystemExit(
            f"{baseline_path} is not valid JSON. The baseline must be the "
            "library.json produced by export-library.ulp (not the CSV)."
        )
    scr, set_count, delete_count, blocks = generate_scr(
        original, read_csv_rows(csv_path), frozenset(purge)
    )
    with open(scr_path, "w", encoding="utf-8", newline="") as handle:
        handle.write(scr)
    return set_count, delete_count, blocks


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Fusion library attribute editor (round-trip via CSV)."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    csv_cmd = sub.add_parser("to-csv", help="export library JSON to an editable CSV")
    csv_cmd.add_argument("json", help="library.json from export-library.ulp")
    csv_cmd.add_argument("csv", nargs="?", default="library.csv")

    scr_cmd = sub.add_parser("to-scr", help="edited CSV -> apply.scr (diffs against baseline JSON)")
    scr_cmd.add_argument("csv", help="your edited CSV (e.g. library.csv)")
    scr_cmd.add_argument("scr", nargs="?", default="apply.scr")
    scr_cmd.add_argument(
        "--baseline", default=None,
        help="original library.json baseline (default: the CSV path with a .json extension)",
    )
    scr_cmd.add_argument(
        "--purge", default="",
        help="comma-separated attribute names to delete entirely, even empty ones (e.g. DIGIKEY)",
    )

    args = parser.parse_args(argv)
    if args.cmd == "to-csv":
        count = to_csv(args.json, args.csv)
        print(f"Wrote {args.csv}: {count} rows. Edit it, then run to-scr.")
    else:
        purge = [name.strip() for name in args.purge.split(",") if name.strip()]
        baseline = args.baseline or default_baseline(args.csv)
        sets, deletes, blocks = to_scr(args.csv, args.scr, baseline, purge)
        print(f"Wrote {args.scr}: {sets} set, {deletes} delete, {blocks} block(s) "
              f"(baseline {baseline}).")


if __name__ == "__main__":
    main()
