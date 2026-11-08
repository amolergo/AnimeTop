/**
 * Mira's small, self-contained animation controller.
 *
 * Call `initCharacterAnimation({ root, button, images })` once after the widget
 * exists. `images` maps idle, wave, sit, drink and think to transparent artwork.
 * The returned controller has `react('answer' | 'voice' | 'thinking' | 'click')`,
 * `play('wave' | 'sit' | 'drink' | 'think')`, and `destroy()`. It never sends
 * requests or changes chat state.
 */
const controllers = new WeakMap();
const DEFAULT_IMAGES = {
  idle: './assistant-mira-idle-v4.png',
  wave: './assistant-mira-wave-v4.png',
  sit: './assistant-mira-sit-v4.png',
  standup: './assistant-mira-standup-v4.png',
  drink: './assistant-mira-drink-v4.png',
  think: './assistant-mira-think-v4.png',
};
const POSES = Object.keys(DEFAULT_IMAGES);
const DEFAULT_ACTIONS = ['wave', 'sit', 'drink', 'think'];

export function initCharacterAnimation({ root, button, images = {} } = {}) {
  if (!(root instanceof HTMLElement) || !(button instanceof HTMLElement)) {
    throw new TypeError('Mira animation requires root and button elements.');
  }
  if (controllers.has(button)) return controllers.get(button);

  const artwork = { ...DEFAULT_IMAGES, ...images };
  const stage = document.createElement('span');
  stage.className = 'mira-character-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.dataset.pose = 'idle';
  for (const pose of POSES) {
    const frame = document.createElement('img');
    frame.className = 'mira-character-frame';
    frame.dataset.pose = pose;
    frame.src = artwork[pose];
    frame.alt = '';
    frame.draggable = false;
    frame.decoding = 'async';
    frame.onerror = () => {
      if (pose !== 'idle' && frame.src !== new URL(artwork.idle, location.href).href) frame.src = artwork.idle;
    };
    stage.append(frame);
  }
  button.append(stage);
  button.classList.add('mira-character-active');

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0;
  let sequence = 0;
  let disposed = false;
  let hovering = false;
  let lastAction = '';

  function visible() {
    return !disposed && !document.hidden && !button.classList.contains('hidden') && !root.classList.contains('hidden') && button.getClientRects().length > 0;
  }
  function clearStep() { window.clearTimeout(timer); timer = 0; }
  function setPose(pose) { stage.dataset.pose = pose; }
  function schedule(fn, delay) {
    clearStep();
    if (visible() && !motionQuery.matches) timer = window.setTimeout(fn, delay);
  }
  function idle() {
    sequence += 1;
    setPose('idle');
    if (!visible() || motionQuery.matches) return;
    schedule(randomAction, 8500 + Math.random() * 8000);
  }
  function run(steps) {
    if (!visible() || motionQuery.matches) return;
    const runId = ++sequence;
    let index = 0;
    const next = () => {
      if (runId !== sequence || !visible() || motionQuery.matches) return;
      if (index >= steps.length) { idle(); return; }
      const [pose, duration] = steps[index++];
      setPose(pose);
      schedule(next, duration);
    };
    next();
  }
  function randomAction() {
    if (hovering) { schedule(randomAction, 1800); return; }
    const options = DEFAULT_ACTIONS.filter((item) => item !== lastAction);
    const action = options[Math.floor(Math.random() * options.length)];
    lastAction = action;
    play(action);
  }
  function play(action) {
    if (action === 'wave') run([['wave', 700], ['idle', 350], ['wave', 750]]);
    if (action === 'sit') run([['sit', 3900], ['standup', 380], ['idle', 450]]);
    if (action === 'drink') run([['sit', 650], ['drink', 1550], ['sit', 750], ['standup', 380], ['idle', 450]]);
    if (action === 'think') run([['think', 2100], ['idle', 400], ['think', 950]]);
  }
  function react(kind) {
    if (kind === 'voice') run([['think', 500], ['wave', 750], ['think', 900]]);
    else if (kind === 'thinking') run([['think', 1600], ['idle', 400], ['think', 1450]]);
    else if (kind === 'answer') run([['wave', 800], ['idle', 350], ['wave', 800]]);
    else if (kind === 'click') run([['wave', 850], ['idle', 350], ['wave', 650]]);
  }
  function onEnter() { hovering = true; react('click'); }
  function onLeave() { hovering = false; if (visible()) idle(); }
  function onClick() { react('click'); }
  function onVisibility() { if (visible()) idle(); else { sequence++; clearStep(); setPose('idle'); } }
  function onMotionChange() { onVisibility(); }

  button.addEventListener('pointerenter', onEnter);
  button.addEventListener('pointerleave', onLeave);
  button.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);
  motionQuery.addEventListener('change', onMotionChange);
  const observer = new MutationObserver(onVisibility);
  observer.observe(button, { attributes: true, attributeFilter: ['class'] });

  const controller = {
    react,
    play,
    destroy() {
      if (disposed) return;
      disposed = true;
      sequence++;
      clearStep();
      observer.disconnect();
      button.removeEventListener('pointerenter', onEnter);
      button.removeEventListener('pointerleave', onLeave);
      button.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      button.classList.remove('mira-character-active');
      stage.remove();
      controllers.delete(button);
    },
  };
  controllers.set(button, controller);
  idle();
  return controller;
}
