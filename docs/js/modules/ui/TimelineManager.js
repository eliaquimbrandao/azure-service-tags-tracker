export class TimelineManager {
    constructor(dataManager, regionMapper, changeRenderer, modalManager) {
        this.dataManager = dataManager;
        this.regionMapper = regionMapper;
        this.changeRenderer = changeRenderer;
        this.modalManager = modalManager;
        
        this.allTimelineData = [];
        this.filteredTimelineData = [];
        this.timelinePageSize = 10;
        this.timelineVisibleCount = 10;
        this.timelineRegionGroups = new Map();
        this.includeNewServiceIPs = true;
    }

    async renderChangeHistoryTimeline() {
        const timelineContainer = document.getElementById('changeHistoryTimeline');

        if (!timelineContainer) {
            console.error('changeHistoryTimeline container not found!');
            return;
        }

        // Show loading state
        timelineContainer.innerHTML = `
            <div class="timeline-loading">
                <div class="spinner"></div>
                <p>Loading change history...</p>
            </div>
        `;

        try {
            // Load the manifest file to get all historical changes
            const timestamp = new Date().getTime();
            const manifestResponse = await fetch(`./data/changes/manifest.json?t=${timestamp}`);

            if (!manifestResponse.ok) {
                throw new Error('Could not load change history manifest');
            }

            const manifest = await manifestResponse.json();
            const files = manifest.files || [];

            if (files.length === 0) {
                timelineContainer.innerHTML = `
                    <div class="timeline-empty">
                        <p>📅 No change history available yet</p>
                        <p>Change history will appear here as updates are detected</p>
                    </div>
                `;
                return;
            }

            // Filter out baseline (oldest date - it's just the initial snapshot)
            const oldestDate = manifest.date_range?.oldest;
            const changeFiles = files.filter(fileInfo => fileInfo.date !== oldestDate);

            if (changeFiles.length === 0) {
                timelineContainer.innerHTML = `
                    <div class="timeline-empty">
                        <p>📅 No change history available yet</p>
                        <p>Only baseline data exists. Change history will appear as updates are detected</p>
                    </div>
                `;
                return;
            }

            // Sort files by date (newest first)
            const sortedFiles = changeFiles.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Load summary data for each change file
            const timelineItems = await Promise.all(
                sortedFiles.map(file => this.loadTimelineItem(file))
            );

            // Store all timeline data for filtering
            this.allTimelineData = timelineItems;
            this.filteredTimelineData = timelineItems;

            // Reset pagination for initial render
            this.timelineVisibleCount = this.timelinePageSize;

            // Initialize filters with the data
            this.initializeHistoryFilters(timelineItems);

            // Render timeline with pagination applied
            this.renderFilteredTimeline();

        } catch (error) {
            console.error('Error loading change history:', error);
            timelineContainer.innerHTML = `
                <div class="timeline-error">
                    <p>⚠️ Unable to load change history</p>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }

    async loadTimelineItem(fileInfo) {
        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`./data/changes/${fileInfo.filename}?t=${timestamp}`);

            if (!response.ok) {
                throw new Error(`Could not load ${fileInfo.filename}`);
            }

            const data = await response.json();
            const changes = data.changes || [];
            const metadata = data.metadata || {};

            // Calculate statistics
            const serviceCount = new Set(changes.map(c => c.service)).size;
            const regionCount = new Set(changes.map(c => c.region || 'global')).size;
            const totalIPChanges = changes.reduce((sum, c) => {
                return sum + (c.added_count || 0) + (c.removed_count || 0);
            }, 0);
            const addedIPs = changes.reduce((sum, c) => sum + (c.added_count || 0), 0);
            const removedIPs = changes.reduce((sum, c) => sum + (c.removed_count || 0), 0);

            return {
                date: fileInfo.date,
                filename: fileInfo.filename,
                changeCount: changes.length,
                serviceCount,
                regionCount,
                totalIPChanges,
                addedIPs,
                removedIPs,
                hasChanges: changes.length > 0,
                changes: changes,
                metadata: metadata
            };
        } catch (error) {
            console.error(`Error loading timeline item ${fileInfo.filename}:`, error);
            return {
                date: fileInfo.date,
                filename: fileInfo.filename,
                error: true,
                errorMessage: error.message
            };
        }
    }

    initializeHistoryFilters(allData) {
        console.log('🔧 initializeHistoryFilters called with', allData.length, 'items');

        // Extract and group regions (merge numbered variants under one entry)
        const regionGroups = new Map();
        const dates = [];

        allData.forEach((item, index) => {
            // Collect dates for date range calculation
            if (item.date) {
                dates.push(new Date(item.date));
            }

            if (item.changes && Array.isArray(item.changes)) {
                item.changes.forEach(change => {
                    if (change.region && change.region.trim() !== '') {
                        const baseKey = this.regionMapper.getBaseRegionKey(change.region);
                        const displayName = this.regionMapper.getRegionDisplayName(change.region);
                        const baseDisplay = displayName.replace(/\s+\d+$/, '').trim() || displayName;

                        if (!regionGroups.has(baseKey)) {
                            regionGroups.set(baseKey, {
                                baseKey,
                                baseDisplay,
                                variants: new Set()
                            });
                        }

                        const group = regionGroups.get(baseKey);
                        group.variants.add(displayName);
                    }
                });
            }
        });

        // Enrich with known region mappings so numbered variants appear even if not in this subset
        Object.entries(this.regionMapper.regionDisplayMap || {}).forEach(([key, value]) => {
            const baseKey = this.regionMapper.getBaseRegionKey(key);
            const baseDisplay = value.replace(/\s+\d+$/, '').trim() || value;
            if (!regionGroups.has(baseKey)) {
                regionGroups.set(baseKey, {
                    baseKey,
                    baseDisplay,
                    variants: new Set()
                });
            }
            const group = regionGroups.get(baseKey);
            group.baseDisplay = baseDisplay; // ensure base comes from mapping
            group.variants.add(value);
        });

        // Persist for later display label lookups (exports, badges)
        this.timelineRegionGroups = regionGroups;

        // Populate region filter dropdown
        const regionFilter = document.getElementById('regionFilter');

        if (regionFilter) {
            // Clear existing options except "All Regions"
            regionFilter.innerHTML = '<option value="">All Regions</option>';

            if (regionGroups.size > 0) {
                // Sort grouped regions by display name for better UX
                const sortedRegions = Array.from(regionGroups.values()).sort((a, b) => {
                    return a.baseDisplay.localeCompare(b.baseDisplay);
                });

                sortedRegions.forEach((region, index) => {
                    const option = document.createElement('option');
                    option.value = region.baseKey;

                    const variants = Array.from(region.variants).sort();
                    const variantSuffix = variants.length > 1 ? ` – includes ${variants.join(', ')}` : '';
                    option.textContent = `${region.baseDisplay}${variantSuffix}`;
                    regionFilter.appendChild(option);
                });
            }
        }

        // Set up adaptive date range dropdown
        const dateRangeFilter = document.getElementById('dateRangeFilter');
        if (dateRangeFilter && dates.length > 0) {
            dates.sort((a, b) => a - b);
            const oldestDate = dates[0];
            const newestDate = dates[dates.length - 1];
            const daysDiff = Math.floor((newestDate - oldestDate) / (1000 * 60 * 60 * 24));

            // Clear existing options
            dateRangeFilter.innerHTML = '<option value="all">All Time</option>';

            // Generate dynamic options based on available data
            // Using standard time ranges for better UX (7 days, 14 days, 30 days, etc.)
            const ranges = [
                { days: 7, label: 'Last 7 Days' },
                { days: 14, label: 'Last 14 Days' },
                { days: 21, label: 'Last 21 Days' },
                { days: 30, label: 'Last 30 Days' },
                { days: 60, label: 'Last 2 Months' },
                { days: 90, label: 'Last 3 Months' },
                { days: 180, label: 'Last 6 Months' },
                { days: 365, label: 'Last 1 Year' }
            ];

            // Find the first range that covers the entire history
            // We want to show all smaller ranges, plus the first one that exceeds the history
            // This ensures there's always an option that shows "all changes" (besides All Time)
            let coveredHistory = false;

            ranges.forEach(range => {
                if (coveredHistory) return;

                const optionElement = document.createElement('option');
                optionElement.value = range.days;
                optionElement.textContent = range.label;
                dateRangeFilter.appendChild(optionElement);

                if (range.days >= daysDiff) {
                    coveredHistory = true;
                }
            });
        }
    }

    filterHistory() {
        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';
        const dateRangeFilter = document.getElementById('dateRangeFilter')?.value || 'all';

        // Calculate date range
        let dateThreshold = null;
        if (dateRangeFilter !== 'all') {
            const daysAgo = parseInt(dateRangeFilter);
            dateThreshold = new Date();
            dateThreshold.setDate(dateThreshold.getDate() - daysAgo);
        }

        // Filter the timeline data
        this.filteredTimelineData = this.allTimelineData.filter(item => {
            const itemDate = new Date(item.date);

            // Date range filter
            if (dateThreshold && itemDate < dateThreshold) {
                return false;
            }

            // Search filter - search across service names, regions, and dates
            if (searchTerm) {
                const dateStr = itemDate.toLocaleDateString().toLowerCase();
                const hasMatch = dateStr.includes(searchTerm) ||
                    (item.changes || []).some(change => {
                        const regionCode = this.regionMapper.deriveRegionCode(change);
                        const regionName = regionCode ? this.regionMapper.getRegionDisplayName(regionCode) : '';
                        return (change.service && this.matchesSearchTerm(change.service, searchTerm)) ||
                            (regionCode && this.matchesSearchTerm(regionCode, searchTerm)) ||
                            (regionName && this.matchesSearchTerm(regionName, searchTerm));
                    });
                if (!hasMatch) return false;
            }

            // Region filter (match on base region key so numbered variants collapse)
            if (regionFilter) {
                const hasRegion = (item.changes || []).some(change => {
                    const regionCode = this.regionMapper.deriveRegionCode(change);
                    return this.regionMapper.getBaseRegionKey(regionCode) === regionFilter;
                });
                if (!hasRegion) return false;
            }

            return true;
        });

        // Reset pagination logic
        // If a specific date range is selected, show all items in that range
        if (dateRangeFilter !== 'all') {
            this.timelineVisibleCount = this.filteredTimelineData.length;
        } else {
            // Otherwise use default pagination
            this.timelineVisibleCount = this.timelinePageSize;
        }

        this.renderFilteredTimeline();
    }

    renderFilteredTimeline() {
        const timelineContainer = document.getElementById('changeHistoryTimeline');
        if (!timelineContainer) return;

        if (this.filteredTimelineData.length === 0) {
            const loadMoreBtn = document.getElementById('loadMoreTimeline');
            if (loadMoreBtn) {
                loadMoreBtn.classList.add('hidden');
                loadMoreBtn.disabled = true;
                loadMoreBtn.textContent = 'Load More History';
            }

            const resultsCount = document.getElementById('resultsCount');
            if (resultsCount) {
                resultsCount.textContent = 'Showing 0 of 0 weeks';
            }

            timelineContainer.innerHTML = `
                <div class="timeline-empty">
                    <p>🔍 No results found</p>
                    <p>Try adjusting your filters or search terms</p>
                </div>
            `;
            return;
        }

        // Get current search and filter values
        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';

        // Determine visible slice
        const visibleCount = Math.min(this.timelineVisibleCount, this.filteredTimelineData.length);
        const visibleItems = this.filteredTimelineData.slice(0, visibleCount);

        // Render timeline items with optional highlighting
        const timelineHtml = visibleItems
            .map(item => {
                // If search or region filter is active, add matched details
                if (searchTerm || regionFilter) {
                    return this.renderTimelineItemWithDetails(item, searchTerm, regionFilter);
                } else {
                    return this.renderTimelineItem(item);
                }
            })
            .join('');
        timelineContainer.innerHTML = timelineHtml;

        // Update load more button
        const loadMoreBtn = document.getElementById('loadMoreTimeline');
        if (loadMoreBtn) {
            const total = this.filteredTimelineData.length;
            const remaining = total - visibleCount;

            // When there are more items to show
            if (remaining > 0) {
                loadMoreBtn.classList.remove('hidden');
                loadMoreBtn.disabled = false;
                loadMoreBtn.dataset.mode = 'more';
                loadMoreBtn.textContent = `Load More History (${remaining} more)`;
            } else if (total > this.timelinePageSize && visibleCount >= total) {
                // All items are visible but we allow collapsing back to latest page
                loadMoreBtn.classList.remove('hidden');
                loadMoreBtn.disabled = false;
                loadMoreBtn.dataset.mode = 'reset';
                loadMoreBtn.textContent = `Show Latest ${this.timelinePageSize}`;
            } else {
                loadMoreBtn.classList.add('hidden');
                loadMoreBtn.disabled = true;
                loadMoreBtn.dataset.mode = '';
                loadMoreBtn.textContent = 'Load More History';
            }
        }

        // Update results count
        const resultsCount = document.getElementById('resultsCount');
        if (resultsCount) {
            const total = this.allTimelineData.length;
            const filtered = this.filteredTimelineData.length;
            if (filtered === total) {
                resultsCount.textContent = `Showing first ${visibleCount} of ${filtered} weeks`;
            } else {
                resultsCount.textContent = `Showing first ${visibleCount} of ${filtered} filtered weeks (of ${total} total)`;
            }
        }
    }

    loadMoreTimeline() {
        if (!this.filteredTimelineData || this.filteredTimelineData.length === 0) return;
        const total = this.filteredTimelineData.length;
        const remaining = total - this.timelineVisibleCount;

        // If all items are showing, collapse back to the first page
        if (remaining <= 0 && total > this.timelinePageSize) {
            this.timelineVisibleCount = this.timelinePageSize;
        } else {
            // Otherwise reveal the next page of items
            this.timelineVisibleCount = Math.min(
                this.timelineVisibleCount + this.timelinePageSize,
                total
            );
        }

        this.renderFilteredTimeline();
    }

    renderTimelineItem(item) {
        if (item.error) {
            return `
                <div class="timeline-item no-changes">
                    <div class="timeline-header">
                        <div class="timeline-date">
                            <span class="date-icon">📅</span>
                            ${this.formatDate(item.date)}
                        </div>
                        <span class="timeline-badge no-changes-badge">Error</span>
                    </div>
                    <div class="timeline-details">
                        <p style="color: var(--danger-color);">⚠️ ${item.errorMessage}</p>
                    </div>
                </div>
            `;
        }

        if (!item.hasChanges) {
            return `
                <div class="timeline-item no-changes">
                    <div class="timeline-header">
                        <div class="timeline-date">
                            <span class="date-icon">📅</span>
                            ${this.formatDate(item.date)}
                        </div>
                        <span class="timeline-badge no-changes-badge">No Changes</span>
                    </div>
                    <div class="timeline-details">
                        <div class="timeline-detail-item">
                            <span>✨</span>
                            <span>No service tag updates detected</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // Format published date if available
        let publishedDateHtml = '';
        if (item.metadata && item.metadata.date_published) {
            const pubDate = new Date(item.metadata.date_published);
            const formattedPubDate = pubDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            publishedDateHtml = `<div class="timeline-published-date">📤 Published by Microsoft: ${formattedPubDate}</div>`;
        }

        return `
            <div class="timeline-item" data-date="${item.date}" onclick="dashboard.showTimelineDetails('${item.filename}', '${item.date}')">
                <div class="timeline-header">
                    <div class="timeline-date">
                        <span class="date-icon">📅</span>
                        <div>
                            ${this.formatDate(item.date)}
                            ${publishedDateHtml}
                        </div>
                    </div>
                    <span class="timeline-badge">${item.changeCount} Changes</span>
                </div>
                
                <div class="timeline-stats">
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number">${item.serviceCount}</span>
                        <span class="timeline-stat-label">Services</span>
                    </div>
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number">${item.regionCount}</span>
                        <span class="timeline-stat-label">Regions</span>
                    </div>
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number" style="color: var(--success-color);">${item.addedIPs}</span>
                        <span class="timeline-stat-label">Added IPs</span>
                    </div>
                    <div class="timeline-stat-box">
                        <span class="timeline-stat-number" style="color: var(--danger-color);">${item.removedIPs}</span>
                        <span class="timeline-stat-label">Removed IPs</span>
                    </div>
                </div>

                <div class="timeline-action-hint">
                    👆 Click to view detailed changes
                </div>
            </div>
        `;
    }

    renderTimelineItemWithDetails(item, searchTerm, regionFilter) {
        if (item.error || !item.hasChanges) {
            return this.renderTimelineItem(item);
        }

        // Find matching changes (IP-bearing only, including synthetic adds)
        let matchedChanges = this.normalizeChangesForIP(item.changes);
        if (regionFilter) {
            matchedChanges = matchedChanges.filter(change => {
                const regionCode = this.regionMapper.deriveRegionCode(change);
                return this.regionMapper.getBaseRegionKey(regionCode) === regionFilter;
            });
        }
        if (searchTerm) {
            matchedChanges = matchedChanges.filter(change => {
                const regionCode = this.regionMapper.deriveRegionCode(change);
                const regionName = regionCode ? this.regionMapper.getRegionDisplayName(regionCode) : '';
                return (change.service && this.matchesSearchTerm(change.service, searchTerm)) ||
                    (regionCode && this.matchesSearchTerm(regionCode, searchTerm)) ||
                    (regionName && this.matchesSearchTerm(regionName, searchTerm));
            });
        }

        // Count matched items by region/service
        const regionCounts = {};
        const serviceCounts = {};
        let totalMatchedAdded = 0;
        let totalMatchedRemoved = 0;

        matchedChanges.forEach(change => {
            if (change.region) {
                const regionName = this.regionMapper.getRegionDisplayName(change.region);
                regionCounts[regionName] = (regionCounts[regionName] || 0) + 1;
            }
            if (change.service) {
                serviceCounts[change.service] = (serviceCounts[change.service] || 0) + 1;
            }
            totalMatchedAdded += change.added_count || 0;
            totalMatchedRemoved += change.removed_count || 0;
        });

        // Format published date if available
        let publishedDateHtml = '';
        if (item.metadata && item.metadata.date_published) {
            const pubDate = new Date(item.metadata.date_published);
            const formattedPubDate = pubDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            publishedDateHtml = `<div class="timeline-published-date">📤 Published by Microsoft: ${formattedPubDate}</div>`;
        }

        // Build matched details HTML with full service list
        let matchedDetailsHtml = '';
        if (matchedChanges.length > 0) {
            // Build detailed service list with clickable items
            const servicesList = matchedChanges
                .sort((a, b) => (b.added_count + b.removed_count) - (a.added_count + a.removed_count))
                .map((change, index) => {
                    const addedBadge = change.added_count > 0 ?
                        `<span class="ip-badge added">+${change.added_count}</span>` : '';
                    const removedBadge = change.removed_count > 0 ?
                        `<span class="ip-badge removed">-${change.removed_count}</span>` : '';

                    // Create unique ID for this change item
                    const changeId = `change-${item.date}-${index}`;

                    // Build IP lists
                    const addedIPsList = (change.added_prefixes || []).map(ip =>
                        `<div class="ip-item">${ip}</div>`
                    ).join('');

                    const removedIPsList = (change.removed_prefixes || []).map(ip =>
                        `<div class="ip-item removed-ip">${ip}</div>`
                    ).join('');

                    // Create copy buttons that copy all IPs at once
                    const addedCopyBtn = change.added_prefixes && change.added_prefixes.length > 0 ?
                        `<button class="ip-copy-all-btn" onclick="event.stopPropagation(); navigator.clipboard.writeText('${change.added_prefixes.join('\\n')}'); this.textContent='✓ Copied!'; setTimeout(() => this.textContent='📋 Copy All Added', 1500)">📋 Copy All Added</button>` : '';

                    const removedCopyBtn = change.removed_prefixes && change.removed_prefixes.length > 0 ?
                        `<button class="ip-copy-all-btn removed" onclick="event.stopPropagation(); navigator.clipboard.writeText('${change.removed_prefixes.join('\\n')}'); this.textContent='✓ Copied!'; setTimeout(() => this.textContent='📋 Copy All Removed', 1500)">📋 Copy All Removed</button>` : '';

                    // Create combined copy button if both exist
                    let bothCopyBtn = '';
                    if (change.added_prefixes && change.added_prefixes.length > 0 && change.removed_prefixes && change.removed_prefixes.length > 0) {
                        const combinedText = "=== Added IPs ===\\n" + 
                                           change.added_prefixes.join('\\n') + 
                                           "\\n\\n=== Removed IPs ===\\n" + 
                                           change.removed_prefixes.join('\\n');
                        
                        bothCopyBtn = `
                            <div class="ip-section" style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px;">
                                <button class="ip-copy-all-btn" style="width: 100%" onclick="event.stopPropagation(); navigator.clipboard.writeText('${combinedText}'); this.textContent='✓ Copied!'; setTimeout(() => this.textContent='📋 Copy All Changed IPs (Added & Removed)', 1500)">📋 Copy All Changed IPs (Added & Removed)</button>
                            </div>`;
                    }

                    return `
                        <div class="matched-service-item" onclick="event.stopPropagation(); document.getElementById('${changeId}').classList.toggle('expanded')">
                            <div class="service-header">
                                <span class="service-name">🏷️ ${change.service}</span>
                                <span class="service-changes">${addedBadge} ${removedBadge}</span>
                            </div>
                            <div id="${changeId}" class="service-ip-details">
                                ${addedIPsList ? `
                                    <div class="ip-section">
                                        <div class="ip-section-header">
                                            <strong>Added IPs:</strong>
                                            ${addedCopyBtn}
                                        </div>
                                        <div class="ip-list">${addedIPsList}</div>
                                    </div>` : ''}
                                ${removedIPsList ? `
                                    <div class="ip-section">
                                        <div class="ip-section-header">
                                            <strong>Removed IPs:</strong>
                                            ${removedCopyBtn}
                                        </div>
                                        <div class="ip-list">${removedIPsList}</div>
                                    </div>` : ''}
                                ${bothCopyBtn}
                            </div>
                        </div>
                    `;
                })
                .join('');

            const regionName = regionFilter ? this.getRegionGroupDisplay(regionFilter) : 'matching your search';

            matchedDetailsHtml = `
                <div class="timeline-matched-details">
                    <div class="matched-summary">
                        <strong>🔍 ${matchedChanges.length} service${matchedChanges.length !== 1 ? 's' : ''} changed in ${regionName}</strong>
                        <span class="matched-ips">
                            <span style="color: var(--success-color);">+${totalMatchedAdded}</span> / 
                            <span style="color: var(--danger-color);">-${totalMatchedRemoved}</span> IPs
                        </span>
                    </div>
                    <div class="matched-services-list">
                        ${servicesList}
                    </div>
                </div>
            `;
        } else {
            matchedDetailsHtml = `
                <div class="timeline-matched-details">
                    <div class="matched-summary">
                        <strong>🔍 No IP changes match these filters</strong>
                    </div>
                </div>
            `;
        }

        return `
            <div class="timeline-item timeline-item-highlighted" data-date="${item.date}">
                <div class="timeline-header">
                    <div class="timeline-date">
                        <span class="date-icon">📅</span>
                        <div>
                            ${this.formatDate(item.date)}
                            ${publishedDateHtml}
                        </div>
                    </div>
                    <span class="timeline-badge">${matchedChanges.length} Matching Changes</span>
                </div>
                
                ${matchedDetailsHtml}
            </div>
        `;
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            const options = {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            };
            return date.toLocaleDateString('en-US', options);
        } catch (error) {
            return dateString;
        }
    }

    matchesSearchTerm(text, term) {
        if (!text || !term) return false;
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)`, 'i');
        return regex.test(text);
    }

    normalizeChangesForIP(changes) {
        return (changes || []).flatMap(change => {
            if (change.type === 'ip_changes') return [change];
            if (change.type === 'service_added' || change.type === 'NewService') {
                const synthetic = this.createSyntheticIPChange(change);
                return synthetic ? [synthetic] : [];
            }
            if (change.type === 'service_removed' || change.type === 'RemovedService') {
                const synthetic = this.createSyntheticIPChange(change);
                return synthetic ? [synthetic] : [];
            }
            return [];
        });
    }

    createSyntheticIPChange(change) {
        if (!this.includeNewServiceIPs) return null;
        
        // First check if prefixes are directly available on the change object (new format)
        let prefixes = change.prefixes;
        
        // Fallback to DataManager for older data if not present
        if (!prefixes) {
            const info = this.dataManager.getServiceInfo(change.service);
            if (info && info.prefixes && info.prefixes.length > 0) {
                prefixes = info.prefixes;
            }
        }

        if (!prefixes || prefixes.length === 0) return null;

        const regionCode = change.region || this.regionMapper.deriveRegionCode(change) || 'global';
        const isRemoval = change.type === 'service_removed' || change.type === 'RemovedService';
        
        return {
            ...change,
            type: 'ip_changes',
            added_prefixes: isRemoval ? [] : prefixes,
            removed_prefixes: isRemoval ? prefixes : [],
            added_count: isRemoval ? 0 : prefixes.length,
            removed_count: isRemoval ? prefixes.length : 0,
            region: regionCode,
            synthetic_new_service: true
        };
    }

    getRegionGroupDisplay(baseKey) {
        const group = this.timelineRegionGroups.get(baseKey);
        return group ? group.baseDisplay : baseKey;
    }

    resetFilters() {
        // Reset all filter inputs
        const historySearch = document.getElementById('historySearch');
        const regionFilter = document.getElementById('regionFilter');
        const dateRangeFilter = document.getElementById('dateRangeFilter');

        if (historySearch) historySearch.value = '';
        if (regionFilter) regionFilter.value = '';
        if (dateRangeFilter) dateRangeFilter.value = 'all';

        this.filterHistory();
    }

    async showTimelineDetails(filename, date) {
        try {
            // Load the specific change file
            const timestamp = new Date().getTime();
            const response = await fetch(`./data/changes/${filename}?t=${timestamp}`);

            if (!response.ok) {
                throw new Error('Could not load change details');
            }

            const data = await response.json();
            const changes = data.changes || [];

            if (changes.length === 0) {
                alert('No changes found for this date');
                return;
            }

            // Show navigation modal with Services/Regions options
            const formattedDate = this.formatDate(date);
            this.modalManager.showTimelineNavigationModal(formattedDate, changes);

        } catch (error) {
            console.error('Error loading timeline details:', error);
            alert('Unable to load change details. Please try again.');
        }
    }
}
