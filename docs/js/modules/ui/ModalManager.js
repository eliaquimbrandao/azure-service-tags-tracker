export class ModalManager {
    constructor(regionMapper, changeRenderer) {
        this.regionMapper = regionMapper;
        this.changeRenderer = changeRenderer;
        this.currentModal = null;
        this.currentIPModal = null;
        this.currentRegionModal = null;
    }

    showChangesModal(title, changes, type) {
        const modal = document.createElement('div');
        modal.className = 'changes-modal-overlay';

        // Limit display for performance
        const displayLimit = 50;
        const displayChanges = changes.slice(0, displayLimit);

        const changesHtml = displayChanges.map(change => {
            return this.changeRenderer.renderChangeItemDetailed(change);
        }).join('');

        // Show search bar only for "All Changes This Week" card (type='all') or "Region Changes This Week" (type='region')
        // Don't show for specific region from search (type='region-specific') or individual service details (type='service')
        const showSearch = type === 'all' || type === 'region';

        modal.innerHTML = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>📊 ${title}</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    ${showSearch ? `
                    <div class="search-section">
                        <input type="text" 
                               id="changesSearch" 
                               placeholder="🔍 Search by service name, region, or IP address..." 
                               class="changes-search-input"
                               oninput="dashboard.modalManager.filterChanges(this.value)">
                        <div class="search-results-count" id="searchResultsCount" style="display: none;"></div>
                    </div>
                    ` : ''}
                    <div class="changes-list" id="changesList">
                        ${changesHtml}
                    </div>
                    ${changes.length > displayLimit ?
                `<div class="changes-footer">
                            <p><strong>Showing ${displayLimit} of ${changes.length.toLocaleString()} total changes</strong></p>
                            <a href="./data/changes/latest-changes.json" target="_blank" class="view-all-link">📄 View complete data file</a>
                        </div>` : ''
            }
                </div>
            </div>
        `;

        // Store data for filtering (only if search is enabled)
        if (showSearch) {
            modal.allChanges = changes;
            modal.displayLimit = displayLimit;
        }

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
        this.currentModal = modal;
    }

    filterChanges(searchTerm) {
        if (!this.currentModal || !this.currentModal.allChanges) return;

        const modal = this.currentModal;
        const allChanges = modal.allChanges;
        const displayLimit = modal.displayLimit;

        let filteredChanges = allChanges;

        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            filteredChanges = allChanges.filter(change => {
                // Search in service name
                if (change.service && change.service.toLowerCase().includes(searchLower)) return true;

                // Search in region
                const regionDisplay = this.regionMapper.getRegionDisplayName(change.region || '');
                if (regionDisplay.toLowerCase().includes(searchLower)) return true;

                // Search in IP addresses (for ip_changes)
                if (change.type === 'ip_changes' || change.change_type === 'ip_changes') {
                    const addedIPs = change.added_prefixes || change.added || [];
                    const removedIPs = change.removed_prefixes || change.removed || [];
                    const allIPs = [...addedIPs, ...removedIPs];

                    if (allIPs.some(ip => ip.toLowerCase().includes(searchLower))) return true;
                }

                return false;
            });
        }

        // Update the display
        const changesList = modal.querySelector('#changesList');
        const resultsCount = modal.querySelector('#searchResultsCount');

        const displayChanges = filteredChanges.slice(0, displayLimit);
        const changesHtml = displayChanges.map(change => {
            return this.changeRenderer.renderChangeItemDetailed(change);
        }).join('');

        changesList.innerHTML = changesHtml || '<div class="no-results">No changes found matching your search.</div>';
        resultsCount.style.display = 'block';
        resultsCount.textContent = `Showing ${Math.min(displayLimit, filteredChanges.length)} of ${filteredChanges.length.toLocaleString()} changes${searchTerm.trim() ? ` (filtered from ${allChanges.length.toLocaleString()})` : ''}`;
    }

    showIPChangesModal(title, ipChanges) {
        const modal = document.createElement('div');
        modal.className = 'changes-modal-overlay';

        // Group changes by region (collapse numbered variants)
        const changesByRegion = this.regionMapper.groupChangesByRegion(ipChanges);
        const regions = Object.keys(changesByRegion).sort((a, b) => changesByRegion[a].baseDisplay.localeCompare(changesByRegion[b].baseDisplay));

        // Generate regional navigation without default selection
        const regionNavHtml = regions.length > 1 ?
            `<div class="region-nav">
                <div class="region-nav-header">
                    <h4>Select a region to view IP changes:</h4>
                </div>
                <div class="region-buttons">
                    <button class="region-filter" onclick="dashboard.modalManager.filterIPChangesByRegion('all')">All Regions (${ipChanges.length})</button>
                    ${regions.map(regionKey => {
                const group = changesByRegion[regionKey];
                const displayName = this.regionMapper.formatRegionGroupLabel(group);
                const count = group.changes.length;
                return `<button class="region-filter" onclick="dashboard.modalManager.filterIPChangesByRegion('${regionKey}')">${displayName} (${count})</button>`;
            }).join('')}
                </div>
            </div>` : '';

        const statsHtml = this.generateIPChangeStats(ipChanges);

        // Don't render changes initially - wait for region selection
        const initialMessage = `<div class="region-selection-prompt">
            <div class="prompt-content">
                <h3>🌍 Choose a Region</h3>
                <p>Select a region above to view detailed IP changes for that area.</p>
                <div class="prompt-stats">
                    <span class="stat">📊 ${ipChanges.length} total changes</span>
                    <span class="stat">🌐 ${regions.length} regions affected</span>
                </div>
            </div>
        </div>`;

        modal.innerHTML = `
            <div class="changes-modal ip-changes-modal">
                <div class="changes-modal-header">
                    <h3>🔄 ${title}</h3>
                    <div class="changes-modal-stats">
                        ${statsHtml}
                    </div>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-body">
                    ${regionNavHtml}
                    <div id="ipChangesContainer" class="ip-changes-container">
                        ${initialMessage}
                    </div>
                </div>
            </div>
        `;

        // Store data for filtering
        modal.changesByRegion = changesByRegion;
        modal.allChanges = ipChanges;

        // Close modal when clicking overlay
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        };

        document.body.appendChild(modal);
        this.currentIPModal = modal;
    }

    filterIPChangesByRegion(regionKey) {
        if (!this.currentIPModal) return;

        const modal = this.currentIPModal;
        const container = modal.querySelector('#ipChangesContainer');
        const changesByRegion = modal.changesByRegion;
        const allChanges = modal.allChanges;

        let changesToShow = [];
        let regionName = '';

        if (regionKey === 'all') {
            changesToShow = allChanges;
            regionName = 'All Regions';
        } else {
            const group = changesByRegion[regionKey];
            if (group) {
                changesToShow = group.changes;
                regionName = this.regionMapper.formatRegionGroupLabel(group);
            }
        }

        // Update active button state
        const buttons = modal.querySelectorAll('.region-filter');
        buttons.forEach(btn => btn.classList.remove('active'));
        const clickedBtn = Array.from(buttons).find(btn =>
            btn.textContent.includes(regionKey === 'all' ? 'All Regions' : regionName.split(' (')[0])
        );
        if (clickedBtn) clickedBtn.classList.add('active');

        // Render changes
        const changesHtml = changesToShow.map(change => {
            return this.changeRenderer.renderChangeItemDetailed(change);
        }).join('');

        container.innerHTML = `
            <div class="region-changes-header">
                <h4>${regionName}</h4>
                <span class="change-count">${changesToShow.length} changes</span>
            </div>
            <div class="changes-list">
                ${changesHtml}
            </div>
        `;
    }

    showRegionChangesModal(title, ipChanges) {
        const modal = document.createElement('div');
        modal.className = 'changes-modal-overlay';

        // Group changes by region (collapse numbered variants)
        const changesByRegion = this.regionMapper.groupChangesByRegion(ipChanges);
        const regions = Object.keys(changesByRegion).sort((a, b) => changesByRegion[a].baseDisplay.localeCompare(changesByRegion[b].baseDisplay));

        // Calculate stats
        const totalRegions = regions.length;
        const totalChanges = ipChanges.length;

        modal.innerHTML = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <div>
                        <h3>🌍 ${title}</h3>
                        <div class="changes-modal-stats">
                            <span class="stat-item">🌍 ${totalRegions} regions affected</span>
                            <span class="stat-item">📊 ${totalChanges} total changes</span>
                        </div>
                    </div>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-content">
                    <div class="region-list">
                        <h4>Select a region to view services • Click or search below:</h4>
                        <div class="region-search">
                            <input type="text" id="regionSearchInput" placeholder="🔍 Search regions..." />
                        </div>
                        <div class="region-items">
                            ${regions.map(regionKey => {
            const group = changesByRegion[regionKey];
            const displayName = this.regionMapper.formatRegionGroupLabel(group);
            const count = group.changes.length;
            return `
                                    <div class="region-item" data-region="${regionKey}" data-display-name="${displayName.toLowerCase()}">
                                        <div class="region-name">${displayName}</div>
                                        <div class="region-count">${count} service${count !== 1 ? 's' : ''} changed</div>
                                    </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                    <div class="services-for-region" style="display: none;">
                        <div class="back-to-regions">
                            <button class="back-btn">← Back to Regions</button>
                        </div>
                        <div id="regionServicesContainer"></div>
                    </div>
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
        this.currentRegionModal = modal;

        // Add event listeners for region items
        const regionItems = modal.querySelectorAll('.region-item');
        regionItems.forEach(item => {
            item.addEventListener('click', () => {
                const regionKey = item.dataset.region;
                const regionGroup = changesByRegion[regionKey];
                const regionChanges = regionGroup.changes;
                const regionLabel = this.regionMapper.formatRegionGroupLabel(regionGroup);
                this.showServicesForRegion(regionLabel, regionChanges, modal);
            });
        });

        // Add back button listener
        const backBtn = modal.querySelector('.back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                modal.querySelector('.region-list').style.display = 'block';
                modal.querySelector('.services-for-region').style.display = 'none';
            });
        }

        // Add search functionality
        const searchInput = modal.querySelector('#regionSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const allRegionItems = modal.querySelectorAll('.region-item');

                allRegionItems.forEach(item => {
                    const displayName = item.dataset.displayName || '';
                    const region = item.dataset.region.toLowerCase();

                    if (displayName.includes(searchTerm) || region.includes(searchTerm)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }
    }

    showServicesForRegion(regionLabel, regionChanges, modal) {
        const displayName = regionLabel || 'Region';

        // Hide region list and show services
        modal.querySelector('.region-list').style.display = 'none';
        modal.querySelector('.services-for-region').style.display = 'block';

        // Render all services with full IP details using renderChangeItemDetailed
        const servicesHtml = regionChanges.map(change => {
            return this.changeRenderer.renderChangeItemDetailed(change);
        }).join('');

        const container = modal.querySelector('#regionServicesContainer');
        container.innerHTML = `
            <div class="region-services-header">
                <h4>Services that changed in ${displayName}</h4>
                <div class="services-stats">
                    <span class="stat">🔧 ${regionChanges.length} services affected</span>
                    <span class="stat">📊 ${regionChanges.length} total changes</span>
                </div>
            </div>
            <div class="changes-list">
                ${servicesHtml}
            </div>
        `;
    }

    generateIPChangeStats(changes) {
        let added = 0;
        let removed = 0;
        changes.forEach(c => {
            if (c.type === 'NewService') {
                added += (c.ip_count || 0);
            } else if (c.type === 'RemovedService') {
                removed += (c.ip_count || 0);
            } else {
                added += (c.added_count || 0);
                removed += (c.removed_count || 0);
            }
        });
        return `
            <span class="stat-item added">➕ ${added.toLocaleString()} IPs added</span>
            <span class="stat-item removed">➖ ${removed.toLocaleString()} IPs removed</span>
        `;
    }

    closeRegionModal() {
        if (this.currentModal) {
            document.body.removeChild(this.currentModal);
            this.currentModal = null;
        }
    }

    showCustomModal(htmlContent) {
        const modal = document.createElement('div');
        modal.className = 'changes-modal-overlay';
        modal.innerHTML = htmlContent;

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
        this.currentModal = modal;
    }

    showTimelineNavigationModal(formattedDate, changes) {
        const modal = document.createElement('div');
        modal.className = 'changes-modal-overlay';

        // Calculate statistics
        const serviceCount = new Set(changes.map(c => c.service)).size;
        const ipChanges = changes.filter(c => c.type === 'ip_changes');
        const regionCount = new Set(ipChanges.map(c => c.region || 'global')).size;
        const totalIPChanges = changes.reduce((sum, c) => {
            return sum + (c.added_count || 0) + (c.removed_count || 0) + (c.ip_count || 0);
        }, 0);
        const addedIPs = changes.reduce((sum, c) => {
            if (c.type === 'NewService') return sum + (c.ip_count || 0);
            return sum + (c.added_count || 0);
        }, 0);
        const removedIPs = changes.reduce((sum, c) => {
            if (c.type === 'RemovedService') return sum + (c.ip_count || 0);
            return sum + (c.removed_count || 0);
        }, 0);

        modal.innerHTML = `
            <div class="changes-modal">
                <div class="changes-modal-header">
                    <h3>📅 ${formattedDate}</h3>
                    <button onclick="this.closest('.changes-modal-overlay').remove()" class="close-modal-btn">&times;</button>
                </div>
                <div class="changes-modal-content">
                    <div class="timeline-navigation">
                        <h4>How would you like to browse these changes?</h4>
                        
                        <div class="timeline-nav-options">
                            <div class="timeline-nav-card" data-view="services">
                                <div class="nav-card-icon">🔧</div>
                                <div class="nav-card-content">
                                    <h5>Browse by Services</h5>
                                    <p>View changes organized by Azure service</p>
                                </div>
                                <div class="nav-card-arrow">→</div>
                            </div>

                            <div class="timeline-nav-card" data-view="regions">
                                <div class="nav-card-icon">🌍</div>
                                <div class="nav-card-content">
                                    <h5>Browse by Regions</h5>
                                    <p>View changes organized by geographic region</p>
                                </div>
                                <div class="nav-card-arrow">→</div>
                            </div>
                        </div>

                        <div class="timeline-summary-stats">
                            <div class="summary-stat-box">
                                <div class="summary-stat-number">${changes.length}</div>
                                <div class="summary-stat-label">Total Changes</div>
                            </div>
                            <div class="summary-stat-box">
                                <div class="summary-stat-number" style="color: var(--success-color);">${addedIPs}</div>
                                <div class="summary-stat-label">IPs Added</div>
                            </div>
                            <div class="summary-stat-box">
                                <div class="summary-stat-number" style="color: var(--danger-color);">${removedIPs}</div>
                                <div class="summary-stat-label">IPs Removed</div>
                            </div>
                        </div>
                    </div>

                    <div class="timeline-detail-view" style="display: none;">
                        <div class="back-to-navigation">
                            <button class="back-btn">← Back to Navigation</button>
                        </div>
                        <div id="timelineDetailContainer"></div>
                    </div>
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
        this.currentModal = modal;

        // Store data for navigation
        modal.timelineData = {
            formattedDate: formattedDate,
            changes: changes,
            ipChanges: ipChanges
        };

        // Add event listeners for navigation cards
        const navCards = modal.querySelectorAll('.timeline-nav-card');
        navCards.forEach(card => {
            card.addEventListener('click', () => {
                const view = card.dataset.view;
                if (view === 'services') {
                    this.showTimelineServiceView(modal, formattedDate, changes);
                } else if (view === 'regions') {
                    this.showTimelineRegionView(modal, formattedDate, ipChanges);
                }
            });
        });

        // Add back button listener
        const backBtn = modal.querySelector('.back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                modal.querySelector('.timeline-navigation').style.display = 'block';
                modal.querySelector('.timeline-detail-view').style.display = 'none';
            });
        }
    }

    showTimelineServiceView(modal, date, changes) {
        // Hide navigation and show services
        modal.querySelector('.timeline-navigation').style.display = 'none';
        modal.querySelector('.timeline-detail-view').style.display = 'block';

        // Sort changes alphabetically by service
        const sortedChanges = changes.sort((a, b) => a.service.localeCompare(b.service));

        // Render all services with full details
        const servicesHtml = sortedChanges.map(change => {
            return this.changeRenderer.renderChangeItemDetailed(change);
        }).join('');

        const container = modal.querySelector('#timelineDetailContainer');
        container.innerHTML = `
            <div class="region-services-header">
                <h4>🔧 All Services - ${date}</h4>
                <div class="search-section">
                    <input type="text" 
                           id="timelineServiceSearch" 
                           placeholder="🔍 Search by service name or IP..." 
                           class="changes-search-input">
                </div>
            </div>
            <div class="changes-list" id="timelineServicesList">
                ${servicesHtml}
            </div>
        `;

        // Add search functionality
        const searchInput = container.querySelector('#timelineServiceSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const changeItems = container.querySelectorAll('.change-item');

                changeItems.forEach(item => {
                    const text = item.textContent.toLowerCase();
                    if (text.includes(searchTerm)) {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }
    }

    showTimelineRegionView(modal, date, ipChanges) {
        // Hide navigation and show regions
        modal.querySelector('.timeline-navigation').style.display = 'none';
        modal.querySelector('.timeline-detail-view').style.display = 'block';

        // Group changes by region (collapse numbered variants)
        const changesByRegion = this.regionMapper.groupChangesByRegion(ipChanges);
        const regions = Object.keys(changesByRegion).sort((a, b) => changesByRegion[a].baseDisplay.localeCompare(changesByRegion[b].baseDisplay));

        const container = modal.querySelector('#timelineDetailContainer');
        container.innerHTML = `
            <div class="region-services-header">
                <h4>🌍 Browse by Region - ${date}</h4>
            </div>
            <div class="region-list-container">
                <div class="region-search">
                    <input type="text" id="timelineRegionSearch" placeholder="🔍 Search regions..." />
                </div>
                <div class="region-items">
                    ${regions.map(regionKey => {
            const group = changesByRegion[regionKey];
            const displayName = this.regionMapper.formatRegionGroupLabel(group);
            const count = group.changes.length;
            return `
                            <div class="region-item" data-region="${regionKey}" data-display-name="${displayName.toLowerCase()}">
                                <div class="region-name">${displayName}</div>
                                <div class="region-count">${count} service${count !== 1 ? 's' : ''} changed</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
            <div class="services-for-region-nested" style="display: none;">
                <div class="back-to-region-list">
                    <button class="back-btn-nested">← Back to Regions</button>
                </div>
                <div id="timelineRegionServicesContainer"></div>
            </div>
        `;

        // Add event listeners for region items
        const regionItems = container.querySelectorAll('.region-item');
        regionItems.forEach(item => {
            item.addEventListener('click', () => {
                const regionKey = item.dataset.region;
                const regionChanges = changesByRegion[regionKey].changes;
                const regionLabel = this.regionMapper.formatRegionGroupLabel(changesByRegion[regionKey]);
                this.showTimelineServicesForRegion(regionLabel, regionChanges, container, date);
            });
        });

        // Add back button for nested navigation
        const backBtnNested = container.querySelector('.back-btn-nested');
        if (backBtnNested) {
            backBtnNested.addEventListener('click', () => {
                container.querySelector('.region-list-container').style.display = 'block';
                container.querySelector('.services-for-region-nested').style.display = 'none';
            });
        }

        // Add search functionality
        const searchInput = container.querySelector('#timelineRegionSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const allRegionItems = container.querySelectorAll('.region-item');

                allRegionItems.forEach(item => {
                    const displayName = item.dataset.displayName || '';
                    const region = item.dataset.region.toLowerCase();

                    if (displayName.includes(searchTerm) || region.includes(searchTerm)) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }
    }

    showTimelineServicesForRegion(regionLabel, regionChanges, container, date) {
        const displayName = regionLabel || 'Region';

        // Hide region list and show services
        container.querySelector('.region-list-container').style.display = 'none';
        container.querySelector('.services-for-region-nested').style.display = 'block';

        // Render all services with full IP details
        const servicesHtml = regionChanges.map(change => {
            return this.changeRenderer.renderChangeItemDetailed(change);
        }).join('');

        const servicesContainer = container.querySelector('#timelineRegionServicesContainer');
        servicesContainer.innerHTML = `
            <div class="region-services-header">
                <h4>Services in ${displayName} - ${date}</h4>
                <div class="services-stats">
                    <span class="stat">🔧 ${regionChanges.length} services affected</span>
                </div>
            </div>
            <div class="changes-list">
                ${servicesHtml}
            </div>
        `;
    }
}
