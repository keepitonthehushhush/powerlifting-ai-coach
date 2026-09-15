/**
 * One headless browser driver, for every check that needs to RUN the app
 * rather than read it.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Two checks drive Chrome and they had drifted into two different ways of
 * doing it. check-app-mounts.mjs used `--dump-dom`, which is one flag and one
 * process and is genuinely the whole feature when the page is served from
 * here, because the HTML can be modified on the way out. check-scroll-cues.mjs
 * needed touch emulation, which no command-line flag provides, so it grew its
 * own DevTools-protocol client.
 *
 * The cost of the two ways showed up as a defect rather than as duplication.
 * `--dump-dom` cannot inject anything into a page it did not serve, so
 * check-app-mounts' REMOTE mode - the one added after an eighteen-hour
 * production outage, the one a scheduled workflow runs every six hours - could
 * not pass. Pointed at an origin serving a build that passes locally 11 routes
 * out of 11, it reported 11 failures, all of them "the probe never ran". The
 * app was fine and the probe was never there.
 *
 * So: one driver, and it can inject. `Page.addScriptToEvaluateOnNewDocument`
 * runs before any of the page's own script, on any origin, which is the whole
 * thing the file-serving trick was buying and is not limited to pages we
 * serve.
 *
 * ── NO DEPENDENCY ─────────────────────────────────────────────────────────
 *
 * Puppeteer and Playwright both do this better. They are also a browser
 * download in CI and a version to keep current, for what is a few hundred
 * lines of JSON over one socket. Node 22 ships a WebSocket client; CDP is JSON
 * over one. The rejection is the same one ADR-15 records for --dump-dom, and
 * it still holds - what changed is only that a flag is no longer enough.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const exists = (target) => access(target, constants.R_OK).then(() => true, () => false);

/**
 * Chrome, Chromium or Edge, wherever this machine keeps it.
 *
 * Deliberately returns null rather than throwing: every caller refuses to run
 * without one and says so in its own words, because "this check did not run"
 * has to be as loud as "this check failed".
 */
export async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

/** The whole CDP client. One socket, one id counter, one map of promises. */
async function connect(url) {
  if (typeof WebSocket !== 'function') {
    throw new Error('This needs the WebSocket client built into node 22 or newer.');
  }
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`Could not open a DevTools socket at ${url}`));
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.method ?? 'cdp'}: ${JSON.stringify(message.error)}`));
    else resolve(message.result);
  };
  return {
    send(method, params = {}, sessionId) {
      const message = { id: (id += 1), method, params, ...(sessionId ? { sessionId } : {}) };
      return new Promise((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
        socket.send(JSON.stringify(message));
      });
    },
  };
}

/**
 * @param {string} chromePath
 * @param {{
 *   width?: number, height?: number, touch?: boolean, offline?: boolean,
 *   label?: string, scheme?: 'light'|'dark'|null,
 * }} options
 *
 * `offline` maps every host except loopback to NOTFOUND. It is what makes the
 * LOCAL mount check meaningful - the app has to mount without reaching
 * Supabase or Turnstile - and it is exactly wrong for a deployed site, where
 * fetching it is the entire point. Off by default so that the dangerous
 * direction is the one somebody has to ask for.
 */
export async function launch(chromePath, options = {}) {
  const {
    width = 1280, height = 900, touch = false, offline = false, label = 'browser', scheme = null,
  } = options;

  const profile = path.join(
    process.env.TMPDIR ?? '/tmp',
    `${label}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox', // CI containers run as root, and there is no untrusted content here.
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let noise = '';
    const timer = setTimeout(
      () => reject(new Error(`Chrome never announced a DevTools endpoint.\n${noise}`)),
      30000,
    );
    chrome.stderr.on('data', (chunk) => {
      noise += chunk;
      const found = noise.match(/ws:\/\/\S+/);
      if (found) { clearTimeout(timer); resolve(found[0]); }
    });
    chrome.on('error', (error) => { clearTimeout(timer); reject(error); });
    chrome.on('close', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code} before starting.\n${noise}`)); });
  });

  const browser = await connect(wsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: touch, screenWidth: width, screenHeight: height,
  });

  const features = [];
  if (scheme) features.push({ name: 'prefers-color-scheme', value: scheme });
  if (touch) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    /*
     * The part a narrow window cannot give you, and the reason this drives CDP
     * rather than passing --window-size to --dump-dom. Headless Chrome at
     * 390px still reports `hover: hover` and never reports `pointer: coarse`,
     * and this project has already withdrawn one review finding for taking a
     * narrow window to be a phone.
     */
    features.push({ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' });
  }
  if (features.length) await send('Emulation.setEmulatedMedia', { features });

  return {
    /** Runs before any of the page's own script, on any origin. */
    async addInitScript(source) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source });
    },

    /**
     * Navigate, then wait for the app to put something in #root.
     *
     * Polled rather than waiting on a load event: this is a client-rendered
     * application, so `load` fires long before there is anything to look at.
     * Returns whether anything ever mounted, so a caller can tell "gave up" -
     * which is a finding - from "took 300ms", which is normal.
     */
    async goto(url, { timeoutMs = 12000, settleMs = 400 } = {}) {
      await send('Page.navigate', { url });
      const deadline = Date.now() + timeoutMs;
      let mounted = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 120));
        const { result } = await send('Runtime.evaluate', {
          expression: 'document.getElementById("root")?.childNodes.length ?? -1',
          returnByValue: true,
        });
        if (Number(result.value) > 0) { mounted = true; break; }
      }
      // A beat for a second render pass - an error boundary swapping itself in
      // is the case that matters, and it lands after the first paint.
      await new Promise((r) => setTimeout(r, settleMs));
      return { mounted };
    },

    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? JSON.stringify(exceptionDetails));
      }
      return result.value;
    },

    /** The rendered DOM, which is what every content assertion reads. */
    async html() {
      const { result } = await send('Runtime.evaluate', {
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      });
      return String(result.value ?? '');
    },

    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },

    close() { chrome.kill('SIGKILL'); },
  };
}
