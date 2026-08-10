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
}
