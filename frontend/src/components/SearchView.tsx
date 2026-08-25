// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { routeHref, type WikiRoute } from '../routes';
import type { PageRow, PageSummary } from '../types';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';

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
  ctx: PluginContext;
  i18n: PluginI18n;
  tag: string;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * Everything on the site carrying one tag — wiki pages *and* episodes.
 *
 * The second list is the point of the shared vocabulary (§6.1.1), and the reason this plugin filed for it:
 * before SDK 0.9 the wiki had a private tag column, so a page tagged `lore` and an episode tagged `lore`
 * were unrelated strings and this view could only ever show half the answer.
 *
 * The pages come from the `index` document — the backend already publishes each page's canonical tags
 * there, so filtering a few hundred entries in the browser costs a read the page has made anyway. The
 * episodes come from `ctx.tags`, which is `null` when the manifest declares no `tags` block; the view then
 * simply shows what it did before.
 */
export function TagView({ ctx, i18n, tag, index, go }: TagViewProps) {
  const wanted = tag.trim().toLowerCase();
  const [episodes, setEpisodes] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const vocabulary = ctx.tags;
    if (!vocabulary) {
      setEpisodes([]);
      return;
    }
    vocabulary
      .episodesWith(wanted)
      .then((slugs) => !cancelled && setEpisodes(slugs))
      .catch((error: unknown) => {
        if (!cancelled) {
          // The wiki half of the answer is still worth showing; say nothing about the half that failed.
          ctx.log('warn', `wiki: episodes for tag '${wanted}' could not be read: ${String(error)}`);
          setEpisodes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, wanted]);
  const tagged = Object.entries(index).filter(([, summary]) =>
    (summary.tags ?? '')
      .split(',')
      .filter(Boolean)
      .includes(wanted),
  );

  return (
    <section>
      <h1 className="wiki__title">{i18n.t('tag.title', { tag })}</h1>
      {tagged.length === 0 && (episodes?.length ?? 0) === 0 ? (
        <div className="wiki__empty">
          <p>{i18n.t('tag.none', { tag })}</p>
        </div>
      ) : (
        <>
          {tagged.length > 0 && (
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

          {episodes && episodes.length > 0 && (
            <section className="wiki__section">
              <h2>
                <Icon name="music" />
                {i18n.t('tag.episodes')}
              </h2>
              <ul className="wiki__list">
                {episodes.map((slug) => (
                  <li className="wiki__item" key={slug}>
                    <h3>
                      {/* The host owns the shape of its own URLs, including the tag-filtered feed view. */}
                      <a href={ctx.links.episode(slug)}>{ctx.episodeLabels?.[slug] ?? slug}</a>
                    </h3>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
