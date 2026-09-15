import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARD, CARD_KEYWORD, headlineFrom, paletteFrom, textChunk, withTextChunk }
  from '../../scripts/make-social-card.mjs';
import { readRaw, readSource } from './helpers/source.js';

const html = readRaw(new URL('../../web/index.html', import.meta.url));
const png = readFileSync(new URL('../../web/public/social-card.png', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));
const css = readRaw(new URL('../../web/src/styles.css', import.meta.url));

/** The tag's value, or undefined. Attribute order varies and the file wraps. */
function meta(kind, name) {
  const pattern = new RegExp(
    `<meta\\s+${kind}="${name.replace(/[:]/g, '[:]')}"\\s+content="([^"]*)"`, 's',
  );
  const wrapped = new RegExp(
    `<meta\\s*\\n\\s*${kind}="${name.replace(/[:]/g, '[:]')}"\\s*\\n\\s*content="([^"]*)"`, 's',
  );
  return (html.match(pattern) ?? html.match(wrapped))?.[1];
}

/**
 * ── THE PICTURE NOBODY ON THE TEAM EVER SEES ──────────────────────────────
 *
 * A link preview is rendered by somebody else's crawler, in somebody else's
 * app, for somebody who has not visited the site yet. Nothing in this
 * repository looks at it, no page displays it, and it is the first impression
 * the product makes. That combination is this project's whole failure mode.
 *
 * `og:image` pointed at the 512x512 app icon under a comment saying a wide
 * image was owed. Meta's guidance recommends 1200x630, gives 600x315 as the
 * working minimum, and is explicit that below it an image "will still display
 * in the link page post, but the size will be much smaller".
 *
 * These tests hold three copies of one fact together: what the LOCALE says the
 * headline is, what the TAGS claim about the image, and what the FILE actually
 * is. The third is the one that is usually skipped.
 */
describe('a shared link renders a card, not a thumbnail', () => {
  test('the file on disk is the size the tags claim it is', () => {
    /*
     * Read from the PNG's own IHDR rather than trusting the tag, because "the
     * tag says 1200x630" and "the file is 1200x630" are two different claims
     * and every defect in this project has lived in a gap like that one.
     */
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG', 'the social card is not a PNG');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);

    assert.equal(width, CARD.width, `the card is ${width}px wide, not ${CARD.width}`);
    assert.equal(height, CARD.height, `the card is ${height}px tall, not ${CARD.height}`);

    assert.equal(meta('property', 'og:image:width'), String(width), 'og:image:width disagrees with the file');
    assert.equal(meta('property', 'og:image:height'), String(height), 'og:image:height disagrees with the file');

    // Meta asks for "as close to 1.91:1 as possible to display the full image
    // in Feed without any cropping". 1200/630 is 1.905.
    const ratio = width / height;
    assert.ok(Math.abs(ratio - 1.91) < 0.02, `the card is ${ratio.toFixed(3)}:1, not the 1.91:1 asked for`);

    // Comfortably inside Meta's stated 8 MB ceiling. The tighter budget is
    // ours: a card that needs a megabyte is a card somebody put a photograph
    // in, and this one is flat color and type.
    assert.ok(png.length < 1_000_000, `the card is ${(png.length / 1024).toFixed(0)} kB, which is too big for flat type`);
    assert.ok(png.length > 10_000, `the card is ${png.length} bytes, which is too small to be a rendered card`);
  });

  test('AND THE PIXELS WERE DRAWN FROM THE HEADLINE THE SITE CURRENTLY SHOWS', () => {
    /*
     * The one that closes the loop. A card can be the right size, described by
     * correct tags, and still show last month's sentence - tags and locale
     * agreeing perfectly about words the picture does not contain.
     *
     * The generator writes the headline it drew into a tEXt chunk, so the
     * chunk and the pixels come out of one render. It is evidence about this
     * file rather than a claim about it. What it does NOT prove is that the
     * glyphs are legible, and nothing cheap does; that is why regenerating is
     * a documented step rather than an inferred one.
     */
    const drew = textChunk(png, CARD_KEYWORD);
    assert.ok(drew, 'the card carries no record of what it was drawn from - regenerate it');
    assert.equal(
      drew,
      headlineFrom(en),
      'the landing page headline changed and the card was not regenerated: run `node scripts/make-social-card.mjs`',
    );
  });

  test('the alt text describes the picture, so it cannot drift from it either', () => {
    // A preview card is content somebody may be hearing rather than seeing,
    // and the Open Graph specification says that "if the page specifies an
    // og:image it should specify og:image:alt".
    const headline = headlineFrom(en);
    for (const [kind, name] of [['property', 'og:image:alt'], ['name', 'twitter:image:alt']]) {
      const alt = meta(kind, name);
      assert.ok(alt, `${name} is missing`);
      assert.ok(alt.includes('Coach Diaz'), `${name} does not name the product`);
      assert.ok(
        alt.includes(headline),
        `${name} does not contain the headline the card actually shows:\n  alt: ${alt}\n  card: ${headline}`,
      );
    }
  });

  test('the card is the wide one, and it is where the tag says it is', () => {
    assert.equal(
      meta('name', 'twitter:card'),
      'summary_large_image',
      'the card is back to the small square treatment a 512px icon needed',
    );
    const src = meta('property', 'og:image');
    assert.ok(src?.startsWith('https://coachdiaz.app/'), 'og:image is not an absolute URL, which crawlers require');
    assert.match(src, /\/social-card\.png$/, 'og:image no longer points at the card this file checks');
    assert.doesNotMatch(src, /icon-\d+\.png/, 'og:image is back to the app icon');
  });

  test('the generator reads the product rather than repeating it', () => {
    /*
     * The argument for a script over a hand-drawn PNG is that the picture
     * cannot drift from the brand. That only holds while it is still READING
     * the brand, so both readers are exercised here against the real files -
     * a parser that silently returns a default would make the generator a
     * second copy again, quietly.
     */
    const tokens = paletteFrom(css);
    assert.equal(tokens['--bg'], '#0f0d1a', 'the palette reader is not reading the shipped dark background');
    assert.ok(tokens['--accent'], 'the palette reader found no accent');
    assert.ok(Object.keys(tokens).length >= 15, 'the palette reader found suspiciously few tokens');
    assert.ok(headlineFrom(en).length > 20, 'the headline reader returned something too short to be the headline');
  });

  test('a text chunk round-trips through a real PNG', () => {
    // withTextChunk splices bytes into a file format, which is the kind of
    // code that appears to work while producing something only one decoder
    // tolerates. Chromium and Pillow both read the shipped file; this is the
    // unit-level half.
    const again = withTextChunk(png, 'RoundTrip', 'a sentence with spaces.');
    assert.equal(textChunk(again, 'RoundTrip'), 'a sentence with spaces.');
    assert.equal(textChunk(again, CARD_KEYWORD), textChunk(png, CARD_KEYWORD), 'the original chunk was disturbed');
    assert.equal(again.subarray(again.length - 8, again.length - 4).toString('latin1'), 'IEND',
      'IEND is no longer the last chunk, which makes the file invalid');
    assert.equal(textChunk(png, 'NeverWritten'), null, 'the reader invents chunks that are not there');
  });
});
