export class RegionMapper {
    constructor() {
        this.regionDisplayMap = {};
    }

    async loadRegions() {
        try {
            const response = await fetch('data/regions.json');
            if (response.ok) {
                this.regionDisplayMap = await response.json();
            } else {
                console.warn('Failed to load regions.json, using fallback');
                this.regionDisplayMap = {};
            }
        } catch (error) {
            console.error('Error loading regions.json:', error);
            this.regionDisplayMap = {};
        }
    }

    getRegionDisplayName(programmaticName) {
        if (!programmaticName || programmaticName === '') {
            return 'Global';
        }

        const cleanName = programmaticName.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Try to get the display name from the loaded regions
        const displayName = this.regionDisplayMap?.[cleanName];

        // If not found in mapping, format the programmatic name nicely
        if (!displayName) {
            // Convert "brazilsouth" to "Brazil South", "eastus2" to "East US 2", etc.
            return programmaticName
                .replace(/([a-z])([A-Z])/g, '$1 $2') // Handle camelCase
                .replace(/([a-z])(\d)/g, '$1 $2')    // Handle numbers
                .split(/(?=[A-Z])|\s+/)               // Split on capitals or spaces
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ')
                .trim();
        }

        return displayName;
    }

    getAllRegions() {
        return this.regionDisplayMap;
    }

    // Canonical key for a region. regions.json (generated each run from
    // Microsoft's tag names) lists an alias such as "centralfrance" under the
    // same name as its canonical spelling "francecentral", so both resolve to
    // one key. Distinct regions (eastus vs eastus2) never share a name.
    getBaseRegionKey(region) {
        if (!region) return 'global';
        const key = region.toLowerCase().replace(/[^a-z0-9]/g, '') || 'global';
        const name = this.regionDisplayMap?.[key];
        if (!name) return key;
        const canonical = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return this.regionDisplayMap[canonical] === name ? canonical : key;
    }

    groupChangesByRegion(changes) {
        const groups = {};
        changes.forEach(change => {
            const regionRaw = change.region || 'Global';
            const baseKey = this.getBaseRegionKey(regionRaw);
            const displayName = regionRaw === 'Global' ? 'Global' : this.getRegionDisplayName(regionRaw);
            const baseDisplay = displayName;

            if (!groups[baseKey]) {
                groups[baseKey] = {
                    baseKey,
                    baseDisplay,
                    variants: new Set(),
                    changes: []
                };
            }

            groups[baseKey].changes.push(change);
            groups[baseKey].variants.add(displayName);
        });

        return groups;
    }

    formatRegionGroupLabel(group) {
        if (!group) return 'Region';
        const variants = Array.from(group.variants || []).sort();
        if (variants.length > 1) {
            return `${group.baseDisplay} (includes ${variants.join(', ')})`;
        }
        if (variants.length === 1) {
            return variants[0];
        }
        return group.baseDisplay || 'Region';
    }

    deriveRegionCode(change) {
        if (change && change.region) return change.region;
        if (change && change.service && change.service.includes('.')) {
            const parts = change.service.split('.');
            return parts[parts.length - 1];
        }
        return '';
    }
}
