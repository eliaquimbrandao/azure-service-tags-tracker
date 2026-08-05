export class ExportManager {
    constructor(timelineManager, regionMapper) {
        this.timelineManager = timelineManager;
        this.regionMapper = regionMapper;
        this.selectedWeeksForExport = [];
        this.weekSelectorCloseHandler = null;
        this.exportDropdownCloseHandler = null;
    }

    // Show export menu
    showExportMenu() {
        const menu = document.getElementById('exportMenu');
        if (menu) {
            menu.classList.toggle('hidden');
        }

        // Close menu when clicking outside
        document.addEventListener('click', function closeMenu(e) {
            if (!e.target.closest('.export-group')) {
                menu?.classList.add('hidden');
                document.removeEventListener('click', closeMenu);
            }
        });
    }

    // Week Selector Functions
    updateWeekSelectorState() {
        // Week selection is now allowed even with region filters
        const weekSelectorBtn = document.querySelector('[onclick*="toggleWeekSelector"]');
        
        if (weekSelectorBtn) {
            weekSelectorBtn.disabled = false;
            weekSelectorBtn.title = "";
            weekSelectorBtn.style.opacity = '1';
            weekSelectorBtn.style.cursor = 'pointer';
        }
        
        this.updateExportDropdownState();
    }

    toggleWeekSelector(event) {
        event.stopPropagation();
        const dropdown = document.getElementById('weekSelector');
        const button = event.currentTarget;

        // Populate week list if empty
        if (!dropdown.hasAttribute('data-populated')) {
            this.populateWeekSelector();
            dropdown.setAttribute('data-populated', 'true');
        }

        const isOpening = !dropdown.classList.contains('show');
        dropdown.classList.toggle('show');
        button.classList.toggle('active');

        // Close dropdown when clicking outside (but not inside the dropdown)
        if (isOpening) {
            // Remove any existing handler first
            if (this.weekSelectorCloseHandler) {
                document.removeEventListener('click', this.weekSelectorCloseHandler);
            }

            setTimeout(() => {
                this.weekSelectorCloseHandler = (e) => {
                    // Don't close if clicking inside the dropdown or button
                    if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                        dropdown.classList.remove('show');
                        button.classList.remove('active');
                        document.removeEventListener('click', this.weekSelectorCloseHandler);
                        this.weekSelectorCloseHandler = null;
                    }
                };
                document.addEventListener('click', this.weekSelectorCloseHandler);
            }, 0);
        } else {
            // Manually closing, remove the handler
            if (this.weekSelectorCloseHandler) {
                document.removeEventListener('click', this.weekSelectorCloseHandler);
                this.weekSelectorCloseHandler = null;
            }
        }
    }

    populateWeekSelector() {
        const listContainer = document.getElementById('weekCheckboxList');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        // Create checkbox for each week
        // Access filteredTimelineData from TimelineManager
        const data = this.timelineManager.filteredTimelineData || [];
        
        data.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'week-checkbox-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `week-${index}`;
            checkbox.value = item.date;
            checkbox.onchange = () => this.onWeekCheckboxChange();

            const label = document.createElement('label');
            label.className = 'week-checkbox-label';
            label.htmlFor = `week-${index}`;

            const dateSpan = document.createElement('span');
            dateSpan.className = 'week-date';
            dateSpan.textContent = item.date;

            const statsSpan = document.createElement('span');
            statsSpan.className = 'week-stats';
            statsSpan.innerHTML = `
                <span class="week-stats-badge"><strong>${item.changeCount}</strong> changes</span>
                <span class="week-stats-badge"><strong>${item.addedIPs}</strong> IPs added</span>
                <span class="week-stats-badge"><strong>${item.removedIPs}</strong> IPs removed</span>
            `;

            label.appendChild(dateSpan);
            label.appendChild(statsSpan);

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);
            listContainer.appendChild(itemDiv);
        });
    }

    onWeekCheckboxChange() {
        // Update selected weeks array (separate from compare mode)
        const checkboxes = document.querySelectorAll('#weekCheckboxList input[type="checkbox"]:checked');
        this.selectedWeeksForExport = Array.from(checkboxes).map(cb => cb.value);

        // Update button text
        const button = document.querySelector('[onclick*="toggleWeekSelector"]');
        if (button) {
            button.childNodes[0].textContent = `📅 Select Weeks (${this.selectedWeeksForExport.length}) `;
        }

        // Update export dropdown state
        this.updateExportDropdownState();
    }

    selectAllWeeks() {
        const checkboxes = document.querySelectorAll('#weekCheckboxList input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
        this.onWeekCheckboxChange();
    }

    clearAllWeeks() {
        const checkboxes = document.querySelectorAll('#weekCheckboxList input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        this.onWeekCheckboxChange();
    }

    closeWeekSelector() {
        const dropdown = document.getElementById('weekSelector');
        const button = document.querySelector('[onclick*="toggleWeekSelector"]');
        if (dropdown) dropdown.classList.remove('show');
        if (button) button.classList.remove('active');

        // Clean up the event listener
        if (this.weekSelectorCloseHandler) {
            document.removeEventListener('click', this.weekSelectorCloseHandler);
            this.weekSelectorCloseHandler = null;
        }
    }

    // Toggle export dropdown
    toggleExportDropdown(event) {
        event.stopPropagation();
        const dropdown = document.getElementById('exportDropdown');
        const button = event.currentTarget;

        // Update dropdown state based on active filters
        this.updateExportDropdownState();

        const isOpening = !dropdown.classList.contains('show');
        dropdown.classList.toggle('show');
        button.classList.toggle('active');

        // Close dropdown when clicking outside
        if (isOpening) {
            // Remove any existing handler first
            if (this.exportDropdownCloseHandler) {
                document.removeEventListener('click', this.exportDropdownCloseHandler);
            }

            setTimeout(() => {
                this.exportDropdownCloseHandler = (e) => {
                    // Don't close if clicking inside the dropdown or button
                    if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                        dropdown.classList.remove('show');
                        button.classList.remove('active');
                        document.removeEventListener('click', this.exportDropdownCloseHandler);
                        this.exportDropdownCloseHandler = null;
                    }
                };
                document.addEventListener('click', this.exportDropdownCloseHandler);
            }, 0);
        } else {
            // Manually closing, remove the handler
            if (this.exportDropdownCloseHandler) {
                document.removeEventListener('click', this.exportDropdownCloseHandler);
                this.exportDropdownCloseHandler = null;
            }
        }
    }

    // Update export dropdown based on active filters
    updateExportDropdownState() {
        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';
        const hasActiveFilters = searchTerm || regionFilter;
        const hasSelectedWeeks = this.selectedWeeksForExport && this.selectedWeeksForExport.length > 0;

        // Update Filtered JSON option
        const filteredOption = document.getElementById('exportFilteredOption');
        const filteredText = filteredOption?.querySelector('.dropdown-text strong');
        const filteredDescription = filteredOption?.querySelector('.dropdown-text small');

        if (filteredOption) {
            if (hasActiveFilters) {
                // Enable and update text
                filteredOption.disabled = false;
                filteredOption.style.opacity = '1';
                filteredOption.style.cursor = 'pointer';
                if (filteredText) {
                    filteredText.textContent = 'Export Filtered Data (JSON)';
                }
                if (filteredDescription) {
                    let desc = 'Export only what you see: ';
                    if (searchTerm && regionFilter) {
                        desc += `search "${searchTerm}" in ${this.getRegionGroupDisplay(regionFilter)}`;
                    } else if (searchTerm) {
                        desc += `search "${searchTerm}"`;
                    } else if (regionFilter) {
                        desc += `${this.getRegionGroupDisplay(regionFilter)} region`;
                    }
                    filteredDescription.textContent = desc;
                }
            } else {
                // Disable when no filters
                filteredOption.disabled = true;
                filteredOption.style.opacity = '0.5';
                filteredOption.style.cursor = 'not-allowed';
                if (filteredText) {
                    filteredText.textContent = 'Export Filtered Data (JSON)';
                }
                if (filteredDescription) {
                    filteredDescription.textContent = 'Apply a search or region filter first to use this option';
                }
            }
        }

        // Update CSV option (same requirements as filtered JSON)
        const csvOption = document.getElementById('exportCSVOption');
        const csvText = csvOption?.querySelector('.dropdown-text strong');
        const csvDescription = csvOption?.querySelector('.dropdown-text small');

        if (csvOption) {
            if (hasActiveFilters) {
                // Enable and update text
                csvOption.disabled = false;
                csvOption.style.opacity = '1';
                csvOption.style.cursor = 'pointer';
                if (csvDescription) {
                    let desc = 'Export detailed IP changes for: ';
                    if (searchTerm && regionFilter) {
                        desc += `search "${searchTerm}" in ${this.getRegionGroupDisplay(regionFilter)}`;
                    } else if (searchTerm) {
                        desc += `search "${searchTerm}"`;
                    } else if (regionFilter) {
                        desc += `${this.getRegionGroupDisplay(regionFilter)} region`;
                    }
                    csvDescription.textContent = desc;
                }
            } else {
                // Disable when no filters
                csvOption.disabled = true;
                csvOption.style.opacity = '0.5';
                csvOption.style.cursor = 'not-allowed';
                if (csvDescription) {
                    csvDescription.textContent = 'Apply a search or region filter first to use this option';
                }
            }
        }

        // Update Export Selected Weeks (JSON) option
        const selectedJSONOption = document.getElementById('exportSelectedJSON');
        const selectedJSONDescription = selectedJSONOption?.querySelector('.dropdown-text small');

        if (selectedJSONOption) {
            if (hasSelectedWeeks) {
                selectedJSONOption.disabled = false;
                selectedJSONOption.style.opacity = '1';
                selectedJSONOption.style.cursor = 'pointer';
                if (selectedJSONDescription) {
                    selectedJSONDescription.textContent = `Export complete data for ${this.selectedWeeksForExport.length} selected week${this.selectedWeeksForExport.length > 1 ? 's' : ''}`;
                }
            } else {
                selectedJSONOption.disabled = true;
                selectedJSONOption.style.opacity = '0.5';
                selectedJSONOption.style.cursor = 'not-allowed';
                if (selectedJSONDescription) {
                    selectedJSONDescription.textContent = 'Use "Select Weeks" to choose specific weeks first';
                }
            }
        }

        // Update Export Selected Weeks (CSV) option
        const selectedCSVOption = document.getElementById('exportSelectedCSV');
        const selectedCSVDescription = selectedCSVOption?.querySelector('.dropdown-text small');

        if (selectedCSVOption) {
            if (hasSelectedWeeks) {
                selectedCSVOption.disabled = false;
                selectedCSVOption.style.opacity = '1';
                selectedCSVOption.style.cursor = 'pointer';
                if (selectedCSVDescription) {
                    selectedCSVDescription.textContent = `Export detailed IP changes for ${this.selectedWeeksForExport.length} selected week${this.selectedWeeksForExport.length > 1 ? 's' : ''}`;
                }
            } else {
                selectedCSVOption.disabled = true;
                selectedCSVOption.style.opacity = '0.5';
                selectedCSVOption.style.cursor = 'not-allowed';
                if (selectedCSVDescription) {
                    selectedCSVDescription.textContent = 'Use "Select Weeks" to choose specific weeks first';
                }
            }
        }
    }

    closeExportDropdown() {
        const dropdown = document.getElementById('exportDropdown');
        const button = document.querySelector('.dropdown-toggle');
        if (dropdown) dropdown.classList.remove('show');
        if (button) button.classList.remove('active');
    }

    // Export filtered data (what user sees on screen)
    exportFilteredJSON() {
        this.closeExportDropdown();

        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';
        const filteredTimelineData = this.timelineManager.filteredTimelineData;

        // Prevent export if no filters are active
        if (!searchTerm && !regionFilter) {
            alert('⚠️ No filters applied!\n\nPlease use a search term or select a region filter first.\n\nTo export all data without filters, use "Export All Data (JSON)" instead.');
            return;
        }

        const dataToExport = {
            exported: new Date().toISOString(),
            filters: {
                search: searchTerm || null,
                region: regionFilter ? this.getRegionGroupDisplay(regionFilter) : null,
                dateRange: {
                    from: filteredTimelineData[filteredTimelineData.length - 1]?.date,
                    to: filteredTimelineData[0]?.date
                }
            },
            totalWeeks: filteredTimelineData.length,
            changes: []
        };

        // Process each week
        filteredTimelineData.forEach(item => {
            let matchedChanges = this.timelineManager.normalizeChangesForIP(item.changes);

            // Filter by region (base-key match using derived region code)
            if (regionFilter) {
                matchedChanges = matchedChanges.filter(change => {
                    const regionCode = this.regionMapper.deriveRegionCode(change);
                    return this.regionMapper.getBaseRegionKey(regionCode) === regionFilter;
                });
            }

            // Filter by search term
            if (searchTerm) {
                matchedChanges = matchedChanges.filter(change =>
                    (change.service && this.timelineManager.matchesSearchTerm(change.service, searchTerm)) ||
                    (change.region && this.timelineManager.matchesSearchTerm(change.region, searchTerm)) ||
                    (change.region && this.timelineManager.matchesSearchTerm(this.regionMapper.getRegionDisplayName(change.region), searchTerm))
                );
            }

            // Extract only the essential data
            matchedChanges.forEach(change => {
                const exportItem = {
                    date: item.date,
                    service: change.service,
                    region: change.region ? this.regionMapper.getRegionDisplayName(change.region) : null,
                    added: change.added_prefixes || [],
                    removed: change.removed_prefixes || []
                };

                // Only include if there are actual IP changes
                if (exportItem.added.length > 0 || exportItem.removed.length > 0) {
                    dataToExport.changes.push(exportItem);
                }
            });
        });

        dataToExport.totalChanges = dataToExport.changes.length;

        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const filterSuffix = regionFilter ? `-${regionFilter}` : (searchTerm ? '-filtered' : '-current-view');
        this.downloadFile(blob, `azure-service-tags-filtered${filterSuffix}-${this.getDateString()}.json`);
    }

    // Export selected weeks as JSON
    exportSelectedWeeksJSON() {
        this.closeExportDropdown();

        // Check if weeks are selected
        if (!this.selectedWeeksForExport || this.selectedWeeksForExport.length === 0) {
            alert('⚠️ No weeks selected!\n\nPlease use "Select Weeks" to choose specific weeks first.\n\nClick the "📅 Select Weeks" button and check the weeks you want to export.');
            return;
        }

        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';

        // Get data only for selected weeks
        const filteredTimelineData = this.timelineManager.filteredTimelineData;
        
        // Filter weeks and then filter changes within weeks if search or region filter is active
        const selectedData = filteredTimelineData
            .filter(item => this.selectedWeeksForExport.includes(item.date))
            .map(item => {
                // If no filters, return original item
                if (!searchTerm && !regionFilter) return item;

                // Filter changes
                let filteredChanges = (item.changes || []).filter(change => {
                    const regionCode = this.regionMapper.deriveRegionCode(change);
                    const regionName = regionCode ? this.regionMapper.getRegionDisplayName(regionCode) : '';
                    
                    // Check region filter
                    if (regionFilter) {
                        if (this.regionMapper.getBaseRegionKey(regionCode) !== regionFilter) {
                            return false;
                        }
                    }

                    // Check search term
                    if (searchTerm) {
                        const matchesSearch = (change.service && this.timelineManager.matchesSearchTerm(change.service, searchTerm)) ||
                                           (regionCode && this.timelineManager.matchesSearchTerm(regionCode, searchTerm)) ||
                                           (regionName && this.timelineManager.matchesSearchTerm(regionName, searchTerm));
                        if (!matchesSearch) return false;
                    }

                    return true;
                });

                // Normalize changes to ensure IPs are visible for all event types
                filteredChanges = this.timelineManager.normalizeChangesForIP(filteredChanges);

                // Return new item with filtered changes
                return {
                    ...item,
                    changes: filteredChanges,
                    changeCount: filteredChanges.length // Update count to reflect filtered data
                };
            });

        // Check if there are any changes to export
        const totalChanges = selectedData.reduce((sum, item) => sum + (item.changes ? item.changes.length : 0), 0);

        if (totalChanges === 0) {
            alert('⚠️ No changes found in selected weeks matching your filters!');
            return;
        }

        const dataToExport = {
            exported: new Date().toISOString(),
            description: "Selected Azure Service Tags change history",
            filters: {
                search: searchTerm || null,
                region: regionFilter ? this.getRegionGroupDisplay(regionFilter) : null
            },
            selectedWeeks: this.selectedWeeksForExport.length,
            totalWeeks: filteredTimelineData.length,
            dateRange: {
                from: selectedData[selectedData.length - 1]?.date,
                to: selectedData[0]?.date
            },
            data: selectedData
        };

        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const filterSuffix = (searchTerm || regionFilter) ? '-filtered' : '';
        this.downloadFile(blob, `azure-service-tags-selected-weeks${filterSuffix}-${this.getDateString()}.json`);
    }

    // Export selected weeks as CSV
    exportSelectedWeeksCSV() {
        this.closeExportDropdown();

        // Check if weeks are selected
        if (!this.selectedWeeksForExport || this.selectedWeeksForExport.length === 0) {
            alert('⚠️ No weeks selected!\n\nPlease use "Select Weeks" to choose specific weeks first.\n\nClick the "📅 Select Weeks" button and check the weeks you want to export.');
            return;
        }

        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';

        // CSV Header (include raw region code for clarity)
        let csv = 'Date,Service,Region,RegionCode,Change Type,IP Address/Prefix\n';

        let rowCount = 0;
        const maxRows = 50000;

        // Process only selected weeks
        const filteredTimelineData = this.timelineManager.filteredTimelineData;
        const selectedData = filteredTimelineData.filter(item =>
            this.selectedWeeksForExport.includes(item.date)
        );

        selectedData.forEach(item => {
            if (rowCount >= maxRows) return;

            let changes = item.changes || [];

            // Filter changes if search term or region filter is active
            if (searchTerm || regionFilter) {
                changes = changes.filter(change => {
                    const regionCode = this.regionMapper.deriveRegionCode(change);
                    const regionName = regionCode ? this.regionMapper.getRegionDisplayName(regionCode) : '';
                    
                    // Check region filter
                    if (regionFilter) {
                        if (this.regionMapper.getBaseRegionKey(regionCode) !== regionFilter) {
                            return false;
                        }
                    }

                    // Check search term
                    if (searchTerm) {
                        const matchesSearch = (change.service && this.timelineManager.matchesSearchTerm(change.service, searchTerm)) ||
                                           (regionCode && this.timelineManager.matchesSearchTerm(regionCode, searchTerm)) ||
                                           (regionName && this.timelineManager.matchesSearchTerm(regionName, searchTerm));
                        if (!matchesSearch) return false;
                    }

                    return true;
                });
            }

            // Normalize changes to ensure IPs are visible for all event types
            changes = this.timelineManager.normalizeChangesForIP(changes);

            // Export each IP change as a separate row
            changes.forEach(change => {
                if (rowCount >= maxRows) return;

                const regionCodeRaw = this.regionMapper.deriveRegionCode(change) || 'Global';
                const service = this.escapeCSV(change.service || 'N/A');
                const region = this.escapeCSV(regionCodeRaw ? this.regionMapper.getRegionDisplayName(regionCodeRaw) : 'Global');
                const regionCode = this.escapeCSV(regionCodeRaw);
                const date = item.date;

                // Added IPs
                if (change.added_prefixes && change.added_prefixes.length > 0) {
                    change.added_prefixes.forEach(ip => {
                        if (rowCount >= maxRows) return;
                        csv += `${date},${service},${region},${regionCode},Added,${this.escapeCSV(ip)}\n`;
                        rowCount++;
                    });
                }

                // Removed IPs
                if (change.removed_prefixes && change.removed_prefixes.length > 0) {
                    change.removed_prefixes.forEach(ip => {
                        if (rowCount >= maxRows) return;
                        csv += `${date},${service},${region},${regionCode},Removed,${this.escapeCSV(ip)}\n`;
                        rowCount++;
                    });
                }
            });
        });

        if (rowCount === 0) {
            alert('⚠️ No IP changes found in selected weeks!');
            return;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        this.downloadFile(blob, `azure-service-tags-selected-weeks-${this.getDateString()}.csv`);
    }

    // Legacy function for backwards compatibility
    exportAllJSON() {
        this.exportSelectedWeeksJSON();
    }

    // Legacy export function (keeping for backwards compatibility)
    exportAsJSON() {
        // Default to filtered export
        this.exportFilteredJSON();
    }

    // Export as CSV with detailed IP changes
    exportAsCSV() {
        this.closeExportDropdown();

        const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
        const regionFilter = document.getElementById('regionFilter')?.value || '';
        const filteredTimelineData = this.timelineManager.filteredTimelineData;

        // Prevent export if no filters are active
        if (!searchTerm && !regionFilter) {
            alert('⚠️ No filters applied!\n\nPlease use a search term or select a region filter first.\n\nThis ensures you export only the data you need.');
            return;
        }

        // CSV Header (include raw region code for clarity)
        let csv = 'Date,Service,Region,RegionCode,Change Type,IP Address/Prefix\n';

        let rowCount = 0;
        const maxRows = 50000; // Prevent massive files

        // Process each week
        filteredTimelineData.forEach(item => {
            if (rowCount >= maxRows) return;

            let matchedChanges = this.timelineManager.normalizeChangesForIP(item.changes);

            // Filter by region
            if (regionFilter) {
                matchedChanges = matchedChanges.filter(change => {
                    const regionCode = this.regionMapper.deriveRegionCode(change);
                    return this.regionMapper.getBaseRegionKey(regionCode) === regionFilter;
                });
            }

            // Filter by search term
            if (searchTerm) {
                matchedChanges = matchedChanges.filter(change => {
                    const regionCode = this.regionMapper.deriveRegionCode(change);
                    const regionName = regionCode ? this.regionMapper.getRegionDisplayName(regionCode) : '';
                    return (change.service && this.timelineManager.matchesSearchTerm(change.service, searchTerm)) ||
                        (regionCode && this.timelineManager.matchesSearchTerm(regionCode, searchTerm)) ||
                        (regionName && this.timelineManager.matchesSearchTerm(regionName, searchTerm));
                });
            }

            // Export each IP change as a separate row
            matchedChanges.forEach(change => {
                if (rowCount >= maxRows) return;

                const service = this.escapeCSV(change.service || 'N/A');
                const regionCodeRaw = this.regionMapper.deriveRegionCode(change) || 'Global';
                const region = this.escapeCSV(this.regionMapper.getRegionDisplayName(regionCodeRaw) || 'Global');
                const regionCode = this.escapeCSV(regionCodeRaw);
                const date = item.date;

                // Added IPs
                if (change.added_prefixes && change.added_prefixes.length > 0) {
                    change.added_prefixes.forEach(ip => {
                        if (rowCount >= maxRows) return;
                        csv += `${date},${service},${region},${regionCode},Added,${this.escapeCSV(ip)}\n`;
                        rowCount++;
                    });
                }

                // Removed IPs
                if (change.removed_prefixes && change.removed_prefixes.length > 0) {
                    change.removed_prefixes.forEach(ip => {
                        if (rowCount >= maxRows) return;
                        csv += `${date},${service},${region},${regionCode},Removed,${this.escapeCSV(ip)}\n`;
                        rowCount++;
                    });
                }
            });
        });

        if (rowCount === 0) {
            alert('⚠️ No data to export!\n\nThe current filters don\'t match any IP changes.');
            return;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const filterSuffix = regionFilter ? `-${regionFilter}` : (searchTerm ? '-filtered' : '');
        this.downloadFile(blob, `azure-service-tags-details${filterSuffix}-${this.getDateString()}.csv`);
    }

    // Helper to escape CSV fields
    escapeCSV(field) {
        if (field === null || field === undefined) return '';
        const str = String(field);
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    // Export summary
    exportSummary() {
        const filteredTimelineData = this.timelineManager.filteredTimelineData;
        const summary = {
            generated: new Date().toISOString(),
            totalWeeks: filteredTimelineData.length,
            totalChanges: filteredTimelineData.reduce((sum, item) => sum + item.changeCount, 0),
            totalIPChanges: filteredTimelineData.reduce((sum, item) => sum + item.totalIPChanges, 0),
            averageChangesPerWeek: (filteredTimelineData.reduce((sum, item) => sum + item.changeCount, 0) / filteredTimelineData.length).toFixed(2),
            dateRange: {
                from: filteredTimelineData[filteredTimelineData.length - 1]?.date,
                to: filteredTimelineData[0]?.date
            }
        };

        const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
        this.downloadFile(blob, `azure-service-tags-summary-${this.getDateString()}.json`);
    }

    // Download file helper
    downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Get date string for filename
    getDateString() {
        return new Date().toISOString().split('T')[0];
    }

    getRegionGroupDisplay(baseKey) {
        return this.timelineManager.getRegionGroupDisplay(baseKey);
    }
}
