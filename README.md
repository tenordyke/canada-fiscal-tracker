# Canada Fiscal Tracker

Live dashboard tracking Canadian federal deficit, spending, and fiscal news.

**Dashboard:** https://tenordyke.github.io/canada-fiscal-tracker/

## What it shows

- Running year-to-date deficit vs. Budget forecast
- Debt interest "clock" (ticks up in real time, seeded from the latest monthly debt-charges figure)
- Federal spending broken out by category
- Weekly fiscal news digest, filtered for signal

## Data sources

- **Department of Finance — Fiscal Monitor** (monthly): revenue, spending, balance
- **Parliamentary Budget Officer (PBO)**: independent fiscal analysis
- **Statistics Canada Web Data Service**: GDP, inflation, macro context
- **Canadian financial news (RSS)**: Globe & Mail, CBC, Reuters Canada, Financial Post

## Architecture

- **Data fetchers** (Python) run in GitHub Actions on a 6-hour schedule
- Each fetcher writes normalized JSON to `data/`
- Git history of `data/` acts as a free time-series store — every commit is a dated snapshot
- **Dashboard** is static HTML/JS, served by GitHub Pages
- Installable as a PWA on Android

## Local development

```bash
pip install -r requirements.txt
python -m fetchers.run_all
python -m http.server 8000 --directory web
```
