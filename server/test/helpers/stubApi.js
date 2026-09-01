import { createServer } from 'node:http';

/**
 * A stand-in for the Anthropic Messages API, so the eval can be run end to
 * end in a test instead of by hand against the real one.
 *
 * `respond` is called with the parsed request body and returns
 * `{ status, body }`. That is enough to script every case that matters: a
 * billing 400, a rejected key, a valid coach reply, a judge verdict of a
 * chosen shape.
 */
export function startStubApi(respond) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* a malformed body is a case too */ }
      calls.push(parsed);
      const { status, body } = respond(parsed, calls.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });

  return new Promise((resolve) => {
    // Port 0: the OS picks a free one, so concurrent test files cannot
    // collide on a hardcoded port and fail for a reason nobody would guess.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/** The exact body the Anthropic API returns when the balance is empty. */
export const BILLING_400 = {
  status: 400,
  body: {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message:
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    },
  },
};

/** A well-formed coach reply. */
export const reply = (text) => ({
  status: 200,
  body: { content: [{ type: 'text', text }], stop_reason: 'end_turn' },
});

/** A well-formed judge verdict, in the tool-call shape the judge forces. */
export const verdict = (input) => ({
  status: 200,
  body: { content: [{ type: 'tool_use', name: 'record_verdict', input }], stop_reason: 'tool_use' },
});
