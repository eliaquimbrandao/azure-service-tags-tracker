# Azure IP Ranges & Service Tags — Tracker

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?logo=chartdotjs&logoColor=white)](https://www.chartjs.org/)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-222222?logo=github&logoColor=white)](https://pages.github.com/)
[![Azure](https://img.shields.io/badge/Azure-Service_Tags-0078D4?logo=microsoft-azure&logoColor=white)](https://docs.microsoft.com/en-us/azure/virtual-network/service-tags-overview)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🌐 **Live Dashboard**: [View Demo](https://azuretags.egbcorporate.org)

A **100% FREE** serverless solution to monitor Microsoft Azure's 3000+ Service Tags and IP ranges using GitHub Actions + GitHub Pages. No hosting costs, no server maintenance.

**Built to help the Azure community** track infrastructure changes, improve security posture, and automate network management.

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Python 3.11+ |
| **Frontend** | Vanilla JavaScript (ES6+) |
| **UI/UX** | HTML5 + CSS3 |
| **Charts** | Chart.js 4.4+ |
| **Automation** | GitHub Actions (Cron + Workflow Dispatch) |
| **Hosting** | GitHub Pages (Static Site) |
| **Data Storage** | JSON files (Git-versioned) |
| **Change Detection** | Per-tag prefix diff against the previous snapshot (SHA-256 of each download recorded) |

**No servers, no paid services** - Fork, enable Pages, and you're live in 2 minutes! ✨ (The workflow installs its two Python packages, `requests` and `beautifulsoup4`, by itself.)

---

## 🎯 Streamline Azure IP Tracking & Automation

Azure Service Tags Tracker is a free, serverless solution that continuously monitors Microsoft Azure Service Tag and IP range updates — visualizing changes, exposing weekly diffs, and enabling automated workflows without hosting costs. It helps security, networking, and cloud teams discover configuration drift, prevent policy breakages, and integrate change data into automation. Export JSON APIs to power your own monitoring, alerting, and firewall automation.

**Automatically tracks and visualizes changes** to Azure Service Tags weekly:

- 📊 **Analytics Dashboard**: Charts showing service volatility, regional infrastructure changes, and update timelines
- 📅 **Change History**: Complete timeline with detailed IP-level changes per service and region
- 🔍 **Smart Search**: Find services, regions, IP addresses or CIDR ranges across the current data and the full history
- 🏷️ **A Page per Service Tag**: Every tag has its own page with its current prefixes and recent changes, e.g. [`/tag/Storage.WestEurope/`](https://azuretags.egbcorporate.org/tag/Storage.WestEurope/)
- 🔌 **JSON API**: Current prefixes and dated diffs as static JSON, no key needed — see the [API docs](https://azuretags.egbcorporate.org/api.html)
- 📥 **Export Data**: Download filtered results as JSON or CSV
- 🌍 **Regional Analysis**: See which Azure regions and services are most active

---

## ⚡ Quick Start

### 1. Fork & Setup (2 minutes)

```bash
# Fork this repository on GitHub, then:
git clone https://github.com/yourusername/azure-service-tags-tracker.git
cd azure-service-tags-tracker
```

### 2. Enable GitHub Pages

1. **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, Folder: **/docs**
4. **Save**

### 3. Run Initial Baseline

1. **Actions** → **Update Azure Service Tags** → **Run workflow**
2. ✅ Check **"Setup initial baseline (first run)"**
3. **Run workflow**
4. Wait 2-3 minutes

Done! Your dashboard will be live at: `https://yourusername.github.io/azure-service-tags-tracker`

**Auto-updates**: Checks Microsoft's download **daily** and records a snapshot whenever a new version is published (roughly weekly)

---

## 📁 Project Structure

```text
azure-service-tags-tracker/
├── .github/workflows/
│   ├── update-data.yml           # Daily check (GitHub Actions)
│   └── test.yml                  # Self-checks on every pull request
├── docs/                         # GitHub Pages website
│   ├── index.html                # Main dashboard
│   ├── analytics.html            # Analytics & charts page
│   ├── history.html              # Change history timeline
│   ├── api.html                  # JSON API documentation
│   ├── tag/                      # One generated page per service tag (+ index)
│   ├── sitemap.xml, llms.txt     # For search engines and AI crawlers
│   ├── js/
│   │   ├── dashboard.js          # Main controller
│   │   ├── tag.js                # Copy buttons & filter on tag pages
│   │   └── modules/              # ES6 Modules
│   │       ├── core/             # Data & Region logic
│   │       ├── ui/               # UI Managers (Timeline, Modal, Search)
│   │       ├── visualizations/   # Charts & Lists
│   │       └── export/           # Export functionality
│   ├── css/
│   │   ├── style.css             # Main styles
│   │   ├── navigation.css        # Navigation & common components
│   │   ├── history-controls.css  # History page controls
│   │   └── tag.css               # Tag pages and API page
│   └── data/                     # JSON data storage
│       ├── current.json          # Latest Azure Service Tags
│       ├── summary.json          # Dashboard statistics
│       ├── regions.json          # Region code → display name
│       ├── collection-log.json   # Collection run history & coverage
│       ├── changes/              # Change detection reports
│       │   ├── manifest.json     # Index of all change files
│       │   ├── latest-changes.json
│       │   └── YYYY-MM-DD-changes.json
│       └── history/              # One snapshot per Microsoft publication
│           └── YYYY-MM-DD.json
├── examples/
│   └── api-usage-examples.md     # Pointer to the API docs
├── scripts/
│   ├── azure_watcher.py          # Data collection & change detection
│   ├── build_tag_pages.py        # Generates docs/tag/ and sitemap.xml
│   ├── verify_data.py            # Re-derives every diff from the snapshots
│   └── test_*.py, test-*.mjs     # Self-checks run in CI
└── README.md
```

### Key Components

**Backend (Python)**

- `azure_watcher.py`: Finds the current download on Microsoft's Service Tags page, downloads the JSON, and diffs each tag's prefixes against the previous snapshot
- `build_tag_pages.py`: Writes a static page per service tag, the tag index and `sitemap.xml`
- `verify_data.py`: Recomputes every reproducible change file from the archived snapshots before anything is committed

**Frontend (Vanilla JS + Chart.js)**

- **Modular Architecture**: ES6 modules for better maintainability (`TimelineManager`, `ChartManager`, `DataManager`, etc.)
- `dashboard.js`: Main controller that coordinates modules
- Horizontal bar charts for regional activity and service rankings
- Paginated timeline for Microsoft update tracking
- Monthly-navigable weekly activity charts
- Activity scoring algorithm for service ranking (frequency, volume, recency)

**Data Flow**

1. GitHub Action runs daily → Python script downloads latest Azure data and stops if it matches the last snapshot
2. Compares every tag's prefixes with the previous snapshot
3. Writes the change report (added/removed prefixes per tag), summary, manifest and log
4. Verifies the data, rebuilds the tag pages, commits to `docs/` → GitHub Pages auto-deploys
5. Dashboard loads JSON via fetch API and renders visualizations

---

## 🚀 Features

### Main Dashboard (`index.html`)

- **Summary Cards**: Total IP ranges, service changes and region changes this week — click one for details
- **Global Search**: Search service tags, regions, IP addresses or CIDR ranges across the current data and the full history; `?q=` links are shareable, `/` or Ctrl/Cmd-K focuses the box
- **Recent Changes**: Latest additions/removals with visual indicators

### Analytics Page (`analytics.html`)

- **📊 Weekly Change Activity**: Monthly-navigable bar chart of added/removed IPs per week
- **📅 Microsoft Update Timeline**: Paginated timeline with publish (blue) and collection (red) date markers
- **🌍 Regional Activity Distribution**: Horizontal bar chart with added/removed breakdown per region, plus Global summary card
- **🏆 Most Active Services**: Activity-scored ranking (Frequency 60%, IP Volume 20%, Recency 20%) with bar chart and sortable table

### History Page (`history.html`)

- **Complete Timeline**: Visual timeline of all weekly changes
- **Smart Filters**: Search by service, region, date range (last 7 days up to 1 year)
- **Detailed Views**: Expandable service cards with exact IP changes
- **One-Click Copy**: Copy all added or removed IPs per service
- **Export Data**: Download selected weeks or filtered results as JSON or CSV

### Service Tag Pages (`tag/`)

- **One page per tag** (3,000+), e.g. `/tag/AzureFrontDoor.Backend/`: current IPv4/IPv6 prefixes with copy buttons, region, `changeNumber`, and recent changes with the exact prefixes
- **Tag index** at `/tag/` grouped by service, with a filter and A–Z jump
- Plain static HTML, so search engines can index every tag
- **Region Navigation**: Browse changes by geographic region

---

## API Access & Usage

All data is publicly accessible as static JSON: no key, no rate limit, CORS enabled. **Docs with copy-paste PowerShell, curl and Python examples: [azuretags.egbcorporate.org/api.html](https://azuretags.egbcorporate.org/api.html).**

### Quick Reference

**Base URL**: `https://azuretags.egbcorporate.org` (on your fork: `https://yourusername.github.io/azure-service-tags-tracker`)

**Available Endpoints**:

- `/data/current.json` - Latest Azure Service Tags snapshot (Microsoft's format)
- `/data/changes/manifest.json` - Index of all change reports — start here
- `/data/changes/YYYY-MM-DD-changes.json` - Exact prefixes added/removed per tag since the previous snapshot
- `/data/changes/latest-changes.json` - Most recent change report
- `/data/history/YYYY-MM-DD.json` - Full historical snapshots (~3 MB each; you rarely need these)
- `/data/summary.json` - Statistics, snapshot dates and definitions
- `/data/regions.json` - Region code → display name
- `/data/collection-log.json` - Collection run history, coverage, and missing dates

To follow changes, read the manifest and fetch the change files newer than the last one you processed. Each one already contains the diff, so there's no need to download and compare snapshots.

### Change file schema (v2)

Every change file has `"schema_version": 2`. All v1 fields are still present; v2 adds:

| Field | Meaning |
|---|---|
| `baseline` | `true` only for the initial snapshot; skip it when counting changes |
| `changes[].added_count` / `removed_count` | Present on **every** change type; a new tag counts all its prefixes as added, a removed tag all as removed |
| `changes[].coverage` | Address space newly covered / no longer covered by that tag: IPv4 in addresses, IPv6 in /64 networks |
| `changes[].classification` | `expansion`, `contraction`, `mixed`, or `representation_only` (CIDRs changed, same addresses) |
| `metadata_changes[]` | Tags whose `region`, `regionId`, `platform`, `systemService` or `networkFeatures` changed |
| `comparison.previous_snapshot` / `current_snapshot` | The two `history/` files compared (`null` when the previous one was never archived) |
| `comparison.previous_change_number` / `current_change_number` | Microsoft `changeNumber` on each side |
| `comparison.skipped_change_numbers` | Microsoft versions published between the two collections that were never collected |
| `comparison.*_membership_total`, `added_memberships`, `removed_memberships`, `balanced` | `previous + added − removed = current`, checked on every run |
| `comparison.reproducible` | `true` when the change list can be re-derived from the two archived snapshots |
| `metadata.date_published_source` | `download_page` (read from Microsoft's page) or `inferred_from_filename` |
| `metadata.source_url`, `content_sha256`, `retrieved_at` | Which file was downloaded, its hash, and when |

`regions.json` is regenerated on every run from Microsoft's own tag names (`Storage.FranceCentral` → "France Central"). Where Service Tags use a different spelling for the same region (`centralfrance`), both spellings get the same name and the dashboard treats them as one region; every distinct region keeps its own entry. A region that no tag spells out (currently `brazilne` and `northeurope2`, each present only as an `AzureCloud.*` tag) is shown by its raw code, because Microsoft publishes no name for it. No manual region list to maintain.

"IP ranges" totals count **tag-prefix memberships**: a CIDR listed under two tags counts twice. `summary.json` carries a `definitions` block with these explanations.

Each run is checked by `scripts/verify_data.py`, which re-derives every reproducible comparison from the archived snapshots, before anything is committed. A failed collection is recorded in `collection-log.json` (`status: "failed"`).

---

## 🛠️ Local Development

```bash
# Run from the repository root
pip install -r requirements.txt
python scripts/azure_watcher.py --baseline  # First run
python scripts/azure_watcher.py             # Regular update
python scripts/build_tag_pages.py           # Rebuild docs/tag/ and sitemap.xml

# Checks (also run in CI before every data commit)
python scripts/test_watcher.py
node scripts/test-change-counts.mjs
node scripts/test-search.mjs
python scripts/test_tag_pages.py
python scripts/verify_data.py

# Test dashboard locally
cd docs
python -m http.server 8000
# Open http://localhost:8000
```

---

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Action not running | Check the Actions tab; on a fork, enable workflows there first |
| Site not published | GitHub Pages on a private repo needs a paid GitHub plan; keep the fork public |
| Dashboard empty | Run baseline setup first with checkbox enabled |
| No data loading | Verify `docs/data/current.json` exists and is valid JSON |
| Pages not working | Settings → Pages → Deploy from `main` branch, `/docs` folder |

---

## 📜 License

Made with ❤️ by [Eliaquim Brandão](https://github.com/eliaquimbrandao)

This project is licensed under the [MIT License](LICENSE).

⭐ Star this repo if you find it useful!

---

## 📞 Contact

For any questions or suggestions, feel free to reach out:

- **LinkedIn**: [Eliaquim Brandão](https://www.linkedin.com/in/eliaquim/)
- **GitHub**: [Eliaquim Brandão](https://github.com/eliaquimbrandao)

**🐛 Report issues** or suggest features in [GitHub Issues](https://github.com/eliaquimbrandao/azure-service-tags-tracker/issues)

**🤝 Contribute** to make it even better for the Azure community!

---

## ⚠️ Disclaimer

> [!WARNING]
> **Disclaimer:**  
> This codebase was developed with the assistance of artificial intelligence and is provided **"as-is"**, without warranties or guarantees of any kind. While extensive testing has yielded successful results, the author and contributors assume no responsibility for any direct or indirect damages, losses, or operational issues resulting from its use or misuse.  
> **Users are solely responsible for thoroughly reviewing, testing, and validating these scripts in their own environments before deploying them in production. By using this code, you acknowledge and accept all associated risks.**
