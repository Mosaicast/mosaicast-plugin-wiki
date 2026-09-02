// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockCtx, makeMockSchema, type MockSchemaClient } from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush } from '../test-utils';

const KRAKEN = {
  id: 1,
  slug: 'the-kraken',
  title: 'The Kraken',
  summary: 'A very large squid.',
  markdown:
    '## Sightings\n\nSeen off [[deep-sea|the deep]] and in [[episode:s01e02@12:04|the bit]].\n\n## Size\n\nUnmeasured.',
  // The backend maintains this as title + tags + summary + body, because `search` takes ONE field.
  searchText: 'The Kraken\nlore,sea\nA very large squid.\nSeen off the deep.',
  tags: 'lore,sea',
  status: 'published',
  updatedAt: '2026-08-01T10:00:00Z',
  revisionNo: 3,
};

const INDEX = {
  'the-kraken': { title: 'The Kraken', summary: 'A very large squid.', tags: 'lore,sea', updatedAt: '2026-08-01T10:00:00Z' },
  'deep-sea': { title: 'The deep sea', summary: null, tags: 'lore', updatedAt: '2026-07-01T10:00:00Z' },
};

/** The recording schema double behind a context. `ctx.schema` is typed as the plain read-only client. */
const schemaOf = (ctx: ReturnType<typeof makeMockCtx>) => ctx.schema as MockSchemaClient;

/** A context whose schema answers from rows, and whose index document is already populated. */
function ctxFor(path: string, rows: Record<string, Record<string, unknown>[]> = {}) {
  return makeMockCtx({
    route: { path },
    apiResponses: { 'data/site/main/index': INDEX },
    schema: makeMockSchema({ page: [KRAKEN], link: [], source: [], media: [], revision: [], ...rows }),
  });
}

describe('<WikiPage> — reader', () => {
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

  it('renders the page the route names', async () => {
    const ctx = ctxFor('the-kraken');

    await render(ctx);

    expect(host.textContent).toContain('The Kraken');
    expect(host.textContent).toContain('Sightings');
    expect(ctx.logs).toEqual([]);
  });

  it('queries the schema for the page, its backlinks and its sources', async () => {
    const ctx = ctxFor('the-kraken');

    await render(ctx);

    const entities = schemaOf(ctx).queries.map((q) => q.entity);
    expect(entities).toContain('page');
    expect(entities).toContain('link');
    expect(entities).toContain('source');
  });

  it('does not show an unpublished page to a visitor who could not edit it', async () => {
    // `readableBy: anonymous` opens the schema *surface*, not each row: core has no model of a wiki page
    // and cannot know that `status` decides who sees one. Without the filter, guessing a draft's URL
    // read its body.
    const draft = { ...KRAKEN, id: 9, slug: 'half-written', title: 'Half written', status: 'draft' };
    const ctx = makeMockCtx({
      route: { path: 'half-written' },
      apiResponses: { 'data/site/main/index': INDEX },
      schema: makeMockSchema({ page: [draft], link: [], source: [], media: [], revision: [] }),
    });

    await render(ctx);

    expect(host.textContent).toContain('This page does not exist yet.');
    expect(host.textContent).not.toContain('Half written');
  });

  it('offers the page\'s other languages, and tags the article with the one it is in', async () => {
    // The switcher is built off the `index` projection, which the backend publishes for published pages
    // only -- so it can advertise a language that exists and nothing else, whoever is looking.
    const german = {
      'der-krake': {
        title: 'Der Krake',
        summary: null,
        tags: null,
        updatedAt: '2026-08-02T10:00:00Z',
        locale: 'de',
        translationOf: 'the-kraken',
      },
    };
    const ctx = makeMockCtx({
      route: { path: 'the-kraken' },
      apiResponses: {
        'data/site/main/index': {
          ...INDEX,
          'the-kraken': { ...INDEX['the-kraken'], locale: 'en', translationOf: null },
          ...german,
        },
      },
      schema: makeMockSchema({
        page: [{ ...KRAKEN, locale: 'en', translationOf: null }],
        link: [],
        source: [],
        media: [],
        revision: [],
      }),
      locale: {
        current: () => 'en',
        onChange: () => () => {},
        available: () => [{ code: 'en', nativeName: 'English', isDefault: true }],
        content: () => [
          { code: 'en', nativeName: 'English', isDefault: true },
          { code: 'de', nativeName: 'Deutsch', isDefault: false },
        ],
      },
    });

    await render(ctx);

    const article = host.querySelector('article');
    expect(article?.getAttribute('lang')).toBe('en');

    // A menu, not a row: the closed control names the language you are reading, and the list is behind it.
    const menu = host.querySelector('.wiki__langmenu');
    expect(menu?.querySelector('summary')?.textContent).toContain('English');
    expect(menu?.querySelector('.wiki__langlist')?.textContent).toContain('Deutsch');
    expect(menu?.querySelector('a')?.getAttribute('hreflang')).toBe('de');
    expect(menu?.querySelector('.wiki__lang--current')?.textContent).toBe('English');
  });

  it('gives the icon-only page controls a name only a screen reader reads', async () => {
    // `Icon` is aria-hidden by contract, so an icon-only control announced as nothing is a control nobody
    // can use. The label leaves the page, not the accessibility tree.
    const ctx = ctxFor('the-kraken', { page: [{ ...KRAKEN, locale: 'en' }] });

    await render(ctx);

    const buttons = [...host.querySelectorAll('.wiki__iconbtn')];
    expect(buttons.map((b) => b.querySelector('.wiki__vh')?.textContent)).toContain('History');
    expect(buttons.every((b) => b.getAttribute('title'))).toBe(true);
  });

  it('never lists a translation that is not published, since the index cannot hold one', async () => {
    const ctx = ctxFor('the-kraken', { page: [{ ...KRAKEN, locale: 'en' }] });

    await render(ctx);

    expect(host.querySelector('.wiki__langmenu')).toBeNull();
  });

  it('states that a page does not exist rather than rendering a blank tile', async () => {
    // A page the ingest tick has not applied yet is genuinely not there. Saying so beats an empty article.
    const ctx = ctxFor('nowhere');

    await render(ctx);

    expect(host.textContent).toContain('This page does not exist yet.');
  });

  it('marks a link to an unwritten page as missing', async () => {
    const ctx = makeMockCtx({
      route: { path: 'the-kraken' },
      apiResponses: { 'data/site/main/index': { 'the-kraken': INDEX['the-kraken'] } },
      schema: makeMockSchema({ page: [KRAKEN], link: [], source: [], media: [], revision: [] }),
    });

    await render(ctx);

    expect(host.querySelector('.wiki-link--missing')).not.toBeNull();
  });

  it('cites an episode at a moment through the host link builder', async () => {
    const ctx = ctxFor('the-kraken');

    await render(ctx);

    const episode = host.querySelector<HTMLAnchorElement>('a[data-ep="s01e02"]');
    expect(episode).not.toBeNull();
    // `?t=` is the host's shape, not ours — hardcoding /episodes/… is what ctx.links exists to prevent.
    expect(episode?.getAttribute('href')).toContain('t=724');
  });

  it('navigates in-place when a wiki link inside the body is clicked', async () => {
    const ctx = ctxFor('the-kraken');
    await render(ctx);

    const link = host.querySelector<HTMLAnchorElement>('a[data-wiki="deep-sea"]')!;
    await act(async () => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(ctx.navigations).toContainEqual({ subpath: 'deep-sea', replace: false });
  });

  it('lists what links to the page, once per linking page', async () => {
    const ctx = ctxFor('the-kraken', {
      link: [
        { id: 1, fromSlug: 'deep-sea', toSlug: 'the-kraken', kind: 'wiki', label: 'the beast' },
        { id: 2, fromSlug: 'deep-sea', toSlug: 'the-kraken', kind: 'wiki', label: 'it' },
      ],
    });

    await render(ctx);

    // Scoped to the backlinks section: the body links to deep-sea too, and that anchor is not a backlink.
    const section = [...host.querySelectorAll('.wiki__section')].find((s) =>
      s.textContent?.includes('Linked from'),
    );
    expect(section).toBeDefined();
    expect(section!.querySelectorAll('a[href="/p/wiki/deep-sea"]').length).toBe(1);
  });

  it('renders the sources the backend extracted, in order', async () => {
    const ctx = ctxFor('the-kraken', {
      source: [
        { id: 1, pageSlug: 'the-kraken', label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Kraken', note: 'accessed 2026-08', position: 0 },
        { id: 2, pageSlug: 'the-kraken', label: 'A book', url: 'https://example.com/book', note: null, position: 1 },
      ],
    });

    await render(ctx);

    const items = [...host.querySelectorAll('.wiki__sources li')].map((li) => li.textContent);
    expect(items[0]).toContain('Wikipedia');
    expect(items[0]).toContain('accessed 2026-08');
    expect(items[1]).toContain('A book');
  });

  it('names the rendered Sources section in the contents list', async () => {
    // The body's own heading is stripped in favour of the extracted rows, so without this the contents
    // list would point at less than the reader can actually see.
    const ctx = ctxFor('the-kraken', {
      source: [
        { id: 1, pageSlug: 'the-kraken', label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Kraken', note: null, position: 0 },
      ],
    });

    await render(ctx);

    const toc = host.querySelector('.wiki__toc');
    expect(toc?.textContent).toContain('Sources');
    expect(toc?.querySelector('a[href="#sources"]')).not.toBeNull();
    expect(host.querySelector('h2#sources')).not.toBeNull();
  });

  it('draws a card for a cited episode, read live rather than from a projection', async () => {
    // ctx.feeds is what the wiki's old episode projection was standing in for: a copy of host data that
    // went stale between ticks. One request for the whole page, never one per card.
    const ctx = ctxFor('the-kraken');
    ctx.feeds.displayMany = async (slugs: string[]) => {
      expect(slugs).toEqual(['s01e02']);   // deduped, and one call
      return {
        s01e02: {
          title: 'Letters from the Bottom of the Sea',
          description: 'A deep dive.',
          publishedAt: '2026-06-07T06:00:00Z',
          duration: 'PT44M11S',
          imageUrl: 'https://cdn.example.com/e2.png',
        },
      };
    };

    await render(ctx);

    const card = host.querySelector('.wiki__epcard');
    expect(card?.textContent).toContain('Letters from the Bottom of the Sea');
    expect(card?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/e2.png');
    // The citation carried @12:04, so the card links to the moment.
    expect(card?.getAttribute('href')).toContain('t=724');
  });

  it('leaves a citation the host says nothing about as a plain link', async () => {
    // A WITHDRAWN or gated episode is absent from the answer rather than redacted, and absence must not
    // read as a failure -- the sentence still has to work.
    const ctx = ctxFor('the-kraken');
    ctx.feeds.displayMany = async () => ({});

    await render(ctx);

    expect(host.querySelector('.wiki__epcard')).toBeNull();
    expect(host.querySelector('a[data-ep="s01e02"]')).not.toBeNull();
    expect(ctx.logs).toEqual([]);
  });

  it('shows the tags as links into the tag view', async () => {
    const ctx = ctxFor('the-kraken');

    await render(ctx);

    expect(host.querySelector('a[href="/p/wiki/_tag/lore"]')).not.toBeNull();
  });
});

describe('<WikiPage> — search', () => {
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

  it('searches the fulltext field and lists the hits', async () => {
    const ctx = ctxFor('_search/kraken');

    await render(ctx);

    const search = schemaOf(ctx).queries.find((q) => q.method === 'search');
    expect(search).toMatchObject({ entity: 'page', field: 'searchText' });
    expect(host.textContent).toContain('The Kraken');
  });

  it('only ever searches published pages', async () => {
    const ctx = ctxFor('_search/kraken');

    await render(ctx);

    const search = schemaOf(ctx).queries.find((q) => q.method === 'search');
    expect(search?.query?.where).toContainEqual({ field: 'status', op: 'eq', value: 'published' });
  });

  it('says nothing was found rather than showing an empty list', async () => {
    const ctx = ctxFor('_search/nothing-matches', { page: [] });

    await render(ctx);

    expect(host.textContent).toContain('Nothing found');
  });

  it('lists the pages carrying a tag', async () => {
    const ctx = ctxFor('_tag/lore');

    await render(ctx);

    expect(host.textContent).toContain('The Kraken');
    expect(host.textContent).toContain('The deep sea');
  });
});
