// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import { resolveArtwork, type DisplaySnapshot, type PluginContext } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';

/**
 * Turns the plain episode links in a rendered page into cards, once the host has told us what the
 * episodes are.
 *
 * **This is what `ctx.feeds` is for.** The wiki used to project episode titles and artwork into its own
 * doc store on a schedule, because the frontend could not read a snapshot — a copy that went stale between
 * ticks, of data the host overwrites on every feed refetch. SDK 0.9 made the snapshot readable live, so
 * the projection is gone and this reads through.
 *
 * Two rules the surface carries, and both matter here:
 *
 * - **`displayMany`, never a request per card.** A page citing six episodes is one request.
 * - **A missing key is normal, not a failure.** A `WITHDRAWN` or tier-gated episode is *absent* from the
 *   answer rather than redacted, and `display` deliberately cannot tell "no snapshot" from "not visible"
 *   — distinguishing them would confirm an episode exists to someone who was not shown it. So a link the
 *   host says nothing about stays exactly as it rendered: a working link, with no card around it.
 */
export function useEpisodeCards(ctx: PluginContext, container: HTMLElement | null, html: string) {
  const [snapshots, setSnapshots] = useState<Record<string, DisplaySnapshot>>({});

  // Which episodes this page actually cites, read off the rendered body rather than tracked separately.
  useEffect(() => {
    if (!container) {
      return;
    }
    const slugs = [...new Set([...container.querySelectorAll('a[data-ep]')].map((a) => a.getAttribute('data-ep') ?? ''))]
      .filter(Boolean);
    if (slugs.length === 0) {
      setSnapshots({});
      return;
    }
    let cancelled = false;
    ctx.feeds
      .displayMany(slugs)
      .then((found) => !cancelled && setSnapshots(found))
      .catch((error: unknown) => {
        if (!cancelled) {
          // The links still work; only the decoration is missing.
          ctx.log('warn', `wiki: episode snapshots could not be read: ${String(error)}`);
          setSnapshots({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, container, html]);

  return snapshots;
}

/**
 * One cited episode, as a card.
 *
 * Rendered *beside* the link rather than replacing it: the sentence a podcaster wrote still reads, and the
 * card adds what a reader would otherwise have to click to find out.
 */
export function EpisodeCard({
  ctx,
  i18n,
  slug,
  snapshot,
  seconds,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  slug: string;
  snapshot: DisplaySnapshot;
  seconds?: number;
}) {
  const artwork = resolveArtwork(snapshot);
  const href = ctx.links.episode(slug, seconds == null ? undefined : { t: seconds });

  return (
    <a className="wiki__epcard" href={href}>
      {artwork ? <img src={artwork} alt="" loading="lazy" /> : null}
      <span className="wiki__epcard-body">
        <span className="wiki__epcard-title">{snapshot.title}</span>
        <span className="wiki__epcard-meta">
          {snapshot.publishedAt ? i18n.date(snapshot.publishedAt, { dateStyle: 'medium' }) : null}
          {snapshot.duration ? ` · ${i18n.duration(snapshot.duration)}` : null}
          {seconds != null ? ` · ${i18n.t('page.fromMoment', { at: i18n.duration(seconds) })}` : null}
        </span>
        {snapshot.subtitle || snapshot.description ? (
          <span className="wiki__epcard-note">{snapshot.subtitle || snapshot.description}</span>
        ) : null}
      </span>
    </a>
  );
}
