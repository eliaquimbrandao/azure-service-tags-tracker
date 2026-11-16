// Self-check for the shared change-count helper and region keys, against real data.
// Run: node scripts/test-change-counts.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { changeCounts, sumCounts, comparisonFiles } from '../docs/js/modules/core/changeCounts.js';
import { RegionMapper } from '../docs/js/modules/core/RegionMapper.js';

// --- every change type, v2 and legacy v1 records ---
assert.deepEqual(changeCounts({ type: 'ip_changes', added_count: 3, removed_count: 1 }), { added: 3, removed: 1 });
assert.deepEqual(changeCounts({ type: 'service_added', ip_count: 5 }), { added: 5, removed: 0 }, 'v1 new tag');
assert.deepEqual(changeCounts({ type: 'service_added', ip_count: 5, added_count: 5, removed_count: 0 }), { added: 5, removed: 0 }, 'v2 not doubled');
assert.deepEqual(changeCounts({ type: 'service_removed', prefixes: ['a', 'b'] }), { added: 0, removed: 2 }, 'v1 removed tag');
assert.deepEqual(changeCounts({ type: 'NewService', ip_count: 2 }), { added: 2, removed: 0 });
assert.deepEqual(sumCounts([]), { added: 0, removed: 0 });

// --- baseline comes from the explicit flag, not file order ---
assert.deepEqual(comparisonFiles({ files: [{ date: 'b', baseline: false }, { date: 'a', baseline: true }] }).map(f => f.date), ['b']);
// --- collections that found no differences are not shown ---
assert.deepEqual(comparisonFiles({ files: [{ date: 'c', total_changes: 0 }, { date: 'b', total_changes: 3 }] }).map(f => f.date), ['b']);

// --- region keys: aliases merge, numbered regions stay distinct ---
const rm = new RegionMapper();
assert.equal(rm.getBaseRegionKey('East US'), rm.getBaseRegionKey('eastus'));
assert.notEqual(rm.getBaseRegionKey('eastus'), rm.getBaseRegionKey('eastus2'));
assert.equal(rm.getBaseRegionKey(''), 'global');
const groups = rm.groupChangesByRegion([{ region: 'eastus' }, { region: 'eastus2' }]);
assert.equal(Object.keys(groups).length, 2, 'East US and East US 2 are separate groups');

// Aliases come from the generated regions.json: same name => same region.
const regionNames = JSON.parse(readFileSync(new URL('../docs/data/regions.json', import.meta.url)));
rm.regionDisplayMap = regionNames;
assert.equal(rm.getBaseRegionKey('centralfrance'), 'francecentral');
assert.equal(rm.getBaseRegionKey('France Central'), 'francecentral');
assert.equal(rm.getBaseRegionKey('switzerlandw'), 'switzerlandwest');
assert.equal(rm.getBaseRegionKey('usstagee'), 'eastusstg');
assert.notEqual(rm.getBaseRegionKey('eastus2euap'), rm.getBaseRegionKey('eastus2'));
assert.equal(rm.getBaseRegionKey('somenewregion'), 'somenewregion', 'unknown regions stay separate');
// No two regionIds may ever collapse onto one key (that would hide a region).
const current = JSON.parse(readFileSync(new URL('../docs/data/current.json', import.meta.url)));
const idsByKey = {};
for (const t of current.values) {
    const r = t.properties.region;
    if (!r) continue;
    (idsByKey[rm.getBaseRegionKey(r)] ??= new Set()).add(t.properties.regionId);
}
for (const [key, ids] of Object.entries(idsByKey)) {
    assert.equal(ids.size, 1, `region key ${key} merges regionIds ${[...ids]}`);
}

// --- real published files: helper totals equal the backend's comparison totals ---
const dir = new URL('../docs/data/changes/', import.meta.url);
let checked = 0;
for (const name of readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}-changes\.json$/.test(n))) {
    const doc = JSON.parse(readFileSync(new URL(name, dir)));
    const { added, removed } = sumCounts(doc.changes);
    assert.equal(added, doc.comparison.added_memberships, `${name} added`);
    assert.equal(removed, doc.comparison.removed_memberships, `${name} removed`);
    checked++;
}
assert.ok(checked > 0);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
assert.equal(manifest.files.filter(f => f.baseline).length, 1, 'exactly one baseline in manifest');

console.log(`✅ test-change-counts passed (${checked} change files)`);
