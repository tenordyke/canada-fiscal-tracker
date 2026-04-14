"""Run every registered fetcher and write a shared index.json.

Each fetcher is expected to write its own JSON file under data/ and is
responsible for its own error handling. This runner records per-fetcher
status in index.json so the dashboard can show which sources are live.
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fetchers import fiscal_monitor

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


FETCHERS: dict[str, Callable[[], None]] = {
    "fiscal_monitor": fiscal_monitor.main,
}


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    results: dict = {}

    for name, fn in FETCHERS.items():
        print(f"\n=== {name} ===")
        try:
            fn()
            results[name] = {"status": "ok", "error": None}
        except Exception as exc:  # noqa: BLE001  — we want to catch everything per-fetcher
            traceback.print_exc()
            results[name] = {"status": "error", "error": f"{type(exc).__name__}: {exc}"}

    # Stubs for fetchers not yet implemented
    for not_yet in ("pbo", "statcan", "news"):
        results.setdefault(not_yet, {"status": "not_implemented", "error": None})

    index = {
        "schema_version": 1,
        "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fetchers": results,
    }
    (DATA_DIR / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"\nWrote {DATA_DIR / 'index.json'}")


if __name__ == "__main__":
    main()
