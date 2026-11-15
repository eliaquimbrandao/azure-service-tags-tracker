#!/usr/bin/env python3
"""Check that every published data file is internally consistent.

Run: python scripts/verify_data.py   (exits 1 on any problem)

- each change file's per-tag counts add up to its comparison totals
- previous total + added - removed = current total, where both are known
- reproducible comparisons are recomputed from the archived snapshots
- current totals match the archived snapshot for that date
- exactly one baseline, and it is the oldest change file
- manifest, latest-changes, summary and current.json agree with the files on disk
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import logging  # noqa: E402
from azure_watcher import (CHANGES_DIR, DATA_DIR, HISTORY_DIR, SCHEMA_VERSION,  # noqa: E402
                           detect_changes, history_dates, membership_total)

logging.getLogger().setLevel(logging.WARNING)
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


def load(path):
    with open(path) as f:
        return json.load(f)


def change_key(c):
    return (c['type'], c['service'], tuple(sorted(c.get('added_prefixes', c.get('prefixes', []) if c['type'] == 'service_added' else []))),
            tuple(sorted(c.get('removed_prefixes', c.get('prefixes', []) if c['type'] == 'service_removed' else []))))


def main():
    snaps = set(history_dates())
    paths = sorted(CHANGES_DIR.glob('????-??-??-changes.json'))
    check(paths, 'no change files found')
    baselines = []
    reproduced = 0

    for path in paths:
        doc = load(path)
        d = doc.get('date')
        name = path.name
        check(d == name[:10], f'{name}: date field {d!r} does not match filename')
        check(doc.get('schema_version') == SCHEMA_VERSION, f'{name}: schema_version is {doc.get("schema_version")}')
        cmp_ = doc.get('comparison') or {}
        changes = doc.get('changes', [])
        if doc.get('baseline'):
            baselines.append(d)

        for c in changes:
            check(isinstance(c.get('added_count'), int) and isinstance(c.get('removed_count'), int),
                  f'{name}: {c.get("service")} ({c.get("type")}) lacks integer added_count/removed_count')
            if c['type'] == 'ip_changes':
                check(c['added_count'] == len(c.get('added_prefixes', [])) and c['removed_count'] == len(c.get('removed_prefixes', [])),
                      f'{name}: {c["service"]} counts do not match its prefix lists')
        added = sum(c.get('added_count', 0) for c in changes)
        removed = sum(c.get('removed_count', 0) for c in changes)
        check(cmp_.get('added_memberships') == added, f'{name}: added_memberships {cmp_.get("added_memberships")} != Σ {added}')
        check(cmp_.get('removed_memberships') == removed, f'{name}: removed_memberships {cmp_.get("removed_memberships")} != Σ {removed}')
        check(doc.get('total_changes') == len(changes), f'{name}: total_changes mismatch')

        if d in snaps:
            cur = load(HISTORY_DIR / f'{d}.json')
            check(cmp_.get('current_membership_total') == membership_total(cur), f'{name}: current total differs from snapshot')
            check(cmp_.get('current_change_number') == cur.get('changeNumber'), f'{name}: changeNumber differs from snapshot')

        prev_total = cmp_.get('previous_membership_total')
        if prev_total is not None:
            check(prev_total + added - removed == cmp_.get('current_membership_total'),
                  f'{name}: {prev_total} + {added} - {removed} != {cmp_.get("current_membership_total")}')

        if cmp_.get('reproducible'):
            p = cmp_.get('previous_snapshot')
            check(p in snaps and d in snaps, f'{name}: marked reproducible but snapshot {p} or {d} is missing')
            if p in snaps and d in snaps:
                old, new = load(HISTORY_DIR / f'{p}.json'), load(HISTORY_DIR / f'{d}.json')
                check(prev_total == membership_total(old), f'{name}: previous total differs from snapshot {p}')
                recomputed, _ = detect_changes(old, new)
                check(sorted(map(change_key, recomputed)) == sorted(map(change_key, changes)),
                      f'{name}: stored changes differ from a fresh diff of {p} -> {d}')
                reproduced += 1

    oldest = paths[0].name[:10] if paths else None
    check(baselines == [oldest], f'expected exactly one baseline ({oldest}), found {baselines}')

    manifest = load(CHANGES_DIR / 'manifest.json')
    listed = sorted(f['filename'] for f in manifest['files'])
    check(listed == [p.name for p in paths], 'manifest does not list exactly the change files on disk')
    check(manifest['total_files'] == len(paths), 'manifest total_files mismatch')
    check([f['date'] for f in manifest['files'] if f['baseline']] == baselines, 'manifest baseline flags disagree')

    latest = load(CHANGES_DIR / 'latest-changes.json')
    check(latest == load(paths[-1]), 'latest-changes.json is not the newest change file')

    dates = history_dates()
    current = load(DATA_DIR / 'current.json')
    check(current == load(HISTORY_DIR / f'{dates[-1]}.json'), f'current.json differs from newest snapshot {dates[-1]}')
    summary = load(DATA_DIR / 'summary.json')
    check(summary.get('available_dates') == dates, 'summary.available_dates does not match history/')
    check(summary.get('total_ip_ranges') == membership_total(current), 'summary total_ip_ranges differs from current.json')
    check(summary.get('changes_this_week') == len(latest['changes']), 'summary changes_this_week differs from latest-changes')

    # Region labels: non-fatal so a brand-new Microsoft region never blocks collection.
    region_names = load(DATA_DIR / 'regions.json')
    region_ids = {}
    for t in current['values']:
        r = t['properties'].get('region')
        if r:
            region_ids.setdefault(r, set()).add(t['properties'].get('regionId'))
    for r in sorted(region_ids):
        if r not in region_names:
            print(f'::warning::Region {r!r} is missing from docs/data/regions.json; '
                  f'run: python scripts/azure_watcher.py --rebuild-regions')
    by_id = {}
    for r, ids in region_ids.items():
        for i in ids:
            by_id.setdefault(i, set()).add(r)
    for i, names in by_id.items():
        if len(names) > 1:
            print(f'::warning::regionId {i} is used by several region names {sorted(names)}; check they share a name in regions.json')

    if errors:
        print(f'❌ {len(errors)} problem(s):')
        for e in errors:
            print('  -', e)
        sys.exit(1)
    print(f'✅ {len(paths)} change files consistent; {reproduced} recomputed from snapshots and matched')


if __name__ == '__main__':
    main()
