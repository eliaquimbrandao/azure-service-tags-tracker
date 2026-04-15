# Azure Service Tags & IP Ranges Tracker - AI Coding Agent Guide

## Architecture Overview

This is a **serverless monitoring system** that tracks weekly changes to Azure Service Tags using GitHub Actions + GitHub Pages. No backend server — everything runs via scheduled CI and static files.

- **Data Collection**: `scripts/azure_watcher.py` (Python) downloads Microsoft's Service Tags JSON weekly
- **Change Detection**: Compares current data with previous snapshots, generates diff reports
- **Web Dashboard**: Static site in `docs/` — three pages (index, history, analytics) with interactive charts and global search
- **Automation**: GitHub Actions (`.github/workflows/update-data.yml`) runs every Monday 7AM UTC
- **Hosting**: GitHub Pages serves the dashboard from the `docs/` folder on the `main` branch

## Critical Data Flow

1. **Weekly Schedule**: GitHub Action triggers Monday 7AM UTC → `azure_watcher.py` runs
2. **Download**: Scrapes Microsoft's confirmation page to find the current JSON download URL (URL changes weekly)
3. **Change Analysis**: Compares downloaded JSON with `docs/data/current.json` → generates change report in `docs/data/changes/YYYY-MM-DD-changes.json`
4. **Historical Archive**: Full snapshot saved to `docs/data/history/YYYY-MM-DD.json`
5. **Metadata Update**: `docs/data/summary.json`, `docs/data/changes/manifest.json`, `docs/data/changes/latest-changes.json`, and `docs/data/collection-log.json` all updated
6. **Auto-Deploy**: Git commit triggers GitHub Pages rebuild automatically

## Project Structure

```
.github/
  workflows/update-data.yml     # Weekly cron action
  copilot-instructions.md       # This file
scripts/
  azure_watcher.py              # Data collection + change detection (only backend script)
docs/                           # GitHub Pages root — everything here is served
  index.html                    # Main dashboard page
  history.html                  # Change history timeline page
  analytics.html                # Analytics/charts page
  css/
    style.css                   # Main stylesheet
    navigation.css              # Nav bar styles
    history-controls.css        # History page filter controls
  js/
    dashboard.js                # Main controller — imports and wires all modules
    scroll-handler.js           # Smooth scroll behavior
    modules/
      core/
        DataManager.js           # Loads all JSON data, builds service prefix lookups
        RegionMapper.js          # Maps Azure region codes (eastus) → display names (East US)
      ui/
        SearchManager.js         # Global search across services, regions, IPs + modal rendering
        ChangeRenderer.js        # Renders change entries with IP lists (IPv4/IPv6 split)
        ModalManager.js          # Modal dialog management (open/close/overlay)
        TimelineManager.js       # Timeline view for historical changes
      visualizations/
        ChartManager.js          # Chart.js charts (timeline, trends, activity, regional)
        RegionalAnalysis.js      # Region-level change analysis
        ServiceList.js           # Activity scoring, bar chart + ranked table
      export/
        ExportManager.js         # JSON/CSV export functionality
  data/
    current.json                # Latest Microsoft Service Tags JSON (~4MB)
    summary.json                # Dashboard statistics (total services, weekly changes, etc.)
    regions.json                # Region code → display name mapping
    collection-log.json         # Tracks every collection run (date, changeNumber, coverage)
    changes/
      manifest.json             # Index of all change files with metadata
      latest-changes.json       # Symlink/copy of most recent change file
      YYYY-MM-DD-changes.json   # Per-week change diffs
    history/
      YYYY-MM-DD.json           # Full Service Tags snapshots (~4MB each)
```

## JavaScript Architecture (ES Modules)

The dashboard uses **ES modules** (`<script type="module">`). All three HTML pages load `dashboard.js` which imports everything:

```
dashboard.js (controller)
  ├── RegionMapper       — region code resolution
  ├── DataManager        — data loading, service prefix lookup
  ├── ChartManager       — all Chart.js visualizations
  ├── ServiceList        — service activity scoring, bar chart + table
  ├── ChangeRenderer     — renders IP change entries (added/removed/active, IPv4/IPv6)
  ├── ModalManager       — modal overlay management
  ├── RegionalAnalysis   — per-region change analysis
  ├── SearchManager      — global search with unified modals for active + history results
  ├── TimelineManager    — timeline browsing with pagination
  └── ExportManager      — JSON/CSV export of filtered data
```

### Key Patterns

- **Module instantiation**: `dashboard.js` constructor creates all module instances and passes dependencies (no global state)
- **Data flow**: `DataManager.loadAllData()` fetches all JSON upfront → passed to modules via setters
- **Search modals**: `SearchManager` handles both "Active" (current state) and "History" (past changes) result modals with unified layout — both show top stat boxes (IP count, +added, -removed) and split IPs into IPv4/IPv6 sections
- **Search matching**: Supports fuzzy matching (spaces stripped: "azure monitor" → "azuremonitor") and multi-word combined search ("monitor east us" matches service+region). All query words must match somewhere in the combined text.
- **Change rendering**: `ChangeRenderer.renderIPList()` supports types: `added`, `removed`, `active`, `ipv4`, `ipv6`, `added-ipv4`, `added-ipv6`, `removed-ipv4`, `removed-ipv6` — each with appropriate styling, titles, and copy buttons
- **Region mapping**: `RegionMapper.getRegionDisplayName(code)` resolves programmatic names; always use this instead of raw lookups
- **Chart.js**: Version 4.4 via CDN, used for timeline, weekly activity, regional, and service charts
- **Activity scoring**: `ServiceList.js` scores services by Frequency 60% (absolute: weeks/totalWeeks), IP Volume 20% (relative to max), Recency 20% (absolute: recent 4 weeks). AzureCloud entries are excluded.
- **Chart navigation**: Weekly Activity has month navigation, Timeline has batch pagination (4 per page), Regional Activity is horizontal bars with Global extracted to summary card
- **HTML onclick handlers**: Some buttons use `onclick="dashboard.methodName()"` — the dashboard instance is exposed as `window.dashboard`

### ⚠️ Important: Do NOT duplicate module logic

Previous dead code was cleaned up — 13 methods (~1,300 lines) that were duplicated between `dashboard.js` and the modules were removed. If you need chart rendering, use `ChartManager`. If you need search, use `SearchManager`. Don't add methods to `dashboard.js` that belong in modules.

## Python Script (`azure_watcher.py`)

- **Scrapes Microsoft's confirmation page** to find current JSON URL (changes weekly)
- **Hash-based change detection** prevents duplicate processing
- **Robust error handling** with retries for network failures
- **Baseline mode** (`--baseline` flag) for initial setup without change detection
- **Collection log**: `update_collection_log()` writes to `docs/data/collection-log.json` after every run with date, changeNumber, whether changes were detected, and coverage statistics
- **No data deletion**: Historical snapshots and change files are NEVER deleted — all data is preserved permanently

## Data Structures

```json
// docs/data/current.json — Raw Microsoft data (~4MB, 3000+ service tags)
{"changeNumber": 20260207, "cloud": "Public", "values": [{
  "name": "ActionGroup", "id": "ActionGroup",
  "properties": {"changeNumber": 20260103, "region": "", "regionId": 0,
    "platform": "Azure", "systemService": "ActionGroup",
    "addressPrefixes": ["13.65.25.19/32", "13.66.60.119/32", ...]}
}]}

// docs/data/summary.json — Dashboard statistics
{"total_services": 3039, "total_ip_ranges": 48291, "changes_this_week": 63,
 "last_updated": "2026-02-09", "top_active_services": [...],
 "change_number": 20260207, "weekly_trend": [...]}

// docs/data/changes/YYYY-MM-DD-changes.json — Weekly diffs
{"timestamp": "2026-02-02T07:00:00Z", "change_number": 20260207,
 "previous_change_number": 20260131,
 "changes": [{"service": "AzureCloud.eastus", "type": "ip_changes",
   "added_prefixes": ["1.2.3.0/24"], "removed_prefixes": [],
   "added_count": 1, "removed_count": 0}]}

// docs/data/changes/manifest.json — Index of all change files
{"files": [{"filename": "2026-02-09-changes.json", "date": "2026-02-09",
  "change_count": 63, "change_number": 20260207}],
 "total_files": 19, "last_updated": "2026-02-09"}

// docs/data/collection-log.json — Collection run history
{"runs": [{"date": "2026-02-09", "change_number": 20260207,
  "changes_detected": true, "change_count": 63}],
 "coverage": {"total_expected_weeks": 19, "total_collected": 15,
  "coverage_percentage": 78.9}}

// docs/data/regions.json — Region display names
{"eastus": "East US", "westeurope": "West Europe", ...}
```

## Data Coverage & Known Gaps

The project started in October 2025. Some early weeks were missed before the weekly schedule stabilized:

- **Missing history snapshots** (no full JSON): 2025-10-13, 2025-10-17, 2025-10-27, 2025-11-03, 2025-11-10, 2025-11-17
- **Change files exist** for those dates (some with 0 changes, some with real data) but the full Service Tags JSON was not downloaded
- These gaps cause 404 errors in the browser console on the Analytics page — this is expected and harmless
- Coverage is tracked in `collection-log.json` (currently ~79%)

## Essential Development Commands

```bash
# Test data collection locally
python scripts/azure_watcher.py --baseline  # First run (no previous data to compare)
python scripts/azure_watcher.py            # Regular update with change detection

# Test dashboard locally
cd docs && python -m http.server 8000     # Serve on localhost:8000

# Manual GitHub Action trigger
# Go to Actions tab → "Update Azure Service Tags" → "Run workflow"
```

## Integration Points

- **Microsoft API**: Downloads from dynamic URLs found on the Azure service tags download page
- **GitHub Actions**: Requires `contents: write` permission for committing data updates
- **GitHub Pages**: Serves from `docs/` folder on `main` branch, rebuilds automatically on push
- **Chart.js 4.4 CDN**: Dashboard depends on `https://cdn.jsdelivr.net/npm/chart.js` for visualizations (loaded with `defer`)
- **date-fns CDN**: `https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js` (loaded with `defer`)

## Performance Optimizations

PageSpeed score target: 95+ (desktop). Key optimizations applied:

- **Preconnect hints**: `<link rel="preconnect">` for jsdelivr, cloudflare, and unsplash CDN origins
- **Module preloading**: All 11 JS modules have `<link rel="modulepreload">` to eliminate the serial import waterfall (was 1,940ms critical path)
- **Deferred scripts**: Chart.js, date-fns, and scroll-handler.js all use `defer` to avoid render-blocking
- **LCP preload**: Hero background image preloaded with `fetchpriority="high"` for early discovery
- **CLS prevention**: `#dashboard` uses `visibility: hidden` + `min-height: 50vh` instead of `display: none` so the footer doesn't shift when content loads
- **GPU-compositable animations**: Hero animations (`ringPulse`, `connectionPulse`) only animate `opacity` and `transform` — no `stroke-width` which forces CPU paint
- **Image optimization**: Hero Unsplash image uses `w=1280` (not 2000) since it's behind an 85% dark gradient overlay
- **Accessibility**: Footer link color is `#34d399` (5.5:1 contrast ratio) instead of `#10b981` (4.2:1) to pass WCAG AA

## Project Conventions

- **File Naming**: Historical files use `YYYY-MM-DD.json` format (UTC dates, typically Mondays)
- **Commit Messages**: Automated commits use emoji prefixes (`📊 Update Azure Service Tags data`, `📈 Data collection`)
- **Error Handling**: Python script continues on network errors, logs to GitHub Actions output
- **Data Persistence**: All data stored in `docs/data/` for GitHub Pages access — NEVER delete historical data
- **Module boundaries**: Each module is self-contained with its own class. Dependencies are injected via constructor. Don't create circular dependencies.
- **CSS**: Main styles in `style.css`, page-specific in `history-controls.css` and `navigation.css`
- **Animations**: Hero section uses `ringPulse` and `connectionPulse` keyframes (GPU-compositable, opacity+transform only). Generic `pulse` keyframe still exists for other uses but should NOT animate `stroke-width`.
- **Script loading**: CDN scripts use `defer`, modules use `<link rel="modulepreload">` + `<script type="module">`. Never add render-blocking `<script>` tags without `defer` or `async`.

## Common Debugging Scenarios

- **Missing data**: Check if GitHub Action completed successfully in Actions tab
- **Dashboard not loading**: Verify GitHub Pages enabled in Settings → Pages → Deploy from branch `main` / `docs` folder
- **No changes detected**: Microsoft sometimes doesn't publish changes for a week (same `changeNumber`). This is normal — a change file with 0 changes is still created.
- **Python errors**: Check Action logs for network timeouts or JSON parsing issues
- **404 errors in console for history files**: Expected for weeks before October 2025 when collection began. These gaps are documented in `collection-log.json`
- **Modals not rendering**: Check `SearchManager.js` for active/history modal logic, `ChangeRenderer.js` for IP list rendering, `ModalManager.js` for overlay management
- **Charts not rendering**: Check `ChartManager.js` — each chart method has its own try/catch. Verify `DataManager` loaded historical data successfully
- **Region names showing raw codes**: Ensure `RegionMapper.loadRegions()` completed and use `this.regionMapper.getRegionDisplayName(region)` (not direct map lookups)
