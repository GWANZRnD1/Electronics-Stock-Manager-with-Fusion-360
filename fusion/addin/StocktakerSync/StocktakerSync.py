"""
Electronics Stock Manager — Fusion sync script.

Reads a library export (TSV/CSV with at least an `mpn` column, optionally
`manufacturer` / `description`) and upserts it into the app's part catalog via
POST /api/fusion/library. Parts are sent in batches with light pacing so the
first sync of a large library doesn't overload the database / API.

Setup: copy config.example.json -> config.json and set `apiBaseUrl` (+ `apiToken`
if the server has FUSION_API_TOKEN set). Run from Fusion's Scripts and Add-Ins.
"""

import json
import os
import csv
import ssl
import time
import traceback
import urllib.request

import adsk.core

BATCH_SIZE = 500
PAUSE_SECONDS = 0.3  # gentle pacing between batches

# Header aliases (case-insensitive) -> normalized field name.
ALIASES = {
    "mpn": "mpn",
    "manufacturer_part_number": "mpn",
    "manufacturerpartnumber": "mpn",
    "mfr_pn": "mpn",
    "mf_partnumber": "mpn",
    "part_number": "mpn",
    "partnumber": "mpn",
    "manufacturer": "manufacturer",
    "mfr": "manufacturer",
    "mf_name": "manufacturer",
    "manufacturer_name": "manufacturer",
    "description": "description",
    "desc": "description",
}


def run(context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        cfg = load_config()
        path = pick_file(ui)
        if not path:
            return
        parts = parse_parts(path)
        if not parts:
            ui.messageBox("No parts with an MPN were found in that file.")
            return
        total = sync(cfg, parts)
        ui.messageBox("Synced {} parts to the catalog.".format(total))
    except Exception:  # noqa: BLE001 - surface any failure to the user
        if ui:
            ui.messageBox("StocktakerSync failed:\n{}".format(traceback.format_exc()))


def load_config():
    here = os.path.dirname(os.path.realpath(__file__))
    path = os.path.join(here, "config.json")
    if not os.path.exists(path):
        raise RuntimeError("Create config.json next to this script (copy config.example.json).")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    if not cfg.get("apiBaseUrl"):
        raise RuntimeError("Set 'apiBaseUrl' in config.json (e.g. https://your-app.vercel.app).")
    return cfg


def pick_file(ui):
    dlg = ui.createFileDialog()
    dlg.title = "Select the library export (.txt/.csv from the ULP)"
    dlg.filter = "Data files (*.txt;*.csv;*.tsv);;All files (*.*)"
    if dlg.showOpen() != adsk.core.DialogResults.DialogOK:
        return None
    return dlg.filename


def parse_parts(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        delimiter = "\t" if "\t" in f.readline() else ","
        f.seek(0)
        reader = csv.DictReader(f, delimiter=delimiter)
        out = []
        seen = set()
        for row in reader:
            mapped = {}
            for key, value in row.items():
                if not key:
                    continue
                norm = ALIASES.get(key.strip().lower())
                if norm and value and value.strip():
                    mapped[norm] = value.strip()
            mpn = mapped.get("mpn")
            if not mpn or mpn in seen:
                continue
            seen.add(mpn)
            out.append(
                {
                    "mpn": mpn,
                    "manufacturer": mapped.get("manufacturer", ""),
                    "description": mapped.get("description", ""),
                }
            )
        return out


def sync(cfg, parts):
    url = cfg["apiBaseUrl"].rstrip("/") + "/api/fusion/library"
    token = cfg.get("apiToken") or ""
    context = ssl.create_default_context()
    total = 0
    for start in range(0, len(parts), BATCH_SIZE):
        batch = parts[start : start + BATCH_SIZE]
        body = json.dumps({"parts": batch}).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("content-type", "application/json")
        if token:
            req.add_header("authorization", "Bearer " + token)
        with urllib.request.urlopen(req, context=context, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            total += int(data.get("count", 0))
        if start + BATCH_SIZE < len(parts):
            time.sleep(PAUSE_SECONDS)
    return total
