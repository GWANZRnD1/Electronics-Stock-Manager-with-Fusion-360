#!/usr/bin/env python3
"""GUI editor for Fusion Electronics library attributes (round-trip middle step).

Flow:
  1. (Fusion)  RUN export-library.ulp        -> library.json
  2. (this GUI) Open library.json, edit in a spreadsheet grid, Export apply.scr
  3. (Fusion)  Automate -> Run Script        -> apply.scr  -> Ctrl+S

Reuses the diff/SCR core from fusion_attr_editor.py. Run from this folder:
    py -3 fusion_attr_gui.py
Requires tksheet:
    py -3 -m pip install tksheet
"""

from __future__ import annotations

import os
import re
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

try:
    from tksheet import Sheet
except ImportError:
    raise SystemExit("tksheet is required.\nInstall it with:  py -3 -m pip install tksheet")

from fusion_attr_editor import IDENTITY, generate_scr, row_key, _load_rows


class AttrEditor:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Fusion library attribute editor")
        self.root.geometry("1150x660")
        self.json_path: str | None = None
        self.baseline: dict = {}            # row_key -> original attributes
        self.baseline_attrs: set[str] = set()

        self._build_toolbar()
        self.sheet = Sheet(self.root, headers=[], data=[])
        self.sheet.pack(fill="both", expand=True, padx=6, pady=(0, 4))
        try:
            self.sheet.enable_bindings()
            self.sheet.disable_bindings("move_columns", "move_rows")
        except Exception:
            self.sheet.enable_bindings()

        self.status = tk.StringVar(value="Open a library.json to begin.")
        ttk.Label(self.root, textvariable=self.status, anchor="w",
                  relief="sunken").pack(fill="x", side="bottom")

    def _build_toolbar(self) -> None:
        bar = ttk.Frame(self.root)
        bar.pack(fill="x", padx=6, pady=6)
        for text, cmd in [
            ("Open JSON…", self.open_file),
            ("Add column", self.add_column),
            ("Rename column", self.rename_column),
            ("Delete column", self.delete_column),
            ("Bulk fill…", self.bulk_fill),
            ("Export apply.scr…", self.export_scr),
        ]:
            ttk.Button(bar, text=text, command=cmd).pack(side="left", padx=3)

    # --- grid helpers --------------------------------------------------------
    def headers(self) -> list[str]:
        return list(self.sheet.headers())

    def data(self) -> list[list]:
        return [list(r) for r in self.sheet.get_sheet_data()]

    def attr_columns(self) -> list[str]:
        return [h for h in self.headers() if h not in IDENTITY]

    def _set(self, columns: list[str], data: list[list]) -> None:
        self.sheet.headers(columns)
        self.sheet.set_sheet_data(data, reset_col_positions=True, reset_row_positions=True)
        identity_idx = [i for i, h in enumerate(columns) if h in IDENTITY]
        try:
            self.sheet.readonly_columns(columns=identity_idx, readonly=True)
        except Exception:
            pass

    # --- actions -------------------------------------------------------------
    def open_file(self) -> None:
        path = filedialog.askopenfilename(
            title="Open library.json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            rows = _load_rows(path)
        except Exception as exc:  # noqa: BLE001 - surface to the user
            messagebox.showerror("Open failed", str(exc))
            return
        self.json_path = path
        self.baseline = {row_key(r): (r.get("attributes") or {}) for r in rows}
        self.baseline_attrs = {key for attrs in self.baseline.values() for key in attrs}
        attr_cols = sorted(self.baseline_attrs)
        columns = list(IDENTITY) + attr_cols
        data = [
            [r.get(f, "") for f in IDENTITY]
            + [(r.get("attributes") or {}).get(c, "") for c in attr_cols]
            for r in rows
        ]
        self._set(columns, data)
        self.status.set(
            f"{os.path.basename(path)} — {len(rows)} rows, {len(attr_cols)} attribute columns. "
            "Identity columns are locked."
        )

    def add_column(self) -> None:
        if not self._loaded():
            return
        name = (simpledialog.askstring("Add column", "New attribute name:") or "").strip()
        if not name:
            return
        if name in self.headers():
            messagebox.showwarning("Add column", f"Column '{name}' already exists.")
            return
        self._set(self.headers() + [name], [row + [""] for row in self.data()])
        self.status.set(f"Added column '{name}'.")

    def rename_column(self) -> None:
        if not self._loaded():
            return
        cols = self.attr_columns()
        if not cols:
            return
        old = self._choose("Rename column", "Attribute to rename:", cols)
        if not old:
            return
        new = (simpledialog.askstring("Rename column", f"Rename '{old}' to:") or "").strip()
        if not new:
            return
        headers = self.headers()
        if new in headers:
            messagebox.showwarning("Rename", f"Column '{new}' already exists.")
            return
        headers[headers.index(old)] = new
        self._set(headers, self.data())
        self.status.set(f"Renamed '{old}' → '{new}' (applies to every part on export).")

    def delete_column(self) -> None:
        if not self._loaded():
            return
        cols = self.attr_columns()
        if not cols:
            return
        col = self._choose("Delete column", "Attribute to delete:", cols)
        if not col:
            return
        headers = self.headers()
        i = headers.index(col)
        headers.pop(i)
        self._set(headers, [row[:i] + row[i + 1:] for row in self.data()])
        self.status.set(f"Deleted column '{col}' (removed from every part on export).")

    def bulk_fill(self) -> None:
        if not self._loaded():
            return
        win = tk.Toplevel(self.root)
        win.title("Bulk fill")
        win.transient(self.root)
        win.grab_set()
        frm = ttk.Frame(win, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Set attribute (existing or new):").grid(row=0, column=0, sticky="w")
        target = ttk.Combobox(frm, values=self.attr_columns(), width=28)
        target.grid(row=0, column=1, pady=3)
        ttk.Label(frm, text="to value:").grid(row=1, column=0, sticky="w")
        value = ttk.Entry(frm, width=31)
        value.grid(row=1, column=1, pady=3)
        ttk.Label(frm, text="only where column:").grid(row=2, column=0, sticky="w")
        where = ttk.Combobox(frm, values=[""] + self.attr_columns(), width=28)
        where.grid(row=2, column=1, pady=3)
        ttk.Label(frm, text="matches regex:").grid(row=3, column=0, sticky="w")
        regex = ttk.Entry(frm, width=31)
        regex.grid(row=3, column=1, pady=3)
        ttk.Label(frm, text="(blank 'where' = all rows; e.g. SUPPLIER = Digikey where SPN ~ -ND$)",
                  foreground="#666").grid(row=4, column=0, columnspan=2, sticky="w", pady=(2, 6))

        def apply_fill() -> None:
            tcol = target.get().strip()
            if not tcol or tcol in IDENTITY:
                messagebox.showwarning("Bulk fill", "Pick a non-identity target column.")
                return
            try:
                rx = re.compile(regex.get().strip()) if regex.get().strip() else None
            except re.error as exc:
                messagebox.showerror("Regex error", str(exc))
                return
            headers = self.headers()
            data = self.data()
            if tcol not in headers:
                headers = headers + [tcol]
                data = [row + [""] for row in data]
            tidx = headers.index(tcol)
            wcol = where.get().strip()
            widx = headers.index(wcol) if wcol in headers else None
            val = value.get()
            count = 0
            for row in data:
                if widx is None:
                    match = True
                else:
                    cell = row[widx]
                    match = bool(rx.search(cell)) if rx else cell != ""
                if match:
                    row[tidx] = val
                    count += 1
            self._set(headers, data)
            self.status.set(f"Bulk fill: set {tcol}='{val}' on {count} row(s).")
            win.destroy()

        btns = ttk.Frame(frm)
        btns.grid(row=5, column=0, columnspan=2, pady=(8, 0))
        ttk.Button(btns, text="Apply", command=apply_fill).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=win.destroy).pack(side="left", padx=4)
        win.wait_window()

    def export_scr(self) -> None:
        if not self._loaded():
            return
        headers = self.headers()
        edited_rows = []
        for row in self.data():
            record = dict(zip(headers, row))
            identity = {f: (record.get(f) or "") for f in IDENTITY}
            attributes = {
                h: (record.get(h) or "")
                for h in headers
                if h and h not in IDENTITY
            }
            edited_rows.append({**identity, "attributes": attributes})

        current = {h for h in headers if h not in IDENTITY}
        purge = self.baseline_attrs - current  # columns removed entirely -> delete attr
        scr, sets, dels, blocks = generate_scr(self.baseline, edited_rows, frozenset(purge))

        out = filedialog.asksaveasfilename(
            title="Export apply.scr",
            defaultextension=".scr",
            initialfile="apply.scr",
            initialdir=os.path.dirname(self.json_path or ""),
            filetypes=[("Eagle script", "*.scr"), ("All files", "*.*")],
        )
        if not out:
            return
        with open(out, "w", encoding="utf-8", newline="") as handle:
            handle.write(scr)
        messagebox.showinfo(
            "Exported",
            f"{sets} set, {dels} delete across {blocks} block(s).\n\n"
            f"Saved: {out}\n\n"
            "In Fusion: BACK UP, then Automate → Run Script → this file → Ctrl+S.",
        )
        self.status.set(f"Exported {blocks} block(s) → {os.path.basename(out)}.")

    # --- small modal helpers -------------------------------------------------
    def _loaded(self) -> bool:
        if self.json_path:
            return True
        messagebox.showinfo("No file", "Open a library.json first.")
        return False

    def _choose(self, title: str, prompt: str, options: list[str]) -> str | None:
        win = tk.Toplevel(self.root)
        win.title(title)
        win.transient(self.root)
        win.grab_set()
        ttk.Label(win, text=prompt).pack(padx=12, pady=(12, 4))
        var = tk.StringVar(value=options[0])
        ttk.Combobox(win, textvariable=var, values=options, state="readonly",
                     width=32).pack(padx=12, pady=4)
        result = {"value": None}

        def ok() -> None:
            result["value"] = var.get()
            win.destroy()

        btns = ttk.Frame(win)
        btns.pack(pady=10)
        ttk.Button(btns, text="OK", command=ok).pack(side="left", padx=4)
        ttk.Button(btns, text="Cancel", command=win.destroy).pack(side="left", padx=4)
        win.wait_window()
        return result["value"]


def main() -> None:
    root = tk.Tk()
    AttrEditor(root)
    root.mainloop()


if __name__ == "__main__":
    main()
