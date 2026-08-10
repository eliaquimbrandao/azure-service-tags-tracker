export class SearchManager {
    constructor(dataManager, regionMapper, changeRenderer, modalManager) {
        this.dataManager = dataManager;
        this.regionMapper = regionMapper;
        this.changeRenderer = changeRenderer;
        this.modalManager = modalManager;
        this.historicalSearchData = null;
        this.allChangesPromise = null;  // the change archive is fetched once per page load
        this.searchSeq = 0;             // guards against out-of-order async results
        this.activeIndex = -1;
    }

    clearSearchUI(searchResultsEl, searchClearEl) {
        if (searchClearEl) searchClearEl.classList.remove('visible');
        if (searchResultsEl) {
            searchResultsEl.innerHTML = '';
            searchResultsEl.classList.add('hidden');
        }
        this.historicalSearchData = null;
        this.activeIndex = -1;
        this.searchSeq++;  // any in-flight search is now stale
        this.syncQueryParam('');

        const searchInput = document.getElementById('globalSearch');
        if (searchInput) {
            searchInput.setAttribute('aria-expanded', 'false');
            searchInput.removeAttribute('aria-activedescendant');
        }
    }

    initializeGlobalSearch() {
        const searchInput = document.getElementById('globalSearch');
        const searchClear = document.getElementById('searchClear');
        const searchResults = document.getElementById('searchResults');

        if (!searchInput || !searchResults) return;

        searchResults.setAttribute('role', 'listbox');
        searchResults.setAttribute('aria-label', 'Search results');
        searchInput.setAttribute('role', 'combobox');
        searchInput.setAttribute('aria-controls', 'searchResults');
        searchInput.setAttribute('aria-autocomplete', 'list');
        searchInput.setAttribute('aria-expanded', 'false');

        let searchTimeout;

        // Handle search input
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();

            // Show/hide clear button
            if (query) {
                searchClear.classList.add('visible');
            } else {
                this.clearSearchUI(searchResults, searchClear);
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
            this.clearSearchUI(searchResults, searchClear);
            searchInput.focus();
        });

        // Arrow keys / Enter / Escape over the result list
        searchInput.addEventListener('keydown', (e) => {
            this.handleSearchKeydown(e, searchInput, searchResults, searchClear);
        });

        // "/" or Cmd/Ctrl-K jumps to search from anywhere on the page
        document.addEventListener('keydown', (e) => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
            const isSlash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey;
            const isCmdK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
            if (!isSlash && !isCmdK) return;
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        });

        // Deep link: ?q=... runs on load, so a search can be shared or bookmarked
        const initialQuery = (new URLSearchParams(window.location.search).get('q') || '').trim();
        if (initialQuery) {
            searchInput.value = initialQuery;
            searchClear.classList.add('visible');
            this.performGlobalSearch(initialQuery);
        }
    }

    handleSearchKeydown(e, searchInput, searchResults, searchClear) {
        // Queried live: "Show more" adds rows after the initial render
        const options = searchResults.classList.contains('hidden')
            ? []
            : Array.from(searchResults.querySelectorAll('.search-result-item'));

        if (e.key === 'Escape') {
            this.clearSearchUI(searchResults, searchClear);
            searchInput.blur();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (this.activeIndex >= 0 && options[this.activeIndex]) {
                options[this.activeIndex].click();
                return;
            }
            const query = searchInput.value.trim();
            if (query) this.performGlobalSearch(query);
            return;
        }

        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (options.length === 0) return;

        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(options.length - 1, this.activeIndex + delta));
        this.setActiveOption(options, next, searchInput);
    }

    setActiveOption(options, index, searchInput) {
        options.forEach(el => {
            el.classList.remove('active');
            el.setAttribute('role', 'option');  // rows from "Show more" arrive without it
            el.setAttribute('aria-selected', 'false');
        });

        this.activeIndex = index;
        const el = options[index];
        if (!el) {
            if (searchInput) searchInput.removeAttribute('aria-activedescendant');
            return;
        }

        if (!el.id) el.id = `search-opt-${index}`;
        el.classList.add('active');
        el.setAttribute('aria-selected', 'true');
        el.scrollIntoView({ block: 'nearest' });
        if (searchInput) searchInput.setAttribute('aria-activedescendant', el.id);
    }

    syncQueryParam(query) {
        if (!window.history?.replaceState) return;
        const url = new URL(window.location.href);
        if (query) {
            url.searchParams.set('q', query);
        } else {
            url.searchParams.delete('q');
        }
        // replaceState, not pushState — a debounced search must not spam history
        window.history.replaceState(null, '', url);
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str ?? '';
        return div.innerHTML;
    }

    normalizeKey(key, defaultValue = '') {
        if (!key) return defaultValue;
        return key.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    isIPAddressLike(input) {
        const value = input || '';
        // Needs a separator, so hex-ish words ("added", "cafe") don't qualify as IPv6
        return /[.:]/.test(value) && /^[0-9a-f.:/]+$/i.test(value);
    }

    /** Parse "1.2.3.4", "1.2.3.0/24" or "2603:1030::/64" into a comparable network. */
    parseCIDR(input) {
        if (!input) return null;
        const trimmed = String(input).trim();
        if (!trimmed) return null;

        const [addr, maskStr, extra] = trimmed.split('/');
        if (!addr || extra !== undefined) return null;

        const ctx = addr.includes(':') ? this.parseIPv6(addr)
            : addr.includes('.') ? this.parseIPv4(addr)
                : null;
        if (!ctx) return null;

        if (maskStr === undefined || maskStr === '') return { ...ctx, mask: ctx.maxBits };
        if (!/^\d{1,3}$/.test(maskStr)) return null;

        const mask = parseInt(maskStr, 10);
        if (mask > ctx.maxBits) return null;

        return { ...ctx, mask };
    }

    parseIPv4(ip) {
        // Strict digits per octet: parseInt would accept "116/30" and "4abc"
        const parts = ip.split('.');
        if (parts.length !== 4 || !parts.every(p => /^\d{1,3}$/.test(p))) return null;

        const octets = parts.map(Number);
        if (octets.some(o => o > 255)) return null;

        let value = 0n;
        octets.forEach(o => {
            value = (value << 8n) + BigInt(o);
        });

        return { version: 4, value, maxBits: 32 };
    }

    parseIPv6(ip) {
        // Expand shorthand (::) and pad to 8 hextets
        const parts = ip.split('::');
        if (parts.length > 2) return null;

        const head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
        const tail = parts[1] ? parts[1].split(':').filter(Boolean) : [];
        if (![...head, ...tail].every(h => /^[0-9a-f]{1,4}$/i.test(h))) return null;

        const missing = 8 - (head.length + tail.length);
        // "::" stands for at least one zero group; without it all 8 must be spelled out
        if (parts.length === 2 ? missing < 1 : missing !== 0) return null;

        const full = [...head, ...Array(missing).fill('0'), ...tail].map(h => parseInt(h, 16));

        let value = 0n;
        full.forEach(v => {
            value = (value << 16n) + BigInt(v);
        });

        return { version: 6, value, maxBits: 128 };
    }

    /** Two networks overlap iff they share a prefix at the shorter of the two masks. */
    rangesOverlap(a, b) {
        if (!a || !b || a.version !== b.version) return false;
        const shift = BigInt(a.maxBits - Math.min(a.mask, b.mask));
        return (a.value >> shift) === (b.value >> shift);
    }

    matchingPrefixesForIP(queryNet, prefixes = []) {
        if (!queryNet) return [];
        const wantsIPv6 = queryNet.version === 6;
        return (prefixes || []).filter(prefix => {
            // Cheap version pre-filter before the BigInt parse
            if (prefix.includes(':') !== wantsIPv6) return false;
            return this.rangesOverlap(queryNet, this.parseCIDR(prefix));
        });
    }

    /** Relevance for one field: exact > prefix > early substring. 0 means no match. */
    scoreText(text, ctx) {
        const value = (text || '').toLowerCase();
        if (!value) return 0;

        for (const needle of [ctx.queryLower, ctx.queryCompact]) {
            if (!needle) continue;
            if (value === needle) return 100;
            if (value.startsWith(needle)) return 80;
            const at = value.indexOf(needle);
            if (at > 0) return Math.max(30, 60 - at);
        }
        return 0;
    }

    /** Score a record, falling back to an all-words match over its combined text. */
    matchScore(ctx, primaryText, combinedText) {
        const direct = this.scoreText(primaryText, ctx);
        if (direct) return direct;
        if (ctx.isMultiWord && ctx.queryWords.every(w => combinedText.includes(w))) return 20;
        return 0;
    }

    isAdditiveChange(type) {
        if (!type) return false;
        const lower = String(type).toLowerCase();
        return lower.includes('added') || lower.includes('newservice');
    }

    isRemovalChange(type) {
        if (!type) return false;
        const lower = String(type).toLowerCase();
        return lower.includes('removed');
    }

    summarizeRangeHistory(rangeList, serviceKey, regionKey, events) {
        if (!rangeList || rangeList.length === 0 || !events || events.length === 0) return {};

        let addedOn = null;
        let lastEvent = null;
        let lastEventAction = null;

        const parseDate = (d) => this.dataManager.parseDateOnly(d) || new Date(d);

        rangeList.forEach(range => {
            const relevant = events.filter(evt => evt.serviceKey === serviceKey && evt.regionKey === regionKey && evt.matches.includes(range));
            if (relevant.length === 0) return;

            const addedEvents = relevant.filter(evt => evt.action === 'added');
            addedEvents.forEach(evt => {
                const eventDate = parseDate(evt.date);
                if (!addedOn || eventDate < parseDate(addedOn)) {
                    addedOn = evt.date;
                }
            });

            relevant.forEach(evt => {
                const eventDate = parseDate(evt.date);
                if (!lastEvent || eventDate > parseDate(lastEvent)) {
                    lastEvent = evt.date;
                    lastEventAction = evt.action;
                }
            });
        });

        return { addedOn, lastEvent, lastEventAction };
    }

    async performGlobalSearch(query) {
        const searchResults = document.getElementById('searchResults');
        const searchClear = document.getElementById('searchClear');

        // If query is empty after trimming, reset UI and stop.
        if (!query || !query.trim()) {
            this.clearSearchUI(searchResults, searchClear);
            return;
        }

        const seq = ++this.searchSeq;

        const queryLower = query.toLowerCase();
        const ctx = {
            queryLower,
            queryCompact: queryLower.replace(/\s+/g, ''),
            queryWords: queryLower.split(/\s+/).filter(w => w.length > 0)
        };
        ctx.isMultiWord = ctx.queryWords.length > 1;

        // A full address or CIDR gets range matching; anything else IP-ish is a substring scan
        const queryNet = this.parseCIDR(query);
        const isPotentialIP = !!queryNet || this.isIPAddressLike(query);

        this.syncQueryParam(query);

        // Show loading state
        searchResults.innerHTML = `
            <div class="search-loading" style="text-align: center; padding: 2rem;">
                <div class="spinner"></div>
                <p>Searching across current state and historical changes...</p>
            </div>
        `;
        searchResults.classList.remove('hidden');

        try {
            // Load all historical changes from manifest (cached after the first search)
            const allChanges = await this.loadAllHistoricalChanges();

            // A newer query started while we were awaiting — its results win.
            if (seq !== this.searchSeq) return;

            const ipHistoryEvents = [];

            const serviceMatches = new Map();
            const regionMatches = new Map();
            const ipMatches = new Map();

            // --- Historical Search ---
            allChanges.forEach(({ date, changes }) => {
                changes.forEach(change => {
                    // Service Search (normalize key to merge variants)
                    const serviceName = change.service || '';
                    const serviceKey = this.normalizeKey(serviceName, 'unknown');

                    // Multi-word: match all words against combined service+region text
                    const regionRaw = change.region || '';
                    const regionKey = this.normalizeKey(regionRaw, 'global');
                    const displayName = regionRaw ? this.regionMapper.getRegionDisplayName(regionRaw) : '\ud83c\udf10 Global';
                    const combinedText = `${serviceName} ${regionRaw} ${displayName}`.toLowerCase();

                    const serviceScore = this.matchScore(ctx, serviceName, combinedText);

                    if (serviceScore > 0) {
                        if (!serviceMatches.has(serviceKey)) {
                            serviceMatches.set(serviceKey, {
                                type: 'service',
                                name: serviceName,
                                key: serviceKey,
                                score: serviceScore,
                                occurrences: [],
                                totalChanges: 0,
                                totalIPAdded: 0,
                                totalIPRemoved: 0
                            });
                        }
                        const match = serviceMatches.get(serviceKey);
                        // Keep the prettiest name (first occurrence)
                        if (!match.name && serviceName) match.name = serviceName;
                        match.score = Math.max(match.score, serviceScore);

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
                    const regionScore = Math.max(
                        this.matchScore(ctx, regionRaw, combinedText),
                        this.scoreText(displayName, ctx)
                    );

                    if (regionScore > 0) {
                        if (!regionMatches.has(regionKey)) {
                            regionMatches.set(regionKey, {
                                type: 'region',
                                name: regionRaw,
                                key: regionKey,
                                score: regionScore,
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
                        match.score = Math.max(match.score, regionScore);
                        match.variants.add(displayName);
                        match.occurrences.push({
                            date: date,
                            change: change,
                            regionRaw
                        });
                        match.totalChanges++;
                    }

                    // IP Search (aggregate by service+region key)
                    if (!isPotentialIP) return;

                    const addedPrefixes = [...(change.added_prefixes || [])];
                    const removedPrefixes = [...(change.removed_prefixes || [])];

                    if (this.isAdditiveChange(change.type) && Array.isArray(change.prefixes)) {
                        addedPrefixes.push(...change.prefixes);
                    }
                    if (this.isRemovalChange(change.type) && Array.isArray(change.prefixes)) {
                        removedPrefixes.push(...change.prefixes);
                    }

                    const addedMatches = queryNet
                        ? this.matchingPrefixesForIP(queryNet, addedPrefixes)
                        : addedPrefixes.filter(prefix => prefix.includes(query));
                    const removedMatches = queryNet
                        ? this.matchingPrefixesForIP(queryNet, removedPrefixes)
                        : removedPrefixes.filter(prefix => prefix.includes(query));

                    const matchingPrefixes = [...addedMatches, ...removedMatches];
                    if (matchingPrefixes.length === 0) return;

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
                    const ipMatch = ipMatches.get(key);
                    ipMatch.occurrences.push({
                        date: date,
                        change: change,
                        matches: matchingPrefixes
                    });
                    ipMatch.totalMatches += matchingPrefixes.length;

                    if (!queryNet) return;

                    // "Added on / last changed" needs exact ranges, so only for real networks
                    [['added', addedMatches], ['removed', removedMatches]].forEach(([action, matches]) => {
                        if (matches.length === 0) return;
                        ipHistoryEvents.push({
                            date,
                            action,
                            matches,
                            change,
                            serviceKey: serviceKeyIP,
                            regionKey: regionKeyIP,
                            service: change.service,
                            region: change.region
                        });
                    });
                });
            });

            // --- Current State Search ---
            const currentMatches = {
                services: [],
                ips: []
            };

            const currentData = this.dataManager.currentData;
            if (currentData && currentData.values) {
                currentData.values.forEach(tag => {
                    const props = tag.properties || {};
                    const serviceName = props.systemService || tag.name || '';
                    const region = props.region || '';
                    const serviceKey = this.normalizeKey(serviceName, 'unknown');
                    const regionKey = this.normalizeKey(region, 'global');
                    const regionDisplay = this.regionMapper.getRegionDisplayName(region);
                    const combinedText = `${serviceName} ${region} ${regionDisplay} ${tag.name || ''}`.toLowerCase();

                    // Match service, tag name and region — a single-word region query
                    // like "eastus" used to miss every tag in that region.
                    const score = Math.max(
                        this.matchScore(ctx, serviceName, combinedText),
                        this.scoreText(tag.name, ctx),
                        this.scoreText(region, ctx),
                        this.scoreText(regionDisplay, ctx)
                    );

                    if (score > 0) {
                        currentMatches.services.push({
                            name: serviceName,
                            region: region,
                            score,
                            displayName: regionDisplay,
                            prefixCount: (props.addressPrefixes || []).length,
                            prefixes: props.addressPrefixes || []
                        });
                    }

                    // Search IPs in Current Data
                    if (isPotentialIP) {
                        const prefixes = props.addressPrefixes || [];
                        const matchingPrefixes = queryNet
                            ? this.matchingPrefixesForIP(queryNet, prefixes)
                            : prefixes.filter(prefix => prefix.includes(query));

                        if (matchingPrefixes.length > 0) {
                            const historyMeta = queryNet
                                ? this.summarizeRangeHistory(matchingPrefixes, serviceKey, regionKey, ipHistoryEvents)
                                : {};

                            currentMatches.ips.push({
                                service: serviceName,
                                region: region,
                                displayName: regionDisplay,
                                matches: matchingPrefixes,
                                addedOn: historyMeta.addedOn || null,
                                lastEvent: historyMeta.lastEvent || null,
                                lastEventAction: historyMeta.lastEventAction || null
                            });
                        }
                    }
                });
            }

            // Convert Maps to Arrays and sort occurrences by date desc
            const sortByDateDesc = (a, b) => (this.dataManager.parseDateOnly(b.date) || 0) - (this.dataManager.parseDateOnly(a.date) || 0);
            const latestDate = (item) => this.dataManager.parseDateOnly(item.occurrences[0]?.date) || 0;

            // Best score first, shorter name breaks ties — "Storage" outranks "StorageSyncService".
            // Paging shows 25 at a time, so the ordering is what makes page one useful.
            const byRelevance = (nameOf) => (a, b) =>
                (b.score - a.score) ||
                (nameOf(a).length - nameOf(b).length) ||
                nameOf(a).localeCompare(nameOf(b));

            const services = Array.from(serviceMatches.values()).map(item => {
                item.occurrences.sort(sortByDateDesc);
                return item;
            }).sort(byRelevance(item => item.name || ''));

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
                        existing.score = Math.max(existing.score, item.score);
                        (item.variants || new Set()).forEach(v => existing.variants.add(v));
                        if (!existing.displayName && item.displayName) existing.displayName = item.displayName;
                    }
                });
                return Array.from(consolidated.values()).map(item => {
                    item.occurrences.sort(sortByDateDesc);
                    return item;
                }).sort(byRelevance(item => item.displayName || item.name || ''));
            })();

            // IP hits have no name to score — most recent activity first
            const ips = Array.from(ipMatches.values()).map(item => {
                item.occurrences.sort(sortByDateDesc);
                return item;
            }).sort((a, b) => latestDate(b) - latestDate(a) || b.totalMatches - a.totalMatches);

            currentMatches.services.sort(byRelevance(item => item.name || ''));
            currentMatches.ips.sort((a, b) => b.matches.length - a.matches.length);

            // Display results
            this.displayHistoricalSearchResults(services, regions, ips, query, currentMatches);

        } catch (error) {
            if (seq !== this.searchSeq) return;
            console.error('Error searching historical data:', error);
            searchResults.innerHTML = `
                <div class="search-no-results">
                    <div class="search-no-results-icon">⚠️</div>
                    <div>Error searching historical data</div>
                    <div style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">
                        ${this.escapeHtml(error.message)}
                    </div>
                </div>
            `;
        }
    }

    loadAllHistoricalChanges() {
        // The archive can't change while the page is open, so fetch it once and reuse.
        // Previously every keystroke-triggered search re-downloaded ~5 MB, serially.
        if (!this.allChangesPromise) {
            this.allChangesPromise = this.fetchAllHistoricalChanges().catch(error => {
                this.allChangesPromise = null;  // let the next search retry
                throw error;
            });
        }
        return this.allChangesPromise;
    }

    async fetchAllHistoricalChanges() {
        // Load manifest to get all change files
        const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');

        if (!manifestResponse.ok) {
            throw new Error('Could not load change history manifest');
        }

        const manifest = await manifestResponse.json();

        // Filter out baseline/initial data files
        const oldestDate = manifest.date_range?.oldest;
        const changeFiles = (manifest.files || []).filter(fileInfo => fileInfo.date !== oldestDate);

        const loaded = await Promise.all(changeFiles.map(async (fileInfo) => {
            try {
                const response = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                if (!response.ok) return null;
                const data = await response.json();
                return {
                    date: fileInfo.date,
                    filename: fileInfo.filename,
                    changes: data.changes || []
                };
            } catch (error) {
                console.error(`Error loading ${fileInfo.filename}:`, error);
                return null;
            }
        }));

        return loaded.filter(Boolean);
    }

    displayHistoricalSearchResults(services, regions, ips, query, currentMatches = null) {
        const searchResults = document.getElementById('searchResults');

        const hasHistorical = services.length > 0 || regions.length > 0 || ips.length > 0;
        const hasCurrent = currentMatches && ((currentMatches.services && currentMatches.services.length > 0) || 
                                              (currentMatches.ips && currentMatches.ips.length > 0));

        if (!hasHistorical && !hasCurrent) {
            searchResults.innerHTML = `
                <div class="search-no-results">
                    <div class="search-no-results-icon">🔍</div>
                    <div>No results found for "<strong>${this.escapeHtml(query)}</strong>"</div>
                    <div style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">
                        Try searching for service names like "Storage", regions like "East US", or specific IP addresses (e.g., "13.68.")
                    </div>
                </div>
            `;
            searchResults.classList.remove('hidden');
            return;
        }

        // Store data for click handlers
        this.historicalSearchData = { services, regions, ips, currentMatches };

        // Categories render a page at a time: a broad query like "us" matches hundreds
        // of rows, and dumping them all into a 500px dropdown made it unusable.
        const sections = [];

        // --- Display Current State Results ---
        if (hasCurrent) {
            sections.push({ header: '<div class="search-results-header" style="color: var(--success-color);">✅ Found in Current State (Active):</div>' });

            // Active Services
            if (currentMatches.services && currentMatches.services.length > 0) {
                sections.push({
                    header: '<div class="search-category-header">🔧 Active Services</div>',
                    items: currentMatches.services,
                    render: (service, index) => {
                    const ipv4 = (service.prefixes || []).filter(ip => !ip.includes(':')).length;
                    const ipv6 = (service.prefixes || []).filter(ip => ip.includes(':')).length;
                    return `
                        <div class="search-result-item current" data-type="current-service" data-index="${index}">
                            <div class="search-result-info">
                                <div class="search-result-name">${this.escapeHtml(service.name)}</div>
                                <div class="search-result-meta">
                                    📍 Region: ${this.escapeHtml(service.displayName)}
                                    <br>
                                    <span style="color: var(--success-color);">+${service.prefixCount} IPs</span> • 
                                    <span style="color: var(--text-secondary);">-0 IPs</span> • 
                                    ${ipv4} IPv4 • ${ipv6} IPv6
                                </div>
                            </div>
                            <span class="search-result-badge service">Active</span>
                        </div>
                    `;
                    }
                });
            }

            // Active IPs
            if (currentMatches.ips && currentMatches.ips.length > 0) {
                sections.push({
                    header: '<div class="search-category-header">🔢 Active IP Addresses</div>',
                    items: currentMatches.ips,
                    render: (match, index) => `
                        <div class="search-result-item current" data-type="current-ip" data-index="${index}">
                            <div class="search-result-info">
                                <div class="search-result-name">${this.escapeHtml(match.service)} <span style="font-weight:normal; font-size:0.9em; color:var(--text-secondary);">(${this.escapeHtml(match.displayName)})</span></div>
                                <div class="search-result-meta">
                                    🎯 Contains IP in ${match.matches.length} active range${match.matches.length !== 1 ? 's' : ''}
                                    <br>
                                    <span class="search-preview-ip">${this.escapeHtml(match.matches.slice(0, 3).join(', ') + (match.matches.length > 3 ? '...' : ''))}</span>
                                    ${match.addedOn ? `<br>➕ Added ${this.formatDateShort(match.addedOn)}` : ''}
                                    ${match.lastEvent ? `<br>🕓 Last change ${this.formatDateShort(match.lastEvent)} (${this.escapeHtml(match.lastEventAction || 'updated')})` : ''}
                                </div>
                            </div>
                            <span class="search-result-badge ip">Active IP</span>
                        </div>
                    `
                });
            }

            if (hasHistorical) {
                sections.push({ header: '<hr style="margin: 1.5rem 0; border: 0; border-top: 1px solid var(--border-color);">' });
            }
        }

        // --- Display Historical Results ---
        if (hasHistorical) {
            sections.push({ header: '<div class="search-results-header">📜 Found in Historical Changes:</div>' });

            // Display region results
            if (regions.length > 0) {
                sections.push({
                    header: '<div class="search-category-header">🌍 Regions (History)</div>',
                    items: regions,
                    render: (region, index) => {
                    const occurrenceCount = region.occurrences.length;
                    const latestDate = region.occurrences[0]?.date;
                    const variants = Array.from(region.variants || []);
                    const variantText = variants.length > 1 ? `Includes: ${variants.join(', ')}` : '';

                    return `
                        <div class="search-result-item historical" data-type="region" data-index="${index}">
                            <div class="search-result-info">
                                <div class="search-result-name">${this.escapeHtml(region.displayName)}</div>
                                <div class="search-result-meta">
                                    📊 ${region.totalChanges} change${region.totalChanges !== 1 ? 's' : ''} across ${occurrenceCount} date${occurrenceCount !== 1 ? 's' : ''}
                                    • Latest: ${this.formatDateShort(latestDate)}
                                    ${variantText ? `<br><span class="search-variant">${this.escapeHtml(variantText)}</span>` : ''}
                                </div>
                            </div>
                            <span class="search-result-badge region">History</span>
                        </div>
                    `;
                    }
                });
            }

            // Display service results
            if (services.length > 0) {
                sections.push({
                    header: '<div class="search-category-header">🔧 Services (History)</div>',
                    items: services,
                    render: (service, index) => {
                    const occurrenceCount = service.occurrences.length;
                    const latestDate = service.occurrences[0]?.date;

                    return `
                        <div class="search-result-item historical" data-type="service" data-index="${index}">
                            <div class="search-result-info">
                                <div class="search-result-name">${this.escapeHtml(service.name)}</div>
                                <div class="search-result-meta">
                                    📊 ${service.totalChanges} change${service.totalChanges !== 1 ? 's' : ''} across ${occurrenceCount} date${occurrenceCount !== 1 ? 's' : ''}
                                    <br>
                                    <span style="color: var(--success-color);">+${service.totalIPAdded.toLocaleString()} IPs</span> • 
                                    <span style="color: var(--danger-color);">-${service.totalIPRemoved.toLocaleString()} IPs</span> • 
                                    Latest: ${this.formatDateShort(latestDate)}
                                </div>
                            </div>
                            <span class="search-result-badge service">History</span>
                        </div>
                    `;
                    }
                });
            }

            // Display IP results
            if (ips.length > 0) {
                sections.push({
                    header: '<div class="search-category-header">🔢 IP Addresses (History)</div>',
                    items: ips,
                    render: (ipMatch, index) => {
                    const latestDate = ipMatch.occurrences[0].date;
                    const occurrenceCount = ipMatch.occurrences.length;

                    return `
                        <div class="search-result-item historical" data-type="ip" data-index="${index}">
                            <div class="search-result-info">
                                <div class="search-result-name">${this.escapeHtml(ipMatch.service)} <span style="font-weight:normal; font-size:0.9em; color:var(--text-secondary);">(${this.escapeHtml(ipMatch.displayName)})</span></div>
                                <div class="search-result-meta">
                                    🎯 IP landed in ${ipMatch.totalMatches} historical change${ipMatch.totalMatches !== 1 ? 's' : ''}
                                    <br>
                                    Latest: ${this.formatDateShort(latestDate)}
                                </div>
                            </div>
                            <span class="search-result-badge ip">History</span>
                        </div>
                    `;
                    }
                });
            }
        }

        searchResults.innerHTML = sections
            .map((section, i) => section.items ? `${section.header}<div class="search-category-list" data-section="${i}"></div>` : section.header)
            .join('');
        searchResults.classList.remove('hidden');

        sections.forEach((section, i) => {
            if (!section.items) return;
            this.changeRenderer.renderPaged(
                searchResults.querySelector(`[data-section="${i}"]`),
                section.items,
                section.render,
                25
            );
        });

        // Reset keyboard selection; rows get ids lazily in setActiveOption so that
        // pages added later by "Show more" are navigable too.
        this.activeIndex = -1;
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', 'false');
        });

        const searchInput = document.getElementById('globalSearch');
        if (searchInput) {
            searchInput.setAttribute('aria-expanded', 'true');
            searchInput.removeAttribute('aria-activedescendant');
        }

        // Delegated so rows added by "Show more" stay clickable
        if (!searchResults.dataset.clickDelegated) {
            searchResults.dataset.clickDelegated = 'true';
            searchResults.addEventListener('click', (e) => {
                const item = e.target.closest('.search-result-item');
                if (!item || !searchResults.contains(item)) return;

                const type = item.getAttribute('data-type');
                const index = parseInt(item.getAttribute('data-index'));
                const data = this.historicalSearchData;

                if (type === 'service') {
                    const service = data.services[index];
                    this.showHistoricalServiceDetails(service.name, service.occurrences);
                } else if (type === 'region') {
                    const region = data.regions[index];
                    this.showHistoricalRegionDetails(region.name, region.occurrences);
                } else if (type === 'ip') {
                    this.showHistoricalIPDetails(data.ips[index]);
                } else if (type === 'current-service') {
                    this.showCurrentStateDetails(data.currentMatches.services[index]);
                } else if (type === 'current-ip') {
                    this.showCurrentStateDetails(data.currentMatches.ips[index]);
                }
            });
        }
    }

    showCurrentStateDetails(match) {
        const serviceName = match.name || match.service;
        const region = match.displayName;
        const uniqueId = `current-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const ipsToShow = match.matches || match.prefixes || [];
        const isIPSearch = !!match.matches;

        // Split into IPv4 and IPv6
        const ipv4List = ipsToShow.filter(ip => !ip.includes(':'));
        const ipv6List = ipsToShow.filter(ip => ip.includes(':'));

        // Build separate sections for IPv4 and IPv6
        let ipContentHtml = '';
        if (isIPSearch) {
            // IP search — show all matches together
            ipContentHtml = this.changeRenderer.renderIPList(
                ipsToShow, 'added', uniqueId, `IPs for ${serviceName}`
            );
        } else {
            if (ipv4List.length > 0) {
                ipContentHtml += this.changeRenderer.renderIPList(
                    ipv4List, 'ipv4', `${uniqueId}-v4`, `IPv4 ranges for ${serviceName}`
                );
            }
            if (ipv6List.length > 0) {
                ipContentHtml += this.changeRenderer.renderIPList(
                    ipv6List, 'ipv6', `${uniqueId}-v6`, `IPv6 ranges for ${serviceName}`
                );
            }
        }

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>✅ ${this.escapeHtml(serviceName)} (Current State)</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    <div class="historical-summary">
                        <div class="summary-stat-box">
                            <div class="summary-stat-number">${ipsToShow.length}</div>
                            <div class="summary-stat-label">IP Ranges</div>
                        </div>
                        <div class="summary-stat-box">
                            <div class="summary-stat-number" style="color: var(--success-color);">+${ipsToShow.length}</div>
                            <div class="summary-stat-label">Total IPs Active</div>
                        </div>
                        <div class="summary-stat-box">
                            <div class="summary-stat-number" style="color: var(--danger-color);">-0</div>
                            <div class="summary-stat-label">Total IPs Removed</div>
                        </div>
                    </div>
                    <div class="historical-events-list">
                        <div class="historical-event-item">
                            <div class="historical-event-header">
                                <span class="historical-event-date">📍 Region: ${this.escapeHtml(region)}</span>
                                <span style="color: var(--success-color); font-weight: 600;">Active</span>
                            </div>
                            ${ipContentHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.modalManager.showCustomModal(modalContent);
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

        const renderEvent = (event) => {
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
        };

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>🔧 ${this.escapeHtml(serviceName)} - Historical Changes</h3>
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
                    <div class="historical-events-list"></div>
                </div>
            </div>
        `;

        const modal = this.modalManager.showCustomModal(modalContent);
        this.changeRenderer.renderPaged(modal.querySelector('.historical-events-list'), events, renderEvent);
    }

    showHistoricalRegionDetails(regionName, occurrences) {
        const events = typeof occurrences === 'string' ? JSON.parse(occurrences) : occurrences;
        const displayName = regionName ? this.regionMapper.getRegionDisplayName(regionName) : '🌐 Global';

        const renderEvent = (event) => `
            <div class="historical-event-item">
                <div class="historical-event-header">
                    <span class="historical-event-date">📅 ${this.formatDate(event.date)}</span>
                </div>
                ${this.changeRenderer.renderChangeItemDetailed(event.change)}
            </div>
        `;

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>🌍 ${this.escapeHtml(displayName)} - Historical Changes</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    <div class="historical-summary">
                        <div class="summary-stat-box">
                            <div class="summary-stat-number">${events.length}</div>
                            <div class="summary-stat-label">Change Events</div>
                        </div>
                    </div>
                    <div class="historical-events-list"></div>
                </div>
            </div>
        `;

        const modal = this.modalManager.showCustomModal(modalContent);
        this.changeRenderer.renderPaged(modal.querySelector('.historical-events-list'), events, renderEvent);
    }

    showHistoricalIPDetails(ipMatch) {
        const renderEvent = (event) => {
            const change = event.change;
            const matches = event.matches;
            const uniqueId = `hist-ip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const collapseThreshold = 10;
            
            const renderIPList = (ips, type) => {
                if (!ips || ips.length === 0) return '';
                
                const renderIpItem = (ip) => {
                    const isMatch = matches.includes(ip);
                    const className = `ip-item ${type === 'added' ? 'added-ip' : 'removed-ip'} ${isMatch ? 'ip-match-highlight' : ''}`;
                    return `<div class="${className}">${this.escapeHtml(ip)}</div>`;
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
                                <strong>${this.escapeHtml(change.service)}</strong>
                                <span class="change-region">${this.escapeHtml(this.regionMapper.getRegionDisplayName(change.region))}</span>
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
        };

        const modalContent = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>🔢 IP Search Results: ${this.escapeHtml(ipMatch.service)}</h3>
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
                    <div class="historical-events-list"></div>
                </div>
            </div>
        `;

        const modal = this.modalManager.showCustomModal(modalContent);
        this.changeRenderer.renderPaged(modal.querySelector('.historical-events-list'), ipMatch.occurrences, renderEvent);
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
