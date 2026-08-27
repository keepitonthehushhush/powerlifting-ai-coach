import { Component } from 'react';

/**
 * The last thing between a crash and a white page.
 *
 * ── WHY A WHITE PAGE IS THE WORST OUTCOME ─────────────────────────────────
 *
 * When a React render throws, React unmounts the whole tree. The person gets
 * a blank window with no error, no explanation and nothing to press - which is
 * indistinguishable from a dead internet connection, and which they will
 * reasonably read as "this app is broken and my data is probably gone". We
 * have already had one report of a permanent loading state and it took a log
 * dive to find out why; a blank page is that, with less information.
 *
 * ── WHAT IT IMPORTS, AND WHAT IT MUST NOT ─────────────────────────────────
 *
 * React, and nothing else. Same rule as ConfigError.jsx: this renders exactly
 * when something in the app has failed, so importing the i18n provider, the
 * API client or anything from the design system risks failing for the very
 * reason it is being shown. That is why the text below is hard-coded English
 * rather than going through t(), and why the styles are inline rather than
 * relying on a stylesheet that may not have loaded.
 *
 * ── IT SITS OUTSIDE THE PROVIDERS ─────────────────────────────────────────
 *
 * Mounted in main.jsx around <App />, not inside it. A boundary inside the
 * provider tree cannot catch a provider that throws on its first render, and
 * the providers are exactly where a bad token or a broken config surfaces.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error) {
    // Console only, and deliberately. There is no error tracker wired up, and
    // sending a stack trace anywhere would need to answer what health data
    // might be sitting in a component's props at the moment it threw. The
    // console is the developer's, on the developer's machine, and goes no
    // further.
    // eslint-disable-next-line no-console
    console.error('Coach Diaz crashed while rendering:', error);
  }

  render() {
    if (!this.state.crashed) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.25rem',
          background: '#0f0d1a',
          color: '#f5f3f7',
          font: '16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ width: 'min(460px, 100%)' }}>
          <h1 style={{ fontSize: '1.4rem', margin: '0 0 .5rem' }}>Something broke on our side</h1>
          <p style={{ color: '#a89ec4', margin: '0 0 1rem' }}>
            Not your connection, and not anything you did. Your profile, your programs and
            everything you have logged are in the database and are unaffected.
          </p>
          <p style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: '#ff4f9a',
                color: '#12101f',
                border: 0,
                borderRadius: 8,
                padding: '.7rem 1.1rem',
                font: 'inherit',
                fontWeight: 600,
                minHeight: 44,
                cursor: 'pointer',
              }}
            >
              Reload the page
            </button>
            {/* A full navigation rather than a router link: the router is part
                of what just failed. */}
            <a
              href="/maintenance.html"
              style={{ color: '#22d3d3', alignSelf: 'center' }}
            >
              Status, and something to do while you wait
            </a>
          </p>
        </div>
      </div>
    );
  }
}
