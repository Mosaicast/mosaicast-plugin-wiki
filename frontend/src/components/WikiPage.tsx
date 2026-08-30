// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { parseRoute, routeHref, routePath, type WikiRoute } from '../routes';
import { KEY_INDEX, type PageSummary } from '../types';
import { useSiteDoc } from './useDoc';
import { PageView } from './PageView';
import { SearchView, TagView } from './SearchView';
import { EditorView } from './EditorView';
import { HistoryView, RevisionView } from './HistoryView';
import { AllPagesView, RandomPageView } from './ListViews';
import { WIKI_CSS } from './styles';
import { Icon } from '../icons';

/** How many pages the home view lists as "recently updated" before the full list takes over. */
const RECENT_LIMIT = 8;

/**
 * The wiki itself, mounted in the `page` placement behind `/p/wiki/*`.
 *
 * A `page` slot is what makes plugin content linkable at all — without one the host answers that URL with
 * a real 404 rather than soft-404ing a page nobody opted into. The subpath below the prefix arrives as
 * `ctx.route.path` and is re-handed on every navigation (the shell reassigns `ctx` rather than remounting
 * the element), so this reads the route at render time and never subscribes.
 *
 * Every view resolves, including the ones phase 3 fills in, so an early deep link degrades to a stated
 * empty state rather than a blank tile.
 */
export function WikiPage({ ctx }: { ctx: PluginContext }) {
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx]);
  useEffect(() => () => i18n.dispose(), [i18n]);

  const route = parseRoute(ctx.route.path, ctx.route.query);
  const mayEdit = ctx.user?.role === 'podcaster' || ctx.user?.role === 'admin';
  const index = useSiteDoc<Record<string, PageSummary>>(ctx, KEY_INDEX);
  const pages = index.data ?? {};

  /** Navigate inside our own subtree. Links keep their `href`; this only takes over the plain click. */
  const go = (target: WikiRoute) => (event: MouseEvent | { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }) => {
    const modified = 'metaKey' in event && (event.metaKey || event.ctrlKey);
    if (modified) {
      return;   // let the browser open a new tab, as the visitor asked
    }
    event.preventDefault();
    ctx.route.navigate(routePath(target));
  };

  return (
    <>
      <style>{WIKI_CSS}</style>
      <div className="wiki wiki--page">
        <div className="wiki__bar">
          <a className="wiki__crumbs" href={routeHref({ view: 'home' })} onClick={go({ view: 'home' })}>
            {i18n.t('wiki')}
          </a>
          <SearchBox ctx={ctx} placeholder={i18n.t('search.placeholder')} submit={i18n.t('search.submit')} />
        </div>

        {index.loading && <p className="wiki__meta">{i18n.t('loading')}</p>}
        {index.failed && <p className="wiki__error">{i18n.t('error')}</p>}

        {!index.loading && !index.failed && route.view === 'home' && (
          <HomeView i18n={i18n} index={pages} go={go} />
        )}
        {!index.loading && route.view === 'page' && (
          <PageView ctx={ctx} i18n={i18n} slug={route.slug} index={pages} go={go} />
        )}
        {!index.loading && route.view === 'search' && (
          <SearchView ctx={ctx} i18n={i18n} query={route.query} index={pages} go={go} />
        )}
        {!index.loading && route.view === 'tag' && (
          <TagView ctx={ctx} i18n={i18n} tag={route.tag} index={pages} go={go} />
        )}
        {!index.loading && route.view === 'all' && <AllPagesView i18n={i18n} index={pages} go={go} />}
        {!index.loading && route.view === 'random' && <RandomPageView ctx={ctx} i18n={i18n} index={pages} />}
        {!index.loading && route.view === 'history' && (
          <HistoryView ctx={ctx} i18n={i18n} slug={route.slug} go={go} />
        )}
        {!index.loading && route.view === 'revision' && (
          <RevisionView ctx={ctx} i18n={i18n} slug={route.slug} revisionNo={route.revisionNo} go={go} />
        )}
        {!index.loading && (route.view === 'edit' || route.view === 'new') &&
          (mayEdit ? (
            <EditorView
              ctx={ctx}
              i18n={i18n}
              slug={route.view === 'edit' ? route.slug : null}
              index={pages}
              go={go}
            />
          ) : (
            // The host already refuses the write (data.writableBy is podcaster); this only avoids
            // showing a form whose save could never land.
            <div className="wiki__empty">
              <p>{i18n.t('editor.notAllowed')}</p>
            </div>
          ))}
        {!index.loading && route.view === 'admin' && (
          <div className="wiki__empty">
            <p>{i18n.t('soon')}</p>
          </div>
        )}
      </div>
    </>
  );
}

function HomeView({
  i18n,
  index,
  go,
}: {
  i18n: ReturnType<typeof makeI18n>;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}) {
  const entries = Object.entries(index);
  const recent = [...entries]
    .sort(([, a], [, b]) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, RECENT_LIMIT);
  const tags = [
    ...new Set(entries.flatMap(([, summary]) => (summary.tags ?? '').split(',').filter(Boolean))),
  ].sort();

  if (entries.length === 0) {
    return (
      <div className="wiki__empty">
        <p>{i18n.t('home.empty')}</p>
        <p>{i18n.t('home.emptyHint')}</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="wiki__title">{i18n.t('home.title')}</h1>
      <p className="wiki__meta">{i18n.t('home.count', { n: String(entries.length) })}</p>

      {tags.length > 0 && (
        <div className="wiki__tags">
          {tags.map((tag) => (
            <a className="wiki__tag" key={tag} href={routeHref({ view: 'tag', tag })} onClick={go({ view: 'tag', tag })}>
              <Icon name="tag" />
              {tag}
            </a>
          ))}
        </div>
      )}

      <h2 className="wiki__section-title">{i18n.t('home.recent')}</h2>
      <ul className="wiki__list">
        {recent.map(([slug, summary]) => (
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
        <Icon name="search" />
        {submit}
      </button>
    </form>
  );
}
