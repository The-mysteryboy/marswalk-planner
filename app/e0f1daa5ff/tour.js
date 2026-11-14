// The guided tour. It only points at controls. The one thing it ever does to the app is
// load the demo walk, when Next is pressed on step 1 and no route exists yet. It is not
// modal, so the page stays usable behind it and Tab can always leave it.

export const TOUR_STEPS = [
  {
    target: '#btn-demo',
    title: 'Try the demo walk',
    text: (hasRoute) => (hasRoute
      ? 'This loads a ready-made walk from the rover\'s landing site. You already have a route, so the tour will use yours.'
      : 'This loads a ready-made walk from the rover\'s landing site. Press Next and the tour will load it for you.'),
  },
  {
    target: '#verdict',
    title: 'The verdict',
    text: () => 'GO, CAUTION or NO-GO, plus the science stops it passes. It says Refining... until the detailed map loads.',
  },
  {
    target: '.btn-why',
    around: '#verdict', // Why? sits inside the verdict, so the card stays clear of the whole box.
    fallback: '#verdict',
    title: 'Why?',
    text: (hasRoute) => (hasRoute
      ? 'This lists every rule the route passed or failed, using its real numbers.'
      : 'Once there is a route, Why? lists every rule it passed or failed, using its real numbers.'),
  },
  {
    target: '#mode-inspect',
    title: 'Check a point',
    text: () => `Switch to this, then ${globalThis.matchMedia?.('(pointer: coarse)').matches ? 'tap' : 'click'} the map to read elevation and slope at that spot. Nothing is added to your route.`,
  },
  {
    target: '#scenarios-section > summary',
    title: 'Example missions',
    text: () => 'Ready-made walks, plus Reachable science and the rover path coloured by slope.',
  },
  {
    target: '#more-tools > summary',
    title: 'More tools',
    text: () => 'Map layers, the slope map, the safest route, nearby stops and the assumptions are all in here.',
  },
];

/** Where the card goes: to the right of the target if it fits, then below, then above. */
export function placeCard(target, card, view, gap = 12, edge = 12) {
  const clamp = (value, max) => Math.max(edge, Math.min(value, max));
  const left = clamp(target.left, view.width - card.width - edge);
  const lowest = view.height - card.height - edge;
  const top = clamp(target.top, lowest);
  // The target can be scrolled off screen, and the card stays on it either way.
  if (target.right + gap + card.width <= view.width - edge) return { left: target.right + gap, top };
  if (target.bottom + gap + card.height <= view.height - edge) return { left, top: clamp(target.bottom + gap, lowest) };
  if (target.top - gap - card.height >= edge) return { left, top: clamp(target.top - gap - card.height, lowest) };
  return { left, top: Math.max(edge, lowest) };
}

const shown = (el) => el !== null && el.getClientRects().length > 0;

/** Wires the tour's card to the page. hasRoute and loadDemo come from the app. */
export function setupTour({ opener, hasRoute, loadDemo, onOpen, onClose }) {
  const $ = (id) => document.getElementById(id);
  const card = $('tour');
  const ring = $('tour-ring');
  const back = $('tour-back');
  const next = $('tour-next');
  const skip = $('tour-skip');
  const lastStep = TOUR_STEPS.length - 1;
  let step = -1;
  let frame = 0;
  let drawn = '';
  let pageHeight = 0;

  function targetOf({ target, fallback }) {
    const el = document.querySelector(target);
    return shown(el) ? el : document.querySelector(fallback);
  }

  const areaOf = (s) => (s.around ? document.querySelector(s.around) : targetOf(s));

  // On a short screen, such as a small phone or one on its side, the card needs the room below.
  function bringIntoView() {
    areaOf(TOUR_STEPS[step]).scrollIntoView({ block: window.innerHeight < 640 ? 'start' : 'center', inline: 'nearest' });
    pageHeight = document.documentElement.scrollHeight;
  }

  // The target can move for many reasons: scrolling, the report opening, a resize.
  // Reading its box once a frame covers them all, and it only runs while the tour is open.
  function follow() {
    // The demo's report makes the page taller after Next, so the first scroll can stop short.
    if (document.documentElement.scrollHeight !== pageHeight) bringIntoView();
    const s = TOUR_STEPS[step];
    const t = targetOf(s).getBoundingClientRect();
    const a = areaOf(s).getBoundingClientRect();
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const box = [t.left, t.top, t.width, t.height, a.left, a.top, a.width, a.height, size.width, size.height, view.width, view.height].join();
    if (box !== drawn) {
      drawn = box;
      Object.assign(ring.style, { left: `${t.left - 4}px`, top: `${t.top - 4}px`, width: `${t.width + 8}px`, height: `${t.height + 8}px` });
      const { left, top } = placeCard(a, size, view);
      Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    }
    frame = requestAnimationFrame(follow);
  }

  function show(n) {
    step = n;
    const s = TOUR_STEPS[n];
    $('tour-count').textContent = `Step ${n + 1} of ${TOUR_STEPS.length}`;
    $('tour-title').textContent = s.title;
    $('tour-text').textContent = s.text(hasRoute());
    back.hidden = n === 0;
    skip.hidden = n === lastStep;
    next.textContent = n === lastStep ? 'Done' : 'Next';
    bringIntoView();
  }

  function open() {
    onOpen?.();
    show(0);
    card.hidden = false;
    ring.hidden = false;
    drawn = '';
    cancelAnimationFrame(frame);
    follow();
    next.focus({ preventScroll: true });
  }

  function close({ focus = true } = {}) {
    step = -1;
    cancelAnimationFrame(frame);
    card.hidden = true;
    ring.hidden = true;
    onClose?.();
    if (focus) opener.focus();
  }

  opener.addEventListener('click', open);
  skip.addEventListener('click', () => close());
  back.addEventListener('click', () => {
    show(step - 1);
    (back.hidden ? next : back).focus({ preventScroll: true });
  });
  next.addEventListener('click', () => {
    if (step === 0 && !hasRoute()) loadDemo();
    if (step === lastStep) close(); else show(step + 1);
  });

  // Caught on the way down, so Escape here closes the tour and nothing else. An open
  // About box keeps its own Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || step < 0 || $('about').open) return;
    e.stopPropagation();
    close();
  }, true);

  return { close, isOpen: () => step >= 0 };
}
