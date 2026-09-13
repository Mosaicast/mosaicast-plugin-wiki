// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import type { MosaicastHandle, PluginContext } from '@mosaicast/plugin-sdk';
import { makeMockCtx } from '@mosaicast/plugin-sdk/testing';
import { mount } from './wiki-element';
import './wiki-element';

/**
 * What a reassigned `ctx` costs this plugin.
 *
 * The three elements used to return a bare cleanup callback, which tells the SDK to unmount the React
 * root, clear the host element and render from scratch — losing an unsaved editor body, the caret in it,
 * an open picker and every in-flight request. They now return a handle with an `update`, so the SDK hands
 * the new context to the tree that is already mounted.
 *
 * Two levels are tested because they fail differently: {@link mount} is the mechanism, and asserting
 * component *state* there is the only way to show that a re-render is not a remount in disguise; the
 * elements are the wiring, where the observable is that the rendered DOM is the same DOM afterwards.
 */

/** A component that would lose something real if it were remounted. */
function Counter({ ctx }: { ctx: PluginContext }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" data-path={ctx.route.path} onClick={() => setCount(count + 1)}>
      {count}
    </button>
  );
}

describe('mount', () => {
  it('hands a new ctx to the tree it already rendered, keeping component state', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    // The initial render is wrapped too: `createRoot().render()` is asynchronous, so without this the
    // first query runs before React has committed anything.
    let handle!: MosaicastHandle;
    await act(async () => {
      handle = mount(root, makeMockCtx(), (c) => <Counter ctx={c} />);
    });
    // Named explicitly: every `handle.update?.(…)` below is a silent no-op if this is ever dropped, and
    // a test that passes because nothing happened is worse than no test.
    expect(handle.update).toBeTypeOf('function');
    expect(handle.destroy).toBeTypeOf('function');

    const button = root.querySelector('button');
    await act(async () => {
      button?.click();
    });
    expect(button?.textContent).toBe('1');

    await act(async () => {
      handle.update?.(makeMockCtx());
    });

    // The same button, still holding the state a remount would have reset to 0. This is the assertion the
    // whole change exists for.
    expect(root.querySelector('button')).toBe(button);
    expect(button?.textContent).toBe('1');
    expect(button?.isConnected).toBe(true);

    await act(async () => {
      handle.destroy?.();
    });
    expect(root.querySelector('button')).toBeNull();
  });

  it('renders what the new ctx says, not a stale copy of the old one', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    let handle!: MosaicastHandle;
    await act(async () => {
      handle = mount(root, makeMockCtx({ route: { path: 'the-kraken' } }), (c) => <Counter ctx={c} />);
    });
    expect(root.querySelector('button')?.dataset.path).toBe('the-kraken');

    // Surviving a new context is worthless if the render then ignores it: `update` must re-render with
    // the context it was handed, not merely leave the old tree standing.
    await act(async () => {
      handle.update?.(makeMockCtx({ route: { path: 'der-krake' } }));
    });

    expect(root.querySelector('button')?.dataset.path).toBe('der-krake');

    await act(async () => {
      handle.destroy?.();
    });
  });
});

describe('the wiki elements', () => {
  it.each(['wiki-page', 'wiki-site-card', 'wiki-episode-mentions'])('%s is defined', (tag) => {
    expect(customElements.get(tag)).toBeDefined();
  });

  it('keeps its rendered DOM when the host hands it a new ctx', async () => {
    const element = document.createElement('wiki-page') as HTMLElement & { ctx?: unknown };
    document.body.appendChild(element);
    await act(async () => {
      element.ctx = makeMockCtx();
    });

    // The SDK's own container is always there; what matters is what the render put inside it.
    const container = element.shadowRoot?.querySelector('div') as HTMLElement;
    const rendered = container.firstElementChild;
    expect(rendered).not.toBeNull();

    // A *different* context object: the SDK ignores an identical one outright, so reassigning the same
    // instance would pass without the handle doing anything.
    await act(async () => {
      element.ctx = makeMockCtx();
    });

    // Destroy-and-render would have unmounted the React root and called `replaceChildren()` on the
    // container, leaving this node detached and a new one in its place.
    expect(container.firstElementChild).toBe(rendered);
    expect(rendered?.isConnected).toBe(true);

    element.remove();
  });

  it('still tears the render down on a real disconnect', async () => {
    const element = document.createElement('wiki-page') as HTMLElement & { ctx?: unknown };
    document.body.appendChild(element);
    await act(async () => {
      element.ctx = makeMockCtx();
    });
    const rendered = element.shadowRoot?.querySelector('div')?.firstElementChild;
    expect(rendered).not.toBeNull();

    // `destroy` is what a disconnect still means; only `update` was taken off that path.
    await act(async () => {
      element.remove();
    });

    expect(rendered?.isConnected).toBe(false);
  });
});
