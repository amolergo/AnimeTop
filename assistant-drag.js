const STORAGE_KEY = 'anime-top-assistant-position-v1';
const EDGE_GAP = 8;
const DRAG_THRESHOLD = 7;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function viewport() {
  const visual = window.visualViewport;
  return visual
    ? { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function readStoredPosition(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
      return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
    }
  } catch { /* Storage can be unavailable in private browsing. */ }
  return null;
}

/**
 * Lets the assistant's launch button (and optional restore button) move the
 * fixed widget. The saved anchor is the widget's bottom-right point as a
 * percentage of the visible viewport, so it survives resizing.
 *
 * The caller keeps its existing click handlers. This module suppresses the
 * click that follows a drag, while a normal tap/click still opens the chat.
 * Call the returned cleanup function when unmounting a dynamic widget.
 */
export function initAssistantDrag({ widget, handle, restoreHandle, panel, storageKey = STORAGE_KEY } = {}) {
  if (!widget || !handle) throw new TypeError('initAssistantDrag requires widget and handle elements');

  const handles = [handle, restoreHandle].filter(Boolean);
  const stored = readStoredPosition(storageKey);
  const initialViewport = viewport();
  const initialRect = widget.getBoundingClientRect();
  let anchor = stored
    ? { x: initialViewport.left + stored.x * initialViewport.width, y: initialViewport.top + stored.y * initialViewport.height }
    : { x: initialRect.right, y: initialRect.bottom };
  let pointer = null;
  let suppressClickUntil = 0;
  let scheduled = 0;

  function save() {
    const view = viewport();
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        x: clamp((anchor.x - view.left) / view.width, 0, 1),
        y: clamp((anchor.y - view.top) / view.height, 0, 1),
      }));
    } catch { /* Dragging still works without storage. */ }
  }

  function place() {
    scheduled = 0;
    const view = viewport();
    const rect = widget.getBoundingClientRect();
    const width = Math.min(rect.width, view.width);
    const height = Math.min(rect.height, view.height);
    const gapX = Math.min(EDGE_GAP, (view.width - width) / 2);
    const gapY = Math.min(EDGE_GAP, (view.height - height) / 2);
    const visibleX = clamp(anchor.x, view.left + width + gapX, view.left + view.width - gapX);
    const visibleY = clamp(anchor.y, view.top + height + gapY, view.top + view.height - gapY);
    widget.style.left = 'auto';
    widget.style.top = 'auto';
    widget.style.right = `${window.innerWidth - visibleX}px`;
    widget.style.bottom = `${window.innerHeight - visibleY}px`;
  }

  function schedulePlace() {
    if (!scheduled) scheduled = requestAnimationFrame(place);
  }

  function onDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.currentTarget;
    const rect = widget.getBoundingClientRect();
    pointer = {
      id: event.pointerId,
      target,
      x: event.clientX,
      y: event.clientY,
      anchorX: rect.right,
      anchorY: rect.bottom,
      moved: false,
    };
    target.setPointerCapture?.(event.pointerId);
  }

  function onMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    pointer.moved = true;
    event.preventDefault();
    anchor = { x: pointer.anchorX + dx, y: pointer.anchorY + dy };
    widget.classList.add('assistant-dragging');
    place();
  }

  function onEnd(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.moved) {
      // Store the actually visible position; the pointer may have left the viewport.
      const rect = widget.getBoundingClientRect();
      anchor = { x: rect.right, y: rect.bottom };
      save();
      suppressClickUntil = performance.now() + 600;
    }
    widget.classList.remove('assistant-dragging');
    if (pointer.target.hasPointerCapture?.(pointer.id)) pointer.target.releasePointerCapture(pointer.id);
    pointer = null;
  }

  function onClickCapture(event) {
    if (performance.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onKeyDown(event) {
    const step = event.shiftKey ? 40 : 16;
    const offsets = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const rect = widget.getBoundingClientRect();
    anchor = { x: rect.right + offset[0], y: rect.bottom + offset[1] };
    place();
    anchor = { x: widget.getBoundingClientRect().right, y: widget.getBoundingClientRect().bottom };
    save();
  }

  for (const target of handles) {
    target.setAttribute('aria-description', 'Перетащите, чтобы переместить. Стрелки двигают персонажа; Shift и стрелка — быстрее.');
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
    target.addEventListener('click', onClickCapture, true);
    target.addEventListener('keydown', onKeyDown);
  }

  const observer = new MutationObserver(schedulePlace);
  for (const target of [handle, restoreHandle, panel].filter(Boolean)) {
    observer.observe(target, { attributes: true, attributeFilter: ['class', 'hidden'] });
  }
  window.addEventListener('resize', schedulePlace);
  window.visualViewport?.addEventListener('resize', schedulePlace);
  window.visualViewport?.addEventListener('scroll', schedulePlace);
  schedulePlace();

  return () => {
    observer.disconnect();
    cancelAnimationFrame(scheduled);
    window.removeEventListener('resize', schedulePlace);
    window.visualViewport?.removeEventListener('resize', schedulePlace);
    window.visualViewport?.removeEventListener('scroll', schedulePlace);
    for (const target of handles) {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
      target.removeEventListener('click', onClickCapture, true);
      target.removeEventListener('keydown', onKeyDown);
    }
    widget.classList.remove('assistant-dragging');
  };
}
