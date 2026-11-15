#!/usr/bin/env python3
"""Self-check for change detection and coverage maths.
Run: python scripts/test_watcher.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tempfile  # noqa: E402
import azure_watcher  # noqa: E402
from azure_watcher import build_change_document, coverage_delta, detect_changes, region_display_name, update_region_map  # noqa: E402


def snap(cn, **tags):
    return {'changeNumber': cn, 'values': [
        {'name': n, 'properties': {'addressPrefixes': p, 'region': r, 'systemService': 'Svc'}}
        for n, (p, r) in tags.items()]}


# --- coverage classification ---
cov, kind = coverage_delta(['10.0.0.0/24'], ['10.0.0.0/25', '10.0.0.128/25'])
assert kind == 'representation_only' and cov['ipv4'] == {'added_addresses': 0, 'removed_addresses': 0}, cov
cov, kind = coverage_delta(['10.0.0.0/25'], ['10.0.0.0/24'])
assert kind == 'expansion' and cov['ipv4'] == {'added_addresses': 128, 'removed_addresses': 0}, cov
cov, kind = coverage_delta(['10.0.0.0/24'], ['10.0.0.0/25'])
assert kind == 'contraction' and cov['ipv4']['removed_addresses'] == 128, cov
cov, kind = coverage_delta(['10.0.0.0/25'], ['10.0.0.128/25'])
assert kind == 'mixed' and cov['ipv4'] == {'added_addresses': 128, 'removed_addresses': 128}, cov
cov, kind = coverage_delta(['10.0.0.0/24', '10.0.0.0/25'], ['10.0.0.0/24'])  # redundant prefix dropped
assert kind == 'representation_only', kind
cov, kind = coverage_delta([], ['2603:1000::/63'])
assert kind == 'expansion' and cov['ipv6']['added_slash64s'] == 2 and cov['ipv4']['added_addresses'] == 0, cov
cov, kind = coverage_delta(['2603:1000::/128'], [])
assert kind == 'contraction', kind  # a single IPv6 address still counts

# --- detect_changes: new, removed, changed, metadata ---
old = snap(10, A=(['1.1.1.0/24'], ''), B=(['2.2.2.0/24', '3.3.3.0/24'], 'eastus'), C=(['4.4.4.0/24'], 'eastus2'))
new = snap(12, A=(['1.1.1.0/24'], 'westus'), B=(['2.2.2.0/24', '5.5.5.0/24'], 'eastus'), D=(['6.6.6.0/24', '7.7.7.0/24'], ''))
changes, meta = detect_changes(old, new)
by = {c['service']: c for c in changes}
assert set(by) == {'B', 'C', 'D'}, by.keys()
assert (by['B']['added_count'], by['B']['removed_count']) == (1, 1)
assert (by['C']['type'], by['C']['added_count'], by['C']['removed_count']) == ('service_removed', 0, 1)
assert (by['D']['type'], by['D']['added_count'], by['D']['removed_count']) == ('service_added', 2, 0)
assert meta == [{'service': 'A', 'fields': {'region': {'old': '', 'new': 'westus'}}}], meta

# --- invariant and provenance on the full document ---
doc = build_change_document(old, new, '2026-01-02', {}, '2026-01-01')
c = doc['comparison']
assert (c['previous_membership_total'], c['added_memberships'], c['removed_memberships'], c['current_membership_total']) == (4, 3, 2, 5)
assert c['balanced'] is True and c['skipped_change_numbers'] == [11] and c['reproducible'] is True
assert doc['baseline'] is False

base = build_change_document(None, new, '2026-01-02', {}, None)
assert base['baseline'] is True and base['changes'] == [] and base['comparison']['balanced'] is None

# --- region names come from Microsoft's tag names ---
for camel, name in [('FranceCentral', 'France Central'), ('EastUS2EUAP', 'East US 2 EUAP'), ('UAENorth', 'UAE North'),
                    ('SouthCentralUSSTG', 'South Central US STG'), ('SoutheastAsia3', 'Southeast Asia 3'), ('WestUS2', 'West US 2')]:
    assert region_display_name(camel) == name, (camel, region_display_name(camel))

with tempfile.TemporaryDirectory() as tmp:
    azure_watcher.REGIONS_FILE = Path(tmp) / 'regions.json'
    azure_watcher.REGIONS_FILE.write_text('{"oldregion": "Old Region"}')
    tags = {'values': [
        {'name': 'Storage.FranceCentral', 'properties': {'region': 'centralfrance'}},
        {'name': 'AzureCloud.centralfrance', 'properties': {'region': 'centralfrance'}},
        {'name': 'Sql.EastUS2', 'properties': {'region': 'eastus2'}},
        {'name': 'Sql.EastUS', 'properties': {'region': 'eastus'}},
        {'name': 'AzureCloud.brazilne', 'properties': {'region': 'brazilne'}},
        {'name': 'AzureCloud', 'properties': {'region': ''}},
    ]}
    names = update_region_map([tags])
    assert names['centralfrance'] == names['francecentral'] == 'France Central'   # alias shares the name
    assert names['eastus'] == 'East US' and names['eastus2'] == 'East US 2'      # distinct regions stay distinct
    assert names['brazilne'] == 'brazilne'                                      # never invent a name Microsoft doesn't publish
    assert names['oldregion'] == 'Old Region'                                   # history-only regions kept

print('✅ test_watcher passed')
