# Hotel Performance Dashboard

A rebuild of the single-file SharePoint dashboard as a proper application: a
FastAPI backend that ingests each hotel's monthly MIS workbook, a PostgreSQL
store that keeps two fiscal years of history, and a React frontend that renders
the same five tabs plus a Trends view over the accumulated history.

## What it does

- **Admins upload** one Excel workbook per hotel per month.
- The workbook is **parsed, then previewed** — nothing reaches the dashboard
  until an admin confirms the figures on screen.
- Committed months build up a **rolling two-year history** (configurable), so
  the Trends tab can chart Actual / Budget / Last Year month by month.
- **Standard users** get read-only access to the dashboard.

## Quick start

The app is published at **https://hospkpi.ambujaneotia.com** and listens on
**port 8016**.

For the Ubuntu server deployment (native PostgreSQL, systemd, nginx, TLS),
see **[DEPLOY.md](DEPLOY.md)**.

### Production / single port

The API process also serves the built frontend, so the whole app runs on one
origin — no reverse proxy or CORS hop is required.

```bash
docker compose up -d                       # database on host port 5434

cd frontend && npm install && npm run build # produces frontend/dist

cd ../backend
python -m pip install -r requirements.txt
cp .env.example .env                        # then set SECRET_KEY and passwords
python -m uvicorn app.main:app --host 0.0.0.0 --port 8016
```

Everything is then reachable on one port:

| Path | Serves |
|---|---|
| `/` | the dashboard (client-side routes such as `/upload` survive a refresh) |
| `/api/…` | the JSON API |
| `/docs` | interactive API documentation |

Point `hospkpi.ambujaneotia.com` at the host on 8016. If TLS terminates at a
reverse proxy instead, forward it to `127.0.0.1:8016` and leave
`PUBLIC_BASE_URL` set to the https URL — it is added to the CORS allow-list
automatically.

### Development

Two processes, with Vite proxying `/api` to the backend:

```bash
cd backend  && python -m uvicorn app.main:app --reload --port 8016
cd frontend && npm run dev            # http://localhost:5173
```

Set `VITE_API_TARGET` to point the proxy somewhere else. The dev server also
answers to `hospkpi.ambujaneotia.com`, so you can develop behind the real host
name.

Sign in with the bootstrap admin from `.env` (`admin@hotelgroup.in` /
`admin123`). **Change that password immediately** — the Admin page has a
password form.

### Using your own PostgreSQL instead of Docker

Create a database and point `DATABASE_URL` at it:

```sql
CREATE USER hotel WITH PASSWORD 'your-password';
CREATE DATABASE hotel_dashboard OWNER hotel;
```

```
DATABASE_URL=postgresql+psycopg://hotel:your-password@localhost:5432/hotel_dashboard
```

Tables are created automatically on first startup, along with the seven seeded
hotels and the bootstrap admin.

### Loading a folder of workbooks at once

Useful for the initial load and for back-filling history. Each file is matched
to a hotel by the entity code printed inside it:

```bash
cd backend
python seed_from_folder.py --dir .. --month 12 --fiscal-year 2025-26 --dry-run
python seed_from_folder.py --dir .. --month 12 --fiscal-year 2025-26
```

Run it once per month you want to back-fill, pointing `--dir` at that month's
folder of workbooks.

## Uploading

The Upload page opens with a **coverage grid**: one row per project, one column
per month running backwards from the current month (crossing fiscal-year
boundaries), so you can see at a glance which books are in and which are
missing.

- A **loaded** cell shows the status, that month's actual revenue and the file
  name, with buttons to **download** the stored workbook, **replace** it, or
  **delete** it. Deleting also removes that month's figures from the dashboard.
- An **empty** cell offers **+ Upload**, which points the form below at that
  exact hotel and month.

Below the grid, an admin picks the hotel, fiscal year and month, then drops
the workbook in. The app parses it and shows what it read — revenue, room and
F&B revenue, EBITDA, payroll, occupancy, ARR, RevPAR, for both the month and
year-to-date, across Actual / Budget / Last Year — plus how many market segments
and outlets it found. Confirm to publish, or discard.

Warnings appear above the figures when something needs a second look, for
example:

- the file's entity code belongs to a different hotel than the one selected
- the file reports a different month than the one chosen
- turnover minus operating expenses does not equal EBITDA
- outlet revenue does not tie back to F&B revenue in the P&L

Re-uploading a month **replaces** that month's figures; the previous upload is
kept and marked `superseded` for audit.

## Growth tab: MoM, QoQ and YoY

A **Growth** tab compares the selected month against three baselines, for any of
eight metrics:

| | Compares | Needs |
|---|---|---|
| **MoM** | the month against the one before | the previous month uploaded |
| **QoQ** | the fiscal quarter containing the month against the previous quarter | the neighbouring quarter's months uploaded |
| **YoY** | the month against the same month a year earlier | nothing extra |

Year on year works from a **single upload**, because every MIS workbook carries
its own prior-year column; that figure is stored as the `LY` scenario. Month and
quarter comparisons need the neighbouring periods to have been uploaded, and the
tab says plainly which period is missing rather than showing a blank.

Fiscal quarters follow the Indian year: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec,
Q4 Jan–Mar. A quarter sums whatever months are loaded and reports the count, so a
part-loaded quarter is visibly flagged rather than quietly compared against a
full one. Rates (occupancy, ARR, RevPAR) are averaged across months and hotels;
everything else is summed.

## Chart conventions

- **Every chart is directly labelled.** Because the value sits on the mark, the
  value axis and its gridlines are dropped as redundant — bar and cost charts
  carry no horizontal rules at all. Line charts keep a hairline grid, since
  intermediate points still have to be read off the axis.
- **Grouped bars label the leading series only.** Three labels over one category
  collide as soon as the figures are wide; the legend and tooltip carry budget
  and last year. A width check also skips any label that would not fit its slot.
- **Stacked segments are labelled inside**, and only when the segment is tall
  enough to hold the text.
- **Growth uses the status palette** (green up, red down) because the direction
  genuinely means good or bad, and every value carries a signed arrow so the
  meaning never rests on colour alone.

## Managing hotels and users

The **Admin** page (admins only) manages both.

**Hotels / projects** are listed with inline editing — click *Edit* to change the
code, name, entity code, room count or display order in place. Codes and entity
codes must stay unique, since the entity code is what matches an uploaded
workbook to a hotel.

Two ways to retire a hotel:

- **Deactivate** hides it from the dashboard and the filters while keeping every
  upload and figure. Reversible from the same button.
- **Delete** removes it permanently. If the hotel has uploads or reported
  figures, the confirmation shows exactly how many and requires typing the
  hotel's code; deleting then removes its uploads, stored files and facts too.
  A hotel with nothing attached deletes without the extra step.

**Users** can be added as admin (upload and manage) or user (read-only), and
disabled. You cannot disable your own account.

## Theming

The header carries an **Auto / Light / Dark** switch. Auto follows the operating
system and reacts to it changing; an explicit choice is remembered in
`localStorage` and wins over the OS in both directions.

Every colour is a CSS custom property defined in `frontend/src/styles.css`:
light is the base declaration, and dark is a *selected* set of steps for the dark
surface, declared under both the `prefers-color-scheme` media query and the
`[data-theme="dark"]` stamp. Canvas cannot inherit CSS, so `ThemeContext` samples
those same variables and hands them to Chart.js — one palette definition serves
both themes and the charts can never drift from the page.

The three categorical series colours (Actual / Budget / Last year) are validated
for colour-blind separation against both the light and dark card surfaces. To
change them, edit `--s1`/`--s2`/`--s3` in both theme blocks and re-validate.

## Configuration

Set in `backend/.env`:

| Key | Default | What it does |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://hospkpi.ambujaneotia.com` | Where the app is published; added to the CORS allow-list |
| `HOST` / `PORT` | `0.0.0.0` / `8016` | Bind address for the API process |
| `SERVE_FRONTEND` | `true` | Serve `frontend/dist` from the API process |
| `CORS_ORIGINS` | localhost dev origins | Extra origins, comma-separated |
| `DATABASE_URL` | Docker Postgres on 5434 | SQLAlchemy connection string |
| `SECRET_KEY` | — | **Change before deploying**; signs the JWTs |
| `RETENTION_YEARS` | `2` | Fiscal years of history kept |
| `FIRST_ADMIN_EMAIL` / `_PASSWORD` | — | Bootstrap admin, created on an empty database only |

## Supported workbook formats

Parsing is content-driven — sheets are located by what they contain and line
items are matched on their labels, never by fixed row or column positions, since
these differ between properties and shift between months.

| Parser | Layout | Verified against |
|---|---|---|
| `ihcl_financial_book` | Named sheets (`1.1MainP&LSummary`, `1.2StatementofRoomRevenue(` …), with or without spaces, and the generic `Table 1` / `Table 3` export variant | CCNT, CCPT, Chia, Guras, Taal Kutir, Raajkutir |
| `wide_mis` | One wide `MIS` sheet with an 8-column block per month | Ganga Kutir Raichak |

Both read the P&L summary, statistics, F&B category split, room revenue by
market segment, and outlet-wise F&B with the resident / non-resident cover
split. An unrecognised workbook is rejected with an explanation rather than
being partially imported.

To add a format, drop a module in `backend/app/parsers/` exposing `detect(path)`
and `parse(path)` returning a `ParseResult`, then register it in
`registry.py`. Put narrower detectors first.

## Layout

```
backend/
  app/
    api/routes/     auth, hotels, uploads, dashboard
    parsers/        format detection and workbook readers
    services/       ingest (parse -> facts) and query (facts -> dashboard)
    models.py       users, hotels, uploads, period/segment/outlet facts
  seed_from_folder.py   bulk loader
  smoke_test.py         end-to-end test on a throwaway database
frontend/
  src/panels/       Executive, Rooms, F&B, Costs, Compare, Trends
  src/pages/        Login, Dashboard, Upload, Admin
```

## Data model

Facts are stored per hotel / fiscal year / month / period (`MTD` or `YTD`) /
scenario (`ACT`, `BUD`, `LY`), in three tables:

- `period_facts` — the P&L line items and statistics
- `segment_facts` — room nights, ARR and revenue by market segment
- `outlet_facts` — revenue, covers (resident vs non-resident) and APC per outlet

All money values are in **INR lakhs**, matching the source workbooks. The
frontend converts to crores when that toggle is selected.

`RETENTION_YEARS` (default 2) controls how many fiscal years are kept; older
years are pruned when a new month is committed.

## Tests

```bash
cd backend
python smoke_test.py
```

Runs against a temporary SQLite database and exercises the whole path: login,
role enforcement, uploading all seven workbooks, previewing, committing, reading
the dashboard, and re-uploading a month. It asserts each hotel's revenue matches
the reference figures and that revenue components and F&B cost splits reconcile.

## Notes on the source data

- The `seg` and `out` blocks in the original HTML dashboard were placeholder
  values. This app reads the real market-segment and outlet detail from sheets
  `1.2` and `1.3` of each book, so those tables will not match the old page.
- The original computed a hotel's `fees` and `ap` figures from overlapping rows,
  counting corporate advertising recoveries in both. Here `fees` is operating /
  licence fees plus licence fees plus CRS/CIS plus corporate services, and `ap`
  is advertising and promotion only.
- CCPT's outlet statement totals ₹214.3L against ₹240.6L of F&B income in its
  own P&L. That gap is in the source workbook; the app flags it on upload rather
  than silently reconciling it.

## Deliberate departures from the original HTML

- **Occupancy and ARR are two charts, not one.** The original plotted them on a
  single pair of y-axes. Two scales on one plot imply a correlation that the
  arbitrary scale alignment invents, so they are now separate single-measure
  charts showing the same numbers.
- **Single-series charts use one colour.** Revenue by hotel, EBITDA margin and
  cost structure previously gave every bar its own hue. Hotel identity is already
  on the axis, so the extra hues encoded nothing; cost structure is now sorted
  by size so the ranking carries the message.
- **Variance is shown as an arrow plus a value**, so direction never depends on
  colour alone.
