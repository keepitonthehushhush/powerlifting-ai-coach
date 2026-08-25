/**
 * Shown when the app was built without its required configuration.
 *
 * Deliberately plain: no i18n, no shared components, no imports beyond React.
 * This screen has to render in exactly the situation where the rest of the
 * application cannot start, so it must not depend on anything that could
 * itself be broken.
 */
export function ConfigError({ missing }) {
  return (
    <div className="centered">
      <div className="card auth-card">
        <h1 className="brand">Coach</h1>
        <p className="error">
          <strong>This deployment is missing its configuration.</strong>
        </p>
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
        <p className="muted small">
          Set {missing.length === 1 ? 'it' : 'them'} in the hosting provider&rsquo;s environment
          settings, then <strong>trigger a new build</strong>. Values prefixed <code>VITE_</code>{' '}
          are compiled into the bundle at build time, so changing them does not affect a build that
          has already happened.
        </p>
        <p className="fineprint">
          If you are a visitor rather than the operator, nothing is wrong on your end &mdash; please
          check back shortly.
        </p>
      </div>
    </div>
  );
}
