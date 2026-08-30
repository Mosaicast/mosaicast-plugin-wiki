// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { renderPage, stripSourcesSection, type TocEntry } from '../markdown';
import { routeHref, routePath, type WikiRoute } from '../routes';
import type { LinkRow, PageRow, PageSummary, SourceRow } from '../types';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { EpisodeCard, useEpisodeCards } from './EpisodeCards';

/** The anchor for the rendered Sources section, so the contents list can point at it. */
const SOURCES_ID = 'sources';

/** How many pages the "linked from" list shows before it stops being context and starts being a list. */
const BACKLINK_LIMIT = 25;

interface PageViewProps {
  ctx: PluginContext;
  i18n: PluginI18n;
  slug: string;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * One wiki page: its body, its table of contents, its sources, and what links to it.
 *
 * Everything here comes from `ctx.schema`, the host's read-only view of the tables it provisioned for this
 * plugin. Backlinks are the reason those tables exist at all — the question "what points at this page?" is
 * one indexed `select` in the reverse direction, and a key/value store could only answer it by reading
 * every page and scanning the body.
 *
 * A page the ingest tick has not applied yet simply is not here. That is the eventual consistency the write
 * path buys, and the not-found state says so rather than implying the page is gone.
 */
export function PageView({ ctx, i18n, slug, index, go }: PageViewProps) {
  const mayEdit = ctx.user?.role === 'podcaster' || ctx.user?.role === 'admin';
  const [page, setPage] = useState<PageRow | null | undefined>(undefined);
  const [backlinks, setBacklinks] = useState<LinkRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [body, setBody] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const schema = ctx.schema;
    if (!schema) {
      setPage(null);
      return;
    }
    setPage(undefined);

    Promise.all([
      // An unpublished page is readable only by someone who could edit it. The `readableBy: anonymous`
      // floor opens the *surface*, not each row -- core has no model of a wiki page and cannot know that
      // `status` decides who sees one, which is the same rule SearchProvider states out loud. Without this
      // a visitor who guessed a draft's URL read its body.
      schema.select<PageRow>('page', {
        where: mayEdit
          ? [{ field: 'slug', op: 'eq', value: slug }]
          : [
              { field: 'slug', op: 'eq', value: slug },
              { field: 'status', op: 'eq', value: 'published' },
            ],
        size: 1,
      }),
      schema.select<LinkRow>('link', {
        where: [
          { field: 'toSlug', op: 'eq', value: slug },
          { field: 'kind', op: 'eq', value: 'wiki' },
        ],
        size: BACKLINK_LIMIT,
      }),
      schema.select<SourceRow>('source', {
        where: [{ field: 'pageSlug', op: 'eq', value: slug }],
        orderBy: [{ field: 'position', direction: 'asc' }],
        size: 50,
      }),
    ])
      .then(([found, linkedFrom, cited]) => {
        if (cancelled) {
          return;
        }
        setPage(found.items[0] ?? null);
        setBacklinks(linkedFrom.items);
        setSources(cited.items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: page '${slug}' could not be read: ${String(error)}`);
          setPage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, slug, mayEdit]);

  const rendered = useMemo(() => {
    if (!page) {
      return { html: '', toc: [] as TocEntry[], plainFirstParagraph: '' };
    }
    // Sources are rendered from the extracted rows below, so drop the body's own copy of that section.
    const body = sources.length > 0 ? stripSourcesSection(page.markdown ?? '') : (page.markdown ?? '');
    return renderPage(body, {
      hasPage: (target) => Object.prototype.hasOwnProperty.call(index, target),
      episodeHref: (episode, seconds) =>
        // The host owns the shape of its own URLs, including the `?t=` a citation needs.
        ctx.links.episode(episode, seconds == null ? undefined : { t: seconds }),
      blobUrl: ctx.blobs ? (ref) => ctx.blobs!.urlFor(ref) : undefined,
    });
  }, [ctx, page, index, sources.length]);

  // Wiki links inside the rendered body are ours, so they navigate in-place instead of reloading the
  // shell and every plugin bundle. They keep their href, so middle-click and crawlers still work.
  useEffect(() => {
    if (!body) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[data-wiki]');
      const target = anchor?.getAttribute('data-wiki');
      if (!target || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      ctx.route.navigate(routePath({ view: 'page', slug: target }));
    };
    body.addEventListener('click', onClick);
    return () => body.removeEventListener('click', onClick);
  }, [ctx, body, rendered.html]);

  // Cards for the episodes this page cites, read live from the host rather than from the projection the
  // wiki used to keep. A citation the host says nothing about keeps its inline link and gets no card.
  const snapshots = useEpisodeCards(ctx, body, rendered.html);
  const cited = (body ? [...body.querySelectorAll('a[data-ep]')] : [])
    .map((a) => ({
      slug: a.getAttribute('data-ep') ?? '',
      seconds: a.hasAttribute('data-t') ? Number(a.getAttribute('data-t')) : undefined,
    }))
    .filter((c, i, all) => c.slug && all.findIndex((o) => o.slug === c.slug) === i)
    .flatMap((c) => (snapshots[c.slug] ? [{ ...c, snapshot: snapshots[c.slug] }] : []));

  if (page === undefined) {
    return <p className="wiki__meta">{i18n.t('loading')}</p>;
  }

  if (page === null) {
    return (
      <div className="wiki__empty">
        <p>{i18n.t('page.notFound')}</p>
        <p>
          <a href={routeHref({ view: 'home' })} onClick={go({ view: 'home' })}>
            {i18n.t('home.title')}
          </a>
        </p>
      </div>
    );
  }

  const tags = (page.tags ?? '').split(',').filter(Boolean);

  // A lead paragraph, the way an encyclopedia article opens: the summary, above the contents.
  //
  // Shown **only when the summary was written**, not when the backend derived it from the body. The
  // derivation takes the first paragraph, so rendering it here as well would print that paragraph twice
  // — which is what a naive "always show the summary" does, and it looks like a bug rather than a lead.
  const summary = (page.summary ?? '').trim();
  const firstParagraph = (rendered.plainFirstParagraph ?? '').trim();
  const lead = summary && summary !== firstParagraph ? summary : null;

  // The body's own Sources heading is stripped above, but the section still renders from the extracted
  // rows -- so the contents list has to name it, or it points at less than the reader can see.
  const contents = sources.length > 0
    ? [...rendered.toc, { id: SOURCES_ID, text: i18n.t('page.sources'), level: 2 as const }]
    : rendered.toc;

  return (
    <article>
      <h1 className="wiki__title">{page.title}</h1>
      <p className="wiki__meta">
        {page.updatedAt
          ? i18n.t('page.updated', { when: new Date(page.updatedAt).toLocaleDateString(ctx.locale.current()) })
          : null}
        {page.revisionNo ? ` · ${i18n.t('page.revision', { n: String(page.revisionNo) })}` : null}
      </p>

      <p className="wiki__pageactions">
        <a href={routeHref({ view: 'history', slug })} onClick={go({ view: 'history', slug })}>
          <Icon name="history" />
          {i18n.t('page.history')}
        </a>
        {mayEdit && (
          <a href={routeHref({ view: 'edit', slug })} onClick={go({ view: 'edit', slug })}>
            <Icon name="edit" />
            {i18n.t('page.edit')}
          </a>
        )}
      </p>

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

      {lead && <p className="wiki__lead">{lead}</p>}

      {contents.length > 2 && (
        <nav className="wiki__toc" aria-label={i18n.t('page.contents')}>
          <h2><Icon name="list-numbered" />{i18n.t('page.contents')}</h2>
          <ul>
            {contents.map((entry) => (
              <li key={entry.id} data-level={entry.level}>
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Sanitised in renderPage; see markdown.ts for why author markdown never reaches here verbatim. */}
      <div
        className="wiki__body"
        ref={setBody}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />

      {cited.length > 0 && (
        <section className="wiki__section">
          <h2>
            <Icon name="music" />
            {i18n.t('page.episodes')}
          </h2>
          <div className="wiki__epcards">
            {cited.map((c) => (
              <EpisodeCard key={c.slug} ctx={ctx} i18n={i18n} slug={c.slug} snapshot={c.snapshot} seconds={c.seconds} />
            ))}
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <section className="wiki__section">
          <h2 id={SOURCES_ID}><Icon name="quote" />{i18n.t('page.sources')}</h2>
          <ol className="wiki__sources">
            {sources.map((source) => (
              <li key={source.id}>
                <a href={source.url ?? '#'} target="_blank" rel="noopener noreferrer">
                  {source.label || source.url}
                </a>
                {source.note ? <span className="wiki__note"> — {source.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      {backlinks.length > 0 && (
        <section className="wiki__section">
          <h2><Icon name="link" />{i18n.t('page.backlinks')}</h2>
          <ul className="wiki__list">
            {[...new Map(backlinks.map((link) => [link.fromSlug, link])).values()].map((link) => (
              <li className="wiki__item" key={link.fromSlug}>
                <h3>
                  <a
                    href={routeHref({ view: 'page', slug: link.fromSlug })}
                    onClick={go({ view: 'page', slug: link.fromSlug })}
                  >
                    {index[link.fromSlug]?.title || link.fromSlug}
                  </a>
                </h3>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
