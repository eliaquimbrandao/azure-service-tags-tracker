export class ServiceList {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.servicesContainer = null;
        this.servicesPage = 1;
    }

    async renderActiveServices() {
        // Store container reference or find it
        if (!this.servicesContainer) {
            const chartElement = document.getElementById('activeServicesChart');
            this.servicesContainer = chartElement ? chartElement.parentElement : null;
        }

        const container = this.servicesContainer;
        if (!container) {
            console.error('Services container not found');
            return;
        }

        // Load historical data to calculate true "activity" across ALL weeks
        this.dataManager.loadHistoricalActivity().then(historicalActivity => {
            // Build services list from ALL historical data, not just current week
            const allServices = Object.entries(historicalActivity)
                .map(([service, stats]) => {
                    // Calculate activity score combining:
                    // 1. Historical frequency (how many times this service changed across all weeks)
                    // 2. Total IP impact (cumulative IPs changed across all weeks)
                    const changeFrequency = stats.changeCount || 0;
                    const totalIPChange = stats.totalIPChange || 0;
                    const activityScore = (changeFrequency * 100) + (totalIPChange * 0.1);

                    return {
                        service,
                        change_count: changeFrequency,
                        ip_added: stats.totalIPsAdded || 0,
                        ip_removed: stats.totalIPsRemoved || 0,
                        net_ip_change: (stats.totalIPsAdded || 0) - (stats.totalIPsRemoved || 0),
                        historical_weeks: changeFrequency,
                        activity_score: activityScore
                    };
                })
                // Sort by activity score (highest = most active over time)
                .sort((a, b) => b.activity_score - a.activity_score);

            console.log(`Rendering ${allServices.length} services from historical data`);
            this.renderServicesList(container, allServices);
        }).catch(error => {
            console.error('Error loading historical activity:', error);
            
            // Fallback: use current week data only if historical loading fails
            const changes = this.dataManager.changesData?.changes || [];
            const serviceCounts = {};
            const serviceIPCounts = {};

            changes.forEach(change => {
                const serviceName = change.service;

                // Skip AzureCloud tags - they're infrastructure, not services
                if (serviceName.startsWith('AzureCloud')) {
                    return;
                }

                if (!serviceCounts[serviceName]) {
                    serviceCounts[serviceName] = 0;
                    serviceIPCounts[serviceName] = { added: 0, removed: 0 };
                }
                serviceCounts[serviceName]++;
                serviceIPCounts[serviceName].added += (change.added_count || 0);
                serviceIPCounts[serviceName].removed += (change.removed_count || 0);
            });

            const allServices = Object.keys(serviceCounts)
                .map(service => ({
                    service,
                    change_count: serviceCounts[service],
                    ip_added: serviceIPCounts[service].added,
                    ip_removed: serviceIPCounts[service].removed,
                    net_ip_change: serviceIPCounts[service].added - serviceIPCounts[service].removed
                }))
                .sort((a, b) => b.change_count - a.change_count);

            this.renderServicesList(container, allServices);
        });
    }

    renderServicesList(container, allServices) {
        if (allServices.length === 0) {
            // When no current data, show historical top services without "No Changes" header
            this.showTopHistoricalServices(container);
            return;
        }

        // Initialize pagination
        if (!this.servicesPage) {
            this.servicesPage = 1;
        }
        const itemsPerPage = 5;
        const totalPages = Math.ceil(allServices.length / itemsPerPage);
        const startIndex = (this.servicesPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const currentServices = allServices.slice(startIndex, endIndex);

        // Create a simple list instead of a chart
        const servicesHtml = currentServices.map((service, index) => {
            const actualRank = startIndex + index + 1;

            // Calculate total IPs changed (added + removed across all weeks)
            const totalIPsChanged = service.ip_added + service.ip_removed;

            // Show frequency with fire badge for visual emphasis and hover effect
            const activityBadge = `<span class="frequency-badge activity-fire">🔥 ${service.change_count} week${service.change_count !== 1 ? 's' : ''}</span>`;

            return `
                <div class="service-rank-item-static">
                    <div class="service-details">
                        <div class="service-name">
                            <span class="rank-number-inline">${actualRank}.</span> ${service.service}
                            ${activityBadge}
                        </div>
                        <div class="change-count">
                            ${totalIPsChanged.toLocaleString()} total IP changes across all updates
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Create pagination controls
        const paginationHtml = totalPages > 1 ? `
            <div class="pagination">
                <button class="pagination-btn" ${this.servicesPage === 1 ? 'disabled' : ''} onclick="dashboard.serviceList.changePage(${this.servicesPage - 1})">
                    ←
                </button>
                ${this.generatePageNumbers(this.servicesPage, totalPages)}
                <button class="pagination-btn" ${this.servicesPage === totalPages ? 'disabled' : ''} onclick="dashboard.serviceList.changePage(${this.servicesPage + 1})">
                    →
                </button>
            </div>
            <div class="pagination-info">
                Showing ${startIndex + 1}-${Math.min(endIndex, allServices.length)} of ${allServices.length} services
            </div>
        ` : '';

        container.innerHTML = `
            <h3>🏆 Most Active Services</h3>
            <div class="services-rank-list">
                ${servicesHtml}
            </div>
            ${paginationHtml}
        `;
    }

    generatePageNumbers(currentPage, totalPages) {
        let pages = [];
        const maxVisible = 4;

        if (totalPages <= maxVisible + 2) {
            // Show all pages if total is small
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            // Always show first page
            pages.push(1);

            // Calculate range around current page
            let start = Math.max(2, currentPage - 1);
            let end = Math.min(totalPages - 1, currentPage + 1);

            // Add ellipsis if needed
            if (start > 2) pages.push('...');

            // Add pages around current
            for (let i = start; i <= end; i++) {
                pages.push(i);
            }

            // Add ellipsis if needed
            if (end < totalPages - 1) pages.push('...');

            // Always show last page
            pages.push(totalPages);
        }

        return pages.map(page => {
            if (page === '...') return '<span class="pagination-ellipsis">...</span>';
            return `
                <button class="pagination-btn ${page === currentPage ? 'active' : ''}" 
                        onclick="dashboard.serviceList.changePage(${page})">
                    ${page}
                </button>
            `;
        }).join('');
    }

    async showTopHistoricalServices(container) {
        // Show top historically active services without "No Changes" messaging
        try {
            const historicalActivity = await this.dataManager.loadHistoricalActivity();
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
                            <span class="ip-details" style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem; display: block;">
                                ${item.totalIPChange.toLocaleString()} total IPs affected
                            </span>
                        </div>
                    </div>
                </div>
            `).join('');

            container.innerHTML = `
                <div class="analytics-card">
                    <h4>🏆 Most Active Services (All Time)</h4>
                    <div class="services-rank-list">
                        ${topServicesHtml}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error showing top historical services:', error);
            container.innerHTML = '<p class="error">Failed to load historical data</p>';
        }
    }

    changePage(page) {
        this.servicesPage = page;
        this.renderActiveServices();
    }
}
