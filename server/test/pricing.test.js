import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';
import {
  priceFor,
  costInMicrodollars,
  formatMicrodollars,
  MODEL_PRICES,
  PRICES_VERIFIED_ON,
} from '../src/lib/pricing.js';

const chatRoute = readSource(new URL('../src/routes/chat.js', import.meta.url));
const migration = readSource(new URL('../../supabase/migrations/0020_usage_events.sql', import.meta.url));

describe('priceFor', () => {
  test('finds a family by exact id', () => {
    assert.equal(priceFor('claude-sonnet-5').input, 2);
    assert.equal(priceFor('claude-sonnet-5').output, 10);
  });

  test('a dated release of a known family prices without a code change', () => {
    // The API returns claude-sonnet-5-20260115; the table is keyed by family.
    assert.deepEqual(priceFor('claude-sonnet-5-20260115'), MODEL_PRICES['claude-sonnet-5']);
  });

  test('longest prefix wins, so 4-5 is not mistaken for 5', () => {
    // 'claude-sonnet-4-5-20250929' must not match 'claude-sonnet-4-5' AND
    // something shorter and cheaper. This is the subtle one.
    assert.deepEqual(priceFor('claude-sonnet-4-5-20250929'), MODEL_PRICES['claude-sonnet-4-5']);
    assert.notEqual(priceFor('claude-sonnet-4-5').input, priceFor('claude-sonnet-5').input);
  });

  test('an unknown model is null, and null is not zero', () => {
    for (const model of ['claude-sonnet-9', 'gpt-something', '', null, undefined, 42]) {
      assert.equal(priceFor(model), null);
    }
  });
});

describe('costInMicrodollars', () => {
  test('prices input and output at the published rates', () => {
    // 1M input at $2 + 1M output at $10 = $12.00 = 12,000,000 microdollars.
    const cost = costInMicrodollars(
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      'claude-sonnet-5'
    );
    assert.equal(cost, 12_000_000);
  });

  test('a realistic single reply lands where you would expect', () => {
    // ~8k system prompt and history in, ~600 out. Sanity check on the order of
    // magnitude, because that is what the whole pricing decision rests on.
    const cost = costInMicrodollars(
      { input_tokens: 8000, output_tokens: 600 },
      'claude-sonnet-5'
    );
    assert.equal(cost, 22_000); // $0.022
    assert.ok(cost > 0 && cost < 100_000, 'a single reply should be cents, not dollars');
  });

  test('cache reads and writes are counted, not ignored', () => {
    // Prompt caching is on the deferred list. Ignoring these fields would make
    // the measurement wrong in the flattering direction the moment it is on.
    const withCache = costInMicrodollars(
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
      'claude-sonnet-5'
    );
    assert.equal(withCache, 200_000); // $0.20 per MTok read

    const withWrite = costInMicrodollars(
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 },
      'claude-sonnet-5'
    );
    assert.equal(withWrite, 2_500_000); // $2.50 per MTok written
  });

  test('AN UNPRICED MODEL COSTS NULL, NEVER ZERO', () => {
    // The failure mode that matters. ANTHROPIC_MODEL is a deploy variable, so
    // this table will go stale; a zero would silently under-report spend and
    // the first sign of trouble would be the invoice.
    assert.equal(costInMicrodollars({ input_tokens: 5000 }, 'claude-sonnet-99'), null);
    assert.equal(costInMicrodollars({ input_tokens: 5000 }, undefined), null);
    assert.equal(costInMicrodollars(null, 'claude-sonnet-5'), null);
  });

  test('missing or nonsense token counts are treated as zero, not NaN', () => {
    assert.equal(costInMicrodollars({}, 'claude-sonnet-5'), 0);
    assert.equal(
      costInMicrodollars({ input_tokens: null, output_tokens: 'lots' }, 'claude-sonnet-5'),
      0
    );
  });

  test('always returns an integer, so sums stay exact', () => {
    const cost = costInMicrodollars({ input_tokens: 1337, output_tokens: 419 }, 'claude-sonnet-5');
    assert.equal(Number.isInteger(cost), true);
  });
});

describe('formatMicrodollars', () => {
  test('shows enough decimals for a fraction of a cent to be visible', () => {
    assert.match(formatMicrodollars(22_000), /\$0\.022/);
  });

  test('a real total reads like money', () => {
    assert.equal(formatMicrodollars(12_340_000), '$12.34');
  });

  test('null in, null out - an unknown cost is not $0.00', () => {
    assert.equal(formatMicrodollars(null), null);
    assert.equal(formatMicrodollars(undefined), null);
  });
});

describe('the prices are attributable and dated', () => {
  test('carries the date they were last verified', () => {
    // A hardcoded price is a fact about a moment. Without a date nobody can
    // tell whether this is current or two years stale.
    assert.match(PRICES_VERIFIED_ON, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('the model the app actually runs is in the table', () => {
    assert.ok(MODEL_PRICES['claude-sonnet-5'], 'the default model has no price');
  });

  test('output always costs more than input, for every model', () => {
    // A cheap invariant that catches a transposed pair on a future edit.
    for (const [model, p] of Object.entries(MODEL_PRICES)) {
      assert.ok(p.output > p.input, `${model} has output priced at or below input`);
      assert.ok(p.cacheRead < p.input, `${model} cache reads are not cheaper than input`);
    }
  });
});

describe('what gets recorded, and what must never be', () => {
  test('the usage row carries tokens and cost, and no message content', () => {
    const insert = chatRoute.slice(chatRoute.indexOf("from('usage_events')"));
    for (const forbidden of ['messages', 'reply.text', 'content', 'prompt', 'system']) {
      assert.ok(
        !insert.slice(0, 600).includes(forbidden),
        `the usage row appears to carry ${forbidden}`
      );
    }
    assert.match(insert.slice(0, 600), /input_tokens/);
    assert.match(insert.slice(0, 600), /cost_microdollars/);
  });

  test('recording a cost can never cost an athlete their reply', () => {
    // The insert is fire-and-forget on purpose. A bookkeeping failure must not
    // turn into a failed coaching request.
    const insert = chatRoute.slice(chatRoute.indexOf("from('usage_events')"));
    assert.doesNotMatch(insert.slice(0, 600), /await\s+req\.supabase/);
    assert.match(insert, /usage\.record_failed/);
  });

  test('the table has no column that could hold a message', () => {
    const columns = [...migration.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|integer|bigint|timestamptz)/gm)]
      .map((m) => m[1]);
    assert.ok(columns.includes('input_tokens'));
    for (const column of columns) {
      assert.doesNotMatch(column, /message|content|prompt|reply|body|note/);
    }
  });

  test('cost is nullable, so an unpriced model reads as unknown not free', () => {
    assert.match(migration, /cost_microdollars bigint check \(cost_microdollars is null/);
  });

  test('rows cannot be edited or deleted after the fact', () => {
    // A cost record that can be rewritten is not a cost record.
    assert.doesNotMatch(migration, /for update/);
    assert.doesNotMatch(migration, /for delete/);
  });

  test('row-level security is on, and scoped to the owner like everything else', () => {
    assert.match(migration, /alter table public\.usage_events enable row level security/);
    assert.match(migration, /using \(user_id = \(select auth\.uid\(\)\)\)/);
    assert.match(migration, /with check \(user_id = \(select auth\.uid\(\)\)\)/);
  });
});
