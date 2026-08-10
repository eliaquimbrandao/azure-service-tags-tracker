import { RegionMapper } from './modules/core/RegionMapper.js';
import { DataManager } from './modules/core/DataManager.js';
import { ChartManager } from './modules/visualizations/ChartManager.js';
import { ServiceList } from './modules/visualizations/ServiceList.js';
import { ChangeRenderer } from './modules/ui/ChangeRenderer.js';
import { ModalManager } from './modules/ui/ModalManager.js';
import { RegionalAnalysis } from './modules/visualizations/RegionalAnalysis.js';
import { SearchManager } from './modules/ui/SearchManager.js';
import { TimelineManager } from './modules/ui/TimelineManager.js';
import { ExportManager } from './modules/export/ExportManager.js';

/**
 * Azure Service Tags Dashboard
 * Interactive dashboard for monitoring Azure service tag changes
 */

class AzureServiceTagsDashboard {
    constructor() {
        this.regionMapper = new RegionMapper();
        this.dataManager = new DataManager();
        this.changeRenderer = new ChangeRenderer(this.regionMapper);
        this.modalManager = new ModalManager(this.regionMapper, this.changeRenderer);
        this.regionalAnalysis = new RegionalAnalysis(this.regionMapper, this.modalManager, this.dataManager);
        
        this.chartManager = new ChartManager(
            this.dataManager,
            this.regionMapper,
            {
                onRegionClick: this.regionalAnalysis.showRegionalChangesModal.bind(this.regionalAnalysis)
            }
        );
        this.serviceList = new ServiceList(this.dataManager);
        
        this.searchManager = new SearchManager(this.dataManager, this.regionMapper, this.changeRenderer, this.modalManager);
        this.timelineManager = new TimelineManager(this.dataManager, this.regionMapper, this.changeRenderer, this.modalManager);
        this.exportManager = new ExportManager(this.timelineManager, this.regionMapper);

        this.currentData = null;
        this.summaryData = null;
        this.changesData = null;
        this.isRendered = false;

        this.init();
    }

    async init() {
        try {
            // Ensure all modals are hidden initially
            this.hideAllModals();

            await this.loadRegions();
            await this.loadData();
            await this.renderDashboard();
            this.setupEventListeners();
            this.checkUrlParams();
        } catch (error) {
            this.showError(error);
        }
    }

    async loadRegions() {
        await this.regionMapper.loadRegions();
    }

    hideAllModals() {
        // Hide all modals on page load
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            modal.classList.add('hidden');
        });
    }

    async loadData() {
        const loadingEl = document.getElementById('loadingState');
        loadingEl.classList.remove('hidden');

        try {
            const data = await this.dataManager.loadAllData();
            this.currentData = data.currentData;
            this.summaryData = data.summaryData;
            this.changesData = data.changesData;

            // Pass data to regional analysis
            this.regionalAnalysis.setSummaryData(this.summaryData);
            this.regionalAnalysis.setChangesData(this.changesData);

        } catch (error) {
            console.error('Error loading data:', error);
            throw error;
        } finally {
            loadingEl.classList.add('hidden');
        }
    }





    async renderDashboard() {
        // Prevent multiple renderings
        if (this.isRendered) {
            console.log('Dashboard already rendered, skipping...');
            return;
        }

        const dashboardEl = document.getElementById('dashboard');
        dashboardEl.classList.remove('hidden');

        this.renderStats();
        this.renderLastUpdated();

        // Only render charts if analytics section exists (on analytics.html)
        if (document.querySelector('.analytics-section')) {
            this.renderCharts();
        }

        // Only render timeline if timeline section exists (on history.html)
        if (document.querySelector('.timeline-section')) {
            await this.timelineManager.renderChangeHistoryTimeline();
        }

        // Always render recent changes and search (on all pages)
        this.renderRecentChanges();
        this.searchManager.initializeGlobalSearch();

        this.isRendered = true;
    }

    renderStats() {
        // Update stat cards (only if they exist on this page)
        const totalIPRangesEl = document.getElementById('totalIPRanges');
        if (totalIPRangesEl) {
            totalIPRangesEl.textContent = this.summaryData.total_ip_ranges?.toLocaleString() || '0';
        }

        const changesThisWeekEl = document.getElementById('changesThisWeek');
        if (changesThisWeekEl) {
            changesThisWeekEl.textContent = this.summaryData.changes_this_week?.toLocaleString() || '0';
        }

        // Calculate number of regions with changes
        const regionsWithChanges = this.summaryData.regional_changes ?
            Object.keys(this.summaryData.regional_changes).length : 0;

        const ipChangesEl = document.getElementById('ipChanges');
        if (ipChangesEl) {
            ipChangesEl.textContent = regionsWithChanges.toLocaleString();
        }

        // Update hero stats
        const heroTotalRangesEl = document.getElementById('heroTotalRanges');
        if (heroTotalRangesEl) {
            heroTotalRangesEl.textContent = this.summaryData.total_ip_ranges?.toLocaleString() || '...';
        }

        // Calculate actual region count from regional data
        const regionalData = this.summaryData.regional_changes || {};
        let regionCount = Object.keys(regionalData).length;

        // If no regional data available yet, extract from current service tags
        if (regionCount === 0 && this.currentData && this.currentData.values) {
            const regions = new Set();
            this.currentData.values.forEach(tag => {
                const name = tag.name || '';
                if (name.includes('.')) {
                    const parts = name.split('.');
                    if (parts.length > 1) {
                        const region = parts[parts.length - 1].toLowerCase();
                        // Only count known Azure regions (filter out service components like 'backend', 'core', etc.)
                        if (this.regionMapper && this.regionMapper.regionDisplayMap && this.regionMapper.regionDisplayMap[region]) {
                            regions.add(region);
                        }
                    }
                }
            });
            regionCount = regions.size;
        }

        const heroRegionsEl = document.getElementById('heroRegions');
        if (heroRegionsEl) {
            heroRegionsEl.textContent = regionCount > 0 ? regionCount.toLocaleString() : '...';
        }
    }

    renderLastUpdated() {
        const lastUpdated = this.summaryData.last_updated;
        if (lastUpdated) {
            const date = new Date(lastUpdated);
            const formattedDate = date.toLocaleString();

            // Update both hero and main sections (only if element exists)
            const lastUpdatedEl = document.getElementById('lastUpdated');
            if (lastUpdatedEl) {
                lastUpdatedEl.textContent = formattedDate;
            }
        }
    }

    renderCharts() {
        // Check if we're on the analytics page
        if (document.querySelector('.analytics-section')) {
            this.chartManager.renderUpdateTimeline();
            this.chartManager.renderWeeklyActivityChart();
            this.serviceList.renderActiveServices();
            this.chartManager.renderRegionalChart();
            this.renderAnalyticsInfo();
        } else {
            // Home page charts
            this.serviceList.renderActiveServices();
            this.regionalAnalysis.renderRegionalList();
            this.renderAnalyticsInfo();
        }
    }

    async renderAnalyticsInfo() {
        // Populate analytics info cards if they exist
        const dataPointsEl = document.getElementById('analyticsDataPoints');
        const durationEl = document.getElementById('analyticsDuration');

        if (dataPointsEl || durationEl) {
            try {
                // Load manifest to get actual data coverage
                const manifest = await this.dataManager.getManifest();

                // Exclude baseline (oldest date) from counts
                const totalFiles = manifest.total_files || 0;
                const actualDataWeeks = Math.max(0, totalFiles - 1); // Subtract baseline

                if (dataPointsEl) {
                    const totalServices = this.summaryData?.total_services || 0;
                    dataPointsEl.textContent = `${actualDataWeeks} week${actualDataWeeks !== 1 ? 's' : ''} tracking ${totalServices.toLocaleString()} services`;
                }

                if (durationEl) {
                    const dateRange = manifest.date_range;
                    if (dateRange && actualDataWeeks > 0) {
                        // Get the second oldest date (first actual change, not baseline)
                        const files = manifest.files || [];
                        const sortedFiles = [...files].sort((a, b) => this.dataManager.parseDateOnly(a.date) - this.dataManager.parseDateOnly(b.date));

                        // Skip the oldest (baseline) and use the second oldest as start
                        const firstChangeDate = sortedFiles.length > 1 ? this.dataManager.parseDateOnly(sortedFiles[1].date) : this.dataManager.parseDateOnly(dateRange.oldest);
                        const newestDate = this.dataManager.parseDateOnly(dateRange.newest);

                        const daysDiff = Math.floor((newestDate - firstChangeDate) / (1000 * 60 * 60 * 24));
                        const weeksDiff = Math.max(1, Math.ceil(daysDiff / 7));

                        const formattedFirst = firstChangeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        const formattedNewest = newestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

                        durationEl.textContent = `${formattedFirst} - ${formattedNewest} (${weeksDiff} week${weeksDiff !== 1 ? 's' : ''})`;
                    } else {
                        durationEl.textContent = 'Collecting baseline data...';
                    }
                }
            } catch (error) {
                console.error('Error loading analytics info:', error);
                if (dataPointsEl && this.summaryData) {
                    const totalServices = this.summaryData.total_services || 0;
                    dataPointsEl.textContent = totalServices.toLocaleString();
                }
                if (durationEl) {
                    durationEl.textContent = 'recent weeks';
                }
            }
        }

        // Populate AzureCloud summary if on analytics page
        await this.renderAzureCloudSummary();
    }

    async renderAzureCloudSummary() {
        const summaryEl = document.getElementById('azureCloudSummary');
        if (!summaryEl) return;

        try {
            const manifest = await this.dataManager.getManifest();
            const changeFiles = manifest.files.filter(f => f.date !== manifest.date_range.oldest);
            const changeDatas = await this.dataManager.getChangeFiles(changeFiles);

            let azureCloudTotal = 0;
            let azureCloudGlobal = 0;
            const regionStats = {};

            changeDatas.forEach(changeData => {
                (changeData?.changes || []).forEach(change => {
                    const serviceName = change.service;

                    // Only count AzureCloud tags
                    if (serviceName.startsWith('AzureCloud')) {
                        const addedCount = (change.added_prefixes || change.added || []).length;
                        const removedCount = (change.removed_prefixes || change.removed || []).length;
                        const totalChange = addedCount + removedCount;
                        azureCloudTotal += totalChange;

                        if (serviceName === 'AzureCloud') {
                            azureCloudGlobal += totalChange;
                        } else {
                            // Extract region from service name (e.g., AzureCloud.WestUS2 -> WestUS2)
                            const region = serviceName.replace('AzureCloud.', '');
                            if (!regionStats[region]) {
                                regionStats[region] = 0;
                            }
                            regionStats[region] += totalChange;
                        }
                    }
                });
            });

            const regionCount = Object.keys(regionStats).length;

            // Sort regions by change count and get top 5
            const topRegions = Object.entries(regionStats)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([region, count]) => {
                    const displayName = this.regionMapper.getRegionDisplayName(region) || region;
                    return `<span class="region-stat">${displayName} (${count})</span>`;
                })
                .join(', ');

            summaryEl.innerHTML = `
                Azure's global IP infrastructure had <strong>${azureCloudTotal.toLocaleString()} total IP changes</strong> across all tracked weeks. 
                This includes <strong>${azureCloudGlobal.toLocaleString()} global changes</strong> and updates across <strong>${regionCount} regional zones</strong>.
                ${topRegions ? `<br><br><strong>Most affected regions:</strong> ${topRegions}` : ''}
            `;

        } catch (error) {
            console.error('Error loading AzureCloud summary:', error);
            summaryEl.textContent = 'Unable to load AzureCloud statistics.';
        }
    }



    // New Analytics Charts



    async renderRecentChanges() {
        const changesContainer = document.getElementById('recentChanges');

        if (!changesContainer) {
            // Recent changes container doesn't exist on all pages (e.g., History page)
            return;
        }

        try {
            // Load manifest to get the recent change files
            const timestamp = new Date().getTime();
            const manifestResponse = await fetch(`./data/changes/manifest.json?t=${timestamp}`);

            if (!manifestResponse.ok) {
                throw new Error('Could not load change history');
            }

            const manifest = await manifestResponse.json();
            const files = manifest.files || [];

            // Filter out baseline (oldest date) and sort newest first
            const oldestDate = manifest.date_range?.oldest;
            const changeFiles = files
                .filter(f => f.date !== oldestDate)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            if (changeFiles.length === 0) {
                changesContainer.innerHTML = `
                    <div class="change-item">
                        <div class="change-header">
                            <div class="change-service">✨ No Changes Yet</div>
                        </div>
                        <div class="change-details">
                            Change tracking started. Updates will appear here weekly.
                        </div>
                    </div>
                `;
                return;
            }

            // Walk through files from newest to oldest until we collect up to 3
            const weeksWithChanges = [];

            for (const file of changeFiles) {
                if (weeksWithChanges.length >= 3) break;

                const response = await fetch(`./data/changes/${file.filename}?t=${timestamp}`);
                if (!response.ok) continue;

                const data = await response.json();
                const changes = data.changes || [];

                if (!Array.isArray(changes) || changes.length === 0) {
                    // Keep zero-change weeks only for the full history view, skip them here
                    continue;
                }

                weeksWithChanges.push({
                    date: file.date,
                    filename: file.filename,
                    changes,
                    metadata: data.metadata || {}
                });
            }

            // If none of the recent runs had changes, show a friendly message instead
            if (weeksWithChanges.length === 0) {
                changesContainer.innerHTML = `
                    <div class="timeline-container">
                        <div class="timeline-item">
                            <div class="timeline-header">
                                <div class="timeline-date">
                                    <span class="date-icon">✨</span>
                                    No Recent Changes
                                </div>
                            </div>
                            <div class="timeline-body">
                                <p style="text-align: center; color: #6b7280; padding: 1rem;">
                                    The most recent collection runs did not include any Azure service tag changes.
                                    You can still browse all historical updates on the full <a href="history.html">Change History</a> page.
                                </p>
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            // Render each week's changes with timeline wrapper
            const changesHtml = `
                <div class="timeline-container">
                    ${weeksWithChanges
                    .map(weekData => this.renderWeekChanges(weekData))
                    .join('')}
                </div>
            `;

            changesContainer.innerHTML = changesHtml;

        } catch (error) {
            console.error('Error loading recent changes:', error);
            changesContainer.innerHTML = `
                <div class="change-item">
                    <div class="change-header">
                        <div class="change-service">⚠️ Unable to load changes</div>
                    </div>
                    <div class="change-details">
                        ${error.message}
                    </div>
                </div>
            `;
        }
    }

    renderWeekChanges(weekData) {
        const { date, filename, changes, metadata = {} } = weekData;

        // Format the date
        const changeDate = this.dataManager.parseDateOnly(date) || new Date(date);
        const formattedDate = changeDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Format published date if available
        let publishedDateHtml = '';
        if (metadata.date_published) {
            const pubDate = new Date(metadata.date_published);
            const formattedPubDate = pubDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            publishedDateHtml = `<div class="timeline-published-date">📤 Published by Microsoft: ${formattedPubDate}</div>`;
        }

        // Calculate statistics
        const serviceCount = new Set(changes.map(c => c.service)).size;
        const regionCount = new Set(changes.map(c => c.region || 'global')).size;
        const addedIPs = changes.reduce((sum, c) => sum + (c.added_count || 0), 0);
        const removedIPs = changes.reduce((sum, c) => sum + (c.removed_count || 0), 0);

        if (changes.length === 0) {
            return `
                <div class="timeline-item">
                    <div class="timeline-header">
                        <div class="timeline-date">
                            <span class="date-icon">📅</span>
                            ${formattedDate}
                        </div>
                        <span class="timeline-badge no-changes">No Changes</span>
                    </div>
                    <div class="timeline-body">
                        <p style="text-align: center; color: #6b7280; padding: 1rem;">
                            All Azure service tags remained unchanged this week.
                        </p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="timeline-item" onclick="dashboard.showTimelineDetails('${filename}', '${date}')">
                <div class="timeline-header">
                    <div class="timeline-date">
                        <span class="date-icon">📅</span>
                        <div>
                            ${formattedDate}
                            ${publishedDateHtml}
                        </div>
                    </div>
                    <span class="timeline-badge">${changes.length} Changes</span>
                </div>
                
                <div class="timeline-stats">
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number">${serviceCount}</span>
                        <span class="timeline-stat-label">Services</span>
                    </div>
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number">${regionCount}</span>
                        <span class="timeline-stat-label">Regions</span>
                    </div>
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number" style="color: var(--success-color);">${addedIPs}</span>
                        <span class="timeline-stat-label">Added IPs</span>
                    </div>
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number" style="color: var(--danger-color);">${removedIPs}</span>
                        <span class="timeline-stat-label">Removed IPs</span>
                    </div>
                </div>

                <div class="timeline-action-hint">
                    👆 Click to view detailed changes
                </div>
            </div>
        `;
    }



    setupEventListeners() {
        // Event delegation for copy IP buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('copy-ips-btn') || e.target.closest('.copy-ips-btn')) {
                const btn = e.target.classList.contains('copy-ips-btn') ? e.target : e.target.closest('.copy-ips-btn');
                const ipsJson = btn.dataset.ips;
                const label = btn.dataset.label;

                if (ipsJson && label) {
                    try {
                        const ipsArray = JSON.parse(ipsJson);
                        this.changeRenderer.copyIPsToClipboard(ipsArray, label);
                    } catch (error) {
                        console.error('Failed to parse IPs:', error);
                        this.changeRenderer.showCopyFeedback('error', 'Failed to copy IPs');
                    }
                }
            }
        });

        // Load more history
        const loadMoreBtn = document.getElementById('loadMoreTimeline');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.timelineManager.loadMoreTimeline();
            });
        }
    }

    showError(error) {
        console.error('Dashboard error:', error);
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('errorState').classList.remove('hidden');
    }

    // Interactive stat card methods
    showAllChanges() {
        const changes = this.changesData.changes || [];

        if (changes.length === 0) {
            // Get the last updated date
            const lastUpdated = this.summaryData.last_updated
                ? new Date(this.summaryData.last_updated).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
                : 'the last update';

            // Show modal with link to timeline
            const modal = document.createElement('div');
            modal.className = 'changes-modal-overlay';
            modal.innerHTML = `
                <div class="changes-modal">
                    <div class="changes-modal-header">
                        <h3>📊 No Changes This Week</h3>
                        <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                    </div>
                    <div class="changes-modal-body" style="text-align: center; padding: 2rem;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">✨</div>
                        <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">No service tag changes detected this week</p>
                        <p style="color: var(--text-secondary); margin-bottom: 2rem;">All Azure service tags remain unchanged since ${lastUpdated}.</p>
                        
                        <div style="padding: 1.5rem; background: var(--card-background); border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-weight: 600; margin-bottom: 0.5rem;">💡 Want to see previous updates?</div>
                            <div style="font-size: 0.9rem; margin-bottom: 1rem; color: var(--text-secondary);">
                                Browse historical changes in the Change History Timeline
                            </div>
                            <a href="history.html" class="timeline-link-btn" style="display: inline-block; text-decoration: none;">
                                📅 View Change History Timeline
                            </a>
                        </div>
                    </div>
                </div>
            `;
            modal.onclick = (e) => {
                if (e.target === modal) modal.remove();
            };

            // Close modal when pressing ESC key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);

            // Clean up event listener when modal is removed
            const originalRemove = modal.remove.bind(modal);
            modal.remove = function () {
                document.removeEventListener('keydown', escapeHandler);
                originalRemove();
            };

            document.body.appendChild(modal);
            return;
        }

        this.modalManager.showChangesModal('All Changes This Week', changes, 'all');
    }

    showRegionChanges() {
        const changes = this.changesData.changes || [];
        const ipChanges = changes.filter(change => change.type === 'ip_changes');

        if (ipChanges.length === 0) {
            // Get the last updated date
            const lastUpdated = this.summaryData.last_updated
                ? new Date(this.summaryData.last_updated).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
                : 'the last update';

            // Show modal with link to timeline
            const modal = document.createElement('div');
            modal.className = 'changes-modal-overlay';
            modal.innerHTML = `
                <div class="changes-modal">
                    <div class="changes-modal-header">
                        <h3>🌍 No Region Changes This Week</h3>
                        <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                    </div>
                    <div class="changes-modal-body" style="text-align: center; padding: 2rem;">
                        <div style="font-size: 3rem; margin-bottom: 1rem;">✨</div>
                        <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">No regional IP changes detected this week</p>
                        <p style="color: var(--text-secondary); margin-bottom: 2rem;">All Azure regional service tags remain unchanged since ${lastUpdated}.</p>
                        
                        <div style="padding: 1.5rem; background: var(--card-background); border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-weight: 600; margin-bottom: 0.5rem;">💡 Want to see previous updates?</div>
                            <div style="font-size: 0.9rem; margin-bottom: 1rem; color: var(--text-secondary);">
                                Browse historical changes by region in the Change History Timeline
                            </div>
                            <a href="history.html" class="timeline-link-btn" style="display: inline-block; text-decoration: none;">
                                📅 View Change History Timeline
                            </a>
                        </div>
                    </div>
                </div>
            `;
            modal.onclick = (e) => {
                if (e.target === modal) modal.remove();
            };

            // Close modal when pressing ESC key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);

            // Clean up event listener when modal is removed
            const originalRemove = modal.remove.bind(modal);
            modal.remove = function () {
                document.removeEventListener('keydown', escapeHandler);
                originalRemove();
            };

            document.body.appendChild(modal);
            return;
        }

        // Show the two-level modal: regions -> services with IP details
        this.modalManager.showRegionChangesModal('Region Changes This Week', ipChanges);
    }

    showServiceDetails(serviceName) {
        const changes = this.changesData.changes || [];
        const serviceChanges = changes.filter(change => change.service === serviceName);

        if (serviceChanges.length === 0) {
            alert(`No detailed changes available for ${serviceName}`);
            return;
        }

        this.modalManager.showChangesModal(`${serviceName} - Changes This Week`, serviceChanges, 'service');
    }



    async showIPRangesHistory() {
        const modal = document.createElement('div');
        modal.className = 'changes-modal-overlay';

        try {
            // Get current IP ranges count
            const currentCount = this.summaryData.total_ip_ranges || 0;
            const lastUpdated = this.summaryData.last_updated || 'Unknown';

            // Calculate this week's changes
            let thisWeekAddedIPs = 0;
            let thisWeekRemovedIPs = 0;

            if (this.changesData && this.changesData.changes) {
                this.changesData.changes.forEach(change => {
                    if (change.type === 'ip_changes' || change.change_type === 'ip_changes') {
                        thisWeekAddedIPs += change.added_count || 0;
                        thisWeekRemovedIPs += change.removed_count || 0;
                    }
                });
            }

            const thisWeekNetChange = thisWeekAddedIPs - thisWeekRemovedIPs;
            const hasChangesThisWeek = thisWeekNetChange !== 0;

            // Load manifest to find historical changes
            let historicalData = null;
            let previousCount = currentCount - thisWeekNetChange;

            if (!hasChangesThisWeek) {
                // Load manifest to find the last week with actual changes
                try {
                    const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');
                    const manifest = await manifestResponse.json();

                    // Sort files by date (newest first)
                    const sortedFiles = manifest.files
                        .sort((a, b) => new Date(b.date) - new Date(a.date));

                    // Look through previous weeks to find the last one with changes
                    for (const file of sortedFiles) {
                        const fileResponse = await this.dataManager.fetchWithCacheBust(`data/changes/${file.filename}`);
                        const fileData = await fileResponse.json();

                        // Calculate IP changes for this week
                        let weekAddedIPs = 0;
                        let weekRemovedIPs = 0;

                        if (fileData.changes) {
                            fileData.changes.forEach(change => {
                                if (change.type === 'ip_changes' || change.change_type === 'ip_changes') {
                                    weekAddedIPs += change.added_count || 0;
                                    weekRemovedIPs += change.removed_count || 0;
                                }
                            });
                        }

                        const weekNetChange = weekAddedIPs - weekRemovedIPs;

                        // If this week had changes, use it as our historical reference
                        if (weekNetChange !== 0) {
                            historicalData = {
                                date: file.date,
                                addedIPs: weekAddedIPs,
                                removedIPs: weekRemovedIPs,
                                netChange: weekNetChange,
                                totalChanges: file.total_changes
                            };

                            // Calculate what the IP count was before this historical change
                            previousCount = currentCount - weekNetChange;
                            break;
                        }
                    }
                } catch (error) {
                    console.error('Error loading historical data:', error);
                }
            }

            // Create the display message
            let statusMessage = '';
            let changeIcon = '📊';
            let changeColor = '#6b7280';
            let displayAddedIPs = thisWeekAddedIPs;
            let displayRemovedIPs = thisWeekRemovedIPs;
            let displayNetChange = thisWeekNetChange;
            let displayTotalChanges = thisWeekAddedIPs + thisWeekRemovedIPs; // Total activity
            let changeDate = new Date(lastUpdated).toLocaleDateString();

            if (hasChangesThisWeek) {
                changeIcon = thisWeekNetChange > 0 ? '📈' : '📉';
                changeColor = thisWeekNetChange > 0 ? '#059669' : '#dc2626';
                statusMessage = `This week: ${displayTotalChanges.toLocaleString()} total changes (${thisWeekNetChange > 0 ? '+' : ''}${thisWeekNetChange.toLocaleString()} net)`;
            } else if (historicalData) {
                // Show the last week that had changes
                displayAddedIPs = historicalData.addedIPs;
                displayRemovedIPs = historicalData.removedIPs;
                displayNetChange = historicalData.netChange;
                displayTotalChanges = historicalData.addedIPs + historicalData.removedIPs;
                changeIcon = historicalData.netChange > 0 ? '📈' : '📉';
                changeColor = historicalData.netChange > 0 ? '#059669' : '#dc2626';
                changeDate = new Date(historicalData.date).toLocaleDateString();
                statusMessage = `Last change: ${displayTotalChanges.toLocaleString()} total changes on ${changeDate}`;
            } else {
                statusMessage = 'No changes detected in recent weeks';
            }

            // Create historical data display
            const historyHtml = `
                <div class="ip-history-content">
                    <div class="progression-display">
                        <div class="progression-card">
                            <h4>📊 IP Ranges Progression</h4>
                            <div class="progression-flow">
                                <div class="count-box previous">
                                    <div class="count-label">Previous Total</div>
                                    <div class="count-number">${previousCount.toLocaleString()}</div>
                                    <div class="count-date">${hasChangesThisWeek ? 'Before this week\'s update' : (historicalData ? `Before ${changeDate}` : 'Baseline')}</div>
                                </div>
                                
                                <div class="progression-arrow">
                                    <div class="arrow-symbol">→</div>
                                    <div class="change-details">
                                        <span class="change-badge" style="background-color: ${changeColor};">
                                            ${changeIcon} ${displayNetChange >= 0 ? '+' : ''}${displayNetChange.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                                
                                <div class="count-box current">
                                    <div class="count-label">Current Total</div>
                                    <div class="count-number">${currentCount.toLocaleString()}</div>
                                    <div class="count-date">${new Date(lastUpdated).toLocaleDateString()}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="change-breakdown">
                        <h4>📊 ${hasChangesThisWeek ? 'This Week\'s Changes' : (historicalData ? `Last Changes (${changeDate})` : 'Recent Changes')}</h4>
                        ${(hasChangesThisWeek || historicalData) ? `
                            <div class="breakdown-stats">
                                <div class="breakdown-item added">
                                    <span class="breakdown-number">+${displayAddedIPs.toLocaleString()}</span>
                                    <span class="breakdown-label">IP ranges added</span>
                                </div>
                                <div class="breakdown-item removed">
                                    <span class="breakdown-number">-${displayRemovedIPs.toLocaleString()}</span>
                                    <span class="breakdown-label">IP ranges removed</span>
                                </div>
                                <div class="breakdown-item total">
                                    <span class="breakdown-number" style="color: var(--primary-color);">
                                        ${displayTotalChanges.toLocaleString()}
                                    </span>
                                    <span class="breakdown-label">Total changes (add + remove)</span>
                                </div>
                                <div class="breakdown-item net">
                                    <span class="breakdown-number" style="color: ${changeColor};">
                                        ${displayNetChange >= 0 ? '+' : ''}${displayNetChange.toLocaleString()}
                                    </span>
                                    <span class="breakdown-label">Net change (growth)</span>
                                </div>
                            </div>
                            ${!hasChangesThisWeek && historicalData ? `
                                <div class="info-note" style="background: #fffbeb; border-left-color: #f59e0b;">
                                    <p><strong>ℹ️ Note:</strong> No changes were detected this week. Showing the most recent update from <strong>${changeDate}</strong>.</p>
                                </div>
                            ` : ''}
                        ` : `
                            <div class="no-changes-message">
                                <p style="text-align: center; color: #6b7280; padding: 2rem;">
                                    ✨ All IP ranges have remained stable in recent weeks
                                </p>
                            </div>
                        `}
                    </div>

                    <div class="info-note">
                        <p><strong>ℹ️ About IP Ranges:</strong></p>
                        <p>This tracks the total count of ALL IP address ranges across ALL Azure services and regions combined. 
                        Each service (like Storage, SQL, etc.) in each region has its own set of IP ranges that Azure uses for that service.</p>
                        <p>Microsoft updates this data regularly when they add new datacenters, expand services, or decommission old infrastructure.</p>
                    </div>
                </div>
            `;

            modal.innerHTML = `
                <div class="changes-modal ip-history-modal">
                    <div class="changes-modal-header">
                        <h3>📊 IP Ranges History</h3>
                        <div class="changes-modal-stats">
                            <span class="stat-item">${statusMessage}</span>
                        </div>
                        <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                    </div>
                    <div class="changes-modal-body">
                        ${historyHtml}
                    </div>
                </div>
            `;

            // Close modal when clicking overlay
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            };

            // Close modal when pressing ESC key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);

            // Clean up event listener when modal is removed
            const originalRemove = modal.remove.bind(modal);
            modal.remove = function () {
                document.removeEventListener('keydown', escapeHandler);
                originalRemove();
            };

            document.body.appendChild(modal);

        } catch (error) {
            console.error('Error showing IP ranges history:', error);
            modal.innerHTML = `
                <div class="changes-modal">
                    <div class="changes-modal-header">
                        <h3>📊 IP Ranges History</h3>
                        <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                    </div>
                    <div class="changes-modal-body">
                        <p style="color: var(--danger-color); text-align: center; padding: 2rem;">
                            ⚠️ Unable to load IP ranges history
                        </p>
                    </div>
                </div>
            `;

            // Close modal when clicking overlay (error case)
            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            };

            // Close modal when pressing ESC key (error case)
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);

            // Clean up event listener when modal is removed (error case)
            const originalRemove = modal.remove.bind(modal);
            modal.remove = function () {
                document.removeEventListener('keydown', escapeHandler);
                originalRemove();
            };

            document.body.appendChild(modal);
        }
    }











    // Global Search Functionality - Delegated to SearchManager
    // Methods removed as they are now in SearchManager.js


    // Historical Search Helpers - Delegated to SearchManager
    // Methods removed as they are now in SearchManager.js


    // Historical Details Helpers - Delegated to SearchManager
    // Methods removed as they are now in SearchManager.js


    // Search UI Helpers - Delegated to SearchManager
    // Methods removed as they are now in SearchManager.js


    // ========== HISTORY PAGE FEATURES ==========

    // Store all timeline data for filtering
    allTimelineData = [];
    filteredTimelineData = [];
    selectedWeeksForExport = [];  // For week selector export (unlimited)

    // History Filters - Delegated to TimelineManager
    // Methods removed as they are now in TimelineManager.js


    // Timeline Rendering - Delegated to TimelineManager
    // Methods removed as they are now in TimelineManager.js


    // Timeline Details & Compare - Delegated to TimelineManager
    // Methods removed as they are now in TimelineManager.js

    // Export UI Helpers - Delegated to ExportManager
    // Methods removed as they are now in ExportManager.js

    // Delegation methods for UI event handlers
    searchExample(query) {
        if (this.searchManager) {
            this.searchManager.searchExample(query);
        }
    }

    filterHistory() {
        if (this.timelineManager) {
            this.timelineManager.filterHistory();
        }
        if (this.exportManager) {
            this.exportManager.updateWeekSelectorState();
        }
    }

    toggleExportDropdown(event) {
        if (this.exportManager) {
            this.exportManager.toggleExportDropdown(event);
        }
    }

    exportFilteredJSON() {
        if (this.exportManager) {
            this.exportManager.exportFilteredJSON();
        }
    }

    exportAsCSV() {
        if (this.exportManager) {
            this.exportManager.exportAsCSV();
        }
    }

    toggleWeekSelector(event) {
        if (this.exportManager) {
            this.exportManager.toggleWeekSelector(event);
        }
    }

    selectAllWeeks() {
        if (this.exportManager) {
            this.exportManager.selectAllWeeks();
        }
    }

    clearAllWeeks() {
        if (this.exportManager) {
            this.exportManager.clearAllWeeks();
        }
    }

    closeWeekSelector() {
        if (this.exportManager) {
            this.exportManager.closeWeekSelector();
        }
    }

    exportSelectedWeeksJSON() {
        if (this.exportManager) {
            this.exportManager.exportSelectedWeeksJSON();
        }
    }

    exportSelectedWeeksCSV() {
        if (this.exportManager) {
            this.exportManager.exportSelectedWeeksCSV();
        }
    }

    weeklyActivityPrevMonth() {
        if (this.chartManager) {
            this.chartManager.weeklyActivityPrevMonth();
        }
    }

    weeklyActivityNextMonth() {
        if (this.chartManager) {
            this.chartManager.weeklyActivityNextMonth();
        }
    }

    timelinePrevMonth() {
        if (this.chartManager) {
            this.chartManager.timelinePrevMonth();
        }
    }

    timelineNextMonth() {
        if (this.chartManager) {
            this.chartManager.timelineNextMonth();
        }
    }

    showTimelineDetails(filename, date) {
        if (this.timelineManager) {
            this.timelineManager.showTimelineDetails(filename, date);
        }
    }

    showServiceHistory(serviceName) {
        // If we are on the history page, filter directly
        if (window.location.pathname.includes('history.html')) {
            const searchInput = document.getElementById('historySearch');
            if (searchInput) {
                searchInput.value = serviceName;
                this.filterHistory();
                this.scrollToTimeline();
            }
        } else {
            // Otherwise redirect to history page with search param
            window.location.href = `history.html?search=${encodeURIComponent(serviceName)}`;
        }
    }

    checkUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const searchParam = urlParams.get('search');
        
        if (searchParam && window.location.pathname.includes('history.html')) {
            const searchInput = document.getElementById('historySearch');
            if (searchInput) {
                searchInput.value = searchParam;
                this.filterHistory();
                this.scrollToTimeline();
            }
        }
    }

    scrollToTimeline() {
        const timeline = document.getElementById('changeHistoryTimeline');
        if (timeline) {
            timeline.scrollIntoView({ behavior: 'smooth' });
        }
    }

    resetFilters() {
        if (this.timelineManager) {
            this.timelineManager.resetFilters();
        }
        if (this.exportManager) {
            this.exportManager.clearAllWeeks();
            this.exportManager.updateWeekSelectorState();
        }
    }
}

// Initialize dashboard when DOM is loaded
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new AzureServiceTagsDashboard();
    // Make dashboard globally accessible for onclick handlers
    window.dashboard = dashboard;
});

// Debug function for troubleshooting
window.debugDashboard = function () {
    console.log('=== Dashboard Debug Info ===');
    console.log('Dashboard object:', dashboard);
    console.log('Summary data:', dashboard?.summaryData);
    console.log('Changes data:', dashboard?.changesData);
    console.log('Current data length:', dashboard?.currentData?.values?.length);
    alert('Debug info logged to console. Press F12 to view.');
};
