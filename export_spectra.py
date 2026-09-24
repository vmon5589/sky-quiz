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
    figure        the filename of a converted copy of this run's stage-3
                  figure, in spectra_figures/ -- a bare slug off the STAR's
                  name, never the run folder's

What does not: folder, job_id, source, date_obs, site_lat, site_lon, and any
path into output/. `--check` re-reads the result and says so.

About the figures. The pipeline's own `stage3_colorfill.png` is the plot that
was actually looked at -- the wavelength-coloured fill, the line set, and the
raw smear strip cut along the trace this run extracted along. The page cannot
redraw it: the strip is sensor pixels, and the calibrated spectrum it would
need is 48 KB against 44 KB for the whole finished picture. So the figure is
copied rather than reproduced.

Two things happen on the way:

  * it is RE-ENCODED, 1400px wide WebP. Matplotlib writes 1775x745 RGBA PNG,
    about 140 KB, with an alpha channel nothing uses; this is about 44 KB and
    still 2x a panel on a retina screen. 46 stars go from 6.3 MB to 2.0 MB,
    and the library can treble before it costs what shipping it uncompressed
    would have cost today.
  * it is RENAMED. The run folder is
    `Kappa_Cassiopeiae_2026-09-16-0626_8-CapObj_598654cec279` -- the
    observation date, the capture time and the job id, which are three of the
    things this file exists to drop. The published name is `kappa-cas.webp`,
    off the star, and --check refuses anything that is not that shape.

The pixels themselves carry nothing: the only PNG metadata matplotlib writes
is its own version string, and the figure's title names the class and no
target, date or site.
"""

import argparse
import json
import os
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
SPECTRA_DIR = os.path.abspath(
    os.environ.get('SPECTRA_DIR', os.path.join(APP_DIR, '..', 'spectra_webapp')))
OUT_FILE = os.path.join(APP_DIR, 'spectra.json')
FIG_DIR = os.path.join(APP_DIR, 'spectra_figures')

# The pipeline figure worth publishing, and what it becomes.
SRC_FIGURE = 'stage3_colorfill.png'
FIG_WIDTH = 1400          # 2x a detail panel; every line label stays readable
FIG_QUALITY = 86
# The only shape a published figure filename may have. Anything with a date,
# a capture name, a job id or a directory separator in it fails this, which is
# the point: the field is a filename and never a path.
FIG_NAME_RE = r'^[a-z0-9][a-z0-9-]*\.webp$'

# Everything the live payload carries that identifies the observer, their
# machine or their night. Checked for by name on the way out, so a field
# added to the pipeline later cannot quietly ride along: anything not on the
# KEEP list below is dropped, and these are named again in --check.
FORBIDDEN = ('folder', 'job_id', 'source', 'date_obs', 'site_lat', 'site_lon',
             'figure', 'path', 'dir', 'file', 'host', 'user')

KEEP = ('name', 'star_id', 'sptype', 'measured', 'mk', 'snr')


def slug(name):
    """A star's name as a filename: 'Kappa Cassiopeiae' -> 'kappa-cas'.

    Off the NAME, never off the run folder, which carries the date and the
    job id. Deliberately lossy and deliberately dull -- it only has to be
    unique among these stars and to survive a URL.
    """
    import re as _re
    out = _re.sub(r'[^a-z0-9]+', '-', str(name).lower()).strip('-')
    return out or 'star'


def convert_figure(src, dest):
    """Re-encode one stage-3 figure as WebP, and drop the alpha with it.

    Returns False rather than raising when there is no figure to convert: a
    run that predates the colour-fill stage is a star without a picture, not
    a broken export.
    """
    if not os.path.isfile(src):
        return False
    from PIL import Image
    im = Image.open(src).convert('RGB')          # RGBA -> RGB: nothing uses it
    w = min(FIG_WIDTH, im.size[0])
    h = round(im.size[1] * w / im.size[0])
    im.resize((w, h), Image.LANCZOS).save(
        dest, 'WEBP', quality=FIG_QUALITY, method=6)
    return True


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


def export(spectra_dir, out_file, fig_dir=None):
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

    # Written fresh each run. A figure left behind from a target that is no
    # longer published is a file on the public internet that nothing links to
    # and nobody meant to send.
    if fig_dir:
        if os.path.isdir(fig_dir):
            for f in os.listdir(fig_dir):
                if f.endswith('.webp'):
                    os.remove(os.path.join(fig_dir, f))
        os.makedirs(fig_dir, exist_ok=True)

    stars, skipped, figs, used = [], 0, 0, {}
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
        if fig_dir:
            # Two targets could slug the same way; the second gets a suffix
            # rather than quietly overwriting the first's picture.
            base = slug(t['name'])
            n = used.get(base, 0)
            used[base] = n + 1
            name = f'{base}.webp' if not n else f'{base}-{n + 1}.webp'
            src = os.path.join(output_dir, r['folder'], SRC_FIGURE)
            if convert_figure(src, os.path.join(fig_dir, name)):
                row['figure'] = name
                figs += 1
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
    return doc, skipped, figs


def check(out_file, fig_dir=None):
    """Read the file back and prove the private fields are not in it."""
    with open(out_file) as fh:
        raw = fh.read()
    doc = json.loads(raw)
    import re
    bad = []
    for s in doc['stars']:
        for k in s:
            if k not in KEEP and k not in ('spectrum', 'figure'):
                bad.append(f'unexpected field {k!r} on {s["name"]}')
            # `figure` is the one FORBIDDEN name that is allowed to survive,
            # and only as a bare slug: the reason it was forbidden is that it
            # used to be a path into output/, and this is what says it is not
            # one any more.
            if k != 'figure' and any(f in k.lower() for f in FORBIDDEN):
                bad.append(f'private field {k!r} on {s["name"]}')
        fig = s.get('figure')
        if fig is not None and not re.match(FIG_NAME_RE, str(fig)):
            bad.append(f'figure {fig!r} on {s["name"]} is not a bare slug')
        if fig and fig_dir and not os.path.isfile(os.path.join(fig_dir, fig)):
            bad.append(f'figure {fig!r} on {s["name"]} is named but missing')
    # ...and no file in the figure directory that nothing points at, which is
    # how a picture of a target that is no longer published stays on disk and
    # gets pushed anyway.
    if fig_dir and os.path.isdir(fig_dir):
        named = {s.get('figure') for s in doc['stars'] if s.get('figure')}
        for f in sorted(os.listdir(fig_dir)):
            if f.endswith('.webp') and f not in named:
                bad.append(f'{f} is in {os.path.basename(fig_dir)}/ '
                           f'and no star names it')

    # and no value that looks like one of this pipeline's folder names or a
    # capture filename, wherever it might have been copied to
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
    ap.add_argument('--figures', default=FIG_DIR,
                    help='where the converted stage-3 figures go')
    ap.add_argument('--no-figures', action='store_true',
                    help='curves only, the way this script used to work')
    a = ap.parse_args()
    fig_dir = None if a.no_figures else a.figures

    if not a.check:
        if not os.path.isdir(SPECTRA_DIR):
            sys.exit(f'no installation at {SPECTRA_DIR} '
                     f'(set SPECTRA_DIR)')
        doc, skipped, figs = export(SPECTRA_DIR, a.out, fig_dir)
        size = os.path.getsize(a.out)
        print(f'{doc["n_stars"]} spectra -> {a.out}  ({size / 1024:.0f} KB)')
        if skipped:
            print(f'{skipped} run(s) had no usable curve and were left out')
        if fig_dir:
            tot = sum(os.path.getsize(os.path.join(fig_dir, f))
                      for f in os.listdir(fig_dir) if f.endswith('.webp'))
            print(f'{figs} figures -> {fig_dir}  '
                  f'({tot / 1048576:.1f} MB, {tot / max(figs, 1) / 1024:.0f} KB each)')

    doc, bad = check(a.out, fig_dir)
    letters = {}
    for s in doc['stars']:
        L = (s['spectrum'].get('class_letter')
             or (s.get('sptype') or '?')[:1] or '?').upper()
        letters[L] = letters.get(L, 0) + 1
    print('by class: ' + ' '.join(f'{k}{v}' for k, v in sorted(letters.items())))
    nfig = sum(1 for s in doc['stars'] if s.get('figure'))
    print('fields kept: ' + ', '.join(KEEP) + ', spectrum'
          + (f', figure ({nfig} of {len(doc["stars"])})' if nfig else ''))
    if bad:
        print('\nPROBLEMS:')
        for b in bad:
            print('  ' + b)
        sys.exit(1)
    print('no capture names, job ids, dates, paths or site coordinates'
          + (', and every figure is a bare slug' if nfig else '') + '.')
