// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { LocaleInfo, PluginContext } from '@mosaicast/plugin-sdk';
import type { PageSummary } from './types';

/**
 * Which languages a page may be written in, and how to move between a page's languages.
 *
 * Two lists reach a plugin and the difference decides which one belongs here. `ctx.locale.available()` is
 * what the shell can *render* in; `ctx.locale.content()` is what the admin permits text to be *authored*
 * in. A wiki page is authored text, so every list in this file comes from `content()` — a site can require
 * a Dutch article without offering a Dutch UI, and an editor built from `available()` would silently
 * refuse the language its operator actually asked for.
 *
 * Neither list is ours: an admin edits them on a page while the plugin is running, so they are read at the
 * point of use rather than cached.
 */

/** One entry of a page's language switcher. */
export interface Variant {
  /** The page to link to. */
  slug: string;
  /** Its title, for the link text a screen reader gets. */
  title: string;
  /** Its language code, or `null` when the author stated none. */
  locale: string | null;
  /** Whether this is the page being read. */
  current: boolean;
}

/**
 * Whether this site authors content in more than one language.
 *
 * Every language control in the UI hangs off this: on a monolingual site a language picker is a control
 * with one option and a language chip is a badge that says the same thing on every row, so neither is
 * shown at all.
 *
 * @param ctx the plugin context
 * @returns whether more than one content language exists
 */
export function isMultilingual(ctx: PluginContext): boolean {
  return ctx.locale.content().length > 1;
}

/**
 * A language's name in its own language, ready to render.
 *
 * @param ctx  the plugin context
 * @param code a locale code, or `null`
 * @returns the native name, or the code itself when the host does not know it — a language may be a
 *          content language with no catalog at all, so an unknown code is normal rather than an error
 */
export function localeName(ctx: PluginContext, code: string | null): string {
  if (!code) {
    return '';
  }
  const known: LocaleInfo | undefined = ctx.locale
    .content()
    .find((locale) => locale.code.toLowerCase() === code.toLowerCase());
  return known?.nativeName ?? code;
}

/**
 * The site's default content language, which is what an unstated page locale means.
 *
 * @param ctx the plugin context
 * @returns the default locale's code, or `null` when the host names none
 */
export function defaultContentLocale(ctx: PluginContext): string | null {
  const locales = ctx.locale.content();
  return (locales.find((locale) => locale.isDefault) ?? locales[0])?.code ?? null;
}

/**
 * The other languages a page exists in.
 *
 * **Built from the `index` projection, and that is a security property rather than a shortcut.** The
 * backend publishes only *published* pages into `index`, so a draft translation cannot appear in a
 * switcher no matter who is looking — the same "access is per row, not per surface" rule the page query
 * and `SearchProvider` follow, kept here by construction instead of by a filter that could be forgotten.
 * The cost is that a podcaster does not see their own unpublished translation listed until they publish
 * it, which is the honest reading of "what languages does this page exist in" anyway.
 *
 * The group is a star: every translation stores the original's slug, so membership is one pass over the
 * index and can neither cycle nor need a walk.
 *
 * @param slug          the page being read
 * @param translationOf what that page translates, or `null` when it is an original
 * @param index         the published-page projection
 * @returns one entry per page in the group including this one, ordered by locale; empty when the page has
 *          no siblings, so a caller can render nothing on a monolingual wiki
 */
export function variantsOf(
  slug: string,
  translationOf: string | null,
  index: Record<string, PageSummary>,
): Variant[] {
  const root = translationOf ?? slug;
  const variants: Variant[] = [];
  for (const [candidate, summary] of Object.entries(index)) {
    if (candidate === root || summary.translationOf === root) {
      variants.push({
        slug: candidate,
        title: summary.title,
        locale: summary.locale ?? null,
        current: candidate === slug,
      });
    }
  }
  if (variants.length < 2) {
    return [];
  }
  variants.sort((a, b) => (a.locale ?? '').localeCompare(b.locale ?? ''));
  return variants;
}
