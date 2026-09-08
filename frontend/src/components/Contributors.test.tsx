// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockCtx, makeMockSchema, makeMockUsers } from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush } from '../test-utils';

/**
 * Contributors: the ids the wiki stores, rendered as the people who wrote the pages.
 *
 * The wiki has always held `revision.author` and `page.updatedBy` as bare UUIDs and rendered them raw,
 * because `ctx.user.id` was the only thing it ever had. These pin the two halves of `ctx.users`: that a
 * name appears instead of the id, and that an id resolving to nobody is a normal, rendered outcome rather
 * than a hole — which is exactly the state `eraseUser` leaves a contribution in.
 */
const ADA = '5e3410cf-fe81-43f1-80b2-a398aff3fa0c';
const GONE = '00000000-0000-0000-0000-000000000000';

const PAGE = {
  id: 1,
  slug: 'the-kraken',
  title: 'The Kraken',
  summary: 'A very large squid.',
  markdown: 'A squid.',
  searchText: 'The Kraken',
  tags: 'lore',
  status: 'published',
  sourcesHeading: null,
  locale: null,
  translationOf: null,
  updatedAt: '2026-09-05T10:00:00Z',
  updatedBy: ADA,
  revisionNo: 2,
};

const REVISIONS = [
  { id: 2, pageSlug: 'the-kraken', revisionNo: 2, title: 'The Kraken', markdown: 'A squid.',
    comment: 'expanded', author: ADA, createdAt: '2026-09-05T10:00:00Z' },
  { id: 1, pageSlug: 'the-kraken', revisionNo: 1, title: 'The Kraken', markdown: 'First.',
    comment: '', author: GONE, createdAt: '2026-09-04T10:00:00Z' },
];

const INDEX = {
  'the-kraken': { title: 'The Kraken', summary: null, tags: 'lore', updatedAt: null, locale: null, translationOf: null },
};

function ctxFor(path: string, users: ReturnType<typeof makeMockUsers> | null) {
  return makeMockCtx({
    route: { path },
    apiResponses: { 'data/site/main/index': INDEX },
    schema: makeMockSchema({ page: [PAGE], revision: REVISIONS, link: [], source: [], media: [] }),
    users,
  });
}

describe('contributors', () => {
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

  it('names the people in a page history instead of printing their ids', async () => {
    const users = makeMockUsers({ [ADA]: 'Ada Lovelace' });

    await render(ctxFor('the-kraken/history', users));

    expect(host.textContent).toContain('Ada Lovelace');
    expect(host.textContent).not.toContain(ADA);
  });

  it('renders a placeholder for an author who is gone, and keeps the revision', async () => {
    // Exactly what `eraseUser` leaves behind: a contribution is pseudonymised, not deleted, because a
    // revision is a public contribution. `resolve` leaves an unknown id out rather than returning a null,
    // so "missing" is the case to render, not the case to crash on.
    const users = makeMockUsers({ [ADA]: 'Ada Lovelace' });

    await render(ctxFor('the-kraken/history', users));

    expect(host.textContent).toContain('a former contributor');
    expect(host.textContent).not.toContain(GONE);
    expect(host.textContent).toContain('revision 1');
  });

  it('asks for every id at once rather than once per row', async () => {
    const users = makeMockUsers({ [ADA]: 'Ada Lovelace' });

    await render(ctxFor('the-kraken/history', users));

    expect(users.resolved.length).toBeGreaterThan(0);
    // Two revisions, two distinct authors, one call.
    expect(users.resolved).toEqual([ADA, GONE].sort());
  });

  it('says who last edited the page, with the avatar the host generates', async () => {
    const users = makeMockUsers({ [ADA]: 'Ada Lovelace' });

    await render(ctxFor('the-kraken', users));

    expect(host.textContent).toContain('Ada Lovelace');
    expect(host.querySelector<HTMLImageElement>('.wiki__avatar')?.getAttribute('src'))
      .toBe(`/api/users/${ADA}/avatar`);
  });

  it('shows the page and its history unchanged when the manifest declares no identity', async () => {
    // `ctx.users` is null then, and a wiki that cannot name anyone is still a wiki.
    await render(ctxFor('the-kraken/history', null));

    expect(host.textContent).toContain('revision 2');
    expect(host.querySelector('.wiki__avatar')).toBeNull();
    expect(host.textContent).not.toContain(ADA);
    // And crucially not this: a plugin that cannot name anyone must not claim every author is gone.
    expect(host.textContent).not.toContain('a former contributor');
  });
});
