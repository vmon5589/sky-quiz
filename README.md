# Sky Quiz

A sky you can spin, that asks you questions about itself: name the
constellation, place a star, say where a planet stands on a given night. 1055
stars and 88 constellation figures, plus 46 real stellar spectra — measured
through an SA100 grating — that the page plots itself.

**Live: https://vmon5589.github.io/sky-quiz/** — nothing to install, works on a
phone.

## Run it locally

Python 3.9+ and Flask. `numpy` and `astropy` are optional: without them
everything works except the planets.

    pip install flask numpy astropy
    python quiz_app.py
    # http://127.0.0.1:5322/

`QUIZ_PORT` changes the port. `QUIZ_HOST=0.0.0.0` puts it on the local network
so a phone can reach it — that serves to everything on the same wifi, so it is
a thing to switch on for an afternoon rather than leave running.

## Or with no Python at all

`docs/` is the whole quiz as static files, which is what GitHub Pages serves:

    python3 -m http.server -d docs 8000
    # http://localhost:8000/

It has to be served rather than opened off disk — a `file://` page is not
allowed to fetch its own data.

## What is here

| | |
|---|---|
| `quiz.html` | the page: sky, questions, all of it |
| `quiz_app.py` | a small Flask server for it |
| `sky_catalog.json` | 1055 stars and 88 figures (SIMBAD + Stellarium) |
| `star_facts.json` | temperatures, distances, variability |
| `spectra.json` | 46 measured spectra, curves only |
| `docs/` | the same quiz baked static, for Pages |
| `test_quiz.js` | the tests — `node test_quiz.js` |

## Rebuilding the static site

`docs/` is a build artifact but it is committed, because Pages serves it from
the branch. After any change to `quiz.html` or the catalogues:

    python build_pages.py
    python build_pages.py --check

and commit `docs/` along with the change. `--check` is what tells you it has
gone stale.

## The spectra

`spectra.json` holds normalised flux against wavelength and nothing else — no
filenames, dates or observing locations. Set `SPECTRA_DIR` to a checkout of the
spectrum pipeline these came from and the page reads that installation live
instead, which adds the click-through to each reduction.
