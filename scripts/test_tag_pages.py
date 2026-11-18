#!/usr/bin/env python3
"""Self-check for build_tag_pages.py on a tiny synthetic site.
Run: python scripts/test_tag_pages.py
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_tag_pages  # noqa: E402


def tag(name, prefixes, region=''):
    return {'name': name, 'id': name, 'properties': {
        'changeNumber': 3, 'region': region, 'systemService': 'Storage', 'addressPrefixes': prefixes}}


def changes(date, items):
    return {'date': date, 'changes': items}


with tempfile.TemporaryDirectory() as tmp:
    docs = Path(tmp)
    (docs / 'data' / 'changes').mkdir(parents=True)
    (docs / 'data' / 'current.json').write_text(json.dumps({'changeNumber': 9, 'values': [
        tag('Storage', ['10.0.0.0/24', '2603:1000::/48']),
        tag('Storage.WestEurope', ['10.0.0.0/25'], 'westeurope'),
    ]}))
    (docs / 'data' / 'regions.json').write_text(json.dumps({'westeurope': 'West Europe <EU>'}))
    (docs / 'data' / 'changes' / '2026-01-01-changes.json').write_text(json.dumps(changes('2026-01-01', [
        {'type': 'service_added', 'service': 'Storage'},
        {'type': 'service_added', 'service': 'Storage.WestEurope'}])))
    (docs / 'data' / 'changes' / '2026-02-01-changes.json').write_text(json.dumps(changes('2026-02-01', [
        {'type': 'ip_changes', 'service': 'Storage', 'added_prefixes': ['10.0.0.0/24'],
         'removed_prefixes': ['10.9.0.0/24']}])))
    stale = docs / 'tag' / 'RemovedTag'
    stale.mkdir(parents=True)
    (stale / 'index.html').write_text('old')

    facts = build_tag_pages.build(docs)
    assert [f['id'] for f in facts] == ['Storage', 'Storage.WestEurope']
    assert not stale.exists(), 'pages for tags Microsoft dropped must be deleted'

    page = (docs / 'tag' / 'Storage' / 'index.html').read_text()
    assert '<title>Storage IP Ranges – Azure Service Tag</title>' in page
    assert '1 IPv4 prefix</strong>' in page and '1 IPv6 prefix</strong>' in page
    assert '+ 10.0.0.0/24' in page and '− 10.9.0.0/24' in page, 'recent change shows prefix diff'
    assert 'href="/tag/Storage.WestEurope/"' in page, 'parent lists its regional variants'

    regional = (docs / 'tag' / 'Storage.WestEurope' / 'index.html').read_text()
    assert 'West Europe &lt;EU&gt;' in regional and '<EU>' not in regional, 'data is HTML-escaped'
    assert 'href="/tag/Storage/"' in regional, 'variant links to parent'
    assert '"@type": "BreadcrumbList"' in regional and '<a href="/tag/Storage/">Storage</a>' in regional, 'breadcrumb via parent'
    assert 'href="/css/style.css"' in regional and 'class="main-nav"' in regional, 'uses the site chrome'

    index = (docs / 'tag' / 'index.html').read_text()
    assert '<details class="family tag-card" id="f-Storage">' in index and '2 tags' in index, 'index groups tags by service'
    assert 'No IP range changes recorded since tracking began on 2026-01-01' in regional

    sitemap = (docs / 'sitemap.xml').read_text()
    assert '<loc>https://azuretags.egbcorporate.org/tag/Storage/</loc><lastmod>2026-02-01</lastmod>' in sitemap
    assert '<loc>https://azuretags.egbcorporate.org/tag/Storage.WestEurope/</loc><lastmod>2026-01-01</lastmod>' in sitemap

    # Deterministic: a rebuild with unchanged data rewrites nothing.
    before = {p: p.stat().st_mtime_ns for p in docs.rglob('*.html')}
    build_tag_pages.build(docs)
    assert before == {p: p.stat().st_mtime_ns for p in docs.rglob('*.html')}

    # Tag ids become URL paths; anything odd must stop the build.
    (docs / 'data' / 'current.json').write_text(json.dumps({'values': [tag('../evil', [])]}))
    try:
        build_tag_pages.build(docs)
        raise AssertionError('unsafe id accepted')
    except SystemExit:
        pass

print('✅ test_tag_pages passed')
