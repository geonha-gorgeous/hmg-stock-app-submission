export const ccpActions = ['next', 'previous', 'up', 'down', 'left', 'right', 'select', 'back'] as const;
export type CcpAction = typeof ccpActions[number];
export type CcpSource = 'keyboard' | 'android' | 'simulator';
export interface CcpState {
  active: boolean;
  mode: 'navigation' | 'editing';
  target: HTMLElement | null;
  label: string;
  area: string | null;
  source: CcpSource | null;
}
export interface CcpOptions { onBack?: () => void; onChange?: (state: CcpState) => void }
export interface CcpInputDetail { action: CcpAction; source: 'android' | 'simulator'; repeat?: boolean }
export const initialCcpState: CcpState = { active: false, mode: 'navigation', target: null, label: '', area: null, source: null };
const targetSelector = 'button, input:not([type="hidden"]), [data-ccp-target]';

export function isCcpAction(value: unknown): value is CcpAction {
  return typeof value === 'string' && ccpActions.includes(value as CcpAction);
}

export function getCcpScope(root: HTMLElement): HTMLElement {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]')).filter(isCcpVisible);
  return dialogs.at(-1) ?? root;
}

export function isCcpVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.closest('dialog:not([open])')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return element.getClientRects().length > 0;
}

export function getCcpTargets(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(targetSelector)).filter(element =>
    isCcpVisible(element) && !element.matches(':disabled, [disabled], [aria-disabled="true"]') && !element.closest('[data-ccp-ignore]'),
  );
}

export function getSequentialTarget(targets: HTMLElement[], current: HTMLElement | null, direction: 1 | -1): HTMLElement | null {
  if (!targets.length) return null;
  const index = current ? targets.indexOf(current) : -1;
  return targets[index < 0 ? (direction === 1 ? 0 : targets.length - 1) : (index + direction + targets.length) % targets.length];
}

/** Prefer targets whose rectangles overlap on the perpendicular axis, then distance.
 * Area is a tie breaker, so a nearer adjacent area remains reachable. */
export function getDirectionalTarget(targets: HTMLElement[], current: HTMLElement | null, direction: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
  if (!current) return targets[0] ?? null;
  const origin = current.getBoundingClientRect();
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  const x = origin.left + origin.width / 2;
  const y = origin.top + origin.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const candidate of targets) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - x;
    const dy = rect.top + rect.height / 2 - y;
    const primary = (horizontal ? dx : dy) * sign;
    if (primary <= 1) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    const overlap = horizontal ? rect.bottom > origin.top && rect.top < origin.bottom : rect.right > origin.left && rect.left < origin.right;
    const sameArea = candidate.closest('[data-ccp-area]') === current.closest('[data-ccp-area]');
    const score = Math.hypot(primary, cross) + cross * 2 + (overlap ? 0 : 10000) + (sameArea ? 0 : 0.01);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best ?? current;
}

function isEditable(element: HTMLElement | null): boolean {
  return !!element && (element.isContentEditable || element.matches('textarea, input:not([readonly]):not(:disabled):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"])'));
}
function isAdjustable(element: HTMLElement | null): boolean {
  return !!element?.matches('input[type="number"]') && !!element.closest('[data-ccp-adjust]');
}
function defaultTarget(targets: HTMLElement[]): HTMLElement | null {
  return targets.find(target => target.matches('[data-ccp-default]:not([data-ccp-default="false"])')) ?? targets[0] ?? null;
}
function labelFor(element: HTMLElement | null): string {
  if (!element) return '';
  return element.getAttribute('aria-label') || element.getAttribute('data-ccp-label') || element.textContent?.replace(/\s+/g, ' ').trim() || (element instanceof HTMLInputElement ? element.value : '') || '';
}
const keyboardActions: Record<string, CcpAction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', Escape: 'back' };

export function createCcpController(root: HTMLElement, options: CcpOptions = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let state = { ...initialCcpState };
  let scope = getCcpScope(root);
  let targets = getCcpTargets(scope);
  let movingFocus = false;
  let disposed = false;
  const heldKeys = new Set<string>();
  const restore = new Map<HTMLElement, HTMLElement | null>();

  function publish() {
    state = { ...state, label: labelFor(state.target), area: state.target?.closest('[data-ccp-area]')?.getAttribute('data-ccp-area') ?? null };
    if (state.active) doc.documentElement.dataset.ccpActive = 'true';
    else delete doc.documentElement.dataset.ccpActive;
    options.onChange?.(state);
  }
  function focus(target: HTMLElement | null, mode: CcpState['mode'] = 'navigation') {
    state.target?.removeAttribute('data-ccp-focused');
    state = { ...state, target, mode };
    const focusTarget = target ?? (scope !== root ? scope : null);
    if (focusTarget) {
      if (!target) focusTarget.tabIndex = -1;
      target?.setAttribute('data-ccp-focused', 'true');
      if (!focusTarget.matches('button, input, textarea, select, a[href], [tabindex]')) focusTarget.tabIndex = -1;
      movingFocus = true;
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      movingFocus = false;
    }
    publish();
  }
  function reconcile() {
    if (disposed) return false;
    const nextScope = getCcpScope(root);
    const previous = state.target;
    if (nextScope !== scope) {
      const priorScope = scope;
      const closed = priorScope !== root && !isCcpVisible(priorScope);
      const restored = closed ? restore.get(priorScope) : null;
      // A replacement dialog inherits its predecessor's opener. A nested dialog
      // keeps the outer dialog's return point until that outer dialog closes.
      if (nextScope !== root && !restore.has(nextScope)) restore.set(nextScope, closed ? restored ?? null : previous);
      if (closed) restore.delete(priorScope);
      scope = nextScope;
      targets = getCcpTargets(scope);
      // Pointer mode hides CCP styling but must still restore DOM focus and
      // replace the panel's stale dialog target when the dialog is dismissed.
      focus(restored && targets.includes(restored) ? restored : defaultTarget(targets));
      return previous !== state.target;
    }
    const oldIndex = previous ? targets.indexOf(previous) : 0;
    targets = getCcpTargets(scope);
    if (previous && !targets.includes(previous)) {
      focus(targets[Math.max(0, Math.min(oldIndex, targets.length - 1))] ?? null);
      return true;
    }
    // Text and accessible labels can change without replacing the focused node.
    if (state.label !== labelFor(previous)) publish();
    return false;
  }
  function dispatch(action: CcpAction, source: CcpSource = 'simulator') {
    if (disposed || !isCcpAction(action)) return;
    const hadTarget = !!state.target;
    const changed = reconcile();
    state = { ...state, active: true, source };
    if (action === 'back') {
      if (state.mode === 'editing') { focus(state.target); return; }
      if (scope !== root) {
        const dialog = scope;
        const event = new win.Event('cancel', { bubbles: false, cancelable: true });
        dialog.dispatchEvent(event);
        // onCancel owns dialog lifetime; do not bypass React or close a dialog here.
        publish();
        return;
      }
      options.onBack?.();
      publish();
      return;
    }
    if (state.mode === 'editing') {
      if (action === 'select') { focus(state.target); return; }
      if (isAdjustable(state.target)) {
        const increment = action === 'next' || action === 'up' || action === 'right';
        const button = state.target!.closest('[data-ccp-adjust]')?.querySelector<HTMLElement>(increment ? '[data-ccp-increment]' : '[data-ccp-decrement]');
        if (button && isCcpVisible(button) && !button.matches(':disabled, [disabled], [aria-disabled="true"]')) button.click();
      }
      publish();
      return;
    }
    if (action === 'select') {
      // A removed/disabled target can never turn the same press into a different action.
      if (changed || !hadTarget) { if (!state.target) focus(defaultTarget(targets)); else publish(); return; }
      const target = state.target;
      if (!target || !targets.includes(target)) { publish(); return; }
      if (isEditable(target) || isAdjustable(target)) { focus(target, 'editing'); return; }
      target.click();
      publish();
      return;
    }
    if (!state.target) { focus(defaultTarget(targets)); return; }
    const direction = action === 'next' || action === 'previous' ? null : action;
    const binding = direction ? state.target.closest(`[data-ccp-${direction}]`) : null;
    const targetName = binding && scope.contains(binding) ? binding.getAttribute(`data-ccp-${direction}`) : null;
    // Resolve names against the current eligible targets, never as CSS selectors.
    // This also keeps explicit links inside the active dialog's scope.
    const explicitTarget = targetName ? targets.find(target => target.getAttribute('data-ccp-target') === targetName) : null;
    focus(action === 'next' || action === 'previous'
      ? getSequentialTarget(targets, state.target, action === 'next' ? 1 : -1)
      : explicitTarget ?? getDirectionalTarget(targets, state.target, action));
  }
  function keydown(event: KeyboardEvent) {
    const action = keyboardActions[event.key];
    if (!action || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const active = doc.activeElement;
    // Keyboard CCP is limited to the application; native/simulator dispatch may enter it.
    if (!(active instanceof win.HTMLElement) || !root.contains(active)) return;
    if (active.closest('[data-ccp-ignore]') || (event.target instanceof win.HTMLElement && event.target.closest('[data-ccp-ignore]'))) return;
    if (state.mode === 'editing' || (isEditable(active) && active !== state.target)) {
      if (action !== 'back' && action !== 'select' && !(isAdjustable(active) && active.matches('[readonly]'))) return;
      if (active !== state.target) focus(active, 'editing');
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || heldKeys.has(event.code || event.key)) return;
    heldKeys.add(event.code || event.key);
    dispatch(action, 'keyboard');
  }
  function keyup(event: KeyboardEvent) { heldKeys.delete(event.code || event.key); }
  function blur() { heldKeys.clear(); }
  function focusin(event: FocusEvent) {
    if (movingFocus || !(event.target instanceof win.HTMLElement)) return;
    reconcile();
    const target = event.target;
    // Opening a dialog can synchronously redirect its browser focus to the CCP
    // default during reconcile. Do not replay the now-stale original focusin.
    if (doc.activeElement !== target) return;
    if (scope !== root && !scope.contains(target)) { focus(state.target && scope.contains(state.target) ? state.target : targets[0] ?? null); return; }
    if (root.contains(target) && targets.includes(target)) focus(target, isEditable(target) ? 'editing' : 'navigation');
  }
  function pointerdown(event: PointerEvent) {
    if (!(event.target instanceof win.HTMLElement) || !root.contains(event.target)) return;
    state = { ...state, active: false };
    publish();
  }
  function nativeInput(event: Event) {
    const detail = (event as CustomEvent<CcpInputDetail>).detail;
    if (!detail || !isCcpAction(detail.action) || !['android', 'simulator'].includes(detail.source) || detail.repeat) return;
    dispatch(detail.action, detail.source);
  }
  const observer = new win.MutationObserver(() => reconcile());
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'disabled', 'hidden', 'inert', 'aria-hidden', 'aria-disabled', 'class', 'style', 'aria-label'] });
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('keyup', keyup, true);
  doc.addEventListener('focusin', focusin);
  doc.addEventListener('pointerdown', pointerdown);
  win.addEventListener('blur', blur);
  win.addEventListener('pleos-ccp-input', nativeInput);
  return {
    dispatch,
    reconcile,
    getState: () => state,
    destroy() {
      disposed = true;
      observer.disconnect();
      doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('keyup', keyup, true);
      doc.removeEventListener('focusin', focusin);
      doc.removeEventListener('pointerdown', pointerdown);
      win.removeEventListener('blur', blur);
      win.removeEventListener('pleos-ccp-input', nativeInput);
      state.target?.removeAttribute('data-ccp-focused');
      delete doc.documentElement.dataset.ccpActive;
    },
  };
}
