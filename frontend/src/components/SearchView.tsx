// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { routeHref, type WikiRoute } from '../routes';
import type { PageRow, PageSummary } from '../types';
import type { PluginI18n } from '../i18n';

const RESULT_LIMIT = 30;

interface SearchViewProps {
  ctx: PluginContext;
  i18n: PluginI18n;
  query: string;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * Full-text results, from the GIN index the platform provisioned for `page.searchText`.
 *
 * This is the reason the wiki declares a schema at all. The backend keeps `searchText` as title + tags +
 * summary + body, because `search` takes one field — so a single query covers everything a reader would
 * expect it to. The text goes through as the visitor typed it: the host runs `websearch_to_tsquery`, which
 * takes quotes, `OR` and a leading minus and never throws on a stray operator.
 */
export function SearchView({ ctx, i18n, query, index, go }: SearchViewProps) {
  const [hits, setHits] = useState<PageRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const schema = ctx.schema;
    if (!schema || !query.trim()) {
      setHits([]);
      return;
    }
    setHits(null);
    setFailed(false);

    schema
      .search<PageRow>('page', 'searchText', query, {
        where: [{ field: 'status', op: 'eq', value: 'published' }],
        size: RESULT_LIMIT,
      })
      .then((page) => {
        if (!cancelled) {
          setHits(page.items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: search failed: ${String(error)}`);
          setHits([]);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, query]);

  return (
    <section>
      <h1 className="wiki__title">{i18n.t('search.results', { query })}</h1>

      {hits === null && <p className="wiki__meta">{i18n.t('loading')}</p>}
      {failed && <p className="wiki__error">{i18n.t('error')}</p>}

      {hits !== null && !failed && hits.length === 0 && (
        <div className="wiki__empty">
          <p>{i18n.t('search.none', { query })}</p>
        </div>
      )}

      {hits !== null && hits.length > 0 && (
        <ul className="wiki__list">
          {hits.map((hit) => (
            <li className="wiki__item" key={hit.slug}>
              <h3>
                <a href={routeHref({ view: 'page', slug: hit.slug })} onClick={go({ view: 'page', slug: hit.slug })}>
                  {hit.title || hit.slug}
                </a>
              </h3>
              {(hit.summary || index[hit.slug]?.summary) && <p>{hit.summary || index[hit.slug]?.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface TagViewProps {
  i18n: PluginI18n;
  tag: string;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * Every page carrying one tag.
 *
 * Answered from the `index` document rather than the schema: the backend already publishes each page's
 * normalised tags there, and filtering a few hundred entries in the browser costs one read the page has
 * made anyway, against a round trip per visit.
 */
export function TagView({ i18n, tag, index, go }: TagViewProps) {
  const wanted = tag.trim().toLowerCase();
  const tagged = Object.entries(index).filter(([, summary]) =>
    (summary.tags ?? '')
      .split(',')
      .filter(Boolean)
      .includes(wanted),
  );

  return (
    <section>
      <h1 className="wiki__title">{i18n.t('tag.title', { tag })}</h1>
      {tagged.length === 0 ? (
        <div className="wiki__empty">
          <p>{i18n.t('tag.none', { tag })}</p>
        </div>
      ) : (
        <ul className="wiki__list">
          {tagged.map(([slug, summary]) => (
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
    </section>
  );
}
