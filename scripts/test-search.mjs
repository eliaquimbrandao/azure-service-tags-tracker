// Self-check for SearchManager's query parsing and ranking.
// Run: node scripts/test-search.mjs
// Covers the pure logic only — no DOM, no fetch.
import assert from 'node:assert/strict';
import { SearchManager } from '../docs/js/modules/ui/SearchManager.js';

const sm = new SearchManager(null, null, null, null);
const ctx = (q) => {
    const queryLower = q.toLowerCase();
    const words = queryLower.split(/\s+/).filter(Boolean);
    return { queryLower, queryCompact: queryLower.replace(/\s+/g, ''), queryWords: words, isMultiWord: words.length > 1 };
};

// --- isIPAddressLike: CIDR and IPv6 queries must qualify ---
assert.equal(sm.isIPAddressLike('20.172.90.116/30'), true, 'CIDR is IP-like');
assert.equal(sm.isIPAddressLike('2603:1030::/64'), true, 'IPv6 CIDR is IP-like');
assert.equal(sm.isIPAddressLike('13.68.'), true, 'partial IPv4 is IP-like');
assert.equal(sm.isIPAddressLike('AzureCloud.eastus'), false, 'service name is not IP-like');
assert.equal(sm.isIPAddressLike('storage'), false, 'plain word is not IP-like');

// --- parseCIDR: strict, and rejects the junk parseInt used to accept ---
assert.equal(sm.parseCIDR('1.2.3.4abc'), null, 'trailing junk rejected');
assert.equal(sm.parseCIDR('1.2.3'), null, 'short IPv4 rejected');
assert.equal(sm.parseCIDR('1.2.3.256'), null, 'octet > 255 rejected');
assert.equal(sm.parseCIDR('1.2.3.4/33'), null, 'IPv4 mask > 32 rejected');
assert.equal(sm.parseCIDR('1.2.3.4/x'), null, 'non-numeric mask rejected');
assert.equal(sm.parseCIDR('1:2:3:4:5:6:7'), null, 'short IPv6 without :: rejected');
assert.equal(sm.parseCIDR('gggg::1'), null, 'non-hex hextet rejected');

assert.equal(sm.parseCIDR('20.172.90.116').mask, 32, 'bare IPv4 defaults to /32');
assert.equal(sm.parseCIDR('20.172.90.116/30').mask, 30, 'mask parsed');
assert.equal(sm.parseCIDR('2603:1030::/64').version, 6, 'IPv6 CIDR parsed');
assert.equal(sm.parseCIDR('::').value, 0n, ':: is all zeroes');

// --- rangesOverlap: containment both ways, and non-overlap ---
const overlaps = (a, b) => sm.rangesOverlap(sm.parseCIDR(a), sm.parseCIDR(b));
assert.equal(overlaps('20.172.90.117', '20.172.90.116/30'), true, 'host inside range');
assert.equal(overlaps('20.172.90.116/30', '20.172.90.0/24'), true, 'narrow inside wide');
assert.equal(overlaps('20.172.90.0/24', '20.172.90.116/30'), true, 'wide contains narrow');
assert.equal(overlaps('20.172.90.120', '20.172.90.116/30'), false, 'host outside range');
assert.equal(overlaps('10.0.0.1', '20.172.90.116/30'), false, 'unrelated range');
assert.equal(overlaps('2603:1030::1', '2603:1030::/64'), true, 'IPv6 host inside range');
assert.equal(overlaps('2603:1031::1', '2603:1030::/64'), false, 'IPv6 host outside range');
assert.equal(overlaps('1.2.3.4', '::/0'), false, 'v4 and v6 never overlap');

// --- matchingPrefixesForIP: filters a real prefix list ---
const prefixes = ['20.172.90.116/30', '20.172.91.0/24', '10.0.0.0/8', '2603:1030::/64'];
assert.deepEqual(
    sm.matchingPrefixesForIP(sm.parseCIDR('20.172.90.117'), prefixes),
    ['20.172.90.116/30'],
    'only the containing range matches'
);
assert.deepEqual(
    sm.matchingPrefixesForIP(sm.parseCIDR('2603:1030::5'), prefixes),
    ['2603:1030::/64'],
    'IPv6 query skips IPv4 prefixes'
);

// --- scoreText / matchScore: exact > prefix > substring ---
const c = ctx('storage');
assert.equal(sm.scoreText('Storage', c), 100, 'exact match scores highest');
assert.ok(sm.scoreText('StorageSyncService', c) < sm.scoreText('Storage', c), 'exact beats prefix');
assert.ok(sm.scoreText('AzureStorage', c) < sm.scoreText('StorageSyncService', c), 'prefix beats substring');
assert.equal(sm.scoreText('Compute', c), 0, 'no match scores zero');

// Multi-word falls back to an all-words match over combined text
const mw = ctx('east us');
assert.equal(sm.matchScore(mw, 'AzureCloud', 'azurecloud eastus 🇺🇸 east us'), 20, 'all words matched');
assert.equal(sm.matchScore(mw, 'AzureCloud', 'azurecloud westeurope'), 0, 'missing word means no match');
// "eastus" compacted must still hit the region field
assert.ok(sm.scoreText('eastus', ctx('east us')) > 0, 'compacted query matches region key');

console.log('SearchManager self-check: all assertions passed');
