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
        this.regionDisplayMap = {}; // Will be loaded from regions.json
        this.filteredServices = [];
        this.activeServicesChart = null;
        this.regionalChart = null;
        this.updateTimelineChart = null;
        this.serviceTrendsChart = null;
        this.weeklyActivityChart = null;
        this.currentModal = null;
        this.isRendered = false;
        this.servicesPage = 1;
        this.servicesContainer = null;
        this.recentChangesPage = 1;
        this.cacheBust = Date.now();
        this.includeNewServiceIPs = true;
        this.servicePrefixLookup = {};
        this.timelinePageSize = 5;
        this.timelineVisibleCount = this.timelinePageSize;

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
        this.regionDisplayMap = this.regionMapper.getAllRegions();
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
            this.servicePrefixLookup = this.dataManager.servicePrefixLookup;

            // Pass data to regional analysis
            this.regionalAnalysis.setSummaryData(this.summaryData);
            this.regionalAnalysis.setChangesData(this.changesData);

            // Ensure region map is up to date if needed, though loadRegions called it.
            this.regionDisplayMap = this.regionMapper.getAllRegions();

        } catch (error) {
            console.error('Error loading data:', error);
            throw error;
        } finally {
            loadingEl.classList.add('hidden');
        }
    }

    /**
     * Parse a YYYY-MM-DD string without shifting days across time zones.
     * Anchors at noon UTC so local offsets do not roll the calendar backward/forward.
     */
    parseDateOnly(dateString) {
        if (!dateString) return null;

        const parts = dateString.split('-').map(Number);
        if (parts.length === 3 && parts.every(n => !Number.isNaN(n))) {
            const [year, month, day] = parts;
            return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        }

        const parsed = Date.parse(dateString);
        return Number.isNaN(parsed) ? null : new Date(parsed);
    }





    fetchWithCacheBust(url) {
        return this.dataManager.fetchWithCacheBust(url);
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
            this.chartManager.renderServiceTrendsChart();
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
                const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
                const manifest = await manifestResponse.json();

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
                        const sortedFiles = files.sort((a, b) => this.parseDateOnly(a.date) - this.parseDateOnly(b.date));

                        // Skip the oldest (baseline) and use the second oldest as start
                        const firstChangeDate = sortedFiles.length > 1 ? this.parseDateOnly(sortedFiles[1].date) : this.parseDateOnly(dateRange.oldest);
                        const newestDate = this.parseDateOnly(dateRange.newest);

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
            const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();
            const changeFiles = manifest.files.filter(f => f.date !== manifest.date_range.oldest);

            let azureCloudTotal = 0;
            let azureCloudGlobal = 0;
            const regionStats = {};

            for (const fileInfo of changeFiles) {
                try {
                    const changeResponse = await fetch(`data/changes/${fileInfo.filename}`);
                    const changeData = await changeResponse.json();

                    (changeData.changes || []).forEach(change => {
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
                } catch (err) {
                    console.log(`Could not load ${fileInfo.filename}`);
                }
            }

            const regionCount = Object.keys(regionStats).length;

            // Sort regions by change count and get top 5
            const topRegions = Object.entries(regionStats)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([region, count]) => {
                    const displayName = this.regionDisplayNames[region] || region;
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





    async showHistoricalInsights(container) {
        // Show insights from historical data when no changes this week
        try {
            const historicalActivity = await this.loadHistoricalActivity();
            const services = Object.entries(historicalActivity)
                .map(([service, stats]) => ({
                    service,
                    changeCount: stats.changeCount,
                    totalIPsAdded: stats.totalIPsAdded,
                    totalIPsRemoved: stats.totalIPsRemoved,
                    totalIPChange: stats.totalIPChange
                }))
                .sort((a, b) => b.totalIPChange - a.totalIPChange)  // Sort by total IP changes (magnitude)
                .slice(0, 5);  // Show only top 5

            if (services.length === 0) {
                container.innerHTML = `
                    <div class="no-changes-analytics">
                        <div class="no-changes-icon">✨</div>
                        <h3>No Changes This Week</h3>
                        <p>All Azure Service Tags remain stable.</p>
                        <div class="analytics-card">
                            <p><strong>📊 Baseline established</strong></p>
                            <p>Historical trends will appear here as data accumulates over time.</p>
                        </div>
                    </div>
                `;
                return;
            }

            // Show historical trends - Top 5 most active services by IP change magnitude
            const topServicesHtml = services.map((item, index) => `
                <div class="historical-insight-item" 
                     onclick="dashboard.showServiceHistory('${item.service.replace(/'/g, "\\'")}')"
                     title="Click to view ${item.service} history">
                    <div class="rank-number">${index + 1}</div>
                    <div class="service-details">
                        <div class="service-name">${item.service}</div>
                        <div class="service-meta">
                            <span class="frequency-badge">🔥 ${item.changeCount} change${item.changeCount !== 1 ? 's' : ''} recorded</span>
                            <span class="ip-details" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem; display: block;">
                                ${item.totalIPChange.toLocaleString()} total IPs affected (+${item.totalIPsAdded.toLocaleString()} • -${item.totalIPsRemoved.toLocaleString()})
                            </span>
                        </div>
                    </div>
                </div>
            `).join('');

            container.innerHTML = `
                <div class="no-changes-analytics">
                    <div class="no-changes-icon">✨</div>
                    <h3>No Changes This Week</h3>
                    <p>All Azure Service Tags remain stable.</p>
                    
                    <div class="analytics-card">
                        <h4>📈 Top 5 Most Active Services</h4>
                        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">
                            Services with the most significant activity (combining frequency and IP range changes)
                        </p>
                        <div class="historical-insights-list">
                            ${topServicesHtml}
                        </div>
                    </div>

                    <div class="analytics-tip">
                        💡 <strong>Tip:</strong> Check the Change History Timeline below to explore past updates
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error showing historical insights:', error);
            container.innerHTML = `
                <div class="no-changes-analytics">
                    <div class="no-changes-icon">✨</div>
                    <h3>No Changes This Week</h3>
                    <p>All Azure Service Tags remain stable.</p>
                    <div class="analytics-card">
                        <p><strong>📊 Monitoring continues</strong></p>
                        <p>Check back next week for new updates or explore the Change History Timeline below.</p>
                    </div>
                </div>
            `;
        }
    }

    async showTopHistoricalServices(container) {
        // Show top historically active services without "No Changes" messaging
        try {
            const historicalActivity = await this.loadHistoricalActivity();
            const services = Object.entries(historicalActivity)
                .map(([service, stats]) => ({
                    service,
                    changeCount: stats.changeCount,
                    totalIPsAdded: stats.totalIPsAdded,
                    totalIPsRemoved: stats.totalIPsRemoved,
                    totalIPChange: stats.totalIPChange
                }))
                .sort((a, b) => b.totalIPChange - a.totalIPChange)  // Sort by total IP changes (magnitude)
                .slice(0, 5);  // Show top 5

            if (services.length === 0) {
                container.innerHTML = `
                    <div class="analytics-card">
                        <p style="text-align: center; color: var(--text-secondary);">
                            📊 No historical data available yet. Check back after the next update.
                        </p>
                    </div>
                `;
                return;
            }

            // Show ranked list of top services
            const topServicesHtml = services.map((item, index) => `
                <div class="service-rank-item" 
                     onclick="dashboard.showServiceHistory('${item.service.replace(/'/g, "\\'")}')"
                     title="Click to view ${item.service} history">
                    <div class="rank-number">${index + 1}</div>
                    <div class="service-details">
                        <div class="service-name">${item.service}</div>
                        <div class="service-meta">
                            <span class="frequency-badge">🔥 ${item.changeCount} change${item.changeCount !== 1 ? 's' : ''}</span>
                            <span class="ip-stats">
                                ${item.totalIPChange.toLocaleString()} IPs affected 
                                <span class="ip-added">+${item.totalIPsAdded.toLocaleString()}</span> • 
                                <span class="ip-removed">-${item.totalIPsRemoved.toLocaleString()}</span>
                            </span>
                        </div>
                    </div>
                </div>
            `).join('');

            container.innerHTML = `
                <div class="services-rank-list">
                    ${topServicesHtml}
                </div>
            `;
        } catch (error) {
            console.error('Error showing top historical services:', error);
            container.innerHTML = `
                <div class="analytics-card">
                    <p style="text-align: center; color: var(--text-secondary);">
                        Unable to load historical data. Please try refreshing the page.
                    </p>
                </div>
            `;
        }
    }



    changeRecentChangesPage(page) {
        this.recentChangesPage = page;
        this.renderRecentChanges();
        // Scroll to recent changes section
        document.getElementById('recentChanges').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }





    // New Analytics Charts

    async renderUpdateTimelineChart() {
        const canvas = document.getElementById('updateTimelineChart');
        if (!canvas) return;

        try {
            // Load all historical data files to get changeNumber timeline
            const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            const timelineData = [];

            // Load historical files with Microsoft metadata
            for (const fileInfo of manifest.files) {
                try {
                    const historyResponse = await this.fetchWithCacheBust(`data/history/${fileInfo.date}.json`);
                    const changesResponse = await this.fetchWithCacheBust(`data/changes/${fileInfo.date}-changes.json`);

                    if (historyResponse.ok) {
                        const historyData = await historyResponse.json();
                        if (historyData.changeNumber) {
                            const item = {
                                date: fileInfo.date,
                                changeNumber: parseInt(historyData.changeNumber),
                                collectionDate: this.parseDateOnly(fileInfo.date)
                            };

                            // Try to get Microsoft's publish date from changes file
                            if (changesResponse.ok) {
                                try {
                                    const changesData = await changesResponse.json();
                                    if (changesData.metadata && changesData.metadata.date_published) {
                                        const dateStr = changesData.metadata.date_published;
                                        let parsedDate = null;

                                        // Try MM/DD/YYYY (US format, common in Microsoft docs)
                                        const partsSlash = dateStr.split('/');
                                        if (partsSlash.length === 3) {
                                            const month = parseInt(partsSlash[0], 10) - 1; // 0-indexed
                                            const day = parseInt(partsSlash[1], 10);
                                            const year = parseInt(partsSlash[2], 10);
                                            if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
                                                parsedDate = new Date(Date.UTC(year, month, day));
                                            }
                                        }

                                        // Try YYYY-MM-DD (ISO format)
                                        if (!parsedDate) {
                                            const partsDash = dateStr.split('-');
                                            if (partsDash.length === 3) {
                                                const year = parseInt(partsDash[0], 10);
                                                const month = parseInt(partsDash[1], 10) - 1;
                                                const day = parseInt(partsDash[2], 10);
                                                if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
                                                    parsedDate = new Date(Date.UTC(year, month, day));
                                                }
                                            }
                                        }

                                        // Try standard Date parsing as fallback
                                        if (!parsedDate) {
                                            const timestamp = Date.parse(dateStr);
                                            if (!isNaN(timestamp)) {
                                                parsedDate = new Date(timestamp);
                                            }
                                        }

                                        if (parsedDate) {
                                            item.microsoftPublished = parsedDate;
                                        }
                                    }
                                } catch (err) {
                                    console.log(`Could not parse changes file for ${fileInfo.date}`);
                                }
                            }

                            timelineData.push(item);
                        }
                    }
                } catch (err) {
                    console.log(`Could not load history file for ${fileInfo.date}`);
                }
            }

            // Sort by collection date
            timelineData.sort((a, b) => a.collectionDate - b.collectionDate);

            if (timelineData.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">No update timeline data available yet</p>';
                return;
            }

            // Filter to only show data points when changeNumber actually changed
            const filteredData = [];
            let lastChangeNumber = null;

            for (const item of timelineData) {
                if (lastChangeNumber === null || item.changeNumber !== lastChangeNumber) {
                    filteredData.push(item);
                    lastChangeNumber = item.changeNumber;
                }
            }

            if (filteredData.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">No Microsoft updates detected yet</p>';
                return;
            }

            // Prepare data - collect all unique dates for x-axis
            const allDates = new Set();
            const eventsByDate = {};

            filteredData.forEach((item, index) => {
                const changeNum = item.changeNumber;

                // First item is the baseline - ONLY show baseline marker, no Microsoft published
                if (index === 0) {
                    const dateKey = item.collectionDate.toISOString().split('T')[0];
                    allDates.add(dateKey);
                    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
                    eventsByDate[dateKey].push({
                        type: 'baseline',
                        changeNumber: changeNum,
                        date: item.collectionDate
                    });
                    return; // Skip everything else for baseline
                }

                // For subsequent updates (index > 0), show Microsoft published event ONLY if it's AFTER baseline
                if (item.microsoftPublished) {
                    const baselineDate = filteredData[0].collectionDate;

                    // Only show Microsoft published if it's after the baseline date
                    if (item.microsoftPublished > baselineDate) {
                        const dateKey = item.microsoftPublished.toISOString().split('T')[0];
                        allDates.add(dateKey);
                        if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
                        eventsByDate[dateKey].push({
                            type: 'microsoft',
                            changeNumber: changeNum,
                            date: item.microsoftPublished
                        });
                    }
                }

                // Our collection event (for all non-baseline items)
                const collDateKey = item.collectionDate.toISOString().split('T')[0];
                allDates.add(collDateKey);
                if (!eventsByDate[collDateKey]) eventsByDate[collDateKey] = [];
                eventsByDate[collDateKey].push({
                    type: 'collection',
                    changeNumber: changeNum,
                    date: item.collectionDate
                });
            });

            // Sort dates and create labels
            const sortedDates = Array.from(allDates).sort();
            const labels = sortedDates.map(dateStr => {
                const date = this.parseDateOnly(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });

            // Build dataset arrays for each event type
            const baselineData = sortedDates.map(dateKey => {
                const events = eventsByDate[dateKey] || [];
                const baselineEvent = events.find(e => e.type === 'baseline');
                return baselineEvent ? 0 : null;
            });

            const microsoftData = sortedDates.map(dateKey => {
                const events = eventsByDate[dateKey] || [];
                const msEvent = events.find(e => e.type === 'microsoft');
                return msEvent ? 1 : null;
            });

            const collectionData = sortedDates.map(dateKey => {
                const events = eventsByDate[dateKey] || [];
                const collEvent = events.find(e => e.type === 'collection');
                return collEvent ? 2 : null;
            });

            // Store metadata for tooltips
            const metadata = sortedDates.map(dateKey => {
                const events = eventsByDate[dateKey] || [];
                return events;
            });

            // Destroy existing chart
            if (this.updateTimelineChart) {
                this.updateTimelineChart.destroy();
            }

            // Create line chart with distinct markers (no connecting lines)
            this.updateTimelineChart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Baseline',
                        data: baselineData,
                        backgroundColor: '#10b981',
                        borderColor: '#10b981',
                        borderWidth: 0,
                        pointRadius: 10,
                        pointHoverRadius: 12,
                        pointStyle: 'circle',
                        showLine: false
                    }, {
                        label: 'Microsoft Published',
                        data: microsoftData,
                        backgroundColor: '#3b82f6',
                        borderColor: '#3b82f6',
                        borderWidth: 0,
                        pointRadius: 8,
                        pointHoverRadius: 10,
                        pointStyle: 'triangle',
                        showLine: false
                    }, {
                        label: 'Data Collected',
                        data: collectionData,
                        backgroundColor: '#ef4444',
                        borderColor: '#ef4444',
                        borderWidth: 0,
                        pointRadius: 8,
                        pointHoverRadius: 10,
                        pointStyle: 'rectRot',
                        showLine: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    const index = items[0].dataIndex;
                                    return sortedDates[index];
                                },
                                label: (context) => {
                                    const index = context.dataIndex;
                                    const events = metadata[index] || [];
                                    const datasetType = ['baseline', 'microsoft', 'collection'][context.datasetIndex];
                                    const event = events.find(e => e.type === datasetType);

                                    if (event) {
                                        const typeLabel = {
                                            'baseline': 'Baseline Start',
                                            'microsoft': 'Microsoft Published',
                                            'collection': 'Data Collected'
                                        }[event.type];
                                        return `${typeLabel}: ChangeNumber ${event.changeNumber}`;
                                    }
                                    return '';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Date'
                            },
                            grid: {
                                display: true,
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        },
                        y: {
                            min: -0.5,
                            max: 2.5,
                            ticks: {
                                stepSize: 1,
                                callback: function (value) {
                                    const labels = ['Baseline', 'Microsoft Published', 'Data Collected'];
                                    return labels[value] || '';
                                }
                            },
                            grid: {
                                display: true,
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        }
                    }
                }
            });

            const msCount = microsoftData.filter(v => v !== null).length;
            const collCount = collectionData.filter(v => v !== null).length;
            console.log(`✅ Update Timeline rendered with ${filteredData.length} updates (${msCount} Microsoft publishes, ${collCount} collections)`);
        } catch (error) {
            console.error('Error rendering update timeline chart:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading update timeline data</p>';
        }
    }

    async renderServiceTrendsChart() {
        const canvas = document.getElementById('serviceTrendsChart');
        if (!canvas) return;

        try {
            // Load all historical changes to track AzureCloud regions over time
            const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            // Exclude baseline (oldest date)
            const changeFiles = manifest.files.filter(f => f.date !== manifest.date_range.oldest);

            if (changeFiles.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">Not enough historical data yet (need at least 2 weeks)</p>';
                return;
            }

            // Track total changes per AzureCloud region
            const regionStats = {};

            for (const fileInfo of changeFiles) {
                try {
                    const changeResponse = await this.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                    const changeData = await changeResponse.json();

                    (changeData.changes || []).forEach(change => {
                        const serviceName = change.service;

                        // ONLY include AzureCloud and regional variants (AzureCloud.WestUS2, etc.)
                        if (!serviceName.startsWith('AzureCloud')) {
                            return;
                        }

                        // Extract region from service name
                        let region;
                        if (serviceName === 'AzureCloud') {
                            region = 'Global';
                        } else {
                            // Extract region: AzureCloud.WestUS2 → WestUS2
                            region = serviceName.replace('AzureCloud.', '');
                        }

                        const addedCount = (change.added_prefixes || change.added || []).length;
                        const removedCount = (change.removed_prefixes || change.removed || []).length;
                        const totalChanges = addedCount + removedCount;

                        // Track total changes per region
                        if (!regionStats[region]) {
                            regionStats[region] = 0;
                        }
                        regionStats[region] += totalChanges;
                    });
                } catch (err) {
                    console.log(`Could not load ${fileInfo.filename}`);
                }
            }

            // Get Top 10 most affected AzureCloud regions
            const topRegions = Object.entries(regionStats)
                .map(([region, totalChanges]) => ({ region, totalChanges }))
                .sort((a, b) => b.totalChanges - a.totalChanges)
                .slice(0, 10);

            if (topRegions.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">No AzureCloud infrastructure changes detected yet</p>';
                return;
            }

            // Map region codes to display names
            const regionDisplayNames = {
                'Global': 'Global Infrastructure',
                'EastUS': 'East US',
                'EastUS2': 'East US 2',
                'WestUS': 'West US',
                'WestUS2': 'West US 2',
                'WestUS3': 'West US 3',
                'CentralUS': 'Central US',
                'NorthCentralUS': 'North Central US',
                'SouthCentralUS': 'South Central US',
                'WestCentralUS': 'West Central US',
                'NorthEurope': 'North Europe',
                'WestEurope': 'West Europe',
                'UKSouth': 'UK South',
                'UKWest': 'UK West',
                'FranceCentral': 'France Central',
                'FranceSouth': 'France South',
                'GermanyWestCentral': 'Germany West Central',
                'NorwayEast': 'Norway East',
                'SwedenCentral': 'Sweden Central',
                'SwitzerlandNorth': 'Switzerland North',
                'EastAsia': 'East Asia',
                'SoutheastAsia': 'Southeast Asia',
                'AustraliaEast': 'Australia East',
                'AustraliaSoutheast': 'Australia Southeast',
                'AustraliaCentral': 'Australia Central',
                'JapanEast': 'Japan East',
                'JapanWest': 'Japan West',
                'KoreaCentral': 'Korea Central',
                'KoreaSouth': 'Korea South',
                'ChinaEast': 'China East',
                'ChinaNorth': 'China North',
                'IndiaWest': 'India West',
                'IndiaCentral': 'India Central',
                'IndiaSouth': 'India South',
                'CanadaCentral': 'Canada Central',
                'CanadaEast': 'Canada East',
                'BrazilSouth': 'Brazil South',
                'SouthAfricaNorth': 'South Africa North',
                'SouthAfricaWest': 'South Africa West',
                'UAENorth': 'UAE North',
                'UAECentral': 'UAE Central'
            };

            // Prepare pie chart data
            const colors = [
                '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
                '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
            ];

            const labels = topRegions.map(r => regionDisplayNames[r.region] || r.region);
            const data = topRegions.map(r => r.totalChanges);
            const backgroundColors = colors.slice(0, topRegions.length);

            // Destroy existing chart
            if (this.serviceTrendsChart) {
                this.serviceTrendsChart.destroy();
            }

            // Create pie chart
            this.serviceTrendsChart = new Chart(canvas, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: '#fff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'right',
                            onClick: null, // Disable legend click to prevent hiding slices
                            labels: {
                                boxWidth: 15,
                                padding: 10,
                                font: {
                                    size: 11
                                },
                                generateLabels: (chart) => {
                                    const data = chart.data;
                                    return data.labels.map((label, i) => ({
                                        text: `${label} (${data.datasets[0].data[i]})`,
                                        fillStyle: data.datasets[0].backgroundColor[i],
                                        hidden: false,
                                        index: i
                                    }));
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} IP changes (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });

            console.log(`✅ AzureCloud Regional Infrastructure Chart rendered with ${topRegions.length} regions`);
        } catch (error) {
            console.error('Error rendering AzureCloud regional chart:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading service trends data</p>';
        }
    }

    showServiceRegionalBreakdown(serviceName, serviceData) {
        // Group by region
        const regionStats = {};

        serviceData.forEach(change => {
            change.regions.forEach(region => {
                if (!regionStats[region]) {
                    regionStats[region] = { added: 0, removed: 0, occurrences: 0 };
                }
                regionStats[region].added += change.added;
                regionStats[region].removed += change.removed;
                regionStats[region].occurrences++;
            });
        });

        // Sort by total changes
        const sortedRegions = Object.entries(regionStats)
            .map(([region, stats]) => ({
                region: this.regionDisplayNames[region] || region,
                ...stats,
                total: stats.added + stats.removed
            }))
            .sort((a, b) => b.total - a.total);

        // Create modal
        const overlay = document.createElement('div');
        overlay.className = 'changes-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'changes-modal';
        modal.style.maxWidth = '700px';

        let regionsHTML = '';
        if (sortedRegions.length === 0) {
            regionsHTML = '<p class="no-data">No regional data available for this service</p>';
        } else {
            regionsHTML = `
                <div class="region-breakdown-list">
                    ${sortedRegions.map(r => `
                        <div class="region-breakdown-item">
                            <div class="region-breakdown-header">
                                <span class="region-name">${r.region}</span>
                                <span class="region-total">${r.total} total changes</span>
                            </div>
                            <div class="region-breakdown-stats">
                                <span class="stat-added">+${r.added} added</span>
                                <span class="stat-removed">-${r.removed} removed</span>
                                <span class="stat-occurrences">${r.occurrences} week${r.occurrences > 1 ? 's' : ''}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        modal.innerHTML = `
            <div class="modal-header">
                <h3>📍 Regional Breakdown: ${serviceName}</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <p class="modal-description">Changes by region across all tracked weeks</p>
                ${regionsHTML}
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // ESC key handler
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);

        // Override remove to clean up
        const originalRemove = overlay.remove.bind(overlay);
        overlay.remove = function () {
            document.removeEventListener('keydown', escapeHandler);
            originalRemove();
        };

        // Close handlers
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        modal.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    }

    async renderWeeklyActivityChart() {
        const canvas = document.getElementById('weeklyActivityChart');
        if (!canvas) return;

        try {
            // Load all historical changes
            const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            // Exclude baseline
            const changeFiles = manifest.files.filter(f => f.date !== manifest.date_range.oldest);

            if (changeFiles.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">Not enough historical data yet</p>';
                return;
            }

            const weeklyData = [];

            for (const fileInfo of changeFiles) {
                try {
                    const changeResponse = await this.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                    const changeData = await changeResponse.json();

                    let addedIPs = 0;
                    let removedIPs = 0;

                    (changeData.changes || []).forEach(change => {
                        addedIPs += change.added_count || 0;
                        removedIPs += change.removed_count || 0;
                    });

                    weeklyData.push({
                        date: fileInfo.date,
                        added: addedIPs,
                        removed: removedIPs
                    });
                } catch (err) {
                    console.log(`Could not load ${fileInfo.filename}`);
                }
            }

            // Sort by date
            weeklyData.sort((a, b) => this.parseDateOnly(a.date) - this.parseDateOnly(b.date));

            // Limit to last 24 weeks (approximately 6 months) for readability
            const maxWeeksToShow = 24;
            const limitedData = weeklyData.length > maxWeeksToShow
                ? weeklyData.slice(-maxWeeksToShow)
                : weeklyData;

            const labels = limitedData.map(item => {
                const date = this.parseDateOnly(item.date);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });

            // Destroy existing chart
            if (this.weeklyActivityChart) {
                this.weeklyActivityChart.destroy();
            }

            // Custom plugin to draw vertical 'No changes' markers for zero-activity weeks
            const zeroChangePlugin = {
                id: 'zeroChangeVerticalMarker',
                afterDatasetsDraw: (chart) => {
                    const { ctx, chartArea } = chart;
                    const meta = chart.getDatasetMeta(0);
                    if (!meta || !meta.data) return;

                    ctx.save();
                    ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
                    ctx.textAlign = 'center';

                    meta.data.forEach((bar, index) => {
                        const total = (limitedData[index]?.added || 0) + (limitedData[index]?.removed || 0);
                        if (!bar || total !== 0) return;

                        const x = bar.x;
                        const midY = (chartArea.top + chartArea.bottom) / 2;

                        // Draw a subtle vertical line as a watermark
                        ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(x, chartArea.top + 4);
                        ctx.lineTo(x, chartArea.bottom - 4);
                        ctx.stroke();
                        ctx.setLineDash([]);

                        // Draw rotated 'No changes' text along the line
                        ctx.save();
                        ctx.translate(x, midY);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText('No changes', 0, -6);
                        ctx.restore();
                    });

                    ctx.restore();
                }
            };

            // Create chart
            this.weeklyActivityChart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Added IPs',
                            data: limitedData.map(item => item.added),
                            backgroundColor: 'rgba(76, 175, 80, 0.7)',
                            borderColor: 'rgba(76, 175, 80, 1)',
                            borderWidth: 1
                        },
                        {
                            label: 'Removed IPs',
                            data: limitedData.map(item => item.removed),
                            backgroundColor: 'rgba(244, 67, 54, 0.7)',
                            borderColor: 'rgba(244, 67, 54, 1)',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    const index = items[0].dataIndex;
                                    const date = this.parseDateOnly(limitedData[index].date);
                                    return date.toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    });
                                },
                                label: (context) => {
                                    return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: false,
                            title: {
                                display: true,
                                text: 'Week'
                            }
                        },
                        y: {
                            stacked: false,
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of IP Ranges'
                            }
                        }
                    }
                },
                plugins: [zeroChangePlugin]
            });

            console.log(`✅ Weekly Activity Chart rendered with ${limitedData.length} weeks (last ${maxWeeksToShow} weeks shown)`);
        } catch (error) {
            console.error('Error rendering weekly activity chart:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading weekly activity data</p>';
        }
    }

    async renderRegionalChart() {
        const canvas = document.getElementById('regionalChart');
        if (!canvas) return;

        try {
            // Load all historical changes to get regional distribution
            const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            const regionalCounts = {};

            for (const fileInfo of manifest.files) {
                try {
                    const changeResponse = await this.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                    const changeData = await changeResponse.json();

                    (changeData.changes || []).forEach(change => {
                        const region = change.region || 'Global';
                        regionalCounts[region] = (regionalCounts[region] || 0) + 1;
                    });
                } catch (err) {
                    console.log(`Could not load ${fileInfo.filename}`);
                }
            }

            // Sort and get top regions
            const sortedRegions = Object.entries(regionalCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15); // Top 15 regions

            if (sortedRegions.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">No regional data available</p>';
                return;
            }

            const labels = sortedRegions.map(([region]) => this.regionMapper.getRegionDisplayName(region));
            const data = sortedRegions.map(([, count]) => count);

            // Calculate total for percentages
            const total = data.reduce((a, b) => a + b, 0);

            // Generate colors
            const colors = sortedRegions.map((_, index) => {
                const hue = (index * 360 / sortedRegions.length);
                return `hsl(${hue}, 70%, 60%)`;
            });

            // Destroy existing chart
            if (this.regionalChart) {
                this.regionalChart.destroy();
            }

            // Create chart
            this.regionalChart = new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: colors,
                        borderColor: '#fff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const regionDisplayName = labels[index];
                            // Find original region key from display name
                            const regionKey = sortedRegions[index][0];
                            this.showRegionalChangesModal(regionKey, regionDisplayName, regionalCounts[regionKey]);
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'right',
                            onClick: (event, legendItem, legend) => {
                                // Make legend items clickable to show regional details
                                const index = legendItem.index;
                                const regionDisplayName = labels[index];
                                const regionKey = sortedRegions[index][0];
                                this.showRegionalChangesModal(regionKey, regionDisplayName, regionalCounts[regionKey]);
                            },
                            labels: {
                                boxWidth: 12,
                                padding: 8,
                                font: {
                                    size: 11
                                },
                                generateLabels: (chart) => {
                                    const data = chart.data;
                                    if (data.labels.length && data.datasets.length) {
                                        return data.labels.map((label, i) => {
                                            const value = data.datasets[0].data[i];
                                            const percentage = ((value / total) * 100).toFixed(1);
                                            return {
                                                text: `${label} (${percentage}%)`,
                                                fillStyle: data.datasets[0].backgroundColor[i],
                                                strokeStyle: data.datasets[0].borderColor,
                                                lineWidth: data.datasets[0].borderWidth,
                                                hidden: false,
                                                index: i
                                            };
                                        });
                                    }
                                    return [];
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const percentage = ((context.parsed / total) * 100).toFixed(1);
                                    return `${context.label}: ${context.parsed} changes (${percentage}%) - Click to view details`;
                                }
                            }
                        }
                    }
                }
            });

            console.log(`✅ Regional Chart rendered with ${sortedRegions.length} regions`);

            // Add summary statistics and recent activity to the chart footer
            const chartCard = canvas.closest('.chart-card');
            const footer = chartCard.querySelector('.chart-footer');
            if (footer) {
                const totalRegions = Object.keys(regionalCounts).length;
                const totalChanges = Object.values(regionalCounts).reduce((a, b) => a + b, 0);
                const topRegion = sortedRegions[0];

                // Get last 5 weeks (excluding baseline) and then keep only those with regional changes
                const candidateWeeks = manifest.files
                    .filter(f => f.date !== manifest.date_range.oldest)
                    .sort((a, b) => new Date(b.date) - new Date(a.date));

                // Build recent activity HTML from weeks that actually have regional changes
                let recentActivityHTML = '';
                let includedWeeks = 0;

                for (const weekFile of candidateWeeks) {
                    if (includedWeeks >= 5) break;

                    try {
                        const weekResponse = await fetch(`data/changes/${weekFile.filename}`);
                        const weekData = await weekResponse.json();

                        const weekRegions = new Set();
                        (weekData.changes || []).forEach(change => {
                            const region = change.region || 'Global';
                            if (region) {
                                weekRegions.add(region);
                            }
                        });

                        // Skip weeks that ended up with no regions (no regional changes)
                        if (weekRegions.size === 0) {
                            continue;
                        }

                        const weekDate = new Date(weekFile.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                        });

                        recentActivityHTML += `
                            <div style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-weight: 600; color: var(--text-color);">${weekDate}</span>
                                    <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                                        ${weekRegions.size} region${weekRegions.size !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
                                    ${Array.from(weekRegions).slice(0, 3).map(r => this.regionMapper.getRegionDisplayName(r)).join(', ')}${weekRegions.size > 3 ? ` +${weekRegions.size - 3} more` : ''}
                                </div>
                            </div>
                        `;

                        includedWeeks += 1;
                    } catch (err) {
                        console.log(`Could not load ${weekFile.filename} for recent activity`);
                    }
                }

                footer.innerHTML = `
                    <div style="padding: 0.5rem 0;">
                        <div style="margin-bottom: 0.75rem;">
                            <h4 style="font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--text-color);">
                                📅 Recent Regional Activity (Last 5 Updates)
                            </h4>
                            <div style="background: var(--bg-color); border-radius: 8px; padding: 0.75rem; max-height: 300px; overflow-y: auto;">
                                ${recentActivityHTML || '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No recent data available</p>'}
                            </div>
                        </div>
                        
                        <div style="color: var(--primary-color); font-size: 0.85rem; text-align: center;">
                            💡 Chart shows top 15 most active regions • Click on regions or legend to see detailed changes
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error rendering regional chart:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading regional data</p>';
        }
    }



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
        const changeDate = this.parseDateOnly(date) || new Date(date);
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

    async getLastChangeDate() {
        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`./data/changes/manifest.json?t=${timestamp}`);

            if (!response.ok) {
                return {
                    html: `
                        <div style="margin-top: 1rem; padding: 1rem; background: var(--card-background); border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-weight: 600; margin-bottom: 0.5rem;">💡 Want to see previous updates?</div>
                            <div style="font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--text-secondary);">
                                Check the Change History Timeline below to browse historical changes
                            </div>
                            <button onclick="dashboard.scrollToTimeline()" class="timeline-link-btn">
                                📅 View Change History Timeline
                            </button>
                        </div>
                    `
                };
            }

            const manifest = await response.json();
            const files = manifest.files || [];

            // Filter out baseline (oldest date)
            const oldestDate = manifest.date_range?.oldest;
            const changeFiles = files.filter(f => f.date !== oldestDate);

            if (changeFiles.length === 0) {
                return {
                    html: `
                        <div style="margin-top: 1rem; padding: 1rem; background: var(--card-background); border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-weight: 600; margin-bottom: 0.5rem;">📊 Change tracking started</div>
                            <div style="font-size: 0.9rem; color: var(--text-secondary);">
                                Monitoring Azure Service Tags for changes. Updates will appear here weekly.
                            </div>
                        </div>
                    `
                };
            }

            // Get the most recent change file (should be sorted newest first)
            const sortedFiles = changeFiles.sort((a, b) => new Date(b.date) - new Date(a.date));
            const lastChangeFile = sortedFiles[0];
            const lastChangeDate = new Date(lastChangeFile.date);
            const formattedDate = lastChangeDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            // Calculate days ago
            const today = new Date();
            const diffTime = Math.abs(today - lastChangeDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const daysAgoText = diffDays === 0 ? 'today' : diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;

            return {
                html: `
                    <div style="margin-top: 1rem; padding: 1rem; background: var(--card-background); border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-weight: 600; margin-bottom: 0.5rem;">📅 Last Update</div>
                        <div style="font-size: 0.95rem; margin-bottom: 0.5rem;">
                            <strong>${formattedDate}</strong> (${daysAgoText})
                        </div>
                        <div style="font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--text-secondary);">
                            View all historical changes in the timeline below
                        </div>
                        <button onclick="dashboard.scrollToTimeline()" class="timeline-link-btn">
                            📅 View Change History Timeline
                        </button>
                    </div>
                `
            };

        } catch (error) {
            console.error('Error fetching last change date:', error);
            return {
                html: `
                    <div style="margin-top: 1rem; padding: 1rem; background: var(--card-background); border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-weight: 600; margin-bottom: 0.5rem;">💡 Want to see previous updates?</div>
                        <div style="font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--text-secondary);">
                            Check the Change History Timeline below to browse historical changes
                        </div>
                        <button onclick="dashboard.scrollToTimeline()" class="timeline-link-btn">
                            📅 View Change History Timeline
                        </button>
                    </div>
                `
            };
        }
    }


    setupEventListeners() {
        // Modal close events
        const modal = document.getElementById('serviceModal');
        const closeBtn = document.getElementById('closeModal');

        // Ensure modal is hidden initially
        if (modal) {
            modal.classList.add('hidden');
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (modal) {
                    modal.classList.add('hidden');
                }
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
            }
        });

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






    // Case-insensitive whole-token-ish match: avoids matching "eastus3" inside "southeastus3"
    matchesSearchTerm(text, term) {
        if (!text || !term) return false;
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, 'i');
        return regex.test(text);
    }

    buildServicePrefixLookup() {
        // Delegated to DataManager, but syncing here just in case
        this.servicePrefixLookup = this.dataManager.servicePrefixLookup;
    }

    getServiceInfo(serviceName) {
        return this.dataManager.getServiceInfo(serviceName);
    }

    createSyntheticIPChange(change) {
        if (!this.includeNewServiceIPs) return null;
        const info = this.getServiceInfo(change.service);
        if (!info || !info.prefixes || info.prefixes.length === 0) return null;
        const regionCode = change.region || info.region || this.regionMapper.deriveRegionCode(change) || 'global';
        return {
            ...change,
            type: 'ip_changes',
            added_prefixes: info.prefixes,
            removed_prefixes: [],
            added_count: info.prefixes.length,
            removed_count: 0,
            region: regionCode,
            synthetic_new_service: true
        };
    }

    normalizeChangesForIP(changes) {
        return (changes || []).flatMap(change => {
            if (change.type === 'ip_changes') return [change];
            if (change.type === 'service_added') {
                const synthetic = this.createSyntheticIPChange(change);
                return synthetic ? [synthetic] : [];
            }
            return [];
        });
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
                    const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
                    const manifest = await manifestResponse.json();

                    // Sort files by date (newest first)
                    const sortedFiles = manifest.files
                        .sort((a, b) => new Date(b.date) - new Date(a.date));

                    // Look through previous weeks to find the last one with changes
                    for (const file of sortedFiles) {
                        const fileResponse = await this.fetchWithCacheBust(`data/changes/${file.filename}`);
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
