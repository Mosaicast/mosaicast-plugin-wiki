// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DISPLAY_BATCH_LIMIT, type PluginContext } from '@mosaicast/plugin-sdk';
import { makeMockCtx, makeMockFeeds } from '@mosaicast/plugin-sdk/testing';
import { citedEpisodes, useEpisodePhases } from './useEpisodePhases';
import { flush } from '../test-utils';

describe('citedEpisodes', () => {
  it('finds each cited episode once, with or without a moment or a label', () => {
    expect(
      citedEpisodes('[[episode:s01e02]] and [[episode:s01e02@12:04|again]], then [[Episode:s02e01|next]]'),
    ).toEqual(['s01e02', 's02e01']);
  });

  it('ignores wiki links and episode links outside the token', () => {
    expect(citedEpisodes('[[the-kraken]] · episode:s01e03 · [episode:s01e04](x)')).toEqual([]);
  });
});

describe('useEpisodePhases', () => {
  it('finds an episode past the batch limit with one call, because displayMany splits', async () => {
    // `ctx.episodes` is uncapped since core 0.7.6, so a long show's list is longer than one batch. The host's
    // client splits it since SDK 0.19.0; a clamp there would silently drop the quiet plan at the end.
    const slugs = Array.from({ length: DISPLAY_BATCH_LIMIT + 50 }, (_, n) => `e${n}`);
    const last = slugs[slugs.length - 1];
    const feeds = makeMockFeeds({ [last]: { title: 'Last', description: '' } }).withPhase(last, 'planned');
    const ctx = makeMockCtx({ feeds });
    let seen: Record<string, unknown> = {};
    function Probe({ c }: { c: PluginContext }) {
      seen = useEpisodePhases(c, slugs);
      return null;
    }

    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<Probe c={ctx} />));
    await flush();

    expect(feeds.batches.map((batch) => batch.length)).toEqual([DISPLAY_BATCH_LIMIT, 50]);
    expect(seen).toEqual({ [last]: { phase: 'planned', title: 'Last' } });
    act(() => root.unmount());
  });
});
