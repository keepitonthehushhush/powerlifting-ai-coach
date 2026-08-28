import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, readRaw, phrase } from './helpers/source.js';

/**
 * ── WHY logger.info WAS NOT AN AUDIT TRAIL ─────────────────────────────────
 *
 * The three operations most likely to be disputed already had a record:
 * account.exported, account.deleted, and the billing webhook's writes all
 * called logger.info. Those go to a hosted log stream with a retention window
 * measured in days, that nobody reads, that the person the record is about
 * cannot see, and that is gone by the time anybody asks.
 *
 * This codebase has been bitten twice by "logged loudly" meaning nothing
 * because nobody was listening - the rate limiter, and the usage_events GRANT.
 * A log line answers "what happened, if you look right now". An audit row
 * answers "what happened", later, to whoever asks.
 */

const migration = readRaw(new URL('../../supabase/migrations/0030_audit_events.sql', import.meta.url));
const account = readSource(new URL('../src/routes/account.js', import.meta.url));
const accountRaw = readRaw(new URL('../src/routes/account.js', import.meta.url));
const webhook = readSource(new URL('../src/routes/billingWebhook.js', import.meta.url));
const webhookRaw = readRaw(new URL('../src/routes/billingWebhook.js', import.meta.url));
const panel = readSource(new URL('../../web/src/components/ActivityLog.jsx', import.meta.url));
const en = readSource(new URL('../../web/src/i18n/locales/en.js', import.meta.url));

describe('THE RECORD OF A DELETION SURVIVES THE DELETION', () => {
  test('user_id is SET NULL, not CASCADE', () => {
    // Cascade is the obvious choice and it destroys the thing being built:
    // deleting an account would erase the record that the account was deleted,
    // so the operation most likely to be disputed is the one with no evidence,
    // and the evidence disappears exactly when it becomes relevant.
    assert.match(migration, /user_id\s+uuid references auth\.users \(id\) on delete set null/);
    assert.ok(!/audit_events[\s\S]{0,400}on delete cascade/.test(migration));
  });

  test('and what survives is not personal data', () => {
    assert.match(migration, phrase('no user id, no email, no hash, nothing that points back'));
  });

  test('THE DELETION IS RECORDED BEFORE THE ACCOUNT IS DELETED', () => {
    // Afterwards there is no caller to attribute it to - auth.uid() is gone
    // with the user row, so a record written after could not be written at all.
    const audit = account.indexOf("p_action: 'account_deleted'");
    const del = account.indexOf("rpc('delete_my_account')");
    assert.ok(audit !== -1 && del !== -1, 'one of the two calls is missing');
    assert.ok(audit < del, 'the audit row is written after the account is deleted, which cannot work');
  });
});

describe('what may be recorded, and by whom', () => {
  test('the detail column whitelists its keys in the DATABASE, not in a code path', () => {
    // Health data has no key it could arrive under, and adding one is a
    // migration somebody has to justify. Injury text copied into an audit
    // table is health information kept for a new purpose.
    assert.match(migration, /detail - array\['event_id','type','status','rows','tables','code'\] = '\{\}'::jsonb/);
    for (const forbidden of ['health', 'injur', 'restriction', 'notes', 'weight', 'email']) {
      assert.ok(
        !new RegExp(`'${forbidden}`, 'i').test(migration.match(/detail\s+jsonb[\s\S]*?\)\)/)?.[0] ?? ''),
        `the whitelist permits a "${forbidden}" key`,
      );
    }
  });

  test('A BROWSER CANNOT CLAIM A SUBSCRIPTION CHANGED', () => {
    // The definer function refuses that action. Letting a client write it -
    // even only into the audit trail - would make the trail something you can
    // plant evidence in.
    assert.match(migration, /if p_action not in \('data_exported', 'account_deleted'\) then/);
    assert.match(migration, /raise exception 'audit_action_not_permitted'/);
  });

  test('and the table itself is read-only to users', () => {
    // An audit trail a user can write is a diary; one they can edit is
    // fiction. The privilege is the control - RLS narrows a granted privilege
    // and does not create one.
    assert.match(migration, /grant select on public\.audit_events to authenticated;/);
    assert.match(migration, /revoke insert, update, delete on public\.audit_events from authenticated;/);
    assert.ok(!/create policy[\s\S]*?for (insert|update|delete)/i.test(migration));
  });

  test('people read only their own rows', () => {
    assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  });
});

describe('the service-role exception is now observable', () => {
  test('EVERY WEBHOOK WRITE LEAVES A ROW THE SUBSCRIBER CAN READ', () => {
    // ADR-12 documents the one place RLS is bypassed. This makes it the one
    // place with an independent record of what it did.
    assert.match(webhook, /action: 'subscription_changed'/);
    assert.match(webhook, /actor: 'stripe'/);
    assert.match(webhookRaw, phrase('makes it OBSERVABLE'));
  });

  test('it carries the Stripe event id, so a row can be traced back', () => {
    assert.match(webhook, /event_id: event\.id/);
  });

  test('and an audit failure never fails the webhook', () => {
    // A non-2xx makes Stripe retry for days. Over a bookkeeping write, that
    // turns a logging problem into an outage.
    assert.match(webhook, /if \(auditError\) logger\.error\('audit\.write_failed'/);
    assert.ok(!/throw new Error[^\n]*auditError/.test(webhook));
  });
});

describe('the audit write does not become the failure', () => {
  test('it is awaited inside its own try/catch, not left floating', () => {
    // A floating promise dies mid-socket when a serverless function freezes on
    // response - the bug that lost usage_events writes for days.
    assert.match(account, /await req\.supabase\.rpc\('record_audit_event'/);
    assert.match(accountRaw, phrase('what a floating promise on a serverless runtime does'));
  });

  test('and a failed audit write does not deny somebody their export', () => {
    assert.match(account, /logger\.error\('audit\.write_failed'/);
  });
});

describe('the subject can read it, which is most of the point', () => {
  test('there is a route, scoped by the policy rather than by the query', () => {
    assert.match(account, /accountRouter\.get\('\/activity'/);
    assert.match(account, /from\('audit_events'\)/);
    assert.ok(!/eq\('user_id'/.test(account), 'the route filters by user_id instead of trusting the policy');
  });

  test('it is ordered by seq, not created_at', () => {
    // Two rows written in one transaction share a timestamp and sort
    // arbitrarily - the 0010 bug, still one ORDER BY away.
    assert.match(account, /\.order\('seq', \{ ascending: false \}\)/);
  });

  test('the panel renders nothing rather than an empty box', () => {
    assert.match(panel, /if \(!events \|\| events\.length === 0\) return null/);
  });

  test('and says why it exists in words the reader benefits from', () => {
    assert.match(en, phrase('so you can check them rather than take our word for it'));
  });
});
