// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The wiki's data shapes, split by where they come from.
 *
 * Two stores are in play and the split is deliberate (ARCHITECTURE §7.6). The **schema** entities are the
 * read model — full-text search, revisions, backlinks — reached through `ctx.schema`. The **doc keys** are
 * how the browser and the backend talk: the browser writes drafts, the backend publishes projections it
 * has computed. Only the backend writes relational truth, so anything here that came from the schema may
 * be up to one ingest tick behind what a podcaster just saved.
 */

/** A row of the `page` entity. Field names must match the manifest's declaration exactly. */
export interface PageRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  markdown: string | null;
  tags: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  revisionNo: number | null;
}

/** A row of the `link` entity: one edge out of a page, to a wiki page, an episode or the open web. */
export interface LinkRow {
  id: number;
  fromSlug: string;
  toSlug: string;
  kind: 'wiki' | 'episode' | 'external';
  label: string | null;
}

/** One page as the backend's `index` doc key summarises it. */
export interface PageSummary {
  title: string;
  summary: string | null;
  tags: string | null;
  updatedAt: string | null;
}

/** One episode as the backend's `episodes` doc key projects it, for `[[episode:…]]` cards. */
export interface EpisodeCard {
  title: string;
  artwork: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
}

/** The counters behind the podcaster dashboard, from the `wikistats` doc key. */
export interface WikiStats {
  pages: number;
  orphans: number;
  brokenLinks: number;
  pendingDrafts: number;
}

/** Backend-owned doc keys. Declared in `plugin.json` under `data.backendOwned` — read-only to a client. */
export const KEY_INDEX = 'index';
export const KEY_EPISODES = 'episodes';
export const KEY_STATS = 'wikistats';

/** Client-written doc keys. Deliberately **not** backend-owned, or the editor would 403 against itself. */
export const draftKey = (slug: string) => `draft:${slug}`;
export const deleteKey = (slug: string) => `delete:${slug}`;

/** The doc scope everything site-level lives in. `site` has exactly one id, `main`. */
export const SITE_PATH = 'data/site/main';
