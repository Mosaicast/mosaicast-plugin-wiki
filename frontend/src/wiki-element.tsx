// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { defineMosaicastElement } from '@mosaicast/plugin-sdk';
import { createRoot } from 'react-dom/client';
import { WikiPage } from './components/WikiPage';
import { WikiSiteCard } from './components/WikiSiteCard';
import { EpisodeMentions } from './components/EpisodeMentions';

/**
 * The wiki's three custom elements, one per slot the manifest declares.
 *
 * Each `render` returns its cleanup: the SDK runs it when `ctx` is reassigned and when the element
 * disconnects, so a React root is unmounted exactly once. The host wraps every mount in an error boundary,
 * which means a throw here blanks this tile alone — but that tile is all the visitor sees of the wiki, so
 * each component handles its own empty and failed states rather than relying on that net.
 */

/** `site`/`page` — the wiki itself, behind `/p/wiki/*`. */
defineMosaicastElement({
  tag: 'wiki-page',
  render: ({ ctx, root }) => {
    const reactRoot = createRoot(root);
    reactRoot.render(<WikiPage ctx={ctx} />);
    return () => reactRoot.unmount();
  },
});

/** `site`/`site` — the entry tile on the site panel. */
defineMosaicastElement({
  tag: 'wiki-site-card',
  render: ({ ctx, root }) => {
    const reactRoot = createRoot(root);
    reactRoot.render(<WikiSiteCard ctx={ctx} />);
    return () => reactRoot.unmount();
  },
});

/** `episode`/`main` — which wiki pages talk about this episode. */
defineMosaicastElement({
  tag: 'wiki-episode-mentions',
  render: ({ ctx, root }) => {
    const reactRoot = createRoot(root);
    reactRoot.render(<EpisodeMentions ctx={ctx} />);
    return () => reactRoot.unmount();
  },
});
