// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useMemo } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { routeHref } from '../routes';
import { KEY_INDEX, type PageSummary } from '../types';
import { useSiteDoc } from './useDoc';
import { WIKI_CSS } from './styles';

/** How many recent pages the site tile lists before it stops being a tile and starts being a page. */
const RECENT_LIMIT = 5;

/**
 * The wiki's tile in the site panel: a way in, not a second wiki.
 *
 * This one is **not** in the `page` placement, so it has no `ctx.route` subtree of its own — every link
 * here is a plain `href` into `/p/wiki/…`, which is a normal host navigation. It reads the backend's
 * `index` projection rather than querying the schema, because a tile on the front page should cost one
 * cheap document read, not a relational query the visitor never asked for.
 */
export function WikiSiteCard({ ctx }: { ctx: PluginContext }) {
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx]);
  const index = useSiteDoc<Record<string, PageSummary>>(ctx, KEY_INDEX);

  const recent = Object.entries(index.data ?? {})
    .sort(([, a], [, b]) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, RECENT_LIMIT);

  // An empty wiki gets no tile at all. A site panel is prime real estate and "nothing here" is not worth
  // any of it — the plugin simply stays out of the way until it has something to show.
  if (index.loading || index.failed || recent.length === 0) {
    return null;
  }

  return (
    <>
      <style>{WIKI_CSS}</style>
      <div className="wiki">
        <h2 className="wiki__title">
          <a href={routeHref({ view: 'home' })}>{i18n.t('wiki')}</a>
        </h2>
        <p className="wiki__meta">{i18n.t('home.recent')}</p>
        <ul className="wiki__list">
          {recent.map(([slug, summary]) => (
            <li className="wiki__item" key={slug}>
              <h3>
                <a href={routeHref({ view: 'page', slug })}>{summary.title || slug}</a>
              </h3>
              {summary.summary && <p>{summary.summary}</p>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
