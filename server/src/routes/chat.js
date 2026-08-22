import { Router } from 'express';
import { z } from 'zod';
import { createCoachReply } from '../lib/anthropic.js';
import { buildSystemPrompt } from '../prompts/systemPrompt.js';
import { HttpError } from '../middleware/errorHandler.js';
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
    supabase.from('progress_logs').select('lift, weight, reps, rpe, date').order('date', { ascending: false }).limit(60),
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

    const system = buildSystemPrompt(context);
    const reply = await createCoachReply(system, apiMessages);

    if (!reply.text) throw new HttpError(502, 'The coach returned an empty response. Please try again.');

    const now = new Date().toISOString();
    const updated = [
      ...history,
      { role: 'user', content: message, at: now },
      { role: 'assistant', content: reply.text, at: now },
    ];

    const { error: saveError } = await req.supabase
      .from('conversations')
      .update({ messages: updated })
      .eq('id', conversation.id);
    if (saveError) throw new HttpError(502, 'Reply generated but could not be saved.');

    // Token counts and ids only. The message bodies are not logged: they
    // routinely contain the athlete's injury history.
    logger.info('chat.completed', {
      userId: req.user.id,
      conversationId: conversation.id,
      model: reply.model,
      inputTokens: reply.usage?.input_tokens,
      outputTokens: reply.usage?.output_tokens,
      historyReplayed: window.length,
    });

    res.json({
      conversationId: conversation.id,
      reply: reply.text,
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
    res.json({ conversation: data ?? null });
  } catch (err) {
    next(err);
  }
});
