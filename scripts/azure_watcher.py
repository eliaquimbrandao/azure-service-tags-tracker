#!/usr/bin/env python3
"""
Azure Service Tag Tracker - Dashboard Data Generator
Adapted for GitHub Actions + GitHub Pages deployment

This script:
1. Downloads the latest Azure Service Tags JSON (and stops if it is the one already stored)
2. Compares with previous data to detect changes
3. Generates JSON files for the web dashboard
4. Creates summary statistics for visualization
"""

import json
import logging
import re
import hashlib
import time
import argparse
import ipaddress
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

AZURE_PUBLIC_IP_JSON_URL = "https://www.microsoft.com/en-us/download/confirmation.aspx?id=56519"
MAX_RETRIES = 3
RETRY_DELAY = 2
USER_AGENT = "Azure-Service-Tags-Tracker/1.0"

def download_latest_json() -> Tuple[Dict, Dict]:
    """Download the latest Azure Service Tags JSON with retry logic.
    Returns: (json_data, metadata) where metadata contains version and published date"""
    import requests  # imported here so the diff/verify code runs without network deps
    from bs4 import BeautifulSoup
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT})
    
    for attempt in range(MAX_RETRIES):
        try:
            logging.info(f"Downloading metadata page (attempt {attempt + 1}/{MAX_RETRIES})...")
            r = session.get(AZURE_PUBLIC_IP_JSON_URL, timeout=60)
            r.raise_for_status()
            
            # Extract metadata from the confirmation page using BeautifulSoup
            metadata = {}
            soup = BeautifulSoup(r.text, 'html.parser')
            
            # Extract version (e.g., "2025.10.20")
            # Look for "Version:" text and get the next sibling element
            version_header_str = soup.find(string=re.compile("Version:", re.IGNORECASE))
            if version_header_str:
                version_header_tag = version_header_str.parent
                # Try to find the value in the next sibling element (p, div, span)
                version_val = version_header_tag.find_next_sibling(['p', 'div', 'span'])
                if version_val:
                    val_text = version_val.get_text(strip=True)
                    
                    # Try to find version pattern inside text first
                    # Pattern: YYYY.MM.DD
                    v_match = re.search(r'(\d{4}\.\d{2}\.\d{2})', val_text)
                    if v_match:
                        metadata['version'] = v_match.group(1)
                        logging.info(f"Extracted version: {metadata['version']}")
                    # Fallback: if text is short, use it as is
                    elif len(val_text) < 50:
                        metadata['version'] = val_text
                        logging.info(f"Found version (raw): {metadata['version']}")
            
            if not metadata.get('version'):
                logging.warning("Could not extract version from Microsoft's page")
            
            # Extract date published (e.g., "10/24/2025")
            # Look for "Date Published:" text and get the next sibling element
            date_header_str = soup.find(string=re.compile("Date Published:", re.IGNORECASE))
            if date_header_str:
                date_header_tag = date_header_str.parent
                # Try to find the value in the next sibling element (p, div, span)
                date_val = date_header_tag.find_next_sibling(['p', 'div', 'span'])
                if date_val:
                    val_text = date_val.get_text(strip=True)
                    
                    # Try to find date pattern inside text first
                    # Pattern: MM/DD/YYYY or M/D/YYYY
                    d_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', val_text)
                    if d_match:
                        metadata['date_published'] = d_match.group(1)
                        metadata['date_published_source'] = 'download_page'
                        logging.info(f"Extracted date published: {metadata['date_published']}")
                    # Fallback: if text is short, use it as is
                    elif len(val_text) < 50:
                        metadata['date_published'] = val_text
                        logging.info(f"Found date published (raw): {metadata['date_published']}")
            
            if not metadata.get('date_published'):
                logging.warning("Could not extract date published from Microsoft's page")
            
            if not metadata:
                logging.warning("No metadata extracted - Microsoft's page format may have changed")
            
            # Find the JSON download link
            # Look for an anchor tag with href ending in .json
            json_link = soup.find('a', href=re.compile(r'\.json$', re.IGNORECASE))
            
            if not json_link:
                # Fallback to regex if soup fails to find the link (unlikely but safe)
                matches = re.findall(r'href="(https?://[^\"]+\.json)"', r.text, flags=re.IGNORECASE)
                if not matches:
                    raise RuntimeError("Could not locate the JSON download link on the confirmation page.")
                json_url = matches[0]
            else:
                json_url = json_link['href']
                
            logging.info(f"Downloading JSON from: {json_url}")
            
            # Extract metadata from filename as fallback (e.g., ServiceTags_Public_20251020.json)
            filename_match = re.search(r'ServiceTags_Public_(\d{8})\.json', json_url, re.IGNORECASE)
            if filename_match:
                date_str = filename_match.group(1)  # e.g., "20251020"
                
                # Fallback for version
                if not metadata.get('version'):
                    # Convert YYYYMMDD to YYYY.MM.DD format for version
                    version_from_filename = f"{date_str[:4]}.{date_str[4:6]}.{date_str[6:8]}"
                    metadata['version'] = version_from_filename
                    logging.info(f"Extracted version from filename: {metadata['version']}")
                
                # Fallback for date_published
                if not metadata.get('date_published'):
                    # Convert to MM/DD/YYYY for date_published
                    date_published_from_filename = f"{date_str[4:6]}/{date_str[6:8]}/{date_str[:4]}"
                    metadata['date_published'] = date_published_from_filename
                    metadata['date_published_source'] = 'inferred_from_filename'
                    logging.info(f"Extracted date published from filename: {metadata['date_published']}")
            
            r2 = session.get(json_url, timeout=120)
            r2.raise_for_status()

            metadata['source_url'] = json_url
            metadata['content_sha256'] = hashlib.sha256(r2.content).hexdigest()
            data = r2.json()
            if not data or not isinstance(data, dict):
                raise ValueError("Downloaded JSON is empty or invalid.")
            
            if "values" not in data:
                raise ValueError("JSON missing 'values' key.")
            
            logging.info(f"Successfully downloaded JSON with {len(data.get('values', []))} tags.")
            return data, metadata
            
        except (requests.RequestException, ValueError, RuntimeError) as e:
            logging.error(f"Attempt {attempt + 1} failed: {e}")
            if attempt < MAX_RETRIES - 1:
                logging.info(f"Retrying in {RETRY_DELAY} seconds...")
                time.sleep(RETRY_DELAY)
            else:
                logging.error("All retry attempts failed.")
                raise


# ---------------------------------------------------------------------------
# Paths & schema
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 2
DATA_DIR = Path('docs/data')
HISTORY_DIR = DATA_DIR / 'history'
CHANGES_DIR = DATA_DIR / 'changes'
LOG_FILE = DATA_DIR / 'collection-log.json'
METADATA_FIELDS = ('region', 'regionId', 'platform', 'systemService', 'networkFeatures')


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path):
    with open(path) as f:
        return json.load(f)


def write_json(path: Path, data, compact: bool = False):
    """compact=True for the multi-MB snapshots: same JSON, ~35% smaller on disk."""
    with open(path, 'w') as f:
        if compact:
            json.dump(data, f, separators=(',', ':'))
        else:
            json.dump(data, f, indent=2)


def history_dates() -> List[str]:
    return sorted(p.stem for p in HISTORY_DIR.glob('*.json')) if HISTORY_DIR.exists() else []


def prefixes_of(tag: Dict) -> List[str]:
    # De-duplicated: changes are diffed as sets, so totals must count a repeated prefix once.
    return list(dict.fromkeys(tag.get('properties', {}).get('addressPrefixes', []) or []))


def membership_total(data: Dict) -> int:
    """Number of (tag, prefix) memberships — what the UI calls 'IP ranges'."""
    return sum(len(prefixes_of(t)) for t in data.get('values', []))


# ---------------------------------------------------------------------------
# Address coverage (interval maths, never expands CIDRs)
# ---------------------------------------------------------------------------

def _intervals(prefixes: List[str], version: int) -> List[Tuple[int, int]]:
    nets = []
    for p in prefixes:
        try:
            n = ipaddress.ip_network(p, strict=False)
        except ValueError:
            logging.warning(f"Ignoring unparseable prefix {p!r}")
            continue
        if n.version == version:
            nets.append(n)
    return [(int(n.network_address), int(n.broadcast_address)) for n in ipaddress.collapse_addresses(nets)]


def _size(intervals) -> int:
    return sum(e - s + 1 for s, e in intervals)


def _overlap(a, b) -> int:
    """Overlap size of two sorted, disjoint interval lists."""
    i = j = total = 0
    while i < len(a) and j < len(b):
        lo, hi = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if lo <= hi:
            total += hi - lo + 1
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return total


def coverage_delta(old_prefixes: List[str], new_prefixes: List[str]) -> Tuple[Dict, str]:
    """Addresses newly covered / no longer covered, per IP family, plus a classification.

    IPv4 is reported in addresses. IPv6 is reported in /64 networks because raw
    IPv6 address counts overflow 64-bit integers in most JSON consumers.
    """
    raw = {}
    for version in (4, 6):
        a, b = _intervals(old_prefixes, version), _intervals(new_prefixes, version)
        common = _overlap(a, b)
        raw[version] = (_size(b) - common, _size(a) - common)

    added = any(v[0] for v in raw.values())
    removed = any(v[1] for v in raw.values())
    classification = ('mixed' if added and removed else 'expansion' if added
                      else 'contraction' if removed else 'representation_only')
    cov = {
        'ipv4': {'added_addresses': raw[4][0], 'removed_addresses': raw[4][1]},
        'ipv6': {'added_slash64s': raw[6][0] / 2**64, 'removed_slash64s': raw[6][1] / 2**64},
    }
    return cov, classification


def sum_coverage(items: List[Dict]) -> Dict:
    total = {'ipv4': {'added_addresses': 0, 'removed_addresses': 0},
             'ipv6': {'added_slash64s': 0.0, 'removed_slash64s': 0.0}}
    for cov in items:
        for fam, values in cov.items():
            for k, v in values.items():
                total[fam][k] += v
    return total


# ---------------------------------------------------------------------------
# Change detection
# ---------------------------------------------------------------------------

def detect_changes(old_data: Dict, new_data: Dict) -> Tuple[List[Dict], List[Dict]]:
    """Return (prefix changes, metadata changes) between two snapshots.

    Every prefix change carries added_count/removed_count, including new and
    removed tags, so: previous total + Σadded − Σremoved = current total.
    """
    changes, metadata_changes = [], []
    old_tags = {v['name']: v for v in old_data.get('values', [])}
    new_tags = {v['name']: v for v in new_data.get('values', [])}

    def base(name, tag):
        props = tag.get('properties', {})
        return {'service': name, 'region': props.get('region'), 'system_service': props.get('systemService')}

    for name, new_tag in new_tags.items():
        old_tag = old_tags.get(name)
        new_p = prefixes_of(new_tag)
        if not old_tag:
            cov, kind = coverage_delta([], new_p)
            changes.append({'type': 'service_added', **base(name, new_tag),
                            'ip_count': len(new_p), 'prefixes': new_p,
                            'added_count': len(new_p), 'removed_count': 0,
                            'coverage': cov, 'classification': kind})
            continue

        old_p = prefixes_of(old_tag)
        added, removed = set(new_p) - set(old_p), set(old_p) - set(new_p)
        if added or removed:
            cov, kind = coverage_delta(old_p, new_p)
            changes.append({'type': 'ip_changes', **base(name, new_tag),
                            'added_prefixes': sorted(added), 'removed_prefixes': sorted(removed),
                            'added_count': len(added), 'removed_count': len(removed),
                            'coverage': cov, 'classification': kind})

        old_props, new_props = old_tag.get('properties', {}), new_tag.get('properties', {})
        fields = {f: {'old': old_props.get(f), 'new': new_props.get(f)}
                  for f in METADATA_FIELDS if old_props.get(f) != new_props.get(f)}
        if fields:
            metadata_changes.append({'service': name, 'fields': fields})

    for name, old_tag in old_tags.items():
        if name not in new_tags:
            old_p = prefixes_of(old_tag)
            cov, kind = coverage_delta(old_p, [])
            changes.append({'type': 'service_removed', **base(name, old_tag),
                            'ip_count': len(old_p), 'prefixes': old_p,
                            'added_count': 0, 'removed_count': len(old_p),
                            'coverage': cov, 'classification': kind})

    logging.info(f"Detected {len(changes)} prefix changes, {len(metadata_changes)} metadata changes")
    return changes, metadata_changes


def build_change_document(old_data: Optional[Dict], new_data: Dict, date: str, metadata: Dict,
                          previous_snapshot: Optional[str], baseline: bool = False) -> Dict:
    """Assemble a schema-v2 change file comparing two snapshots."""
    baseline = baseline or old_data is None
    changes, metadata_changes = ([], []) if baseline else detect_changes(old_data, new_data)

    added = sum(c['added_count'] for c in changes)
    removed = sum(c['removed_count'] for c in changes)
    current_total = membership_total(new_data)
    previous_total = None if baseline else membership_total(old_data)
    prev_cn = None if baseline else old_data.get('changeNumber')
    cur_cn = new_data.get('changeNumber')
    skipped = list(range(prev_cn + 1, cur_cn)) if isinstance(prev_cn, int) and isinstance(cur_cn, int) else []

    doc = {
        'schema_version': SCHEMA_VERSION,
        'date': date,
        'baseline': baseline,
        'changes': changes,
        'total_changes': len(changes),
        'metadata_changes': metadata_changes,
        'generated_at': utc_now(),
        'metadata': metadata,
        'comparison': {
            'previous_snapshot': None if baseline else previous_snapshot,
            'current_snapshot': date,
            'previous_change_number': prev_cn,
            'current_change_number': cur_cn,
            'skipped_change_numbers': skipped,
            'reproducible': not baseline and previous_snapshot is not None,
            'previous_membership_total': previous_total,
            'current_membership_total': current_total,
            'added_memberships': added,
            'removed_memberships': removed,
            'net_memberships': added - removed,
            'balanced': None if baseline else previous_total + added - removed == current_total,
            'coverage': sum_coverage([c['coverage'] for c in changes if 'coverage' in c]),
        },
    }
    if not changes:
        doc['message'] = 'Baseline snapshot' if baseline else 'No changes detected this week'
    if skipped:
        logging.warning(f"Skipped Microsoft changeNumbers between snapshots: {skipped}")
    if doc['comparison']['balanced'] is False:
        raise RuntimeError(f"Membership invariant violated for {date}: "
                           f"{previous_total} + {added} - {removed} != {current_total}")
    return doc


# ---------------------------------------------------------------------------
# Derived files: summary, manifest, collection log
# ---------------------------------------------------------------------------

def generate_summary_stats(data: Dict, doc: Dict) -> Dict:
    """Summary for the dashboard. Must run after today's snapshot is saved."""
    changes = doc['changes']
    regional_changes, service_activity = {}, {}
    for c in changes:
        region = c.get('region') or 'Global'
        regional_changes[region] = regional_changes.get(region, 0) + 1
        service_activity[c['service']] = service_activity.get(c['service'], 0) + c['added_count'] + c['removed_count']
    top = sorted(service_activity.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        'schema_version': SCHEMA_VERSION,
        'last_updated': utc_now(),
        'snapshot': doc['date'],
        'change_number': data.get('changeNumber'),
        'total_services': len(data.get('values', [])),
        'total_ip_ranges': membership_total(data),
        'changes_this_week': len(changes),
        'ip_changes': sum(c['type'] == 'ip_changes' for c in changes),
        'service_additions': sum(c['type'] == 'service_added' for c in changes),
        'service_removals': sum(c['type'] == 'service_removed' for c in changes),
        'metadata_changes': len(doc.get('metadata_changes', [])),
        'added_memberships': doc['comparison']['added_memberships'],
        'removed_memberships': doc['comparison']['removed_memberships'],
        'regional_changes': regional_changes,
        'top_active_services': [{'service': s, 'change_count': n} for s, n in top],
        'available_dates': history_dates(),
        'definitions': {
            'total_ip_ranges': 'Tag-prefix memberships: the same CIDR listed under two tags counts twice.',
            'added_memberships': 'Prefixes that joined a tag (including every prefix of a new tag).',
            'removed_memberships': 'Prefixes that left a tag (including every prefix of a removed tag).',
            'coverage': 'Address space newly covered / no longer covered, computed per tag and summed across tags (IPv4 in addresses, IPv6 in /64 networks).',
            'classification': 'expansion: only new address space; contraction: only lost address space; mixed: both; representation_only: CIDRs changed but covered addresses are identical.',
        },
    }


def generate_changes_manifest():
    """List every dated change file with the fields the dashboard needs."""
    files = []
    for path in sorted(CHANGES_DIR.glob('*-changes.json')):
        m = re.match(r'(\d{4}-\d{2}-\d{2})-changes\.json$', path.name)
        if not m:
            continue
        doc = read_json(path)
        cmp_ = doc.get('comparison', {})
        files.append({
            'date': m.group(1),
            'filename': path.name,
            'size': path.stat().st_size,
            'change_number': cmp_.get('current_change_number'),
            'baseline': bool(doc.get('baseline')),
            'schema_version': doc.get('schema_version', 1),
            'added_memberships': cmp_.get('added_memberships'),
            'removed_memberships': cmp_.get('removed_memberships'),
            'skipped_change_numbers': cmp_.get('skipped_change_numbers', []),
            'reproducible': cmp_.get('reproducible', False),
        })
    files.sort(key=lambda x: x['date'], reverse=True)
    write_json(CHANGES_DIR / 'manifest.json', {
        'schema_version': SCHEMA_VERSION,
        'generated': utc_now(),
        'total_files': len(files),
        'date_range': {'oldest': files[-1]['date'] if files else None,
                       'newest': files[0]['date'] if files else None},
        'files': files,
    })
    logging.info(f"Generated manifest with {len(files)} change files")


def _load_log() -> Dict:
    if LOG_FILE.exists():
        try:
            return read_json(LOG_FILE)
        except (json.JSONDecodeError, OSError):
            logging.warning("collection-log.json unreadable; starting a new one")
    return {'runs': []}


def _save_log(log: Dict):
    """Recompute coverage (weeks with no successful collection) and save."""
    log['expected_schedule'] = 'daily-check'
    log['runs'].sort(key=lambda r: r.get('timestamp') or r['date'])
    ok_dates = {r['date'] for r in log['runs'] if r.get('status', 'success') == 'success'}
    ok_dates |= {p.name[:10] for p in CHANGES_DIR.glob('*-changes.json') if re.match(r'\d{4}-', p.name)}
    if ok_dates:
        days = sorted(datetime.strptime(d, '%Y-%m-%d').date() for d in ok_dates)
        week = lambda d: d - timedelta(days=d.weekday())
        expected, w = [], week(days[0])
        while w <= week(days[-1]):
            expected.append(w)
            w += timedelta(days=7)
        covered = {week(d) for d in days}
        # The collector checks daily and stores nothing when Microsoft has not
        # published. A quiet week is therefore only a gap if the next successful
        # collection had to skip a changeNumber.
        manifest = CHANGES_DIR / 'manifest.json'
        gap_after = {week(datetime.strptime(f['date'], '%Y-%m-%d').date())
                     for f in (read_json(manifest)['files'] if manifest.exists() else [])
                     if f.get('skipped_change_numbers')}
        missing = [w.isoformat() for w in expected if w not in covered
                   and min((c for c in covered if c > w), default=None) in gap_after]
        failed = [r for r in log['runs'] if r.get('status') == 'failed']
        log['coverage'] = {
            'first_collection': days[0].isoformat(),
            'latest_collection': days[-1].isoformat(),
            'total_runs': len(ok_dates),
            'expected_runs': len(expected),
            'missing_weeks': missing,
            'missing_dates': missing,  # kept for v1 consumers
            'missing_count': len(missing),
            'coverage_pct': round((len(expected) - len(missing)) / len(expected) * 100, 1),
            'failed_attempts': len(failed),
            'last_attempt': log['runs'][-1].get('timestamp') if log['runs'] else None,
            'note': 'A week counts as missing only when no collection succeeded in it and the next collection skipped a Microsoft changeNumber. Weeks in which Microsoft published nothing are not gaps.',
        }
    write_json(LOG_FILE, log)


def log_success(data: Dict, doc: Dict, metadata: Dict):
    log = _load_log()
    today = doc['date']
    # A same-day re-run replaces that day's success; failures are kept as evidence.
    log['runs'] = [r for r in log['runs'] if not (r['date'] == today and r.get('status', 'success') == 'success')]
    log['runs'].append({
        'date': today,
        'timestamp': utc_now(),
        'status': 'success',
        'change_number': data.get('changeNumber'),
        'changes_detected': len(doc['changes']),
        'total_services': len(data.get('values', [])),
        'total_ip_ranges': membership_total(data),
        'skipped_change_numbers': doc['comparison']['skipped_change_numbers'],
        'metadata': {k: metadata.get(k, '') for k in ('version', 'date_published', 'date_published_source', 'content_sha256')},
    })
    _save_log(log)


def _run_completed(date: str) -> bool:
    """log_success is the last step of run(), so its entry marks a finished collection."""
    return any(r['date'] == date and r.get('status', 'success') == 'success' for r in _load_log()['runs'])


def log_failure(error: Exception):
    try:
        CHANGES_DIR.mkdir(parents=True, exist_ok=True)
        log = _load_log()
        log['runs'].append({
            'date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
            'timestamp': utc_now(),
            'status': 'failed',
            'error': f"{type(error).__name__}: {error}"[:500],
        })
        _save_log(log)
    except Exception as e:  # never mask the original failure
        logging.error(f"Could not record failure in collection log: {e}")


# ---------------------------------------------------------------------------
# Region names (generated from Microsoft's own tag names — no manual list)
# ---------------------------------------------------------------------------

REGIONS_FILE = DATA_DIR / 'regions.json'
_ACRONYM_SUFFIXES = ('EUAP', 'STG')


def region_display_name(camel: str) -> str:
    """'FranceCentral' -> 'France Central', 'EastUS2EUAP' -> 'East US 2 EUAP'."""
    suffix = ''
    for acronym in _ACRONYM_SUFFIXES:
        if camel.endswith(acronym) and len(camel) > len(acronym):
            camel, suffix = camel[:-len(acronym)], ' ' + acronym
            break
    spaced = re.sub(r'(?<=[a-z])(?=[A-Z0-9])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])',
                    ' ', camel)
    return spaced + suffix


def update_region_map(snapshots: List[Dict]) -> Dict:
    """Merge region names derived from these snapshots into regions.json.

    Regional tags are named like 'Storage.FranceCentral' while their region
    field may be an alias ('centralfrance'). The CamelCase suffix gives the
    display name; both spellings are written as keys with the same name, which
    is how the frontend recognises an alias. A region no tag spells out
    (e.g. only 'AzureCloud.brazilne') keeps its raw code as its name: Microsoft
    publishes no name for it, so none is invented. Existing entries are kept so
    regions that only appear in older history stay labelled.
    """
    votes: Dict[str, Dict[str, int]] = {}
    seen = set()
    for data in snapshots:
        for tag in data.get('values', []):
            region = tag.get('properties', {}).get('region')
            if not region or '.' not in tag['name']:
                continue
            seen.add(region.lower())
            suffix = tag['name'].split('.', 1)[1]
            if suffix != suffix.lower():  # needs capitals to carry word boundaries
                votes.setdefault(region, {}).setdefault(suffix, 0)
                votes[region][suffix] += 1

    regions = read_json(REGIONS_FILE) if REGIONS_FILE.exists() else {}
    for region, counts in votes.items():
        camel = max(counts, key=lambda k: (counts[k], k))
        name = region_display_name(camel)
        regions[region.lower()] = name
        regions[re.sub(r'[^a-z0-9]', '', camel.lower())] = name
    for region in seen:
        regions.setdefault(region, region)

    regions = dict(sorted(regions.items()))
    write_json(REGIONS_FILE, regions)
    return regions


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

_HTML_SIGNIFICANT = re.compile(r'[<>&"\'`]')


def unsafe_strings(obj) -> List[str]:
    """Strings the dashboard could not place in HTML as-is. Tag names, regions
    and prefixes are rendered without escaping, so they are vetted once, here."""
    if isinstance(obj, str):
        return [obj] if _HTML_SIGNIFICANT.search(obj) else []
    if isinstance(obj, dict):
        return [s for pair in obj.items() for x in pair for s in unsafe_strings(x)]
    if isinstance(obj, list):
        return [s for x in obj for s in unsafe_strings(x)]
    return []


def load_previous_snapshot(today: str) -> Tuple[Optional[Dict], Optional[str]]:
    """Latest snapshot strictly before today, so a same-day re-run diffs against
    the real previous collection instead of against itself."""
    earlier = [d for d in history_dates() if d < today]
    if earlier:
        return read_json(HISTORY_DIR / f'{earlier[-1]}.json'), earlier[-1]
    current = DATA_DIR / 'current.json'
    if current.exists():
        logging.warning("No earlier history snapshot; comparing against current.json (not reproducible)")
        return read_json(current), None
    return None, None


def write_change_document(doc: Dict):
    write_json(CHANGES_DIR / f"{doc['date']}-changes.json", doc)


def refresh_latest_changes():
    dated = sorted(CHANGES_DIR.glob('????-??-??-changes.json'))
    if dated:
        write_json(CHANGES_DIR / 'latest-changes.json', read_json(dated[-1]))


def run(baseline: bool):
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    for d in (DATA_DIR, HISTORY_DIR, CHANGES_DIR):
        d.mkdir(parents=True, exist_ok=True)

    new_data, metadata = download_latest_json()
    metadata['retrieved_at'] = utc_now()
    bad = unsafe_strings(new_data)
    if bad:
        raise ValueError(f"Download contains {len(bad)} string(s) with HTML-significant characters, "
                         f"e.g. {bad[0][:80]!r}; refusing to publish them")

    dates = history_dates()
    if not baseline and dates:
        latest = read_json(HISTORY_DIR / f'{dates[-1]}.json')
        if latest == new_data:
            if _run_completed(dates[-1]):
                print(f"⏭️  Nothing new: changeNumber {new_data.get('changeNumber')} was already collected on {dates[-1]}")
                return
            # The snapshot was stored but that run died before its summary,
            # manifest and log were written. Redo that day instead of skipping.
            logging.warning(f"Collection for {dates[-1]} did not finish; completing it")
            today, baseline = dates[-1], len(dates) == 1
        # A truncated but well-formed download would otherwise be recorded as
        # thousands of removed tags.
        if len(new_data['values']) < len(latest.get('values', [])) / 2:
            raise ValueError(f"Download has {len(new_data['values'])} tags, fewer than half of the "
                             f"{len(latest['values'])} in the {dates[-1]} snapshot; refusing to record it")

    old_data, prev_date = (None, None) if baseline else load_previous_snapshot(today)
    doc = build_change_document(old_data, new_data, today, metadata, prev_date, baseline=baseline)

    # Snapshot first, then everything derived from it.
    write_json(DATA_DIR / 'current.json', new_data, compact=True)
    write_json(HISTORY_DIR / f'{today}.json', new_data, compact=True)
    write_change_document(doc)
    refresh_latest_changes()
    update_region_map([new_data])
    summary = generate_summary_stats(new_data, doc)
    write_json(DATA_DIR / 'summary.json', summary)
    generate_changes_manifest()
    log_success(new_data, doc, metadata)

    c = doc['comparison']
    print(f"✅ {'Baseline' if doc['baseline'] else 'Update'} saved for {today} (changeNumber {c['current_change_number']})")
    print(f"📊 Services: {summary['total_services']}  memberships: {c['current_membership_total']}")
    if not doc['baseline']:
        print(f"📈 {len(doc['changes'])} tag changes: +{c['added_memberships']} / -{c['removed_memberships']} memberships")
        if c['skipped_change_numbers']:
            print(f"⚠️  Missed Microsoft versions: {c['skipped_change_numbers']}")


def main():
    parser = argparse.ArgumentParser(description='Azure Service Tags & IP Ranges Tracker - Dashboard Data Generator')
    parser.add_argument('--baseline', action='store_true', help='Setup initial baseline (no changes recorded)')
    parser.add_argument('--rebuild-regions', action='store_true', help='Regenerate regions.json from every archived snapshot (no download)')
    args = parser.parse_args()

    if args.rebuild_regions:
        names = update_region_map([read_json(HISTORY_DIR / f'{d}.json') for d in history_dates()])
        print(f"✅ regions.json: {len(names)} entries")
        return
    try:
        run(args.baseline)
    except Exception as e:
        logging.error(f"Update failed: {e}")
        log_failure(e)
        sys.exit(1)


if __name__ == "__main__":
    main()
