"""Freeze this installation's spectra into one committable file.

    conda run -n astronomy python export_spectra.py
    # writes spectra.json

Why it exists: `/data.json` is built live off the pipeline's `output/`, and
that payload carries things that are nobody's business on GitHub -- the
capture filenames, which are timestamps; the job ids, which are the folder
names; the observation dates; and the site latitude and longitude, which is
where the observer lives. None of it is needed to ask a question about a
spectrum.

So this writes the curves and nothing else. With `spectra.json` present the
quiz app prefers it and never reads `output/` at all, which is also what makes
the directory work as a clone: somebody else gets the spectra without getting
the 11GB of frames they came from.

What survives, per star:

    name          the target name, which is a star's name
    star_id       the catalogue identifier, so it can stand on the sky
    sptype        the stated type
    measured, mk  what the pipeline made of it
    snr
    spectrum      {wave, norm, class_letter} -- the normalised curve

What does not: folder, job_id, source, date_obs, site_lat, site_lon, and the
paths to any figure. `--check` re-reads the result and says so.
"""

import argparse
import json
import os
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
SPECTRA_DIR = os.path.abspath(
    os.environ.get('SPECTRA_DIR', os.path.join(APP_DIR, '..', 'spectra_webapp')))
OUT_FILE = os.path.join(APP_DIR, 'spectra.json')

# Everything the live payload carries that identifies the observer, their
# machine or their night. Checked for by name on the way out, so a field
# added to the pipeline later cannot quietly ride along: anything not on the
# KEEP list below is dropped, and these are named again in --check.
FORBIDDEN = ('folder', 'job_id', 'source', 'date_obs', 'site_lat', 'site_lon',
             'figure', 'path', 'dir', 'file', 'host', 'user')

KEEP = ('name', 'star_id', 'sptype', 'measured', 'mk', 'snr')


def _round(seq, nd):
    out = []
    for v in seq or ():
        if v is None or isinstance(v, str):
            out.append(None)
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            out.append(None)
            continue
        out.append(None if f != f else round(f, nd))       # NaN -> null
    return out


def export(spectra_dir, out_file):
    sys.path.insert(0, spectra_dir)
    import sky_data
    import sky_names

    output_dir = os.path.join(spectra_dir, 'output')
    sky_data.OUTPUT_DIR = output_dir

    with open(os.path.join(spectra_dir, 'sky_catalog.json')) as fh:
        cat = json.load(fh)

    obs = sky_data.collect(output_dir)
    placed = sky_names.resolve([t['name'] for t in obs['targets']],
                               cat.get('stars') or [], cat.get('aliases') or {})

    stars, skipped = [], 0
    for t in obs['targets']:
        r = t['run']
        spec = sky_data.spectrum(r['folder'])
        if not spec or not spec.get('wave') or len(spec['wave']) < 8:
            skipped += 1
            continue
        row = {k: (t.get(k) if k == 'name' else r.get(k)) for k in KEEP}
        row['name'] = t['name']
        row['star_id'] = placed.get(t['name'])
        # Three decimals on a normalised flux is well under the noise of any
        # of these frames, and a tenth of an angstrom is far finer than the
        # 55A resolution -- so this is rounding, not throwing anything away,
        # and it takes the file down by about two thirds.
        row['spectrum'] = {
            'wave': _round(spec.get('wave'), 1),
            'norm': _round(spec.get('norm'), 3),
            'class_letter': spec.get('class_letter'),
            'derived': bool(spec.get('derived')),
        }
        stars.append(row)

    stars.sort(key=lambda s: s['name'].lower())
    doc = {
        'source': 'SA100 spectrum pipeline',
        'n_stars': len(stars),
        'note': ('Normalised spectra only. No capture filenames, job ids, '
                 'observation dates or site coordinates -- see '
                 'export_spectra.py.'),
        'stars': stars,
    }
    with open(out_file, 'w') as fh:
        json.dump(doc, fh, separators=(',', ':'))
    return doc, skipped


def check(out_file):
    """Read the file back and prove the private fields are not in it."""
    with open(out_file) as fh:
        raw = fh.read()
    doc = json.loads(raw)
    bad = []
    for s in doc['stars']:
        for k in s:
            if k not in KEEP and k != 'spectrum':
                bad.append(f'unexpected field {k!r} on {s["name"]}')
            if any(f in k.lower() for f in FORBIDDEN):
                bad.append(f'private field {k!r} on {s["name"]}')
    # and no value that looks like one of this pipeline's folder names or a
    # capture filename, wherever it might have been copied to
    import re
    for pat, what in ((r'\.ser\b', 'a capture filename'),
                      (r'CapObj', 'a capture filename'),
                      (r'/Users/|/home/|[A-Z]:\\\\', 'an absolute path'),
                      (r'\d{4}-\d{2}-\d{2}T\d{2}:', 'an observation timestamp'),
                      (r'_[0-9a-f]{12}\b', 'a job id')):
        if re.search(pat, raw):
            bad.append(f'the file contains {what}')
    return doc, bad


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true',
                    help='only re-read spectra.json and report what is in it')
    ap.add_argument('--out', default=OUT_FILE)
    a = ap.parse_args()

    if not a.check:
        if not os.path.isdir(SPECTRA_DIR):
            sys.exit(f'no installation at {SPECTRA_DIR} '
                     f'(set SPECTRA_DIR)')
        doc, skipped = export(SPECTRA_DIR, a.out)
        size = os.path.getsize(a.out)
        print(f'{doc["n_stars"]} spectra -> {a.out}  ({size / 1024:.0f} KB)')
        if skipped:
            print(f'{skipped} run(s) had no usable curve and were left out')

    doc, bad = check(a.out)
    letters = {}
    for s in doc['stars']:
        L = (s['spectrum'].get('class_letter')
             or (s.get('sptype') or '?')[:1] or '?').upper()
        letters[L] = letters.get(L, 0) + 1
    print('by class: ' + ' '.join(f'{k}{v}' for k, v in sorted(letters.items())))
    print('fields kept: ' + ', '.join(KEEP) + ', spectrum')
    if bad:
        print('\nPROBLEMS:')
        for b in bad:
            print('  ' + b)
        sys.exit(1)
    print('no capture names, job ids, dates, paths or site coordinates.')
