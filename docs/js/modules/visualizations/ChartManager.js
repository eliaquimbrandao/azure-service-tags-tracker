export class ChartManager {
    constructor(dataManager, regionMapper, callbacks = {}) {
        this.dataManager = dataManager;
        this.regionMapper = regionMapper;
        this.callbacks = callbacks;
        this.updateTimelineChart = null;
        this.weeklyActivityChart = null;
        this.regionalChart = null;
    }

    async renderUpdateTimeline() {
        const canvas = document.getElementById('updateTimelineChart');
        if (!canvas) return;

        try {
            // changeNumber comes from the manifest; the 4.5MB history snapshots
            // are never downloaded just to read one field.
            const manifest = await this.dataManager.getManifest();
            const files = manifest.files.filter(f => f.change_number);
            const changeDatas = await this.dataManager.getChangeFiles(files);

            const timelineData = files.map((fileInfo, i) => {
                const item = {
                    date: fileInfo.date,
                    changeNumber: parseInt(fileInfo.change_number),
                    collectionDate: this.dataManager.parseDateOnly(fileInfo.date)
                };

                const dateStr = changeDatas[i]?.metadata?.date_published;
                if (dateStr) {
                    let parsedDate = null;

                    const partsSlash = dateStr.split('/');
                    if (partsSlash.length === 3) {
                        const month = parseInt(partsSlash[0], 10) - 1;
                        const day = parseInt(partsSlash[1], 10);
                        const year = parseInt(partsSlash[2], 10);
                        if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
                            parsedDate = new Date(Date.UTC(year, month, day));
                        }
                    }

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

                return item;
            });

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

            // Build update objects — each groups baseline/published/collected for a changeNumber
            this.timelineUpdates = filteredData.map((item, index) => {
                const update = {
                    changeNumber: item.changeNumber,
                    collectionDate: item.collectionDate,
                    collectionDateKey: item.collectionDate.toISOString().split('T')[0],
                    isBaseline: index === 0
                };

                if (index > 0 && item.microsoftPublished && item.microsoftPublished > filteredData[0].collectionDate) {
                    update.microsoftPublished = item.microsoftPublished;
                    update.microsoftDateKey = item.microsoftPublished.toISOString().split('T')[0];

                    // Calculate lag in days
                    const lag = Math.round((item.collectionDate - item.microsoftPublished) / (1000 * 60 * 60 * 24));
                    update.lagDays = lag;
                }

                return update;
            });

            // Page size: show N updates at a time
            this.timelinePageSize = 4;
            // Default to last page (most recent updates)
            this.timelineTotalPages = Math.ceil(this.timelineUpdates.length / this.timelinePageSize);
            this.timelineCurrentPage = this.timelineTotalPages - 1;

            this._renderTimelinePage();

        } catch (error) {
            console.error('Error rendering update timeline chart:', error);
            canvas.parentElement.innerHTML = '<p class="error">Failed to load timeline data</p>';
        }
    }

    timelinePrevMonth() {
        if (this.timelineCurrentPage > 0) {
            this.timelineCurrentPage--;
            this._renderTimelinePage();
        }
    }

    timelineNextMonth() {
        if (this.timelineCurrentPage < this.timelineTotalPages - 1) {
            this.timelineCurrentPage++;
            this._renderTimelinePage();
        }
    }

    _renderTimelinePage() {
        const canvas = document.getElementById('updateTimelineChart');
        if (!canvas || !this.timelineUpdates || this.timelineUpdates.length === 0) return;

        const start = this.timelineCurrentPage * this.timelinePageSize;
        const end = Math.min(start + this.timelinePageSize, this.timelineUpdates.length);
        const pageUpdates = this.timelineUpdates.slice(start, end);

        // Update navigation label
        const labelEl = document.getElementById('timelineMonthLabel');
        if (labelEl) {
            labelEl.textContent = `Updates ${start + 1}–${end} of ${this.timelineUpdates.length}`;
        }

        // Update button states
        const prevBtn = document.getElementById('timelinePrevMonth');
        const nextBtn = document.getElementById('timelineNextMonth');
        if (prevBtn) prevBtn.disabled = this.timelineCurrentPage === 0;
        if (nextBtn) nextBtn.disabled = this.timelineCurrentPage === this.timelineTotalPages - 1;

        // Update stats
        const statsEl = document.getElementById('timelineMonthStats');
        if (statsEl) {
            const firstDate = pageUpdates[0].collectionDateKey;
            const lastDate = pageUpdates[pageUpdates.length - 1].collectionDateKey;
            const fmtFirst = this.dataManager.parseDateOnly(firstDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const fmtLast = this.dataManager.parseDateOnly(lastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const hasBaseline = pageUpdates.some(u => u.isBaseline);
            const lags = pageUpdates.filter(u => u.lagDays !== undefined);
            const avgLag = lags.length > 0 ? Math.round(lags.reduce((s, u) => s + u.lagDays, 0) / lags.length) : null;

            let html = `<span class="stat-weeks">${fmtFirst} — ${fmtLast}</span>`;
            if (hasBaseline) html += '<span class="stat-baseline">Baseline</span>';
            if (avgLag !== null) html += `<span class="stat-ms">~${avgLag}d avg lag</span>`;
            statsEl.innerHTML = html;
        }

        // Build chart data: spread events on actual date x-axis
        const allDates = new Set();
        const eventsByDate = {};

        for (const u of pageUpdates) {
            if (u.isBaseline) {
                allDates.add(u.collectionDateKey);
                if (!eventsByDate[u.collectionDateKey]) eventsByDate[u.collectionDateKey] = [];
                eventsByDate[u.collectionDateKey].push({ type: 'baseline', changeNumber: u.changeNumber, update: u });
            } else {
                if (u.microsoftDateKey) {
                    allDates.add(u.microsoftDateKey);
                    if (!eventsByDate[u.microsoftDateKey]) eventsByDate[u.microsoftDateKey] = [];
                    eventsByDate[u.microsoftDateKey].push({ type: 'microsoft', changeNumber: u.changeNumber, update: u });
                }
                allDates.add(u.collectionDateKey);
                if (!eventsByDate[u.collectionDateKey]) eventsByDate[u.collectionDateKey] = [];
                eventsByDate[u.collectionDateKey].push({ type: 'collection', changeNumber: u.changeNumber, update: u });
            }
        }

        const sortedDates = Array.from(allDates).sort();
        const labels = sortedDates.map(dateStr => {
            const date = this.dataManager.parseDateOnly(dateStr);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        // Build dataset arrays by date position
        const baselineData = sortedDates.map(dateKey => {
            const events = eventsByDate[dateKey] || [];
            return events.find(e => e.type === 'baseline') ? 0 : null;
        });

        const microsoftData = sortedDates.map(dateKey => {
            const events = eventsByDate[dateKey] || [];
            return events.find(e => e.type === 'microsoft') ? 1 : null;
        });

        const collectionData = sortedDates.map(dateKey => {
            const events = eventsByDate[dateKey] || [];
            return events.find(e => e.type === 'collection') ? 2 : null;
        });

        const metadata = sortedDates.map(dateKey => eventsByDate[dateKey] || []);

        // Build lag pairs for dashed connector lines (Microsoft Published → Data Collected)
        const lagPairs = [];
        for (const u of pageUpdates) {
            if (!u.isBaseline && u.microsoftDateKey && u.collectionDateKey) {
                const msIndex = sortedDates.indexOf(u.microsoftDateKey);
                const colIndex = sortedDates.indexOf(u.collectionDateKey);
                if (msIndex >= 0 && colIndex >= 0) {
                    lagPairs.push({ msIndex, colIndex, lagDays: u.lagDays });
                }
            }
        }

        // Destroy existing chart
        if (this.updateTimelineChart) {
            this.updateTimelineChart.destroy();
        }

        // Create chart with date-based x-axis
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
            plugins: [{
                id: 'lagConnector',
                afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx;
                    const xScale = chart.scales.x;
                    const yScale = chart.scales.y;

                    ctx.save();
                    ctx.setLineDash([6, 4]);
                    ctx.lineWidth = 1.5;

                    for (const pair of lagPairs) {
                        const x1 = xScale.getPixelForValue(pair.msIndex);
                        const y1 = yScale.getPixelForValue(1);
                        const x2 = xScale.getPixelForValue(pair.colIndex);
                        const y2 = yScale.getPixelForValue(2);

                        ctx.strokeStyle = 'rgba(107, 114, 128, 0.45)';
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();

                        // Draw lag days label on the line
                        if (pair.lagDays !== undefined) {
                            const midX = (x1 + x2) / 2;
                            const midY = (y1 + y2) / 2;
                            const label = `${pair.lagDays}d`;

                            ctx.setLineDash([]);
                            ctx.font = '10px system-ui, sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';

                            const textWidth = ctx.measureText(label).width;
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                            ctx.fillRect(midX - textWidth / 2 - 3, midY - 14, textWidth + 6, 14);

                            ctx.fillStyle = '#6b7280';
                            ctx.fillText(label, midX, midY - 2);
                            ctx.setLineDash([6, 4]);
                        }
                    }

                    ctx.restore();
                }
            }],
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
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const index = items[0].dataIndex;
                                const date = this.dataManager.parseDateOnly(sortedDates[index]);
                                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
                                    let label = `${typeLabel}: #${event.changeNumber}`;
                                    if (event.type === 'collection' && event.update.lagDays !== undefined) {
                                        label += ` (${event.update.lagDays}d lag)`;
                                    }
                                    return label;
                                }
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
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
    }

    async renderWeeklyActivityChart() {
        const canvas = document.getElementById('weeklyActivityChart');
        if (!canvas) return;

        try {
            // Load all historical changes
            const manifest = await this.dataManager.getManifest();

            // Exclude baseline
            const changeFiles = manifest.files.filter(f => f.date !== manifest.date_range.oldest);

            if (changeFiles.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">Not enough historical data yet</p>';
                return;
            }

            const changeDatas = await this.dataManager.getChangeFiles(changeFiles);
            const weeklyData = [];

            changeFiles.forEach((fileInfo, i) => {
                if (!changeDatas[i]) return;

                let addedIPs = 0;
                let removedIPs = 0;

                (changeDatas[i].changes || []).forEach(change => {
                    addedIPs += change.added_count || 0;
                    removedIPs += change.removed_count || 0;
                });

                weeklyData.push({
                    date: fileInfo.date,
                    added: addedIPs,
                    removed: removedIPs
                });
            });

            // Sort by date
            weeklyData.sort((a, b) => this.dataManager.parseDateOnly(a.date) - this.dataManager.parseDateOnly(b.date));

            // Group by month (YYYY-MM)
            this.weeklyDataByMonth = new Map();
            for (const item of weeklyData) {
                const monthKey = item.date.substring(0, 7); // "YYYY-MM"
                if (!this.weeklyDataByMonth.has(monthKey)) {
                    this.weeklyDataByMonth.set(monthKey, []);
                }
                this.weeklyDataByMonth.get(monthKey).push(item);
            }

            // Get sorted month keys
            this.weeklyMonthKeys = [...this.weeklyDataByMonth.keys()].sort();

            // Default to the latest month
            this.weeklyCurrentMonthIndex = this.weeklyMonthKeys.length - 1;

            // Render current month
            this._renderWeeklyMonth();

        } catch (error) {
            console.error('Error rendering weekly activity chart:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading weekly activity data</p>';
        }
    }

    weeklyActivityPrevMonth() {
        if (this.weeklyCurrentMonthIndex > 0) {
            this.weeklyCurrentMonthIndex--;
            this._renderWeeklyMonth();
        }
    }

    weeklyActivityNextMonth() {
        if (this.weeklyCurrentMonthIndex < this.weeklyMonthKeys.length - 1) {
            this.weeklyCurrentMonthIndex++;
            this._renderWeeklyMonth();
        }
    }

    _renderWeeklyMonth() {
        const canvas = document.getElementById('weeklyActivityChart');
        if (!canvas || !this.weeklyMonthKeys || this.weeklyMonthKeys.length === 0) return;

        const monthKey = this.weeklyMonthKeys[this.weeklyCurrentMonthIndex];
        const monthData = this.weeklyDataByMonth.get(monthKey);

        // Update navigation label
        const [year, month] = monthKey.split('-');
        const monthDate = new Date(parseInt(year), parseInt(month) - 1);
        const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const labelEl = document.getElementById('weeklyMonthLabel');
        if (labelEl) labelEl.textContent = monthLabel;

        // Update navigation button states
        const prevBtn = document.getElementById('weeklyPrevMonth');
        const nextBtn = document.getElementById('weeklyNextMonth');
        if (prevBtn) prevBtn.disabled = this.weeklyCurrentMonthIndex === 0;
        if (nextBtn) nextBtn.disabled = this.weeklyCurrentMonthIndex === this.weeklyMonthKeys.length - 1;

        // Update month summary stats
        const statsEl = document.getElementById('weeklyMonthStats');
        if (statsEl) {
            const totalAdded = monthData.reduce((sum, d) => sum + d.added, 0);
            const totalRemoved = monthData.reduce((sum, d) => sum + d.removed, 0);
            const activeWeeks = monthData.filter(d => d.added > 0 || d.removed > 0).length;
            statsEl.innerHTML = `<span class="stat-added">+${totalAdded.toLocaleString()}</span>` +
                `<span class="stat-removed">-${totalRemoved.toLocaleString()}</span>` +
                `<span class="stat-weeks">${activeWeeks}/${monthData.length} active weeks</span>`;
        }

        // Build labels and data
        const labels = monthData.map(item => {
            const date = this.dataManager.parseDateOnly(item.date);
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
                ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
                ctx.textAlign = 'center';

                meta.data.forEach((bar, index) => {
                    const total = (monthData[index]?.added || 0) + (monthData[index]?.removed || 0);
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

        // Compute y-axis max across all months for consistent scale
        let globalMax = 0;
        for (const [, data] of this.weeklyDataByMonth) {
            for (const d of data) {
                globalMax = Math.max(globalMax, d.added, d.removed);
            }
        }

        // Create chart
        this.weeklyActivityChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Added IPs',
                        data: monthData.map(item => item.added),
                        backgroundColor: 'rgba(76, 175, 80, 0.7)',
                        borderColor: 'rgba(76, 175, 80, 1)',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Removed IPs',
                        data: monthData.map(item => item.removed),
                        backgroundColor: 'rgba(244, 67, 54, 0.7)',
                        borderColor: 'rgba(244, 67, 54, 1)',
                        borderWidth: 1,
                        borderRadius: 4
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
                                const date = this.dataManager.parseDateOnly(monthData[index].date);
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
                        stacked: false
                    },
                    y: {
                        stacked: false,
                        beginAtZero: true,
                        suggestedMax: globalMax * 1.1,
                        title: {
                            display: true,
                            text: 'Number of IP Ranges'
                        }
                    }
                }
            },
            plugins: [zeroChangePlugin]
        });
    }

    async renderRegionalChart() {
        const canvas = document.getElementById('regionalChart');
        if (!canvas) return;

        try {
            // Load all historical changes to get regional distribution
            const manifest = await this.dataManager.getManifest();

            // Exclude baseline
            const changeFiles = manifest.files.filter(f => f.date !== manifest.date_range.oldest);
            const changeDatas = await this.dataManager.getChangeFiles(changeFiles);

            const regionalData = {};

            changeDatas.forEach(changeData => {
                (changeData?.changes || []).forEach(change => {
                    const region = change.region || 'global';
                    if (!regionalData[region]) {
                        regionalData[region] = { added: 0, removed: 0 };
                    }
                    regionalData[region].added += change.added_count || 0;
                    regionalData[region].removed += change.removed_count || 0;
                });
            });

            // Separate Global from regional data
            const globalData = regionalData['global'] || { added: 0, removed: 0 };
            const globalTotal = globalData.added + globalData.removed;
            delete regionalData['global'];

            // Sort by total (added + removed) and get top 15
            const sortedRegions = Object.entries(regionalData)
                .map(([region, data]) => ({ region, ...data, total: data.added + data.removed }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 15);

            // Render Global summary above the chart
            const globalSummaryEl = document.getElementById('regionalGlobalSummary');
            if (globalSummaryEl && globalTotal > 0) {
                globalSummaryEl.style.display = '';
                globalSummaryEl.innerHTML = `
                    <div class="global-stat-card" id="globalStatCard">
                        <div class="global-stat-icon">🌐</div>
                        <div class="global-stat-body">
                            <div class="global-stat-title">Global (non-regional) Services</div>
                            <div class="global-stat-numbers">
                                <span class="global-stat-total">${globalTotal.toLocaleString()} IP changes</span>
                                <span class="global-stat-added">+${globalData.added.toLocaleString()} added</span>
                                <span class="global-stat-removed">-${globalData.removed.toLocaleString()} removed</span>
                            </div>
                        </div>
                        <div class="global-stat-arrow">›</div>
                    </div>
                `;
                globalSummaryEl.querySelector('#globalStatCard').addEventListener('click', () => {
                    if (this.callbacks.onRegionClick) {
                        this.callbacks.onRegionClick('', 'Global', globalTotal);
                    }
                });
            }

            if (sortedRegions.length === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">No regional data available</p>';
                return;
            }

            // Reverse for horizontal bar (top item at top)
            const displayRegions = [...sortedRegions].reverse();

            const labels = displayRegions.map(r => this.regionMapper.getRegionDisplayName(r.region));
            const addedData = displayRegions.map(r => r.added);
            const removedData = displayRegions.map(r => r.removed);

            // Store for click handler
            const regionKeys = displayRegions.map(r => r.region);

            // Destroy existing chart
            if (this.regionalChart) {
                this.regionalChart.destroy();
            }

            // Create horizontal bar chart
            this.regionalChart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Added IPs',
                            data: addedData,
                            backgroundColor: 'rgba(76, 175, 80, 0.7)',
                            borderColor: 'rgba(76, 175, 80, 1)',
                            borderWidth: 1,
                            borderRadius: 3
                        },
                        {
                            label: 'Removed IPs',
                            data: removedData,
                            backgroundColor: 'rgba(244, 67, 54, 0.7)',
                            borderColor: 'rgba(244, 67, 54, 1)',
                            borderWidth: 1,
                            borderRadius: 3
                        }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (event, elements) => {
                        if (elements.length > 0 && this.callbacks.onRegionClick) {
                            const index = elements[0].index;
                            const regionKey = regionKeys[index];
                            const regionDisplayName = labels[index];
                            this.callbacks.onRegionClick(regionKey, regionDisplayName, displayRegions[index].total);
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        tooltip: {
                            callbacks: {
                                afterBody: (items) => {
                                    const index = items[0].dataIndex;
                                    const r = displayRegions[index];
                                    return `Total: ${r.total.toLocaleString()} IP changes`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            title: {
                                display: true,
                                text: 'Number of IP Changes'
                            },
                            beginAtZero: true
                        },
                        y: {
                            stacked: true,
                            ticks: {
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Error rendering regional chart:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading regional data</p>';
        }
    }
}
