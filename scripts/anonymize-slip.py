"""Anonymize a real placement slip into a regression-test fixture.

Per-fixture rules live in JSON config files OUTSIDE the committed repo:

    scripts/anonymize-rules/<fixture-name>.json

These config files contain real client identifiers, employee names, NRICs,
addresses, and other PII. They are GITIGNORED. The committed script knows
only the generic processing pipeline — never the real values.

The script:
  1. Loads the per-fixture config from scripts/anonymize-rules/<name>.json.
  2. If source is `.xls`, converts to `.xlsx` via Excel COM automation.
  3. Loads the (possibly-converted) `.xlsx` with openpyxl (full mode).
  4. Applies string find/replace across every cell of every sheet.
  5. Applies per-cell overrides (when find/replace would mis-replace).
  6. Optionally scales numeric cells in headcount/SI columns.
  7. Saves to apps/web/tests/extraction/fixtures/<name>/slip.xlsx.
  8. Writes a per-fixture audit log with sheet/cell/kind only — NO
     `before`/`after` text fields, so the committed audit doesn't itself
     leak the real values.

Usage:
  python scripts/anonymize-slip.py <fixture-name>
  python scripts/anonymize-slip.py --all
  python scripts/anonymize-slip.py --list

Config file shape (scripts/anonymize-rules/<fixture>.json):

    {
      "source": "C:\\\\path\\\\to\\\\original\\\\slip.xlsx",
      "replace_strings": {
        "<real-string-1>": "<placeholder-1>",
        "<real-string-2>": "<placeholder-2>"
      },
      "cell_overrides": {
        "<sheet-name>": { "<cell-coord>": "<new-value>" }
      },
      "scale_numeric": [
        { "sheet": "<sheet>", "factor": 0.125, "cells": ["F22","F23"] }
      ]
    }

Adding a fixture:
  1. Write scripts/anonymize-rules/<name>.json with the rules above.
  2. Run python scripts/anonymize-slip.py <name>.
  3. Verify the output slip.xlsx is fully anonymized (manual sentinel scan).
  4. Commit the slip.xlsx + expected.json + notes.md (NEVER the rule file).
"""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = REPO_ROOT / "apps" / "web" / "tests" / "extraction" / "fixtures"
RULES_DIR = REPO_ROOT / "scripts" / "anonymize-rules"

# Excel SaveAs format code for .xlsx (xlOpenXMLWorkbook).
_XL_OPEN_XML_WORKBOOK = 51


def convert_xls_to_xlsx(src: Path) -> Path:
    """Convert a legacy .xls file to .xlsx via Excel COM automation.

    Returns the path to a temp .xlsx file. Caller is responsible for cleanup
    (or just let the OS reap it on next reboot — they're tiny).

    Requires Microsoft Excel installed on Windows. Raises if Excel COM is not
    available or the file fails to open.
    """
    try:
        import pythoncom
        import win32com.client
    except ImportError as e:  # pragma: no cover - explicit error for non-Windows
        raise SystemExit(
            f"Source {src.name} is .xls and requires Excel COM to convert. "
            f"Install: pip install pywin32. Underlying: {e}"
        ) from e

    tmp_fd, tmp_path_str = tempfile.mkstemp(prefix="anon_", suffix=".xlsx")
    os.close(tmp_fd)
    tmp_path = Path(tmp_path_str)
    if tmp_path.exists():
        tmp_path.unlink()  # Excel SaveAs requires the target NOT to exist.

    pythoncom.CoInitialize()
    xl = win32com.client.Dispatch("Excel.Application")
    xl.Visible = False
    xl.DisplayAlerts = False
    try:
        wb = xl.Workbooks.Open(str(src), ReadOnly=True)
        wb.SaveAs(str(tmp_path), FileFormat=_XL_OPEN_XML_WORKBOOK)
        wb.Close(SaveChanges=False)
    finally:
        xl.Quit()

    return tmp_path


def load_rules(name: str) -> dict[str, Any]:
    """Load per-fixture anonymization rules from the gitignored config dir.

    Raises with a clear message if the rule file is missing — so a fresh
    clone of the repo can't accidentally run the anonymizer with empty rules.
    """
    rules_path = RULES_DIR / f"{name}.json"
    if not rules_path.exists():
        raise SystemExit(
            f"Rule file not found: {rules_path}\n"
            f"Per-fixture anonymization rules are gitignored (they contain real PII).\n"
            f"Create {rules_path} with the schema in scripts/anonymize-slip.py docstring."
        )
    return json.loads(rules_path.read_text(encoding="utf-8"))


def list_known_fixtures() -> list[str]:
    """List fixture names by scanning the gitignored rules directory."""
    if not RULES_DIR.exists():
        return []
    return sorted(p.stem for p in RULES_DIR.glob("*.json"))


def anonymize_fixture(name: str) -> dict[str, Any]:
    cfg = load_rules(name)
    src = Path(cfg["source"])
    dest_dir = FIXTURES_DIR / name
    dest = dest_dir / "slip.xlsx"

    if not src.exists():
        raise SystemExit(f"Source slip not found: {src}")

    print(f"[anonymize] {name}")
    print(f"  src:  {src}")
    print(f"  dest: {dest}")

    # If source is legacy .xls, convert to .xlsx via Excel COM first.
    # The fixture is always saved as .xlsx regardless of source format.
    converted_temp: Path | None = None
    load_src = src
    if src.suffix.lower() == ".xls":
        print("  note: .xls source - converting to .xlsx via Excel COM...")
        converted_temp = convert_xls_to_xlsx(src)
        load_src = converted_temp
        print(f"  temp: {converted_temp}")

    # Two-load pattern:
    #   wb_values (data_only=True)  → resolve formulas to cached values.
    #     Used to (a) detect identifiers hidden behind `=C4`-style refs,
    #     and (b) snapshot every cell's CACHED VALUE so we can flatten
    #     formulas to literals on save.
    #   wb (data_only=False)        → writable workbook.
    #
    # Why flatten formulas to literals: openpyxl does NOT recalculate
    # formulas on save and does NOT preserve cached values either. After
    # `wb.save(...)`, every formula cell's cached value is wiped — readers
    # using `data_only=True` (which the heuristic parser does) see None
    # until Excel re-opens-and-saves the file. For test fixtures, we just
    # don't need formulas at all; literals are sufficient and readable.
    wb_values = openpyxl.load_workbook(load_src, data_only=True)

    # Snapshot of (sheet, coord) → cached value, for every populated cell.
    cached_values: dict[tuple[str, str], Any] = {}
    # cells_to_change: (sheet, coord) — we don't keep before/after text in
    # any in-memory structure that lands in the audit log.
    cells_to_change: list[tuple[str, str, str]] = []
    replace_strings = cfg.get("replace_strings", {})
    for sheet_name in wb_values.sheetnames:
        sh = wb_values[sheet_name]
        for row in sh.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                cached_values[(sheet_name, cell.coordinate)] = cell.value
                if not isinstance(cell.value, str):
                    continue
                original = cell.value
                new_value = original
                for find, replace in replace_strings.items():
                    if find in new_value:
                        new_value = new_value.replace(find, replace)
                if new_value != original:
                    cells_to_change.append((sheet_name, cell.coordinate, new_value))
    wb_values.close()

    wb = openpyxl.load_workbook(load_src)

    # Audit entries record only WHERE a change happened, not the values
    # involved. Including original cell content would re-leak the PII the
    # script just removed.
    changes: list[dict[str, Any]] = []

    # 1. Flatten every formula cell to its cached literal value so save
    # doesn't strip the cache. This runs BEFORE string replacements so
    # the replacement step writes to a now-literal cell, not a formula.
    formulas_flattened = 0
    for sheet_name in wb.sheetnames:
        sh = wb[sheet_name]
        for row in sh.iter_rows():
            for cell in row:
                v = cell.value
                if isinstance(v, str) and v.startswith("="):
                    cached = cached_values.get((sheet_name, cell.coordinate))
                    if cached is not None:
                        cell.value = cached
                        formulas_flattened += 1
    if formulas_flattened > 0:
        changes.append(
            {
                "sheet": "*",
                "cell": "*",
                "kind": "flatten_formulas",
                "count": formulas_flattened,
            }
        )

    # 2. Apply string replacements (overwriting whatever's there now).
    for sheet_name, coord, new_value in cells_to_change:
        sh = wb[sheet_name]
        sh[coord] = new_value
        changes.append({"sheet": sheet_name, "cell": coord, "kind": "string_replace"})

    # 3. Per-cell overrides (run after string replacements).
    for sheet_name, cell_overrides in cfg.get("cell_overrides", {}).items():
        if sheet_name not in wb.sheetnames:
            print(f"  [warn] cell_override targets missing sheet {sheet_name!r}; skipped")
            continue
        sh = wb[sheet_name]
        for cell_addr, new_value in cell_overrides.items():
            old = sh[cell_addr].value
            if old != new_value:
                changes.append({"sheet": sheet_name, "cell": cell_addr, "kind": "cell_override"})
                sh[cell_addr] = new_value

    # 4. Numeric scaling (e.g. headcount in a basis-of-cover table).
    for rule in cfg.get("scale_numeric", []):
        sheet_name = rule["sheet"]
        if sheet_name not in wb.sheetnames:
            continue
        sh = wb[sheet_name]
        factor = rule["factor"]
        for cell_addr in rule["cells"]:
            old = sh[cell_addr].value
            if isinstance(old, (int, float)):
                new_value = round(old * factor, 4)
                if isinstance(old, int) and float(new_value).is_integer():
                    new_value = int(new_value)
                changes.append({"sheet": sheet_name, "cell": cell_addr, "kind": "scale_numeric"})
                sh[cell_addr] = new_value

    # 5. Save.
    dest_dir.mkdir(parents=True, exist_ok=True)
    wb.save(dest)
    wb.close()

    # 6. Write audit log to fixture directory. Records only WHERE changes
    # happened and how many of each kind — never the source content.
    audit_path = dest_dir / "_anonymization-audit.json"
    audit_path.write_text(
        json.dumps(
            {
                "fixture": name,
                "dest_filename": dest.name,
                "rules_summary": {
                    "string_replacements_defined": len(replace_strings),
                    "cell_overrides_defined": sum(
                        len(v) for v in cfg.get("cell_overrides", {}).values()
                    ),
                    "numeric_scalings_defined": sum(
                        len(r["cells"]) for r in cfg.get("scale_numeric", [])
                    ),
                },
                "total_changes_applied": len(changes),
                "changes": changes,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # Clean up the temp .xlsx if we converted from .xls.
    if converted_temp is not None and converted_temp.exists():
        try:
            converted_temp.unlink()
        except OSError:
            pass

    print(f"  changes: {len(changes)}")
    print(f"  audit:   {audit_path.relative_to(REPO_ROOT)}")
    return {"name": name, "changes": len(changes), "dest": str(dest)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("fixture", nargs="?", help="Fixture name (e.g. cbre-mcst-2026)")
    g.add_argument(
        "--all", action="store_true", help="Anonymize all fixtures with rule files defined"
    )
    g.add_argument(
        "--list", action="store_true", help="List known fixtures (from gitignored rules dir)"
    )
    args = parser.parse_args()

    known = list_known_fixtures()
    if args.list:
        if not known:
            print(f"No rule files found in {RULES_DIR.relative_to(REPO_ROOT)}/")
        for name in known:
            print(name)
        return 0

    targets = known if args.all else [args.fixture]
    for name in targets:
        anonymize_fixture(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
