#!/usr/bin/env python3
"""Generate one static, crawlable page per Azure service tag plus sitemap.xml.

Reads docs/data/current.json and docs/data/changes/*-changes.json; writes
docs/tag/<TagName>/index.html, docs/tag/index.html and docs/sitemap.xml.
Output is deterministic (no build timestamps) so only tags that changed get
new bytes in git. Pages for tags Microsoft no longer publishes are deleted.

Run: python scripts/build_tag_pages.py
"""
import json
import shutil
import sys
from collections import defaultdict
from html import escape
from pathlib import Path

SITE = 'https://azuretags.egbcorporate.org'
DOCS = Path(__file__).resolve().parent.parent / 'docs'
# ponytail: prefix-level diffs only for the newest changes keep pages (and daily git churn) small;
# older rows show counts and link to the full history page.
DETAIL_ROWS = 8


def load_inputs(docs):
    data = docs / 'data'
    current = json.loads((data / 'current.json').read_text())
    regions = json.loads((data / 'regions.json').read_text())
    events = defaultdict(list)  # tag -> [(date, change)], oldest first
    for f in sorted((data / 'changes').glob('2*-changes.json')):
        doc = json.loads(f.read_text())
        for c in doc['changes']:
            events[c['service']].append((doc['date'], c))
    return current, regions, events


def tag_facts(tag, events, regions):
    props = tag['properties']
    prefixes = props['addressPrefixes']
    hist = events.get(tag['id'], [])
    first = next((d for d, c in hist if c['type'] == 'service_added'), None)
    ip_changes = [(d, c) for d, c in hist if c['type'] == 'ip_changes']
    region = props.get('region') or ''
    return {
        'id': tag['id'],
        'v4': [p for p in prefixes if ':' not in p],
        'v6': [p for p in prefixes if ':' in p],
        'region': region,
        'region_name': regions.get(region, region),
        'system_service': props.get('systemService') or '',
        'change_number': props.get('changeNumber'),
        'first_seen': first,
        'changes': ip_changes,
        'last_changed': ip_changes[-1][0] if ip_changes else first,
    }


NAV_LINKS = [('/', '🏠 Home'), ('/history.html', '📅 Change History'),
             ('/analytics.html', '📊 Analytics'), ('/tag/', '🏷️ Service Tags')]


def head(title, desc, path, extra=''):
    url = SITE + path
    links = ' '.join(f'<a href="{h}" class="nav-link{" active" if h == "/tag/" else ""}">{t}</a>' for h, t in NAV_LINKS)
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(title)}</title>
<meta name="description" content="{escape(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{escape(desc)}">
<meta property="og:image" content="{SITE}/assets/preview.png">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>☁️</text></svg>">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/navigation.css">
<link rel="stylesheet" href="/css/tag.css">
<script src="/js/tag.js" defer></script>
{extra}</head>
<body id="top">
<nav class="main-nav"><div class="nav-container">
<a href="/" class="nav-brand">Azure IP Ranges &amp; Service Tags — Tracker</a>
<div class="nav-links">{links}</div>
</div></nav>
<main class="main-content page-content"><div class="container">
'''


FOOT = '''</div></main>
<a href="#top" class="to-top" aria-label="Back to top">↑</a>
<footer class="footer">
<div class="footer-content">
<div class="footer-section"><h4>Data Source</h4><p><a href="https://www.microsoft.com/en-us/download/details.aspx?id=56519" rel="noopener">Microsoft Azure IP Ranges and Service Tags – Public Cloud</a></p></div>
<div class="footer-section"><h4>Automation</h4><p>Updated daily via GitHub Actions</p></div>
<div class="footer-section"><h4>Open Source</h4><p><a href="https://github.com/eliaquimbrandao/azure-service-tags-tracker" rel="noopener">View Source Code</a></p></div>
</div>
<div class="footer-bottom"><p>&copy; 2025 Azure Service Tags &amp; IP Ranges Tracker | Built with ❤️ for the Azure community | Not affiliated with Microsoft</p></div>
</footer>
</body>
</html>
'''


def plural(n, word):
    return f'{n:,} {word}{"" if n == 1 else "es" if word.endswith("x") else "s"}'


def ld_script(*items):
    ld = json.dumps({'@context': 'https://schema.org', '@graph': list(items)}, ensure_ascii=False)
    return f'<script type="application/ld+json">{ld.replace("<", chr(92) + "u003c")}</script>\n'  # can't close the <script>


def page_header(h1, subtitle, crumbs):
    """crumbs: [(name, url)], last one is the current page."""
    trail = ' <span aria-hidden="true">›</span> '.join(
        f'<a href="{u}">{escape(n)}</a>' for n, u in crumbs[:-1])
    trail += f' <span aria-hidden="true">›</span> <span aria-current="page">{escape(crumbs[-1][0])}</span>'
    ld = {'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i, 'name': n, 'item': SITE + u} for i, (n, u) in enumerate(crumbs, 1)]}
    return (f'<nav class="crumbs" aria-label="Breadcrumb">{trail}</nav>\n'
            f'<header class="page-header"><h1>{h1}</h1><p class="page-subtitle">{subtitle}</p></header>\n'), ld


def prefix_block(key, label, prefixes):
    copy = f'<button type="button" class="copy-btn" data-copy="{key}-list">📋 Copy</button>' if prefixes else ''
    body = (f'<pre id="{key}-list">{escape(chr(10).join(prefixes))}</pre>' if prefixes
            else '<p class="muted">None published.</p>')
    return (f'<section class="tag-card" id="{key}"><div class="card-head">'
            f'<h2>{label} <span class="muted">({len(prefixes):,})</span></h2>{copy}</div>\n{body}</section>\n')


def render_tag(f, related, parent):
    tid = f['id']
    path = f'/tag/{tid}/'
    where = f' in {f["region_name"]}' if f['region'] else ''
    title = f'{tid} IP Ranges – Azure Service Tag'
    desc = (f'Current IP address ranges for the Azure service tag {tid}{where}: '
            f'{plural(len(f["v4"]), "IPv4 prefix")} and {plural(len(f["v6"]), "IPv6 prefix")}. '
            f'Change history{" since " + f["first_seen"] if f["first_seen"] else ""}, '
            f'last changed {f["last_changed"] or "never"}.')
    crumbs = [('Home', '/'), ('Service Tags', '/tag/')] + ([(parent, f'/tag/{parent}/')] if parent else []) + [(tid, path)]
    header, crumb_ld = page_header(f'🏷️ {escape(tid)}',
                                   f'Azure service tag IP ranges · {escape(f["region_name"]) if f["region"] else "Global"}', crumbs)
    dataset = {'@type': 'Dataset', 'name': f'{tid} Azure service tag IP ranges', 'description': desc,
               'url': SITE + path, 'isAccessibleForFree': True,
               **({'dateModified': f['last_changed']} if f['last_changed'] else {}),
               'license': 'https://www.microsoft.com/en-us/download/details.aspx?id=56519',
               'creator': {'@type': 'Organization', 'name': 'Microsoft'}}
    out = [head(title, desc, path, ld_script(dataset, crumb_ld)), header]
    out.append(f'<p class="lead tag-card">The <code>{escape(tid)}</code> service tag{escape(where)} currently contains '
               f'<strong>{plural(len(f["v4"]), "IPv4 prefix")}</strong> and <strong>{plural(len(f["v6"]), "IPv6 prefix")}</strong>. '
               f'Use it in Network Security Groups, Azure Firewall rules and user-defined routes instead of hard-coding these addresses, '
               f'or copy the ranges below for firewalls outside Azure.</p>\n')
    facts = [('Region', f'{escape(f["region_name"])} <code>{escape(f["region"])}</code>' if f['region'] else 'Global'),
             ('System service', f'<code>{escape(f["system_service"])}</code>' if f['system_service'] else '—'),
             ('Tag changeNumber', escape(str(f['change_number']))),
             ('Tracked since', f['first_seen'] or '—'),
             ('Last changed', f['last_changed'] or '—'),
             ('Recorded changes', str(len(f['changes'])))]
    out.append('<div class="stats">' + ''.join(f'<div class="stat"><span>{k}</span><strong>{v}</strong></div>' for k, v in facts) + '</div>\n')
    jumps = [('ipv4', f'IPv4 ({len(f["v4"]):,})'), ('ipv6', f'IPv6 ({len(f["v6"]):,})'),
             ('history', f'Change history ({len(f["changes"])})')] + ([('related', f'Related tags ({len(related)})')] if related else [])
    out.append('<nav class="jump" aria-label="On this page"><span>Jump to:</span>' +
               ''.join(f'<a href="#{k}">{v}</a>' for k, v in jumps) + '</nav>\n')
    out.append('<div class="ip-grid">\n' + prefix_block('ipv4', 'IPv4 address ranges', f['v4'])
               + prefix_block('ipv6', 'IPv6 address ranges', f['v6']) + '</div>\n')
    out.append('<section class="tag-card" id="history"><h2>Change history</h2>\n')
    if not f['changes']:
        out.append(f'<p class="muted">No IP range changes recorded since tracking began{" on " + f["first_seen"] if f["first_seen"] else ""}.</p>\n')
    else:
        out.append('<div class="scroll"><table><thead><tr><th>Date</th><th>Added</th><th>Removed</th><th>Prefixes</th></tr></thead><tbody>\n')
        for i, (date, c) in enumerate(reversed(f['changes'])):
            add, rem = c.get('added_prefixes', []), c.get('removed_prefixes', [])
            if i < DETAIL_ROWS:
                detail = ''.join(f'<div class="add">+ {escape(p)}</div>' for p in add) + \
                    ''.join(f'<div class="rem">− {escape(p)}</div>' for p in rem)
                detail = f'<details><summary>Show</summary>{detail}</details>'
            else:
                detail = f'<a href="/history.html?search={tid}">Full history</a>'
            out.append(f'<tr><td>{date}</td><td class="add">+{len(add)}</td>'
                       f'<td class="rem">−{len(rem)}</td><td>{detail}</td></tr>\n')
        out.append('</tbody></table></div>\n')
    out.append('</section>\n')
    if related:
        out.append('<section class="tag-card" id="related"><h2>Related service tags</h2>\n<ul class="chips">' +
                   ''.join(f'<li><a href="/tag/{r}/">{escape(r)}</a></li>' for r in related) + '</ul></section>\n')
    out.append(FOOT)
    return ''.join(out)


def render_index(facts):
    families = defaultdict(list)
    for f in facts:
        families[f['id'].split('.')[0]].append(f)
    title = 'All Azure Service Tags – IP Ranges by Tag'
    desc = (f'Browse all {len(facts):,} Azure service tags with their current IPv4 and IPv6 address ranges '
            'and change history, updated daily from Microsoft ServiceTags_Public.json.')
    header, crumb_ld = page_header('🏷️ Azure Service Tags',
                                   f'{len(facts):,} tags across {len(families):,} services — current IP ranges and change history',
                                   [('Home', '/'), ('Service Tags', '/tag/')])
    letters = {}
    for base in families:
        letters.setdefault(base[0].upper(), base)
    out = [head(title, desc, '/tag/', ld_script(crumb_ld)), header,
           f'<p class="lead tag-card">{escape(desc)} Each service groups its global tag and regional variants; '
           'open one to see its tags, or type in the filter.</p>\n',
           '<div class="tag-card tag-tools"><label for="tagFilter">🔍 Find a service tag</label>'
           '<input type="search" id="tagFilter" autocomplete="off" '
           'placeholder="e.g. Storage.WestEurope, AzureFrontDoor, East US">'
           '<p id="filterCount" class="muted" aria-live="polite"></p>'
           '<nav class="az" aria-label="Jump to letter">' +
           ''.join(f'<a href="#f-{b}">{l}</a>' for l, b in letters.items()) + '</nav></div>\n']
    for base, tags in families.items():
        last = max((t['last_changed'] for t in tags if t['last_changed']), default=None)
        out.append(f'<details class="family tag-card" id="f-{base}"><summary><strong>{escape(base)}</strong>'
                   f'<span class="muted">{plural(len(tags), "tag")}{" · last changed " + last if last else ""}</span></summary>\n'
                   '<div class="scroll"><table><thead><tr><th>Service tag</th><th>Region</th>'
                   '<th>IPv4</th><th>IPv6</th><th>Last changed</th></tr></thead><tbody>\n')
        for f in tags:
            out.append(f'<tr><td><a href="/tag/{f["id"]}/">{escape(f["id"])}</a></td><td>{escape(f["region_name"]) or "Global"}</td>'
                       f'<td>{len(f["v4"]):,}</td><td>{len(f["v6"]):,}</td><td>{f["last_changed"] or "—"}</td></tr>\n')
        out.append('</tbody></table></div></details>\n')
    out.append(FOOT)
    return ''.join(out)


def render_sitemap(facts):
    newest = max((f['last_changed'] for f in facts if f['last_changed']), default=None)
    lm = f'<lastmod>{newest}</lastmod>' if newest else ''
    urls = [f'<url><loc>{SITE}/</loc>{lm}<priority>1.00</priority></url>',
            f'<url><loc>{SITE}/history.html</loc>{lm}<priority>0.80</priority></url>',
            f'<url><loc>{SITE}/analytics.html</loc>{lm}<priority>0.80</priority></url>',
            f'<url><loc>{SITE}/tag/</loc>{lm}<priority>0.80</priority></url>']
    for f in facts:
        lm = f'<lastmod>{f["last_changed"]}</lastmod>' if f['last_changed'] else ''
        urls.append(f'<url><loc>{SITE}/tag/{f["id"]}/</loc>{lm}<priority>0.60</priority></url>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '\n'.join(urls) + '\n</urlset>\n')


def write_if_changed(path, text):
    if not path.exists() or path.read_text() != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


def build(docs=DOCS):
    current, regions, events = load_inputs(docs)
    facts = sorted((tag_facts(t, events, regions) for t in current['values']), key=lambda f: f['id'].lower())
    for f in facts:  # ids become URL path segments
        if not f['id'] or not all(ch.isalnum() or ch in '._-' for ch in f['id']):
            sys.exit(f'Unsafe service tag id for a URL: {f["id"]!r}')
    families = defaultdict(list)
    for f in facts:
        families[f['id'].split('.')[0]].append(f['id'])
    tag_dir = docs / 'tag'
    ids = {f['id'] for f in facts}
    if tag_dir.exists():
        for d in tag_dir.iterdir():
            if d.is_dir() and d.name not in ids:
                shutil.rmtree(d)
    for f in facts:
        # A parent tag (Storage) lists its regional variants; a variant (Storage.WestEurope)
        # links back to its parent only, so pages don't each repeat the whole family.
        base = f['id'].split('.')[0]
        parent = base if base != f['id'] and base in ids else None
        related = [parent] if parent else [r for r in families[base] if r != f['id']]
        write_if_changed(tag_dir / f['id'] / 'index.html', render_tag(f, related, parent))
    write_if_changed(tag_dir / 'index.html', render_index(facts))
    write_if_changed(docs / 'sitemap.xml', render_sitemap(facts))
    return facts


if __name__ == '__main__':
    print(f'✅ Built {len(build()):,} service tag pages and sitemap.xml')
