// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { collapseContext, diffLines } from '../diff';
import { routeHref, type WikiRoute } from '../routes';
import type { PageRow, RevisionRow } from '../types';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';

/** How many revisions a history page lists. The backend prunes past `revisionsKept` anyway. */
const HISTORY_LIMIT = 100;

interface HistoryViewProps {
  ctx: PluginContext;
  i18n: PluginI18n;
  slug: string;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * A page's revision list.
 *
 * Revisions are a separate entity rather than a JSON blob on the page precisely so this view is a query:
 * newest first, on an indexed column, without reading a single page body. Storing them inside the page
 * would make "show me the history" mean "load every version of this article".
 */
export function HistoryView({ ctx, i18n, slug, go }: HistoryViewProps) {
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const schema = ctx.schema;
    if (!schema) {
      setRevisions([]);
      return;
    }
    schema
      .select<RevisionRow>('revision', {
        where: [{ field: 'pageSlug', op: 'eq', value: slug }],
        orderBy: [{ field: 'revisionNo', direction: 'desc' }],
        size: HISTORY_LIMIT,
      })
      .then((page) => !cancelled && setRevisions(page.items))
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: history for '${slug}' failed: ${String(error)}`);
          setRevisions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, slug]);

  if (revisions === null) {
    return <p className="wiki__meta">{i18n.t('loading')}</p>;
  }

  return (
    <section>
      <h1 className="wiki__title">{i18n.t('history.title', { slug })}</h1>
      <p className="wiki__meta">
        <a href={routeHref({ view: 'page', slug })} onClick={go({ view: 'page', slug })}>
          <Icon name="arrow-left" />
          {i18n.t('history.backToPage')}
        </a>
      </p>

      {revisions.length === 0 ? (
        <div className="wiki__empty">
          <p>{i18n.t('history.none')}</p>
        </div>
      ) : (
        <ul className="wiki__list">
          {revisions.map((revision) => (
            <li className="wiki__item" key={revision.id}>
              <h3>
                <a
                  href={routeHref({ view: 'revision', slug, revisionNo: revision.revisionNo ?? 0 })}
                  onClick={go({ view: 'revision', slug, revisionNo: revision.revisionNo ?? 0 })}
                >
                  {i18n.t('page.revision', { n: String(revision.revisionNo ?? '?') })}
                </a>
              </h3>
              <p>
                {revision.createdAt ? new Date(revision.createdAt).toLocaleString(ctx.locale.current()) : null}
                {revision.author ? ` · ${revision.author}` : null}
                {revision.comment ? ` · ${revision.comment}` : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface RevisionViewProps extends HistoryViewProps {
  revisionNo: number;
}

/**
 * One revision, diffed against what the page says now.
 *
 * Against *now* rather than against the revision before it, because the question a reader actually has on
 * a history page is "what did this edit change about the article I just read".
 */
export function RevisionView({ ctx, i18n, slug, revisionNo, go }: RevisionViewProps) {
  const [state, setState] = useState<{ revision: RevisionRow | null; current: PageRow | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const schema = ctx.schema;
    if (!schema) {
      setState({ revision: null, current: null });
      return;
    }
    Promise.all([
      schema.select<RevisionRow>('revision', {
        where: [
          { field: 'pageSlug', op: 'eq', value: slug },
          { field: 'revisionNo', op: 'eq', value: revisionNo },
        ],
        size: 1,
      }),
      schema.select<PageRow>('page', { where: [{ field: 'slug', op: 'eq', value: slug }], size: 1 }),
    ])
      .then(([revision, page]) =>
        !cancelled && setState({ revision: revision.items[0] ?? null, current: page.items[0] ?? null }),
      )
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: revision ${revisionNo} of '${slug}' failed: ${String(error)}`);
          setState({ revision: null, current: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, slug, revisionNo]);

  if (state === null) {
    return <p className="wiki__meta">{i18n.t('loading')}</p>;
  }
  if (!state.revision) {
    return (
      <div className="wiki__empty">
        <p>{i18n.t('history.noRevision', { n: String(revisionNo) })}</p>
      </div>
    );
  }

  const diff = diffLines(state.revision.markdown ?? '', state.current?.markdown ?? '');
  const lines = collapseContext(diff.lines);

  return (
    <section>
      <h1 className="wiki__title">{i18n.t('history.diffTitle', { n: String(revisionNo), slug })}</h1>
      <p className="wiki__meta">
        <a href={routeHref({ view: 'history', slug })} onClick={go({ view: 'history', slug })}>
          <Icon name="arrow-left" />
          {i18n.t('history.backToHistory')}
        </a>
        {' · '}
        {i18n.t('history.stats', { added: String(diff.stats.added), removed: String(diff.stats.removed) })}
      </p>

      {diff.truncated && <p className="wiki__error">{i18n.t('history.tooBig')}</p>}

      {diff.stats.added === 0 && diff.stats.removed === 0 ? (
        <div className="wiki__empty">
          <p>{i18n.t('history.identical')}</p>
        </div>
      ) : (
        <div className="wiki__diff">
          {lines.map((line, index) =>
            line === null ? (
              <div className="wiki__diff-gap" key={`gap-${index}`} aria-hidden="true">
                &middot;&middot;&middot;
              </div>
            ) : (
              <div className={`wiki__diff-line wiki__diff-line--${line.kind}`} key={`${line.kind}-${index}`}>
                <span className="wiki__diff-no">{line.oldNo ?? ''}</span>
                <span className="wiki__diff-no">{line.newNo ?? ''}</span>
                <span className="wiki__diff-mark" aria-hidden="true">
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                </span>
                <span className="wiki__diff-text">{line.text || ' '}</span>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
