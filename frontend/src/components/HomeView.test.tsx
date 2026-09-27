// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockCtx, makeMockDocs, makeMockSchema } from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush, mockUser } from '../test-utils';

const INDEX = {
  'the-kraken': { title: 'The Kraken', summary: 'A very large squid.', tags: 'lore', updatedAt: '2026-08-03T10:00:00Z' },
  'main-page': { title: 'Welcome', summary: 'The front page.', tags: null, updatedAt: '2026-08-02T10:00:00Z' },
  'deep-sea': { title: 'The deep sea', summary: 'Below 200 metres.', tags: 'lore', updatedAt: '2026-08-01T10:00:00Z' },
};

const HOME = {
  slug: 'main-page',
  title: 'Welcome to the wiki',
  markdown: 'Notes the crew keeps between episodes.\n\nStart with [[the-kraken]].',
  updatedAt: '2026-08-02T10:00:00Z',
};

function ctxFor(overrides: Parameters<typeof makeMockCtx>[0] = {}, home: unknown = HOME) {
  return makeMockCtx({
    route: { path: '' },
    docs: makeMockDocs({ 'data/site/main/index': INDEX, ...(home ? { 'data/site/main/home': home } : {}) }),
    schema: makeMockSchema({ page: [], link: [], source: [], media: [], revision: [] }),
    ...overrides,
  });
}

describe('<HomeView>', () => {
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
    await flush();
  };

  it('renders the front page a podcaster wrote', async () => {
    const ctx = ctxFor();

    await render(ctx);

    expect(host.textContent).toContain('Welcome to the wiki');
    expect(host.textContent).toContain('Notes the crew keeps between episodes.');
  });

  it('renders the front page through the same sanitiser a page body gets', async () => {
    // The front page IS a wiki page, so it is author input reaching the DOM and gets no exemption.
    const ctx = ctxFor({}, { ...HOME, markdown: 'Hi <script>alert(1)</script>' });

    await render(ctx);

    expect(host.innerHTML).not.toContain('<script');
    expect(host.textContent).toContain('Hi');
  });

  it('resolves wiki links inside the front page', async () => {
    const ctx = ctxFor();

    await render(ctx);

    expect(host.querySelector('a[data-wiki="the-kraken"]')).not.toBeNull();
  });

  it('still works when nobody has written a front page', async () => {
    // The state every new install is in: it has to look deliberate, not broken.
    const ctx = ctxFor({}, null);

    await render(ctx);

    expect(host.textContent).toContain('Somewhere to start');
    expect(host.textContent).toContain('Recently updated');
  });

  it('offers to write one only to someone who could', async () => {
    await render(ctxFor({}, null));
    expect(host.textContent).not.toContain('Write one');
  });

  it('offers it to a podcaster', async () => {
    await render(ctxFor({ user: mockUser('u1', 'podcaster') }, null));
    expect(host.textContent).toContain('Write one');
  });

  it('shows a random page with its summary, and can pick another', async () => {
    const ctx = ctxFor();

    await render(ctx);

    const card = [...host.querySelectorAll('.wiki__section')].find((s) => s.textContent?.includes('Somewhere to start'));
    expect(card).toBeDefined();
    // Whichever it picked, it is one of the pages and it shows that page's own summary.
    const summaries = Object.values(INDEX).map((p) => p.summary);
    expect(summaries.some((s) => card!.textContent?.includes(s!))).toBe(true);
    expect(card!.querySelector('button')).not.toBeNull();
  });

  it('never offers the front page as somewhere to start', async () => {
    // The reader is already on it.
    const ctx = ctxFor();

    await render(ctx);

    const card = [...host.querySelectorAll('.wiki__section')].find((s) => s.textContent?.includes('Somewhere to start'));
    expect(card?.querySelector('a[href="/p/wiki/main-page"]')).toBeNull();
  });

  it('links on to the full index rather than listing everything', async () => {
    const ctx = ctxFor();

    await render(ctx);

    expect(host.querySelector('a[href="/p/wiki/_all"]')).not.toBeNull();
  });
});

describe('the article lead', () => {
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

  const readerFor = (summary: string, markdown: string) =>
    makeMockCtx({
      route: { path: 'the-kraken' },
      docs: makeMockDocs({ 'data/site/main/index': INDEX }),
      schema: makeMockSchema({
        page: [{ id: 1, slug: 'the-kraken', title: 'The Kraken', summary, markdown, searchText: '', tags: '', status: 'published', updatedAt: null, revisionNo: 1 }],
        link: [], source: [], media: [], revision: [],
      }),
    });

  const render = async (ctx: ReturnType<typeof makeMockCtx>) => {
    await act(async () => {
      root.render(<WikiPage ctx={ctx} />);
    });
    await flush();
    await flush();
  };

  it('shows a written summary above the article', async () => {
    await render(readerFor('A cephalopod of unusual size.', 'The Kraken is a legend of the northern seas.'));

    expect(host.querySelector('.wiki__lead')?.textContent).toBe('A cephalopod of unusual size.');
  });

  it('does not repeat a summary the backend derived from the first paragraph', async () => {
    // The derivation takes exactly this paragraph, so printing it as a lead as well shows it twice —
    // which reads as a bug rather than as an encyclopedia's opening line.
    const first = 'The Kraken is a legend of the northern seas.';
    await render(readerFor(first, `${first}\n\nMore below.`));

    expect(host.querySelector('.wiki__lead')).toBeNull();
    expect(host.textContent).toContain(first);
  });

  it('shows no lead when a page has no summary at all', async () => {
    await render(readerFor('', 'Just a body.'));

    expect(host.querySelector('.wiki__lead')).toBeNull();
  });
});
