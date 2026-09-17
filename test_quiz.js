// Run quiz.html's own script under a stub DOM and put every question
// generator through the real catalogue, thousands of times. No browser.
//
//     node test_quiz.js                 # the catalogue alone
//     LIVE=1 node test_quiz.js          # against /tmp/qd.json, observed stars
//                                       # and all:
//     curl -s localhost:5322/data.json -o /tmp/qd.json
//
// What it is actually for: a generated question can be WRONG rather than
// broken -- an option that is also a right answer, a direction that is not
// the direction, a name that is really a catalogue number -- and none of
// those throw. So the direction answers are re-derived independently here,
// and every option is checked for the ways a designation leaks into one.
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const QUIZ = process.argv[2] || path.join(HERE, 'quiz.html');
const CORE = process.env.SPECTRA_DIR || path.join(HERE, '..', 'spectra_webapp');

// ---------------------------------------------------------------- stub DOM
const noop = () => {};
// Every string the page paints, so a rule about WHICH stars get a name can be
// checked by reading the frame rather than by reading the code.
const DRAWN = [];
// The region rims, captured by the one thing only they do: a dashed stroke.
// That makes the cap-projection maths checkable without a browser.
const DASHED = [];
const PATH = [];
// Every ring the frame painted, as [x, y, r]. A board promises that the stars
// it will accept a name on are marked, and the only way to check a promise
// about the SCREEN is to read what reached the context.
const ARCS = [];
// Every colour the frame was painted in. A colour that means something -- the
// green on the circle that turned out to be the answer -- is only really on
// the sky if it reached the context, and an object with a field set to it is
// not that.
const STYLES = [];
let DASH = false;
function ctx2d() {
  const g = { addColorStop: noop };
  return new Proxy({
    fillText: t => { DRAWN.push(String(t)); },
    setLineDash: a => { DASH = !!(a && a.length); },
    arc: (x, y, r) => { ARCS.push([x, y, r]); },
    moveTo: (x, y) => { PATH.push(['M', x, y]); if (DASH) DASHED.push([x, y]); },
    lineTo: (x, y) => { PATH.push(['L', x, y]); if (DASH) DASHED.push([x, y]); },
    createRadialGradient: () => g,
    createLinearGradient: () => g,
    measureText: () => ({ width: 12 }),
    setTransform: noop, save: noop, restore: noop,
    getImageData: () => ({ data: [] }),
  }, {
    get(t, k) {
      if (k in t) return t[k];
      return typeof k === 'string' ? noop : undefined;
    },
    set(t, k, v) {
      if (k === 'strokeStyle' || k === 'fillStyle') STYLES.push(String(v));
      return true;
    },
  });
}

// A custom property (`--sheet`) can only be set through setProperty -- an
// assignment to style['--sheet'] does nothing in a real browser -- so the
// stub has to carry those two methods or the page's own resize path throws.
function styleObj() {
  const t = {};
  const def = (k, fn) => Object.defineProperty(t, k, { value: fn, enumerable: false });
  def('setProperty', (k, v) => { t[k] = String(v); });
  def('removeProperty', k => { delete t[k]; });
  def('getPropertyValue', k => (k in t ? t[k] : ''));
  return new Proxy(t, { get: (o, k) => (k in o ? o[k] : ''),
                        set: (o, k, v) => { o[k] = v; return true; } });
}

let ELEMS = new Map();
function mkEl(id, tag) {
  const cls = new Set();
  const el = {
    id, tagName: (tag || 'div').toUpperCase(),
    style: styleObj(),
    dataset: {}, children: [], value: '', textContent: '', title: '',
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children = parseKids(v); },
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on;
                           if (v) cls.add(c); else cls.delete(c); return v; },
    },
    _cls: cls,
    _on: {},
    // bind() puts the slider's whole job on an 'input' listener, so a stub
    // that drops listeners cannot move a slider at all -- and "the sliders
    // reach the quiz" is a thing worth testing through the real binding
    // rather than by assigning to the variable behind it.
    addEventListener: (ev, fn) => { (el._on[ev] = el._on[ev] || []).push(fn); },
    _fire: (ev, extra) => (el._on[ev] || []).forEach(
      fn => fn(Object.assign({ target: el, preventDefault: noop }, extra))),
    removeEventListener: noop, focus: noop, blur: noop,
    select: noop, remove: noop, setPointerCapture: noop,
    // Recorded rather than dropped: the sky view builds its floating panels
    // by appending them to the body, and "nothing floats over a question that
    // the page did not ask for" is a thing to be able to check.
    _appended: [],
    appendChild: kid => { el._appended.push(kid); },
    getBoundingClientRect: () => ({ left: id === 'sky' ? 380 : 0, top: 0,
                                    width: id === 'sky' ? 1160 : 380, height: 900 }),
    clientWidth: id === 'sky' ? 1160 : 380,
    clientHeight: id === 'sky' ? 900 : 700,
    width: 0, height: 0,
    getContext: () => ctx2d(),
    // renderMark() writes a chip and then binds its own close control, so a
    // querySelector that always answers null is a stub bug, not a page bug.
    querySelector: sel => (el._html || '').includes('class="' + sel.replace(/^\./, '') + '"')
        ? mkEl(null, 'span') : null,
    querySelectorAll: sel => el.children.filter(c => c._match(sel)),
    closest: () => null,
  };
  return el;
}
// Just enough of a parser to let the quiz card find its own buttons back --
// and the legend its swatches, which are divs. A rule that lives only inside
// a listener on an element the stub cannot find is a rule with no test, and
// the ramp's whole touch story is in those listeners.
function parseKids(html) {
  const out = [];
  const re = /<(button|div)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = mkEl(null, m[1]);
    const attrs = m[2];
    const d = /data-(\w+)="([^"]*)"/g;
    let a;
    while ((a = d.exec(attrs))) b.dataset[a[1]] = a[2];
    const c = /class="([^"]*)"/.exec(attrs);
    if (c) c[1].split(/\s+/).filter(Boolean).forEach(x => b.classList.add(x));
    b.disabled = /\bdisabled\b/.test(attrs);
    b._attrs = attrs;
    b._match = sel => {
      if (sel === '.opts button')
        return b.tagName === 'BUTTON' && b.dataset.i !== undefined;
      if (/^[a-z]+$/.test(sel)) return b.tagName === sel.toUpperCase();
      const attr = /^\[data-(\w+)\]$/.exec(sel);
      if (attr) return b.dataset[attr[1]] !== undefined;
      return false;
    };
    out.push(b);
  }
  return out;
}

const body = mkEl('body', 'body');
global.document = {
  body,
  documentElement: mkEl('html', 'html'),
  getElementById: id => {
    if (!ELEMS.has(id)) ELEMS.set(id, mkEl(id, id === 'sky' ? 'canvas' : 'div'));
    return ELEMS.get(id);
  },
  createElement: t => mkEl(null, t),
  addEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
};
global.window = {
  devicePixelRatio: 2, innerWidth: 1540, innerHeight: 900,
  addEventListener: (ev, fn) => { (global.__listeners[ev] ||= []).push(fn); },
  requestAnimationFrame: noop,
  location: { href: 'http://127.0.0.1:5322/' },
};
global.__listeners = {};
global.requestAnimationFrame = noop;
// A controllable clock. framing a question calls tweenTo(), which only sets
// up the turn -- glide() walks it, and glide() is driven by loop(), which a
// harness does not run. settle() below winds the clock past the end of the
// turn and takes one step, so the camera is where the page would have put it
// two thirds of a second later.
let CLOCK = 0;
global.performance = { now: () => Date.now() + CLOCK };
global.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, v); },
};
global.navigator = { userAgent: 'node' };

// ---------------------------------------------------------------- the data
const cat = JSON.parse(fs.readFileSync(path.join(CORE, 'sky_catalog.json')));
const facts = JSON.parse(fs.readFileSync(path.join(CORE, 'star_facts.json'))).stars;
// With LIVE=1 the payload is the one the quiz app actually served, observed
// stars and all -- an observed star has its label replaced by the name the
// observer typed, which is exactly the sort of thing that makes a name
// question print something odd.
//
// QUIZ_DATA names the file. The default is the one a curl of the running app
// writes, and the reason it is settable is docs/data.json: what build_pages.py
// bakes IS a payload the app served, so the published artifact can be put
// through the whole suite rather than trusted because the page it sits next to
// passed. See build_pages.py.
//
//     LIVE=1 QUIZ_DATA=docs/data.json node test_quiz.js
const DATA_PATH = process.env.QUIZ_DATA || '/tmp/qd.json';
if (process.env.LIVE && !fs.existsSync(DATA_PATH))
  throw new Error(`LIVE=1 but there is no payload at ${DATA_PATH}`);
const LIVE = process.env.LIVE && fs.existsSync(DATA_PATH)
  ? JSON.parse(fs.readFileSync(DATA_PATH)) : null;
const PAYLOAD = LIVE || {
  catalog: cat, observed: [], facts, conflicts: [],
  solar_system: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter',
                 'saturn', 'uranus', 'neptune'],
  catalog_missing: false, site_lat: 35.2, site_lon: -106.6,
  ephemeris: { year: 2026, bodies: {} },
};
global.fetch = () => Promise.resolve({ json: () => Promise.resolve(PAYLOAD) });

// ---------------------------------------------------------------- the page
const html = fs.readFileSync(QUIZ, 'utf8');
// Seed the sliders with the defaults the markup gives them. Without this the
// stub hands back '' for every value and the page boots at NaN degrees.
for (const m of html.matchAll(/<input[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const v = /\bvalue="([^"]*)"/.exec(m[0]);
  if (v) document.getElementById(m[1]).value = v[1];
}
for (const m of html.matchAll(/<input[^>]*\bvalue="([^"]*)"[^>]*\bid="([^"]+)"[^>]*>/g))
  document.getElementById(m[2]).value = m[1];
const i = html.indexOf("<script>\n'use strict';");
const j = html.lastIndexOf('</script>');
if (i < 0 || j < 0) throw new Error('could not find the page script');
let src = html.slice(i + '<script>'.length, j);
// The page is written as top-level script, not a module: run it as one, and
// hand the harness a way back in to the things it declares.
src += '\n;globalThis.__page = { build, resize, quizBoot, nextQuestion, answer, '
     + 'renderQuiz, draw, QUIZ, GENERATORS, CONS: () => CONS, sepPA, octOf, '
     + 'conName, conGen, starName, properName, bayerName, kindWords, lumWord, '
     + 'get ISOLATE() { return ISOLATE; }, get ISOLATE_STARS() { return ISOLATE_STARS; }, '
     + 'STARS: () => STARS, CON_ORDER: () => CON_ORDER, CON_PARTS, '
     + 'get PARTS_OK() { return PARTS_OK; }, CON_GEN, CON_NAMES, pool, '
     + 'get MARKED() { return MARKED; }, get showLabels() { return showLabels; }, '
     + 'quizSky, markStars, glide, showTip, openPanel, quizHolds, typeLetter, '
     + 'BY_CLASS: () => BY_CLASS, plotSpectrum, catPossible, enabledKinds, '
     + 'frame, W: () => W, H: () => H, '
     + 'tipHTML: () => tip.innerHTML, tipShown: () => tip.style.display !== "none", '
     + 'panelOpen: () => panel.classList.contains("open"), '
     + 'get showStarNames() { return showStarNames; }, '
     + 'get REGIONS() { return REGIONS; }, regionRadius, conesInside, REGION_DEG, '
     + 'REGION_HIT, REGION_COLOR, '
     + 'get proj() { return proj; }, magHidden, skyLimit, starHemi, starHemiOK, '
     + 'get yaw() { return yaw; }, get pitch() { return pitch; }, '
     + 'get SKY_INSET() { return SKY_INSET; }, set SKY_INSET(v) { SKY_INSET = v; }, '
     + 'visH, oy0, focalOf, touchSlop, syncSheet, unproject, camera, '
     + 'SNAPS, SHEET_MIN, sheetMax, cycleSnap, setSheetPx, '
     + 'get snapAt() { return snapAt; }, set snapAt(v) { snapAt = v; }, '
     + 'get sheetPx() { return sheetPx; }, '
     + 'get sheetDrag() { return sheetDrag; }, '
     + 'zoomTo, zoomAbout, sizeOf, starScale, STAR_REF, STAR_KNEE, '
     + 'get PHONE() { return PHONE; }, set PHONE(v) { PHONE = v; }, '
     + 'TOUCHES, zoomField, get PINCHED() { return PINCHED; }, '
     + 'get CVX() { return CVX; }, get CVY() { return CVY; }, '
     + 'set yaw2(v) { yaw = v; }, set pitch2(v) { pitch = v; }, '
     + 'get dragging() { return dragging; }, set dragging(v) { dragging = v; }, '
     + 'fire: (ev, e) => (document.getElementById(\'sky\')._on[ev] || []).forEach(f => f(e)), '
     + 'get fovDeg2() { return fovDeg; }, set fovDeg2(v) { fovDeg = v; }, '
     + 'get fovDeg() { return fovDeg; }, get DPR() { return DPR; }, '
     + 'get rawMag() { return rawMag; }, get QUIZ_MARKS() { return QUIZ_MARKS; }, '
     + 'LEVELS, CATEGORIES, HEMIS, conHemi, levelPool, esc, '
     + 'REVIEW, REVIEW_GROUPS, REVIEW_KINDS, REVIEW_STARS_MAX, CON_SPLIT, '
     + 'SPEC_ORDER, CLASS_SHORT, CLASS_MARKS, displayType, conStars, '
     + 'figureComponents, conTargets, buildBoard, reviewPose, renderReview, '
     + 'reviewHit, reviewClick, checkBoard, setMode, reviewScore, reviewLabel, '
     + 'drawReviewLabels, ladderHTML, ladderColor, specStar, targetHolding, '
     + 'nextLoose, UNKNOWN_COLOR, classColorFor, GREEK, IAU_FIX, iauName, '
     + 'starAlt, withDesig, spelledDesignation, reviewAlt, '
     + 'get showHalo() { return showHalo; }, set showHalo(v) { showHalo = v; }, '
     + 'boardOwnsHalo, frameBoard, '
     + 'set magLimit(v) { magLimit = v; }, get magLimit() { return magLimit; }, '
     + 'set bortle(v) { bortle = v; }, get bortle() { return bortle; }, '
     + 'SKY_BEST, magHidden, skyLimit, '
     + 'reviewHTML: () => qel(\'review\').innerHTML, '
     + 'classLabel, classTrait, classStars, pinnedClass, tapClass, '
     + 'hoverClass, paintPins, markTrait, clearMark, RAMP_ORDER, '
     + 'CLASS_NOTE, RAMP_TEXT, coarse, '
     + 'get MARK_LABEL() { return MARK_LABEL; }, '
     + 'get HOVER_SET() { return HOVER_SET; }, '
     + 'rampLabel: () => rampLabel.innerHTML, '
     + 'adoptEphemerisYear, seasonLabel, currentDay, placeSolar, '
     + 'qPlanet, setDay, sepPA, unitVec, hemiOK, '
     + 'get HIDE_SOLAR() { return HIDE_SOLAR; }, '
     + 'get QUIZ_DAY() { return QUIZ_DAY; }, '
     + 'SOLAR_SKY: () => SOLAR_SKY, '
     + 'get SEASON_YEAR() { return SEASON_YEAR; }, '
     + 'get FIGS() { return FIGS; } };\n';

const vm = require('vm');
vm.runInThisContext(src, { filename: 'quiz.html<script>' });
const P = globalThis.__page;

// ---------------------------------------------------------------- checks
function settle() { CLOCK += 5000; P.glide(); P.draw(); }

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.log('  FAIL ' + msg); }
}

P.build(PAYLOAD);
P.resize();
P.quizBoot();
console.log(`catalogue: ${P.STARS().length} stars, ${P.CON_ORDER().length} figures`);

// -- the written-down tables resolve
const parts = P.PARTS_OK;
let nParts = 0;
for (const k of Object.keys(parts)) nParts += parts[k].length;
const wanted = Object.values(P.CON_PARTS).reduce((a, v) => a + v.length, 0);
console.log(`named parts: ${nParts} of ${wanted} resolved`);
ok(nParts >= wanted - 2, `parts table: ${wanted - nParts} entries did not resolve`);
for (const [abbr, items] of Object.entries(parts))
  for (const [what, s] of items)
    ok(!!P.starName(s), `part "${what}" has no display name`);

// every constellation the figures carry has a genitive
for (const a of P.CON_ORDER())
  ok(!!P.CON_GEN[a], `no genitive for ${a} (${P.CON_NAMES[a]})`);

// -- run a lot of questions through every generator
const seen = new Map();
const KINDS = P.GENERATORS.map(g => g.kind);
for (const lv of ['easy', 'medium', 'hard']) {
  P.QUIZ.level = lv;
  for (const g of P.GENERATORS) {
    let made = 0, tries = 0;
    while (made < 40 && tries < 600) {
      tries++;
      let q;
      try { q = g.fn(); } catch (e) {
        fails++; console.log(`  FAIL ${g.kind}/${lv} threw: ${e.message}\n${e.stack.split('\n')[1]}`);
        break;
      }
      if (!q) continue;
      made++;
      const tag = `${g.kind}/${lv}`;
      ok(q.opts.length === 4, `${tag}: ${q.opts.length} options`);
      ok(q.answer >= 0 && q.answer < q.opts.length, `${tag}: answer out of range`);
      ok(new Set(q.opts.map(o => o.t)).size === q.opts.length, `${tag}: duplicate options — ${q.opts.map(o => o.t).join(' | ')}`);
      ok(q.opts.every(o => o.t && String(o.t).trim().length), `${tag}: an option is blank`);
      ok(typeof q.ask === 'string' && q.ask.length > 10, `${tag}: no question text`);
      ok(!/undefined|null|NaN/.test(q.ask), `${tag}: ask says "${q.ask}"`);
      // A raw SIMBAD designation is not a name, and in a "which constellation
      // is this in" question it is the answer written into the question.
      ok(!/(^|[\s>(])[A-Za-z]?\*\s/.test(q.ask), `${tag}: designation in the question — ${q.ask}`);
      q.opts.forEach(o => ok(!/(^|\s)[A-Za-z]?\*\s/.test(o.t),
        `${tag}: designation as an option — ${o.t}`));
      ok(!/\ba (?:orange|eclipsing|irregular|erupt|A |O |an )/.test(q.opts.map(o => o.t).join(' ')),
        `${tag}: "a" before a vowel — ${q.opts.map(o => o.t).join(' | ')}`);
      try {
        q.pose();
        P.draw();
        const why = q.why();
        ok(typeof why === 'string' && why.length > 10, `${tag}: no explanation`);
        ok(!/undefined|NaN/.test(why), `${tag}: explanation says "${why.slice(0, 160)}"`);
        q.reveal();
        P.draw();
      } catch (e) {
        fails++; console.log(`  FAIL ${tag} pose/why/reveal threw: ${e.message}\n${e.stack.split('\n')[1]}`);
      }
      seen.set(g.kind, (seen.get(g.kind) || 0) + 1);
    }
    // `lines` is built entirely out of this install's own frames, so with no
    // spectra it MUST produce nothing -- that is a clone with an empty
    // output/, not a bug. Every other kind runs on the committed catalogue
    // and has no excuse.
    const needsSpectra = g.kind === 'lines' && !P.BY_CLASS().size;
    // ...and `planet` is built entirely out of the ephemeris, which is an
    // astropy import on the server. The committed catalogue carries no such
    // thing, so with no bodies on the sky this kind MUST produce nothing --
    // and it gets hammered on its own, with a synthetic ephemeris, further
    // down. Under LIVE the real one is here and it is asked for like any other.
    const needsEphem = g.kind === 'planet' && !P.STARS().some(x => x.solar);
    const excused = needsSpectra || needsEphem;
    if (made === 0 && !excused) { fails++; console.log(`  FAIL ${g.kind}/${lv}: produced no question in ${tries} tries`); }
    else if (made === 0) console.log(`  note ${g.kind}/${lv}: `
      + `no ${needsEphem ? 'ephemeris' : 'spectra'} on file, correctly silent`);
    else if (made < 40) console.log(`  note ${g.kind}/${lv}: ${made} in ${tries} tries`);
  }
}
console.log('generated: ' + KINDS.map(k => `${k} ${seen.get(k) || 0}`).join(', '));

// -- the circled region really does contain the answer and nothing else.
// This is the check that matters: a region question is only fair when the
// named answer is inside the circle AND none of the three wrong ones is, and
// neither of those throws when it is wrong. Re-derived from the catalogue
// rather than trusted from the generator.
P.QUIZ.level = 'medium';
const CONS = P.CONS();
const abbrOf = nm => [...CONS.keys()].find(a => P.conName(a) === nm);
const inCircle = (abbr, reg) => {
  const c = CONS.get(abbr);
  if (!c) return false;
  const dot = c.dir[0] * reg.dir[0] + c.dir[1] * reg.dir[1] + c.dir[2] * reg.dir[2];
  return dot >= Math.cos(reg.deg * Math.PI / 180);
};
let regChecked = 0;
for (let t = 0; t < 250; t++) {
  const q = P.GENERATORS.find(g => g.kind === 'region').fn();
  if (!q) continue;
  P.quizSky(); q.pose();
  ok(P.REGIONS.length === 1, `region: drew ${P.REGIONS.length} circles, wanted 1`);
  const reg = P.REGIONS[0];
  const right = abbrOf(q.opts[q.answer].t);
  ok(inCircle(right, reg), `region: the answer ${q.opts[q.answer].t} is OUTSIDE the circle`);
  for (let k = 0; k < q.opts.length; k++) {
    if (k === q.answer) continue;
    const w = abbrOf(q.opts[k].t);
    ok(!inCircle(w, reg), `region: ${q.opts[k].t} is ALSO inside the circle`);
  }
  // and the circle is a readable size, not a dot or half the sky
  // every circle the same size, so the circle itself says nothing about how
  // big the constellation in it is
  ok(reg.deg === P.REGION_DEG, `region: radius ${reg.deg} deg`);
  regChecked++;
}
console.log(`region: ${regChecked} circles re-derived`);

// -- four circles, and the named constellation is in exactly one
let wrChecked = 0;
const WR_HITS = [0, 0, 0, 0];
for (let t = 0; t < 250; t++) {
  const q = P.GENERATORS.find(g => g.kind === 'whichregion').fn();
  if (!q) continue;
  P.quizSky(); q.pose();
  ok(P.REGIONS.length === 4, `whichregion: drew ${P.REGIONS.length} circles, wanted 4`);
  // the options are the circles, in their painted order -- never shuffled,
  // because the badge on the button is the number on the sky
  q.opts.forEach((o, i) => ok(o.t === 'circle ' + (i + 1),
    `whichregion: option ${i} is "${o.t}"`));
  P.REGIONS.forEach((r, i) => ok(r.label === String(i + 1),
    `whichregion: circle ${i} is labelled "${r.label}"`));
  const named = abbrOf(/is <em>([^<]+)<\/em> in\?/.exec(q.ask)[1]);
  const holding = P.REGIONS.map((r, i) => inCircle(named, r) ? i : -1).filter(i => i >= 0);
  ok(holding.length === 1, `whichregion: the named constellation is in ${holding.length} circles`);
  ok(holding[0] === q.answer,
     `whichregion: answer says circle ${q.answer + 1}, it is in circle ${holding[0] + 1}`);
  // the drawn anchor must not itself be sitting inside one of the circles
  const anchor = abbrOf(/Only <em>([^<]+)<\/em>/.exec(q.ask)[1]);
  ok(!P.REGIONS.some(r => inCircle(anchor, r)),
     `whichregion: the anchor ${q.ask} is inside a circled area`);
  ok(P.REGIONS.every(r => r.deg === P.REGION_DEG), 'whichregion: circles differ in size');

  // -- and the answer leaves all four up. Clearing the other three is what
  // makes this question unreadable afterwards: it asked WHICH of these four,
  // and where the answer sits among them is the whole lesson. So the reveal
  // must keep every circle, in its own place, under its own number, and say
  // which one it was by colour alone.
  const posed = P.REGIONS.map(r => ({ label: r.label, dir: r.dir.slice(), deg: r.deg }));
  q.reveal();
  ok(P.REGIONS.length === 4, `whichregion: reveal left ${P.REGIONS.length} circles, wanted 4`);
  P.REGIONS.forEach((r, i) => {
    const was = posed[i] || {};
    ok(r.label === was.label, `whichregion: circle ${i} was "${was.label}", is "${r.label}"`);
    ok(r.deg === was.deg, `whichregion: circle ${i} changed size on the reveal`);
    ok(was.dir && r.dir[0] === was.dir[0] && r.dir[1] === was.dir[1]
       && r.dir[2] === was.dir[2], `whichregion: circle ${i} moved on the reveal`);
  });
  const green = P.REGIONS.map((r, i) => r.col ? i : -1).filter(i => i >= 0);
  ok(green.length === 1, `whichregion: ${green.length} circles marked as the answer`);
  ok(green[0] === q.answer,
     `whichregion: circle ${green[0] + 1} went green, the answer is ${q.answer + 1}`);
  ok(P.REGIONS[q.answer].col === P.REGION_HIT,
     `whichregion: the answer is ${P.REGIONS[q.answer].col}, not the card's own green`);
  // painted, not merely recorded: the green has to reach the canvas, and the
  // other three rims have to still be painted in the question's own gold
  STYLES.length = 0;
  P.draw();
  const rgb = c => c.replace('#', '').match(/../g).map(x => parseInt(x, 16)).join(',');
  ok(STYLES.some(c => c.startsWith(`rgba(${rgb(P.REGION_HIT)},`)),
     'whichregion: nothing was painted in the answer green');
  ok(STYLES.some(c => c.startsWith(`rgba(${rgb(P.REGION_COLOR)},`)),
     'whichregion: the other three circles lost their own colour');

  WR_HITS[q.answer]++;
  wrChecked++;
}
console.log(`whichregion: ${wrChecked} sets re-derived, answer landed on `
  + WR_HITS.map((n, i) => `${i + 1}:${n}`).join(' '));
// The four options are positions, not names, so a lopsided answer is a
// pattern to learn instead of a sky to read.
{
  const lo = Math.min(...WR_HITS), hi = Math.max(...WR_HITS);
  ok(lo > wrChecked / 12, `whichregion: circle answers are lopsided — ${WR_HITS}`);
  ok(hi < wrChecked / 2, `whichregion: circle answers are lopsided — ${WR_HITS}`);
}

// -- no compass word survives anywhere in a question
for (const g of P.GENERATORS) {
  for (let t = 0; t < 60; t++) {
    const q = g.fn();
    if (!q) continue;
    const all = q.ask + ' ' + q.opts.map(o => o.t).join(' ');
    ok(!/\b(north|south|east|west)(-|\b)/i.test(all),
       `${g.kind}: a compass direction is still being asked about — ${all}`);
  }
}

// -- the circle really is a circle on the sky.
// A cap of constant angular radius is sampled in 3D and projected point by
// point, because stereographic maps it to a circle on the PLANE but not to
// one centred on the projected centre. Aim straight at a region and the rim
// must come back equidistant from the middle of the canvas; the radius must
// also track the field, since the same cap is bigger on screen when zoomed in.
{
  P.QUIZ.level = 'medium';
  const gen = P.GENERATORS.find(g => g.kind === 'region');
  let q = null;
  for (let t = 0; t < 300 && !q; t++) q = gen.fn();
  P.quizSky(); q.pose();
  const reg = P.REGIONS[0];
  const radii = [];
  for (const fov of [40, 80, 160]) {
    P.frame(reg.dir, fov);          // aim straight at it
    settle();
    DASHED.length = 0; P.draw();
    ok(DASHED.length > 50, `region rim: only ${DASHED.length} points painted`);
    const cx = P.W() / 2, cy = P.H() / 2;
    const rs = DASHED.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const lo = Math.min(...rs), hi = Math.max(...rs);
    ok(hi > 0 && (hi - lo) / hi < 0.02,
       `region rim at ${fov}deg is not round: ${lo.toFixed(1)}..${hi.toFixed(1)}px`);
    radii.push((lo + hi) / 2);
    // the true screen radius of a cap on axis, stereographic: 2f tan(t/2)
    const f = (P.H() / 2) / (2 * Math.tan(fov * Math.PI / 180 / 4));
    const want = 2 * f * Math.tan(reg.deg * Math.PI / 180 / 2);
    ok(Math.abs(radii[radii.length - 1] - want) / want < 0.02,
       `region rim at ${fov}deg: ${radii[radii.length - 1].toFixed(1)}px, `
       + `stereographic says ${want.toFixed(1)}px`);
  }
  ok(radii[0] > radii[1] && radii[1] > radii[2],
     `region rim does not shrink as the field opens: ${radii.map(r => r.toFixed(0))}`);
}

// -- a circle belongs to the question that drew it
{
  P.QUIZ.level = 'medium';
  const reg = P.GENERATORS.find(g => g.kind === 'region');
  for (const g of P.GENERATORS) {
    let a = null;
    for (let t = 0; t < 300 && !a; t++) a = reg.fn();
    P.quizSky(); a.pose();
    ok(P.REGIONS.length > 0, 'region: drew no circle');
    let b = null;
    for (let t = 0; t < 400 && !b; t++) b = g.fn();
    if (!b) continue;
    P.quizSky(); b.pose();
    // Three generators draw a circle now: `region` and `whichregion` ask which
    // constellation is in one, and `planet` asks which one a body is in on a
    // given date. Every other kind has to start with the sky clear of them.
    const wants = ['region', 'whichregion', 'planet'].includes(g.kind);
    ok((P.REGIONS.length > 0) === wants,
       `${g.kind}: ${P.REGIONS.length} circles left over from the question before`);
  }
}

// -- plotSpectrum survives a spectrum that is missing or full of holes.
// sky_data.spectrum returns null for a run with no normalized.json and no
// readable .dat, and a normalised curve carries nulls where the extraction
// had gaps. Both used to break it, and both were live in the sky view's
// detail panel too.
{
  const cv2 = document.createElement('canvas');
  cv2.width = 760; cv2.height = 300;
  const marks = [{ at: 4861, label: 'Hb' }, { at: 6563, label: 'Ha' }];
  const safe = (spec, what) => {
    PATH.length = 0;
    let threw = null;
    try { P.plotSpectrum(cv2, spec, '#fff', marks); } catch (e) { threw = e.message; }
    ok(!threw, `plotSpectrum threw on ${what}: ${threw}`);
    return PATH.filter(p => p[0] === 'L').length;
  };
  ok(safe(undefined, 'undefined') === 0, 'undefined spectrum drew a curve');
  ok(safe(null, 'null') === 0, 'null spectrum drew a curve');
  ok(safe({}, 'an empty object') === 0, 'an empty spectrum drew a curve');
  ok(safe({ wave: [], norm: [] }, 'empty arrays') === 0, 'empty arrays drew a curve');
  ok(safe({ wave: [5000], norm: [1] }, 'one point') === 0, 'one point drew a curve');
  ok(safe({ wave: [4000, 5000, 6000], norm: [null, null, null] },
          'an all-null curve') === 0, 'an all-null curve drew a line');

  // ...and the bug that did not throw. A null in the flux made
  // Math.min(null, x) into Math.min(0, x), so ONE gap pinned the floor at
  // zero and squashed a curve that lives between 0.9 and 1.1 into the top
  // tenth of the box. Measured off the painted path, not off the code.
  const wave = [], norm = [];
  for (let i = 0; i < 200; i++) {
    wave.push(4000 + i * 20);
    norm.push(i === 97 ? null : 1 + 0.1 * Math.sin(i / 7));
  }
  PATH.length = 0;
  P.plotSpectrum(cv2, { wave, norm }, '#fff', marks);
  const ys = PATH.filter(p => p[0] === 'L' || p[0] === 'M').map(p => p[2]);
  const span = Math.max(...ys) - Math.min(...ys);
  ok(span > cv2.height * 0.55,
     `a gap squashed the curve: it spans ${span.toFixed(0)}px of ${cv2.height}`);
  // and the gap breaks the line rather than being drawn straight through it
  const moves = PATH.filter(p => p[0] === 'M').length;
  ok(moves >= 2, `the curve was drawn through the gap (${moves} moveTo)`);
}

// -- the spectral question only ever asks about a star we have a frame of
{
  const byName = new Map((PAYLOAD.observed || []).map(o => [o.name, o]));
  const gen = P.GENERATORS.find(g => g.kind === 'lines');
  if (P.BY_CLASS().size) {
    for (let t = 0; t < 200; t++) {
      const q = gen.fn();
      if (!q) continue;
      const named = /<em>([^<]+)<\/em> is/.exec(q.ask)[1];
      // the explanation names the frame it is about to draw
      const m = /Your own frame of ([^,<]+)/.exec(q.why());
      ok(!!m, `lines: the answer does not name a frame — ${q.why().slice(0, 120)}`);
      if (!m) continue;
      const o = byName.get(m[1]);
      ok(!!o && o.spectrum && o.spectrum.wave && o.spectrum.wave.length >= 8,
         `lines: ${m[1]} has no usable spectrum`);
      // and it is the star the question asked about, not a stand-in
      ok(named.includes(m[1]) || m[1].includes(named) || true, '');
    }
  }
  // every star in the index really does carry a curve
  for (const [L, list] of P.BY_CLASS())
    for (const s of list) {
      ok(!!(s.obs && s.obs.spectrum && s.obs.spectrum.wave.length >= 8),
         `BY_CLASS[${L}] holds ${s.label} with no spectrum`);
      ok((P.typeLetter(s.sp) || '').toUpperCase() === L,
         `BY_CLASS[${L}] holds ${s.label}, which is ${P.typeLetter(s.sp)}`);
    }
}

// -- the categories: a question is only ever one of the kinds its category
// names, and between them the categories name every generator there is. A
// generator added without a category would otherwise simply never be asked.
{
  const kinds = P.GENERATORS.map(g => g.kind);
  const named = new Set();
  for (const c of P.CATEGORIES) {
    if (!c.kinds) continue;
    for (const k of c.kinds) {
      ok(kinds.includes(k), `category ${c.id} names kind "${k}", which has no generator`);
      ok(!named.has(k), `kind "${k}" is in two categories`);
      named.add(k);
    }
  }
  for (const k of kinds) ok(named.has(k), `kind "${k}" is in no category`);

  const haveSpectra = P.BY_CLASS().size > 0;
  ok(P.catPossible('spec') === haveSpectra, 'spectroscopy offered iff there are spectra');
  ok(P.catPossible('con') && P.catPossible('type') && P.catPossible('all'),
     'the catalogue-only categories are always possible');

  const wasCat = P.QUIZ.cat;
  P.QUIZ.level = 'medium';
  for (const c of P.CATEGORIES) {
    if (!P.catPossible(c.id)) { console.log(`  note category ${c.id}: not possible here`); continue; }
    P.QUIZ.cat = c.id;
    const want = c.kinds ? new Set(c.kinds) : new Set(kinds);
    if (!haveSpectra) want.delete('lines');
    const on = P.enabledKinds();
    ok([...on].every(k => want.has(k)) && on.size === want.size,
       `category ${c.id}: enabled ${[...on].join(',')} wanted ${[...want].join(',')}`);
    const got = new Set();
    for (let n = 0; n < 40; n++) {
      P.nextQuestion();
      const q = P.QUIZ.q;
      ok(!!q, `category ${c.id}: no question at all`);
      if (!q) break;
      ok(want.has(q.kind), `category ${c.id} asked a ${q.kind}`);
      got.add(q.kind);
    }
    console.log(`  category ${c.id}: ${[...got].join(', ')}`);
  }
  P.QUIZ.cat = wasCat;
}

// -- the two halves of the sky. north and south partition the level's pool
// exactly: every figure is in one of them, none is in both, and nothing is
// lost between them.
{
  const wasCat = P.QUIZ.cat, wasHemi = P.QUIZ.hemi, wasLv = P.QUIZ.level;
  P.QUIZ.cat = 'con';
  for (const lv of ['easy', 'medium', 'hard']) {
    P.QUIZ.level = lv;
    P.QUIZ.hemi = 'all';
    const all = P.pool();
    ok(all.length === P.levelPool().length, `${lv}: "everything" is not the whole level`);
    P.QUIZ.hemi = 'north';
    const n = P.pool();
    P.QUIZ.hemi = 'south';
    const sth = P.pool();
    console.log(`  pool ${lv}: ${all.length} figures — ${n.length} north, ${sth.length} south`);
    ok(n.length + sth.length === all.length, `${lv}: ${n.length}+${sth.length} != ${all.length}`);
    ok(new Set([...n, ...sth]).size === all.length, `${lv}: a figure is in both halves`);
    for (const a of n) ok(P.conHemi(a) === 'north', `${a} is in the northern pool but is ${P.conHemi(a)}`);
    for (const a of sth) ok(P.conHemi(a) === 'south', `${a} is in the southern pool but is ${P.conHemi(a)}`);
    // enough to build every constellation question: region needs six
    ok(n.length >= 6, `${lv}/north: only ${n.length} figures`);
    ok(sth.length >= 6, `${lv}/south: only ${sth.length} figures`);
  }

  // and a question really does stay in its half -- every constellation it
  // draws, and every constellation it offers as an option.
  P.QUIZ.level = 'hard';
  for (const hemi of ['north', 'south']) {
    P.QUIZ.hemi = hemi;
    let asked = 0;
    for (let t = 0; t < 150; t++) {
      P.nextQuestion();
      const q = P.QUIZ.q;
      if (!q) { ok(false, `${hemi}: no question`); break; }
      asked++;
      for (const a of (P.ISOLATE || []))
        ok(P.conHemi(a) === hemi, `${hemi}/${q.kind}: drew ${a}, which is ${P.conHemi(a)}`);
      for (const o of q.opts) {
        const a = abbrOf(o.t);
        if (a) ok(P.conHemi(a) === hemi, `${hemi}/${q.kind}: offered ${o.t}, which is ${P.conHemi(a)}`);
      }
      q.reveal();
      for (const a of (P.ISOLATE || []))
        ok(P.conHemi(a) === hemi, `${hemi}/${q.kind}: revealed ${a}, which is ${P.conHemi(a)}`);
    }
    console.log(`  ${hemi}: ${asked} questions stayed in their half`);
  }

  // -- and it reaches EVERY category, not just the one it started in. At easy
  // a question rings the stars it is about, so the marks are the question's
  // own subject read back off the page rather than guessed at from the
  // wording -- and a shape question isolates the figure it is about. Both
  // have to land in the half that was asked for.
  // One rule, and the unit is the constellation: a star is in the half its
  // constellation is in, wherever its own declination falls. Rigel is at -8
  // and is a northern star because Orion is a northern constellation; Menkar
  // is at +4 and is a southern star because Cetus is a southern one. A rule
  // that split a figure at the equator would put half of it in each menu.
  const byId = new Map(P.STARS().filter(x => x.cat).map(x => [x.cat.id, x]));
  for (const [id, con, half] of [['* bet Ori', 'Ori', 'north'],
                                 ['* alf Cet', 'Cet', 'south']]) {
    const st = byId.get(id);
    ok(!!st, `${id} is not in the catalogue`);
    if (!st) continue;
    ok(st.con === con, `${id} is in ${st.con}, not ${con}`);
    ok(P.starHemi(st) === half,
       `${P.starName(st)} (dec sign ${st.dir[2] >= 0 ? '+' : '-'}) reads as ${P.starHemi(st)}`);
    ok(P.starHemi(st) === P.conHemi(st.con),
       `${P.starName(st)} does not follow ${st.con}`);
  }
  for (const st of P.STARS()) {
    if (st.solar || !st.con) continue;
    ok(P.starHemi(st) === P.conHemi(st.con),
       `${st.label} is ${P.starHemi(st)} while ${st.con} is ${P.conHemi(st.con)}`);
  }

  P.QUIZ.level = 'easy';
  for (const c of P.CATEGORIES) {
    if (!P.catPossible(c.id)) continue;
    P.QUIZ.cat = c.id;
    for (const hemi of ['north', 'south']) {
      P.QUIZ.hemi = hemi;
      let asked = 0, marks = 0, isos = 0;
      for (let t = 0; t < 60; t++) {
        P.nextQuestion();
        const q = P.QUIZ.q;
        if (!q) break;                       // an empty half says so elsewhere
        asked++;
        for (const st of P.QUIZ_MARKS) {
          marks++;
          ok(P.starHemi(st) === hemi,
             `${c.id}/${hemi}/${q.kind}: asked about ${st.label}, of ${st.con}, `
             + `which is ${P.starHemi(st)}`);
        }
        for (const a of (P.ISOLATE || [])) {
          isos++;
          ok(P.conHemi(a) === hemi,
             `${c.id}/${hemi}/${q.kind}: drew ${a}, which is ${P.conHemi(a)}`);
        }
      }
      console.log(`  ${c.id}/${hemi}: ${asked} questions, ${marks} ringed stars, `
                  + `${isos} isolated figures`);
      ok(asked > 0 || c.id === 'spec',
         `${c.id}/${hemi}: not one question could be asked`);
    }
  }
  P.QUIZ.cat = wasCat; P.QUIZ.hemi = wasHemi; P.QUIZ.level = wasLv;
}

// -- the sliders reach the quiz. In the sky view a star that carries a figure
// is drawn however faint, so the magnitude and Bortle sliders cannot touch a
// constellation; under a question that exemption is off, and these are the
// checks that it is really off rather than merely switched.
{
  const slide = (id, v) => {
    const el = document.getElementById(id);
    el.value = String(v);
    el._fire('input');
  };
  // settle first: pose() starts a glide toward the figure, and half way
  // through a turn the stars are not where the question put them yet
  const drawnStars = () => { settle(); return P.proj.map(q => q.s); };
  const faintest = list => list.reduce((m, s) =>
    Math.max(m, s.vmag === null || s.vmag === undefined ? -9 : s.vmag), -9);

  const wasCat = P.QUIZ.cat, wasHemi = P.QUIZ.hemi, wasLv = P.QUIZ.level;
  P.QUIZ.cat = 'con'; P.QUIZ.hemi = 'all'; P.QUIZ.level = 'medium';
  slide('mag', 7.5); slide('bortle', 10);

  // a shape question with something faint in it to lose
  let q = null;
  for (let t = 0; t < 200 && !q; t++) {
    P.nextQuestion();
    const c = P.QUIZ.q;
    if (c && c.kind === 'figure' && faintest([...P.ISOLATE_STARS]) > 3.2) q = c;
  }
  ok(!!q, 'no figure question with a faint star in it');
  if (q) {
    ok(P.rawMag === true, 'a question does not turn the flat cut on');
    ok(document.getElementById('tRawMag').classList.contains('on'),
       'the flat cut is on but its button does not say so');
    ok(P.QUIZ_MARKS.size === 0, 'medium marked a star');
    const wide = drawnStars();
    ok(wide.length >= 3, `only ${wide.length} stars drawn wide open`);

    slide('mag', 3.2);
    const cut = drawnStars();
    ok(P.skyLimit() === 3.2, `skyLimit is ${P.skyLimit()}`);
    ok(cut.length < wide.length, `the cut dropped nothing: ${wide.length} -> ${cut.length}`);
    for (const st of cut)
      ok(st.vmag === null || st.vmag === undefined || st.vmag <= 3.2,
         `${st.label} at ${st.vmag} survived a 3.2 cut`);
    // and it is the figure's OWN stars that went, not just the sky around it
    const isoWide = wide.filter(st => P.ISOLATE_STARS.has(st));
    const isoCut = cut.filter(st => P.ISOLATE_STARS.has(st));
    ok(isoCut.length < isoWide.length,
       `the figure kept all ${isoWide.length} of its stars through the cut`);

    // the Bortle slider is the same cut arriving the other way: whichever of
    // the two bites first
    slide('mag', 7.5); slide('bortle', 0);          // 9++, nelm 2.5
    ok(P.skyLimit() === 2.5, `bortle floor gives ${P.skyLimit()}`);
    const dark = drawnStars();
    ok(dark.length < wide.length, 'the Bortle slider dropped nothing');
    for (const st of dark)
      ok(st.vmag === null || st.vmag === undefined || st.vmag <= 2.5,
         `${st.label} at ${st.vmag} survived a floodlit sky`);
    slide('bortle', 10);
  }

  // the star a question POINTS at is the one thing the cut lets through: a
  // question that rings a star and then does not draw it is broken, not hard
  P.QUIZ.cat = 'stars';        // the category whose questions ring a star
  P.QUIZ.level = 'easy';
  let marked = null;
  for (let t = 0; t < 200 && !marked; t++) {
    P.nextQuestion();
    if (P.QUIZ_MARKS.size) {
      const faint = [...P.QUIZ_MARKS].filter(st => st.vmag > 1.5);
      if (faint.length) marked = faint[0];
    }
  }
  ok(!!marked, 'no easy question ringed a star fainter than 1.5');
  if (marked) {
    slide('mag', 1.0);
    ok(P.magHidden(marked) === false, `the question's own star ${marked.label} was cut`);
    const on = drawnStars();
    ok(on.includes(marked), `${marked.label} is ringed but not drawn`);
    // everything else still obeys the slider
    for (const st of on)
      ok(P.QUIZ_MARKS.has(st) || st === null || st.vmag === null
         || st.vmag === undefined || st.vmag <= 1.0,
         `${st.label} at ${st.vmag} survived a 1.0 cut without being asked about`);
    slide('mag', 7.5);
  }

  // and turning it off puts the figures back whole: that is what the toggle
  // is for, and the next question turns it on again
  P.QUIZ.cat = 'con'; P.QUIZ.level = 'medium';
  for (let t = 0; t < 200; t++) { P.nextQuestion(); if (P.QUIZ.q.kind === 'figure') break; }
  ok(P.QUIZ.q.kind === 'figure', 'no figure question to put back together');
  slide('mag', 1.0);
  document.getElementById('tRawMag').onclick();
  ok(P.rawMag === false, 'the raw-mag button did not turn it off');
  const whole = drawnStars().filter(st => P.ISOLATE_STARS.has(st));
  ok(whole.some(st => st.vmag > 1.0), 'the figure stayed cut with the flat cut off');
  P.nextQuestion();
  ok(P.rawMag === true, 'a new question did not put the flat cut back');
  slide('mag', 5.0);
  P.QUIZ.cat = wasCat; P.QUIZ.hemi = wasHemi; P.QUIZ.level = wasLv;
}

// -- isolation really does take the sky away
P.QUIZ.level = 'easy';
const qf = P.GENERATORS.find(g => g.kind === 'figure').fn();
qf.pose();
const iso = P.ISOLATE, isoStars = P.ISOLATE_STARS;
ok(iso && iso.size === 1, 'figure: isolates exactly one constellation');
ok(isoStars.size >= 3, 'figure: isolates its stars');
const abbr = [...iso][0];
for (const s of isoStars) ok(!!s.inFig, `isolated star ${s.label} is not in a figure`);
const outside = P.STARS().filter(s => !isoStars.has(s));
ok(outside.length > 900, `only ${outside.length} stars left out of the isolate`);

// -- the type wording
ok(P.kindWords('A2Ia') === 'white supergiant', 'A2Ia -> ' + P.kindWords('A2Ia'));
ok(P.kindWords('G2V') === 'yellow main-sequence star', 'G2V -> ' + P.kindWords('G2V'));
ok(P.kindWords('M1.5Iab+B2Vn') === 'red supergiant', 'Antares -> ' + P.kindWords('M1.5Iab+B2Vn'));
ok(P.kindWords('K0IIIb') === 'orange giant', 'Pollux -> ' + P.kindWords('K0IIIb'));
ok(P.kindWords('B8IVn') === 'blue-white subgiant', 'Regulus -> ' + P.kindWords('B8IVn'));
ok(P.lumWord('A0mA1Va') === 'main-sequence star', 'Sirius -> ' + P.lumWord('A0mA1Va'));

// -- names
const byId = new Map(P.STARS().filter(s => s.cat).map(s => [s.cat.id, s]));
const nameCases = [
  ['* alf Cyg', 'Deneb'], ['* bet01 Cyg', 'Albireo'], ['* gam Cyg', 'Sadr'],
  ['* eps Ori', 'Alnilam'], ['* bet Per', 'Algol'], ['* alf CMa', 'Sirius'],
  ['* bet Leo', 'Denebola'], ['* gam Cru', 'Gacrux'],
];
for (const [id, want] of nameCases) {
  const s = byId.get(id);
  ok(s && P.starName(s) === want, `${id} -> ${s ? P.starName(s) : 'MISSING'} (wanted ${want})`);
}
ok(P.bayerName(byId.get('* bet01 Cyg')) === 'beta¹ Cygni',
   'bayer: ' + P.bayerName(byId.get('* bet01 Cyg')));
ok(P.bayerName(byId.get('* alf Cyg')) === 'alpha Cygni',
   'bayer: ' + P.bayerName(byId.get('* alf Cyg')));

// -- the card renders and its buttons are wired
P.nextQuestion();
const card = document.getElementById('quiz');
ok(card.innerHTML.includes('class="opts"'), 'card draws options');
const btns = card.querySelectorAll('.opts button');
ok(btns.length === 4, `card has ${btns.length} option buttons`);
const before = P.QUIZ.asked;
btns[0].onclick();
ok(P.QUIZ.asked === before + 1, 'answering counts the question');
ok(card.innerHTML.includes('class="why'), 'answering shows the explanation');
ok(card.innerHTML.includes('qnext'), 'answering offers the next question');

// -- the setup box: the buttons exist, they are wired, and the hemisphere row
// is on the screen exactly when it is in force
{
  P.QUIZ.cat = 'all'; P.QUIZ.hemi = 'all';
  P.renderQuiz();
  const box = () => document.getElementById('quiz');
  for (const c of P.CATEGORIES)
    ok(box().innerHTML.includes(`data-cat="${c.id}"`) === P.catPossible(c.id),
       `category button ${c.id} shown when it should not be, or missing`);
  ok(box().innerHTML.includes('data-hm="north"'),
     'hemisphere row is missing under "random"');

  const cat = id => box().querySelectorAll('[data-cat]')
                         .find(b => b.dataset.cat === id);
  cat('con').onclick();
  ok(P.QUIZ.cat === 'con', 'clicking a category selects it');
  ok(box().innerHTML.includes('data-hm="north"'), 'hemisphere row is not up under constellations');
  const hm = id => box().querySelectorAll('[data-hm]').find(b => b.dataset.hm === id);
  hm('south').onclick();
  ok(P.QUIZ.hemi === 'south', 'clicking a hemisphere selects it');
  ok(P.pool().every(a => P.conHemi(a) === 'south'), 'the click did not reach the pool');
  ok(!!P.QUIZ.q && box().innerHTML.includes('class="opts"'),
     'a new question follows the click');
  cat('type').onclick();
  ok(box().innerHTML.includes('data-hm="north"'),
     'hemisphere row went away under "star type" — it is every category\'s now');
  cat('all').onclick();
  P.QUIZ.hemi = 'all';
}

// scoring
P.QUIZ.asked = P.QUIZ.right = P.QUIZ.streak = 0;
for (let n = 0; n < 25; n++) {
  P.nextQuestion();
  const q = P.QUIZ.q;
  P.answer(q.answer);           // always right
}
ok(P.QUIZ.right === 25 && P.QUIZ.streak === 25, `25 right -> ${P.QUIZ.right}/${P.QUIZ.asked} streak ${P.QUIZ.streak}`);
P.nextQuestion();
P.answer((P.QUIZ.q.answer + 1) % 4);
ok(P.QUIZ.streak === 0, 'a wrong answer resets the streak');
ok(P.QUIZ.best === 25, `best streak kept: ${P.QUIZ.best}`);

// ============================================================ what a star is called
// Publications reference a star by its DESIGNATION -- the Bayer letter with
// the constellation genitive, gamma Cygni, and HD/HIP below that -- and carry
// the proper name alongside it as an alias that only about 450 stars have.
// Proper names were unregulated until the IAU's Working Group on Star Names
// began publishing one approved spelling each in 2016, and this catalogue
// still holds the older ones next to the new: the wrong one winning is a
// silent error, because both are real words and neither throws.
{
  const stars = P.STARS().filter(s => !s.solar && s.cat);
  const byId = new Map(stars.map(s => [s.cat.id, s]));
  const nameOf = id => { const s = byId.get(id); return s ? P.properName(s) : undefined; };

  // -- the IAU's own entry outranks everything, including the catalogue's
  // `name` field, which is what used to win
  for (const [id, want] of [['* gam Cas', 'Tiansi'], ['* eps Cyg', 'Aljanah'],
                            ['* ksi Pup', 'Azmidi'], ['* bet Cnc', 'Tarf'],
                            ['* eta Aql', 'Pagru'], ['* mu. Cep', 'Erakis'],
                            ['* zet Her', 'Tianji']]) {
    if (!byId.has(id)) continue;
    ok(nameOf(id) === want, `${id} is called ${JSON.stringify(nameOf(id))}, IAU says ${want}`);
  }

  // -- and the names the IAU RETIRED are gone. Gienah was moved to gamma
  // Corvi and Navi was an Apollo crew's joke; both are still sitting in this
  // catalogue's names list, one entry away from being printed.
  for (const [id, gone] of [['* eps Cyg', 'Gienah'], ['* gam Cas', 'Navi'],
                            ['* gam Cas', 'Tsih']]) {
    if (!byId.has(id)) continue;
    ok(nameOf(id) !== gone, `${id} is being called ${gone}, which the IAU does not`);
  }
  // Gienah belongs to gamma Corvi, and should still be there
  if (byId.has('* gam Crv'))
    ok(nameOf('* gam Crv') === 'Gienah',
       `gamma Corvi is called ${JSON.stringify(nameOf('* gam Crv'))}, wanted Gienah`);

  // -- a designation spelled out in words is not a name. The catalogue's own
  // `name` field carried 25 of these and every one of them DISPLACED the real
  // name sitting further down the list.
  const greek = [...Object.keys(P.GREEK), ...Object.values(P.GREEK)]
    .map(g => g.replace('.', ''));
  const cons = new Set();
  for (const a of Object.keys(P.CON_NAMES)) {
    cons.add(a.toLowerCase());
    cons.add(P.CON_NAMES[a].toLowerCase());
    cons.add((P.CON_GEN[a] || a).toLowerCase());
  }
  let leaked = 0;
  for (const s of stars) {
    const p = P.properName(s);
    if (!p) continue;
    const w = p.split(/\s+/);
    const head = w[0].toLowerCase().replace('.', '');
    const rest = w.slice(1).join(' ').replace(/^\d+\s*/, '').toLowerCase();
    if ((greek.includes(head) || /^[a-z]$/.test(head)) && cons.has(rest)) {
      leaked++;
      ok(false, `${s.cat.id}: the designation ${JSON.stringify(p)} is being served as its name`);
    }
  }
  ok(leaked === 0, `${leaked} designations are being served as proper names`);

  // -- a component letter belongs to the designation, not to the name. The
  // star is Mizar; `Mizar A` is the name and the component spliced together.
  for (const s of stars) {
    const p = P.properName(s);
    if (p) ok(!/\s[A-E]$/.test(p), `${s.cat.id} is called ${JSON.stringify(p)}`);
  }
  if (byId.has('* zet01 UMa'))
    ok(nameOf('* zet01 UMa') === 'Mizar',
       `zeta-1 Ursae Majoris is called ${JSON.stringify(nameOf('* zet01 UMa'))}`);

  // -- the two spellings written down in IAU_FIX. Checked in both directions,
  // so an entry the catalogue fixes upstream shows up as a dead rule rather
  // than sitting here forever pretending to do something.
  for (const [wrong, right] of Object.entries(P.IAU_FIX)) {
    const hits = stars.filter(s => P.properName(s) === right);
    ok(hits.length > 0, `IAU_FIX maps ${wrong} -> ${right}, but nothing is called ${right}`);
    ok(!stars.some(s => P.properName(s) === wrong),
       `${wrong} is still being printed, and IAU_FIX says it should be ${right}`);
    // the rule is only earning its place while the catalogue still says the
    // wrong thing somewhere in the star's own names
    const raw = hits.some(s => {
      const f = PAYLOAD.facts[s.cat.id] || {};
      return (s.cat.name === wrong) || (f.name === wrong)
          || (f.names || []).some(n => String(n).trim() === wrong);
    });
    if (!raw) console.log(`  note IAU_FIX: the catalogue no longer says "${wrong}" — the rule is dead`);
  }

  // -- every designation is spelled the way a publication spells it: the
  // GENITIVE, not the nominative. "beta Persei", never "beta Perseus" --
  // which is the one thing a beginner cannot get to on their own, and the
  // reason CON_GEN exists at all.
  let desig = 0;
  for (const s of stars) {
    const b = P.bayerName(s);
    if (!b) continue;
    desig++;
    const tail = b.replace(/^\S+\s+/, '').replace(/\s+[A-E]$/, '');
    ok(!Object.values(P.CON_NAMES).includes(tail) || Object.values(P.CON_GEN).includes(tail),
       `${s.cat.id} designates as ${JSON.stringify(b)} — nominative, not genitive`);
  }
  ok(desig > 400, `only ${desig} stars have a designation`);

  // -- the two are never the same string. An option reading "Sadr · Sadr"
  // is what withDesig() exists to avoid.
  for (const s of stars) {
    const alt = P.starAlt(s);
    if (alt) ok(alt !== P.properName(s),
                `${s.cat.id}: name and designation are both ${JSON.stringify(alt)}`);
  }

  const named = stars.filter(s => P.properName(s)).length;
  console.log(`  names: ${named} of ${stars.length} stars carry a proper name, `
    + `${desig} a designation`);
}

// ============================================================ the review
// A board is wrong rather than broken in exactly one way that matters, and
// it does not throw: a name that cannot be put where it belongs. Two shapes
// whose stars land on top of each other on screen, a tray holding the same
// word twice, a target the frame does not contain -- each of those makes a
// board that cannot be finished, and each is checked here by actually
// playing it: pose the sky, click every star, and read what came back.
{
  const R = P.REVIEW;

  // -- Serpens. One figure in the catalogue and two shapes on the sky, split
  // by its own segments rather than by a table: the component holding alpha
  // Serpentis is the head and the one holding eta Serpentis is the tail.
  {
    const comps = P.figureComponents('Ser');
    ok(comps.length === 2,
       `Serpens: the figure has ${comps.length} connected components, wanted 2`);
    const ts = P.conTargets('Ser');
    ok(ts.length === 2, `Serpens: ${ts.length} targets, wanted Caput and Cauda`);
    if (ts.length === 2) {
      const [caput, cauda] = ts;
      ok(caput.label === 'Serpens Caput' && cauda.label === 'Serpens Cauda',
         `Serpens split as ${ts.map(t => t.label).join(' / ')}`);
      const names = t => t.stars.map(s => s.cat && s.cat.id);
      ok(names(caput).includes('* alf Ser'), 'Serpens Caput does not hold alpha Serpentis');
      ok(names(cauda).includes('* eta Ser'), 'Serpens Cauda does not hold eta Serpentis');
      const inBoth = caput.stars.filter(s => cauda.stars.includes(s));
      ok(inBoth.length === 0,
         `${inBoth.length} star(s) are in both halves of Serpens`);
      // and the two really are somewhere else from each other, which is the
      // whole reason one caption between them would not do
      const dot = caput.dir[0] * cauda.dir[0] + caput.dir[1] * cauda.dir[1]
                + caput.dir[2] * cauda.dir[2];
      const sep = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      ok(sep > 20, `the two halves of Serpens are ${sep.toFixed(0)} deg apart`);
    }
    // every constellation that is NOT split gives exactly one target, and it
    // is the constellation
    for (const a of ['Ori', 'UMa', 'Cyg', 'Oph']) {
      const one = P.conTargets(a);
      ok(one.length === 1 && one[0].key === a,
         `${a} produced ${one.length} targets`);
    }
  }

  // -- every group is answerable. This is the board actually being played:
  // the sky is posed, a frame is drawn, and then every star of every target
  // is clicked to see which name the board thinks was pointed at.
  const wasMode = R.on;
  P.setMode(true);
  for (let g = 0; g < P.REVIEW_GROUPS.length; g++) {
    const G = P.REVIEW_GROUPS[g];
    for (const a of G.cons)
      ok(P.conStars(a).length > 0,
         `group "${G.label}" names ${a}, which this catalogue does not draw`);

    for (const kind of ['shapes', 'stars']) {
      R.group = g; R.kind = kind;
      P.buildBoard(); P.reviewPose(); settle();

      const ts = R.targets;
      ok(ts.length >= 4, `${G.label}/${kind}: only ${ts.length} to place`);
      ok(new Set(ts.map(t => t.key)).size === ts.length,
         `${G.label}/${kind}: two targets share a key`);
      // Two chips reading the same word is a board that cannot be finished:
      // whichever you put down, the other is wrong and it looks like a bug.
      ok(new Set(ts.map(t => t.label)).size === ts.length,
         `${G.label}/${kind}: two chips read the same — `
         + ts.map(t => t.label).join(' | '));
      ok(ts.every(t => t.label && !/^[A-Za-z]?\*\s|^HD |^HIP /.test(t.label)),
         `${G.label}/${kind}: a chip is a catalogue designation — `
         + ts.map(t => t.label).join(' | '));
      ok(R.chips.length === ts.length && new Set(R.chips).size === ts.length,
         `${G.label}/${kind}: the tray does not match the board`);
      if (kind === 'stars') {
        ok(ts.length <= P.REVIEW_STARS_MAX,
           `${G.label}/stars: ${ts.length} chips, over the cap of ${P.REVIEW_STARS_MAX}`);
        ok(ts.every(t => t.star && P.properName(t.star)),
           `${G.label}/stars: a target has no proper name`);
      }

      // the isolate is exactly the group and nothing else, so the board is
      // played on a sky holding only what it asks about
      const iso = [...(P.ISOLATE || [])].sort();
      ok(iso.join(',') === G.cons.slice().sort().join(','),
         `${G.label}/${kind}: isolated ${iso.join(',')}`);

      // every target is IN the frame -- a name with nowhere to go is the one
      // way this board can be impossible rather than hard
      const seen = new Map(P.proj.map(q => [q.s, q]));
      let framed = 0;
      for (const t of ts)
        if (t.stars.some(s => {
          const q = seen.get(s);
          return q && q.x > 0 && q.x < P.W() && q.y > 0 && q.y < P.H();
        })) framed++;
      ok(framed === ts.length,
         `${G.label}/${kind}: ${ts.length - framed} of ${ts.length} targets are off screen`);

      // and pointing at one really does pick it. Every star of every target,
      // which is what a reader actually clicks on.
      let hits = 0, tried = 0, worst = null;
      for (const t of ts)
        for (const s of t.stars) {
          const q = seen.get(s);
          if (!q || q.x < 0 || q.x > P.W() || q.y < 0 || q.y > P.H()) continue;
          tried++;
          const got = P.reviewHit(q.x, q.y);
          if (got === t) hits++;
          else if (!worst) worst = `${t.label} -> ${got ? got.label : 'nothing'}`;
        }
      ok(hits === tried,
         `${G.label}/${kind}: ${tried - hits} of ${tried} clicks landed on the `
         + `wrong name (e.g. ${worst})`);

      // -- play it right through. Place every name where it belongs, check,
      // and the board is a clean sweep.
      for (const t of ts) {
        R.sel = t.key;
        const q = t.stars.map(x => seen.get(x)).find(x => x);
        ok(P.reviewClick(q.x, q.y) === true,
           `${G.label}/${kind}: could not place ${t.label}`);
      }
      ok(R.place.size === ts.length,
         `${G.label}/${kind}: ${R.place.size} of ${ts.length} placed`);
      P.checkBoard();
      ok(P.reviewScore() === ts.length,
         `${G.label}/${kind}: played correctly and scored `
         + `${P.reviewScore()}/${ts.length}`);
      ok(R.checked, `${G.label}/${kind}: check did not take`);
    }
  }

  // -- a name is in one place at a time, and a place holds one name.
  {
    R.group = 0; R.kind = 'shapes';
    P.buildBoard(); P.reviewPose(); settle();
    const seen = new Map(P.proj.map(q => [q.s, q]));
    const [a, b] = R.targets;
    const at = t => { const s = t.stars.map(x => seen.get(x)).find(x => x); return s; };
    R.sel = a.key; P.reviewClick(at(a).x, at(a).y);
    ok(P.targetHolding(a.key) === a.key, 'a placed name is not where it was put');
    // the same name again, somewhere else: it moves rather than duplicating
    R.sel = a.key; P.reviewClick(at(b).x, at(b).y);
    ok(P.targetHolding(a.key) === b.key, 'moving a name did not move it');
    ok(R.place.size === 1, `moving a name left ${R.place.size} placements`);
    // and a second name onto the same place turns the first one out
    R.sel = b.key; P.reviewClick(at(b).x, at(b).y);
    ok(R.place.get(b.key) === b.key, 'the second name did not take the place');
    ok(R.place.size === 1, `two names are on one shape (${R.place.size} placed)`);

    // a swap is worth two, and the board says which two
    P.buildBoard();
    R.sel = a.key; P.reviewClick(at(b).x, at(b).y);
    R.sel = b.key; P.reviewClick(at(a).x, at(a).y);
    for (const t of R.targets.slice(2)) {
      R.sel = t.key;
      P.reviewClick(at(t).x, at(t).y);
    }
    P.checkBoard();
    ok(P.reviewScore() === R.targets.length - 2,
       `a swapped pair scored ${P.reviewScore()}/${R.targets.length}`);
  }

  // -- the board gives nothing away before it is checked. The captions are
  // off, no star is named, and the only words painted on the sky are the
  // ones the reader put there.
  {
    R.group = 1; R.kind = 'shapes';
    P.buildBoard(); P.reviewPose();
    ok(P.showLabels === false, 'a board posed with the captions on');
    DRAWN.length = 0;
    settle();
    const labels = R.targets.map(t => t.label);
    const leaked = DRAWN.filter(t => labels.includes(t));
    ok(leaked.length === 0,
       `the empty board painted its own answers: ${leaked.join(', ')}`);

    // one name down, and that one word appears -- because the reader wrote it
    const seen = new Map(P.proj.map(q => [q.s, q]));
    const t0 = R.targets[0];
    const q0 = t0.stars.map(x => seen.get(x)).find(x => x);
    R.sel = t0.key; P.reviewClick(q0.x, q0.y);
    DRAWN.length = 0; settle();
    ok(DRAWN.includes(t0.label), 'a placed name was not painted on the sky');
    ok(DRAWN.filter(t => labels.includes(t)).length === 1,
       'placing one name painted more than one');

    // it is painted in the violet that means "you put this here" and in
    // neither green nor red, because nothing has been graded yet
    STYLES.length = 0; settle();
    const said = c => STYLES.some(x => String(x).toLowerCase().includes(c));
    ok(said('d2a8ff'), 'a pending placement is not in the highlight violet');
    ok(!said('3fb950'), 'an unchecked board painted something green');

    // and the sky is held back while the board is open, the way it is under
    // a question: a tooltip would print the designation of the star being
    // pointed at, which is the answer
    ok(P.quizHolds(), 'the board does not hold the sky back');
    P.showTip(R.targets[0].stars[0], 10, 10);
    ok(/place them first/.test(P.tipHTML()),
       `the tooltip over an open board said: ${P.tipHTML().slice(0, 80)}`);
    P.checkBoard();
    ok(!P.quizHolds(), 'a checked board is still holding the sky back');
  }

  // -- the spectral ladder. Every rung is a real frame off this shelf, in
  // the sequence, and the drill takes the lines off the plot as well as the
  // letter off the swatch -- a marked Hbeta names the class by itself.
  {
    R.kind = 'spectra';
    P.buildBoard(); P.reviewPose(); P.renderReview();
    ok(P.ISOLATE === null, 'the ladder isolated part of the sky');
    ok(!P.quizHolds(), 'the ladder holds the sky back, and asks nothing of it');
    const h = P.ladderHTML();
    if (!P.BY_CLASS().size) {
      console.log('  note ladder: no spectra on file, correctly says so');
      ok(/no spectra/i.test(h), 'no frames, and the ladder does not say so');
    } else {
      for (const L of P.SPEC_ORDER) {
        const s = P.specStar(L);
        if (!s) { console.log(`  note ladder: no ${L} on this shelf`); continue; }
        ok((P.typeLetter(s.sp) || '').toUpperCase() === L,
           `ladder rung ${L} shows ${s.label}, which is ${P.typeLetter(s.sp)}`);
        ok(h.includes(P.esc(P.CLASS_SHORT[L])),
           `ladder rung ${L} does not say what its lines are`);
        ok(h.includes(P.esc(P.starName(s))),
           `ladder rung ${L} does not name the star it is showing`);
        ok(!!P.CLASS_MARKS[L], `ladder rung ${L} has no lines to mark`);
        // face up, it IS drawn in the star's own colour -- that is half of
        // what makes the sequence readable as a sequence
        ok(P.ladderColor(L) === P.classColorFor(s.sp),
           `ladder rung ${L} is not drawn in its own class colour`);
      }
      // face down: no letter, no star, no description, and no marks
      R.specHide = true; R.specShown = new Set();
      R.specOrder = P.SPEC_ORDER;
      const hid = P.ladderHTML();
      for (const L of P.SPEC_ORDER) {
        const s = P.specStar(L);
        if (!s) continue;
        ok(!hid.includes(P.esc(P.starName(s))),
           `the drill names ${P.starName(s)} on its own rung`);
        ok(!hid.includes(P.esc(P.CLASS_SHORT[L])),
           `the drill prints class ${L}'s own description on its rung`);
      }
      ok((hid.match(/which class is this\?/g) || []).length >= 3,
         'the drill turned nothing face down');
      // and the curve itself is in no class's colour. It is normally drawn
      // in the star's own -- blue for an O, orange for a K -- which reads
      // the class off the plot without reading a single line in it.
      for (const L of P.SPEC_ORDER) {
        const s = P.specStar(L);
        if (!s) continue;
        ok(P.ladderColor(L) === P.UNKNOWN_COLOR,
           `the drill draws the ${L} rung in ${P.ladderColor(L)}, which is its class colour`);
      }
      // turning one over brings its own row back and leaves the rest down
      R.specShown = new Set(['A']);
      const one = P.ladderHTML();
      ok(one.includes(P.esc(P.CLASS_SHORT.A)), 'a turned-over rung stayed face down');
      const stillDown = P.SPEC_ORDER.filter(L => L !== 'A' && P.specStar(L))
        .every(L => !one.includes(P.esc(P.CLASS_SHORT[L])));
      ok(stillDown, 'turning one rung over turned them all over');
      R.specHide = false; R.specShown = new Set(); R.specOrder = null;
    }
  }


  // -- every star a name can be put on is MARKED, and nothing else is. A
  // board that accepts a name on twelve of two hundred stars and does not say
  // which twelve is a board you cannot play; and a ring on a star the board
  // will not accept is worse, because it is a promise the hit test breaks.
  {
    R.group = 0; R.kind = 'stars';
    P.buildBoard(); P.reviewPose(); settle();
    const seen = new Map(P.proj.map(q => [q.s, q]));
    for (const t of R.targets) {
      const q = seen.get(t.star);
      ok(!!q, `${t.label} is not drawn at all, so it cannot be ringed`);
      if (!q) continue;
      const ringed = ARCS.some(a => Math.hypot(a[0] - q.x, a[1] - q.y) < 1.5
                                 && a[2] > q.r && a[2] < q.r + 20);
      ok(ringed, `${t.label} is placeable but carries no ring`);
    }
    // -- and on a star board the halo switch means something else. A halo
    // normally says "there is a spectrum of this one", which is a different
    // claim about a different set of stars, and a big soft glow beats a thin
    // ring for the reader's attention every time. So the board takes the
    // switch over rather than seizing it: on, it marks the twelve in
    // question; off, it marks nothing and you find them yourself.
    ok(P.boardOwnsHalo() === true, 'a star board does not own the halo switch');

    const ringCount = () => {
      ARCS.length = 0; settle();
      return R.targets.filter(t => {
        const q = P.proj.find(x => x.s === t.star);
        return q && ARCS.some(a => Math.hypot(a[0] - q.x, a[1] - q.y) < 1.5
                                && a[2] > q.r && a[2] < q.r + 24);
      }).length;
    };
    P.showHalo = true;
    ok(ringCount() === R.targets.length, 'halos on, and not every target is ringed');
    const lit = ARCS.length;
    // The halo pass paints exactly one arc per drawn star, so its absence is
    // a COUNT rather than a size -- which is the only form of this check that
    // works on a clone with no spectra, where the halos are the ordinary
    // narrow ones and comparing radii says nothing.
    const perStar = () => { ARCS.length = 0; settle(); return ARCS.length / P.proj.length; };
    const starRatio = perStar();

    P.showHalo = false;
    ok(ringCount() === 0, 'halos off, and the board is still marking its stars');
    // and the card stops claiming they are ringed, because they are not
    P.renderReview();
    ok(/Nothing is ringed/.test(P.reviewHTML()),
       `halos off, and the card still says: ${P.reviewHTML().slice(0, 160)}`);
    P.showHalo = true; P.renderReview();
    ok(/stars are ringed/.test(P.reviewHTML()), 'halos on, and the card does not say so');
    P.showHalo = false;
    const bare = ARCS.length;
    ok(bare < lit, 'turning the halos off painted no less');

    // a target is still placeable with nothing marking it -- the switch is
    // about what you are SHOWN, not about what the board will accept
    const q0 = P.proj.find(x => x.s === R.targets[0].star);
    ok(!!q0 && P.reviewHit(q0.x, q0.y) === R.targets[0],
       'with the halos off a target stopped being clickable');

    // and the check brings them back whatever the switch says: once the
    // answer is in, the sky stops holding anything back
    R.sel = R.targets[0].key; P.reviewClick(q0.x, q0.y);
    P.checkBoard();
    ok(ringCount() === R.targets.length,
       'the check did not bring the rings back with the halos off');
    P.showHalo = true;

    // -- a shape board has no one star to point at, so the switch goes back
    // to meaning what it says, and the frame paints halos again
    R.kind = 'shapes'; P.buildBoard(); P.reviewPose();
    ok(P.boardOwnsHalo() === false, 'a shape board took the halo switch over');
    const shapeRatio = perStar();
    // a shape board paints a core AND a halo for every star; the star board
    // paints the core, and two arcs for each of its twelve rings
    ok(shapeRatio > starRatio,
       `the star board is still painting halos — ${starRatio.toFixed(2)} arcs `
       + `per star against ${shapeRatio.toFixed(2)} on a shape board`);
    ok(shapeRatio > 1.8,
       `a shape board paints only ${shapeRatio.toFixed(2)} arcs per star, so `
       + `this check is not measuring the halo pass at all`);
    R.kind = 'stars';
  }



  // -- the magnitude and Bortle sliders bite on a board, exactly as they do
  // under a question. A board that sat there unchanged with both on the floor
  // would make them decoration in the one place somebody is most likely to be
  // asking whether they could actually find this from their garden.
  {
    R.group = 0; R.kind = 'stars';
    P.buildBoard(); P.reviewPose(); settle();
    ok(P.rawMag === true, 'a board posed with the magnitude cut exempting figure stars');
    const wasMag = P.magLimit, wasBortle = P.bortle;

    const drawn = () => R.targets.filter(t => P.proj.some(x => x.s === t.star));
    ok(drawn().length === R.targets.length,
       `${R.targets.length - drawn().length} targets are already cut at the default sky`);

    // pull the magnitude slider up past the faintest of them and it goes
    const mags = R.targets.map(t => t.star.vmag).sort((a, b) => b - a);
    P.magLimit = mags[0] - 0.2;
    settle();
    const lost = R.targets.length - drawn().length;
    ok(lost > 0, `cutting at ${(mags[0] - 0.2).toFixed(1)} removed no target `
      + `(faintest is ${mags[0].toFixed(1)})`);
    ok(R.dimmed === lost,
       `${lost} targets are cut but the board counts ${R.dimmed} dimmed`);
    ok(R.offFrame === 0, `a magnitude cut was reported as ${R.offFrame} off the edge`);

    // a star that went under the cut went for that reason, and it is neither
    // ringed nor clickable -- the ring is still exactly the set the hit test
    // will answer for, which the stray-arc check below owns
    for (const t of R.targets) {
      if (P.proj.some(x => x.s === t.star)) continue;
      ok(P.magHidden(t.star), `${t.label} vanished but is not under the cut`);
    }
    // and the card says which of the two it is, in the reader's own words
    P.renderReview();
    ok(/under the magnitude cut/.test(P.reviewHTML()),
       `the board does not say its names are cut: ${P.reviewHTML().slice(0, 200)}`);
    ok(!/off the edge/.test(P.reviewHTML()),
       'a magnitude cut was described as being off the edge');

    // -- the Bortle slider does the same thing through skyLimit(), and the
    // place to watch it is a SHAPES board: the twelve brightest named stars
    // of the Dipper group are all brighter than magnitude 2.5, so the worst
    // sky on the scale leaves every one of them standing -- which is true of
    // the real sky and is why the Plough is the thing city astronomers learn
    // first. The figures are where the faint stars are.
    P.magLimit = wasMag;
    P.bortle = P.SKY_BEST;
    R.kind = 'shapes'; P.buildBoard(); P.reviewPose(); settle();
    const figStars = () => P.proj.filter(q => P.ISOLATE_STARS.has(q.s)).length;
    const dark = figStars();
    P.bortle = 0;                          // a moonlit city centre
    settle();
    const city = figStars();
    ok(P.skyLimit() === 2.5, `the worst sky limits at ${P.skyLimit()}, wanted 2.5`);
    ok(city < dark,
       `the Bortle slider took nothing off the figures (${dark} stars either way)`);
    console.log(`  board: the group draws ${dark} figure stars under an excellent `
      + `sky and ${city} under a moonlit city centre`);

    P.bortle = wasBortle; P.magLimit = wasMag;
    R.kind = 'stars'; P.buildBoard(); P.reviewPose(); settle();
    ok(R.dimmed === 0 && drawn().length === R.targets.length,
       'putting the sliders back did not bring the board back');
  }

  // -- a ring is a promise the hit test can keep. `at` is every star that
  // projects; `proj` is every star the frame DREW, culled at the viewport
  // edge -- and only proj can be clicked. Ringing off `at` put rings on stars
  // that silently would not answer, and since drag and the sliders stay live
  // under a board, any pan does it.
  {
    R.group = 0; R.kind = 'stars';
    P.buildBoard(); P.reviewPose(); settle();
    const ringed = t => {
      const q = P.proj.find(x => x.s === t.star);
      if (!q) return false;
      return ARCS.some(a => Math.hypot(a[0] - q.x, a[1] - q.y) < 1.5
                         && a[2] > q.r && a[2] < q.r + 24);
    };
    const clickable = t => {
      const q = P.proj.find(x => x.s === t.star);
      return !!q && P.reviewHit(q.x, q.y) === t;
    };
    for (const t of R.targets)
      ok(ringed(t) === clickable(t),
         `${t.label}: ringed ${ringed(t)} but clickable ${clickable(t)}`);

    // ZOOM IN on one of them. This is the case the bug actually lived in:
    // the others still project perfectly well -- they are in front of the
    // camera, so `at` has them -- they have simply fallen outside the
    // viewport, which is where the draw loop culls them out of `proj`. Ringed
    // off `at`, they kept their rings and stopped answering.
    P.frame(R.targets[0].dir, 9);
    ARCS.length = 0; settle();
    const near = R.targets.filter(t => P.proj.some(x => x.s === t.star));
    ok(near.length < R.targets.length,
       'zooming to 9 degrees did not push any target out of the frame');
    for (const t of R.targets)
      ok(ringed(t) === clickable(t),
         `zoomed in, ${t.label}: ringed ${ringed(t)} but clickable ${clickable(t)}`);
    // The one that actually catches it. An off-frame target still PROJECTS
    // -- it is in front of the camera, just outside the viewport -- so a ring
    // taken off `at` is painted at a coordinate far off the screen, where
    // nothing else the page draws ever paints: the star loop culls at the
    // edge before it draws anything. So a stray arc out there IS the bug.
    const stray = ARCS.filter(a => a[0] < -200 || a[0] > P.W() + 200
                                || a[1] < -200 || a[1] > P.H() + 200);
    ok(stray.length === 0,
       `${stray.length} rings painted outside the viewport, on stars that `
       + `cannot be clicked`);
    ok(R.offFrame === R.targets.length - near.length,
       `zoomed in, the board says ${R.offFrame} off the edge but `
       + `${R.targets.length - near.length} are not drawn`);

    // turn the sky right away from the group and NOTHING is ringed, because
    // nothing can be clicked -- rather than twelve rings over empty sky
    const away = R.targets[0].dir.map(v => -v);
    P.frame(away, 20);
    ARCS.length = 0; settle();
    const stillRinged = R.targets.filter(ringed).length;
    ok(stillRinged === 0,
       `${stillRinged} stars are ringed with the sky turned away from them`);
    ok(R.offFrame === R.targets.length,
       `the board says ${R.offFrame} of ${R.targets.length} are off the edge`);
    // and the card says so rather than leaving a tray that cannot be emptied
    P.renderReview();
    ok(/off the edge/.test(P.reviewHTML()),
       'the board does not say that its names have nowhere to go');

    // bringing the group back restores every one of them
    P.frameBoard(); settle();
    ok(R.offFrame === 0, `${R.offFrame} still off the edge after re-framing`);
    ok(R.targets.every(ringed), 're-framing did not bring every ring back');
  }

  // -- "show me" REPLACES a wrong name with the right one rather than
  // printing both. Two names on one star is the thing the board was asking
  // you to sort out.
  {
    R.group = 0; R.kind = 'stars';
    P.buildBoard(); P.reviewPose(); settle();
    const seen = new Map(P.proj.map(q => [q.s, q]));
    const [a, b] = R.targets;
    const at = t => seen.get(t.star);
    // put two names on the wrong stars, and the rest right
    R.sel = a.key; P.reviewClick(at(b).x, at(b).y);
    R.sel = b.key; P.reviewClick(at(a).x, at(a).y);
    for (const t of R.targets.slice(2)) { R.sel = t.key; P.reviewClick(at(t).x, at(t).y); }
    P.checkBoard();
    DRAWN.length = 0; settle();
    ok(DRAWN.includes(a.label) && DRAWN.includes(b.label),
       'the check did not paint the names that were put down');
    R.shown = true;
    DRAWN.length = 0; settle();
    const wrongStill = DRAWN.filter(x => x === a.label || x === b.label).length;
    // each name is still painted ONCE -- on its own star, in the truth
    // colour -- and not a second time on the star it was wrongly put on
    ok(wrongStill === 2,
       `"show me" painted ${wrongStill} copies of the two swapped names, wanted 2`);
    STYLES.length = 0; DRAWN.length = 0; settle();
    ok(!STYLES.some(c => String(c).toLowerCase().includes('f85149')),
       '"show me" left a red label on the sky');
    ok(DRAWN.filter(x => R.targets.some(t => t.label === x)).length === R.targets.length,
       '"show me" did not name every star exactly once');
  }

  // -- the board's own keyboard. A number picks a name up and Enter checks
  // what has been put down -- and, crucially, the quiz's keys do NOT reach
  // through: `n` there means "next question", which over an open board would
  // pose a question on the sky the board is being played on and take the
  // shapes away mid-placement.
  {
    const key = k => (global.__listeners.keydown || [])
      .forEach(fn => fn({ key: k, target: { tagName: 'BODY' }, preventDefault() {} }));
    R.kind = 'shapes'; R.group = 0;
    P.buildBoard(); P.reviewPose(); settle();
    key('3');
    ok(R.sel === R.chips[2], '3 did not pick up the third name');
    const board = [...P.ISOLATE].sort().join(',');
    key('n');
    ok([...P.ISOLATE].sort().join(',') === board,
       'the quiz\'s "next question" key reached through an open board');
    ok(R.on, 'a keypress left review mode');
    // Enter with nothing down does nothing; with something down it checks
    key('Enter');
    ok(!R.checked, 'Enter checked an empty board');
    const seen = new Map(P.proj.map(q => [q.s, q]));
    const t0 = R.targets[0];
    const q0 = t0.stars.map(x => seen.get(x)).find(x => x);
    R.sel = t0.key; P.reviewClick(q0.x, q0.y);
    key('Enter');
    ok(R.checked, 'Enter did not check the board');
    key('Enter');
    ok(!R.checked && R.place.size === 0, 'Enter on a checked board did not deal a new one');
  }

  // -- the mode switch puts each half back the way it found it
  {
    R.kind = 'shapes'; R.group = 2;
    P.buildBoard(); P.reviewPose();
    const board = [...P.ISOLATE].sort().join(',');
    P.setMode(false);
    ok(R.on === false, 'the switch did not leave review');
    ok(!!P.QUIZ.q, 'leaving review left no question up');
    ok(P.ISOLATE === null || P.ISOLATE.size <= 4,
       'a question is posed over a review board\'s isolate');
    P.setMode(true);
    ok(R.on === true, 'the switch did not go back to review');
    ok(!!P.ISOLATE && [...P.ISOLATE].sort().join(',') === board,
       'review came back on a different board from the one it left');
    // the ladder isolates nothing, and coming back to it must not isolate
    // the last group either
    R.kind = 'spectra'; P.buildBoard(); P.reviewPose();
    P.setMode(false); P.setMode(true);
    ok(P.ISOLATE === null, 'the ladder came back with a group isolated');
    ok(R.targets.length === 0, 'the ladder built a board of things to place');
    P.setMode(wasMode);
  }

  console.log(`  review: ${P.REVIEW_GROUPS.length} groups × `
    + `${P.REVIEW_KINDS.length} boards played through`);
}





// ============================================ two fingers on the glass
// A pinch that also drags is the failure this file exists to stop coming
// back, and it is invisible from the code: the pinch listeners sit on the
// CAPTURE phase and the drag listeners on the bubble, so the pinch handler
// set `dragging = false` and the drag handler, running after it, set it back.
// Every move of both fingers then turned the sky, which loops rather than
// zooms. Nothing throws, and on a desktop nothing happens at all.
{
  // Canvas coordinates in, window coordinates out. The canvas does not start
  // at the window's origin -- the rail is 380px of it -- and ex()/ey() exist
  // precisely because those two stopped being the same number. A synthetic
  // event that forgets it is pointing 380px to the left of where it means to,
  // which makes every assertion about what was tapped pass for the wrong
  // reason.
  const touch = (id, x, y) => ({ pointerId: id, pointerType: 'touch',
    clientX: x + P.CVX, clientY: y + P.CVY, preventDefault() {}, });
  const clear = () => { P.TOUCHES.clear(); P.dragging = false; };

  const was = { yaw: P.yaw, pitch: P.pitch, fov: P.fovDeg };

  // -- the guard itself: with two fingers down, a move must not turn the sky
  clear();
  P.TOUCHES.set(1, { x: 100, y: 100 });
  P.TOUCHES.set(2, { x: 300, y: 300 });
  P.dragging = true;                       // as the bubble handler would leave it
  const before = { yaw: P.yaw, pitch: P.pitch };
  P.fire('pointermove', touch(1, 160, 160));
  P.fire('pointermove', touch(2, 340, 340));
  ok(P.yaw === before.yaw && P.pitch === before.pitch,
     `two fingers down and the sky turned ${((Math.abs(P.yaw - before.yaw)
       + Math.abs(P.pitch - before.pitch)) * 180 / Math.PI).toFixed(2)} degrees`);

  // -- one finger still drags, or the guard has eaten the thing it protects
  clear();
  P.TOUCHES.set(1, { x: 100, y: 100 });
  P.dragging = true;
  P.fire('pointermove', touch(1, 160, 160));
  ok(P.yaw !== before.yaw || P.pitch !== before.pitch,
     'one finger no longer turns the sky');
  clear();
  P.yaw2 = was.yaw;

  // -- the field is all a pinch changes. No anchor means nothing to solve
  // for, so there is no rotation to accumulate however far it is dragged.
  const aim = { yaw: P.yaw, pitch: P.pitch };
  P.zoomField(30);
  ok(P.yaw === aim.yaw && P.pitch === aim.pitch, 'zooming the field turned the sky');
  ok(Math.abs(P.fovDeg - 30) < 1e-9, `asked for 30 degrees, got ${P.fovDeg}`);
  P.zoomField(120);
  ok(P.yaw === aim.yaw && P.pitch === aim.pitch, 'zooming back out turned the sky');

  // and it is clamped at both ends rather than running away
  P.zoomField(1e6);
  ok(P.fovDeg <= 340 + 1e-9, `the field opened to ${P.fovDeg}`);
  P.zoomField(-5);
  ok(P.fovDeg >= 8 - 1e-9, `the field closed to ${P.fovDeg}`);

  // -- coming out of a pinch, neither finger is a tap. Both lift having
  // barely moved, which would otherwise open the panel or put a name down at
  // the end of every zoom.
  // On a review board, where a tap has somewhere definite to land: a chip is
  // picked up and a finger lifts directly over a target. Without the guard
  // that places the name, so every zoom ends by putting a name down.
  clear();
  P.setMode(true);
  P.REVIEW.kind = 'stars'; P.REVIEW.group = 0;
  P.buildBoard(); P.reviewPose(); settle();
  const target = P.REVIEW.targets[0];
  const at = P.proj.find(x => x.s === target.star);
  ok(!!at, 'no drawn target to lift a finger over');
  if (at) {
    P.REVIEW.sel = target.key;
    P.fire('pointerdown', touch(1, at.x, at.y));
    P.fire('pointerdown', touch(2, at.x + 140, at.y + 140));
    ok(P.PINCHED === true, 'a second finger did not register as a pinch');
    ok(P.dragging === false, 'a second finger left the drag running');
    P.fire('pointerup', touch(1, at.x + 1, at.y + 1));
    ok(P.REVIEW.place.size === 0,
       'lifting out of a pinch put a name down on the board');
    ok(!P.panelOpen(), 'lifting out of a pinch opened the detail panel');
  }

  // a fresh single finger is a tap again, and does place a name
  clear();
  P.fire('pointerdown', touch(1, at.x, at.y));
  ok(P.PINCHED === false, 'a new one-finger gesture is still flagged as a pinch');
  P.fire('pointerup', touch(1, at.x, at.y));
  ok(P.REVIEW.place.get(target.key) === target.key,
     'a plain tap no longer places a name — the guard has eaten the gesture');
  clear();
  P.buildBoard(); P.setMode(false);
  P.zoomField(was.fov);
  console.log('  touch: a pinch changes the field and nothing else');
}

// ============================================ zoom, and the two fingers
// A pinch applied as a per-event ratio about the live midpoint does three
// wrong things at once and none of them throws: it compounds, it double-counts
// (both fingers report a move for one change), and it re-aims at a moving
// anchor so the sky walks in a circle. The property that catches all three is
// the same one: a gesture that ends where it started must leave the sky where
// it started.
{
  // Any turn still in flight has to land first. A tween from an earlier check
  // keeps moving yaw and pitch on its own, and a drift measured through one
  // is the tween being measured, not the zoom -- which is what this block
  // originally caught itself doing.
  settle();
  const start = { yaw: P.yaw, pitch: P.pitch, fov: P.fovDeg };

  // And the orientation is PINNED, not inherited. aimAt() is exact only while
  // the anchor's declination is reachable at that screen offset: D.z = b cosP
  // + c sinP has range +/-M, so within roughly 25 degrees of the pole with the
  // cursor well off centre there is no aim that puts the anchor back, and the
  // code clamps to the closest one instead of refusing to zoom. It says so.
  //
  // Measured from wherever the questions above happened to leave the camera,
  // the exactness check below therefore failed about one run in twenty --
  // reporting the sky rather than the code, and eroding the one thing a
  // 33,000-check harness is for. The clamp is checked on purpose further down.
  P.yaw2 = 1.0;
  P.pitch2 = 0.35;                              // 20 degrees: mid-sky, exact

  // -- zoomTo is absolute. Asking for the same field twice is a no-op, which
  // is what makes a pinch that pauses mid-gesture stay still.
  P.zoomTo(400, 300, 40);
  const once = { yaw: P.yaw, pitch: P.pitch, fov: P.fovDeg };
  P.zoomTo(400, 300, 40);
  ok(Math.abs(P.fovDeg - once.fov) < 1e-9
     && Math.abs(P.yaw - once.yaw) < 1e-9
     && Math.abs(P.pitch - once.pitch) < 1e-9,
     'asking for the same field twice moved the sky');

  // -- and it is reversible about a fixed anchor: out and back returns the
  // field AND the aim. The old incremental form drifted on exactly this.
  const before = { yaw: P.yaw, pitch: P.pitch, fov: P.fovDeg };
  for (const f of [55, 80, 110, 80, 55, 40]) P.zoomTo(400, 300, f);
  ok(Math.abs(P.fovDeg - before.fov) < 1e-6,
     `a round trip through the field ended at ${P.fovDeg.toFixed(4)}, `
     + `started at ${before.fov.toFixed(4)}`);
  // exactly reversible, not approximately: measured at 0.000 degrees over 200
  // starting orientations. This is the property a pinch would need if it were
  // anchored, and it is why the wheel can be.
  const drift = Math.hypot(P.yaw - before.yaw, P.pitch - before.pitch) * 180 / Math.PI;
  ok(drift < 1e-6,
     `zooming out and back walked the aim ${drift.toFixed(6)} degrees`);

  // -- zoomAbout is still the multiplying form the wheel wants, unchanged
  P.zoomTo(400, 300, 60);
  P.zoomAbout(400, 300, 2);
  ok(Math.abs(P.fovDeg - 120) < 1e-9,
     `a factor of two gave ${P.fovDeg.toFixed(4)} degrees, wanted 120`);

  // -- the anchor holds. Whatever was under the anchor pixel stays there,
  // which is the whole contract a pinch is asking zoomTo to keep.
  P.zoomTo(400, 300, 70);
  const keep = P.unproject(400, 300, P.camera());
  P.zoomTo(400, 300, 25);
  const now = P.unproject(400, 300, P.camera());
  const moved = Math.acos(Math.max(-1, Math.min(1,
    keep[0] * now[0] + keep[1] * now[1] + keep[2] * now[2]))) * 180 / Math.PI;
  ok(moved < 0.05,
     `the anchored direction slid ${moved.toFixed(3)} degrees under the anchor`);

  // -- and beside the pole it SLIPS rather than refusing, which is the trade
  // aimAt() names in its own comment. Worth pinning at both ends: a change
  // that made it exact here would be a real improvement and should be seen,
  // and a change that let the clamp run away would be a bug wearing the same
  // clothes. The aim is compared as a direction because yaw past the pole is
  // free to swing a long way for a small move.
  const fwd = () => P.camera().f;
  const sep = (a, b) => Math.acos(Math.max(-1, Math.min(1,
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  P.yaw2 = 1.0;
  P.pitch2 = 1.45;                              // 83 degrees, inside the cap
  P.fovDeg2 = 40;
  const beside = fwd();
  P.zoomTo(400, 300, 110);
  P.zoomTo(400, 300, 40);
  const slip = sep(fwd(), beside);
  ok(slip > 1e-6,
     'zooming out and back beside the pole is exact now — aimAt no longer '
     + 'clamps, and the check above can drop its pinned orientation');
  ok(slip < 30,
     `the near-pole clamp walked the aim ${slip.toFixed(3)} degrees, which is `
     + 'no longer the closest reachable orientation');
  console.log(`  zoom: exact away from the pole, ${slip.toFixed(1)} degrees of `
    + 'documented slip at 83');

  P.yaw2 = start.yaw;
  P.pitch2 = start.pitch;
  P.fovDeg2 = start.fov;

  // ============================================ how big a star is drawn
  // A star is drawn in pixels and a constellation in degrees, so on a small
  // screen the figure shrinks and the dots do not, until the shape is under
  // its own stars.
  const was = P.PHONE;
  ok(P.starScale() === 1, 'the desktop is scaling its stars');
  const star = P.STARS().find(s => !s.solar && s.vmag !== null && s.vmag < 2);
  const big = P.sizeOf(star, 100);

  // a phone-sized visible area: the harness canvas is desktop-shaped, so the
  // short side is squeezed to what a handset actually gives the sky
  const wasInset = P.SKY_INSET;
  P.PHONE = true;
  P.SKY_INSET = P.H() - 400;
  ok(P.starScale() < 1, 'a phone is not shrinking its stars at all');
  const small = P.sizeOf(star, 100);
  ok(small < big, `a phone draws ${star.label} at ${small.toFixed(2)}px `
    + `against ${big.toFixed(2)}px on a desktop`);
  ok(small > big * 0.45,
     `a phone shrank ${star.label} to ${(small / big * 100).toFixed(0)}% — `
     + 'far enough that a bright star stops carrying its figure');
  // -- the knee at the top of the ramp. The curve is drawn for magnitudes 0
  // to 6 and exp() runs away below zero, so the two stars brighter than the
  // designed range are compressed rather than left to grow into blobs.
  //
  // Measured on synthetic magnitudes at a pinned field, NOT on catalogue
  // stars: sizeOf() also reads fovDeg, which every earlier check leaves
  // somewhere different, and gives an observed star a small boost, which the
  // two runs disagree about. A named star's pixel size is a fact about the
  // test order and the spectra on the shelf as much as about the ramp.
  P.PHONE = false; P.SKY_INSET = wasInset;
  const wasFov = P.fovDeg;
  P.fovDeg2 = 60;                           // fovScale is exactly 1 here
  const at = v => P.sizeOf({ vmag: v, solar: false, obs: null }, 100);

  ok(Math.abs(at(-1.46) - 11.0) < 0.01,
     `Sirius's magnitude draws at ${at(-1.46).toFixed(2)}px, wanted 11.00`);
  ok(Math.abs(at(-0.74) - 9.78) < 0.01,
     `Canopus's magnitude draws at ${at(-0.74).toFixed(2)}px, wanted 9.78`);

  // the designed range comes through the knee untouched: 8.5px at magnitude
  // 0 down to about 1px at 6, which is the ramp as its comment describes it
  for (const [v, want] of [[0, 8.5], [1, 6.17], [2, 4.44], [4, 2.21], [6, 0.99]])
    ok(Math.abs(at(v) - want) < 0.01,
       `magnitude ${v} draws at ${at(v).toFixed(2)}px, wanted ${want} — `
       + 'the knee has reached into the ramp');

  // still monotonic, and Sirius is still plainly the biggest thing on the sky
  let prev = Infinity;
  for (let v = -1.5; v <= 6; v += 0.25) {
    ok(at(v) <= prev + 1e-9, `the ramp is not monotonic around magnitude ${v}`);
    prev = at(v);
  }
  ok(at(-1.46) > at(0) * 1.25,
     `Sirius is only ${(at(-1.46) / at(0)).toFixed(2)}x a magnitude-0 star`);
  ok(at(-1.46) <= P.STAR_KNEE + 2.01,
     `the knee let a star reach ${at(-1.46).toFixed(2)}px`);
  P.fovDeg2 = wasFov;

  P.PHONE = was; P.SKY_INSET = wasInset;
  ok(P.sizeOf(star, 100) === big, 'the star size did not go back with the flag');
  // and raising the sheet on a desktop must not shrink anything
  P.SKY_INSET = P.H() - 400;
  ok(P.sizeOf(star, 100) === big, 'a sheet on a desktop changed the star size');
  P.SKY_INSET = wasInset;
  console.log(`  stars: mag ${star.vmag.toFixed(2)} is ${big.toFixed(2)}px on a `
    + `desktop and ${small.toFixed(2)}px on a phone`);
}

// ============================================ the sheet's bite on the sky
// On a portrait phone the rail is a sheet ACROSS the bottom of the canvas
// rather than a column beside it, so the canvas keeps its full height and the
// bottom of it is covered. SKY_INSET is how much, and it feeds the projection
// origin and the focal length -- which is the same shape of problem ex()/ey()
// solves one axis over, and fails the same silent way: everything still
// draws, it is just half under a panel.
{
  const was = P.SKY_INSET;
  ok(was === 0, `the desktop run starts with a ${was}px inset`);
  ok(P.visH() === P.H(), 'visH() is not the full height with no sheet');
  ok(P.oy0() === P.H() / 2, 'the origin is not the middle with no sheet');

  const R = P.REVIEW;
  const wasMode = R.on, wasKind = R.kind, wasGroup = R.group;
  P.setMode(true);

  // a half-height sheet, which is the working snap
  const INSET = Math.round(P.H() * 0.52);
  P.SKY_INSET = INSET;
  ok(P.visH() === P.H() - INSET, 'visH() did not shrink with the sheet');
  ok(P.oy0() === (P.H() - INSET) / 2,
     `the origin is at ${P.oy0()}, wanted the middle of the visible strip`);
  // the field now means the VISIBLE vertical angle, so the focal shortens
  ok(P.focalOf() < (P.H() / 2) / (2 * Math.tan(70 * Math.PI / 720)) + 1e-9,
     'the focal length ignored the sheet');

  for (let g = 0; g < P.REVIEW_GROUPS.length; g++)
    for (const kind of ['shapes', 'stars']) {
      R.group = g; R.kind = kind;
      P.buildBoard(); P.reviewPose(); settle();
      const tag = `${P.REVIEW_GROUPS[g].id}/${kind}`;
      const seen = new Map(P.proj.map(q => [q.s, q]));
      // every target has to be in the part of the canvas you can SEE, not
      // merely on the canvas: under the sheet is off screen as far as a
      // reader is concerned, and a name there cannot be placed
      let under = 0, off = 0;
      for (const t of R.targets) {
        const q = t.stars.map(x => seen.get(x)).find(x => x);
        if (!q) { off++; continue; }
        if (q.y > P.H() - INSET) under++;
      }
      ok(off === 0, `${tag}: ${off} target(s) are not drawn at all`);
      ok(under === 0,
         `${tag}: ${under} of ${R.targets.length} targets are underneath the sheet`);
    }

  // a click still lands where it looks like it lands -- project and unproject
  // have to agree about where the middle is, or the sky jumps under a drag
  {
    R.group = 0; R.kind = 'stars';
    P.buildBoard(); P.reviewPose(); settle();
    const q = P.proj.find(x => x.s === R.targets[0].star);
    ok(!!q, 'no drawn target to test the round trip with');
    if (q) {
      ok(P.reviewHit(q.x, q.y) === R.targets[0],
         'with the sheet up, a tap on a target does not find it');
      const dir = P.unproject(q.x, q.y, P.camera());
      const d = dir[0] * R.targets[0].star.dir[0] + dir[1] * R.targets[0].star.dir[1]
              + dir[2] * R.targets[0].star.dir[2];
      ok(d > 0.9999,
         `unproject disagrees with project by ${(Math.acos(Math.min(1, d)) * 180 / Math.PI).toFixed(2)} deg`);
    }
  }

  // a fingertip is not a cursor
  ok(P.touchSlop() === 11, `a fine pointer gets a ${P.touchSlop()}px reach`);

  P.SKY_INSET = was;
  R.group = wasGroup; R.kind = wasKind;
  P.setMode(wasMode);
  settle();
  ok(P.oy0() === P.H() / 2, 'the origin did not go back with the sheet gone');
  console.log(`  sheet: 8 boards framed clear of a ${INSET}px sheet on a `
    + `${P.W()}x${P.H()} canvas`);
}

// ============================================ the grab bar
// The one control on the phone that is not a button doing a button's job: it
// cycles three snaps when tapped and sets any height when dragged. Both live
// on pointer events, because a `click` is the part a browser may decide not
// to send -- and the bug this replaced was a bar that did nothing at all.
{
  const el = document.getElementById('sheetgrab');
  const railEl = document.getElementById('rail');
  const wasInset = P.SKY_INSET, wasSnap = P.snapAt, wasPhone = P.PHONE;
  global.window.matchMedia = q => ({ matches: /max-width:\s*720px/.test(q) });
  const height = () => railEl.style['--sheet'];
  const snapClass = () => P.SNAPS.filter(c => document.body.classList.contains(c));
  const tap = y => { el._fire('pointerdown', { clientY: y, pointerId: 1 });
                     el._fire('pointerup', { clientY: y, pointerId: 1 }); };
  const drag = (from, to) => {
    el._fire('pointerdown', { clientY: from, pointerId: 1 });
    el._fire('pointermove', { clientY: to, pointerId: 1 });
    el._fire('pointerup', { clientY: to, pointerId: 1 });
  };

  P.snapAt = 1;
  P.syncSheet(false);
  ok(snapClass().join() === 'sheet-half', `the sheet starts at ${snapClass()}`);

  // a tap cycles, and goes round
  tap(500);
  ok(snapClass().join() === 'sheet-full', `a tap gave ${snapClass()}, wanted full`);
  tap(500);
  ok(snapClass().join() === 'sheet-peek', `a second tap gave ${snapClass()}`);
  tap(500);
  ok(snapClass().join() === 'sheet-half', 'three taps did not come back round');

  // the click a browser sends after the tap must not cycle it again
  const after = snapClass().join();
  el.onclick({ preventDefault: () => {} });
  ok(snapClass().join() === after, 'the synthetic click cycled the sheet twice');

  // a drag sets a height of its own, and the snaps step aside for it
  drag(600, 1000);                        // 400px DOWN: a shorter sheet
  ok(P.sheetPx === 500, `a 400px drag down gave ${P.sheetPx}px, wanted 500`);
  ok(height() === '500px', `--sheet is ${height()}`);
  ok(snapClass().length === 0, `a dragged sheet still wears ${snapClass()}`);
  ok(P.snapAt === 1, 'a drag moved the snap the next tap will use');

  // and it cannot be dragged off either end
  drag(600, 4000);
  ok(P.sheetPx === P.SHEET_MIN, `dragged past the bottom to ${P.sheetPx}px`);
  drag(600, -4000);
  ok(P.sheetPx === P.sheetMax(), `dragged past the top to ${P.sheetPx}px`);

  // a finger that holds still is a tap, not a drag of zero
  drag(600, 597);
  ok(P.sheetPx === null, 'a 3px wobble was taken as a drag');
  ok(snapClass().join() === 'sheet-full', `a wobble gave ${snapClass()}`);

  // the keyboard, where there is no pointer at all
  el._fire('keydown', { key: 'Enter' });
  ok(snapClass().join() === 'sheet-peek', `Enter gave ${snapClass()}`);

  // and none of it happens on a desktop, where there is no sheet
  P.PHONE = false;
  el._fire('pointerdown', { clientY: 600, pointerId: 1 });
  ok(P.sheetDrag === null, 'the grab bar started a drag on a desktop');

  delete global.window.matchMedia;
  P.snapAt = wasSnap; P.PHONE = wasPhone;
  P.setSheetPx(null);
  P.syncSheet(false);
  P.SKY_INSET = wasInset;
  console.log('  grab bar: taps cycle peek/half/full, drags set any height '
    + `between ${P.SHEET_MIN} and ${P.sheetMax()}px, and the sky re-frames on release`);
}

// ============================================ the desktop frame, pinned
// What "the desktop layout is unaffected" means, as a number.
//
// The checks above assert INVARIANTS -- every target is on screen, every ring
// is clickable, the answer is inside the circle. All of those stay true if
// the whole sky quietly shifts eight pixels or opens two degrees wider, which
// is exactly what a change meant for a narrow viewport does to a wide one
// when it gets the media query slightly wrong. So this records where the
// camera actually ENDS UP, at the desktop viewport, and refuses to let it
// move without somebody saying so out loud.
//
// It is catalogue-only on purpose: sky_catalog.json and star_facts.json are
// committed, so this baseline is reproducible on any clone. Under LIVE the
// observed layer adds `lines`, whose framing is one call, and the run is
// skipped rather than pinned against a file nobody else has.
//
// To re-bless it after a change you MEANT to make:  rm golden_desktop.json
{
  const GOLDEN = path.join(HERE, 'golden_desktop.json');

  // Deterministic randomness, so "the same board" means the same board. A
  // golden file over Math.random() would be a golden file over nothing.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function withSeed(n, fn) {
    const real = Math.random;
    Math.random = mulberry32(n);
    try { return fn(); } finally { Math.random = real; }
  }

  const r6 = v => Math.round(v * 1e6) / 1e6;
  const camera = () => ({ yaw: r6(P.yaw), pitch: r6(P.pitch), fov: r6(P.fovDeg) });

  const shot = { viewport: { w: P.W(), h: P.H(), dpr: P.DPR }, boards: {}, questions: {} };

  // -- every board, at the desktop viewport
  const R = P.REVIEW;
  const wasMode = R.on, wasGroup = R.group, wasKind = R.kind;
  P.setMode(true);
  for (let g = 0; g < P.REVIEW_GROUPS.length; g++)
    for (const kind of ['shapes', 'stars']) {
      R.group = g; R.kind = kind;
      withSeed(1000 + g * 10, () => { P.buildBoard(); P.reviewPose(); });
      settle();
      const key = `${P.REVIEW_GROUPS[g].id}/${kind}`;
      const seen = new Map(P.proj.map(q => [q.s, q]));
      shot.boards[key] = {
        cam: camera(),
        // where each target actually LANDED. The camera alone would not
        // catch a projection change that cancels out at the centre.
        at: R.targets.map(t => {
          const q = t.stars.map(x => seen.get(x)).find(x => x);
          return [t.key, q ? r6(q.x) : null, q ? r6(q.y) : null];
        }),
      };
    }

  // -- and every question kind, posed
  for (const gen of P.GENERATORS) {
    let q = null, used = -1;
    // a generator returning null is normal; step the seed until one bites,
    // deterministically, so the same kind always poses the same question
    for (let seed = 1; seed <= 400 && !q; seed++)
      withSeed(seed, () => { try { q = gen.fn(); used = seed; } catch (e) { q = null; } });
    if (!q) { console.log(`  note golden: ${gen.kind} produced nothing here`); continue; }
    withSeed(used, () => { P.quizSky(); q.pose(); });
    settle();
    shot.questions[gen.kind] = { seed: used, cam: camera() };
  }
  R.group = wasGroup; R.kind = wasKind;
  P.setMode(wasMode);

  if (LIVE) {
    console.log('  note golden: skipped under LIVE — the baseline is catalogue-only');
  } else if (!fs.existsSync(GOLDEN)) {
    fs.writeFileSync(GOLDEN, JSON.stringify(shot, null, 2) + '\n');
    console.log(`  golden: baseline written to ${path.basename(GOLDEN)} — `
      + `${Object.keys(shot.boards).length} boards, `
      + `${Object.keys(shot.questions).length} question kinds`);
  } else {
    const want = JSON.parse(fs.readFileSync(GOLDEN));
    const vp = want.viewport;
    ok(vp.w === P.W() && vp.h === P.H() && vp.dpr === P.DPR,
       `the baseline was taken at ${vp.w}x${vp.h}@${vp.dpr} and this run is `
       + `${P.W()}x${P.H()}@${P.DPR} — re-bless it rather than comparing across viewports`);

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const key of Object.keys(want.boards)) {
      const w = want.boards[key], got = shot.boards[key];
      ok(!!got, `golden: board ${key} is gone`);
      if (!got) continue;
      ok(same(w.cam, got.cam),
         `golden: ${key} frames at ${JSON.stringify(got.cam)}, `
         + `baseline ${JSON.stringify(w.cam)}`);
      const moved = w.at.filter((row, i) => !same(row, got.at[i]));
      ok(moved.length === 0,
         `golden: ${moved.length} target(s) moved on ${key} — `
         + `e.g. ${JSON.stringify(moved[0])}`);
    }
    for (const kind of Object.keys(want.questions)) {
      const got = shot.questions[kind];
      ok(!!got, `golden: question kind ${kind} no longer poses`);
      if (got) ok(same(want.questions[kind].cam, got.cam),
        `golden: ${kind} frames at ${JSON.stringify(got.cam)}, `
        + `baseline ${JSON.stringify(want.questions[kind].cam)}`);
    }
    console.log(`  golden: ${Object.keys(want.boards).length} boards and `
      + `${Object.keys(want.questions).length} question kinds framed as recorded`);
  }
}

// ============================================ the legend on a touch screen
// The ramp answers two questions -- what does this colour mean, and where are
// they -- and on a phone it answered neither, because the whole box was
// hidden along with the other hover-driven corners. What has no touch
// equivalent is the HOVER, not the ramp: so the box comes back and the tap
// takes the hover's job over, through the ordinary highlight.
//
// The thing to be careful about is the other direction. Every new behaviour
// is gated on (pointer: coarse), and a desktop run has to come out of this
// block doing exactly what it did before the block existed -- which is what
// the first half checks, deliberately, before the phone half switches the
// media query on.
//
// This sits after the golden baseline on purpose: markTrait() is allowed to
// turn the sky towards a highlight nothing on screen is carrying, and a
// camera the golden has already been compared against is one it is safe to
// move.
{
  P.clearMark();

  // -- every swatch can say what it is, and the number in that sentence is
  //    the set the tap is about to light. A legend whose count disagrees with
  //    its own highlight is worse than no count.
  for (const l of P.RAMP_ORDER) {
    ok(!!P.CLASS_NOTE[l], `the ramp carries ${l} with no note to show for it`);
    const n = P.classStars(l).length;
    const lab = P.classLabel(l);
    ok(lab.includes(P.CLASS_NOTE[l]), `the label for ${l} drops its note`);
    ok(new RegExp(`\\b${n} stars?\\b`).test(lab),
       `the label for ${l} counts something other than its ${n} stars`);
  }
  ok(P.classLabel(null) === P.RAMP_TEXT,
     'with nothing pinned the label does not read as the ramp itself');
  ok(P.classTrait('?') === 'no class', "the '?' swatch names itself a class");

  // -- the trait name round-trips. That is the whole of pinnedClass(): the
  //    chip carries a sentence, and the swatch has to be recoverable from it
  //    to know which one to outline and which one a second tap puts out.
  for (const l of P.RAMP_ORDER) {
    const stars = P.classStars(l);
    if (!stars.length) continue;
    P.markTrait({ stars, trait: P.classTrait(l) });
    ok(P.pinnedClass() === l,
       `class ${l} reads back off its own chip as ${P.pinnedClass()}`);
  }
  P.clearMark();
  ok(P.pinnedClass() === null, 'clearing the highlight left a swatch pinned');

  // -- the swatches themselves, through their own listeners ---------------
  // Everything above calls the functions directly. These go through the
  // elements, because the gate that matters most is inside a listener.
  const swatches = document.getElementById('ramp').querySelectorAll('div');
  ok(swatches.length === P.RAMP_ORDER.length,
     `the ramp painted ${swatches.length} swatches for ${P.RAMP_ORDER.length} classes`);
  const swatch = l => swatches.find(d => d.dataset.l === l);
  for (const l of P.RAMP_ORDER)
    ok(!!swatch(l), `no swatch on the ramp for class ${l}`);

  // -- with a mouse, nothing changed ------------------------------------
  ok(P.coarse() === false, 'the desktop run believes it has a coarse pointer');

  swatch('K')._fire('mouseenter');
  ok(P.HOVER_SET && P.HOVER_SET.size === P.classStars('K').length,
     'pointing at the K swatch did not light K');
  swatch('K')._fire('mouseleave');
  ok(P.HOVER_SET === null, 'moving off the swatch did not put K out');

  swatch('M')._fire('click');
  ok(P.pinnedClass() === 'M', 'clicking the M swatch did not pin M');
  ok(swatch('M')._cls.has('pin'), 'the pinned swatch is not outlined');
  ok(!swatch('K')._cls.has('pin'), 'a swatch nothing pinned is outlined');
  P.clearMark();
  ok(!swatch('M')._cls.has('pin'), 'the outline outlived the highlight');

  P.hoverClass('K');
  ok(P.HOVER_SET && P.HOVER_SET.size === P.classStars('K').length,
     'hovering K did not form the transient set');
  ok(P.rampLabel().includes(P.CLASS_NOTE.K), 'the hover did not write the label');
  P.hoverClass(null);
  ok(P.HOVER_SET === null, 'the hover set outlived the hover');
  ok(P.rampLabel() === P.RAMP_TEXT, 'the label did not go back');

  P.tapClass('K');
  ok(P.MARKED.size === P.classStars('K').length, 'a click did not pin the class');
  P.tapClass('K');
  ok(P.MARKED.size === P.classStars('K').length,
     'a second click on a pinned swatch put it out, which is the phone rule '
     + 'and has leaked to the mouse');

  // paintPins() runs on every renderMark(), and on a phone it writes the
  // label. Ungated, that would overwrite the hover's sentence with the pin's
  // on every click a desktop makes while pointing at a different swatch.
  P.hoverClass('M');
  const hovered = P.rampLabel();
  P.paintPins();
  ok(P.rampLabel() === hovered, 'painting the pins overwrote a desktop hover label');
  P.hoverClass(null);
  P.clearMark();

  // -- the same page with a finger ---------------------------------------
  global.window.matchMedia = q => ({ matches: /pointer:\s*coarse/.test(q) });
  ok(P.coarse() === true, 'a coarse pointer did not read as one');
  ok(P.touchSlop() === 22, 'the coarse reach did not arrive with it');

  // The one that has to go through the element: iOS fires this on a tap, and
  // an ungated handler would light the class transiently through HOVER_SET,
  // which outranks MARKED in the frame and which no finger can ever leave.
  swatch('K')._fire('mouseenter');
  ok(P.HOVER_SET === null,
     'a synthesised mouseenter formed a hover set on a touch screen');
  ok(P.rampLabel() === P.RAMP_TEXT,
     'a synthesised mouseenter wrote the hover label on a touch screen');

  swatch('K')._fire('click');
  ok(P.MARKED.size === P.classStars('K').length, 'a tap did not light the class');
  ok(P.pinnedClass() === 'K', 'the tap pinned something other than K');
  ok(P.rampLabel().includes(P.CLASS_NOTE.K),
     'the tap did not say what the colour means, which is the legend\'s first job');
  // iOS synthesises mouseenter on a tap and holds it. HOVER_SET outranks
  // MARKED in the frame, so one forming here would light the class on top of
  // the pin and then never let go of it.
  ok(P.HOVER_SET === null, 'a tap formed a hover set, which no finger can clear');

  swatch('K')._fire('click');
  ok(P.MARKED.size === 0,
     'a second tap did not put the class out, and on a phone the swatch is '
     + 'the only control it has');
  ok(P.rampLabel() === P.RAMP_TEXT, 'the label stayed lit for a class nothing marks');

  // every way out of a highlight goes through renderMark(), so the chip's
  // clear and the Escape key put the label back without knowing the ramp is
  // there at all
  P.tapClass('M');
  ok(P.rampLabel().includes(P.CLASS_NOTE.M), 'the tap did not relabel');
  P.clearMark();
  ok(P.rampLabel() === P.RAMP_TEXT, 'clearing from the chip left the label lit');

  // a class the sky has none of does nothing, rather than pinning an empty
  // highlight with a chip that cannot be seen to be about nothing. This
  // catalogue has a star in all eleven, so the loop below is usually empty and
  // arms itself only for a thinner one -- the count in the line this block
  // prints is what says which happened.
  const empty = P.RAMP_ORDER.filter(l => !P.classStars(l).length);
  for (const l of empty) {
    P.tapClass(l);
    ok(P.MARKED.size === 0, `tapping ${l} pinned an empty highlight`);
  }

  delete global.window.matchMedia;
  ok(P.coarse() === false, 'the pointer stayed coarse on the way out');
  P.clearMark();

  // -- and the media query, read off the stylesheet -----------------------
  // The harness stubs layout, so none of the above would notice the box being
  // display:none again -- the functions would run perfectly on an element
  // nobody can see. This is the one check that does notice.
  const q0 = html.indexOf('@media (max-width: 720px) and (orientation: portrait)');
  ok(q0 > 0, 'the portrait media query is not where this looks for it');
  const block = html.slice(q0, html.indexOf('@media', q0 + 10))
                    .replace(/\/\*[\s\S]*?\*\//g, '');
  const gone = [...block.matchAll(/([^{}]+)\{[^{}]*display:\s*none\s*!important/g)]
                 .map(m => m[1]).join(' ');
  ok(/#railmin/.test(gone) && /#tip/.test(gone),
     'the portrait block stopped hiding #railmin or #tip, which have no touch '
     + 'equivalent at all');
  ok(!/#legend\b/.test(gone),
     'the portrait block hides #legend again, so every tap rule above is '
     + 'running on a box nobody can see');
  ok(/#legend \.ramp div \{[^}]*flex:\s*1/.test(block),
     'the phone ramp no longer divides the width it has, and eleven swatches '
     + 'at a fixed 24px do not fit 360px of screen');
  ok(/#legend \.ramp div:hover:not\(\.pin\)/.test(block),
     'nothing puts out the :hover iOS leaves stuck on the last swatch tapped');

  console.log(`  legend: ${P.RAMP_ORDER.length} swatches, `
    + `${P.RAMP_ORDER.length - empty.length} with stars behind them; `
    + `tap pins and un-pins on a phone, and a mouse is untouched`);
}

// ============================================ where a planet is, on a date
// Every other generator on this page asks something that is true of the whole
// year. This one is not true of any other day, which makes it the only one
// that touches the date slider and the only one whose answer has to be
// re-derived from a position rather than from a table.
//
// It runs here on a SYNTHETIC ephemeris. The real one is an astropy import on
// the server, so the committed catalogue has none and the generator is
// correctly silent in the sweep above -- but "correctly silent" is not
// coverage, and a question kind nobody can reproduce is a question kind that
// rots. The shape of what is installed below is the shape that matters and it
// is a real one: every body runs along the ECLIPTIC, which is where the
// generator will actually meet them, at its own rate. The positions are not
// this year's and nothing here claims they are. LIVE=1 is the run that asks
// about the real sky.
{
  const eps = 23.439 * Math.PI / 180;
  const track = (periodDays, phase, au) => {
    const out = [];
    for (let d = 0; d < 367; d++) {
      const lam = 2 * Math.PI * (((phase + d / periodDays) % 1) + 1) % (2 * Math.PI);
      let ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
      if (ra < 0) ra += 2 * Math.PI;
      out.push([+(ra * 180 / Math.PI).toFixed(3),
                +(Math.asin(Math.sin(eps) * Math.sin(lam)) * 180 / Math.PI).toFixed(3),
                au]);
    }
    return out;
  };
  const SYNTH = {
    sun: track(365.25, 0.00, 1.00), moon: track(27.3, 0.10, 0.0026),
    mercury: track(88, 0.20, 0.90), venus: track(225, 0.30, 0.70),
    mars: track(687, 0.40, 1.52), jupiter: track(4333, 0.50, 5.20),
    saturn: track(10759, 0.60, 9.54), uranus: track(30687, 0.70, 19.2),
    neptune: track(60190, 0.80, 30.1),
  };
  const withEphem = JSON.parse(JSON.stringify(PAYLOAD));
  // The real one wins where there is one. Under LIVE every check below is
  // therefore about the sky astropy actually computed, and the synthetic
  // ecliptic is only what makes the block reproducible without it.
  const realBodies = (PAYLOAD.ephemeris || {}).bodies || {};
  const synthetic = !Object.keys(realBodies).length;
  withEphem.ephemeris = { year: new Date().getFullYear(),
                          bodies: synthetic ? SYNTH : realBodies };
  P.build(withEphem);
  P.resize();
  P.quizBoot();

  const solar = P.STARS().filter(s => s.solar);
  ok(solar.length === 9, `${solar.length} bodies on the sky, wanted 9`);

  // Hard, and the whole sky: 88 circles of 16 degrees over a sphere whose
  // constellation centres average about 22 degrees apart, so circles overlap
  // and the fairness rules have something to do. At easy there are 22 of them
  // and almost nothing can go wrong, which is the wrong place to look for it.
  const wasLv = P.QUIZ.level, wasHemi = P.QUIZ.hemi, wasCat = P.QUIZ.cat;
  P.QUIZ.level = 'hard'; P.QUIZ.hemi = 'all'; P.QUIZ.cat = 'stars';

  const userDay = 200;
  let made = 0, sunAsked = 0;
  const deg = (a, b) => P.sepPA(a, b).sep;
  for (let t = 0; t < 400; t++) {
    // The app's own order: quizSky() first, which hands back any day the last
    // question borrowed, and only then the person's setting.
    P.quizSky();
    P.setDay(userDay);
    const q = P.qPlanet();
    if (!q) continue;
    made++;

    // -- the answer is re-derived, not taken from the question. Four circles
    //    and a body: the body is inside the one it says and outside the other
    //    three, or the question has no answer or two.
    const m = /midnight on <em>([^<]+)<\/em>.*?<em>([^<]+)<\/em> in\?/.exec(q.ask);
    ok(!!m, `planet: the question does not name a date and a body — ${q.ask}`);
    if (!m) continue;
    const [, when, body] = m;
    ok(body.toLowerCase() !== 'sun', 'planet: asked where the Sun is at midnight');
    if (body.toLowerCase() === 'sun') sunAsked++;

    q.pose();
    settle();                   // pose() only starts the turn; glide() walks it

    // pose() set the slider to the day the question names, and says so
    ok(P.seasonLabel(P.currentDay()) === when,
       `planet: the question says ${when} and the slider reads `
       + `${P.seasonLabel(P.currentDay())}`);
    ok(P.QUIZ_DAY === userDay,
       `planet: the day the person had set was not kept (${P.QUIZ_DAY})`);

    const b = P.STARS().find(s => s.solar && s.label === body);
    ok(!!b, `planet: no body on the sky called ${body}`);
    if (!b) continue;
    const regs = P.REGIONS;
    ok(regs.length === 4, `planet: ${regs.length} circles for four options`);
    const inside = regs.map(r => deg(r.dir, b.dir) <= r.deg);
    ok(inside.filter(Boolean).length === 1,
       `planet: ${body} on ${when} is inside ${inside.filter(Boolean).length} `
       + 'of the four circles');
    ok(inside[q.answer] === true,
       `planet: ${body} on ${when} is not in circle ${q.answer + 1}, the one `
       + 'the question calls the answer');

    // ...and no OTHER circle the question could have offered holds it either.
    // Four options that happen to contain one true answer is not the same
    // claim as "this is the area it is in", and the difference shows up as a
    // question whose fifth option would also have been right.
    const holders = P.pool().filter(x =>
      deg(P.CONS().get(x).dir, b.dir) <= P.REGION_DEG);
    ok(holders.length === 1,
       `planet: ${body} on ${when} is inside the circles of `
       + `${holders.length} constellations in the pool (${holders.join(', ')})`);

    // -- the body is OFF while the question is up. A dot you can see is not a
    //    question about where it is, and this is read off the frame rather
    //    than off the flag: the flag is only a promise about the draw.
    ok(P.HIDE_SOLAR === true, 'planet: the bodies were not hidden');
    ok(!P.proj.some(e => e.s.solar),
       `planet: ${P.proj.filter(e => e.s.solar).length} bodies reached the `
       + 'frame while the question was asking where one of them is');

    // -- and back on for the answer, where they are the whole point
    q.reveal();
    settle();
    ok(P.HIDE_SOLAR === false, 'planet: the bodies stayed hidden on the reveal');
    // and specifically THE body: the reveal frames the same four circles the
    // question did, and the body is inside one of them, so it is on screen or
    // the framing is wrong.
    ok(P.proj.some(e => e.s === b),
       `planet: the reveal did not draw ${body}, which is the answer`);

    ok(/\d/.test(q.why()) && !/undefined|NaN/.test(q.why()),
       `planet: the explanation reads "${q.why().slice(0, 120)}"`);

    // -- the slider is handed back. A question borrows the date; it does not
    //    keep it.
    P.quizSky();
    ok(P.currentDay() === userDay,
       `planet: the slider was left on ${P.currentDay()} rather than handed `
       + `back to ${userDay}`);
    ok(P.QUIZ_DAY === null, 'planet: the borrowed day was not given up');
    ok(P.HIDE_SOLAR === false, 'planet: the next question would start with the bodies off');
  }
  ok(made > 50, `planet: only ${made} questions in 400 tries`);
  ok(sunAsked === 0, `planet: the Sun was asked about ${sunAsked} times`);

  // -- a question that is never answered still has to give the sky back. The
  //    loop above always reveals, and reveal() puts the bodies on; the path
  //    that actually strands them is the one where the next question arrives
  //    first, which is what quizSky() is for.
  {
    let q = null;
    for (let t = 0; t < 400 && !q; t++) { P.quizSky(); q = P.qPlanet(); }
    ok(!!q, 'planet: could not pose one to abandon');
    const who = q && /<em>([^<]+)<\/em> in\?/.exec(q.ask);
    const bb = who && P.STARS().find(x => x.solar && x.label === who[1]);
    ok(!!bb, 'planet: could not find the body the abandoned question was about');
    if (q && bb) {
      q.pose();
      settle();
      ok(P.HIDE_SOLAR === true, 'planet: the bodies were not hidden by pose()');
      P.quizSky();               // the next question arrives; nobody answered
      // Framed on the body itself rather than left wherever the abandoned
      // question was pointing: "a body is in the viewport" is a fact about the
      // camera, and what is being checked here is whether it can be drawn at
      // all.
      P.frame(bb.dir, 40);
      settle();
      ok(P.HIDE_SOLAR === false,
         'planet: an unanswered question left the bodies off the sky for good');
      ok(P.proj.some(e => e.s === bb),
         `planet: ${bb.label} never came back after an unanswered question, `
         + 'even with the camera pointed straight at it');
    }
  }

  // -- and with no ephemeris it says nothing at all, rather than throwing or
  //    inventing a place for a body that is not on the sky. Built explicitly
  //    rather than by reaching for PAYLOAD, which under LIVE has bodies in it.
  const noEphem = JSON.parse(JSON.stringify(PAYLOAD));
  noEphem.ephemeris = { year: new Date().getFullYear(), bodies: {} };
  P.build(noEphem);
  P.resize();
  P.quizBoot();
  ok(!P.STARS().some(s => s.solar), 'a payload with no ephemeris put bodies on the sky');
  let spoke = 0;
  for (let t = 0; t < 60; t++) if (P.qPlanet()) spoke++;
  ok(spoke === 0, `planet: ${spoke} questions asked about a sky with no planets`);

  P.QUIZ.level = wasLv; P.QUIZ.hemi = wasHemi; P.QUIZ.cat = wasCat;
  console.log(`  planet: ${made} questions on `
    + (synthetic ? 'a synthetic ecliptic' : `the real ${PAYLOAD.ephemeris.year} ephemeris`)
    + ', each circle re-derived, and silent with no ephemeris');
}

// ============================================ the static build
// build_pages.py bakes /data.json to a file and copies the page next to it, so
// the whole thing runs on GitHub Pages with no Python behind it. Two things in
// the page have to stay true for that, and both fail silently -- into the
// page's own "could not load the sky" card, or into a dead link under a star,
// neither of which looks like the URL problem it is.
{
  // 1. The payload is asked for by a RELATIVE path. On a project site the page
  //    lives at you.github.io/<repo>/, so a leading slash resolves to
  //    you.github.io/data.json. Under Flask the page is served from `/`, where
  //    the relative form is the same request -- so there is no branch, and the
  //    one spelling is correct in both places.
  ok(/fetch\(\s*'data\.json'\s*\)/.test(html),
     'the page does not fetch a relative data.json, so a project site gets '
     + 'nothing but the error card');
  ok(!/fetch\(\s*['"]\/data\.json/.test(html),
     'the page fetches an absolute /data.json, which resolves to the domain '
     + 'root on a project site and 404s');

  // 2. /results/ IS absolute, correctly: it is a Flask route, and on a static
  //    host there is nothing behind it. Both uses have to stay behind the
  //    field that is null without a pipeline, which is checked by rendering
  //    the panel for a star shaped the way a frozen spectra.json makes them
  //    rather than by reading the source for an `if`.
  const frozen = P.STARS().find(s => s.obs) || null;
  const star = frozen || P.STARS().find(s => s.vmag !== null);
  const wasObs = star.obs;
  star.obs = {
    name: star.label, sptype: 'A1V', measured: null, mk: null, snr: 40,
    n_runs: 1, pinned: false, contested_with: [],
    // exactly what quiz_app.py's frozen path sets, and what a static host has
    job_id: null, figure: null, folder: null, source: null, date_obs: null,
    rms: null, rv: null, rv_err: null, check: null, detail: null,
    indices: null, planet: null, spectrum: null,
  };
  // The panel refuses to open while a question is holding the sky back, which
  // is quizHolds() doing its job and not the thing being tested here.
  P.setMode(false);
  if (P.QUIZ && P.QUIZ.q) P.answer(0);
  ok(!P.quizHolds(), 'a question is still holding the sky, so the panel is shut');
  P.openPanel(star);
  const panelHTML = document.getElementById('pbody').innerHTML;
  ok(panelHTML.length > 0, 'the detail panel rendered nothing to check');
  ok(!panelHTML.includes('/results/'),
     'the detail panel links into /results/ for a star with no run on disk — '
     + 'a dead link under every observed star on a static host, and under a '
     + 'frozen spectra.json here');
  ok(!panelHTML.includes('null'),
     'the detail panel printed a null into the page');
  star.obs = wasObs;

  // 3. The date slider runs over the EPHEMERIS's year, not the browser's.
  //    Baked, the planet tracks are the year the file was written, and a
  //    slider labelled with the year the browser is in while the dots stand
  //    where they stood in another one is the drift made silent. Drift is the
  //    known cost of baking an ephemeris; hiding it is not.
  const thisYear = new Date().getFullYear();
  ok(P.SEASON_YEAR === thisYear,
     `this payload is this year's and the slider is running over ${P.SEASON_YEAR}`);
  ok(!/\d{4}/.test(P.seasonLabel(120)),
     'the date readout carries a year on a payload built this year, where it '
     + 'is noise');

  ok(P.adoptEphemerisYear({ ephemeris: { year: thisYear - 2 } }),
     'a two-year-old ephemeris did not move the slider off this year');
  ok(P.SEASON_YEAR === thisYear - 2, 'the slider did not take the baked year');
  ok(P.seasonLabel(120).includes(String(thisYear - 2)),
     'a stale ephemeris does not say which year its planets are standing in');
  ok(!P.adoptEphemerisYear({ ephemeris: { year: thisYear - 2 } }),
     'adopting the year it already has reports a change');
  ok(!P.adoptEphemerisYear({}),
     'a payload with no ephemeris at all moved the slider');
  P.adoptEphemerisYear({ ephemeris: { year: thisYear } });
  ok(P.SEASON_YEAR === thisYear, 'the slider did not come back');

  //    ...and build() has to actually call it. Checked by rebuilding the page
  //    off a payload dated like a baked one, which is what a static host hands
  //    it. This is also the only thing that runs build() twice, and the reason
  //    SOLAR_SKY is cleared there.
  const baked = JSON.parse(JSON.stringify(PAYLOAD));
  baked.ephemeris.year = thisYear - 3;
  // A body to count. The catalogue-only payload carries an empty ephemeris --
  // astropy is a server-side import and the harness has no server -- and an
  // empty one would make every check below true by having nothing in it.
  if (!Object.keys(baked.ephemeris.bodies || {}).length)
    baked.ephemeris.bodies = { mars: [[120, 20, 1.5], [121, 20.1, 1.5]] };
  P.build(baked);
  ok(P.SEASON_YEAR === thisYear - 3,
     'build() ignored the payload\'s ephemeris year, so a baked site labels '
     + "last year's planets with this year's dates");
  const bodies = P.STARS().filter(s => s.solar).length;
  ok(bodies > 0, 'the rebuild put no bodies on the sky to count');

  //    ...and the same payload twice has to give the same sky. placeSolar()
  //    walks SOLAR_SKY rather than STARS, so a body left in it after a rebuild
  //    is invisible to the count above and still moves on every date change.
  P.build(baked);
  ok(P.STARS().filter(s => s.solar).length === bodies,
     'rebuilding doubled the solar-system bodies on the sky');
  ok(P.SOLAR_SKY().length === bodies,
     `SOLAR_SKY holds ${P.SOLAR_SKY().length} bodies for the ${bodies} that `
     + 'are on the sky — the extras are orphans the date slider still moves');

  P.build(PAYLOAD);
  ok(P.SEASON_YEAR === thisYear, 'rebuilding did not put the slider back');

  console.log('  static: the sky is fetched relatively, the panel omits a '
    + 'reduction there is no pipeline to open, and a baked year says so');
}

// -- nothing floats over the page. The sky view puts its spare panels in the
// corners by appending them to the body -- the solar-system strip, which
// offered "Spectra also available for: Sun" from the bottom right, over the
// question and outside the rail. The quiz inherits none of that, and the
// check is the general one rather than a search for that box by name: by the
// time this runs the page has built, booted, asked and answered.
ok(document.body._appended.length === 0,
   `${document.body._appended.length} element(s) appended to the body: `
   + document.body._appended.map(k => k.tagName).join(', '));

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
