// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, routePath, toSlug } from './routes';

describe('parseRoute', () => {
  it('reads the plugin root as home', () => {
    expect(parseRoute('')).toEqual({ view: 'home' });
    expect(parseRoute('/')).toEqual({ view: 'home' });
  });

  it('reads a bare segment as a page', () => {
    expect(parseRoute('the-kraken')).toEqual({ view: 'page', slug: 'the-kraken' });
  });

  it('reads the verbs the navigation menu points at', () => {
    // Every nav entry in plugin.json must resolve to a view, or the menu links into a not-found page.
    expect(parseRoute('_all')).toEqual({ view: 'all' });
    expect(parseRoute('_random')).toEqual({ view: 'random' });
    expect(parseRoute('_new')).toEqual({ view: 'new' });
    expect(parseRoute('')).toEqual({ view: 'home' });
  });

  it('reads the page verbs', () => {
    expect(parseRoute('the-kraken/history')).toEqual({ view: 'history', slug: 'the-kraken' });
    expect(parseRoute('the-kraken/edit')).toEqual({ view: 'edit', slug: 'the-kraken' });
    expect(parseRoute('the-kraken/rev/3')).toEqual({ view: 'revision', slug: 'the-kraken', revisionNo: 3 });
  });

  it('carries the search term in the path, because ctx.route.path has no query string', () => {
    expect(parseRoute('_search/deep%20sea')).toEqual({ view: 'search', query: 'deep sea' });
  });

  it('keeps a slash inside a search term', () => {
    expect(parseRoute('_search/and%2For')).toEqual({ view: 'search', query: 'and/or' });
  });

  it('falls back to the page reader for anything unrecognised', () => {
    // The reader renders its own not-found state; a blank tile would look like a broken plugin.
    expect(parseRoute('the-kraken/nonsense')).toEqual({ view: 'page', slug: 'the-kraken' });
  });
});

describe('routePath / routeHref', () => {
  it('round-trips every view', () => {
    for (const route of [
      { view: 'home' },
      { view: 'page', slug: 'the-kraken' },
      { view: 'history', slug: 'the-kraken' },
      { view: 'revision', slug: 'the-kraken', revisionNo: 2 },
      { view: 'edit', slug: 'the-kraken' },
      { view: 'search', query: 'deep sea' },
      { view: 'tag', tag: 'lore' },
      { view: 'all' },
      { view: 'random' },
      { view: 'admin' },
    ] as const) {
      expect(parseRoute(routePath(route))).toEqual(route);
    }
  });

  it('builds an href inside the plugin namespace', () => {
    expect(routeHref({ view: 'page', slug: 'the-kraken' })).toBe('/p/wiki/the-kraken');
    expect(routeHref({ view: 'home' })).toBe('/p/wiki');
  });
});

describe('toSlug', () => {
  it('normalises a title', () => {
    expect(toSlug('The Kraken!')).toBe('the-kraken');
    expect(toSlug('Über Bord')).toBe('uber-bord');
  });

  it('cannot produce a leading underscore, so a slug never collides with a wiki verb', () => {
    expect(toSlug('_search')).toBe('search');
  });
});
