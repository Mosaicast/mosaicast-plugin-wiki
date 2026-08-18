// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useMemo, useState, type FormEvent } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { parseRoute, routeHref, routePath, type WikiRoute } from '../routes';
import { KEY_INDEX, type PageSummary } from '../types';
import { useSiteDoc } from './useDoc';
import { WIKI_CSS } from './styles';

/**
 * The wiki itself, mounted in the `page` placement behind `/p/wiki/*`.
 *
 * A `page` slot is what makes plugin content linkable at all — without one the host answers that URL with a
 * real 404 rather than soft-404ing a page nobody opted into. The subpath below the prefix arrives as
 * `ctx.route.path` and is re-handed on every navigation (the shell reassigns `ctx` rather than remounting),
 * so this component reads it at render time and never subscribes.
 *
 * Phase 1 renders the home view. The reader, editor, history and dashboard views land in later phases;
 * every route already resolves, so an early deep link degrades to a stated empty state, never a blank tile.
 */
export function WikiPage({ ctx }: { ctx: PluginContext }) {
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx]);
  const route = parseRoute(ctx.route.path);
  const index = useSiteDoc<Record<string, PageSummary>>(ctx, KEY_INDEX);
  const pages = Object.entries(index.data ?? {});

  /** Navigate inside our own subtree. Links keep their `href`; this only takes over the plain click. */
  const go = (target: WikiRoute) => (event: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (event.metaKey || event.ctrlKey) {
      return;   // let the browser open a new tab, as the user asked
    }
    event.preventDefault();
    ctx.route.navigate(routePath(target));
  };

  return (
    <>
      <style>{WIKI_CSS}</style>
      <div className="wiki wiki--page">
        <div className="wiki__bar">
          <SearchBox ctx={ctx} placeholder={i18n.t('search.placeholder')} submit={i18n.t('search.submit')} />
        </div>

        <h1 className="wiki__title">{i18n.t('home.title')}</h1>

        {index.loading && <p className="wiki__meta">{i18n.t('loading')}</p>}
        {index.failed && <p className="wiki__error">{i18n.t('error')}</p>}

        {!index.loading && !index.failed && pages.length === 0 && (
          <div className="wiki__empty">
            <p>{i18n.t('home.empty')}</p>
            <p>{i18n.t('home.emptyHint')}</p>
          </div>
        )}

        {pages.length > 0 && (
          <ul className="wiki__list">
            {pages.map(([slug, summary]) => (
              <li className="wiki__item" key={slug}>
                <h3>
                  <a href={routeHref({ view: 'page', slug })} onClick={go({ view: 'page', slug })}>
                    {summary.title || slug}
                  </a>
                </h3>
                {summary.summary && <p>{summary.summary}</p>}
              </li>
            ))}
          </ul>
        )}

        {route.view !== 'home' && (
          <p className="wiki__meta">
            <a href={routeHref({ view: 'home' })} onClick={go({ view: 'home' })}>
              {i18n.t('home.title')}
            </a>
          </p>
        )}
      </div>
    </>
  );
}

/** The search field. Submits to `_search/<term>`, because `ctx.route.path` has no query string to use. */
function SearchBox({ ctx, placeholder, submit }: { ctx: PluginContext; placeholder: string; submit: string }) {
  const [term, setTerm] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const query = term.trim();
    if (query) {
      ctx.route.navigate(routePath({ view: 'search', query }));
    }
  };

  return (
    <form className="wiki__search" onSubmit={onSubmit} role="search">
      <input
        className="wiki__input"
        type="search"
        value={term}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setTerm(event.target.value)}
      />
      <button className="wiki__btn" type="submit">
        {submit}
      </button>
    </form>
  );
}
