# Library attribute editor (round-trip)

Edit Fusion Electronics library attributes outside Fusion, then push the changes
back. Fusion is only the in/out gate (Run ULP to export, Run Script to apply);
all editing happens here. Two ways to edit — pick one:

```
                      ┌─ GUI:  fusion_attr_gui.py  (spreadsheet app, recommended)
export-library.ulp ──►│                                                          ──► apply.scr ──► Run Script
   (Fusion) library.json └─ CLI:  fusion_attr_editor.py  (JSON→CSV→edit→SCR)        (Fusion)
```

- `fusion_attr_gui.py` — visual editor (needs `tksheet`).
- `fusion_attr_editor.py` — command-line core (standard library only). The GUI
  reuses its diff/SCR engine.

---

## Option A — GUI (recommended)

```
py -3 -m pip install tksheet      # one-time
py -3 fusion_attr_gui.py          # run from this folder
```

1. **Open JSON…** → pick the `library.json` from `export-library.ulp`.
2. Edit the grid. Identity columns (`deviceset, variant, package, technology`)
   are locked; everything else is an attribute.
   - **edit a cell** → set a value · **clear a cell** → remove that attribute
   - **Rename column** → rename an attribute on every part at once (e.g. `DIGIKEY`→`SPN`)
   - **Add column** / **Delete column** → add / remove an attribute everywhere
   - **Bulk fill…** → set a column on rows matching a rule, e.g.
     *set `SUPPLIER` = `Digikey` where `SPN` matches `-ND$`*
3. **Export apply.scr…** → diffs your edits against the opened file and writes
   the script (deleting a column removes that attribute entirely, incl. empties).
4. In Fusion: **back up**, **Automate → Run Script → apply.scr**, **Ctrl+S**.

---

## Option B — CLI (CSV in Excel / any editor)

```
export-library.ulp ──► library.json
   to-csv ──► library.csv   ← you edit this freely
   to-scr ──► apply.scr      ← run this in Fusion
```

### 1. Export (Fusion, Library editor)

```
RUN 'D:/Explore/FusionLibraryStocktaker/fusion/ulp/export-library.ulp'
```

### 2. JSON → editable CSV

```
py -3 fusion_attr_editor.py to-csv library.json library.csv
```

(`python` on Windows is often the Store stub — use `py -3`, or `python3`.)

The CSV has fixed **identity columns** `deviceset, variant, package, technology`
then one column per attribute.

### 3. Edit `library.csv`

| Goal | Do this |
|------|---------|
| Rename an attribute on **every** part | rename the **column header** (e.g. `DIGIKEY` → `SPN`) |
| Change a value | edit the cell |
| Remove an attribute on a part | clear the cell |
| Add a new attribute | add a column + fill cells (e.g. `SUPPLIER` = `Digikey`) |

**Don't** edit the identity columns and **don't** add/remove rows — they identify
which part each change targets.

> Excel tip: opening as UTF-8 is handled (the file has a BOM). If Excel mangles a
> value (auto-formatting numbers/dates), import it as **Text** or edit in a plain
> text editor.

### 4. Edited CSV → apply script

```
py -3 fusion_attr_editor.py to-scr library.csv apply.scr
```

The baseline is found automatically next to the CSV (`library.csv` → `library.json`);
override with `--baseline <path>` if it lives elsewhere. It diffs your CSV against
that baseline and writes only the changes (`ATTRIBUTE … ;` to set,
`ATTRIBUTE … DELETE;` to remove), with the right `EDIT/PACKAGE/TECHNOLOGY`
navigation (unnamed variants/technologies skip `PACKAGE`/`TECHNOLOGY`, avoiding the
"Can't find package variant" halt).

Delete an attribute entirely (including empty leftover keys like `DIGIKEY`):

```
py -3 fusion_attr_editor.py to-scr library.csv apply.scr --purge DIGIKEY
```

### 5. Apply (Fusion, Library editor)

**Back up the library**, then **Automate → Run Script → `apply.scr`**, then **Ctrl+S**.

## Tests

```
py -3 -m unittest -v        # run from this folder
```

## Notes / limits

- Standard library only. No install, no build.
- Export + apply must run inside Fusion (the `.lbr` binary is not safely writable
  externally); only the editing logic is outside.
- The export ULP writes the Windows code page (cp1252), not UTF-8; the reader
  tolerates utf-8 / cp1252 / latin-1 automatically.
- Eagle value strings are single-quoted; embedded apostrophes are escaped
  best-effort by doubling (rare in part data).
- Devices without a package can make `export-library.ulp` error on
  `D.package.name`; component libraries (every device has a package) are fine.
