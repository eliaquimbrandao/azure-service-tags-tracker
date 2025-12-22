export class ChartManager {
    constructor(dataManager, regionMapper, callbacks = {}) {
        this.dataManager = dataManager;
        this.regionMapper = regionMapper;
        this.callbacks = callbacks;
        this.updateTimelineChart = null;
        this.serviceTrendsChart = null;
        this.weeklyActivityChart = null;
        this.regionalChart = null;
    }

    async renderUpdateTimeline() {
        const canvas = document.getElementById('updateTimelineChart');
        if (!canvas) return;

        try {
            // Load all historical data files to get changeNumber timeline
            const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            const timelineData = [];

            // Load historical files with Microsoft metadata
            for (const fileInfo of manifest.files) {
                try {
                    const historyResponse = await this.dataManager.fetchWithCacheBust(`data/history/${fileInfo.date}.json`);
                    const changesResponse = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.date}-changes.json`);

                    if (historyResponse.ok) {
                        const historyData = await historyResponse.json();
                        if (historyData.changeNumber) {
                            const item = {
                                date: fileInfo.date,
                                changeNumber: parseInt(historyData.changeNumber),
                                collectionDate: this.dataManager.parseDateOnly(fileInfo.date)
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
                const date = this.dataManager.parseDateOnly(dateStr);
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

        } catch (error) {
            console.error('Error rendering update timeline chart:', error);
            canvas.parentElement.innerHTML = '<p class="error">Failed to load timeline data</p>';
        }
    }

    async renderServiceTrendsChart() {
        const canvas = document.getElementById('serviceTrendsChart');
        if (!canvas) return;

        try {
            // Load all historical changes to track AzureCloud regions over time
            const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');
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
                    const changeResponse = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
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

    async renderWeeklyActivityChart() {
        const canvas = document.getElementById('weeklyActivityChart');
        if (!canvas) return;

        try {
            // Load all historical changes
            const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');
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
                    const changeResponse = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
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
            weeklyData.sort((a, b) => this.dataManager.parseDateOnly(a.date) - this.dataManager.parseDateOnly(b.date));

            // Limit to last 24 weeks (approximately 6 months) for readability
            const maxWeeksToShow = 24;
            const limitedData = weeklyData.length > maxWeeksToShow
                ? weeklyData.slice(-maxWeeksToShow)
                : weeklyData;

            const labels = limitedData.map(item => {
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
                                    const date = this.dataManager.parseDateOnly(limitedData[index].date);
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
            const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            const regionalCounts = {};

            for (const fileInfo of manifest.files) {
                try {
                    const changeResponse = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
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

            const labels = sortedRegions.map(([region]) => this.regionMapper.getDisplayName(region));
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
                        if (elements.length > 0 && this.callbacks.onRegionClick) {
                            const index = elements[0].index;
                            const regionDisplayName = labels[index];
                            // Find original region key from display name
                            const regionKey = sortedRegions[index][0];
                            this.callbacks.onRegionClick(regionKey, regionDisplayName, regionalCounts[regionKey]);
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'right',
                            onClick: (event, legendItem, legend) => {
                                // Make legend items clickable to show regional details
                                if (this.callbacks.onRegionClick) {
                                    const index = legendItem.index;
                                    const regionDisplayName = labels[index];
                                    const regionKey = sortedRegions[index][0];
                                    this.callbacks.onRegionClick(regionKey, regionDisplayName, regionalCounts[regionKey]);
                                }
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
                                label: function (context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value} changes (${percentage}%)`;
                                }
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
