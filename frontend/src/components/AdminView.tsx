// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { routeHref, type WikiRoute } from '../routes';
import { KEY_STATS, type LinkRow, type MediaRow, type PageSummary, type WikiStats } from '../types';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { describeApiError } from './useDoc';

/** How many rows each problem list shows before it stops being a summary. */
const LIST_LIMIT = 50;

interface AdminViewProps {
  ctx: PluginContext;
  i18n: PluginI18n;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/** One thing that needs a person's attention, or a count that does not. */
interface Dashboard {
  stats: WikiStats | null;
  brokenLinks: LinkRow[];
  orphans: string[];
  pending: { slug: string; state: string; detail: string | null }[];
  providers: { provider: string; count: number }[];
  uploads: number;
  quota: { usedBytes: number; quotaBytes: number; maxFileBytes: number } | null;
}

/**
 * The podcaster's view of the wiki as a whole: what is broken, what is waiting, and what it is storing.
 *
 * **It lives at `/p/wiki/_admin`, not in an `admin` slot.** The `admin` placement validates and renders
 * nowhere — no admin route mounts a slot region — so a plugin's own tooling belongs in its own page
 * subtree, gated on `ctx.user.role`. The gate is courtesy: everything here is readable by anyone under
 * `data.readableBy: anonymous`, and hiding a view is not what keeps data private (the drafts and the
 * unpublished pages are filtered where they are read, not here).
 *
 * The counts come from the backend's `wikistats` projection, which is computed on the ingest tick anyway.
 * The *details* are queried live, because they are only ever wanted here — putting them in a doc key would
 * make every reader pay to load a page.
 */
export function AdminView({ ctx, i18n, index, go }: AdminViewProps) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const schema = ctx.schema;

    const load = async (): Promise<Dashboard> => {
      const [stats, wikiLinks, media, drafts, receipts, quota] = await Promise.all([
        ctx.docs.get<WikiStats>('site', KEY_STATS),
        schema?.select<LinkRow>('link', {
          where: [{ field: 'kind', op: 'eq', value: 'wiki' }],
          size: 500,
        }) ?? Promise.resolve({ items: [] as LinkRow[] }),
        schema?.select<MediaRow>('media', { size: 500 }) ?? Promise.resolve({ items: [] as MediaRow[] }),
        ctx.docs.list('site', { prefix: 'draft:', size: 100 }),
        ctx.docs.list<{ state: string; detail: string | null }>('site', { prefix: 'ingest:', size: 200 }),
        ctx.blobs?.quota() ?? Promise.resolve(null),
      ]);

      // A link whose target has no page. The index is the published set, which is exactly the question:
      // a link to an unpublished page is broken from a reader's side too.
      const broken = wikiLinks.items.filter(
        (link) => !Object.prototype.hasOwnProperty.call(index, link.toSlug),
      );
      const linkedTo = new Set(wikiLinks.items.map((link) => link.toSlug));
      const orphans = Object.keys(index).filter((slug) => !linkedTo.has(slug));

      const byProvider = new Map<string, number>();
      let uploads = 0;
      for (const row of media.items) {
        if (row.uploadRef) {
          uploads += 1;
        } else if (row.provider) {
          byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + 1);
        }
      }

      return {
        stats,
        brokenLinks: broken.slice(0, LIST_LIMIT),
        orphans: orphans.slice(0, LIST_LIMIT),
        // A draft still sitting here has not been applied: either the tick has not run, or the receipt
        // beside it says why not.
        pending: drafts.items.slice(0, LIST_LIMIT).map((doc) => {
          const slug = doc.key.slice('draft:'.length);
          const receipt = receipts.items.find((r) => r.key === `ingest:${slug}`);
          return { slug, state: receipt?.value?.state ?? 'queued', detail: receipt?.value?.detail ?? null };
        }),
        providers: [...byProvider.entries()]
          .map(([provider, count]) => ({ provider, count }))
          .sort((a, b) => b.count - a.count),
        uploads,
        quota,
      };
    };

    load()
      .then((loaded) => !cancelled && setData(loaded))
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: dashboard could not be built: ${describeApiError(error)}`);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, index]);

  if (failed) {
    return <p className="wiki__error">{i18n.t('error')}</p>;
  }
  if (!data) {
    return <p className="wiki__meta">{i18n.t('loading')}</p>;
  }

  const title = (slug: string) => index[slug]?.title || slug;

  return (
    <section>
      <h1 className="wiki__title">{i18n.t('admin.title')}</h1>
      <p className="wiki__meta">{i18n.t('admin.intro')}</p>

      <dl className="wiki__counters">
        <Counter label={i18n.t('admin.pages')} value={data.stats?.pages ?? Object.keys(index).length} />
        <Counter label={i18n.t('admin.orphans')} value={data.orphans.length} />
        <Counter label={i18n.t('admin.broken')} value={data.brokenLinks.length} />
        <Counter label={i18n.t('admin.pending')} value={data.pending.length} />
      </dl>

      <Problem
        title={i18n.t('admin.brokenTitle')}
        icon="warning"
        empty={i18n.t('admin.brokenNone')}
        hint={i18n.t('admin.brokenHint')}
        rows={data.brokenLinks.map((link) => ({
          key: `${link.fromSlug}->${link.toSlug}`,
          body: (
            <>
              <a href={routeHref({ view: 'page', slug: link.fromSlug })} onClick={go({ view: 'page', slug: link.fromSlug })}>
                {title(link.fromSlug)}
              </a>
              {' → '}
              <code>{link.toSlug}</code>
            </>
          ),
        }))}
      />

      <Problem
        title={i18n.t('admin.pendingTitle')}
        icon="clock"
        empty={i18n.t('admin.pendingNone')}
        hint={i18n.t('admin.pendingHint')}
        rows={data.pending.map((draft) => ({
          key: draft.slug,
          body: (
            <>
              <code>{draft.slug}</code> — {i18n.t(`admin.state.${draft.state}`)}
              {draft.detail ? <span className="wiki__note"> · {draft.detail}</span> : null}
            </>
          ),
        }))}
      />

      <Problem
        title={i18n.t('admin.orphansTitle')}
        icon="link"
        empty={i18n.t('admin.orphansNone')}
        hint={i18n.t('admin.orphansHint')}
        rows={data.orphans.map((slug) => ({
          key: slug,
          body: (
            <a href={routeHref({ view: 'page', slug })} onClick={go({ view: 'page', slug })}>
              {title(slug)}
            </a>
          ),
        }))}
      />

      <section className="wiki__section">
        <h2>
          <Icon name="image" />
          {i18n.t('admin.mediaTitle')}
        </h2>
        <p className="wiki__meta">
          {i18n.t('admin.mediaCounts', { uploads: String(data.uploads), external: String(data.providers.length) })}
          {data.quota
            ? ` · ${i18n.t('editor.quota', {
                used: i18n.bytes(data.quota.usedBytes),
                total: i18n.bytes(data.quota.quotaBytes),
                max: i18n.bytes(data.quota.maxFileBytes),
              })}`
            : null}
        </p>
        {data.providers.length === 0 ? (
          <p className="wiki__meta">{i18n.t('admin.mediaNoExternal')}</p>
        ) : (
          <>
            <p className="wiki__hint">{i18n.t('admin.mediaHint')}</p>
            <ul className="wiki__list">
              {data.providers.map((entry) => (
                <li className="wiki__item" key={entry.provider}>
                  <code>{entry.provider}</code> · {entry.count}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </section>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="wiki__counter">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One list of things needing attention.
 *
 * An empty one says so rather than disappearing: "no broken links" is information, and a section that
 * vanishes when it is clean leaves a podcaster wondering whether it ran.
 */
function Problem({
  title,
  icon,
  empty,
  hint,
  rows,
}: {
  title: string;
  icon: 'warning' | 'clock' | 'link';
  empty: string;
  hint: string;
  rows: { key: string; body: React.ReactNode }[];
}) {
  return (
    <section className="wiki__section">
      <h2>
        <Icon name={icon} />
        {title}
        {rows.length > 0 ? <span className="wiki__count"> {rows.length}</span> : null}
      </h2>
      {rows.length === 0 ? (
        <p className="wiki__meta">{empty}</p>
      ) : (
        <>
          <p className="wiki__hint">{hint}</p>
          <ul className="wiki__list">
            {rows.map((row) => (
              <li className="wiki__item" key={row.key}>
                {row.body}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
