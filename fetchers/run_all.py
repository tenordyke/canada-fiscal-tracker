"""Run every registered fetcher and write a shared index.json.

For now this is a skeleton that only writes a timestamp, proving the
pipeline (scheduled fetch → commit → Pages deploy) works end-to-end.
Real fetchers (Fiscal Monitor, PBO, StatCan, news) get added one at a time.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    index = {
        "schema_version": 1,
        "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fetchers": {
            "fiscal_monitor": {"status": "not_implemented"},
            "pbo": {"status": "not_implemented"},
            "statcan": {"status": "not_implemented"},
            "news": {"status": "not_implemented"},
        },
    }

    (DATA_DIR / "index.json").write_text(
        json.dumps(index, indent=2, sort_keys=False) + "\n"
    )
    print(f"Wrote {DATA_DIR / 'index.json'}")


if __name__ == "__main__":
    main()
