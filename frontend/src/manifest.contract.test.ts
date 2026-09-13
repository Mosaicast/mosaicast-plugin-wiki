// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { defineManifest, type KnownIconName, type PluginManifest } from '@mosaicast/plugin-sdk';
import rawManifest from '../../plugin.json';
import { parseRoute } from './routes';

/**
 * The shipped manifest, read through the SDK's own type (0.9.0).
 *
 * **`defineManifest` validates nothing at runtime** — it is an identity function, and the host is and
 * remains the validator. What it buys is `tsc --noEmit`: a `slots[].element` missing from
 * `frontend.elements`, a `visibleTo` that is not a role, a `blobs` block missing its quota. Every one of
 * those is a load-time failure found today by copying `dist/` into a running host and reading the admin
 * log; here they are found by `npm run typecheck`.
 */
const manifest = defineManifest(rawManifest as PluginManifest);

/**
 * `nav[]`, read back with the field name **core** uses.
 *
 * ⚠️ **The SDK type and core disagree here, and core wins.** `PluginNavDeclaration` (0.9.1) names the role
 * field `role`; `dev.mosaicast.core.plugin.PluginManifest.NavEntry` reads `visibleTo`, matching `slots[]`
 * and every other role gate in the file.
 *
 * The consequence of following the type is worse than it first looks. Core's `PluginNavService.floorOf`
 * maps an **absent** value to rank **0 — anonymous**, not to the most restrictive role. So a manifest
 * written to the SDK type would put "New wiki page" in **every anonymous visitor's menu**: the data floor
 * still refuses the write, but the menu advertises an entrance nobody can use. (An *unrecognised* value
 * maps to podcaster, so a typo fails safe and an omission does not — which is the wrong way round.)
 *
 * `plugin.json` therefore keeps `visibleTo`, and this reads it through the index signature the type
 * carries because the host ignores fields it does not know.
 */
const nav = (manifest.nav ?? []) as ReadonlyArray<{
  path: string;
  label: string;
  icon?: string;
  visibleTo?: string;
}>;

describe('the manifest and the wiki agree', () => {
  it('points every navigation entry at a route this plugin actually serves', () => {
    // A renamed verb leaves a menu entry landing on the reader's not-found view — which looks like a
    // working link, so nobody reports it.
    for (const entry of nav) {
      const [path, search] = entry.path.split('?');
      const route = parseRoute(path, new URLSearchParams(search ?? ''));
      expect(route.view, `nav entry '${entry.path}' resolves nowhere`).not.toBe('page');
    }
  });

  it('names a published host icon for every entry', () => {
    // Not this plugin's ICON_NAMES: those are the icons its own components draw, and the shell's menu
    // draws its entries itself — so the two sets differ legitimately (the wiki uses `book` and `dice` in
    // the menu and neither in the page). What matters is that the name is one core publishes; an unknown
    // one is never validated and simply renders as nothing, which is a menu entry with a gap where its
    // icon should be. `KnownIconName` is a type with no runtime list, so this is the shape check the SDK
    // permits, and `tsc` does the rest through the typed `NAV_ICONS` below.
    for (const entry of nav) {
      expect(entry.icon, `nav entry '${entry.path}' has no icon`).toBeTruthy();
      expect(entry.icon).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('type-checks its navigation icons against the names core publishes', () => {
    // The real guard is the annotation: a name core does not publish fails `npm run typecheck`.
    const NAV_ICONS: readonly KnownIconName[] = ['book', 'list', 'dice', 'compose'];
    expect(nav.map((e) => e.icon)).toEqual([...NAV_ICONS]);
  });

  it('gates the authoring entrance, and nothing else', () => {
    // The one entry that must not be advertised to a visitor who cannot use it.
    const byPath = Object.fromEntries(nav.map((e) => [e.path, e.visibleTo]));
    expect(byPath['_new']).toBe('podcaster');
    for (const open of ['', '_all', '_random']) {
      expect(byPath[open] ?? 'anonymous').toBe('anonymous');
    }
  });

  it('uses `visibleTo`, which is what core reads — not the SDK type\'s `role`', () => {
    // See the note above: writing `role` here would open the authoring entrance to everyone.
    const raw = rawManifest as { nav?: Record<string, unknown>[] };
    for (const entry of raw.nav ?? []) {
      expect(entry).not.toHaveProperty('role');
    }
    expect(nav.some((e) => e.visibleTo != null)).toBe(true);
  });

  it('declares the tag surface it uses, since ctx.tags is null without it', () => {
    const tags = (rawManifest as { tags?: { readsVocabulary?: boolean; writesEpisodes?: boolean } }).tags;
    expect(tags?.readsVocabulary).toBe(true);
    // Tagging an episode changes the shell's filter options and what core recommends beside it. The wiki
    // has no reason to, and a block declaring neither flag is refused at load.
    expect(tags?.writesEpisodes).toBe(false);
  });

  it('gives every config field a label and a description, in both shipped languages', () => {
    // A plugin may not build its own config UI (ARCHITECTURE §7.2), so core's generic admin form is the
    // only thing an operator ever sees — and without these it shows them `blobGraceMinutes` and nothing
    // else. This is a whole-block assertion rather than five named ones so that a sixth field added later
    // cannot ship as a bare key.
    const config = (rawManifest as { config?: Record<string, Record<string, unknown>> }).config ?? {};
    expect(Object.keys(config).length).toBeGreaterThan(0);
    for (const [key, field] of Object.entries(config)) {
      for (const part of ['label', 'description'] as const) {
        const text = field[part] as Record<string, string> | undefined;
        expect(text, `${key}.${part}`).toBeTypeOf('object');
        // `en` because §12.7 makes it the one language a site cannot switch off, and `de` because it is
        // the other language this plugin ships a catalog for — a label is no use in a language the
        // operator reading the form does not have.
        expect(Object.keys(text ?? {}).sort(), `${key}.${part}`).toEqual(['de', 'en']);
        for (const value of Object.values(text ?? {})) {
          expect(value.trim().length, `${key}.${part}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('declares the external service it uses, since ctx.translation is null without it', () => {
    // The trap of the 0.11.0 bump: `translation` was already nullable, so a plugin that used it on 0.10.0
    // keeps compiling and simply gets `null` at runtime until the manifest asks. Nothing warns.
    const external = (rawManifest as { external?: { kinds?: string[]; usedBy?: string } }).external;
    expect(external?.kinds).toEqual(['translation']);
    // An empty list, or a kind the host has no bean for, is rejected at load.
    expect(external?.kinds?.length).toBeGreaterThan(0);
    // A metered provider behind an anonymous floor is an open spending endpoint; core loads it and warns.
    // `podcaster` matches data.writableBy, which is who can write a page worth translating anyway.
    expect(external?.usedBy).toBe('podcaster');
  });
});
