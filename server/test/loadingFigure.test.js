import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readSource, stripComments } from './helpers/source.js';
import { en } from '../../web/src/i18n/locales/en.js';
import { es } from '../../web/src/i18n/locales/es.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (p) => readSource(new URL(p, import.meta.url));

const loading = code('../../web/src/components/Loading.jsx');
const app = code('../../web/src/App.jsx');
const css = read('../../web/src/styles.css');
const cssCode = stripComments(css);

/**
 * A lifter pulling a heavy deadlift.
 *
 * ── WHY A WHOLE TEST FILE FOR A LOADING SPINNER ───────────────────────────
 *
 * Because every way this can be wrong is silent. The figure is a kinematic
 * chain: four nested groups, each rotating about a joint whose position is
 * written down TWICE - once in the JSX as the end of a line, and once in the
 * stylesheet as a transform-origin. Nothing connects the two copies.
 *
 * Move a joint in one file and the other still parses, still builds, still
 * renders. The result is not an error. It is a leg that detaches from its own
 * knee and swings around a point in mid-air, and the only thing that would
 * ever tell you is a person looking at the page.
 *
 * So these assertions read the geometry out of both files and hold them to
 * each other, and then reimplement the forward kinematics to check that the
 * bar still travels the way a barbell does.
 */

const JOINTS = ['shin', 'thigh', 'torso', 'arm'];

/**
 * Where the hands (and therefore the bar) are, at any point in the pull.
 *
 * The forward kinematics, reimplemented from the geometry in the two source
 * files: t=1 is the braced bottom, t=0 is lockout. Each segment's ABSOLUTE
 * angle is the sum of its own rotation and every rotation above it, because
 * the groups are nested - that is the whole point of the structure, and it is
 * what this has to model to be checking anything real.
 *
 * The arm counter-rotates to hang vertically, so its net transform is a pure
 * translation and the hand simply keeps its offset from the shoulder.
 */
function handAt(t) {
  const seg = segments();
  const rad = (d) => (d * Math.PI) / 180;
  const len = (s) => Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
  const bottoms = JOINTS.map((n) => styleFor(n).bottom);

  let abs = 0;
  let p = seg.shin.from;
  for (let i = 0; i < 3; i++) {
    abs += bottoms[i] * t;
    const L = len(seg[JOINTS[i]]);
    p = [p[0] + L * Math.sin(rad(abs)), p[1] - L * Math.cos(rad(abs))];
  }
  return [p[0] + (seg.arm.to[0] - seg.arm.from[0]), p[1] + (seg.arm.to[1] - seg.arm.from[1])];
}

/** The rest-pose drawing: each group's own first line, as the JSX declares it. */
function segments() {
  const out = {};
  for (const name of JOINTS) {
    const at = loading.indexOf(`className="lift-${name}"`);
    assert.ok(at > 0, `Loading.jsx has no .lift-${name} group`);
    const line = loading
      .slice(at)
      .match(/<line[^>]*?x1="([-\d.]+)"\s*y1="([-\d.]+)"\s*x2="([-\d.]+)"\s*y2="([-\d.]+)"/);
    assert.ok(line, `.lift-${name} contains no line`);
    out[name] = { from: [+line[1], +line[2]], to: [+line[3], +line[4]] };
  }
  return out;
}

/**
 * The loading block of the stylesheet, split into the rules that always apply
 * and the rules inside its own reduced-motion block.
 *
 * ── WHY THIS IS A PARSER AND NOT A REGEX ──────────────────────────────────
 *
 * Two attempts to do this with regexes both found the WRONG text, and both
 * failed by reporting a defect that did not exist - the most expensive kind,
 * because you go and look for it.
 *
 *   - `/\.lift-arm\s*\{/` matched the grouped `transform-box` selector rather
 *     than the arm's own rule, and reported that the arm had no pivot.
 *   - Slicing at the first `@media (prefers-reduced-motion: reduce)` cut the
 *     file above the loading block entirely, because this stylesheet has five
 *     earlier ones. Every assertion then failed for want of any rule at all.
 *
 * A stylesheet has structure - nested blocks, grouped selectors - and matching
 * a selector by hand throws it away. So: find the matching brace, and read
 * selectors as the list they are.
 */
function blockAt(text, from) {
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { body: text.slice(open + 1, i), end: i };
  }
  throw new Error('unbalanced braces in styles.css');
}

/** Flat rules in a chunk of CSS, ignoring anything with a nested block. */
function rules(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const selectors = text.slice(i, open);
    if (/@/.test(selectors)) {
      i = blockAt(text, open).end + 1;   // skip @media / @keyframes wholesale
      continue;
    }
    const { body, end } = blockAt(text, open);
    out.push({ selectors: selectors.split(',').map((x) => x.trim()).filter(Boolean), body });
    i = end + 1;
  }
  return out;
}

const LOADING_CSS = cssCode.slice(cssCode.indexOf('.loading {'));
const REDUCED = (() => {
  // The block that stops THIS animation, not the five earlier ones in the file.
  let at = -1;
  const needle = '@media (prefers-reduced-motion: reduce)';
  for (let i = LOADING_CSS.indexOf(needle); i !== -1; i = LOADING_CSS.indexOf(needle, i + 1)) {
    if (blockAt(LOADING_CSS, i).body.includes('.lift-')) { at = i; break; }
  }
  return at === -1 ? null : blockAt(LOADING_CSS, at).body;
})();
const ALWAYS = rules(REDUCED === null ? LOADING_CSS : LOADING_CSS.replace(REDUCED, ''));

/** What the stylesheet says each joint pivots about, and how far it rotates. */
function styleFor(name) {
  const applicable = ALWAYS.filter((r) => r.selectors.includes(`.lift-${name}`));
  assert.ok(applicable.length > 0, `no rule in styles.css targets .lift-${name}`);

  const originRule = applicable.find((r) => /transform-origin:/.test(r.body));
  assert.ok(originRule, `.lift-${name} declares no transform-origin`);
  const origin = originRule.body.match(/transform-origin:\s*([-\d.]+)px\s+([-\d.]+)px/);
  assert.ok(origin, `.lift-${name} has an unparseable transform-origin`);

  const at = cssCode.indexOf(`@keyframes lift-${name}`);
  assert.ok(at !== -1, `no @keyframes lift-${name}`);
  const keyframes = blockAt(cssCode, at).body;
  const angle = keyframes.match(/rotate\((-?[\d.]+)deg\)/);
  assert.ok(angle, `@keyframes lift-${name} rotates nothing`);

  const animation = applicable.map((r) => r.body).join(' ').match(/animation:[^;]*?([\d.]+m?s)/);
  return {
    origin: [+origin[1], +origin[2]],
    bottom: +angle[1],
    keyframes,
    duration: animation && animation[1],
    boxed: applicable.some((r) => /transform-box:\s*view-box/.test(r.body)),
  };
}

describe('the deadlift figure', () => {
  /**
   * ── THE ASSERTION THIS FILE EXISTS FOR ────────────────────────────────
   *
   * A segment pivots about the joint it HANGS FROM, which is the point its own
   * line starts at. Get that wrong and the limb detaches: it still animates,
   * it just orbits somewhere it is not attached to.
   */
  test('every joint pivots about the point its own segment starts at', () => {
    const seg = segments();
    for (const name of JOINTS) {
      const { origin } = styleFor(name);
      assert.deepEqual(
        origin,
        seg[name].from,
        `.lift-${name} rotates about (${origin}) but its segment begins at ` +
          `(${seg[name].from}) - the limb is hinged to a point it is not joined to. ` +
          `Nothing errors; it comes apart on screen.`
      );
    }
  });

  /** And the chain has to be a chain: each segment starts where the last ended. */
  test('the segments actually join up in the rest pose', () => {
    const seg = segments();
    for (let i = 0; i < JOINTS.length - 1; i++) {
      const [a, b] = [JOINTS[i], JOINTS[i + 1]];
      assert.deepEqual(
        seg[b].from,
        seg[a].to,
        `the ${b} starts at (${seg[b].from}) but the ${a} ends at (${seg[a].to}) - ` +
          `there is a gap in the skeleton`
      );
    }
  });

  /** Nesting is what keeps the feet on the floor. Siblings would not. */
  test('the groups are nested, not siblings', () => {
    for (let i = 0; i < JOINTS.length - 1; i++) {
      const outer = loading.indexOf(`className="lift-${JOINTS[i]}"`);
      const inner = loading.indexOf(`className="lift-${JOINTS[i + 1]}"`);
      const closes = loading.indexOf('</g>', outer);
      assert.ok(
        inner > outer && inner < closes,
        `.lift-${JOINTS[i + 1]} is not inside .lift-${JOINTS[i]} - rotating a joint ` +
          `would stop carrying the limbs above it, and the figure would come apart`
      );
    }
  });

  /**
   * The same trap as the pivot, one level up: without transform-box the
   * coordinates are read against each group's own bounding box instead of the
   * viewBox, so every origin above means something else entirely.
   */
  test('the pivots are measured in the viewBox and not in each limb\'s own box', () => {
    for (const name of JOINTS) {
      assert.ok(
        styleFor(name).boxed,
        `.lift-${name} has a transform-origin but nothing sets transform-box: view-box, ` +
          `so the coordinates are read against that limb's own bounding box instead of ` +
          `the viewBox and every pivot is somewhere else entirely`
      );
    }
  });

  /**
   * Four joints, one lift. If one of them runs to a different schedule the
   * limbs arrive at different times, which is a figure tearing itself apart.
   */
  test('every joint runs to the same schedule', () => {
    const shape = (kf) =>
      kf.replace(/rotate\(-?[\d.]+deg\)/g, 'rotate(X)').replace(/\s+/g, ' ').trim();
    const reference = shape(styleFor('shin').keyframes);
    for (const name of JOINTS.slice(1)) {
      assert.equal(
        shape(styleFor(name).keyframes),
        reference,
        `@keyframes lift-${name} keeps different time from lift-shin - the limbs ` +
          `would reach the bottom and the top at different moments`
      );
    }

    const durations = JOINTS.map((name) => styleFor(name).duration);
    assert.equal(new Set(durations).size, 1, `the joints animate over different durations: ${durations}`);
  });

  /**
   * ── THE BAR HAS TO TRAVEL LIKE A BARBELL ──────────────────────────────
   *
   * CSS interpolates the four rotations linearly, and there is no reason in
   * principle for that to move the hands sensibly. A deadlift bar goes UP and
   * slightly BACK toward the lifter. A bar that swings out away from the shins
   * on the way up is the single most recognisable thing a lifter would call
   * wrong, and no test of the CSS itself would notice.
   *
   * So this reimplements the forward kinematics from the numbers in the two
   * files and follows the hands.
   */
  test('the bar goes up and back, never forward', () => {
    const path = [];
    for (let i = 0; i <= 20; i++) path.push(handAt(1 - i / 20));

    for (let i = 1; i < path.length; i++) {
      assert.ok(
        path[i][1] <= path[i - 1][1] + 1e-6,
        `the bar drops during the pull, between samples ${i - 1} and ${i}`
      );
      assert.ok(
        path[i][0] <= path[i - 1][0] + 1e-6,
        `the bar swings FORWARD during the pull (x ${path[i - 1][0].toFixed(1)} -> ` +
          `${path[i][0].toFixed(1)}). A bar path that moves away from the lifter is ` +
          `the first thing anybody who lifts would call wrong.`
      );
    }

    const rise = path[0][1] - path[path.length - 1][1];
    assert.ok(rise > 40, `the bar only travels ${rise.toFixed(1)} units - that is not a lift`);
  });

  /** The hands hold the MIDDLE of the bar, and the load is even. */
  test('the bar is balanced in the hands', () => {
    const seg = segments();
    const bar = loading.slice(loading.indexOf('className="lift-bar"'));
    const hand = seg.arm.to;

    const shaft = bar.match(/className="lift-shaft"[^/]*x1="([-\d.]+)"[^/]*x2="([-\d.]+)"/);
    assert.ok(shaft, 'the bar has no shaft');
    assert.equal((+shaft[1] + +shaft[2]) / 2, hand[0], 'the lifter is gripping the bar off-centre');

    for (const part of ['lift-plate-1', 'lift-plate-2', 'lift-plate-3', 'lift-collar']) {
      const xs = [...bar.matchAll(new RegExp(`className="${part}" x1="([-\\d.]+)"`, 'g'))].map((m) => +m[1]);
      assert.equal(xs.length, 2, `${part} should appear twice - a barbell is loaded on both ends`);
      assert.equal(
        (xs[0] + xs[1]) / 2,
        hand[0],
        `${part} is not balanced about the hands - one side is loaded heavier than the other`
      );
    }
  });

  /**
   * ── THE BAR HAS TO LAND ON THE PLATFORM ───────────────────────────────
   *
   * A competition bar sits 225mm off the floor for one reason: the largest
   * plate is 450mm across. Here that same fact is spread over two files - the
   * plate's height is in the JSX, its thickness is a stroke-width in the CSS,
   * and the pose that decides where the bar stops is a third set of numbers
   * again. Change any one of them and the bar quietly floats above the
   * platform or sinks through it. It renders; it is just wrong.
   */
  test('the loaded bar comes to rest exactly on the platform', () => {
    const plate = loading.match(/className="lift-plate-1" x1="[-\d.]+" y1="([-\d.]+)" x2="[-\d.]+" y2="([-\d.]+)"/);
    assert.ok(plate, 'no tallest plate found');
    const [top, bottom] = [+plate[1], +plate[2]];
    const halfHeight = (bottom - top) / 2;

    const width = ALWAYS.find((r) => r.selectors.includes('.lift-plate-1'));
    assert.ok(width, 'the tallest plate has no rule of its own');
    const stroke = width.body.match(/stroke-width:\s*([\d.]+)/);
    assert.ok(stroke, '.lift-plate-1 declares no stroke-width');

    // The plate is a round-capped line, so it reaches half a stroke past its end.
    const reach = halfHeight + +stroke[1] / 2;

    const floor = loading.match(/className="lift-floor"[^/]*y1="([-\d.]+)"/);
    assert.ok(floor, 'there is no platform');

    const barAtBottom = handAt(1)[1];
    const rest = barAtBottom + reach;
    const off = rest - +floor[1];

    // Half a viewBox unit. At the 120px size that is under a third of a screen
    // pixel - invisible - while a real mistake (a plate a unit taller, a
    // stroke a unit thicker, a joint moved) shifts it by several units. The
    // tolerance exists because the pose comes out of accumulated trig, not
    // because the fit is approximate.
    assert.ok(
      Math.abs(off) < 0.5,
      `the loaded bar rests at ${rest.toFixed(2)} but the platform is at ${floor[1]} - ` +
        `the plates are ${off > 0 ? 'sunk into' : 'floating above'} it by ${Math.abs(off).toFixed(2)} units`
    );
  });

  /** A plate stack only reads as a stack if the plates differ. */
  test('the plates descend outward the way a bar is actually loaded', () => {
    const widths = ['lift-plate-1', 'lift-plate-2', 'lift-plate-3', 'lift-collar'].map((c) => {
      const rule = ALWAYS.find((r) => r.selectors.includes(`.${c}`));
      assert.ok(rule, `no rule for .${c}`);
      const w = rule.body.match(/stroke-width:\s*([\d.]+)/);
      assert.ok(w, `.${c} declares no stroke-width`);
      return +w[1];
    });
    for (let i = 1; i < widths.length; i++) {
      assert.ok(
        widths[i] < widths[i - 1],
        `the plates do not get thinner outboard (${widths}) - a stack of identical ` +
          `strokes is one thick plate, which is what made the first bar read as a wheel`
      );
    }
  });

  /**
   * ── THE BUG THAT COST TWO ROUNDS ──────────────────────────────────────
   *
   * The shared stroke defaults were first written as `.lift-body line`, which
   * is ONE CLASS PLUS ONE TYPE and therefore outranks every `.lift-plate-N`
   * and `.lift-belt` exception, which are one class each. All four plate
   * widths were silently discarded, and the belt drew in the lifter's own
   * colour at the lifter's own width - a very good way to make a belt
   * invisible. The stylesheet was valid and nothing warned.
   *
   * The fix is to put the defaults on the GROUP and let SVG inheritance carry
   * them, because an inherited value loses to any directly-applied declaration
   * whatever its specificity. This asserts the arrangement rather than the
   * instance: no descendant selector may set these properties.
   */
  test('the stroke defaults are inherited from the group, not imposed by a descendant rule', () => {
    const INHERITED = ['stroke', 'stroke-width', 'stroke-linecap', 'fill'];
    for (const rule of ALWAYS) {
      for (const selector of rule.selectors) {
        if (!selector.startsWith('.lift')) continue;
        // A descendant combinator ending in a bare element type - `.lift-x line`.
        if (!/^\.[\w-]+\s+[a-z]+$/.test(selector)) continue;
        for (const prop of INHERITED) {
          assert.ok(
            !new RegExp(`(^|;|\\s)${prop}:`).test(rule.body),
            `\`${selector}\` sets ${prop}. That selector outranks every single-class ` +
              `rule below it, so any per-part override is silently discarded. Put the ` +
              `default on the group (it is an inherited SVG property) and let the ` +
              `exceptions apply directly.`
          );
        }
      }
    }
  });

  test('there are exactly three referees', () => {
    const lights = [...loading.matchAll(/className="lift-light"/g)];
    assert.equal(
      lights.length,
      3,
      'powerlifting is judged by three referees and a lift stands on a majority of two'
    );
    assert.equal(
      [...loading.matchAll(/className="lift-lamp"/g)].length,
      3,
      'every referee needs a light'
    );
  });

  /**
   * The lights mean "good lift", so they belong to the lockout and nothing
   * else. On before the bar is up is a decision nobody made yet.
   */
  test('the lights come on at lockout and not before', () => {
    const at = cssCode.indexOf('@keyframes lift-lamp');
    assert.ok(at !== -1, 'the lights do not animate');
    const lamp = blockAt(cssCode, at).body;

    const lit = [...lamp.matchAll(/([\d.]+)%[^{]*\{[^}]*opacity:\s*1/g)].map((m) => +m[1]);
    assert.ok(lit.length > 0, 'the lights never come on');

    // The lockout hold, taken from the lift itself rather than restated here.
    const hold = styleFor('shin').keyframes.match(/([\d.]+)%,\s*([\d.]+)%\s*\{\s*transform:\s*rotate\(0deg\)/);
    assert.ok(hold, 'cannot find the lockout hold in the lift keyframes');
    const [lockedAt, releasedAt] = [+hold[1], +hold[2]];

    for (const on of lit) {
      assert.ok(
        on >= lockedAt && on <= releasedAt,
        `a light reaches full at ${on}% but the lift is only locked out between ` +
          `${lockedAt}% and ${releasedAt}% - the referees are calling a lift that has not happened`
      );
    }
  });

  test('the whole figure holds still for anybody who asked for less motion', () => {
    assert.ok(REDUCED !== null, 'a repeating animation with no reduced-motion escape at all');
    const inside = rules(REDUCED);
    for (const name of JOINTS) {
      const stopped = inside.some(
        (r) => r.selectors.includes(`.lift-${name}`) && /animation:\s*none/.test(r.body)
      );
      assert.ok(
        stopped,
        `.lift-${name} keeps animating under prefers-reduced-motion - stopping only ` +
          `some of the joints does not calm the figure down, it dismembers it`
      );
    }
  });

  test('the animation is declared after the landing page block', () => {
    // landing.test.js reads every rule from `.home {` to the END OF THE
    // LANDING PAGE BLOCK marker and requires each selector to be home-
    // prefixed. A rule added above it fails a test about an unrelated page.
    const marker = css.indexOf('END OF THE LANDING PAGE BLOCK');
    assert.ok(marker !== -1, 'the landing page block marker is gone');
    assert.ok(css.indexOf('.lift-shin') > marker, 'the loading rules landed inside the landing page block');
  });

  test('the decoration is hidden and the word is what gets announced', () => {
    assert.match(loading, /role="status"/, 'nothing announces that a wait is happening');
    assert.match(loading, /<svg[\s\S]*?aria-hidden="true"/, 'a screen reader would narrate a stick figure');
    assert.match(loading, /t\('common\.loading'\)/, 'the word has to come from the locale');
    for (const [name, locale] of [['en', en], ['es', es]]) {
      assert.equal(typeof locale.common.loading, 'string', `${name} has no common.loading`);
    }
  });

  /**
   * Every route is in one bundle, so a page change involves no network. An
   * animation in front of that would not cover a wait, it would create one.
   */
  test('it is not an interstitial in front of the router', () => {
    assert.doesNotMatch(app, /<Loading/, 'App.jsx puts a loading animation in front of instant transitions');
  });

  test('no page still renders the bare word where the figure belongs', () => {
    const offenders = [];
    const walk = (at, prefix = '') => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(new URL(`${entry.name}/`, at), `${prefix}${entry.name}/`);
          continue;
        }
        if (!entry.name.endsWith('.jsx') || entry.name === 'Loading.jsx') continue;
        if (/t\('common\.loading'\)/.test(readSource(new URL(entry.name, at)))) {
          offenders.push(prefix + entry.name);
        }
      }
    };
    walk(new URL('../../web/src/', import.meta.url));
    assert.deepEqual(offenders, [], `these print the word instead of showing the figure: ${offenders}`);
  });
});
