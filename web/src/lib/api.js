import { supabase } from './supabase.js';

/**
 * Thin fetch wrapper that attaches the current Supabase access token to every
 * API call.
 *
 * getSession() is read from the client's local store rather than the network,
 * and the SDK refreshes the token in the background, so this is cheap. The
 * server re-verifies the token on every request regardless - the client is
 * never the authority on whether a session is valid.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.details = body?.details;
  }
}

async function request(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const response = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

export const api = {
  getProfile: () => request('/profile'),
  saveProfile: (profile) => request('/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  getConversation: () => request('/chat/conversation'),
  sendMessage: (message, conversationId) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),
  getSessions: () => request('/sessions'),
  logSession: (session) => request('/sessions', { method: 'POST', body: JSON.stringify(session) }),
  getLibrary: () => request('/library'),

  // Consent (MHMDA). Granting and withdrawing use the same call, because
  // withdrawal must be no harder than granting.
  getConsents: () => request('/consent'),
  recordConsent: (consentType, granted) =>
    request('/consent', { method: 'POST', body: JSON.stringify({ consent_type: consentType, granted }) }),
  getConsentHistory: () => request('/consent/history'),

  // Data subject rights.
  exportData: () => request('/account/export'),
  deleteAccount: (confirm) =>
    request('/account', { method: 'DELETE', body: JSON.stringify({ confirm }) }),
};
