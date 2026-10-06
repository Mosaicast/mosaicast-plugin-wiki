// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { EpisodePhase, PluginContext } from '@mosaicast/plugin-sdk';

/** The `[[episode:slug…]]` tokens a body cites, slug only — the same shape `markdown.ts` renders. */
const EPISODE_TOKEN = /\[\[episode:([^\]|@\s]+)/gi;

/**
 * The episode slugs a Markdown body cites, each once, in order of first appearance.
 *
 * @param markdown the page body
 * @returns the cited slugs
 */
export function citedEpisodes(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(EPISODE_TOKEN)].map((match) => match[1]))];
}

/** Where an episode stands, and what to call it — a quiet plan has no `episodeLabels` entry to fall back on. */
export interface EpisodePlace {
  phase: EpisodePhase;
  title: string;
}

/**
 * Where each of these episodes stands in its release (SDK 0.18.0), for an editor that must not let a
 * podcaster publish a quiet plan by accident.
 *
 * **Only the editor asks.** A `planned` episode reaches a podcaster's `ctx.episodes` and nobody else's, and
 * the reader deliberately cannot tell "planned" from "not there" (see `EpisodeCards`). The person who can
 * still change the page is the one who needs to know.
 *
 * One call however long the list: `displayMany` splits at the batch limit and merges since SDK 0.19.0
 * (core#269) — it clamped before, and this hook sliced by hand. A snapshot without a `phase` would come from a
 * host without planned episodes; an absent snapshot is something this caller may not see, which is not a plan
 * they can leak either. Both are simply missing from the answer.
 *
 * @param ctx   the host context
 * @param slugs the episodes to look up; the effect re-runs only when the set changes
 * @returns slug → phase and title, for the slugs the host placed
 */
export function useEpisodePhases(ctx: PluginContext, slugs: string[]): Record<string, EpisodePlace> {
  const [phases, setPhases] = useState<Record<string, EpisodePlace>>({});
  const key = slugs.join('\n');

  useEffect(() => {
    const wanted = key ? key.split('\n') : [];
    if (wanted.length === 0) {
      setPhases({});
      return;
    }
    let cancelled = false;
    ctx.feeds
      .displayMany(wanted)
      .then((answer) => {
        if (cancelled) {
          return;
        }
        const found: Record<string, EpisodePlace> = {};
        for (const [slug, snapshot] of Object.entries(answer)) {
          if (snapshot.phase) {
            found[slug] = { phase: snapshot.phase, title: snapshot.title };
          }
        }
        setPhases(found);
      })
      // The badge and the warning are advice; failing to fetch them must not block writing.
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: episode phases could not be read: ${String(error)}`);
          setPhases({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, key]);

  return phases;
}
