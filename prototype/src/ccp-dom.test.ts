// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCcpController, getCcpTargets } from './ccp';

let controller: ReturnType<typeof createCcpController>;
let root: HTMLElement;
function button(id: string) { return root.querySelector<HTMLButtonElement>(`#${id}`)!; }
function key(key: string, repeat = false) { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, repeat, bubbles: true, cancelable: true })); }
function up(key: string) { document.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true })); }
function tick() { return new Promise<void>(resolve => queueMicrotask(resolve)); }

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return [{ left: 0, top: 0, width: 50, height: 50, right: 50, bottom: 50 }] as unknown as DOMRectList;
  });
  document.body.innerHTML = '<button id="outside">outside</button><main data-ccp-root><section data-ccp-area="watch"><button id="a" aria-pressed="true">Stock A</button><button id="disabled" disabled>disabled</button><button id="b">Stock B</button><button id="hidden" hidden>hidden</button><input id="quantity" type="number" value="2" aria-label="수량"></section><section data-ccp-area="nav"><button id="c">Orders</button></section></main>';
  root = document.querySelector('[data-ccp-root]')!;
  controller = createCcpController(root);
});
afterEach(() => { controller?.destroy(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('CCP DOM input contract', () => {
  it('skips disabled/hidden targets and keeps selected stock independent of focus', () => {
    expect(getCcpTargets(root).map(item => item.id)).toEqual(['a', 'b', 'quantity', 'c']);
    controller.dispatch('next');
    expect(document.activeElement).toBe(button('a'));
    controller.dispatch('next');
    expect(document.activeElement).toBe(button('b'));
    expect(button('a').getAttribute('aria-pressed')).toBe('true');
    expect(button('b').getAttribute('aria-pressed')).toBeNull();
    expect(controller.getState()).toMatchObject({ label: 'Stock B', area: 'watch', active: true });
  });
  it('executes one existing click per key press and ignores repeat keydowns', () => {
    const click = vi.fn(); button('a').onclick = click;
    controller.dispatch('next');
    key('Enter'); key('Enter', true); key('Enter');
    expect(click).toHaveBeenCalledTimes(1);
    up('Enter'); key('Enter');
    expect(click).toHaveBeenCalledTimes(2);
  });
  it('leaves keyboard defaults in ignored controls without clicking the previous CCP target', () => {
    const previousClick = vi.fn(); button('a').onclick = previousClick;
    controller.dispatch('next');
    const ignored = document.createElement('section'); ignored.dataset.ccpIgnore = '';
    ignored.innerHTML = '<button>Simulator control</button>';
    root.append(ignored);
    const control = ignored.querySelector('button')!;
    control.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    control.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(previousClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(control);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    control.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
  });
  it('keeps the CCP default after the browser initial dialog focus, then respects user focus changes', async () => {
    controller.dispatch('next');
    const dialog = document.createElement('dialog'); dialog.open = true;
    dialog.innerHTML = '<button id="dialog-close">Close</button><input id="dialog-quantity" type="number" data-ccp-default value="2"><button id="dialog-order">Order</button>';
    root.append(dialog);
    // showModal focuses its first button synchronously before MutationObserver runs.
    dialog.querySelector<HTMLElement>('#dialog-close')!.focus();
    await tick();
    expect(document.activeElement?.id).toBe('dialog-quantity');
    expect(controller.getState()).toMatchObject({ mode: 'navigation', target: dialog.querySelector('#dialog-quantity') });
    const close = dialog.querySelector<HTMLElement>('#dialog-close')!;
    close.focus();
    expect(document.activeElement).toBe(close);
    expect(controller.getState().target).toBe(close);
    const quantity = dialog.querySelector<HTMLInputElement>('#dialog-quantity')!;
    quantity.focus();
    expect(controller.getState().mode).toBe('editing');
  });
  it('never handles keyboard actions outside the app root', () => {
    document.querySelector<HTMLElement>('#outside')!.focus();
    key('ArrowDown');
    expect(controller.getState().active).toBe(false);
    expect(document.activeElement?.id).toBe('outside');
  });
  it('lets directly focused numeric input receive arrows, and exits editing before dialog cancel', () => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.focus();
    expect(controller.getState().mode).toBe('editing');
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    key('Escape');
    expect(controller.getState().mode).toBe('navigation');
    expect(document.activeElement).toBe(input);
  });
  it('traps active dialog navigation, cancels through its handler, and restores the opener', async () => {
    controller.dispatch('next'); controller.dispatch('next');
    const dialog = document.createElement('dialog');
    dialog.open = true;
    dialog.innerHTML = '<button id="close">Close</button><button id="submit">Order</button>';
    const cancel = vi.fn(() => dialog.remove());
    dialog.addEventListener('cancel', cancel);
    root.append(dialog);
    await tick();
    expect(document.activeElement?.id).toBe('close');
    controller.dispatch('previous');
    expect(document.activeElement?.id).toBe('submit');
    document.querySelector<HTMLElement>('#outside')!.focus();
    expect(document.activeElement?.id).toBe('submit');
    controller.dispatch('next');
    expect(document.activeElement?.id).toBe('close');
    controller.dispatch('back'); await tick();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toBe('b');
  });
  it('does not activate a replacement when the selected target disappears or becomes disabled', () => {
    controller.dispatch('next');
    const click = vi.fn(); button('b').onclick = click;
    button('a').remove();
    controller.dispatch('select');
    expect(document.activeElement).toBe(button('b'));
    expect(click).not.toHaveBeenCalled();
    button('b').disabled = true;
    controller.dispatch('select');
    expect(document.activeElement?.id).toBe('quantity');
    expect(click).not.toHaveBeenCalled();
  });
  it('keeps focus inside a dialog even when it has no enabled controls', async () => {
    controller.dispatch('next');
    const dialog = document.createElement('dialog'); dialog.open = true;
    dialog.innerHTML = '<button disabled>Unavailable</button>';
    root.append(dialog); await tick();
    expect(document.activeElement).toBe(dialog);
    document.querySelector<HTMLElement>('#outside')!.focus();
    expect(document.activeElement).toBe(dialog);
    controller.dispatch('next');
    expect(document.activeElement).toBe(dialog);
  });
  it('restores each opener across nested dialogs', async () => {
    controller.dispatch('next');
    const outer = document.createElement('dialog'); outer.open = true;
    outer.innerHTML = '<button id="outer-opener">Open nested</button>';
    root.append(outer); await tick();
    const inner = document.createElement('dialog'); inner.open = true;
    inner.innerHTML = '<button>Nested close</button>';
    outer.append(inner); await tick();
    inner.remove(); await tick();
    expect(document.activeElement?.id).toBe('outer-opener');
    outer.remove(); await tick();
    expect(document.activeElement?.id).toBe('a');
  });
  it('uses the current enabled default target without changing selected rows on focus', () => {
    button('b').setAttribute('data-ccp-default', '');
    controller.dispatch('next');
    expect(document.activeElement).toBe(button('b'));
    button('b').removeAttribute('data-ccp-default');
    button('a').setAttribute('data-ccp-default', '');
    controller.reconcile();
    expect(document.activeElement).toBe(button('b'));
  });
  it('uses existing quantity button clicks for native rotary editing including readOnly fields', () => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    const wrapper = document.createElement('div'); wrapper.dataset.ccpAdjust = '';
    input.replaceWith(wrapper); wrapper.append(input); input.readOnly = true;
    const decrement = document.createElement('button'); decrement.dataset.ccpDecrement = '';
    const increment = document.createElement('button'); increment.dataset.ccpIncrement = '';
    wrapper.prepend(decrement); wrapper.append(increment);
    const minus = vi.fn(); const plus = vi.fn();
    decrement.onclick = minus; increment.onclick = plus;
    controller.dispatch('next'); controller.dispatch('next'); controller.dispatch('next'); controller.dispatch('next');
    expect(document.activeElement).toBe(input);
    expect(controller.getState().mode).toBe('navigation');
    controller.dispatch('select', 'android');
    expect(controller.getState().mode).toBe('editing');
    controller.dispatch('next', 'android'); controller.dispatch('up', 'android'); controller.dispatch('right', 'android');
    controller.dispatch('previous', 'android'); controller.dispatch('down', 'android'); controller.dispatch('left', 'android');
    expect(plus).toHaveBeenCalledTimes(3); expect(minus).toHaveBeenCalledTimes(3);
    increment.disabled = true; decrement.disabled = true;
    controller.dispatch('next', 'android'); controller.dispatch('previous', 'android');
    expect(plus).toHaveBeenCalledTimes(3); expect(minus).toHaveBeenCalledTimes(3);
    expect(document.activeElement).toBe(input);
    controller.dispatch('select');
    expect(controller.getState().mode).toBe('navigation');
  });
  it('can adjust after direct numeric input without native focus creating a duplicate click', () => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    const wrapper = document.createElement('div'); wrapper.dataset.ccpAdjust = '';
    input.replaceWith(wrapper); wrapper.append(input);
    const increment = document.createElement('button'); increment.dataset.ccpIncrement = ''; wrapper.append(increment);
    const plus = vi.fn(); increment.onclick = plus;
    input.focus(); input.value = '5'; input.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new CustomEvent('pleos-ccp-input', { detail: { action: 'next', source: 'android' } }));
    expect(plus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    expect(controller.getState().mode).toBe('editing');
    expect(input.value).toBe('5');
  });
  it('preserves browser arrows for editable quantity while suppressing readonly adjustment repeats', () => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    const wrapper = document.createElement('div'); wrapper.dataset.ccpAdjust = '';
    input.replaceWith(wrapper); wrapper.append(input);
    const increment = document.createElement('button'); increment.dataset.ccpIncrement = ''; wrapper.append(increment);
    const plus = vi.fn(); increment.onclick = plus;
    input.focus();
    const regular = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }); input.dispatchEvent(regular);
    expect(regular.defaultPrevented).toBe(false); expect(plus).not.toHaveBeenCalled();
    input.readOnly = true;
    key('ArrowUp'); key('ArrowUp', true);
    expect(plus).toHaveBeenCalledTimes(1);
    up('ArrowUp'); key('ArrowUp');
    expect(plus).toHaveBeenCalledTimes(2);
  });
  it('handles validated Android input events and ignores repeat and malformed events', () => {
    window.dispatchEvent(new CustomEvent('pleos-ccp-input', { detail: { action: 'next', source: 'android' } }));
    expect(controller.getState()).toMatchObject({ source: 'android', label: 'Stock A' });
    const click = vi.fn(); button('a').onclick = click;
    window.dispatchEvent(new CustomEvent('pleos-ccp-input', { detail: { action: 'select', source: 'android', repeat: true } }));
    window.dispatchEvent(new CustomEvent('pleos-ccp-input', { detail: { action: 'select', source: 'untrusted' } }));
    expect(click).not.toHaveBeenCalled();
  });
  it('backs out of input editing before cancelling a dialog and invokes app back outside it', async () => {
    controller.destroy();
    const back = vi.fn();
    controller = createCcpController(root, { onBack: back });
    const dialog = document.createElement('dialog'); dialog.open = true;
    dialog.innerHTML = '<input type="number" aria-label="수량" value="3"><button>Order</button>';
    const cancel = vi.fn(() => dialog.remove()); dialog.addEventListener('cancel', cancel);
    root.append(dialog); await tick();
    controller.dispatch('select');
    expect(controller.getState().mode).toBe('editing');
    controller.dispatch('back');
    expect(cancel).not.toHaveBeenCalled();
    controller.dispatch('back'); await tick();
    expect(cancel).toHaveBeenCalledTimes(1);
    controller.dispatch('back');
    expect(back).toHaveBeenCalledTimes(1);
  });
});
