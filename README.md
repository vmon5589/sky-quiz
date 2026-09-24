# Sky Quiz

A sky you can spin, that asks you questions about itself: name the
constellation, place a star, say where a planet stands on a given night. 1055
stars and 88 constellation figures, plus 65 real stellar spectra — measured
through an SA100 grating — that the page plots itself, each one alongside the
reduction it came out of.

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
| `spectra.json` | 65 measured spectra, curves only |
| `spectra_figures/` | the pipeline's own figure for each, 1400px WebP |
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
| a reduction was re-run | the same two — the figures are re-encoded from `output/` each time |
| the year turned over | `python build_pages.py` — the planets are baked for one year, and the page says which |

Then check it, commit `docs/` with the change, and push:

    python build_pages.py --check      # says STALE if docs/ is behind
    node test_quiz.js

**After a new observing run**, the whole of it is:

    python export_spectra.py     # re-freezes spectra.json and spectra_figures/
    python build_pages.py        # bakes docs/ and docs/spectra/
    python build_pages.py --check
    node test_quiz.js

`export_spectra.py` takes the best run per target off the pipeline's `output/`,
so a re-reduction replaces what was published without anything else being
said. It prints the count — worth a glance, because a frozen file drifts
silently otherwise. `spectra_figures/` is **rewritten each time**, not merged,
so nothing hand-placed there survives and nothing orphaned gets published.

Pages redeploys within a minute of the push. Hard-refresh the page after it
does — a plain reload will often hand you the cached `data.json`.

## The spectra

`spectra.json` holds normalised flux against wavelength and nothing else — no
filenames, dates or observing locations. Set `SPECTRA_DIR` to a checkout of the
spectrum pipeline these came from and the page reads that installation live
instead, which adds the click-through to each reduction.

`spectra_figures/` is the pipeline's own stage-3 figure for each star —
wavelength-coloured fill, the line set, and the dispersed frame it was
extracted from as a strip along the top. They are re-encoded on export (1400px
WebP, ~43 KB each, 2.7 MB for all 65) and **renamed off the star**, because a
run folder is an observation date, a capture time and a job id. The build
refuses a `figure` that is not a bare slug.

The two plots in the detail panel are different quantities and each says so:
the page's own is continuum-normalised, where a line's depth is the star; the
reduction under it is raw counts, where much of the envelope is the
instrument.
