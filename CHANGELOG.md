# Changelog

All notable changes to the Azure Service Tags & IP Ranges Tracker project.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] - 2026-04-15

### ⚡ PageSpeed Performance & Accessibility Improvements

#### Added
- **Preconnect hints** for CDN origins (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `images.unsplash.com`) on all 3 pages
- **Module preloading** — `<link rel="modulepreload">` for all 11 JS modules to eliminate serial import waterfall (was 1,940ms critical path)
- **LCP image preload** with `fetchpriority="high"` for early hero background discovery
- **GPU-compositable animation keyframes** (`ringPulse`, `connectionPulse`) using only `opacity` and `transform`

#### Changed
- **Script loading** — Chart.js, date-fns, and `scroll-handler.js` now use `defer` attribute (previously render-blocking, ~300ms savings)
- **CLS fix** — `#dashboard` element uses `visibility: hidden` + `min-height: 50vh` instead of `display: none` to reserve layout space and prevent footer shift (CLS 0.198 → ~0)
- **Hero image** — Reduced Unsplash image from `w=2000` to `w=1280` (~30% smaller, image is behind 85% dark overlay)
- **Footer link contrast** — Changed from `#10b981` (4.2:1 ratio) to `#34d399` (5.5:1 ratio) for WCAG AA compliance
- **Non-composited animations** — Replaced `pulse` animation on `.ring` and `.connection` elements to avoid animating `stroke-width` (not GPU-compositable, caused jank + CLS)

---

## [Unreleased] - 2026-03-12

### 📊 Analytics Dashboard Overhaul

#### Changed
- **Weekly Change Activity Chart**
  - Added month-by-month navigation with previous/next controls
  - Groups data by calendar month for focused viewing

- **Microsoft Update Timeline**
  - Replaced month-based pagination with update-batch pagination (4 updates per page)
  - Uses real date x-axis within each page for accurate temporal spacing
  - Keeps publish + collection date pairs together on the same page
  - Added dashed connector lines between Microsoft Published → Data Collected points showing collection lag
  - Lag days label (e.g. "6d") drawn on each dashed line for at-a-glance visibility
  - Improved description text to clearly state what the chart shows
  - Removed redundant footer legend — Chart.js legend and inline labels are sufficient

- **Regional Activity Distribution**
  - Replaced doughnut chart with horizontal bar chart showing added/removed breakdown
  - Extracted Global summary into a clickable stat card above the chart
  - Fixed region click modal: corrected region key matching and field names
  - Added pagination to regional modal (50 items per page with "Show more")

- **Most Active Services**
  - Replaced card-based paginated list with horizontal bar chart (top 15) + compact sortable table
  - Implemented weighted activity scoring algorithm: Frequency 60% (absolute), IP Volume 20% (relative), Recency 20% (absolute)
  - Frequency is absolute (weeks active / total tracked weeks), not relative to other services
  - Added frequency badges (High/Medium/Low), avg IPs per week, and visual score bars
  - Filters out AzureCloud entries to focus on actual services
  - Aggregates by base service name (system_service) instead of service+region variants

#### Removed
- **Top 10 AzureCloud Regions pie chart** — redundant with improved Regional Activity horizontal bars
- **Intensity per week scoring factor** — was redundant with IP Volume and rewarded one-time bursts

### 🔍 Global Search Improvements

#### Changed
- **Fuzzy Matching**
  - Search now strips spaces from query for matching ("azure monitor" finds "AzureMonitor")
  - Works for both service names and region names ("east us" finds "eastus")

- **Multi-Word Combined Search**
  - Queries with multiple words match across service name + region combined
  - "monitor east us" finds AzureMonitor entries in East US region
  - "datafactory west europe" finds DataFactory entries in West Europe
  - All words must match somewhere in the combined service + region text

### 🧹 Dead Code Cleanup

#### Removed
- **dashboard.js** (~60 lines)
  - Duplicate `parseDateOnly()` method — calls redirected to `DataManager`
  - `fetchWithCacheBust()` wrapper — calls redirected to `DataManager`
  - Unused constructor properties: `regionDisplayMap`, `cacheBust`, `timelinePageSize`, `timelineVisibleCount`
  - Legacy `#serviceModal` close/escape event listeners (ModalManager handles modals dynamically)

- **index.html & history.html** (~20 lines each)
  - Unused `#serviceModal` HTML blocks — never opened; ModalManager creates dynamic modals

- **RegionMapper.js**
  - Removed `getDisplayName()` alias — single caller updated to use `getRegionDisplayName()`

---

## [Unreleased] - 2026-02-12

### 🔍 Search & Modal Unification, Data Integrity & Collection Tracking

#### Added
- **Collection Log** (`docs/data/collection-log.json`)
  - Tracks every script run with date, changeNumber, changes detected, total services/IPs
  - Calculates coverage percentage and identifies missing weekly collections
  - Automatically updated on each `azure_watcher.py` run
  - Backfill script to populate log from existing history files

- **IPv4/IPv6 Separation in Modals**
  - Active (Current State) modal now shows separate IPv4 Ranges and IPv6 Ranges sections
  - History modal splits Added/Removed IPs into IPv4 and IPv6 subsections
  - Each section has its own copy button (Copy IPv4, Copy IPv6, etc.)

- **Data Recovery**
  - Recovered 9 deleted data files from git history (3 history snapshots, 6 change reports)
  - Backfilled 3,090 missing IP prefixes in old `service_added` change entries

#### Changed
- **Unified Modal Layouts**
  - Active and History modals now share the same top stat box pattern (count / +added / -removed)
  - Both use identical structure: `historical-summary`, `summary-stat-box`, `historical-events-list`

- **Unified Search Result Items**
  - Active service items now show `+X IPs • -0 IPs • Y IPv4 • Z IPv6` matching History format
  - Both Active and History items use same visual structure and badge styling

- **Current State Modal**
  - Now shows full IP list with expand/collapse and copy functionality
  - Search results store actual `prefixes` array (not just count)

- **Modal CSS**
  - Fixed content clipping at edges (added `1.5rem` padding to modal body/content)

- **Data Retention**
  - Removed `cleanup_old_files()` function — all historical data is now preserved permanently
  - Regenerated `manifest.json` and `summary.json` with full date range

#### Removed
- **Dead Code Cleanup** (~800 lines)
  - Removed 13 dead methods from `dashboard.js` that were duplicated in ES6 modules
  - Removed unused class fields (`currentModal`, `filteredServices`, `servicesPage`, etc.)
  - Deleted one-time utility scripts (`backfill_prefixes.py`, `regenerate_manifest.py`, `backfill_collection_log.py`)

---

## [Unreleased] - 2025-12-22

### ♻️ Code Refactoring & Modularization

#### Changed
- **Frontend Architecture**
  - Refactored monolithic `dashboard.js` into ES6 modules.
  - Created dedicated managers: `TimelineManager`, `ModalManager`, `ChartManager`, `DataManager`.
  - Improved code maintainability and separation of concerns.
- **Performance**
  - Optimized DOM manipulation by splitting UI logic into specialized modules.

## [Unreleased] - 2025-12-12

### 🚀 SEO, UI Polish & Content Expansion

#### Added
- **Homepage "Value Proposition" Section**
  - Added "Why Teams Rely on This" section with 3 feature cards and 2 FAQ cards.
  - Implemented collapsible/expandable cards for cleaner UI.
  - Added "Glassmorphism" visual style with backdrop filters and gradients.
- **SEO Optimization**
  - Added JSON-LD Structured Data (`SoftwareApplication` schema).
  - Added Open Graph (Facebook/LinkedIn) and Twitter Card meta tags.
  - Added Canonical URLs to all pages.
  - Created `robots.txt` to guide search engine crawlers.
- **Roadmap Transparency**
  - Added clear messaging about future premium features (Alerts & Custom Filtering) with Q3 2026 ETA.

#### Changed
- **Chart.js Library Update**
  - Switched to `chart.umd.min.js` (v4.4.1) to resolve source map 404 errors in browser console.
- **IP Search UI**
  - Refactored IP search results to display as a clean vertical list instead of inline blocks.
  - Added highlighting for matched IP ranges.
- **Documentation Corrections**
  - Updated all repository URLs to `azure-service-tags-tracker`.
  - Corrected automation schedule time to **00:00 UTC** in `README.md` and `index.html`.
  - Fixed broken links in API usage examples.

---

## [Unreleased] - 2025-10-24

### 🎨 Analytics Dashboard Redesign & Timeline Improvements

#### Added

- **AzureCloud Regional Infrastructure Pie Chart**
  - Replaced "Top 10 Most Volatile Services" with "Top 10 Most Affected AzureCloud Regions"
  - Shows Azure global infrastructure changes by region (West US 2, East US, etc.)
  - Filtered to show ONLY AzureCloud variants (excluding actual services)
  - Better separation between infrastructure (AzureCloud) and services (analytics)
  - Includes region display name mapping for user-friendly labels

- **Microsoft Update Timeline with Markers**
  - Converted confusing 3-line chart to clear scatter plot with distinct markers
  - **Green Circle**: Baseline start (first data collection)
  - **Blue Triangle**: Microsoft publishes update
  - **Red Diamond**: Data collected by system
  - Shows temporal progression with separate event lanes
  - Clearly visualizes collection delays between Microsoft publish and data collection

- **Cloud Emoji Favicon**
  - Added ☁️ favicon to all pages (index, analytics, history)
  - Inline SVG data URL (no external file needed)
  - Eliminates 404 errors for favicon.ico

#### Changed

- **AzureCloud Filtering Strategy**
  - Implemented 3-layer filtering to separate infrastructure from services:
    1. `loadHistoricalActivity()` - filters at data aggregation
    2. `renderActiveServicesChart()` - filters current week display
    3. `renderServiceTrendsChart()` - filters for pie chart (now shows regions)
  - Ensures no AzureCloud tags appear in service-focused analytics

- **Microsoft Publish Date Parsing**
  - Fixed timezone issue causing dates to shift by 1 day
  - Explicit parsing of MM/DD/YYYY format to UTC: `Date.UTC(year, month, day)`
  - Ensures "10/09/2025" correctly maps to Oct 9, not Oct 8
  - Baseline filtering: Microsoft published dates only shown if AFTER baseline date

- **Duplicate Title Cleanup**
  - Removed JavaScript-generated duplicate titles
  - HTML is now single source of truth for section titles
  - Cleaner rendering without redundant headings

#### Fixed

- Timeline chart not displaying data (Chart.js time scale dependency issue)
  - Solution: Changed from scatter plot with time scale to line chart with categorical scale
  - Uses formatted date labels instead of requiring date adapter
- Microsoft published dates appearing on baseline date
  - Added filter: only show Microsoft publish events AFTER baseline collection
- Dates off by 1 day due to timezone conversion
  - Changed from `new Date(year, month, day)` to `Date.UTC(year, month, day)`
- Duplicate "Most Active Services" titles
  - Removed JavaScript-generated title, kept HTML title only
- AzureCloud appearing in "Most Active Services" despite filtering
  - Added comprehensive filtering at all data processing points

#### Technical Improvements

- Removed all debug console.log statements (production-ready code)
- Enhanced date parsing with explicit UTC handling
- Improved code organization: separated infrastructure vs service analytics
- Better Chart.js configuration for timeline markers (showLine: false)
- Regional infrastructure now has dedicated visualization

---

## [Unreleased] - 2025-10-22

### 🎨 Major UI/UX Enhancements: History Page Redesign

#### Added

- **Enhanced History Page Filtering**
  - Region dropdown now populated with 71 actual Azure regions from data
  - Real-time search across service names, regions, and dates
  - Date range filters (7/14/30/45/60 days, All Time)
  - Results counter showing filtered vs total weeks
  
- **Detailed Service Change Views**
  - Expandable service items showing all IP changes when filtering
  - Copy All Added IPs button per service (green)
  - Copy All Removed IPs button per service (red)
  - Clean display of IP ranges with proper formatting

- **Modern Button Design**
  - Purple gradient buttons (Compare Weeks, Export JSON)
  - Outlined Reset Filters button with hover effects
  - Active state styling for Compare mode (pink gradient)
  - Smooth animations and transitions

- **Enhanced Timeline Header**
  - Beautiful gradient background matching button theme
  - Decorative top accent bar
  - Centered layout with proper spacing
  - Fixed duplicate header issue

- **Improved Week Comparison Modal**
  - Compact, centered layout with better spacing
  - Gradient stat boxes with hover effects
  - Gradient text on numbers for visual appeal
  - Enhanced insights section with slide animations
  - Proper separation between header and content

#### Changed

- **Simplified Export Functionality**
  - Removed CSV and Summary export options
  - Single "Export JSON" button for cleaner UX
  - **Minimal data export** - only includes:
    - Date of change
    - Service name
    - Added IP addresses array
    - Removed IP addresses array
  - Export respects active filters (search/region)
  - Smaller, cleaner JSON files for easier processing

- **Reset Filters Enhancement**
  - Visual feedback (✅ Filters Reset) for 1.5 seconds
  - Automatically exits Compare mode when resetting
  - Prevents double-clicks during reset
  - Returns to original state smoothly

- **Baseline Data Handling**
  - Automatically excludes baseline snapshot (oldest date) from timeline
  - Prevents showing initial data load as a "change"
  - Cleaner timeline showing only actual updates

#### Fixed

- Console error "recentChanges container not found" on History page
- Calendar emoji (📅) not displaying in page header due to CSS gradient text
- Region label showing undefined character (� → 🌍)
- Export button emoji encoding (� → 📥)
- Timeline not loading data due to overly aggressive filtering
- DOM element null reference errors in renderStats() and renderLastUpdated()
- getRegionDisplayName scope issue (removed incorrect `this.` prefix)
- Region dropdown showing "All Regions" twice
- Export including too much metadata and unnecessary fields

#### Technical Improvements

- Added null checks for all DOM elements before manipulation
- Enhanced error handling with silent failures where appropriate
- Improved region name mapping with fallback formatting
- Optimized CSS with consistent purple gradient theme (#667eea → #764ba2)
- Mobile-responsive design for all new components
- Better code organization and documentation

---

## [Unreleased] - 2025-10-14

### 🎯 Major API Simplification: Auto-Discovery of Historical Data

#### Changed

- **BREAKING**: Simplified all API functions to use single parameter (service name only)
- Removed requirement for users to specify date parameters
- Auto-discovery of all available historical snapshots
- Removed verbose IP listings from console output - now shows summary only

#### Added

- Multi-source date discovery mechanism (summary.json → manifest.json fallback)
- Dashboard link in output for detailed IP information
- Comprehensive error handling for missing snapshots
- Clean, formatted output showing change summary across history
- Updated examples for all 3 languages (PowerShell, JavaScript, Python)

#### Fixed

- PowerShell syntax errors (removed JavaScript code mixed into PowerShell)
- Python: Removed current date addition that caused 404 errors
- Function return statements causing raw data output
- Try-catch block structure and indentation issues
- HTML 404 error display when fetching non-existent snapshots

#### Migration Guide

**Before**: `Get-AzureServiceChanges -ServiceName "Storage" -Date1 "2025-10-08" -Date2 "2025-10-10"`  
**After**: `Test-AzureServiceChanges -ServiceName "Storage"`

---

## [1.3.0] - 2025-10-13

### Added

- **Change History Timeline** with two-level navigation system
- **Global Historical Search** across all change reports
- Enhanced analytics dashboard with improved UX
- Auto-merge capability to workflow for automated updates

### Changed

- Workflow now creates Pull Requests instead of direct push to main
- UI simplification for better user experience

### Fixed

- Workflow improvements for automation

---

## [1.2.0] - 2025-10-11

### Changed

- Workflow schedule updated to run twice weekly (Monday & Thursday 7 AM UTC)
- Improved region search modal UX with better spacing and interactions

### Removed

- Cleaned up unnecessary files and folders from repository

---

## [1.1.0] - 2025-10-10

### Added

- Interactive analytics dashboard with enhanced features
- Regional Hotspots section with click handlers
- Yellow status indicator for recent changes (within 7 days)
- Enhanced modal UI with optimized spacing and search functionality

### Changed

- Removed "Total Services" card for cleaner dashboard layout
- Improved modal clarity and user experience
- Updated README with recent UI/UX improvements

### Fixed

- Dashboard UX improvements across multiple areas
- Modal display and interaction issues

---

## [1.0.0] - 2025-10-08

### 🎉 Initial Release

#### Added

- **Core Functionality**:
  - Automated weekly monitoring of Azure Service Tags via GitHub Actions
  - Python-based data collection script (`azure_watcher.py`)
  - Change detection algorithm comparing snapshots
  - Historical tracking with JSON archival
  - Baseline setup mode (`--baseline` flag) for initial data collection

- **Web Dashboard**:
  - Interactive dashboard with search functionality
  - Regional breakdown with official Azure region display names
  - Service-specific change details in modal dialogs
  - Change timeline visualization
  - Beautiful Earth background with city lights and atmospheric glow
  - Ultra-compact hero section design
  - Responsive layout for all screen sizes
  - Regional list (clickable, sorted alphabetically)

- **Data Structure**:
  - `/docs/data/current.json` - Latest Azure Service Tags
  - `/docs/data/history/YYYY-MM-DD.json` - Historical snapshots
  - `/docs/data/changes/latest-changes.json` - Most recent changes
  - `/docs/data/changes/YYYY-MM-DD-changes.json` - Historical change reports
  - `/docs/data/changes/manifest.json` - Index of all change reports
  - `/docs/data/summary.json` - Statistics and metadata

- **Documentation**:
  - Comprehensive README with setup instructions
  - `.github/copilot-instructions.md` for AI agent guidance
  - Clear project structure documentation
  - API usage examples

#### Fixed

- GitHub Actions permissions for automated data updates (`contents: write`)
- Footer link pointing to correct repository URL
- Data paths for GitHub Pages compatibility (moved from root to `docs/data/`)
- Infinite scroll issue in regional charts
- Regional flags matching logic and country code mappings
- Region count to show only actual Azure regions (71 total, excluding service suffixes)
- HTML title tag to reflect "Weekly monitoring" instead of "Real-time"
- SEO: Consistent naming and meta tags across all pages
- Modal display issues and dashboard stability

#### Technical Implementation

- GitHub Pages deployment from `docs/` folder
- Automatic data archival with date-stamped files
- Change reports generated in JSON format
- GitHub Actions workflow (`update-data.yml`) scheduled for Mondays 7 AM UTC
- Automated baseline establishment on first run
- Complete Azure region mapping from Microsoft Learn documentation

#### Design Evolution

- Started with static Earth image
- Experimented with dynamic video background
- Settled on stunning high-quality Earth image showing city lights
- Iteratively refined hero section from full-height to ultra-compact
- Removed flag icons for simpler, cleaner regional list
- Replaced regional chart with interactive list for better performance

---

## Project Information

**Repository**: <https://github.com/eliaquimbrandao/azure-service-tags-tracker>  
**Dashboard**: <https://eliaquimbrandao.github.io/azure-service-tags-tracker/>  
**License**: MIT  
**Author**: Eliaquim Brandao

---

## Contributing

This project follows semantic versioning. When contributing:

- **Major version** (X.0.0): Breaking API changes
- **Minor version** (0.X.0): New features, backward compatible
- **Patch version** (0.0.X): Bug fixes, backward compatible

Pull requests are welcome! Please ensure:

1. All tests pass
2. Documentation is updated
3. CHANGELOG is updated with your changes
4. Commit messages are clear and descriptive

## [Latest] - 2025-01-XX - Simplified API Usage

### 🎯 Major Features

#### **Auto-Discovery of Historical Data**

- **User can now query without date parameters** - just provide the service name!
- System automatically discovers all available historical snapshots
- Compares ALL consecutive date pairs to show complete change history

#### **Multi-Source Date Discovery**

The system now uses a smart fallback mechanism:

1. **Primary**: Tries `summary.json` → `available_dates` field (optimal path)
2. **Fallback**: Uses `manifest.json` → extracts dates from files array
3. **Enhancement**: Adds current date to catch latest snapshots

### 📝 API Changes

#### **Before** (Complex)

```powershell
# User had to know dates
Test-AzureServiceChanges -ServiceName 'AzureCloud' -StartDate '2025-10-08' -EndDate '2025-10-10'
```

#### **After** (Simple)

```powershell
# Just provide service name - auto-discovers all dates
Test-AzureServiceChanges -ServiceName 'AzureCloud'
```

### ✅ Validated Results

**Test Case**: `AzureCloud` service

- ✅ Auto-discovered 3 historical snapshots (Oct 8, 10, 14)
- ✅ Found **14 regions with IP changes** between Oct 8-10:
  - `AzureCloud` (overall): **+65 added / -24 removed**
  - `AzureCloud.centralus`: +7/-1
  - `AzureCloud.eastus2`: +7/-5
  - `AzureCloud.westus3`: +6/-7
  - ...and 11 more regions

### 🔧 Technical Implementation

#### Files Modified

1. **`examples/api-usage-examples.md`**
   - Updated PowerShell, JavaScript, and Python examples
   - All 3 languages now have auto-discovery feature
   - Maintained feature parity across all languages

2. **`examples/test-service-changes.ps1`**
   - New standalone PowerShell tool with comprehensive examples
   - Error handling for missing snapshots (graceful 404 handling)
   - Colored output with detailed change breakdown
   - **Example 1 updated**: Now uses `AzureCloud` instead of `Storage`

3. **`docs/data/summary.json`**
   - Added `available_dates` field: `["2025-10-08", "2025-10-10", "2025-10-13"]`
   - Ready for GitHub Pages deployment

4. **`scripts/azure_watcher.py`**
   - Updated `generate_summary_stats()` function
   - Auto-discovers historical snapshots from `docs/data/history/`
   - Automatically populates `available_dates` field on each run

### 🛡️ Error Handling

Added robust error handling for missing snapshots:

```powershell
try {
    $snapshot1 = Invoke-RestMethod -Uri "$baseUrl/data/history/$date1.json" -ErrorAction Stop
    $snapshot2 = Invoke-RestMethod -Uri "$baseUrl/data/history/$date2.json" -ErrorAction Stop
}
catch {
    Write-Host "   ⚠️  Snapshot not found (skipping $date2)" -ForegroundColor Yellow
    continue
}
```

### 📊 How It Works

1. **User calls function**: `Test-AzureServiceChanges -ServiceName 'AzureCloud'`
2. **System discovers dates**:
   - Tries to fetch `summary.json` → check `available_dates` field
   - If not available, fetches `manifest.json` → extracts dates
   - Adds current date to list
3. **Compares consecutive pairs**:
   - Oct 8 → Oct 10
   - Oct 10 → Oct 14 (skips if snapshot doesn't exist yet)
4. **Reports changes**: Shows which regions/services changed with detailed IP count

### 🌐 Multi-Language Support

All three languages now have the simplified API:

- ✅ **PowerShell**: `Test-AzureServiceChanges -ServiceName '<service>'`
- ✅ **JavaScript**: `await testAzureServiceChanges('<service>')`
- ✅ **Python**: `test_azure_service_changes('<service>')`

### 📚 Updated Examples

**Example 1: Check entire AzureCloud** (NEW)

```powershell
Test-AzureServiceChanges -ServiceName 'AzureCloud'
```

**Example 2: Check specific region**

```powershell
Test-AzureServiceChanges -ServiceName 'AzureCloud.eastus'
```

**Example 3: Check specific service**

```powershell
Test-AzureServiceChanges -ServiceName 'AzureKeyVault'
```

### 🚀 Ready for Production

- ✅ All functionality tested and working
- ✅ Error handling for edge cases
- ✅ Multi-language parity maintained
- ✅ Documentation updated
- ✅ Examples reflect real-world usage

### 📝 Next Steps (Deployment)

To deploy these changes to GitHub Pages:

```powershell
git add .
git commit -m "✨ Simplified API - Auto-discover historical dates"
git push origin main
```

The GitHub Action will automatically:

- Deploy updated examples to GitHub Pages
- Next weekly run will populate `available_dates` in `summary.json`
- Future users will benefit from primary path (faster lookups)

---

## Summary

**User Impact**: API usage simplified from multi-parameter complexity to single service name
**Developer Impact**: Automatic date discovery eliminates maintenance burden
**System Impact**: Graceful fallback ensures compatibility with current deployment
