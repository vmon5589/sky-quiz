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

## Keeping the published site current

`docs/` is a build artifact, but it is committed, because Pages serves it
**from the branch**. So the live site is the bake, not the source: pushing a
change to `quiz.html` on its own changes nothing anyone can see.

| what changed | rebuild with |
|---|---|
| `quiz.html`, `sky_catalog.json`, `star_facts.json` | `python build_pages.py` |
| new spectra in the pipeline | `python export_spectra.py`, then `python build_pages.py` |
| the year turned over | `python build_pages.py` — the planets are baked for one year, and the page says which |

Then check it, commit `docs/` with the change, and push:

    python build_pages.py --check      # says STALE if docs/ is behind
    node test_quiz.js

Pages redeploys within a minute of the push. Hard-refresh the page after it
does — a plain reload will often hand you the cached `data.json`.

## The spectra

`spectra.json` holds normalised flux against wavelength and nothing else — no
filenames, dates or observing locations. Set `SPECTRA_DIR` to a checkout of the
spectrum pipeline these came from and the page reads that installation live
instead, which adds the click-through to each reduction.
