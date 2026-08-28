import { Router } from 'express';
import { z } from 'zod';
import { createCoachReply } from '../lib/anthropic.js';
import { costInMicrodollars } from '../lib/pricing.js';
import { extractProgramBlock } from '../lib/programBlock.js';
import { needsMedicalClearance } from '../prompts/systemPrompt.js';
import { adultGateDecision, MINIMUM_AGE } from '../lib/ageGate.js';
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
    const [context, subscription] = await Promise.all([
      loadCoachingContext(req.supabase),
      config.paywall.active ? loadSubscription(req.supabase) : Promise.resolve(null),
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
    const adult = adultGateDecision(context.profile);
    if (!adult.allowed) {
      // Never log the date or the computed age. The reason code is what makes
      // this diagnosable, and it is all anybody needs.
      logger.warn('chat.refused_not_adult', { userId: req.user.id, reason: adult.reason });
      throw codedError(
        'age_restricted',
        adult.reason === 'too_young'
          ? `Coach Diaz is only for people aged ${MINIMUM_AGE} and over. We have not built a way for a parent or guardian to consent on a younger person's behalf, and until we have, we are not going to coach anyone under ${MINIMUM_AGE}. Nothing you have entered has been deleted.`
          : 'Please add your date of birth on the profile page before talking to Coach.',
        { code: `adult_gate_${adult.reason}` }
      );
    }

    /**
     * THE PAYWALL, AFTER THE ADULT GATE AND NEVER BEFORE IT.
     *
     * The order is not stylistic. If somebody under 18 reaches this route,
     * the answer is that we do not coach them - not an invitation to pay. A
     * paywall checked first would show a minor a subscribe button, which is
     * the one response this product must never give them.
     *
     * `config.paywall.active` is a deliberate switch, not a consequence of
     * Stripe keys existing (see lib/env.js). While it is off, every branch
     * below is dead and the coaching is free, which is what the FAQ says.
     *
     * entitlement() decides. The rule lives there and nowhere else: past_due
     * still counts, a cancelled subscription inside its paid period still
     * counts, and this route does not get an opinion about any of it.
     */
    if (config.paywall.active && requiresSubscription(PAID_FEATURE)) {
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
            ? 'Your subscription has ended, so the coaching conversations are paused. Everything else - your logs, your charts, your programme - is still here and still free. You can restart the subscription from your account page.'
            : 'Coaching conversations are part of the subscription. Your logs, charts, programme and the exercise library stay free. You can subscribe from your account page.',
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
    const { reply: extracted, program, problem } = extractProgramBlock(reply.text);

    // Appended after the block is stripped, so the notice is never mistaken
    // for part of the program and never lands inside the JSON.
    const replyText = outcome.truncated ? `${extracted}${TRUNCATION_NOTICE}` : extracted;
    if (problem) logger.warn('program.block_unusable', { userId: req.user.id, problem });

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
     * So the instruction is the first line of defence and this is the second.
     * Same reasoning as computing the gate rather than asking the model to
     * apply it - if it matters, it does not live in the prompt alone.
     */
    const storable = program && !needsMedicalClearance(context.profile) ? program : null;
    if (program && !storable) {
      logger.warn('program.refused_while_gated', { userId: req.user.id });
    }

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

    const costMicrodollars = costInMicrodollars(reply.usage, reply.model);

    // Token counts and ids only. The message bodies are not logged: they
    // routinely contain the athlete's injury history.
    logger.info('chat.completed', {
      userId: req.user.id,
      conversationId: conversation.id,
      model: reply.model,
      inputTokens: reply.usage?.input_tokens,
      outputTokens: reply.usage?.output_tokens,
      costMicrodollars,
      historyReplayed: window.length,
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
       * phase gets a worse programme and stalls. That is bad coaching, not
       * danger, and there are legitimate reasons to hold somebody on linear
       * progression another fortnight - a missed week, a bad sleep run, a move.
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
        else logger.info('program.saved', { userId: req.user.id, phase: storable.phase, week: storable.week });
      } catch (err) {
        logger.warn('program.save_failed', { userId: req.user.id, message: err.message });
      }
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
