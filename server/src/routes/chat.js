import { Router } from 'express';
import { z } from 'zod';
import { createCoachReply } from '../lib/anthropic.js';
import { costInMicrodollars } from '../lib/pricing.js';
import { extractProgramBlock } from '../lib/programBlock.js';
import { prescribesTraining, repairProgramBlock } from '../lib/programRepair.js';
import { extractIntentionBlock } from '../lib/intentionBlock.js';
import { needsMedicalClearance } from '../prompts/systemPrompt.js';
import { adultGateDecision, MINIMUM_AGE, ABSOLUTE_MINIMUM_AGE } from '../lib/ageGate.js';
import { recommendPhase } from '../lib/phase.js';
import { prescribeAll } from '../lib/progression.js';
import { buildSystemBlocks } from '../prompts/systemPrompt.js';
import { codedError } from '../lib/errorCodes.js';
import {
  describeCoachReply,
  coachError,
  coachApiError,
  TRUNCATION_NOTICE,
} from '../lib/coachOutcome.js';
import { entitlement, requiresSubscription, PAID_FEATURE } from '../lib/entitlement.js';
import { loadSubscription } from '../lib/subscriptions.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { GUARDIAN_CONSENT_VERSION } from '../lib/policyVersions.js';

export const chatRouter = Router();

const ChatRequest = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(config.chat.maxMessageLength),
  conversationId: z.string().uuid().optional(),
});

/**
 * Gather everything the coach needs to know about this athlete.
 *
 * Note what is NOT here: not a single query filters by user_id. It does not
 * need to. req.supabase carries the caller's JWT, so RLS scopes every one of
 * these to their own rows inside Postgres. See lib/supabase.js for why that is
 * the design rather than a convenience.
 */
async function loadCoachingContext(supabase) {
  const [profile, sessions, logs, program, library] = await Promise.all([
    supabase.from('user_profile').select('*').maybeSingle(),
    supabase.from('workout_sessions').select('date, exercises, notes').order('date', { ascending: false }).limit(5),
    supabase.from('progress_logs').select('lift, weight, reps, rpe, date, completed')
      .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(60),
    supabase.from('workout_programs').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('exercise_library').select('slug, name, video_url, video_source').not('video_url', 'is', null),
  ]);

  for (const result of [profile, sessions, logs, program, library]) {
    if (result.error) throw codedError('storage_unavailable', 'Could not load your training data.', { cause: result.error.code });
  }

  return {
    profile: profile.data,
    recentSessions: sessions.data ?? [],
    recentLogs: logs.data ?? [],
    activeProgram: program.data,
    exerciseLibrary: library.data ?? [],
  };
}

/**
 * Is there an active, current guardian consent for this athlete?
 *
 * ── WHY IT READS THE LEDGER RATHER THAN CALLING has_active_consent() ──────
 *
 * The database has that function and it is version-aware, but reaching it
 * means `.rpc()`, and `.rpc()` resolves against the client's schema while the
 * tests mock rpc with something that answers to any name. A gate that decides
 * whether a child is coached should not be verified by a mock that cannot tell
 * which function it was asked for. `delete_my_account` sat in the wrong schema
 * in production for exactly that reason.
 *
 * So it reads the rows directly, ordered the way the ledger has to be ordered,
 * and compares the policy version itself. Version-awareness is the point: a
 * guardian who agreed to last quarter's terms has not agreed to these.
 *
 * FAILS CLOSED. A read error returns false, which refuses coaching rather than
 * granting it, like every other gate here.
 */
async function loadGuardianConsent(supabase) {
  const { data, error } = await supabase
    .from('consent_records')
    .select('consent_type, granted, policy_version, created_at, seq')
    .eq('consent_type', 'guardian_consent')
    .order('seq', { ascending: false });

  if (error) return false;

  // Newest first, so the first row is the current decision. `seq` and not
  // `created_at`: now() is transaction start time, so two decisions written in
  // one transaction carry the same timestamp and sort arbitrarily - the bug
  // that once made a withdrawal read as a grant.
  const latest = (data ?? [])[0];
  if (!latest || latest.granted !== true) return false;

  // Version-aware, checked here rather than by deriveCurrentConsents because
  // guardian_consent is deliberately not in the athlete-facing versions map
  // until it has a document. A guardian who agreed to a superseded policy has
  // not agreed to this one.
  return latest.policy_version === GUARDIAN_CONSENT_VERSION;
}

/**
 * What an athlete is told when the age gate refuses them.
 *
 * Pulled out of the route because the gate now has three refusals rather than
 * two, and a nested ternary deciding what to tell a child is the wrong shape
 * for something a person actually reads.
 */
function refusalMessage(reason) {
  if (reason === 'guardian_consent_required') {
    return `Coach Diaz can coach you at your age, but only once a parent or guardian has agreed to it. `
      + `Ask them to give us their email address on your profile page and we will send them what they need to read. `
      + `Nothing you have entered has been deleted.`;
  }
  if (reason === 'too_young') {
    return `Coach Diaz is only for people aged ${ABSOLUTE_MINIMUM_AGE} and over, and under ${MINIMUM_AGE} `
      + `we also need a parent or guardian to agree. Nothing you have entered has been deleted.`;
  }
  return 'Please add your date of birth on the profile page before talking to Coach.';
}

/** Fetch the caller's active conversation, or start one. */
async function loadOrCreateConversation(supabase, conversationId) {
  if (conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, messages')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw codedError('storage_unavailable', 'Could not load the conversation.');
    // A conversation belonging to somebody else is invisible to this client
    // thanks to RLS, so "not found" and "not yours" are indistinguishable here
    // by design - there is no way to probe for another user's conversation ids.
    if (!data) throw codedError('not_found', 'Conversation not found.');
    return data;
  }

  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('id, messages')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw codedError('storage_unavailable', 'Could not load the conversation.');
  if (existing) return existing;

  // No user_id here, deliberately, and it is the same premise as the reads
  // above: ownership is the database's to decide. conversations.user_id
  // defaults to auth.uid() (migration 0011) and the INSERT policy's WITH CHECK
  // enforces it. This route cannot create a row belonging to anyone else even
  // if it tried to.
  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert({ title: 'Coaching' })
    .select('id, messages')
    .single();
  if (createError) throw codedError('storage_unavailable', 'Could not start a conversation.');
  return created;
}

/**
 * POST /api/chat
 *
 * The Anthropic API is stateless: it has no memory of previous calls. Every
 * request therefore carries the freshly-built system prompt plus the replayed
 * conversation history. History is trimmed to a bounded window so that a
 * months-long conversation cannot grow the request payload - or the token
 * bill - without limit.
 */
chatRouter.post('/', async (req, res, next) => {
  try {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) {
      // A message rejected for length is the one validation failure a person
      // can actually act on, so it gets its own sentence with the numbers in
      // it. "Invalid request." for a long paste tells them nothing and reads
      // as the app being broken - which is exactly how it was reported.
      const length = typeof req.body?.message === 'string' ? req.body.message.length : null;
      if (length !== null && length > config.chat.maxMessageLength) {
        throw codedError(
          'message_too_long',
          `That message is ${length.toLocaleString()} characters and the limit is ${config.chat.maxMessageLength.toLocaleString()}. Send it in a couple of parts and the coach will keep the context.`,
          { limit: config.chat.maxMessageLength, length }
        );
      }
      throw codedError('invalid_request', 'Invalid request.', { fields: parsed.error.flatten().fieldErrors });
    }
    const { message, conversationId } = parsed.data;

    /**
     * ── LOAD, THEN GATE, THEN CREATE ────────────────────────────────────
     *
     * loadOrCreateConversation used to run in this parallel batch, which meant
     * a refused request still left a conversation row behind: the adult gate
     * turned somebody away and the database had already recorded them starting
     * a conversation. Harmless in itself, and exactly the wrong shape - a
     * request we are about to refuse should not have written anything.
     *
     * So the two reads the gates need happen together, the gates run, and the
     * one call with a side effect happens after they pass. It costs one extra
     * round trip on a request whose model call takes tens of seconds.
     *
     * The subscription read is skipped entirely when the paywall is off, which
     * is the state this ships in.
     */
    const [context, subscription, guardianConsent] = await Promise.all([
      loadCoachingContext(req.supabase),
      config.paywall.active ? loadSubscription(req.supabase) : Promise.resolve(null),
      // Skipped entirely while minors are disabled, like the subscription read
      // above: it answers a question the gate will not ask.
      config.minors.enabled ? loadGuardianConsent(req.supabase) : Promise.resolve(false),
    ]);

    /**
     * THE ADULT GATE, ENFORCED IN THE API RATHER THAN IN THE BROWSER.
     *
     * The sign-up form asks for a date of birth and refuses below 18, which is
     * a courtesy. This is the control. The browser is not ours, and somebody
     * who wants past a client-side check has to open one tab.
     *
     * It sits here rather than in middleware because the profile has already
     * been loaded a few lines up - a second query to answer a question we
     * already have the data for would be a cost on every message for nothing.
     *
     * Fails closed on a missing date. The intake form requires one, so its
     * absence means somebody went around the form.
     */
    const adult = adultGateDecision(context.profile, {
      minorsEnabled: config.minors.enabled,
      guardianConsent,
    });
    if (!adult.allowed) {
      // Never log the date or the computed age. The reason code is what makes
      // this diagnosable, and it is all anybody needs.
      logger.warn('chat.refused_not_adult', { userId: req.user.id, reason: adult.reason });
      throw codedError(
        'age_restricted',
        refusalMessage(adult.reason),
        { code: `adult_gate_${adult.reason}` }
      );
    }

    /**
     * THE PAYWALL, AFTER THE ADULT GATE AND NEVER BEFORE IT - AND NEVER FOR
     * A MINOR AT ALL.
     *
     * The order is not stylistic. If somebody under 18 reaches this route,
     * the answer is that we do not coach them - not an invitation to pay. A
     * paywall checked first would show a minor a subscribe button, which is
     * the one response this product must never give them.
     *
     * ORDERING USED TO BE ENOUGH AND NO LONGER IS. It protected minors only
     * because every minor was refused, so none of them ever reached this line.
     * A 15-year-old with a guardian's consent is now ALLOWED, walks straight
     * past a gate that said yes, and would arrive here - where the next thing
     * that happens is a subscribe button in front of a child. The gate having
     * a new outcome quietly removed a property that the gate itself was
     * providing.
     *
     * So it is explicit: `!adult.isMinor`. A consented minor is coached and is
     * never asked to pay. That is a decision with a cost, and it is the right
     * way round - taking payment details from a minor is a worse problem than
     * giving away the coaching.
     *
     * `config.paywall.active` is a deliberate switch, not a consequence of
     * Stripe keys existing (see lib/env.js). While it is off, every branch
     * below is dead and the coaching is free, which is what the FAQ says.
     *
     * entitlement() decides. The rule lives there and nowhere else: past_due
     * still counts, a canceled subscription inside its paid period still
     * counts, and this route does not get an opinion about any of it.
     */
    if (config.paywall.active && !adult.isMinor && requiresSubscription(PAID_FEATURE)) {
      const decision = entitlement(subscription, {
        // Loaded with the profile that the adult gate already used, so this
        // costs no extra query.
        freeForever: context.profile?.free_forever === true,
      });
      if (!decision.entitled) {
        logger.info('chat.refused_no_subscription', { userId: req.user.id, reason: decision.reason });
        throw codedError(
          'payment_required',
          decision.reason === 'lapsed'
            ? 'Your subscription has ended, so the coaching conversations are paused. Everything else - your logs, your charts, your program - is still here and still free. You can restart the subscription from your account page.'
            : 'Coaching conversations are part of the subscription. Your logs, charts, program and the exercise library stay free. You can subscribe from your account page.',
          { reason: decision.reason }
        );
      }
    }

    const conversation = await loadOrCreateConversation(req.supabase, conversationId);

    const history = Array.isArray(conversation.messages) ? conversation.messages : [];
    const window = history.slice(-config.chat.historyWindow);

    const apiMessages = [
      ...window.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: message },
    ];

    // Blocks, not a string: the first carries the cache breakpoint. See
    // buildSystemBlocks() for why the breakpoint sits where it does.
    const system = buildSystemBlocks(context);
    /**
     * ── ONE RETRY, AND ONLY FOR THE CASE WHERE IT CAN HELP ────────────────
     *
     * A genuinely empty completion is usually transient, and telling somebody
     * to press send again is asking them to do by hand what we can do in
     * 900ms. A refusal is not transient - the same words refuse again - and
     * retrying one would double the cost of every refusal for no benefit, so
     * `outcome.retry` decides rather than a loop counter.
     *
     * Exactly one retry. Two is a pattern that turns a bad afternoon at the
     * API into a bill.
     */
    // The SDK throwing is a different failure from the SDK returning
    // something unusable, and until now it had no handling at all: it became a
    // generic 500, indistinguishable from a bug of ours.
    const ask = async () => {
      try {
        return await createCoachReply(system, apiMessages);
      } catch (err) {
        logger.error('coach.call_failed', {
          userId: req.user.id,
          name: err?.name,
          upstreamStatus: err?.status ?? null,
        });
        throw coachApiError(err);
      }
    };

    /*
     * Timed because the athlete complained about the wait before anything
     * measured it, and because the client gives up at 150 seconds. A reply of
     * 6,405 output tokens - one is already in production - takes most of that
     * budget, so how close this runs to the ceiling is not a curiosity.
     */
    const startedAt = Date.now();
    let reply = await ask();
    let outcome = describeCoachReply(reply);

    if (!outcome.ok && outcome.retry) {
      logger.warn('coach.reply_unusable', { userId: req.user.id, attempt: 1, ...outcome.log });
      reply = await ask();
      outcome = describeCoachReply(reply);
    }

    if (!outcome.ok) {
      logger.error('coach.reply_unusable', { userId: req.user.id, attempt: 2, ...outcome.log });
      throw coachError(outcome);
    }

    if (outcome.truncated) {
      logger.warn('coach.reply_truncated', { userId: req.user.id, ...outcome.log });
    }

    // Split the machine-readable copy of the program off the prose before
    // anything else touches the text. The athlete never sees the block, and it
    // is stripped whether or not it parsed - a visible chunk of JSON is a
    // worse failure than a missing record.
    const { reply: extracted, program: emitted, problem } = extractProgramBlock(reply.text);

    /*
     * Run over the ALREADY-STRIPPED prose, not the raw reply. Order matters
     * only in that each extractor must see text the other has finished with;
     * running both against reply.text would leave whichever ran second putting
     * the first one's tags back into what the athlete reads.
     */
    const {
      reply: prose,
      intention,
      problem: intentionProblem,
    } = extractIntentionBlock(extracted);

    // Appended after the blocks are stripped, so the notice is never mistaken
    // for part of the program and never lands inside the JSON.
    const replyText = outcome.truncated ? `${prose}${TRUNCATION_NOTICE}` : prose;
    if (problem) logger.warn('program.block_unusable', { userId: req.user.id, problem });
    if (intentionProblem) {
      // The reason and never the content: the obstacle is the athlete's own
      // words about what stops them, and that is health data.
      logger.warn('intention.block_unusable', { userId: req.user.id, problem: intentionProblem });
    }

    /**
     * THE GATE IS RE-CHECKED HERE, IN CODE.
     *
     * The prompt tells the coach not to emit a program while clearance is
     * pending, and across the adversarial suite it obeys. That is not the same
     * as it being impossible, and the consequence of getting it wrong is
     * different in kind from a bad sentence: a stored program is a document
     * the athlete can open tomorrow and follow, long after the conversation
     * that produced it has scrolled away.
     *
     * So the instruction is the first line of defense and this is the second.
     * Same reasoning as computing the gate rather than asking the model to
     * apply it - if it matters, it does not live in the prompt alone.
     */
    const gated = needsMedicalClearance(context.profile);

    /**
     * ── ONE FOLLOW-UP CALL WHEN A SESSION ARRIVES WITH NO BLOCK ───────────
     *
     * An athlete was handed a full week of training and the Program page did
     * not change. The prompt has always asked for the block; asking was not
     * enough, for the same reason asking was not enough for the clearance
     * gate. A model that has just written four hundred words of coaching has
     * spent its attention on the coaching, and the machine-readable copy is
     * the easiest thing in the reply to drop.
     *
     * So when the prose plainly prescribes training and no usable block came
     * with it, the block is asked for once more, on its own. See
     * lib/programRepair.js for why this is a transcription rather than a
     * re-plan, and why it never runs twice.
     *
     * THE THREE CONDITIONS ARE EACH LOAD-BEARING:
     *
     *   !program              - a block that already parsed is never second-
     *                           guessed; the repair exists for its absence.
     *   !gated                - an athlete awaiting medical clearance gets no
     *                           stored program, so there is nothing to repair
     *                           and no reason to spend a call finding out.
     *   prescribesTraining    - most turns are conversation. Repairing those
     *                           would double the cost of the product to
     *                           produce NONE.
     *
     * And the deadline, because the repair must never cost somebody the reply
     * it is bookkeeping for.
     */
    let repairOutcome = null;
    let repairUsage = null;
    let repairModel = null;
    let program = emitted;

    const repairable = !emitted && !gated && prescribesTraining(prose);
    const roomForRepair = Date.now() - startedAt < config.chat.programRepairDeadlineMs;

    if (repairable && roomForRepair) {
      const repair = await repairProgramBlock({
        callModel: createCoachReply,
        system,
        messages: apiMessages,
        reply: prose,
      });
      program = repair.program;
      repairOutcome = repair.outcome;
      repairUsage = repair.usage;
      repairModel = repair.model;
    } else if (repairable) {
      repairOutcome = 'skipped_slow';
      logger.warn('program.repair_skipped', {
        userId: req.user.id,
        elapsedMs: Date.now() - startedAt,
      });
    }

    /**
     * THE GATE IS RE-CHECKED HERE, IN CODE.
     *
     * (The repair above cannot reach a gated athlete - it does not run for
     * one - but this is still computed from `gated` rather than from that
     * fact, because a guard that depends on another guard having been correct
     * is not a second line of defense.)
     */
    const storable = program && !gated ? program : null;
    if (program && !storable) {
      logger.warn('program.refused_while_gated', { userId: req.user.id });
    }

    /*
     * ── WHY THE ABSENCE OF A BLOCK IS NOW A RECORDED FACT ─────────────────
     *
     * workout_programs is empty. Not sparse - empty, across every user, for
     * the life of the product, while the coach has plainly been writing
     * programs in prose. An athlete then said the coach had forgotten which
     * week he was on, which is exactly what that emptiness predicts: the
     * program record is the only durable memory in the system, the
     * conversation window holds 30 messages of a 108-message conversation,
     * and everything else is gone by definition.
     *
     * Three explanations fit and they need completely different fixes: the
     * model never emitted a block, it emitted one that failed validation, or
     * the insert was refused. Only the third left any trace, and that trace
     * was a `logger.warn` in an ephemeral serverless log. The other two were
     * silent - and the grants and policies on workout_programs check out, so
     * the third is the one that is ruled out.
     *
     * A single word in the completion line separates them. It is not the fix;
     * it is the thing that says which fix to build.
     */
    const emittedOutcome = emitted ? (storable ? 'storable' : 'gated') : problem ? 'unusable' : 'absent';
    /*
     * The repair's own result replaces the emitted one when it ran, so the
     * completion line still carries exactly one word for what happened to the
     * program - and 'absent' now means what it says: no block, and no session
     * that wanted one. Every other path is named.
     */
    const programOutcome = repairOutcome
      ? repairOutcome === 'repaired'
        ? 'repaired'
        : `repair_${repairOutcome}`
      : emittedOutcome;

    /**
     * ── THE COACH CANNOT KNOW WHETHER THE PROGRAM WAS SAVED ───────────────
     *
     * On 2026-08-30 the coach told an athlete it had added his program to the
     * Program page. It had - the first program this product has ever stored.
     * But the coach had no way to know that. It writes a block into its reply
     * and the block leaves its hands; whether the row landed depends on the
     * clearance gate, on the schema accepting it, and on a database write, all
     * of which happen after the model has finished speaking.
     *
     * It was right by luck. Had the write been refused, or the block failed
     * validation, or the athlete been behind the medical gate, the coach would
     * have said exactly the same sentence. The athlete noticed the tension and
     * the coach, to its credit, said it might be wrong and to report it - but
     * a system whose remedy is "the model warns you it might be lying" has put
     * the model somewhere it should not be.
     *
     * So the route reports what actually happened, and the interface says it.
     * The app knows; the coach does not have to guess.
     *
     * Week and phase only. Not the movements, not the weights - the Program
     * page fetches those itself under the athlete's own token, and a chat
     * response is not the place to widen what travels.
     */
    let savedProgram = null;

    const now = new Date().toISOString();
    const updated = [
      ...history,
      { role: 'user', content: message, at: now },
      { role: 'assistant', content: replyText, at: now },
    ];

    const { error: saveError } = await req.supabase
      .from('conversations')
      .update({ messages: updated })
      .eq('id', conversation.id);
    if (saveError) throw codedError('reply_not_saved', 'Reply generated but could not be saved.');

    /*
     * Both calls, when there were two. The repair is cheap - the system prompt
     * is unchanged, so it reads the cache rather than writing it, and the
     * output is one block of JSON - but "cheap" is a claim, and a claim about
     * spending belongs in the number rather than in a comment. Folding it in
     * here means the usage row, the completion line and the monthly total all
     * say the same thing.
     */
    const replyCost = costInMicrodollars(reply.usage, reply.model);
    const repairCost = repairUsage ? costInMicrodollars(repairUsage, repairModel ?? reply.model) : null;
    const costMicrodollars =
      replyCost === null && repairCost === null ? null : (replyCost ?? 0) + (repairCost ?? 0);

    // Token counts and ids only. The message bodies are not logged: they
    // routinely contain the athlete's injury history.
    /*
     * ── WHY THE PROMPT'S OWN SIZES ARE LOGGED ─────────────────────────────
     *
     * The first unit-economics measurement, on 2026-08-30, put uncached input
     * at 46% of what a reply costs - the single largest component, ahead of
     * the output. It could not be accounted for. The cached block measures
     * ~12,300 tokens and matches `cache_creation_input_tokens` exactly; the
     * athlete-state block measures under 2,000 even loaded with five sessions,
     * sixty logs and an active program; the exercise library is four rows. Yet
     * production reports 11,000-13,000 UNCACHED input tokens on turn one of a
     * conversation, when the only uncached content is that block plus a single
     * user message.
     *
     * Roughly eight thousand tokens a reply are therefore unexplained, and
     * they are the most expensive thing in the product. Every serious defect
     * in this project has been found by measuring where the fact lives rather
     * than reasoning about it from a file, so these are integers taken from
     * the exact strings that were sent.
     *
     * Character counts, never content. The athlete-state block is dense with
     * health information - injuries, restrictions, GLP-1 status, every logged
     * set - and its LENGTH is a number about our prompt, not about them. The
     * message bodies remain unlogged for the reason the comment below already
     * gave.
     */
    logger.info('chat.completed', {
      userId: req.user.id,
      conversationId: conversation.id,
      model: reply.model,
      inputTokens: reply.usage?.input_tokens,
      outputTokens: reply.usage?.output_tokens,
      cacheReadTokens: reply.usage?.cache_read_input_tokens,
      cacheWriteTokens: reply.usage?.cache_creation_input_tokens,
      costMicrodollars,
      historyReplayed: window.length,
      durationMs: Date.now() - startedAt,
      programOutcome,
      repairCostMicrodollars: repairCost,
      historyDropped: Math.max(0, history.length - window.length),
      cachedBlockChars: system[0]?.text?.length ?? 0,
      athleteStateChars: system[1]?.text?.length ?? 0,
      messagesChars: apiMessages.reduce((n, m) => n + (m.content?.length ?? 0), 0),
    });

    // ── AWAITED, AND THAT IS A CORRECTION ────────────────────────────────
    //
    // These two writes used to be fired and not awaited, on the reasoning that
    // an athlete must never lose a coaching reply they already received
    // because a bookkeeping insert failed. The reasoning is right; the
    // mechanism was wrong for this runtime.
    //
    // A serverless function is frozen the moment its response is sent. A
    // promise still in flight does not get to finish - it dies mid-socket,
    // which is why production logs showed `usage.record_failed` with
    // "TypeError: fetch failed" rather than any database error. The metrics
    // row was not failing to insert; it was never being attempted.
    //
    // Worse, the same pattern held the PROGRAM save, which is not bookkeeping.
    // A program that silently does not persist is a coaching reply describing
    // a week of training that the athlete cannot open tomorrow.
    //
    // So both are awaited, and both are wrapped so that a failure is logged
    // and swallowed. The property that mattered - a failed write never costs
    // somebody their reply - is kept by the try/catch, not by the absence of
    // an await. The cost is a few milliseconds before the response.
    if (storable) {
      /**
       * VISIBILITY, NOT ENFORCEMENT.
       *
       * The phase directive tells the coach when linear progression is spent.
       * Unlike the clearance gate, this is NOT re-checked and overridden here,
       * and the difference is what a wrong answer costs: a gated athlete who
       * receives a program is a safety failure, while an athlete on the wrong
       * phase gets a worse program and stalls. That is bad coaching, not
       * danger, and there are legitimate reasons to hold somebody on linear
       * progression another two weeks - a missed week, a bad sleep run, a move.
       *
       * Overriding the stored phase would also make the record disagree with
       * the prose the athlete just read, which is worse than either being
       * wrong on its own. So it is logged instead: if this fires regularly the
       * directive is not landing and the prompt needs work, and that is a fact
       * worth having rather than a silence.
       */
      try {
        const recommended = recommendPhase({
          profile: context.profile,
          prescriptions: prescribeAll({
            // Reversed, exactly as buildSystemBlocks does it. recentLogs
            // arrives newest-first because that is what the display wants;
            // the progression engine walks history forwards and counts a
            // reset as a DROP in working weight, so handing it the reverse
            // makes every reset look like an increase. This was wrong when
            // first written and the phase test caught it.
            logs: [...context.recentLogs].reverse(),
            units: context.profile?.units ?? 'lb',
            smallestPlatePair: context.profile?.smallest_plate_pair ?? null,
          }),
          currentPhase: context.activeProgram?.phase ?? null,
        });
        if (recommended.changed && storable.phase !== recommended.phase) {
          logger.info('program.phase_disagreed', {
            userId: req.user.id,
            stored: storable.phase,
            recommended: recommended.phase,
            basis: recommended.basis,
          });
        }
      } catch {
        // Bookkeeping. It must never be the reason a program fails to save.
      }

      try {
        // One active program at a time. Superseding rather than deleting: the
        // old block is what the athlete was training on last week, and a
        // progress view that cannot see it cannot explain anything.
        await req.supabase.from('workout_programs').update({ is_active: false }).eq('is_active', true);
        const { error } = await req.supabase.from('workout_programs').insert({
          user_id: req.user.id,
          week_number: storable.week,
          phase: storable.phase,
          program_data: storable,
          is_active: true,
        });
        if (error) logger.warn('program.save_failed', { userId: req.user.id, message: error.message });
        else {
          logger.info('program.saved', { userId: req.user.id, phase: storable.phase, week: storable.week });
          savedProgram = { week: storable.week, phase: storable.phase, days: storable.days.length };
        }
      } catch (err) {
        logger.warn('program.save_failed', { userId: req.user.id, message: err.message });
      }
    }

    /*
     * ── THE PLAN, RECORDED THE SAME WAY AND GATED THE SAME WAY ────────────
     *
     * Re-checked in code rather than trusted to the prompt, for the reason the
     * program save gives above: the instruction is the first line of defense
     * and this is the second. An athlete waiting on a doctor should not have an
     * obstacle recorded and quoted back at them, because the obstacle at that
     * moment is very likely the injury they are waiting on.
     *
     * The write is a profile UPDATE and can be refused by the consent trigger:
     * these are health columns, and an athlete who never granted health-data
     * consent has no business having their obstacle stored. That refusal is
     * correct and is logged as a warning rather than surfaced - the coaching
     * conversation already happened and was useful, and telling somebody their
     * plan could not be saved because of a consent setting is a sentence for
     * the account page, not for the middle of a training discussion.
     */
    if (intention && !needsMedicalClearance(context.profile)) {
      try {
        const { error } = await req.supabase
          .from('user_profile')
          .update({
            training_obstacle: intention.obstacle,
            training_if_then: intention.plan,
          })
          .eq('user_id', req.user.id);
        // Never the message: a constraint violation can quote the value, and
        // the value is health data.
        if (error) logger.warn('intention.save_failed', { userId: req.user.id, cause: error.code });
        else logger.info('intention.saved', { userId: req.user.id });
      } catch {
        logger.warn('intention.save_failed', { userId: req.user.id, cause: 'threw' });
      }
    } else if (intention) {
      logger.warn('intention.refused_while_gated', { userId: req.user.id });
    }

    try {
      const { error } = await req.supabase.from('usage_events').insert({
        user_id: req.user.id,
        conversation_id: conversation.id,
        model: reply.model,
        input_tokens: reply.usage?.input_tokens ?? 0,
        output_tokens: reply.usage?.output_tokens ?? 0,
        cache_read_tokens: reply.usage?.cache_read_input_tokens ?? 0,
        cache_write_tokens: reply.usage?.cache_creation_input_tokens ?? 0,
        cost_microdollars: costMicrodollars,
      });
      if (error) logger.warn('usage.record_failed', { userId: req.user.id, message: error.message });
    } catch (err) {
      logger.warn('usage.record_failed', { userId: req.user.id, message: err.message });
    }

    res.json({
      conversationId: conversation.id,
      reply: replyText,
      messages: updated.slice(-config.chat.historyWindow),
      // null unless a row actually landed. Never "probably".
      savedProgram,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/chat/conversation - rehydrate the UI on page load. */
chatRouter.get('/conversation', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('conversations')
      .select('id, messages, updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw codedError('storage_unavailable', 'Could not load the conversation.');

    // The limit travels with the conversation so the client never hardcodes
    // its own copy. CHAT_MAX_MESSAGE_LENGTH is a deploy variable; a duplicated
    // constant in the frontend would drift the moment anyone tuned it, and the
    // drift would show up as the same silent rejection this fixes.
    res.json({
      conversation: data ?? null,
      limits: { maxMessageLength: config.chat.maxMessageLength },
    });
  } catch (err) {
    next(err);
  }
});
