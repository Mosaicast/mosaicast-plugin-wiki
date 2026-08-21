// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockCtx } from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush } from '../test-utils';

/**
 * Component tests against `makeMockCtx`, the SDK's own double — preferred over a hand-rolled context
 * because it stays in sync with the contract (every `onChange` returns an `Unsubscribe`, `consent` has all
 * four methods) across SDK bumps, and it records `api.calls` and `navigations` for us.
 */
describe('<WikiPage>', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = async (ctx: ReturnType<typeof makeMockCtx>) => {
    await act(async () => {
      root.render(<WikiPage ctx={ctx} />);
    });
    await flush();
  };

  it('reads the page index from the site scope', async () => {
    const ctx = makeMockCtx({ apiResponses: { 'data/site/main/index': {} } });

    await render(ctx);

    expect(ctx.api.calls).toContainEqual({ method: 'get', path: 'data/site/main/index' });
  });

  it('states that the wiki is empty rather than rendering a blank tile', async () => {
    const ctx = makeMockCtx({ apiResponses: { 'data/site/main/index': {} } });

    await render(ctx);

    expect(host.textContent).toContain('No pages yet.');
    expect(ctx.logs).toEqual([]);
  });

  it('treats a missing index document as empty, not as a failure', async () => {
    // A wiki nobody has written to has no `index` document at all. A 404 here is the correct answer, and
    // showing an error for it would make a healthy empty install look broken.
    const ctx = makeMockCtx();

    await render(ctx);

    expect(host.textContent).toContain('No pages yet.');
    expect(host.textContent).not.toContain('could not be loaded');
  });

  it('lists the pages the index carries', async () => {
    const ctx = makeMockCtx({
      apiResponses: {
        'data/site/main/index': {
          'the-kraken': { title: 'The Kraken', summary: 'A very large squid.', tags: 'lore', updatedAt: '2026-08-01T10:00:00Z' },
        },
      },
    });

    await render(ctx);

    expect(host.textContent).toContain('The Kraken');
    expect(host.textContent).toContain('A very large squid.');
    expect(host.querySelector('a[href="/p/wiki/the-kraken"]')).not.toBeNull();
  });

  it('navigates within its own subtree instead of reloading the shell', async () => {
    const ctx = makeMockCtx({
      apiResponses: {
        'data/site/main/index': { 'the-kraken': { title: 'The Kraken', summary: null, tags: null, updatedAt: null } },
      },
    });
    await render(ctx);

    const link = host.querySelector<HTMLAnchorElement>('a[href="/p/wiki/the-kraken"]')!;
    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(ctx.navigations).toContainEqual({ subpath: 'the-kraken', replace: false });
  });

  it('keeps a real href so middle-click and crawlers still work', async () => {
    const ctx = makeMockCtx({
      apiResponses: {
        'data/site/main/index': { 'the-kraken': { title: 'The Kraken', summary: null, tags: null, updatedAt: null } },
      },
    });

    await render(ctx);

    expect(host.querySelector<HTMLAnchorElement>('a[href="/p/wiki/the-kraken"]')?.getAttribute('href'))
      .toBe('/p/wiki/the-kraken');
  });

  it('sends a search to its own _search route, since the subpath carries no query string', async () => {
    const ctx = makeMockCtx({ apiResponses: { 'data/site/main/index': {} } });
    await render(ctx);

    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const form = host.querySelector('form')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'deep sea');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(ctx.navigations).toContainEqual({ subpath: '_search/deep%20sea', replace: false });
  });
});
