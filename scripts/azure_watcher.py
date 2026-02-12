#!/usr/bin/env python3
"""
Azure Service Tag Tracker - Dashboard Data Generator
Adapted for GitHub Actions + GitHub Pages deployment

This script:
1. Downloads the latest Azure Service Tags JSON
2. Compares with previous data to detect changes  
3. Generates JSON files for the web dashboard
4. Creates summary statistics for visualization
"""

import json
import logging
import os
import re
import requests
import hashlib
import time
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from bs4 import BeautifulSoup

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
                    logging.info(f"Extracted date published from filename: {metadata['date_published']}")
            
            r2 = session.get(json_url, timeout=120)
            r2.raise_for_status()
            
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

def load_previous_data() -> Optional[Dict]:
    """Load the previous week's data for comparison."""
    current_file = Path('docs/data/current.json')
    if current_file.exists():
        try:
            with open(current_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            logging.warning(f"Could not load previous data: {e}")
    return None

def detect_changes(old_data: Optional[Dict], new_data: Dict) -> List[Dict]:
    """Detect changes between old and new data."""
    if not old_data:
        logging.info("No previous data found - this is the first run")
        return []
    
    changes = []
    old_services = {v['name']: v for v in old_data.get('values', [])}
    new_services = {v['name']: v for v in new_data.get('values', [])}
    
    for service_name, new_service in new_services.items():
        old_service = old_services.get(service_name)
        
        if not old_service:
            # New service added
            changes.append({
                'type': 'service_added',
                'service': service_name,
                'ip_count': len(new_service.get('properties', {}).get('addressPrefixes', [])),
                'prefixes': new_service.get('properties', {}).get('addressPrefixes', []),
                'region': new_service.get('properties', {}).get('region'),
                'system_service': new_service.get('properties', {}).get('systemService')
            })
            continue
        
        # Check for IP prefix changes
        old_prefixes = set(old_service.get('properties', {}).get('addressPrefixes', []))
        new_prefixes = set(new_service.get('properties', {}).get('addressPrefixes', []))
        
        added_prefixes = new_prefixes - old_prefixes
        removed_prefixes = old_prefixes - new_prefixes
        
        if added_prefixes or removed_prefixes:
            changes.append({
                'type': 'ip_changes',
                'service': service_name,
                'added_prefixes': sorted(list(added_prefixes)),
                'removed_prefixes': sorted(list(removed_prefixes)),
                'added_count': len(added_prefixes),
                'removed_count': len(removed_prefixes),
                'region': new_service.get('properties', {}).get('region'),
                'system_service': new_service.get('properties', {}).get('systemService')
            })
    
    # Check for removed services
    for service_name in old_services:
        if service_name not in new_services:
            old_service = old_services[service_name]
            changes.append({
                'type': 'service_removed',
                'service': service_name,
                'ip_count': len(old_service.get('properties', {}).get('addressPrefixes', [])),
                'prefixes': old_service.get('properties', {}).get('addressPrefixes', []),
                'region': old_service.get('properties', {}).get('region'),
                'system_service': old_service.get('properties', {}).get('systemService')
            })
    
    logging.info(f"Detected {len(changes)} changes")
    return changes

def generate_summary_stats(data: Dict, changes: List[Dict]) -> Dict:
    """Generate summary statistics for the dashboard."""
    total_services = len(data.get('values', []))
    total_ip_ranges = sum(
        len(service.get('properties', {}).get('addressPrefixes', []))
        for service in data.get('values', [])
    )
    
    # Count changes by type
    ip_changes = [c for c in changes if c['type'] == 'ip_changes']
    service_additions = [c for c in changes if c['type'] == 'service_added']
    service_removals = [c for c in changes if c['type'] == 'service_removed']
    
    # Count changes by region
    regional_changes = {}
    for change in changes:
        region = change.get('region', 'Global')
        if region not in regional_changes:
            regional_changes[region] = 0
        regional_changes[region] += 1
    
    # Most active services (services with most changes)
    service_activity = {}
    for change in ip_changes:
        service = change['service']
        if service not in service_activity:
            service_activity[service] = 0
        service_activity[service] += change['added_count'] + change['removed_count']
    
    # Sort by activity
    top_active_services = sorted(
        service_activity.items(), 
        key=lambda x: x[1], 
        reverse=True
    )[:10]
    
    # Get list of available historical dates
    history_dir = 'docs/data/history'
    available_dates = []
    if os.path.exists(history_dir):
        history_files = sorted([f for f in os.listdir(history_dir) if f.endswith('.json')])
        available_dates = [f.replace('.json', '') for f in history_files]
    
    return {
        'last_updated': datetime.now(timezone.utc).isoformat(),
        'total_services': total_services,
        'total_ip_ranges': total_ip_ranges,
        'changes_this_week': len(changes),
        'ip_changes': len(ip_changes),
        'service_additions': len(service_additions),
        'service_removals': len(service_removals),
        'regional_changes': regional_changes,
        'top_active_services': [
            {'service': service, 'change_count': count}
            for service, count in top_active_services
        ],
        'available_dates': available_dates
    }

def save_data_files(data: Dict, changes: List[Dict], summary: Dict, metadata: Dict):
    """Save all data files for the dashboard."""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Ensure data directories exist
    Path('docs/data').mkdir(exist_ok=True)
    Path('docs/data/history').mkdir(exist_ok=True)
    Path('docs/data/changes').mkdir(exist_ok=True)
    
    # Save current data
    with open('docs/data/current.json', 'w') as f:
        json.dump(data, f, indent=2)
    logging.info("Saved current.json")
    
    # Save historical snapshot
    history_file = f'docs/data/history/{today}.json'
    with open(history_file, 'w') as f:
        json.dump(data, f, indent=2)
    logging.info(f"Saved {history_file}")
    
    # Save changes if any
    if changes:
        changes_data = {
            'date': today,
            'changes': changes,
            'total_changes': len(changes),
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'metadata': metadata  # Add metadata (version, date_published)
        }
        
        # Save dated changes file
        changes_file = f'docs/data/changes/{today}-changes.json'
        with open(changes_file, 'w') as f:
            json.dump(changes_data, f, indent=2)
        logging.info(f"Saved {changes_file}")
        
        # Save latest changes (for dashboard)
        with open('docs/data/changes/latest-changes.json', 'w') as f:
            json.dump(changes_data, f, indent=2)
        logging.info("Saved latest-changes.json")
    else:
        # Save empty changes file with metadata
        empty_changes = {
            'date': today,
            'changes': [],
            'total_changes': 0,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'metadata': metadata,  # Include metadata even when no changes
            'message': 'No changes detected this week'
        }
        
        # Save dated changes file (even if empty, we need it for timeline)
        changes_file = f'docs/data/changes/{today}-changes.json'
        with open(changes_file, 'w') as f:
            json.dump(empty_changes, f, indent=2)
        logging.info(f"Saved {changes_file} (no changes)")
        
        # Save latest changes
        with open('docs/data/changes/latest-changes.json', 'w') as f:
            json.dump(empty_changes, f, indent=2)
        logging.info("No changes detected - saved empty changes file with metadata")
    
    # Save summary statistics
    with open('docs/data/summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    logging.info("Saved summary.json")
    
    # Generate manifest of all change files for historical analysis
    generate_changes_manifest()
    
    # Update collection log
    update_collection_log(data, changes, metadata)

def update_collection_log(data: Dict, changes: List[Dict], metadata: Dict):
    """Append an entry to the collection log for every run, tracking history of collections."""
    log_file = Path('docs/data/collection-log.json')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    # Load existing log
    log_data = {'runs': [], 'expected_schedule': 'weekly-monday'}
    if log_file.exists():
        try:
            with open(log_file, 'r') as f:
                log_data = json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    
    # Build this run's entry
    change_number = data.get('changeNumber', '?')
    total_services = len(data.get('values', []))
    total_ips = sum(len(svc.get('properties', {}).get('addressPrefixes', [])) for svc in data.get('values', []))
    
    entry = {
        'date': today,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'change_number': change_number,
        'changes_detected': len(changes),
        'total_services': total_services,
        'total_ip_ranges': total_ips,
        'metadata': {
            'version': metadata.get('version', ''),
            'date_published': metadata.get('date_published', '')
        }
    }
    
    # Avoid duplicate entries for same date (re-run)
    log_data['runs'] = [r for r in log_data['runs'] if r.get('date') != today]
    log_data['runs'].append(entry)
    log_data['runs'].sort(key=lambda r: r['date'])
    
    # Calculate missing weeks
    if len(log_data['runs']) >= 2:
        all_dates = [datetime.strptime(r['date'], '%Y-%m-%d').date() for r in log_data['runs']]
        first_monday = min(all_dates)
        # Align to Monday
        first_monday = first_monday - timedelta(days=first_monday.weekday())
        last_date = max(all_dates)
        
        expected = set()
        d = first_monday
        while d <= last_date:
            expected.add(d.isoformat())
            d += timedelta(days=7)
        
        collected = set(r['date'] for r in log_data['runs'])
        missing = sorted(expected - collected)
        
        log_data['coverage'] = {
            'first_collection': min(all_dates).isoformat(),
            'latest_collection': max(all_dates).isoformat(),
            'total_runs': len(log_data['runs']),
            'expected_runs': len(expected),
            'missing_dates': missing,
            'missing_count': len(missing),
            'coverage_pct': round(len(collected) / len(expected) * 100, 1) if expected else 100
        }
    
    # Save
    with open(log_file, 'w') as f:
        json.dump(log_data, f, indent=2)
    
    logging.info(f"Updated collection log: {len(log_data['runs'])} total runs")

def generate_changes_manifest():
    """Generate a manifest file listing all available change files for the dashboard."""
    try:
        changes_dir = Path('docs/data/changes')
        
        # Find all change files (exclude latest-changes.json and manifest.json)
        change_files = []
        for file_path in sorted(changes_dir.glob('*-changes.json')):
            filename = file_path.name
            if filename not in ['latest-changes.json', 'manifest.json']:
                # Extract date from filename (YYYY-MM-DD-changes.json)
                date_match = re.match(r'(\d{4}-\d{2}-\d{2})-changes\.json', filename)
                if date_match:
                    file_size = file_path.stat().st_size
                    change_files.append({
                        'date': date_match.group(1),
                        'filename': filename,
                        'size': file_size
                    })
        
        # Sort by date (newest first)
        change_files.sort(key=lambda x: x['date'], reverse=True)
        
        manifest = {
            'generated': datetime.now(timezone.utc).isoformat(),
            'total_files': len(change_files),
            'date_range': {
                'oldest': change_files[-1]['date'] if change_files else None,
                'newest': change_files[0]['date'] if change_files else None
            },
            'files': change_files
        }
        
        manifest_file = changes_dir / 'manifest.json'
        with open(manifest_file, 'w') as f:
            json.dump(manifest, f, indent=2)
        
        logging.info(f"Generated manifest with {len(change_files)} historical files")
        
    except Exception as e:
        logging.warning(f"Could not generate manifest: {e}")

def main():
    """Main execution function."""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Azure Service Tags & IP Ranges Tracker - Dashboard Data Generator')
    parser.add_argument('--baseline', action='store_true', 
                       help='Setup initial baseline (no changes recorded)')
    args = parser.parse_args()
    
    try:
        if args.baseline:
            logging.info("=== Azure Service Tags & IP Ranges Tracker - Baseline Setup ===")
            print("🎯 Setting up initial baseline")
        else:
            logging.info("=== Azure Service Tags & IP Ranges Tracker Update ===")
        
        # Download latest data
        new_data, metadata = download_latest_json()
        
        if args.baseline:
            # For baseline setup, don't load previous data or detect changes
            logging.info("Baseline mode: Skipping change detection")
            old_data = None
            changes = []
        else:
            # Load previous data for comparison
            old_data = load_previous_data()
            # Detect changes
            changes = detect_changes(old_data, new_data)
        
        # Generate summary statistics
        summary = generate_summary_stats(new_data, changes)
        
        # Save all files (including metadata)
        save_data_files(new_data, changes, summary, metadata)
        
        if args.baseline:
            logging.info("=== Baseline setup completed successfully ===")
            print("✅ Successfully established baseline data")
            print(f"📊 Total services: {summary['total_services']}")
            print(f"🔢 Total IP ranges: {summary['total_ip_ranges']}")
            print("🎯 Next weekly run will detect changes from this baseline")
        else:
            logging.info("=== Update completed successfully ===")
            print(f"✅ Successfully updated Azure Service Tags data")
            print(f"📊 Total services: {summary['total_services']}")
            print(f"🔢 Total IP ranges: {summary['total_ip_ranges']}")
            print(f"📈 Changes detected: {summary['changes_this_week']}")
            
            if changes:
                print(f"🔄 IP changes: {summary['ip_changes']}")
                print(f"➕ New services: {summary['service_additions']}")
                print(f"➖ Removed services: {summary['service_removals']}")
            else:
                print("✨ No changes detected this week")
            
    except Exception as e:
        logging.error(f"Update failed: {e}")
        raise

if __name__ == "__main__":
    main()