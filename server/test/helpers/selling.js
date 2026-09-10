/**
 * The words people reach for when they start selling.
 *
 * ── WHY THIS IS SHARED RATHER THAN COPIED ──────────────────────────────────
 *
 * It began inside appCapabilities.test.js, guarding the sentences the coach is
 * told about its own features: a description may say what a feature IS, never
 * what it will do FOR somebody, because some of the people reading them are
 * injured or have a difficult relationship with food and a results promise to
 * them is a health claim in marketing clothes.
 *
 * The landing page needs the identical rule and needs it MORE - a marketing
 * page is where those words actually arrive. Two copies of a rule drift, and
 * the copy that drifts is always the one nobody is looking at.
 *
 * ── IT KNOWS IT IS A PROXY ─────────────────────────────────────────────────
 *
 * A word list cannot catch a promise made in words nobody listed. It catches
 * the ones people reach for, which is the failure mode being guarded rather
 * than a claim to completeness.
 */
export const SELLING = [
  /\bguarantee/i,
  /\bfastest\b/i,
  /*
   * ── WHY THE SUPERLATIVE IS NARROW ────────────────────────────────────────
   *
   * This was a bare /\bbest\b/, which is right for a one-line feature
   * description and wrong for prose. On the landing page it matched "what your
   * BEST lifts are" - a factual question in the intake description - and the
   * Spanish matched an honest sentence naming a general AI as the better
   * choice for some people.
   *
   * A check that cries wolf is a check somebody switches off, and this session
   * already spent an afternoon on one that did. So the pattern now matches the
   * thing actually being guarded: a superlative about a PRODUCT.
   */
  /\bbest\b[^.]{0,40}\b(?:app|coach|coaching|program|platform|tool|software)\b/i,
  /\bexplode\b/i,
  /\btransform/i,
  /\bunlock\b/i,
  /\bmaximi[sz]e\b/i,
  /\bskyrocket/i,
  /\bcrush\b/i,
  /*
   * ── AND WHY THIS ONE HAS A BOUNDARY NOW ──────────────────────────────────
   *
   * It was /\bget (?:you )?(?:strong|jacked|huge)/, and "strong" with no
   * trailing boundary is a prefix of "stronger". It fired on "enough for a
   * beginner to GET STRONGER", which is not a promise - it is the plainest
   * possible description of what strength training is for, quoted from a
   * paper's own conclusion.
   *
   * The selling form is the second person: getting YOU strong. "jacked",
   * "ripped" and "huge" are selling in any grammatical person.
   */
  /\bget (?:you|yourself|your \w+) (?:strong|big)\b/i,
  /\bget (?:you |yourself )?(?:jacked|ripped|huge|shredded|swole)\b/i,
  /\bin (?:just )?\d+ (?:days|weeks)\b/i,
  /\bbetter than a (?:real |human )?coach\b/i,
];

/** Spanish, because es.js is copy too and the guard must not stop at the border. */
export const SELLING_ES = [
  /\bgarantiza/i,
  /\b(?:el|la) mejor\b[^.]{0,40}\b(?:app|aplicaci[óo]n|entrenador|coach|programa|plataforma|herramienta)\b/i,
  /\btransforma/i,
  /\bdesbloquea/i,
  /\bmaximiza/i,
  /\bexplota\b/i,
  /\ben (?:solo )?\d+ (?:d[ií]as|semanas)\b/i,
  /\bmejor que un (?:entrenador|coach)/i,
];
