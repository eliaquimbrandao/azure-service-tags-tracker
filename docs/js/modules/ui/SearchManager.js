export class SearchManager {
    constructor(dataManager, regionMapper, changeRenderer, modalManager) {
        this.dataManager = dataManager;
        this.regionMapper = regionMapper;
        this.changeRenderer = changeRenderer;
        this.modalManager = modalManager;
        this.historicalSearchData = null;
    }

    initializeGlobalSearch() {
        console.log('Initializing Global Search...');
        const searchInput = document.getElementById('globalSearch');
        const searchClear = document.getElementById('searchClear');
        const searchResults = document.getElementById('searchResults');

        if (!searchInput || !searchResults) return;

        let searchTimeout;

        // Handle search input
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();

            // Show/hide clear button
            if (query) {
                searchClear.classList.add('visible');
            } else {
                searchClear.classList.remove('visible');
                searchResults.classList.add('hidden');
                return;
            }

            // Debounce search
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.performGlobalSearch(query);
            }, 300);
        });

        // Handle clear button
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.classList.remove('visible');
            searchResults.classList.add('hidden');
            searchInput.focus();
        });

        // Handle Enter key
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    this.performGlobalSearch(query);
                }
            }
        });
    }

    normalizeKey(key, defaultValue = '') {
        if (!key) return defaultValue;
        return key.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    async performGlobalSearch(query) {
        console.log('Performing global search for:', query);
        const searchResults = document.getElementById('searchResults');
        const queryLower = query.toLowerCase();

        // Show loading state
        searchResults.innerHTML = `
            <div class="search-loading" style="text-align: center; padding: 2rem;">
                <div class="spinner"></div>
                <p>Searching across all historical changes...</p>
            </div>
        `;
        searchResults.classList.remove('hidden');

        try {
            // Load all historical changes from manifest
            const allChanges = await this.loadAllHistoricalChanges();

            const serviceMatches = new Map();
            const regionMatches = new Map();
            const ipMatches = new Map();

            allChanges.forEach(({ date, changes }) => {
                changes.forEach(change => {
                    // Service Search (normalize key to merge variants)
                    const serviceName = change.service || '';
                    const serviceKey = this.normalizeKey(serviceName, 'unknown');
                    if (serviceName.toLowerCase().includes(queryLower)) {
                        if (!serviceMatches.has(serviceKey)) {
                            serviceMatches.set(serviceKey, {
                                type: 'service',
                                name: serviceName,
                                key: serviceKey,
                                occurrences: [],
                                totalChanges: 0,
                                totalIPAdded: 0,
                                totalIPRemoved: 0
                            });
                        }
                        const match = serviceMatches.get(serviceKey);
                        // Keep the prettiest name (first occurrence)
                        if (!match.name && serviceName) match.name = serviceName;

                        // Calculate added/removed IPs based on change type
                        let added = 0;
                        let removed = 0;

                        if (change.type === 'ip_changes') {
                            added = change.added_count || 0;
                            removed = change.removed_count || 0;
                        } else if (change.type === 'service_added' || change.type === 'NewService') {
                            added = change.ip_count || (change.prefixes ? change.prefixes.length : 0);
                        } else if (change.type === 'service_removed' || change.type === 'RemovedService') {
                            removed = change.ip_count || 0;
                        }

                        match.occurrences.push({
                            date: date,
                            ipAdded: added,
                            ipRemoved: removed,
                            change: change
                        });
                        match.totalChanges++;
                        match.totalIPAdded += added;
                        match.totalIPRemoved += removed;
                    }

                    // Region Search (aggregate normalized regions)
                    const regionRaw = change.region || '';
                    const regionKey = this.normalizeKey(regionRaw, 'global');
                    const displayName = regionRaw ? this.regionMapper.getRegionDisplayName(regionRaw) : '🌐 Global';

                    if (regionRaw.toLowerCase().includes(queryLower) ||
                        displayName.toLowerCase().includes(queryLower)) {
                        if (!regionMatches.has(regionKey)) {
                            regionMatches.set(regionKey, {
                                type: 'region',
                                name: regionRaw,
                                key: regionKey,
                                displayName: displayName,
                                baseKey: this.regionMapper.getBaseRegionKey(regionRaw),
                                variants: new Set(),
                                occurrences: [],
                                totalChanges: 0
                            });
                        }
                        const match = regionMatches.get(regionKey);
                        // Keep canonical display name
                        if (!match.displayName && displayName) match.displayName = displayName;
                        match.variants.add(displayName);
                        match.occurrences.push({
                            date: date,
                            change: change,
                            regionRaw
                        });
                        match.totalChanges++;
                    }

                    // IP Search (aggregate by service+region key)
                    const isPotentialIP = /^[\d\.:/]+$/.test(query);
                    const dotCount = (query.match(/\./g) || []).length;
                    const hasEnoughSegments = dotCount >= 2;
                    
                    if (change.type === 'ip_changes' && isPotentialIP && (hasEnoughSegments || query.includes(':'))) {
                        const added = change.added_prefixes || [];
                        const removed = change.removed_prefixes || [];
                        const allPrefixes = [...added, ...removed];
                        
                        const matchingPrefixes = allPrefixes.filter(prefix => prefix.includes(query));
                        
                        if (matchingPrefixes.length > 0) {
                            const regionKeyIP = this.normalizeKey(change.region || '', 'global');
                            const serviceKeyIP = this.normalizeKey(change.service || '', 'unknown');
                            const key = `${serviceKeyIP}-${regionKeyIP}`;
                            if (!ipMatches.has(key)) {
                                ipMatches.set(key, {
                                    type: 'ip',
                                    service: change.service,
                                    region: change.region,
                                    displayName: this.regionMapper.getRegionDisplayName(change.region || ''),
                                    occurrences: [],
                                    totalMatches: 0
                                });
                            }
                            const match = ipMatches.get(key);
                            match.occurrences.push({
                                date: date,
                                change: change,
                                matches: matchingPrefixes
                            });
                            match.totalMatches += matchingPrefixes.length;
                        }
                    }
                });
            });

            // Convert Maps to Arrays and sort occurrences by date desc for accurate "Latest"
            const sortByDateDesc = (a, b) => (this.dataManager.parseDateOnly(b.date) || 0) - (this.dataManager.parseDateOnly(a.date) || 0);

            const services = Array.from(serviceMatches.values()).map(item => {
                item.occurrences.sort(sortByDateDesc);
                return item;
            });

            const regions = (() => {
                const consolidated = new Map();
                Array.from(regionMatches.values()).forEach(item => {
                    const baseKey = item.baseKey || this.regionMapper.getBaseRegionKey(item.name || '');
                    if (!consolidated.has(baseKey)) {
                        consolidated.set(baseKey, {
                            ...item,
                            baseKey,
                            occurrences: [...item.occurrences],
                            totalChanges: item.totalChanges || item.occurrences.length,
                            variants: new Set(item.variants || [])
                        });
                    } else {
                        const existing = consolidated.get(baseKey);
                        existing.occurrences.push(...item.occurrences);
                        existing.totalChanges += item.totalChanges || item.occurrences.length;
                        (item.variants || []).forEach ? item.variants.forEach(v => existing.variants.add(v)) : null;
                        if (!existing.displayName && item.displayName) existing.displayName = item.displayName;
                    }
                });
                return Array.from(consolidated.values()).map(item => {
                    item.occurrences.sort(sortByDateDesc);
                    return item;
                });
            })();

            const ips = Array.from(ipMatches.values()).map(item => {
                item.occurrences.sort(sortByDateDesc);
                return item;
            });

            // Display results
            this.displayHistoricalSearchResults(services, regions, ips, query);

        } catch (error) {
            console.error('Error searching historical data:', error);
            searchResults.innerHTML = `
                <div class="search-no-results">
                    <div class="search-no-results-icon">⚠️</div>
                    <div>Error searching historical data</div>
                    <div style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">
                        ${error.message}
                    </div>
                </div>
            `;
        }
    }

    async loadAllHistoricalChanges() {
        // Load manifest to get all change files
        const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');

        if (!manifestResponse.ok) {
            throw new Error('Could not load change history manifest');
        }

        const manifest = await manifestResponse.json();
        const files = manifest.files || [];

        if (files.length === 0) {
            return [];
        }

        // Filter out baseline/initial data files
        const changeFiles = files.filter(fileInfo => {
            const oldestDate = manifest.date_range?.oldest;
            return fileInfo.date !== oldestDate;
        });

        if (changeFiles.length === 0) {
            return [];
        }

        // Load all change files
        const allChanges = [];

        for (const fileInfo of changeFiles) {
            try {
                const response = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                if (response.ok) {
                    const data = await response.json();
                    allChanges.push({
                        date: fileInfo.date,
                        filename: fileInfo.filename,
                        changes: data.changes || []
                    });
                }
            } catch (error) {
                console.error(`Error loading ${fileInfo.filename}:`, error);
            }
        }

        return allChanges;
    }

    displayHistoricalSearchResults(services, regions, ips, query) {
        const searchResults = document.getElementById('searchResults');

        if (services.length === 0 && regions.length === 0 && ips.length === 0) {
            searchResults.innerHTML = `
                <div class="search-no-results">
                    <div class="search-no-results-icon">🔍</div>
                    <div>No results found for "<strong>${query}</strong>" in historical changes</div>
                    <div style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">
                        Try searching for service names like "Storage", "AzureAD", regions like "East US", or IP addresses
                    </div>
                </div>
            `;
            searchResults.classList.remove('hidden');
            return;
        }

        let html = '<div class="search-results-header">Found in historical changes:</div>';

        // Store data for click handlers
        this.historicalSearchData = { services, regions, ips };

        // Display region results
        if (regions.length > 0) {
            html += '<div class="search-category-header">🌍 Regions</div>';
            regions.forEach((region, index) => {
                const occurrenceCount = region.occurrences.length;
                const latestDate = region.occurrences[0]?.date;
                const variants = Array.from(region.variants || []);
                const variantText = variants.length > 1 ? `Includes: ${variants.join(', ')}` : '';

                html += `
                    <div class="search-result-item historical" data-type="region" data-index="${index}">
                        <div class="search-result-info">
                            <div class="search-result-name">${region.displayName}</div>
                            <div class="search-result-meta">
                                📊 ${region.totalChanges} change${region.totalChanges !== 1 ? 's' : ''} across ${occurrenceCount} date${occurrenceCount !== 1 ? 's' : ''}
                                • Latest: ${this.formatDateShort(latestDate)}
                                ${variantText ? `<br><span class="search-variant">${variantText}</span>` : ''}
                            </div>
                        </div>
                        <span class="search-result-badge region">Region</span>
                    </div>
                `;
            });
        }

        // Display service results
        if (services.length > 0) {
            html += '<div class="search-category-header">🔧 Services</div>';
            services.forEach((service, index) => {
                const occurrenceCount = service.occurrences.length;
                const latestDate = service.occurrences[0]?.date;

                html += `
                    <div class="search-result-item historical" data-type="service" data-index="${index}">
                        <div class="search-result-info">
                            <div class="search-result-name">${service.name}</div>
                            <div class="search-result-meta">
                                📊 ${service.totalChanges} change${service.totalChanges !== 1 ? 's' : ''} across ${occurrenceCount} date${occurrenceCount !== 1 ? 's' : ''}
                                <br>
                                <span style="color: var(--success-color);">+${service.totalIPAdded.toLocaleString()} IPs</span> • 
                                <span style="color: var(--danger-color);">-${service.totalIPRemoved.toLocaleString()} IPs</span> • 
                                Latest: ${this.formatDateShort(latestDate)}
                            </div>
                        </div>
                        <span class="search-result-badge service">Service</span>
                    </div>
                `;
            });
        }

        // Display IP results
        if (ips.length > 0) {
            html += '<div class="search-category-header">🔢 IP Addresses</div>';
            ips.forEach((ipMatch, index) => {
                const latestDate = ipMatch.occurrences[0].date;
                const occurrenceCount = ipMatch.occurrences.length;
                
                html += `
                    <div class="search-result-item historical" data-type="ip" data-index="${index}">
                        <div class="search-result-info">
                            <div class="search-result-name">${ipMatch.service} <span style="font-weight:normal; font-size:0.9em; color:var(--text-secondary);">(${ipMatch.displayName})</span></div>
                            <div class="search-result-meta">
                                🎯 Found "${query}" in ${ipMatch.totalMatches} IP range${ipMatch.totalMatches !== 1 ? 's' : ''}
                                <br>
                                Latest: ${this.formatDateShort(latestDate)}
                            </div>
                        </div>
                        <span class="search-result-badge ip">IP Range</span>
                    </div>
                `;
            });
        }

        searchResults.innerHTML = html;
        searchResults.classList.remove('hidden');

        // Add event listeners for historical results
        searchResults.querySelectorAll('.search-result-item.historical').forEach(item => {
            item.addEventListener('click', (e) => {
                const type = item.getAttribute('data-type');
                const index = parseInt(item.getAttribute('data-index'));

                if (type === 'service') {
                    const service = this.historicalSearchData.services[index];
                    this.showHistoricalServiceDetails(service.name, service.occurrences);
                } else if (type === 'region') {
                    const region = this.historicalSearchData.regions[index];
                    this.showHistoricalRegionDetails(region.name, region.occurrences);
                } else if (type === 'ip') {
                    const ipMatch = this.historicalSearchData.ips[index];
                    this.showHistoricalIPDetails(ipMatch);
                }
            });
        });
    }

    formatDateShort(dateString) {
        try {
            const date = new Date(dateString);
            const options = { month: 'short', day: 'numeric', year: 'numeric' };
            return date.toLocaleDateString('en-US', options);
        } catch (error) {
            return dateString;
        }
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            return dateString;
        }
    }

    showHistoricalServiceDetails(serviceName, occurrences) {
        const events = typeof occurrences === 'string' ? JSON.parse(occurrences) : occurrences;
        
        // Calculate totals from the change objects if not present on event
        const totalIPAdded = events.reduce((sum, e) => sum + ((e.change.added_prefixes || []).length), 0);
        const totalIPRemoved = events.reduce((sum, e) => sum + ((e.change.removed_prefixes || []).length), 0);

        const eventsHtml = events.map(event => {
            const change = event.change;
            const ipAdded = (change.added_prefixes || []).length;
            const ipRemoved = (change.removed_prefixes || []).length;
            
            return `
                <div class="historical-event-item">
                    <div class="historical-event-header">
                        <span class="historical-event-date">📅 ${this.formatDate(event.date)}</span>
                        <div class="historical-event-stats">
                            ${ipAdded > 0 ? `<span style="color: var(--success-color);">+${ipAdded} IPs</span>` : ''}
                            ${ipRemoved > 0 ? `<span style="color: var(--danger-color);">-${ipRemoved} IPs</span>` : ''}
                        </div>
                    </div>
                    ${this.changeRenderer.renderChangeItemDetailed(change)}
                </div>
            `;
        }).join('');

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>🔧 ${serviceName} - Historical Changes</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    <div class="historical-summary">
                        <div class="summary-stat-box">
                            <div class="summary-stat-number">${events.length}</div>
                            <div class="summary-stat-label">Change Events</div>
                        </div>
                        <div class="summary-stat-box">
                            <div class="summary-stat-number" style="color: var(--success-color);">+${totalIPAdded.toLocaleString()}</div>
                            <div class="summary-stat-label">Total IPs Added</div>
                        </div>
                        <div class="summary-stat-box">
                            <div class="summary-stat-number" style="color: var(--danger-color);">-${totalIPRemoved.toLocaleString()}</div>
                            <div class="summary-stat-label">Total IPs Removed</div>
                        </div>
                    </div>
                    <div class="historical-events-list">
                        ${eventsHtml}
                    </div>
                </div>
            </div>
        `;

        this.modalManager.showCustomModal(modalContent);
    }

    showHistoricalRegionDetails(regionName, occurrences) {
        const events = typeof occurrences === 'string' ? JSON.parse(occurrences) : occurrences;
        const displayName = regionName ? this.regionMapper.getRegionDisplayName(regionName) : '🌐 Global';

        const eventsHtml = events.map(event => {
            const change = event.change;
            return `
                <div class="historical-event-item">
                    <div class="historical-event-header">
                        <span class="historical-event-date">📅 ${this.formatDate(event.date)}</span>
                    </div>
                    ${this.changeRenderer.renderChangeItemDetailed(change)}
                </div>
            `;
        }).join('');

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>🌍 ${displayName} - Historical Changes</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    <div class="historical-summary">
                        <div class="summary-stat-box">
                            <div class="summary-stat-number">${events.length}</div>
                            <div class="summary-stat-label">Change Events</div>
                        </div>
                    </div>
                    <div class="historical-events-list">
                        ${eventsHtml}
                    </div>
                </div>
            </div>
        `;

        this.modalManager.showCustomModal(modalContent);
    }

    showHistoricalIPDetails(ipMatch) {
        const eventsHtml = ipMatch.occurrences.map(event => {
            const change = event.change;
            const matches = event.matches;
            const uniqueId = `hist-ip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const collapseThreshold = 10;
            
            const renderIPList = (ips, type) => {
                if (!ips || ips.length === 0) return '';
                
                const renderIpItem = (ip) => {
                    const isMatch = matches.includes(ip);
                    const className = `ip-item ${type === 'added' ? 'added-ip' : 'removed-ip'} ${isMatch ? 'ip-match-highlight' : ''}`;
                    return `<div class="${className}">${ip}</div>`;
                };

                const visibleIPs = ips.slice(0, collapseThreshold);
                const hiddenIPs = ips.slice(collapseThreshold);
                
                return `
                    <div class="ip-list-section">
                        <div class="ip-section-title">
                            <strong>${type === 'added' ? 'Added' : 'Removed'} IPs:</strong>
                        </div>
                        <div class="ip-list-styled">
                            ${visibleIPs.map(renderIpItem).join('')}
                            ${hiddenIPs.length > 0 ? `
                                <div class="ip-hidden" id="${type}-${uniqueId}" style="display:none;">
                                    ${hiddenIPs.map(renderIpItem).join('')}
                                </div>
                                <button class="show-more-btn" onclick="dashboard.changeRenderer.constructor.toggleIPs('${type}-${uniqueId}', this)">
                                    ➕ Show ${hiddenIPs.length} more
                                </button>
                            ` : ''}
                        </div>
                        <div class="ip-copy-actions">
                            <button class="copy-btn-small copy-ips-btn" data-ips="${this.changeRenderer.escapeForDataAttr(JSON.stringify(ips))}" data-label="${type} IPs for ${this.changeRenderer.escapeForDataAttr(change.service)}">
                                📋 Copy All ${type === 'added' ? 'Added' : 'Removed'}
                            </button>
                        </div>
                    </div>
                `;
            };

            const addedHtml = renderIPList(change.added_prefixes || [], 'added');
            const removedHtml = renderIPList(change.removed_prefixes || [], 'removed');

            return `
                <div class="historical-event-item">
                    <div class="historical-event-header">
                        <span class="historical-event-date">📅 ${this.formatDate(event.date)}</span>
                    </div>
                    <div class="change-item detailed ip-changes">
                        <div class="change-header">
                            <div class="change-service">
                                <strong>${change.service}</strong>
                                <span class="change-region">${this.regionMapper.getRegionDisplayName(change.region)}</span>
                            </div>
                            <div class="change-type-badge">IP Changes</div>
                        </div>
                        <div class="change-details">
                            <div class="change-summary">
                                ${(change.added_prefixes || []).length > 0 ? `<span class="change-stat added">➕ ${(change.added_prefixes || []).length} IPs added</span>` : ''}
                                ${(change.removed_prefixes || []).length > 0 ? `<span class="change-stat removed">➖ ${(change.removed_prefixes || []).length} IPs removed</span>` : ''}
                            </div>
                            ${addedHtml}
                            ${removedHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>🔢 IP Search Results: ${ipMatch.service}</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    <div class="historical-summary">
                        <div class="summary-stat-box">
                            <div class="summary-stat-number">${ipMatch.occurrences.length}</div>
                            <div class="summary-stat-label">Events Found</div>
                        </div>
                        <div class="summary-stat-box">
                            <div class="summary-stat-number">${ipMatch.totalMatches}</div>
                            <div class="summary-stat-label">Matching Ranges</div>
                        </div>
                    </div>
                    <div class="historical-events-list">
                        ${eventsHtml}
                    </div>
                </div>
            </div>
        `;

        this.modalManager.showCustomModal(modalContent);
    }

    showRegionDetailsFromSearch(regionName, changesData) {
        const changes = changesData.changes || [];
        const baseKey = this.regionMapper.getBaseRegionKey(regionName);
        const grouped = this.regionMapper.groupChangesByRegion(changes);
        const targetGroup = grouped[baseKey];
        const regionChanges = targetGroup ? targetGroup.changes : changes.filter(change => this.regionMapper.getBaseRegionKey(change.region) === baseKey);

        if (regionChanges.length > 0) {
            const displayName = targetGroup ? this.regionMapper.formatRegionGroupLabel(targetGroup) : this.regionMapper.getRegionDisplayName(regionName);
            this.modalManager.showChangesModal(`🗺️ ${displayName} - Changes This Week`, regionChanges, 'region-specific');
        }

        // Clear search
        const searchInput = document.getElementById('globalSearch');
        const searchClear = document.getElementById('searchClear');
        const searchResults = document.getElementById('searchResults');

        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.classList.remove('visible');
        if (searchResults) searchResults.classList.add('hidden');
    }

    searchExample(query) {
        const searchInput = document.getElementById('globalSearch');
        if (searchInput) {
            searchInput.value = query;
            searchInput.focus();
            this.performGlobalSearch(query);
            document.getElementById('searchClear').classList.add('visible');
        }
    }
}
