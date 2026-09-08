import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/source.js';

import {
  BOTTOM_TOLERANCE_PX,
  SETTLE_MS,
  createStickToBottom,
  isAtBottom,
} from '../../web/src/lib/stickToBottom.js';

/**
 * A window that behaves like a phone: it clamps, and rotating changes both the
 * viewport and how tall the transcript wraps to.
 *
 * The clamp is the whole point. A fake that let scrollY stay at 4200 while the
 * document was 3100 tall would never reproduce the reported bug, and the test
 * would pass against the unfixed code - which is the only test failure that
 * costs more than it saves.
 */
function makePhone({ viewport, height }) {
  const stage = { viewport, height };
  const listeners = new Map();
  const orientationListeners = new Map();
  const frames = new Map();
  let nextFrame = 1;
  let clock = 0;

  const emit = (type) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn();
  };
  const maxScroll = () => Math.max(0, stage.height - stage.viewport);

  const setScroll = (top) => {
    const next = Math.min(Math.max(0, top), maxScroll());
    if (next === win.scrollY) return;
    win.scrollY = next;
    emit('scroll');
  };

  const win = {
    scrollY: 0,
    innerHeight: viewport,
    screen: {
      orientation: {
        addEventListener: (type, fn) => orientationListeners.set(type, fn),
        removeEventListener: (type) => orientationListeners.delete(type),
      },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    scrollTo({ top }) {
      setScroll(top);
    },
  };

  const doc = { documentElement: { get scrollHeight() { return stage.height; } } };

  return {
    win,
    doc,
    listeners,
    orientationListeners,
    env: {
      window: win,
      document: doc,
      now: () => clock,
      requestAnimationFrame: (fn) => {
        const id = nextFrame++;
        frames.set(id, fn);
        return id;
      },
      cancelAnimationFrame: (id) => frames.delete(id),
    },

    maxScroll,
    scrollTo: setScroll,
    /** Run every pending animation frame, advancing the clock by one frame. */
    frame(ms = 16) {
      clock += ms;
      const due = [...frames.entries()];
      frames.clear();
      for (const [, fn] of due) fn();
    },
    input(type) {
      emit(type);
    },
    /** A scroll event with no movement behind it - the browser's own, mid-rotation. */
    emitScroll() {
      emit('scroll');
    },
    /**
     * Rotate. The browser clamps the offset to the new document, which fires a
     * scroll, and then reports the resize.
     */
    rotate({ viewport: nextViewport, height: nextHeight }) {
      stage.viewport = nextViewport;
      stage.height = nextHeight;
      win.innerHeight = nextViewport;
      setScroll(win.scrollY);
      emit('resize');
    },
  };
}

const PORTRAIT = { viewport: 700, height: 4900 };
const LANDSCAPE = { viewport: 380, height: 3100 };

describe('isAtBottom', () => {
  test('the end, and a little short of it, both count', () => {
    assert.equal(isAtBottom({ scrollY: 4200, viewportHeight: 700, documentHeight: 4900 }), true);
    assert.equal(
      isAtBottom({ scrollY: 4200 - BOTTOM_TOLERANCE_PX, viewportHeight: 700, documentHeight: 4900 }),
      true
    );
  });

  test('somebody who scrolled up to read does not', () => {
    assert.equal(isAtBottom({ scrollY: 2000, viewportHeight: 700, documentHeight: 4900 }), false);
    assert.equal(
      isAtBottom({ scrollY: 4200 - BOTTOM_TOLERANCE_PX - 1, viewportHeight: 700, documentHeight: 4900 }),
      false
    );
  });

  test('a measurement that is not a number is not the bottom', () => {
    // iOS returns nonsense from innerHeight during a rotation. Reading that as
    // "at the bottom" would scroll a reader who was not, which is a worse bug
    // than the one this fixes.
    assert.equal(isAtBottom({ scrollY: 0, viewportHeight: undefined, documentHeight: 4900 }), false);
    assert.equal(isAtBottom({ scrollY: NaN, viewportHeight: 700, documentHeight: 4900 }), false);
    assert.equal(isAtBottom(undefined), false);
    assert.equal(isAtBottom({}), false);
  });
});

describe('rotating away and back', () => {
  test('THE REPORTED BUG: portrait -> landscape -> portrait keeps the newest message', () => {
    const phone = makePhone(PORTRAIT);
    const stick = createStickToBottom(phone.env);
    const stop = stick.start();

    phone.scrollTo(phone.maxScroll());
    assert.equal(phone.win.scrollY, 4200, 'the reader is at the end in portrait');

    phone.rotate(LANDSCAPE);
    // The browser has already clamped 4200 down to 2720 here. That clamp is
    // the loss: it is not recoverable from the offset alone afterwards.
    assert.equal(phone.win.scrollY, 2720);

    phone.rotate(PORTRAIT);
    phone.frame();

    assert.equal(
      phone.win.scrollY,
      4200,
      'came back to portrait a couple of messages up from where the reader was'
    );
    stop();
  });

  test('a reader who scrolled up is left where they were', () => {
    const phone = makePhone(PORTRAIT);
    const stop = createStickToBottom(phone.env).start();

    phone.scrollTo(1000);
    phone.rotate(LANDSCAPE);
    phone.frame();

    assert.notEqual(phone.win.scrollY, phone.maxScroll(), 'yanked a reader to the end uninvited');
    stop();
  });

  test('the clamp is not mistaken for the reader scrolling away', () => {
    const phone = makePhone(PORTRAIT);
    const stick = createStickToBottom(phone.env);
    const stop = stick.start();

    phone.scrollTo(phone.maxScroll());
    phone.rotate(LANDSCAPE);
    assert.equal(stick.isPinned(), true);
    stop();
  });

  /**
   * A rotation is not one event. It is a burst: a resize, the browser's own
   * scroll from clamping, our own scroll from correcting, and on iOS a second
   * reflow once the layout finally settles - during all of which innerHeight
   * can still be reporting the orientation the phone has left (WebKit 170595).
   *
   * So a scroll event inside that burst carries a measurement that says the
   * reader is nowhere near the end when they are sitting on it. Believing it
   * disarms the fix before the reflow that actually needed it, and nothing
   * about that is visible: the page just ends up short, exactly as reported.
   */
  test('a stale measurement mid-rotation does not disarm the later correction', () => {
    const phone = makePhone(PORTRAIT);
    const stick = createStickToBottom(phone.env);
    const stop = stick.start();

    phone.scrollTo(phone.maxScroll());
    phone.rotate(LANDSCAPE);

    // Back to portrait, but the transcript has only partly reflowed.
    phone.rotate({ viewport: 700, height: 4000 });
    phone.win.innerHeight = 380; // what iOS hands back during the rotation
    phone.emitScroll();
    phone.frame();

    for (let i = 0; i < Math.ceil(SETTLE_MS / 16) + 2; i += 1) phone.frame();

    // The layout finishes and the document reaches its real height.
    phone.win.innerHeight = 700;
    phone.rotate({ viewport: 700, height: 4900 });
    phone.frame();

    assert.equal(stick.isPinned(), true);
    assert.equal(phone.win.scrollY, 4200, 'a stale reading during the rotation lost the end of the page');
    stop();
  });

  test('it keeps correcting while the layout settles, then stops', () => {
    const phone = makePhone(PORTRAIT);
    const stop = createStickToBottom(phone.env).start();

    phone.scrollTo(phone.maxScroll());
    phone.rotate(LANDSCAPE);
    phone.rotate(PORTRAIT);

    // A browser that reports the old height on the first frame gets corrected
    // on a later one. This is the case a single scrollTo would fail.
    phone.frame();
    phone.scrollTo(0);
    phone.frame();
    assert.equal(phone.win.scrollY, 4200, 'stopped correcting while the layout was still moving');

    // ...but not forever.
    for (let i = 0; i < Math.ceil(SETTLE_MS / 16) + 2; i += 1) phone.frame();
    phone.scrollTo(0);
    phone.frame();
    assert.equal(phone.win.scrollY, 0, 'still pulling the page down after it settled');
    stop();
  });

  for (const gesture of ['touchstart', 'wheel', 'keydown']) {
    test(`${gesture} ends the correction immediately`, () => {
      const phone = makePhone(PORTRAIT);
      const stop = createStickToBottom(phone.env).start();

      phone.scrollTo(phone.maxScroll());
      phone.rotate(LANDSCAPE);
      phone.rotate(PORTRAIT);

      phone.input(gesture);
      phone.scrollTo(500);
      phone.frame();

      assert.equal(phone.win.scrollY, 500, 'fought the reader for the scroll position');
      stop();
    });
  }

  test('it listens for the orientation event that is not deprecated', () => {
    const phone = makePhone(PORTRAIT);
    const stop = createStickToBottom(phone.env).start();
    assert.ok(
      phone.orientationListeners.has('change'),
      'window.orientationchange is deprecated in favor of ScreenOrientation change'
    );
    stop();
  });

  test('a browser with no ScreenOrientation still works', () => {
    const phone = makePhone(PORTRAIT);
    delete phone.win.screen;
    const stop = createStickToBottom(phone.env).start();

    phone.scrollTo(phone.maxScroll());
    phone.rotate(LANDSCAPE);
    phone.rotate(PORTRAIT);
    phone.frame();

    assert.equal(phone.win.scrollY, 4200);
    stop();
  });

  test('everything it attached is detached again', () => {
    const phone = makePhone(PORTRAIT);
    const stop = createStickToBottom(phone.env).start();
    stop();

    for (const [type, set] of phone.listeners) {
      assert.equal(set.size, 0, `${type} listener survived unmount`);
    }
    assert.equal(phone.orientationListeners.size, 0, 'orientation listener survived unmount');
  });
});

describe('where it is mounted', () => {
  const chat = readSource(new URL('../../web/src/pages/Chat.jsx', import.meta.url));

  test('the coach page mounts it', () => {
    assert.match(chat, /<StickToBottom \/>/, 'the fix is not on the page it was reported against');
  });

  test('and no other page does', () => {
    // "Put the reader back at the end" is right for a conversation and wrong
    // for a policy document.
    const pages = readSource(new URL('../../web/src/App.jsx', import.meta.url));
    assert.doesNotMatch(pages, /StickToBottom/);
  });
});
