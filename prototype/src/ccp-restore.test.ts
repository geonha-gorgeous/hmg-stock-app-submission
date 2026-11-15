// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCcpController } from './ccp';

let root: HTMLElement;
let controller: ReturnType<typeof createCcpController>;
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

function openDialog(id: string, parent = root) {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.open = true;
  dialog.dataset.ccpArea = id;
  dialog.innerHTML = '<button>Close</button>';
  parent.append(dialog);
  return dialog;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 50, 50)] as unknown as DOMRectList);
  document.body.innerHTML = '<main><section data-ccp-area="Orders"><button data-ccp-default>Default</button><button id="buy">Buy</button></section></main>';
  root = document.querySelector('main')!;
  controller = createCcpController(root);
  root.querySelector<HTMLElement>('#buy')!.focus();
});
afterEach(() => { controller.destroy(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('CCP dialog focus restoration', () => {
  it.each(['remove', 'close'] as const)('restores the opener and panel immediately after pointer %s', async action => {
    const buy = root.querySelector<HTMLElement>('#buy')!;
    const clicked = vi.fn(); buy.onclick = clicked;
    const dialog = openDialog('Order result');
    await tick();
    const close = dialog.querySelector('button')!;
    close.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    close.focus();
    if (action === 'remove') dialog.remove();
    else dialog.open = false;
    await tick();
    expect(document.activeElement).toBe(buy);
    expect(controller.getState()).toMatchObject({ active: false, mode: 'navigation', target: buy, label: 'Buy', area: 'Orders' });
    expect(close.hasAttribute('data-ccp-focused')).toBe(false);
    expect(buy.getAttribute('data-ccp-focused')).toBe('true');
    expect(clicked).not.toHaveBeenCalled();
    controller.dispatch('select');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('retains a non-default opener through nested pointer-closed dialogs', async () => {
    const outer = openDialog('outer'); await tick();
    const inner = openDialog('inner', outer); await tick();
    inner.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    inner.remove(); await tick();
    expect(document.activeElement).toBe(outer.querySelector('button'));
    outer.remove(); await tick();
    expect(document.activeElement?.id).toBe('buy');
  });

  it('preserves the original opener when one dialog replaces another', async () => {
    const first = openDialog('voice'); await tick();
    first.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    first.remove();
    const next = openDialog('order'); await tick();
    expect(document.activeElement).toBe(next.querySelector('button'));
    next.remove(); await tick();
    expect(document.activeElement?.id).toBe('buy');
  });

  it('uses a valid default without activating it when the opener was removed', async () => {
    const dialog = openDialog('result'); await tick();
    const defaultButton = root.querySelector<HTMLButtonElement>('[data-ccp-default]')!;
    const clicked = vi.fn(); defaultButton.onclick = clicked;
    root.querySelector('#buy')!.remove();
    dialog.querySelector('button')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dialog.remove(); await tick();
    expect(document.activeElement).toBe(defaultButton);
    expect(controller.getState()).toMatchObject({ target: defaultButton, label: 'Default', area: 'Orders' });
    expect(clicked).not.toHaveBeenCalled();
  });
});
