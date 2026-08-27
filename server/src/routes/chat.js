import { Router } from 'express';
import { z } from 'zod';
import { createCoachReply } from '../lib/anthropic.js';
import { costInMicrodollars } from '../lib/pricing.js';
import { extractProgramBlock } from '../lib/programBlock.js';
import { needsMedicalClearance } from '../prompts/systemPrompt.js';
import { buildSystemBlocks } from '../prompts/systemPrompt.js';
import { HttpError } from '../lib/httpError.js';
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
    if (result.error) throw new HttpError(502, 'Could not load your training data.', { code: result.error.code });
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
    if (error) throw new HttpError(502, 'Could not load the conversation.');
    // A conversation belonging to somebody else is invisible to this client
    // thanks to RLS, so "not found" and "not yours" are indistinguishable here
    // by design - there is no way to probe for another user's conversation ids.
    if (!data) throw new HttpError(404, 'Conversation not found.');
    return data;
  }

  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('id, messages')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw new HttpError(502, 'Could not load the conversation.');
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
  if (createError) throw new HttpError(502, 'Could not start a conversation.');
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
        throw new HttpError(
          400,
          `That message is ${length.toLocaleString()} characters and the limit is ${config.chat.maxMessageLength.toLocaleString()}. Send it in a couple of parts and the coach will keep the context.`,
          { code: 'message_too_long', limit: config.chat.maxMessageLength, length }
        );
      }
      throw new HttpError(400, 'Invalid request.', parsed.error.flatten().fieldErrors);
    }
    const { message, conversationId } = parsed.data;

    const [context, conversation] = await Promise.all([
      loadCoachingContext(req.supabase),
      loadOrCreateConversation(req.supabase, conversationId),
    ]);

    const history = Array.isArray(conversation.messages) ? conversation.messages : [];
    const window = history.slice(-config.chat.historyWindow);

    const apiMessages = [
      ...window.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: message },
    ];

    // Blocks, not a string: the first carries the cache breakpoint. See
    // buildSystemBlocks() for why the breakpoint sits where it does.
    const system = buildSystemBlocks(context);
    const reply = await createCoachReply(system, apiMessages);

    if (!reply.text) throw new HttpError(502, 'The coach returned an empty response. Please try again.');

    // Split the machine-readable copy of the program off the prose before
    // anything else touches the text. The athlete never sees the block, and it
    // is stripped whether or not it parsed - a visible chunk of JSON is a
    // worse failure than a missing record.
    const { reply: replyText, program, problem } = extractProgramBlock(reply.text);
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
    if (saveError) throw new HttpError(502, 'Reply generated but could not be saved.');

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

    // Recorded AFTER the reply is saved and deliberately not awaited into the
    // response path. This is a metrics row: an athlete must never lose a
    // coaching reply they already received because a bookkeeping insert
    // failed. A failure here is logged and dropped, which is the honest
    // trade - a gap in cost data is a worse report, not a worse product.
    if (storable) {
      // One active program at a time. Superseding rather than deleting: the
      // old block is what the athlete was training on last week, and a
      // progress view that cannot see it cannot explain anything.
      req.supabase
        .from('workout_programs')
        .update({ is_active: false })
        .eq('is_active', true)
        .then(() =>
          req.supabase.from('workout_programs').insert({
            user_id: req.user.id,
            week_number: storable.week,
            phase: storable.phase,
            program_data: storable,
            is_active: true,
          })
        )
        .then(({ error } = {}) => {
          if (error) logger.warn('program.save_failed', { userId: req.user.id, message: error.message });
          else logger.info('program.saved', { userId: req.user.id, phase: storable.phase, week: storable.week });
        });
    }

    req.supabase
      .from('usage_events')
      .insert({
        user_id: req.user.id,
        conversation_id: conversation.id,
        model: reply.model,
        input_tokens: reply.usage?.input_tokens ?? 0,
        output_tokens: reply.usage?.output_tokens ?? 0,
        cache_read_tokens: reply.usage?.cache_read_input_tokens ?? 0,
        cache_write_tokens: reply.usage?.cache_creation_input_tokens ?? 0,
        cost_microdollars: costMicrodollars,
      })
      .then(({ error }) => {
        if (error) logger.warn('usage.record_failed', { userId: req.user.id, message: error.message });
      });

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
    if (error) throw new HttpError(502, 'Could not load the conversation.');

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
