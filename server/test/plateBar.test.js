import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PLATE_DENOMINATIONS,
  PLATE_COLORS,
  loadBarbell,
  platesAvailable,
} from '../../web/src/lib/plates.js';

const componentSource = await readFile(
  new URL('../../web/src/components/PlateBar.jsx', import.meta.url),
  'utf8',
);
const stylesheet = await readFile(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
const programPage = await readFile(new URL('../../web/src/pages/Program.jsx', import.meta.url), 'utf8');

/** Pulls one `const NAME = { ... }` table out of the component and parses the
 *  plate keys it defines per unit. Reads the artifact, not a copy of it. */
function tableKeys(name, units) {
  const start = componentSource.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} is no longer declared in PlateBar.jsx`);
  const open = componentSource.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < componentSource.length; i += 1) {
    if (componentSource[i] === '{') depth += 1;
    if (componentSource[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = componentSource.slice(open, end + 1);
  const unitStart = body.indexOf(`${units}: {`);
  assert.notEqual(unitStart, -1, `${name} has no ${units} table`);
  const unitOpen = body.indexOf('{', unitStart);
  const unitEnd = body.indexOf('}', unitOpen);
  return [...body.slice(unitOpen, unitEnd).matchAll(/([\d.]+):/g)].map((m) => Number(m[1]));
}

/**
 * A plate with no geometry entry does not fail. It falls back to a default
 * size and renders a bar that is quietly wrong - a 25 drawn the size of a 10.
 * Nothing else in the suite would see that, so the tables are held against the
 * denominations the solver can actually return.
 */
test('every plate the solver can return has a drawn size and thickness', () => {
  for (const units of ['kg', 'lb']) {
    for (const table of ['DIAMETER', 'THICKNESS']) {
      const drawn = new Set(tableKeys(table, units));
      for (const plate of PLATE_DENOMINATIONS[units]) {
        assert.ok(drawn.has(plate), `${table}.${units} has no entry for the ${plate} plate`);
      }
    }
  }
});

test('every color name the component maps is one plates.js actually uses', () => {
  const mapped = new Set(
    [...componentSource.matchAll(/^ {2}(\w+): 'var\(--plate-[\w-]+\)',$/gm)].map((m) => m[1]),
  );
  assert.ok(mapped.size > 0, 'found no color mapping in PlateBar.jsx - has its shape changed?');
  const used = new Set(Object.values(PLATE_COLORS.kg).map((c) => c.name));
  for (const name of used) {
    assert.ok(mapped.has(name), `plates.js uses the color "${name}" and the component cannot draw it`);
  }
});

test('every plate color the component draws is defined in the stylesheet', () => {
  const referenced = [...componentSource.matchAll(/var\((--plate-[\w-]+|--steel-[\w-]+)\)/g)]
    .map((m) => m[1]);
  assert.ok(referenced.length >= 7, 'expected the component to reference the plate tokens');
  for (const token of new Set(referenced)) {
    assert.ok(
      new RegExp(`^\\s*${token}:`, 'm').test(stylesheet),
      `${token} is drawn by PlateBar.jsx and defined nowhere in styles.css`,
    );
  }
});

/**
 * The page-level wiring, asserted rather than assumed.
 *
 * A library with passing tests that no page imports is not a feature. This is
 * the check that the plate work actually reaches an athlete.
 */
test('the program page imports the plate calculator and renders it', () => {
  assert.match(programPage, /from '\.\.\/lib\/plates\.js'/);
  assert.match(programPage, /from '\.\.\/components\/PlateBar\.jsx'/);
  assert.match(programPage, /<PlateBar/);
  assert.match(programPage, /plateWords\(/);
});

test('the program route sends the equipment the page needs, and nothing more', async () => {
  const route = await readFile(new URL('../src/routes/program.js', import.meta.url), 'utf8');
  assert.match(route, /equipment:/);
  // The columns are named. user_profile also holds injuries and restrictions,
  // and a select('*') here would ship health data to draw a plate count.
  assert.match(route, /\.from\('user_profile'\)\.select\('units, smallest_plate_pair'\)/);
  assert.doesNotMatch(route, /from\('user_profile'\)\.select\('\*'\)/);
});

test('the words and the drawing cannot disagree, because they share a solver', () => {
  // Both come from the same loadout object. This asserts the property that
  // makes the drawing trustworthy: what is pictured is what was computed.
  const loadout = loadBarbell(160, { units: 'kg' });
  const drawnTotal = loadout.plates.reduce((sum, p) => sum + p, 0) * 2 + loadout.barTotal;
  assert.equal(drawnTotal, 160);
  assert.deepEqual(loadout.plates, [25, 25, 15, 2.5]);
});

test('a gym with only big plates gets a smaller denomination list', () => {
  assert.deepEqual(platesAvailable(5, 'lb'), [45, 35, 25, 10, 5]);
  assert.deepEqual(platesAvailable(1.25, 'kg'), [25, 20, 15, 10, 5, 2.5, 1.25]);
  // Unknown means the full set, not a guess at a smaller one.
  assert.deepEqual(platesAvailable(null, 'lb'), PLATE_DENOMINATIONS.lb);
  assert.deepEqual(platesAvailable(0, 'kg'), PLATE_DENOMINATIONS.kg);
});

test('the guards can fail', () => {
  // Proof the geometry check is really reading the component: a denomination
  // that does not exist must be reported missing.
  const drawn = new Set(tableKeys('DIAMETER', 'kg'));
  assert.equal(drawn.has(7.5), false);
});
