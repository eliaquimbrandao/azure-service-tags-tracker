export class ServiceList {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.activeServicesChart = null;
        this.allServices = [];
        this.totalWeeks = 0;
    }

    async renderActiveServices() {
        const canvas = document.getElementById('activeServicesChart');
        if (!canvas) return;

        try {
            // Load manifest to get total weeks and file list
            const manifest = await this.dataManager.getManifest();
            const oldestDate = manifest.date_range?.oldest;
            const changeFiles = manifest.files
                .filter(f => f.date !== oldestDate)
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            this.totalWeeks = changeFiles.length;
            if (this.totalWeeks === 0) {
                canvas.parentElement.innerHTML = '<p class="no-data">Not enough data yet</p>';
                return;
            }

            // Determine recent window (last 4 weeks)
            const recentDates = new Set(changeFiles.slice(-4).map(f => f.date));

            // Track rich per-service data
            const serviceMap = {};

            const changeDatas = await this.dataManager.getChangeFiles(changeFiles);

            changeFiles.forEach((fileInfo, i) => {
                (changeDatas[i]?.changes || []).forEach(change => {
                    const rawName = change.service;
                    if (!rawName || rawName.startsWith('AzureCloud')) return;

                    // Use system_service for clean base name, fallback to splitting on '.'
                    const name = change.system_service || rawName.split('.')[0];

                    if (!serviceMap[name]) {
                        serviceMap[name] = { added: 0, removed: 0, weekDates: new Set(), recentWeeks: 0 };
                    }
                    const s = serviceMap[name];
                    s.added += change.added_count || 0;
                    s.removed += change.removed_count || 0;
                    s.weekDates.add(fileInfo.date);
                    if (recentDates.has(fileInfo.date)) {
                        s.recentWeeks++;
                    }
                });
            });

            // Build scored list
            const services = Object.entries(serviceMap).map(([service, s]) => {
                const weeks = s.weekDates.size;
                const total = s.added + s.removed;
                const avgPerWeek = weeks > 0 ? total / weeks : 0;
                return {
                    service,
                    weeks,
                    added: s.added,
                    removed: s.removed,
                    total,
                    avgPerWeek: Math.round(avgPerWeek),
                    recentWeeks: s.recentWeeks
                };
            });

            // Compute normalized scores
            const maxTotal = Math.max(...services.map(s => s.total), 1);

            for (const s of services) {
                // Frequency (60%) — absolute: weeks_active / total_weeks
                const frequencyScore = (s.weeks / this.totalWeeks) * 60;

                // IP Volume (20%) — relative to max
                const magnitudeScore = (s.total / maxTotal) * 20;

                // Recency (20%) — how many of last 4 weeks had changes (absolute)
                const recencyScore = (Math.min(s.recentWeeks, 4) / 4) * 20;

                s.score = Math.round(frequencyScore + magnitudeScore + recencyScore);
                s.frequencyPct = Math.round((s.weeks / this.totalWeeks) * 100);
            }

            this.allServices = services.sort((a, b) => b.score - a.score);

            this.renderChart(canvas);
            this.renderTable();
        } catch (error) {
            console.error('Error rendering active services:', error);
            canvas.parentElement.innerHTML = '<p class="no-data">Error loading service data</p>';
        }
    }

    renderChart(canvas) {
        const top15 = this.allServices.slice(0, 15);
        if (top15.length === 0) return;

        // Reverse for horizontal bar (top item at top)
        const display = [...top15].reverse();

        if (this.activeServicesChart) {
            this.activeServicesChart.destroy();
        }

        const totalWeeks = this.totalWeeks;

        this.activeServicesChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: display.map(s => s.service),
                datasets: [
                    {
                        label: 'Added IPs',
                        data: display.map(s => s.added),
                        backgroundColor: 'rgba(76, 175, 80, 0.7)',
                        borderColor: 'rgba(76, 175, 80, 1)',
                        borderWidth: 1,
                        borderRadius: 3
                    },
                    {
                        label: 'Removed IPs',
                        data: display.map(s => s.removed),
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
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                const s = display[idx];
                                return [
                                    `Score: ${s.score}/100`,
                                    `Frequency: ${s.weeks}/${totalWeeks} weeks (${s.frequencyPct}%)`,
                                    `Avg: ${s.avgPerWeek} IPs/active week`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        title: { display: true, text: 'Number of IP Changes' },
                        beginAtZero: true
                    },
                    y: {
                        stacked: true,
                        ticks: { font: { size: 11 } }
                    }
                }
            }
        });
    }

    renderTable() {
        const container = document.getElementById('servicesTableContainer');
        if (!container || this.allServices.length === 0) return;

        const totalWeeks = this.totalWeeks;

        const rows = this.allServices.map((s, i) => {
            // Score bar visual
            const barColor = s.score >= 70 ? 'var(--success-color)' : s.score >= 40 ? '#f59e0b' : 'var(--text-muted)';
            const scoreBar = `<div class="score-cell"><div class="score-bar" style="width:${s.score}%;background:${barColor}"></div><span>${s.score}</span></div>`;

            // Frequency badge
            const freqClass = s.frequencyPct >= 80 ? 'freq-high' : s.frequencyPct >= 40 ? 'freq-med' : 'freq-low';

            return `
                <tr>
                    <td class="svc-rank">${i + 1}</td>
                    <td class="svc-name">${s.service}</td>
                    <td class="svc-freq"><span class="freq-badge ${freqClass}">${s.weeks}/${totalWeeks}</span></td>
                    <td class="svc-avg">${s.avgPerWeek.toLocaleString()}</td>
                    <td class="svc-added">+${s.added.toLocaleString()}</td>
                    <td class="svc-removed">-${s.removed.toLocaleString()}</td>
                    <td class="svc-score">${scoreBar}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="services-table-wrapper">
                <table class="services-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Service</th>
                            <th>Frequency</th>
                            <th>Avg/Wk</th>
                            <th>Added</th>
                            <th>Removed</th>
                            <th>Score</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="score-legend">
                <span class="score-legend-title">Activity Score:</span>
                <span>Frequency (60%) + IP Volume (20%) + Recent activity (20%)</span>
            </div>
        `;
    }
}
