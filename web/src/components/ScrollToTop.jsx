import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Start a new page at the top, the way a real page load does.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * "When you scroll down all the way and then click back, and then go to the
 * same link, it starts them where they left off before. Can we correct that so
 * when they reclick the link, it starts them back at the top?"
 *
 * A browser resets the scroll position on a real navigation. A single-page
 * application does not: React Router swaps the component tree and the document
 * keeps whatever scroll offset it already had. So following a link from the
 * bottom of the FAQ dropped the reader into the middle of a policy document,
 * with no indication they were not at the beginning of it.
 *
 * Nothing in this application reset scroll anywhere - the only two calls to
 * `window.scrollTo` are the explicit "back to top" buttons.
 *
 * ── WHY IT IS KEYED ON location.key AND NOT ON THE PATH ───────────────────
 *
 * Because the reported case is clicking THE SAME LINK AGAIN. The pathname is
 * identical across that navigation, so an effect keyed on the path would not
 * run and the bug would survive the fix. `location.key` is new for every entry
 * pushed onto the history stack, including one that lands on the page it came
 * from.
 *
 * ── AND WHY GOING BACK IS LEFT ALONE ──────────────────────────────────────
 *
 * `POP` is the browser's own back and forward. There, restoring the previous
 * position is not a bug, it is the entire point: somebody who read half the
 * FAQ, followed a link and came back expects to be where they were, and being
 * thrown to the top would be a second, worse version of this same complaint.
 * Browsers do that restoration themselves through `history.scrollRestoration`,
 * so the correct action on POP is none at all.
 */
export function ScrollToTop() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') return;
    // `instant` rather than smooth: this is not a gesture the reader made, and
    // animating a jump they did not ask for reads as the page moving by itself.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.key, navigationType]);

  return null;
}
