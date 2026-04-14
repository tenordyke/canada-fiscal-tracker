"""Fiscal Monitor fetcher.

Data source: Department of Finance Canada, published monthly to the open.canada.ca
catalogue as ZIPs of CSV tables. We scan the catalogue for the newest monthly
release, download it, and parse the summary + expense-breakdown tables.

Key CSV files inside each ZIP (English):
    Table_1.csv  Summary statement of transactions
    Table_2.csv  Revenues by source
    Table_3.csv  Expenses broken out by category
    Table_4.csv  Expenses by object
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

CATALOG_API = "https://open.canada.ca/data/api/action"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_FILE = DATA_DIR / "fiscal_monitor.json"

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def parse_number(raw: Optional[str]) -> Optional[int]:
    """Parse CSV cell like '-14,504' or '"279,769"' → integer $ millions."""
    if raw is None:
        return None
    s = raw.strip().strip('"').replace(",", "").replace("$", "")
    if not s or s.lower() in {"n/a", "na", "-"}:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def find_latest_resource(session: requests.Session) -> dict:
    """Scan the Finance Canada catalogue and return the newest monthly ZIP."""
    r = session.get(
        f"{CATALOG_API}/package_search",
        params={"q": "The Fiscal Monitor", "rows": 5},
        timeout=30,
    )
    r.raise_for_status()
    packages = r.json()["result"]["results"]

    latest: Optional[tuple] = None  # ((year, month), metadata dict)

    for pkg in packages:
        pkg_title = pkg.get("title", "")
        if "Fiscal Monitor" not in pkg_title:
            continue
        for res in pkg.get("resources", []):
            if res.get("format") != "ZIP":
                continue
            name = res.get("name", "")
            if isinstance(name, dict):
                name = name.get("en", "") or ""
            name = str(name)
            # Match "October 2025" or "April and May 2025" — take the LAST month mentioned.
            matches = re.findall(
                r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})",
                name,
                flags=re.IGNORECASE,
            )
            if not matches:
                continue
            month_name, year_str = matches[-1]
            key = (int(year_str), MONTHS[month_name.lower()])
            url = res["url"]
            if url.startswith("/"):
                url = "https://open.canada.ca" + url
            entry = {
                "year": key[0],
                "month": key[1],
                "name": name,
                "url": url,
                "package": pkg_title,
                "updated": res.get("last_modified") or pkg.get("metadata_modified"),
            }
            if latest is None or key > latest[0]:
                latest = (key, entry)

    if latest is None:
        raise RuntimeError("No Fiscal Monitor ZIP resources found in catalogue")
    return latest[1]


def read_csv(zf: zipfile.ZipFile, filename: str) -> list[list[str]]:
    with zf.open(filename) as f:
        text = f.read().decode("utf-8-sig", errors="replace")
    return [row for row in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in row)]


def parse_table_1(rows: list[list[str]]) -> dict:
    """Table 1 columns: label, month_prior, month_current, ytd_prior, ytd_current."""
    header = rows[2] if len(rows) > 2 else []
    period_labels = {
        "month_prior": header[1] if len(header) > 1 else "",
        "month_current": header[2] if len(header) > 2 else "",
        "ytd_prior": header[3] if len(header) > 3 else "",
        "ytd_current": header[4] if len(header) > 4 else "",
    }

    def pick(row: list[str]) -> dict:
        return {
            "month_prior": parse_number(row[1] if len(row) > 1 else None),
            "month_current": parse_number(row[2] if len(row) > 2 else None),
            "ytd_prior": parse_number(row[3] if len(row) > 3 else None),
            "ytd_current": parse_number(row[4] if len(row) > 4 else None),
        }

    out: dict = {"period_labels": period_labels}
    for row in rows:
        label = row[0].strip().lower() if row else ""
        if label == "revenues":
            out["revenues"] = pick(row)
        elif "program expenses" in label and "excluding" in label:
            # expenses are negative in this table; flip sign for clarity
            vals = pick(row)
            out["program_expenses"] = {k: (-v if v is not None else None) for k, v in vals.items()}
        elif "public debt charges" in label:
            vals = pick(row)
            out["public_debt_charges"] = {k: (-v if v is not None else None) for k, v in vals.items()}
        elif label.startswith("budgetary balance (deficit/surplus)"):
            out["budgetary_balance"] = pick(row)
        elif "net actuarial losses" in label and "excluding" not in label:
            out["net_actuarial_losses"] = pick(row)
    return out


def parse_breakdown_table(rows: list[list[str]]) -> dict:
    """Parse a Fiscal-Monitor breakdown table (Table 3 or Table 4).

    Both tables share 7 columns:
        label, month_prior, month_current, pct_change,
        ytd_prior, ytd_current, pct_change

    We flag 'subtotal' rows (labels starting with 'Total') separately so the
    dashboard can render hierarchy without double-counting in bar charts.
    """
    line_items: list[dict] = []
    current_section: Optional[str] = None

    section_headers = {
        "major transfers to persons",
        "major transfers to provinces, territories and municipalities",
        "direct program expenses",
        "other expenses",
    }

    for row in rows:
        if not row or not row[0].strip():
            continue
        label = row[0].strip()
        label_l = label.lower()

        if label_l in section_headers:
            current_section = label
            continue

        if label_l.startswith(("table", "note", "$", ",")):
            continue

        if len(row) < 6:
            continue
        ytd_prior = parse_number(row[4])
        ytd_current = parse_number(row[5])
        if ytd_current is None and ytd_prior is None:
            continue

        is_subtotal = label_l.startswith("total")
        line_items.append(
            {
                "section": current_section,
                "label": label,
                "ytd_prior": ytd_prior,
                "ytd_current": ytd_current,
                "is_subtotal": is_subtotal,
            }
        )

    return {"line_items": line_items}


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": "canada-fiscal-tracker/0.1 (+github.com/tenordyke/canada-fiscal-tracker)"})

    meta = find_latest_resource(session)
    print(f"Latest edition: {meta['name']} → {meta['url']}")

    zr = session.get(meta["url"], timeout=60)
    zr.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(zr.content))

    t1 = parse_table_1(read_csv(zf, "Table_1.csv"))
    t3 = parse_breakdown_table(read_csv(zf, "Table_3.csv"))
    # Table 4 filename varies: "Table 4.csv" in some months, "Table_4.csv" in others.
    t4_filename = next(
        (n for n in zf.namelist() if n.replace(" ", "_").lower() == "table_4.csv"),
        None,
    )
    t4 = parse_breakdown_table(read_csv(zf, t4_filename)) if t4_filename else {"line_items": []}

    result = {
        "source": "Department of Finance Canada — Fiscal Monitor",
        "source_url": "https://www.canada.ca/en/department-finance/services/publications/fiscal-monitor.html",
        "edition": meta,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "units": "CAD millions",
        "summary": t1,
        "spending_by_category": t3,   # functional — elderly, EI, transfers, debt charges, …
        "spending_by_object": t4,     # economic — personnel, professional services, rentals, …
    }

    OUT_FILE.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT_FILE}")

    # Print the headline numbers so the log is easy to read
    s = t1
    if "budgetary_balance" in s:
        bb = s["budgetary_balance"]
        print(
            f"  YTD balance: {bb['ytd_current']:,} (prior year: {bb['ytd_prior']:,}) "
            f"for {s['period_labels']['ytd_current']}"
        )


if __name__ == "__main__":
    main()
