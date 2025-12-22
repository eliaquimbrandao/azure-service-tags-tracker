export class DataManager {
    constructor() {
        this.currentData = null;
        this.summaryData = null;
        this.changesData = null;
        this.servicePrefixLookup = {};
        this.cacheBust = Date.now();
    }

    fetchWithCacheBust(url) {
        const separator = url.includes('?') ? '&' : '?';
        return fetch(`${url}${separator}t=${this.cacheBust}`);
    }

    /**
     * Parse a YYYY-MM-DD string without shifting days across time zones.
     * Anchors at noon UTC so local offsets do not roll the calendar backward/forward.
     */
    parseDateOnly(dateString) {
        if (!dateString) return null;

        const parts = dateString.split('-').map(Number);
        if (parts.length === 3 && parts.every(n => !Number.isNaN(n))) {
            const [year, month, day] = parts;
            return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        }

        const parsed = Date.parse(dateString);
        return Number.isNaN(parsed) ? null : new Date(parsed);
    }

    async loadAllData() {
        const timestamp = this.cacheBust;
        
        const [currentResponse, summaryResponse, changesResponse] = await Promise.all([
            fetch(`./data/current.json?t=${timestamp}`),
            fetch(`./data/summary.json?t=${timestamp}`),
            fetch(`./data/changes/latest-changes.json?t=${timestamp}`)
        ]);

        if (!currentResponse.ok || !summaryResponse.ok) {
            throw new Error('Failed to load required data files');
        }

        this.currentData = await currentResponse.json();
        this.summaryData = await summaryResponse.json();
        
        if (changesResponse.ok) {
            this.changesData = await changesResponse.json();
        } else {
            this.changesData = { changes: [], total_changes: 0 };
        }

        this.buildServicePrefixLookup();

        return {
            currentData: this.currentData,
            summaryData: this.summaryData,
            changesData: this.changesData
        };
    }

    buildServicePrefixLookup() {
        this.servicePrefixLookup = {};
        const values = this.currentData?.values || [];
        values.forEach(entry => {
            const name = entry?.name || entry?.id;
            const prefixes = entry?.properties?.addressPrefixes || [];
            const region = entry?.properties?.region || '';
            if (name && prefixes.length) {
                this.servicePrefixLookup[name.toLowerCase()] = { prefixes, region };
            }
        });
    }

    getServiceInfo(serviceName) {
        if (!serviceName) return null;
        return this.servicePrefixLookup?.[serviceName.toLowerCase()] || null;
    }

    async loadHistoricalActivity() {
        // Load all historical change files to calculate frequency
        const historicalActivity = {};

        try {
            // Load manifest to get list of all change files
            const manifestResponse = await this.fetchWithCacheBust('data/changes/manifest.json');
            if (!manifestResponse.ok) {
                console.log('Manifest not found, falling back to known files');
                // Fallback to known files if manifest doesn't exist
                return this.loadHistoricalActivityFallback();
            }

            const manifest = await manifestResponse.json();

            // Filter out baseline/initial data files (oldest date)
            const oldestDate = manifest.date_range?.oldest;
            const changeFiles = manifest.files.filter(fileInfo => fileInfo.date !== oldestDate);

            console.log(`Loading ${changeFiles.length} actual change files (excluding baseline)...`);

            // Load each historical change file (excluding baseline)
            for (const fileInfo of changeFiles) {
                try {
                    const response = await this.fetchWithCacheBust(`data/changes/${fileInfo.filename}`);
                    if (response.ok) {
                        const data = await response.json();

                        // Count IP changes per service (total magnitude of changes)
                        (data.changes || []).forEach(change => {
                            if (change.service) {
                                const serviceName = change.service;

                                // Skip AzureCloud tags - they're infrastructure, not services
                                if (serviceName.startsWith('AzureCloud')) {
                                    return;
                                }

                                if (!historicalActivity[serviceName]) {
                                    historicalActivity[serviceName] = {
                                        changeCount: 0,
                                        totalIPsAdded: 0,
                                        totalIPsRemoved: 0,
                                        totalIPChange: 0
                                    };
                                }

                                // Track all metrics
                                historicalActivity[serviceName].changeCount++;
                                historicalActivity[serviceName].totalIPsAdded += (change.added_count || 0);
                                historicalActivity[serviceName].totalIPsRemoved += (change.removed_count || 0);
                                historicalActivity[serviceName].totalIPChange += (change.added_count || 0) + (change.removed_count || 0);
                            }
                        });

                        console.log(`Loaded ${fileInfo.filename}: ${data.changes?.length || 0} changes`);
                    }
                } catch (err) {
                    console.log(`Could not load ${fileInfo.filename}:`, err.message);
                }
            }

            const totalServices = Object.keys(historicalActivity).length;
            console.log(`Historical analysis complete: ${totalServices} services tracked`);

            return historicalActivity;
        } catch (error) {
            console.error('Error in loadHistoricalActivity:', error);
            return this.loadHistoricalActivityFallback();
        }
    }

    async loadHistoricalActivityFallback() {
        // Fallback method when manifest is not available
        const historicalActivity = {};
        const changeFiles = ['2025-10-08-changes.json', '2025-10-10-changes.json'];

        console.log('Using fallback method to load historical data');

        for (const fileName of changeFiles) {
            try {
                const response = await fetch(`data/changes/${fileName}`);
                if (response.ok) {
                    const data = await response.json();
                    const services = new Set();

                    (data.changes || []).forEach(change => {
                        if (change.service) {
                            services.add(change.service);
                        }
                    });

                    services.forEach(service => {
                        historicalActivity[service] = (historicalActivity[service] || 0) + 1;
                    });
                }
            } catch (err) {
                console.log(`Could not load ${fileName}:`, err.message);
            }
        }

        return historicalActivity;
    }
}
