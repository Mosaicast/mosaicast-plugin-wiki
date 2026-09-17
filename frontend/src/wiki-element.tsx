// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { defineMosaicastElement } from '@mosaicast/plugin-sdk';
import type { MosaicastHandle, PluginContext } from '@mosaicast/plugin-sdk';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WikiPage } from './components/WikiPage';
import { WikiSiteCard } from './components/WikiSiteCard';
import { EpisodeMentions } from './components/EpisodeMentions';

/**
 * The wiki's three custom elements, one per slot the manifest declares.
 *
 * **Each render returns a {@link MosaicastHandle}, not a bare cleanup callback**, and the difference is
 * what a reassigned `ctx` costs. A bare cleanup means the SDK unmounts the React root, clears the host
 * element and calls `render` again; a handle with an `update` means the SDK refreshes the theme tokens
 * and hands us the new context, leaving the DOM alone. React then reconciles the new context into the
 * tree that is already there — so an unsaved editor body, the caret in it, an open picker, the scroll
 * position of the preview pane and every in-flight request survive, where a fresh `createRoot` lost all
 * of them.
 *
 * `ctx` is reassigned for the ordinary reasons — a login, a theme change, a language change, a consent
 * decision — and, on a host that rebuilds its context object per render, several times a second while
 * audio plays. Core memoises it as of 0.7.2, so this is insurance rather than a fix for something visible
 * on today's host; `wiki-episode-mentions` renders in `episode/main`, which is the page with the player
 * on it, so it is the slot that would notice first if that ever regressed.
 *
 * `destroy` therefore runs only on a real disconnect. An identical context object never reaches `update`
 * at all — the SDK filters that case out, so there is no diffing to do here.
 *
 * The host wraps every mount in an error boundary, which means a throw here blanks this tile alone — but
 * that tile is all the visitor sees of the wiki, so each component handles its own empty and failed
 * states rather than relying on that net.
 */

/**
 * Mounts one React view and keeps it mounted across a reassigned `ctx`.
 *
 * @param root the shadow-root element the SDK hands the render
 * @param ctx  the context to render with first
 * @param view builds the element for a context — called again on every update, never remounted
 * @returns the handle the SDK uses to decide what a new context costs
 */
export function mount(
  root: HTMLElement,
  ctx: PluginContext,
  view: (ctx: PluginContext) => ReactElement,
): MosaicastHandle {
  const reactRoot = createRoot(root);
  reactRoot.render(view(ctx));
  return {
    update: (next) => reactRoot.render(view(next)),
    destroy: () => reactRoot.unmount(),
  };
}

/** `site`/`page` — the wiki itself, behind `/p/wiki/*`. */
defineMosaicastElement({
  tag: 'wiki-page',
  render: ({ ctx, root }) => mount(root, ctx, (c) => <WikiPage ctx={c} />),
});

/** `site`/`site` — the entry tile on the site panel. */
defineMosaicastElement({
  tag: 'wiki-site-card',
  render: ({ ctx, root }) => mount(root, ctx, (c) => <WikiSiteCard ctx={c} />),
});

/** `episode`/`main` — which wiki pages talk about this episode. */
defineMosaicastElement({
  tag: 'wiki-episode-mentions',
  render: ({ ctx, root }) => mount(root, ctx, (c) => <EpisodeMentions ctx={c} />),
});
