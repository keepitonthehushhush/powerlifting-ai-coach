/**
 * A stand-in for a PostgREST client, only as deep as the routes under test go.
 *
 * ── WHY A FAKE AND NOT A DATABASE ──────────────────────────────────────────
 *
 * The properties these tests are about - a credential never reaching a URL, a
 * cursor not advancing past unread pages, a delete narrowed to one key - are
 * properties of the CALLS the route makes. Recording the calls is what lets a
 * test assert them. A real database would prove the writes land and would say
 * nothing about the shape of the request that made them, which is the half
 * that goes wrong silently.
 *
 * RLS is the other half and it is not faked here. It is proved where it is
 * enforced: in SQL, as the `authenticated` role, against a real database.
 */
export function fakeSupabase({ rpc = {}, rows = {}, onCall = () => {} } = {}) {
  const calls = [];

  const record = (entry) => {
    calls.push(entry);
    onCall(entry);
    return entry;
  };

  const table = (name) => {
    const filters = {};
    const builder = {
      _op: null,
      _payload: null,
      select() { return builder; },
      eq(column, value) { filters[column] = value; return builder; },
      order() { return builder; },
      limit() { return builder; },
      insert(payload) {
        builder._op = 'insert';
        builder._payload = payload;
        record({ kind: 'insert', table: name, payload });
        return builder;
      },
      delete(options) {
        builder._op = 'delete';
        record({ kind: 'delete', table: name, options, filters });
        return builder;
      },
      // The terminals. Each resolves whatever the fixture provides for this
      // table, and defaults are deliberately boring rather than clever.
      async single() { return resolve(); },
      async maybeSingle() { return resolve(); },
      then(onFulfilled, onRejected) { return resolve().then(onFulfilled, onRejected); },
    };

    async function resolve() {
      const fixture = rows[name];
      const value = typeof fixture === 'function'
        ? await fixture({ op: builder._op, payload: builder._payload, filters })
        : fixture;
      return value ?? { data: null, error: null };
    }

    return builder;
  };

  return {
    calls,
    from: (name) => table(name),
    async rpc(name, params) {
      record({ kind: 'rpc', name, params });
      const fixture = rpc[name];
      const value = typeof fixture === 'function' ? await fixture(params) : fixture;
      return value ?? { data: null, error: null };
    },
  };
}
