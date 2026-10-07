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
import { AdminView } from './AdminView';
import { HomeView } from './HomeView';
import { WIKI_CSS } from './styles';
import { clearTranslation } from '../translate';
import { Icon } from '../icons';

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

  // A machine translation is parked in memory for the new-page editor to pick up. Dropping it here, rather
  // than when the editor reads it, is what makes the hand-off survive the editor's own remount on
  // navigation -- and an author who left without saving has discarded it either way.
  useEffect(() => {
    if (route.view !== 'new') {
      clearTranslation();
    }
  }, [route.view]);
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
          {/* On the page, not only in the host menu: that entry is the one other way in, and it is absent
              until the plugin registry loads after a first login (#25). */}
          {mayEdit && route.view !== 'new' && route.view !== 'edit' ? (
            <a
              className="wiki__btn wiki__btn--ghost wiki__new"
              href={routeHref({ view: 'new' })}
              onClick={go({ view: 'new' })}
            >
              <Icon name="add" />
              {i18n.t('newPage')}
            </a>
          ) : null}
        </div>

        {index.loading && <p className="wiki__meta">{i18n.t('loading')}</p>}
        {index.failed && <p className="wiki__error">{i18n.t('error')}</p>}

        {!index.loading && !index.failed && route.view === 'home' && (
          <HomeView ctx={ctx} i18n={i18n} index={pages} mayEdit={mayEdit} go={go} />
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
        {!index.loading && route.view === 'all' && <AllPagesView ctx={ctx} i18n={i18n} index={pages} go={go} />}
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
        {!index.loading && route.view === 'admin' &&
          (mayEdit ? (
            <AdminView ctx={ctx} i18n={i18n} index={pages} go={go} />
          ) : (
            <div className="wiki__empty">
              <p>{i18n.t('editor.notAllowed')}</p>
            </div>
          ))}
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
        <Icon name="search" />
        {submit}
      </button>
    </form>
  );
}
