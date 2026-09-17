"""Bake the quiz into a static site, for GitHub Pages or any plain file host.

    conda run -n astronomy python build_pages.py
    conda run -n astronomy python build_pages.py --check     # re-read it

Pages serves files. It does not serve Flask, so the two dynamic routes have to
become something or become nothing:

    GET /                 sends quiz.html      -> copied to index.html
    GET /data.json        assembles the sky    -> baked to a file, once
    GET /results/<job>/   the pipeline's own   -> nothing. See below.

The payload is assembled by asking the real app for it, through Flask's test
client, rather than by reassembling it here. That is the point: a second
implementation of /data.json is a second thing to keep in step, and the one
that would drift is the one nobody is running while they reduce a night. What
gets written is exactly what the server sends.

`/results/` is the one thing a static clone genuinely loses -- the click
through to a reduction's own output. The frozen spectra.json path already sets
`job_id` and `figure` to None and the page guards both, so the detail panel
simply omits the links rather than offering dead ones.

The planets are the honest caveat. `_solar_track()` computes the ephemeris for
the CURRENT year at request time, so a baked file is right for the year it was
built and drifts after. It is one command to rebuild. Meanwhile the page does
not pretend otherwise: it takes the slider's year from `ephemeris.year` in the
payload rather than from the browser's clock, and shows the year in the date
readout whenever the two disagree.
"""

import argparse
import gzip
import json
import os
import re
import shutil
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(APP_DIR, 'docs')

# The page has to ask for the payload by a RELATIVE path. On a project site it
# lives at you.github.io/<repo>/, so a leading slash resolves to
# you.github.io/data.json and 404s -- and it 404s silently into the page's own
# "could not load the sky" card, which looks like a broken build rather than a
# broken URL. Under Flask the page is served from `/`, so the relative form is
# correct there too and there is no branch anywhere.
WANT_FETCH = "fetch('data.json')"
BAD_FETCH = "fetch('/data.json')"

# Everything the live payload can carry that identifies the observer, their
# machine or their night. export_spectra.py names the same set on its way out;
# this is the second gate, on the file that actually gets published. A live
# output/ read -- no frozen spectra.json -- puts the capture folders, the job
# ids, the observation dates and the SITE COORDINATES into the payload, and
# this script's whole job is to put that payload on the public internet.
FORBIDDEN_STAR = ('folder', 'job_id', 'source', 'date_obs')
FORBIDDEN_TOP = ('site_lat', 'site_lon', 'site_elev_m')

# The same question asked of the BYTES, because the field check above only
# looks where the fields are expected to be: a path or a capture name copied
# into a note, a detail string or anything nested would go straight past it.
# `"site_...":null` is the frozen path saying it has nothing, and passes.
# catalog.built is a build date with no observation in it, so plain ISO dates
# are not on this list -- a capture's own timestamp arrives as a filename.
LEAK_PATTERNS = (
    (r'/Users/|/home/|[A-Za-z]:\\\\', 'an absolute path'),
    (r'\.ser\b|CapObj|\.avi\b|\.fit\b|\.png\b', 'a capture or figure filename'),
    (r'_[0-9a-f]{12}\b', 'a job id'),
    (r'"site_[a-z_]*":(?!null)', 'a site field with a value in it'),
)


def payload():
    """What the running app would serve at /data.json, without running it."""
    sys.path.insert(0, APP_DIR)
    import quiz_app
    with quiz_app.app.test_client() as c:
        r = c.get('/data.json')
    if r.status_code != 200:
        raise SystemExit(f'[pages] /data.json answered {r.status_code}')
    return r.get_json()


def audit(d):
    """Refuse to bake anything that names the observer or their sky.

    Not a warning. The output of this script is a directory whose only purpose
    is to be pushed somewhere public, and 'it printed something' is not a
    control on that.
    """
    bad = []
    for k in FORBIDDEN_TOP:
        if d.get(k) is not None:
            bad.append(f'{k} = {d[k]!r}')
    for s in d.get('observed') or ():
        for k in FORBIDDEN_STAR:
            if s.get(k) is not None:
                bad.append(f'observed[{s.get("name")!r}].{k} = {s[k]!r}')
    raw = json.dumps(d, separators=(',', ':'))
    for pat, what in LEAK_PATTERNS:
        m = re.search(pat, raw)
        if m:
            bad.append(f'{what}, somewhere in the payload: '
                       f'...{raw[max(0, m.start() - 40):m.end() + 40]}...')
    if bad:
        raise SystemExit(
            '[pages] refusing to bake: the payload carries fields that say '
            'where and when it was taken\n'
            + ''.join(f'    {b}\n' for b in sorted(set(bad))[:12])
            + '\n  This happens when the app is reading a live output/ rather '
              'than a frozen\n  spectra.json. Freeze it first:\n\n'
              '      conda run -n astronomy python export_spectra.py\n')


def page():
    src = os.path.join(APP_DIR, 'quiz.html')
    with open(src, encoding='utf-8') as fh:
        html = fh.read()
    if BAD_FETCH in html:
        raise SystemExit(
            f'[pages] quiz.html asks for {BAD_FETCH} -- absolute, so it '
            'resolves to\n  the domain root and 404s on a project site. It '
            f'wants {WANT_FETCH}, which is\n  also correct under Flask.')
    if WANT_FETCH not in html:
        raise SystemExit(
            f'[pages] quiz.html does not ask for {WANT_FETCH} at all -- '
            'nothing would load the sky.')
    return html


def build():
    d = payload()
    audit(d)
    if d.get('catalog_missing') or not d.get('catalog'):
        raise SystemExit(
            '[pages] no sky_catalog.json, so there is no sky to bake. Build '
            'one next door\n  (build_sky_catalog.py) or drop a copy beside '
            'this file.')
    html = page()

    os.makedirs(OUT_DIR, exist_ok=True)
    data_path = os.path.join(OUT_DIR, 'data.json')
    # Compact: this file is downloaded, not read. 1.3MB of pretty-printing is
    # 1.3MB somebody waits for.
    raw = json.dumps(d, separators=(',', ':')).encode('utf-8')
    with open(data_path, 'wb') as fh:
        fh.write(raw)
    with open(os.path.join(OUT_DIR, 'index.html'), 'w', encoding='utf-8') as fh:
        fh.write(html)
    # Jekyll is Pages' default and would try to render this as a site. There is
    # nothing here for it to do and one thing it can get wrong.
    open(os.path.join(OUT_DIR, '.nojekyll'), 'w').close()

    report(d, raw, html)


def report(d, raw, html):
    stars = len((d.get('catalog') or {}).get('stars') or ())
    figs = len((d.get('catalog') or {}).get('figures') or
               (d.get('catalog') or {}).get('constellations') or ())
    obs = len(d.get('observed') or ())
    eph = d.get('ephemeris') or {}
    bodies = eph.get('bodies') or {}
    gz = len(gzip.compress(raw, 9))
    print(f'[pages] docs/index.html  {len(html.encode("utf-8")) / 1024:7.0f} KB')
    print(f'[pages] docs/data.json   {len(raw) / 1024:7.0f} KB  '
          f'({gz / 1024:.0f} KB gzipped, which is what Pages sends)')
    print(f'[pages]   {stars} stars, {figs} figures, {obs} with a spectrum')
    if bodies:
        print(f'[pages]   ephemeris: {len(bodies)} bodies for {eph.get("year")} '
              f'-- right for {eph.get("year")}, and drifting after it')
    else:
        print('[pages]   ephemeris: none, so the page draws no planets')
    print()
    print('[pages] Point Pages at docs/ on the default branch:')
    print('[pages]   Settings -> Pages -> Deploy from a branch -> main, /docs')


def check():
    """Re-read what was written and say whether it would work."""
    bad = 0
    for name in ('index.html', 'data.json', '.nojekyll'):
        if not os.path.exists(os.path.join(OUT_DIR, name)):
            print(f'  MISSING  docs/{name}'); bad += 1
    if bad:
        raise SystemExit('[pages] run the build first')

    with open(os.path.join(OUT_DIR, 'index.html'), encoding='utf-8') as fh:
        html = fh.read()
    if WANT_FETCH not in html or BAD_FETCH in html:
        print(f'  FAIL     index.html does not ask for {WANT_FETCH}'); bad += 1
    with open(os.path.join(OUT_DIR, 'data.json'), 'rb') as fh:
        raw = fh.read()
    d = json.loads(raw)

    try:
        audit(d)
    except SystemExit as e:
        print('  FAIL     the baked payload names the observer'); print(e); bad += 1

    # The two files have to be about the same sky: a stale data.json next to a
    # fresh page is the failure mode a copy step has.
    live = json.loads(json.dumps(payload(), separators=(',', ':')))
    same_cat = (live.get('catalog') == d.get('catalog'))
    if not same_cat:
        print('  STALE    docs/data.json was built from a different catalogue'); bad += 1
    with open(os.path.join(APP_DIR, 'quiz.html'), encoding='utf-8') as fh:
        if fh.read() != html:
            print('  STALE    docs/index.html is not the current quiz.html'); bad += 1

    for k in ('catalog', 'facts', 'observed', 'ephemeris'):
        if k not in d:
            print(f'  FAIL     the payload has no {k}'); bad += 1

    if not bad:
        eph = d.get('ephemeris') or {}
        print(f'  ok       docs/ is current: {len(raw) / 1024:.0f} KB of sky, '
              f'planets for {eph.get("year")}, nothing that says where it was taken')
    raise SystemExit(1 if bad else 0)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true',
                    help='re-read docs/ and report rather than writing it')
    a = ap.parse_args()
    check() if a.check else build()
