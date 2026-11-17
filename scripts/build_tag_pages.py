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


def head(title, desc, path, extra=''):
    url = SITE + path
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
<link rel="stylesheet" href="/css/tag.css">
{extra}</head>
<body>
<header class="bar"><a href="/">☁️ Azure IP Ranges &amp; Service Tags Tracker</a>
<nav><a href="/tag/">All service tags</a> <a href="/history.html">Change history</a> <a href="/analytics.html">Analytics</a></nav></header>
<main>
'''


FOOT = '''</main>
<footer>Data: Microsoft <a href="https://www.microsoft.com/en-us/download/details.aspx?id=56519">Azure IP Ranges and Service Tags – Public Cloud</a> (ServiceTags_Public.json), collected daily. Not affiliated with Microsoft.</footer>
</body>
</html>
'''


def plural(n, word):
    return f'{n:,} {word}{"" if n == 1 else "es" if word.endswith("x") else "s"}'


def prefix_block(label, prefixes):
    if not prefixes:
        return f'<h2>{label}</h2>\n<p class="muted">None published.</p>\n'
    return f'<h2>{label} <span class="muted">({len(prefixes):,})</span></h2>\n<pre>{escape(chr(10).join(prefixes))}</pre>\n'


def render_tag(f, related):
    tid = f['id']
    where = f' in {f["region_name"]}' if f['region'] else ''
    title = f'{tid} IP Ranges – Azure Service Tag'
    desc = (f'Current IP address ranges for the Azure service tag {tid}{where}: '
            f'{plural(len(f["v4"]), "IPv4 prefix")} and {plural(len(f["v6"]), "IPv6 prefix")}. '
            f'Change history{" since " + f["first_seen"] if f["first_seen"] else ""}, '
            f'last changed {f["last_changed"] or "never"}.')
    ld = json.dumps({
        '@context': 'https://schema.org', '@type': 'Dataset',
        'name': f'{tid} Azure service tag IP ranges', 'description': desc,
        'url': f'{SITE}/tag/{tid}/', 'isAccessibleForFree': True,
        **({'dateModified': f['last_changed']} if f['last_changed'] else {}),
        'license': 'https://www.microsoft.com/en-us/download/details.aspx?id=56519',
        'creator': {'@type': 'Organization', 'name': 'Microsoft'},
    }, ensure_ascii=False).replace('<', '\\u003c')  # can't close the <script> or open a comment
    out = [head(title, desc, f'/tag/{tid}/', f'<script type="application/ld+json">{ld}</script>\n')]
    out.append(f'<h1>{escape(tid)} <small>Azure service tag IP ranges</small></h1>\n')
    out.append(f'<p class="lead">The <code>{escape(tid)}</code> service tag{escape(where)} currently contains '
               f'<strong>{plural(len(f["v4"]), "IPv4 prefix")}</strong> and <strong>{plural(len(f["v6"]), "IPv6 prefix")}</strong>. '
               f'Use it in Network Security Groups, Azure Firewall rules and user-defined routes instead of hard-coding these addresses, '
               f'or copy the ranges below for firewalls outside Azure.</p>\n')
    facts = [('Region', f'{escape(f["region_name"])} (<code>{escape(f["region"])}</code>)' if f['region'] else 'Global (all regions)'),
             ('System service', f'<code>{escape(f["system_service"])}</code>' if f['system_service'] else '—'),
             ('Tag changeNumber', escape(str(f['change_number']))),
             ('Tracked since', f['first_seen'] or '—'),
             ('Last changed', f['last_changed'] or '—'),
             ('Recorded changes', str(len(f['changes'])))]
    out.append('<dl class="facts">' + ''.join(f'<dt>{k}</dt><dd>{v}</dd>' for k, v in facts) + '</dl>\n')
    out.append(prefix_block('IPv4 address ranges', f['v4']))
    out.append(prefix_block('IPv6 address ranges', f['v6']))
    out.append('<h2>Change history</h2>\n')
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
    if related:
        out.append('<h2>Related service tags</h2>\n<ul class="cols">' +
                   ''.join(f'<li><a href="/tag/{r}/">{escape(r)}</a></li>' for r in related) + '</ul>\n')
    out.append(FOOT)
    return ''.join(out)


def render_index(facts):
    title = 'All Azure Service Tags – IP Ranges by Tag'
    desc = (f'Browse all {len(facts):,} Azure service tags with their current IPv4 and IPv6 address ranges '
            'and change history, updated daily from Microsoft ServiceTags_Public.json.')
    out = [head(title, desc, '/tag/'), f'<h1>All Azure service tags <small>{len(facts):,} tags</small></h1>\n',
           f'<p class="lead">{escape(desc)}</p>\n', '<div class="scroll"><table><thead><tr><th>Service tag</th><th>Region</th>'
           '<th>IPv4</th><th>IPv6</th><th>Last changed</th></tr></thead><tbody>\n']
    for f in facts:
        out.append(f'<tr><td><a href="/tag/{f["id"]}/">{escape(f["id"])}</a></td><td>{escape(f["region_name"]) or "Global"}</td>'
                   f'<td>{len(f["v4"]):,}</td><td>{len(f["v6"]):,}</td><td>{f["last_changed"] or "—"}</td></tr>\n')
    out.append('</tbody></table></div>\n' + FOOT)
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
        related = [base] if base != f['id'] and base in ids else [r for r in families[base] if r != f['id']]
        write_if_changed(tag_dir / f['id'] / 'index.html', render_tag(f, related))
    write_if_changed(tag_dir / 'index.html', render_index(facts))
    write_if_changed(docs / 'sitemap.xml', render_sitemap(facts))
    return facts


if __name__ == '__main__':
    print(f'✅ Built {len(build()):,} service tag pages and sitemap.xml')
