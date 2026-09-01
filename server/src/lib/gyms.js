/**
 * Where people actually train, as a starting point rather than as a fact.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * "What equipment can you get to?" is a free-text box, and it is one of the
 * questions people answer worst. They write "the gym", or they list three
 * things and forget the rack. The program is computed from that answer, so a
 * thin answer produces a program built on guesses.
 *
 * Most people train at one of a handful of chains. Naming the chain lets us
 * pre-fill the box with something close, which the athlete then corrects. The
 * correcting is the point: editing a list is a far easier task than writing
 * one from nothing, and what gets stored is still their answer.
 *
 * ── WHAT THIS IS EXPLICITLY NOT ───────────────────────────────────────────
 *
 * It is NOT an equipment database, and it must never grow into one. No chain
 * publishes a per-branch inventory, every source on the subject says the same
 * thing - equipment varies by franchise, by club size, by year - and a
 * confident wrong list is worse than no list. "Your gym has a deadlift
 * platform" sends somebody looking for one that is not there; "your gym has a
 * rack" when it does not is how a person improvises a heavy squat off a bench.
 *
 * So every profile below is a SUGGESTION the athlete confirms, the wording
 * says so, and the stored value is whatever they left in the box.
 *
 * ── THE ONE FIELD THAT CHANGES PROGRAMMING ────────────────────────────────
 *
 * `barbell`. A powerlifting program assumes a barbell and a rack. Planet
 * Fitness - by far the largest chain in the US by membership, and therefore
 * the one a beginner is most likely to walk into - has neither. Fixed-weight
 * barbells to about 60lb, a Smith machine instead of a rack, dumbbells to
 * 50lb, and a policy against dropping weights.
 *
 * That is not a detail to mention in passing. Somebody training there cannot
 * perform the three competition lifts as this product prescribes them, and the
 * honest thing is to say so before writing them a program that assumes
 * otherwise - not to quietly prescribe a back squat to a person with no rack.
 * See describeGymContext() in the prompt: it is handed to the coach as a
 * computed constraint, the same way the clearance gate and the progression
 * loads are, rather than left for the model to infer from a text box.
 *
 * Sources are secondary reporting - BarBend, PowerliftingTechnique, Dr Workout
 * and the chains' own marketing pages - not per-branch inventories, which is
 * another reason these are suggestions rather than facts.
 *
 * ── WHERE THE SUGGESTED TEXT LIVES, AND WHY NOT HERE ──────────────────────
 *
 * In the web i18n catalog, under intake.gymEquipment. It is prose shown to a
 * person and it has to be translatable, so it belongs with the other prose
 * shown to a person. Keeping a second copy here would be two sources of truth
 * for the same sentences, and the copy nobody looks at is the one that goes
 * stale. What this module owns is the part the COACH is told: whether a
 * barbell can be assumed, and the note explaining why not.
 */

/** When the profile was last checked against published descriptions. */
export const GYM_PROFILES_VERIFIED_ON = '2026-08-27';

/**
 * @typedef {object} GymProfile
 * @property {string} slug        stored value
 * @property {'yes'|'varies'|'none'} barbell whether a barbell and rack are there
 * @property {string|null} note   what the coach is told, when it changes anything
 */

/** @type {Record<string, GymProfile>} */
export const GYM_PROFILES = Object.freeze({
  planet_fitness: {
    slug: 'planet_fitness',
    barbell: 'none',
    note:
      'This athlete trains at Planet Fitness, which has no Olympic barbell and no squat ' +
      'or power rack - a Smith machine stands in for one - and discourages dropping ' +
      'weight. They cannot perform the squat, bench and deadlift as this product ' +
      'normally prescribes them.',
  },
  anytime_fitness: {
    slug: 'anytime_fitness',
    barbell: 'yes',
    note: null,
  },
  golds_gym: {
    slug: 'golds_gym',
    barbell: 'yes',
    note: null,
  },
  la_fitness: {
    slug: 'la_fitness',
    barbell: 'yes',
    note: null,
  },
  crunch: {
    slug: 'crunch',
    barbell: 'yes',
    note: null,
  },
  snap_fitness: {
    slug: 'snap_fitness',
    barbell: 'varies',
    note:
      'This athlete trains at Snap Fitness, a small-format chain where rack availability ' +
      'genuinely varies by club. Confirm they have a rack before programming around one.',
  },
  ymca: {
    slug: 'ymca',
    barbell: 'varies',
    note:
      'This athlete trains at a YMCA, where equipment varies enormously between branches. ' +
      'Ask what they actually have rather than assuming a rack.',
  },
  university_gym: {
    slug: 'university_gym',
    barbell: 'yes',
    note: null,
  },
  barbell_gym: {
    slug: 'barbell_gym',
    barbell: 'yes',
    note:
      'This athlete trains at a dedicated barbell or powerlifting gym, so competition ' +
      'equipment - a comp bar, a real bench, chalk, spotters - can be assumed available.',
  },
  home_gym: {
    slug: 'home_gym',
    barbell: 'varies',
    note:
      'This athlete trains at home, so the equipment list is exhaustive rather than ' +
      'indicative: if it is not listed, they do not have it. Do not program around a ' +
      'machine, a specialty bar or a spotter unless they said they have one.',
  },
  other: {
    slug: 'other',
    barbell: 'varies',
    note: null,
  },
});

/** Stored values, in the order the form offers them. */
export const GYM_SLUGS = Object.freeze(Object.keys(GYM_PROFILES));

/**
 * Whether a barbell and a rack can be assumed.
 *
 * 'none' only when EVERY named gym lacks one - somebody with a Planet Fitness
 * membership and a garage barbell is not barbell-less, and telling them they
 * are would be both wrong and insulting.
 *
 * @param {string[]} slugs
 * @returns {'yes'|'varies'|'none'|'unknown'}
 */
export function barbellAccess(slugs = []) {
  const known = slugs.filter((slug) => GYM_PROFILES[slug]);
  if (known.length === 0) return 'unknown';
  if (known.some((slug) => GYM_PROFILES[slug].barbell === 'yes')) return 'yes';
  if (known.every((slug) => GYM_PROFILES[slug].barbell === 'none')) return 'none';
  return 'varies';
}

/**
 * The notes worth putting in front of the coach, deduplicated.
 *
 * @param {string[]} slugs
 * @returns {string[]}
 */
export function gymNotes(slugs = []) {
  return [...new Set(
    slugs
      .map((slug) => GYM_PROFILES[slug]?.note)
      .filter(Boolean)
  )];
}
