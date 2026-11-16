// The one definition of "prefixes added / removed" for a change record.
// New tags count all their prefixes as added, removed tags all as removed,
// so for any comparison: previous total + added − removed = current total.
// Handles schema v2 records (added_count on every type) and older v1 ones.
export function changeCounts(change) {
    const all = change.ip_count ?? change.prefixes?.length ?? 0;
    switch (change.type) {
        case 'service_added':
        case 'NewService':
            return { added: change.added_count ?? all, removed: 0 };
        case 'service_removed':
        case 'RemovedService':
            return { added: 0, removed: change.removed_count ?? all };
        default:
            return { added: change.added_count || 0, removed: change.removed_count || 0 };
    }
}

export function sumCounts(changes) {
    let added = 0;
    let removed = 0;
    for (const c of changes || []) {
        const n = changeCounts(c);
        added += n.added;
        removed += n.removed;
    }
    return { added, removed };
}

// Change files the dashboard shows: comparisons (not the initial baseline)
// in which something actually changed. A collection that found no differences
// stays in the data for the record but is not listed in history or analytics.
export function comparisonFiles(manifest) {
    return (manifest?.files || []).filter(f => !f.baseline && f.total_changes !== 0);
}
