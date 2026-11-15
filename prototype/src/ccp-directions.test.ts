// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCcpController } from './ccp';

let root: HTMLElement;
let controller: ReturnType<typeof createCcpController>;
const element = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 50, 50)] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(Number(this.dataset.x ?? 0), Number(this.dataset.y ?? 0), 50, 50);
  });
  document.body.innerHTML = `<main>
    <section data-ccp-area="orders" data-ccp-right="selected-stock">
      <button id="buy" data-ccp-target="order-buy">Buy</button>
      <button id="fallback" data-y="120">Other order control</button>
    </section>
    <section id="watch" data-ccp-area="watch" data-ccp-left="order-buy">
      <button id="other" data-x="300">Other stock</button>
      <button id="selected" data-x="300" data-y="120" data-ccp-target="selected-stock" aria-pressed="true">Selected stock</button>
    </section>
  </main>`;
  root = document.querySelector('main')!;
  controller = createCcpController(root);
});
afterEach(() => { controller.destroy(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('CCP explicit direction links', () => {
  it('moves from the current watch row to Buy without selecting a stock or placing an order', () => {
    const buy = vi.fn(); const select = vi.fn();
    element('buy').onclick = buy; element('selected').onclick = select;
    element('selected').focus();
    controller.dispatch('left');
    expect(document.activeElement).toBe(element('buy'));
    expect(controller.getState()).toMatchObject({ target: element('buy'), mode: 'navigation', area: 'orders' });
    expect(element('selected').getAttribute('aria-pressed')).toBe('true');
    expect(buy).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });

  it('returns from Buy to the currently selected stock instead of the nearer geometric row', () => {
    element('buy').focus(); controller.dispatch('right');
    expect(document.activeElement).toBe(element('selected'));
    element('selected').removeAttribute('data-ccp-target');
    element('other').setAttribute('data-ccp-target', 'selected-stock');
    element('buy').focus(); controller.dispatch('right');
    expect(document.activeElement).toBe(element('other'));
  });

  it('preserves rotary document order and wrapping with links present', () => {
    element('selected').focus(); controller.dispatch('previous');
    expect(document.activeElement).toBe(element('other'));
    controller.dispatch('next'); controller.dispatch('next');
    expect(document.activeElement).toBe(element('buy'));
    controller.dispatch('previous');
    expect(document.activeElement).toBe(element('selected'));
  });

  it.each(['missing', 'hidden', 'disabled', 'aria-disabled', 'ignored'] as const)('uses geometry when the named destination is %s', unavailable => {
    const buy = element('buy');
    if (unavailable === 'missing') buy.setAttribute('data-ccp-target', 'different');
    if (unavailable === 'hidden') buy.hidden = true;
    if (unavailable === 'disabled') buy.setAttribute('disabled', '');
    if (unavailable === 'aria-disabled') buy.setAttribute('aria-disabled', 'true');
    if (unavailable === 'ignored') buy.setAttribute('data-ccp-ignore', '');
    element('selected').focus(); controller.dispatch('left');
    expect(document.activeElement).toBe(element('fallback'));
  });

  it('matches destination names literally even when they contain CSS selector characters', () => {
    const name = 'buy"] , button:not([disabled]) [';
    element('watch').setAttribute('data-ccp-left', name);
    element('buy').setAttribute('data-ccp-target', name);
    element('selected').focus();
    expect(() => controller.dispatch('left')).not.toThrow();
    expect(document.activeElement).toBe(element('buy'));
  });

  it('keeps a modal link inside its scope and falls back to a modal control', () => {
    const dialog = document.createElement('dialog'); dialog.open = true;
    dialog.innerHTML = '<button id="modal-fallback">Modal control</button><button id="modal-origin" data-x="300" data-ccp-left="order-buy">Modal origin</button>';
    root.append(dialog); controller.reconcile();
    element('modal-origin').focus(); controller.dispatch('left');
    expect(document.activeElement).toBe(element('modal-fallback'));
    expect(dialog.contains(controller.getState().target)).toBe(true);
    element('modal-fallback').setAttribute('data-ccp-target', 'order-buy');
    element('modal-origin').focus(); controller.dispatch('left');
    expect(document.activeElement).toBe(element('modal-fallback'));
  });

  it('does not inherit a direction binding from outside the active modal scope', () => {
    root.setAttribute('data-ccp-left', 'far-control');
    const dialog = document.createElement('dialog'); dialog.open = true;
    dialog.innerHTML = '<button id="near">Near control</button><button id="far" data-y="200" data-ccp-target="far-control">Far control</button><button id="origin" data-x="300">Origin</button>';
    root.append(dialog); controller.reconcile();
    element('origin').focus(); controller.dispatch('left');
    expect(document.activeElement).toBe(element('near'));
  });

  it('keeps numeric editing adjustments ahead of explicit navigation links', () => {
    const wrapper = document.createElement('div'); wrapper.dataset.ccpAdjust = '';
    wrapper.innerHTML = '<input id="quantity" type="number" readonly data-ccp-right="order-buy" value="2"><button id="increment" data-ccp-increment>Increase</button>';
    root.append(wrapper); controller.reconcile();
    const increment = vi.fn(); element('increment').onclick = increment;
    element('quantity').focus(); controller.dispatch('select');
    controller.dispatch('right');
    expect(document.activeElement).toBe(element('quantity'));
    expect(controller.getState().mode).toBe('editing');
    expect(increment).toHaveBeenCalledTimes(1);
  });
});
