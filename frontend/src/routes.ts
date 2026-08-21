// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The wiki's own routing, over the subpath the host hands in as `ctx.route.path`.
 *
 * The host reserves `/p/wiki/*` and gives the plugin everything below it (ARCHITECTURE §6.4). That subpath
 * carries **no query string** — core reads it from the router's splat — so anything that would normally be
 * a query parameter, a search term above all, is a path segment here instead.
 *
 * Underscore-prefixed segments are the wiki's own verbs (`_search`, `_new`, `_admin`). A page slug can
 * never collide with one, because slugs are normalised to strip a leading underscore.
 */

export type WikiRoute =
  | { view: 'home' }
  | { view: 'page'; slug: string }
  | { view: 'history'; slug: string }
  | { view: 'revision'; slug: string; revisionNo: number }
  | { view: 'edit'; slug: string }
  | { view: 'new' }
  | { view: 'search'; query: string }
  | { view: 'tag'; tag: string }
  | { view: 'admin' };

/** Normalises a user-supplied title into a slug: lowercase, hyphenated, no leading underscore. */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Parses the host's subpath into a route.
 *
 * @param path the value of `ctx.route.path`; empty at the plugin root
 * @returns the view to render; unknown shapes fall back to the page reader, which renders its own
 *          not-found state rather than a blank tile
 */
export function parseRoute(path: string): WikiRoute {
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) {
    return { view: 'home' };
  }

  const [first, second, third] = segments;
  switch (first) {
    case '_search':
      return { view: 'search', query: segments.slice(1).join('/') };
    case '_tag':
      return { view: 'tag', tag: second ?? '' };
    case '_new':
      return { view: 'new' };
    case '_admin':
      return { view: 'admin' };
    default:
      break;
  }

  if (second === 'history') {
    return { view: 'history', slug: first };
  }
  if (second === 'edit') {
    return { view: 'edit', slug: first };
  }
  if (second === 'rev' && third != null && /^\d+$/.test(third)) {
    return { view: 'revision', slug: first, revisionNo: Number(third) };
  }
  return { view: 'page', slug: first };
}

/** The subpath for a route — what to pass to `ctx.route.navigate` and to put in an `href`. */
export function routePath(route: WikiRoute): string {
  switch (route.view) {
    case 'home':
      return '';
    case 'page':
      return encodeURIComponent(route.slug);
    case 'history':
      return `${encodeURIComponent(route.slug)}/history`;
    case 'revision':
      return `${encodeURIComponent(route.slug)}/rev/${route.revisionNo}`;
    case 'edit':
      return `${encodeURIComponent(route.slug)}/edit`;
    case 'new':
      return '_new';
    case 'search':
      return `_search/${encodeURIComponent(route.query)}`;
    case 'tag':
      return `_tag/${encodeURIComponent(route.tag)}`;
    case 'admin':
      return '_admin';
  }
}

/** The absolute URL for a route — links keep a real `href` so middle-click and crawlers still work. */
export function routeHref(route: WikiRoute): string {
  const sub = routePath(route);
  return sub ? `/p/wiki/${sub}` : '/p/wiki';
}
