"""The constellation quiz: a standalone sky that asks questions about itself.

This is its own application. The spectrum pipeline next door does not import
it, route to it, or know it exists -- nothing over there has to decide whether
this is switched on. The dependency runs one way only, and it is a read:

    constellation_quiz  ---reads--->  spectra_webapp/

and it is optional. Point SPECTRA_DIR at an installation and the sky gains the
stars that installation has spectra for -- the halo, the pulsing ring and the
click-through to the reduction. Point it at nothing and the page is a pure
constellation quiz, which is what it is for.

    conda run -n astronomy python quiz_app.py
    # http://127.0.0.1:5322/

Run it on its own port so both can be up at once: the quiz is the thing you
hand to somebody, and the pipeline is the thing you are working in.
"""

import datetime
import glob
import json
import os
import re
import sys

from flask import Flask, jsonify, send_from_directory, abort

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# The installation to borrow a sky from. An absolute path in the environment
# wins, then the sibling checkout, and if neither is there the quiz runs on
# its own catalogue copy -- see _catalog() below.
SPECTRA_DIR = os.path.abspath(
    os.environ.get('SPECTRA_DIR', os.path.join(APP_DIR, '..', 'spectra_webapp')))

PORT = int(os.environ.get('QUIZ_PORT', 5322))

# Loopback unless asked otherwise, which is the whole of the security policy
# here: the default binding is reachable only from this machine, and the only
# way to widen it is to say so.
#
# The reason to widen it is a phone. There is no way to find out how this
# reads on a small screen from the machine it is being written on -- a browser
# narrowed to 390px is a guess at a layout and says nothing at all about
# whether a finger can turn the sky. QUIZ_HOST=0.0.0.0 puts it on the local
# network so the device itself can answer that:
#
#     QUIZ_HOST=0.0.0.0 conda run -n astronomy python quiz_app.py
#
# That serves the catalogue, the spectra and anything under the installation's
# output/ to everything on the same wifi, so it is a thing to switch on for an
# afternoon of testing rather than to leave in a shell profile.
HOST = os.environ.get('QUIZ_HOST', '127.0.0.1')

# `sky_data` (which run represents a star) and `sky_names` (typed name ->
# catalogue identifier) are the two pieces of the sky that are not in the
# page, and both are stdlib-only -- json, os, re between them. They are
# imported from the installation rather than copied here on purpose: they
# encode rules that drift the moment there are two copies, and the copy that
# would drift is the one nobody is running while they reduce a night.
sky_data = sky_names = None
if os.path.isdir(SPECTRA_DIR):
    sys.path.insert(0, SPECTRA_DIR)
    try:
        import sky_data
        import sky_names
        # collect() takes the directory, but spectrum() reads a module global,
        # so point that at the installation too rather than at ours.
        sky_data.OUTPUT_DIR = os.path.join(SPECTRA_DIR, 'output')
    except Exception as e:                  # a half-built install is not fatal
        print(f'[quiz] no observed layer: {e}', file=sys.stderr)
        sky_data = sky_names = None

OUTPUT_DIR = os.path.join(SPECTRA_DIR, 'output')

app = Flask(__name__, static_folder=None)


def _find(name):
    """The quiz's own copy of a data file, else the installation's.

    That order is what makes the directory shippable: drop sky_catalog.json in
    beside this file and it needs no pipeline at all, and leave it out and it
    tracks whatever the installation last built.
    """
    here = os.path.join(APP_DIR, name)
    if os.path.exists(here):
        return here
    there = os.path.join(SPECTRA_DIR, name)
    return there if os.path.exists(there) else None


def _load(name):
    path = _find(name)
    if not path:
        return None
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception as e:
        print(f'[quiz] could not read {path}: {e}', file=sys.stderr)
        return None


_EPHEM = {}


def _solar_track(year, lat, lon):
    """Where each solar-system body stands at local midnight, day by day.

    Lifted from the sky view, and optional here in a way it is not there: a
    quiz about constellations does not need the planets, so if astropy is not
    importable this returns nothing and the page simply draws no planets --
    which is the same path it already takes for an installation whose
    ephemeris has no row for a body.

    Local midnight, not 00:00 UTC: mean solar midnight is 00:00 minus the
    longitude, and the Moon moves 13 degrees a day. And `get_body`'s RA/Dec is
    taken as it comes -- asking for `.icrs` would slide the origin back to the
    barycentre while keeping the distance, which is 1.2 degrees off for
    Neptune and 99 for the Moon.
    """
    key = (year, lat, lon)
    if key in _EPHEM:
        return _EPHEM[key]
    try:
        import numpy as np
        from astropy import units as u
        from astropy.coordinates import EarthLocation, get_body
        from astropy.time import Time
    except Exception as e:
        print(f'[quiz] no ephemeris ({e}); the planets stay off the sky',
              file=sys.stderr)
        _EPHEM[key] = {}
        return {}

    t = (Time(f'{year}-01-01T00:00:00', scale='utc')
         + np.arange(367) * u.day
         - ((lon or 0.0) / 15.0) * u.hour)
    loc = (EarthLocation(lat=lat * u.deg, lon=lon * u.deg)
           if lat is not None and lon is not None else None)
    out = {}
    for body in BODIES:
        try:
            b = get_body(body, t, loc)
            out[body] = [[round(float(r), 3), round(float(d), 3),
                          round(float(au), 4)]
                         for r, d, au in zip(b.ra.deg, b.dec.deg,
                                             b.distance.to(u.AU).value)]
        except Exception:
            continue                    # one body failing is not the sky
    _EPHEM[key] = out
    return out


# The nine the sky draws. Named here rather than imported, because the module
# that holds the list over there is 450KB of pipeline and this is a list of
# nine strings.
BODIES = ('sun', 'moon', 'mercury', 'venus', 'mars',
          'jupiter', 'saturn', 'uranus', 'neptune')


@app.route('/')
def page():
    return send_from_directory(APP_DIR, 'quiz.html')


@app.route('/data.json')
def data_json():
    """Everything the page draws, in one request.

    The same shape /sky/data.json serves, so the page's reader is the one the
    sky view already had. Both halves are optional and the page handles each
    being absent: no catalogue and it says how to build one, no observed layer
    and it is a quiz about constellations, which is the point of it.
    """
    cat = _load('sky_catalog.json')
    facts = (_load('star_facts.json') or {}).get('stars') or {}

    observed, conflicts, lat, lon = [], [], None, None
    # A frozen spectra.json wins over a live output/. It is the committed,
    # anonymous form -- curves and nothing else -- so a clone gets the sky
    # with the spectra in it and never reads, or needs, the installation. See
    # export_spectra.py for what it deliberately does not carry, the site
    # coordinates among it, which is why lat and lon stay None here.
    frozen = _load('spectra.json')
    if frozen and frozen.get('stars'):
        # `figure` survives the freeze now and job_id does not, which is
        # exactly the pair the page branches on: a bare slug and no job means
        # "the copy next to the payload", and the panel asks for it
        # relatively so it works baked and under Flask alike.
        observed = [dict(s, n_runs=1, pinned=False, contested_with=[],
                         figure=s.get('figure'),
                         job_id=None, folder=None, planet=None,
                         indices=None, rms=None, rv=None, rv_err=None,
                         date_obs=None, source=None, check=None, detail=None)
                    for s in frozen['stars']]
    elif sky_data is not None and os.path.isdir(OUTPUT_DIR):
        try:
            observed, conflicts, lat, lon = _observed(cat)
        except Exception as e:            # a bad run must not take the sky down
            print(f'[quiz] observed layer failed: {e}', file=sys.stderr)

    year = datetime.date.today().year
    return jsonify({
        'catalog': cat,
        'observed': observed,
        'facts': facts,
        'conflicts': conflicts,
        'solar_system': list(BODIES),
        'catalog_missing': cat is None,
        'site_lat': lat, 'site_lon': lon,
        'ephemeris': {'year': year, 'bodies': _solar_track(year, lat, lon)},
    })


def _observed(cat):
    """The installation's own stars, read fresh off its output/ every request.

    No cache, for the same reason the sky view has none: a run that finished a
    minute ago should be one reload away, and there is nothing here to
    invalidate.
    """
    obs = sky_data.collect(OUTPUT_DIR)
    placed = sky_names.resolve([t['name'] for t in obs['targets']],
                               (cat or {}).get('stars') or [],
                               (cat or {}).get('aliases') or {})
    out = []
    for t in obs['targets']:
        r = t['run']
        folder = os.path.join(OUTPUT_DIR, r['folder'])
        out.append({
            'name': t['name'],
            'star_id': placed.get(t['name']),
            'sptype': r['sptype'],
            'measured': r['measured'], 'indices': r['indices'], 'mk': r['mk'],
            'snr': r['snr'], 'rms': r['rms'],
            'rv': r['rv'], 'rv_err': r['rv_err'],
            'date_obs': r['date_obs'], 'source': r['source'],
            'check': r['check'], 'detail': r['detail'],
            'planet': r['planet'],
            'job_id': r['job_id'], 'folder': r['folder'],
            'n_runs': t['n_runs'], 'pinned': t['pinned'],
            'contested_with': t['contested_with'],
            'spectrum': sky_data.spectrum(r['folder']),
            'figure': ('stage3_colorfill.png'
                       if os.path.exists(
                           os.path.join(folder, 'stage3_colorfill.png'))
                       else None),
        })
    lats = sorted(t['run']['site_lat'] for t in obs['targets']
                  if t['run'].get('site_lat') is not None)
    lons = sorted(t['run']['site_lon'] for t in obs['targets']
                  if t['run'].get('site_lon') is not None)
    return (out, obs['conflicts'],
            lats[len(lats) // 2] if lats else None,
            lons[len(lons) // 2] if lons else None)


@app.route('/spectra/<name>')
def frozen_figure(name):
    """A figure out of the frozen spectra_figures/, for the panel.

    The static build copies this directory next to data.json and Pages serves
    it as a file; under Flask this is the same directory served by the same
    relative URL, so the page has one spelling and no branch.

    `name` arrives from the page, and a path is not a promise: only a bare
    slug is answered, which is the shape export_spectra.py writes and
    --check enforces.
    """
    if not re.match(r'^[a-z0-9][a-z0-9-]*\.webp$', name or ''):
        abort(404)
    return send_from_directory(os.path.join(APP_DIR, 'spectra_figures'), name)


@app.route('/results/<job_id>/<path:name>')
def results(job_id, name):
    """The pipeline's own output for one run: the stage-3 figure the detail
    panel shows, and the results.json it links to.

    Read-only and confined to that installation's output/, which is checked
    rather than assumed -- `name` arrives from the page, and a path is not a
    promise. The job-to-folder map lives in the pipeline's memory, so this
    recovers the folder off disk the way that app does after a restart.
    """
    if sky_data is None:
        abort(404)
    hits = glob.glob(os.path.join(OUTPUT_DIR, f'*_{job_id}'))
    folder = hits[0] if hits else os.path.join(OUTPUT_DIR, job_id)
    root = os.path.realpath(OUTPUT_DIR)
    target = os.path.realpath(os.path.join(folder, name))
    if not target.startswith(root + os.sep) or not os.path.isfile(target):
        abort(404)
    return send_from_directory(os.path.dirname(target),
                               os.path.basename(target))


if __name__ == '__main__':
    if os.path.exists(os.path.join(APP_DIR, 'spectra.json')):
        where = 'spectra.json (frozen, no installation read)'
    elif sky_data:
        where = SPECTRA_DIR
    else:
        where = 'none — constellations only'
    print(f'[quiz] spectra: {where}')
    print(f'[quiz] http://127.0.0.1:{PORT}/')
    # Bound wider than loopback: say so, and say where, because the address a
    # phone needs is this machine's on the LAN and not the one printed above.
    if HOST not in ('127.0.0.1', 'localhost'):
        import socket
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(('192.0.2.1', 1))      # TEST-NET-1: routed nowhere
            lan = probe.getsockname()[0]
            probe.close()
        except Exception:
            lan = None
        print(f'[quiz] bound to {HOST} — reachable from this network'
              + (f' at http://{lan}:{PORT}/' if lan else ''))
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
