"""OAS breakdown fetcher.

The Fiscal Monitor reports "Elderly benefits" as a single line. This fetcher
pulls ESDC's open-data CSV that splits that total into its three component
programs (OAS pension, GIS, Allowance) and returns the most recent fiscal
year alongside a few prior years for trend context.

Source: Employment and Social Development Canada, "Canada Pension Plan (CPP)
and Old Age Security (OAS) – Annual Statistics Tables", dataset id
f064a144-b4e0-4e9b-9970-e0fc2f84d1a8 on open.canada.ca.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

CATALOG_API = "https://open.canada.ca/data/api/action"
PACKAGE_ID = "f064a144-b4e0-4e9b-9970-e0fc2f84d1a8"
RESOURCE_NAME_EN = "OAS – Net payments, by benefit type and fiscal year"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT_FILE = DATA_DIR / "oas_breakdown.json"


def parse_dollars(raw: Optional[str]) -> Optional[int]:
    """Parse '60,648,088,711' → 60648088711 (int, absolute dollars)."""
    if raw is None:
        return None
    s = raw.strip().strip('"').replace(",", "")
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def find_resource_url(session: requests.Session) -> str:
    r = session.get(
        f"{CATALOG_API}/package_show",
        params={"id": PACKAGE_ID},
        timeout=30,
    )
    r.raise_for_status()
    for res in r.json()["result"]["resources"]:
        name = res.get("name", "")
        if isinstance(name, dict):
            name = name.get("en", "")
        if str(name).strip() == RESOURCE_NAME_EN:
            url = res["url"]
            if url.startswith("/"):
                url = "https://open.canada.ca" + url
            return url
    raise RuntimeError(f"Could not find resource: {RESOURCE_NAME_EN}")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update(
        {"User-Agent": "canada-fiscal-tracker/0.1 (+github.com/tenordyke/canada-fiscal-tracker)"}
    )

    url = find_resource_url(session)
    print(f"OAS source: {url}")

    r = session.get(url, timeout=60)
    r.raise_for_status()
    # File is UTF-8-BOM with a bilingual header row we want to skip.
    text = r.content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader if any(cell.strip() for cell in row)]

    # Row 0: English header
    # Row 1: French header
    # Row 2+: data rows starting with fiscal year label like "2024-2025"
    header = rows[0]
    data_rows = [r for r in rows[2:] if "-" in (r[0] or "")]

    series = []
    for row in data_rows:
        year = row[0].strip()
        # Columns (0-indexed):
        # 0 Year
        # 1 Before Repayment (OAS)
        # 2 Repayment (OAS)
        # 3 After Repayment (OAS)
        # 4 Guaranteed Income Supplement
        # 5 Allowance
        # 6 Before Repayment (total)
        # 7 After Repayment (total)
        oas_net = parse_dollars(row[3] if len(row) > 3 else None)
        if oas_net is None:
            # Early years had no recovery tax — use Before Repayment as net.
            oas_net = parse_dollars(row[1] if len(row) > 1 else None)
        gis = parse_dollars(row[4] if len(row) > 4 else None)
        allowance = parse_dollars(row[5] if len(row) > 5 else None)
        total = parse_dollars(row[7] if len(row) > 7 else None)
        if total is None:
            total = parse_dollars(row[6] if len(row) > 6 else None)

        series.append(
            {
                "fiscal_year": year,
                "oas_pension": oas_net,
                "gis": gis,
                "allowance": allowance,
                "total": total,
            }
        )

    latest = series[-1] if series else None

    out = {
        "source": "Employment and Social Development Canada",
        "source_name": "OAS Net payments, by benefit type and fiscal year",
        "source_url": url,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "units": "CAD (absolute dollars)",
        "latest": latest,
        "series": series[-10:],  # keep last ten fiscal years for trend display
    }
    OUT_FILE.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {OUT_FILE}")
    if latest:
        bn = lambda x: f"${x / 1e9:.1f}B" if x else "—"
        print(
            f"  {latest['fiscal_year']}: OAS {bn(latest['oas_pension'])}, "
            f"GIS {bn(latest['gis'])}, Allowance {bn(latest['allowance'])}, "
            f"total {bn(latest['total'])}"
        )


if __name__ == "__main__":
    main()
