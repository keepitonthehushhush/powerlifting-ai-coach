/**
 * Shown when the app cannot start because of its configuration - either a
 * required variable is absent, or one is present and certainly wrong.
 *
 * Both are rendered here rather than by two components, because they are the
 * same event from the operator's side: the deployment is misconfigured, here
 * is what to fix, rebuild afterwards. `missing` names variables; `problems`
 * carries sentences, because "this is set to the wrong thing" needs a reason
 * and a variable name alone would not give one.
 *
 * Deliberately plain: no i18n, no shared components, no imports beyond React.
 * This screen has to render in exactly the situation where the rest of the
 * application cannot start, so it must not depend on anything that could
 * itself be broken.
 */
export function ConfigError({ missing = [], problems = [] }) {
  const isMissing = missing.length > 0;

  return (
    <div className="centered">
      <div className="card auth-card">
        <h1 className="brand">Coach</h1>
        <p className="error">
          <strong>
            {isMissing
              ? 'This deployment is missing its configuration.'
              : 'This deployment is configured incorrectly.'}
          </strong>
        </p>

        {isMissing && (
          <>
            <p className="muted small">
              The app was built without the following environment{' '}
              {missing.length === 1 ? 'variable' : 'variables'}:
            </p>
            <ul className="config-missing">
              {missing.map((key) => (
                <li key={key}>
                  <code>{key}</code>
                </li>
              ))}
            </ul>
          </>
        )}

        {problems.length > 0 && (
          <ul className="config-missing">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <p className="muted small">
          Fix {isMissing && missing.length === 1 ? 'it' : 'that'} in the hosting provider&rsquo;s
          environment settings, then <strong>trigger a new build</strong>. Values prefixed{' '}
          <code>VITE_</code> are compiled into the bundle at build time, so changing them does not
          affect a build that has already happened.
        </p>
        <p className="fineprint">
          If you are a visitor rather than the operator, nothing is wrong on your end &mdash; please
          check back shortly.
        </p>
      </div>
    </div>
  );
}
