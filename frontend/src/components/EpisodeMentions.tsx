// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { routeHref } from '../routes';
import type { LinkRow } from '../types';
import { WIKI_CSS } from './styles';

/**
 * "Mentioned in the wiki" — the wiki pages that reference this episode, shown on the episode page.
 *
 * This is the payoff for declaring a schema instead of using the doc store: the answer is one indexed
 * `select` over the `link` entity, in the reverse direction from how the data was written. A doc store
 * could only answer it by reading every page and scanning its body.
 *
 * `ctx.schema` is `null` for a doc-store plugin, so the null check is a real branch even though this
 * plugin always declares one — a manifest can change, and a thrown error would blank the tile.
 */
export function EpisodeMentions({ ctx }: { ctx: PluginContext }) {
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx]);
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const episodeSlug = ctx.scope.id;

  useEffect(() => {
    let cancelled = false;
    const schema = ctx.schema;
    if (!schema) {
      setRows([]);
      return;
    }

    schema
      .select<LinkRow>('link', {
        where: [
          { field: 'toSlug', op: 'eq', value: episodeSlug },
          { field: 'kind', op: 'eq', value: 'episode' },
        ],
        size: 20,
      })
      .then((page) => {
        if (!cancelled) {
          setRows(page.items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: episode mentions failed: ${String(error)}`);
          setRows([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, episodeSlug]);

  // Nothing mentions this episode: render nothing at all rather than an empty heading on every episode page.
  if (rows == null || rows.length === 0) {
    return null;
  }

  // One wiki page may link an episode several times; the tile lists pages, not links.
  const bySlug = new Map(rows.map((row) => [row.fromSlug, row.label || row.fromSlug]));

  return (
    <>
      <style>{WIKI_CSS}</style>
      <div className="wiki">
        <h2 className="wiki__title">{i18n.t('mentions.title')}</h2>
        <ul className="wiki__list">
          {[...bySlug].map(([slug, label]) => (
            <li className="wiki__item" key={slug}>
              <h3>
                <a href={routeHref({ view: 'page', slug })}>{label}</a>
              </h3>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
