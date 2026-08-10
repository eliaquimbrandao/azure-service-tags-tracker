export class DataManager {
    constructor() {
        this.currentData = null;
        this.summaryData = null;
        this.changesData = null;
        this.servicePrefixLookup = {};
        this.cacheBust = Date.now();
        this.manifestPromise = null;
        this.changeFileCache = {};
    }

    fetchWithCacheBust(url) {
        const separator = url.includes('?') ? '&' : '?';
        return fetch(`${url}${separator}t=${this.cacheBust}`);
    }

    /** Manifest is fetched once per page load and shared by every chart. */
    async getManifest() {
        this.manifestPromise ??= this.fetchWithCacheBust('data/changes/manifest.json').then(r => r.json());
        return this.manifestPromise;
    }

    /**
     * Load dated change files in parallel, once each.
     * Dated files never change after publication, so no cache-busting: repeat
     * visits hit the browser cache. Returns results aligned with fileInfos
     * (null for anything that failed).
     */
    async getChangeFiles(fileInfos) {
        return Promise.all(fileInfos.map(f => {
            this.changeFileCache[f.filename] ??= fetch(`data/changes/${f.filename}`)
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null);
            return this.changeFileCache[f.filename];
        }));
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
        // Fetch the small summary first, then key the big files off its
        // last_updated so the 4.5MB current.json comes from browser cache
        // until the data actually changes.
        const summaryResponse = await fetch(`./data/summary.json?t=${this.cacheBust}`);
        if (!summaryResponse.ok) {
            throw new Error('Failed to load required data files');
        }
        this.summaryData = await summaryResponse.json();

        const version = encodeURIComponent(this.summaryData.last_updated || this.cacheBust);
        const [currentResponse, changesResponse] = await Promise.all([
            fetch(`./data/current.json?v=${version}`),
            fetch(`./data/changes/latest-changes.json?v=${version}`)
        ]);

        if (!currentResponse.ok) {
            throw new Error('Failed to load required data files');
        }

        this.currentData = await currentResponse.json();

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
