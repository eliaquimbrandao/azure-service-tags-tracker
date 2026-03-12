export class RegionalAnalysis {
    constructor(regionMapper, modalManager, dataManager) {
        this.regionMapper = regionMapper;
        this.modalManager = modalManager;
        this.dataManager = dataManager;
        this.summaryData = null;
        this.changesData = null;
    }

    setSummaryData(data) {
        this.summaryData = data;
    }

    setChangesData(data) {
        this.changesData = data;
    }

    renderRegionalList() {
        const regionalContainer = document.getElementById('regionalChart').parentElement;
        const regionalData = this.summaryData?.regional_changes || {};

        if (Object.keys(regionalData).length === 0) {
            // Show helpful message when no regional changes
            regionalContainer.innerHTML = `
                <div class="no-changes-analytics">
                    <div class="no-changes-icon">🌍</div>
                    <h3>No Regional Changes This Week</h3>
                    <p>All Azure regional service tags remain stable.</p>
                    <div class="analytics-card">
                        <p><strong>🌐 Global Stability</strong></p>
                        <p>No geographic region experienced service tag updates this week. This indicates stable infrastructure across all Azure regions.</p>
                    </div>
                    <div class="analytics-tip">
                        💡 <strong>Tip:</strong> Historical regional trends will appear here as changes occur over time
                    </div>
                </div>
            `;
            return;
        }

        // Filter out Global region (empty string) and sort alphabetically
        const sortedRegions = Object.entries(regionalData)
            .filter(([region]) => region !== '') // Exclude Global (empty string)
            .sort(([a], [b]) => a.localeCompare(b)); // Sort alphabetically by region name

        // Filter to only show regions with more than 3 changes
        const significantRegions = sortedRegions.filter(([region, count]) => count > 3);

        if (significantRegions.length === 0) {
            regionalContainer.innerHTML = `
                <div class="no-changes-analytics">
                    <div class="no-changes-icon">🌍</div>
                    <h3>No Significant Regional Changes</h3>
                    <p>Only minor updates detected this week.</p>
                    <div class="analytics-card">
                        <p><strong>🔍 Minor Activity Detected</strong></p>
                        <p>While some regions had updates, none exceeded the threshold of 3+ service changes. This indicates routine maintenance rather than major infrastructure changes.</p>
                        <div style="margin-top: 1rem; padding: 0.75rem; background: var(--background-color); border-radius: 6px;">
                            <strong>Regions with minor changes:</strong>
                            <div style="margin-top: 0.5rem;">
                                ${sortedRegions.map(([region, count]) => {
                const displayName = this.regionMapper.getRegionDisplayName(region);
                return `<div style="padding: 0.25rem 0;">• ${displayName}: ${count} change${count !== 1 ? 's' : ''}</div>`;
            }).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        const regionsHtml = significantRegions.map(([region, count]) => {
            const displayName = this.regionMapper.getRegionDisplayName(region);
            // Calculate percentage relative to max changes
            const maxChanges = Math.max(...significantRegions.map(([, c]) => c));
            const percentage = (count / maxChanges) * 100;

            return `
                <div class="region-row" onclick="dashboard.regionalAnalysis.showRegionChanges('${region}', '${displayName}', ${count})">
                    <div class="region-info">
                        <span class="region-name">${displayName}</span>
                        <span class="region-count">${count} changes</span>
                    </div>
                    <div class="region-bar-container">
                        <div class="region-bar" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;
        }).join('');

        regionalContainer.innerHTML = `
            <h3>🌍 Regional Hotspots</h3>
            <div class="regions-list">
                ${regionsHtml}
            </div>
            <div class="region-help">
                💡 Showing geographic regions with more than 3 service changes (Global services excluded)
            </div>
        `;
    }

    showRegionChanges(region, displayName, changeCount) {
        const changes = this.changesData?.changes || [];
        const regionChanges = changes.filter(change =>
            (change.region || '') === region
        );

        console.log(`Region: ${region}, Display: ${displayName}`);
        console.log(`Found ${regionChanges.length} changes for this region`);
        console.log('Sample change:', regionChanges[0]);

        if (regionChanges.length === 0) {
            alert(`No detailed changes available for ${displayName}`);
            return;
        }

        // Use the same modal as "All Changes This Week" for consistency
        this.modalManager.showChangesModal(`🗺️ ${displayName} - Changes This Week`, regionChanges, 'region');
    }

    async showRegionalChangesModal(regionKey, regionDisplayName, totalChanges) {
        // Create and show modal with all changes for this region
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex'; // Ensure flex display for centering
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 900px;">
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                <div style="padding: 2rem;">
                    <h2 style="margin: 0 0 0.5rem 0; color: var(--primary-color);">🌍 ${regionDisplayName}</h2>
                    <p style="color: var(--text-muted); margin-bottom: 1.5rem; font-size: 0.95rem;">
                        Total change events: <strong style="color: var(--primary-color);">${totalChanges}</strong>
                    </p>
                    <div id="regional-changes-content" style="max-height: 500px; overflow-y: auto; padding-right: 0.5rem;">
                        <p style="text-align: center; padding: 3rem;">
                            <span style="font-size: 2.5rem;">⏳</span><br>
                            <span style="color: var(--text-muted); margin-top: 1rem; display: block;">Loading changes...</span>
                        </p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        });

        // Close modal with ESC key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Update close button to also remove event listener
        modal.querySelector('.close').addEventListener('click', () => {
            document.removeEventListener('keydown', escHandler);
        });

        // Load detailed changes for this region
        try {
            const manifestResponse = await this.dataManager.fetchWithCacheBust('data/changes/manifest.json');
            const manifest = await manifestResponse.json();

            // Exclude baseline (oldest date)
            const sortedFiles = [...manifest.files].sort((a, b) =>
                new Date(a.date) - new Date(b.date)
            );

            // Skip the first file (baseline)
            const filesToProcess = sortedFiles.length > 1 ? sortedFiles.slice(1) : [];

            const regionalChanges = [];

            for (const fileInfo of filesToProcess) {
                try {
                    const changeResponse = await this.dataManager.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                    const changeData = await changeResponse.json();

                    (changeData.changes || []).forEach(change => {
                        const changeRegion = (change.region || '').toLowerCase();
                        const matchKey = (regionKey || '').toLowerCase();
                        if (changeRegion === matchKey) {
                            const added = change.added_prefixes || [];
                            const removed = change.removed_prefixes || [];
                            regionalChanges.push({
                                date: fileInfo.date,
                                service: change.service,
                                addedCount: change.added_count || added.length,
                                removedCount: change.removed_count || removed.length,
                                addedIPs: added,
                                removedIPs: removed
                            });
                        }
                    });
                } catch (err) {
                    console.warn(`Failed to load changes from ${fileInfo.filename}`, err);
                }
            }

            // Render content
            const contentEl = modal.querySelector('#regional-changes-content');
            if (regionalChanges.length === 0) {
                contentEl.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        No detailed changes found for this region in recent history.
                    </div>
                `;
            } else {
                // Sort by date descending
                regionalChanges.sort((a, b) => new Date(b.date) - new Date(a.date));

                const pageSize = 50;
                let shown = pageSize;

                const renderItems = (items) => items.map(change => `
                    <div style="border-bottom: 1px solid var(--border-color); padding: 1rem 0;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                            <strong>${change.service}</strong>
                            <span style="color: var(--text-muted); font-size: 0.9rem;">${new Date(change.date).toLocaleDateString()}</span>
                        </div>
                        <div style="font-size: 0.9rem;">
                            ${change.addedCount > 0 ? `<span style="color: var(--success-color); margin-right: 1rem;">➕ ${change.addedCount} IPs added</span>` : ''}
                            ${change.removedCount > 0 ? `<span style="color: var(--danger-color);">➖ ${change.removedCount} IPs removed</span>` : ''}
                        </div>
                    </div>
                `).join('');

                const summaryHtml = `
                    <div style="display: flex; gap: 1.2rem; margin-bottom: 1rem; font-size: 0.9rem; color: var(--text-muted);">
                        <span>${regionalChanges.length} service changes found</span>
                    </div>
                `;

                contentEl.innerHTML = summaryHtml + renderItems(regionalChanges.slice(0, pageSize));

                if (regionalChanges.length > pageSize) {
                    const loadMoreBtn = document.createElement('button');
                    loadMoreBtn.style.cssText = 'display:block;margin:1rem auto;padding:0.5rem 1.5rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-color);color:var(--primary-color);cursor:pointer;font-size:0.9rem;';
                    loadMoreBtn.textContent = `Show more (${regionalChanges.length - shown} remaining)`;
                    contentEl.appendChild(loadMoreBtn);

                    loadMoreBtn.addEventListener('click', () => {
                        const next = regionalChanges.slice(shown, shown + pageSize);
                        shown += pageSize;
                        loadMoreBtn.remove();
                        contentEl.insertAdjacentHTML('beforeend', renderItems(next));
                        if (shown < regionalChanges.length) {
                            loadMoreBtn.textContent = `Show more (${regionalChanges.length - shown} remaining)`;
                            contentEl.appendChild(loadMoreBtn);
                        }
                    });
                }
            }

        } catch (error) {
            console.error('Error loading regional details:', error);
            const contentEl = modal.querySelector('#regional-changes-content');
            if (contentEl) {
                contentEl.innerHTML = `
                    <div style="color: var(--danger-color); text-align: center; padding: 2rem;">
                        Error loading details. Please try again later.
                    </div>
                `;
            }
        }
    }
}
