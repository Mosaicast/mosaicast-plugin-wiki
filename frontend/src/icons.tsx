// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The host's icon set, read as CSS custom properties (`--mc-icon-*`, ARCHITECTURE §12.3).
 *
 * This is the third channel this plugin shares with the shell, and the cheapest one: `ctx.api` carries
 * data over HTTP and is versioned by `platformApi`; `ctx.theme` carries colours, which the SDK injects
 * into the shadow root; **artwork is carried by nothing at all**. The shell declares these properties on
 * `:root`, custom properties inherit *through* the shadow boundary, and so a Web Component draws the
 * shell's own icons with **no SDK import, no manifest change and no version skew** — a plugin built
 * against SDK 0.8.0 picks up an icon a later core release publishes, the day it lands.
 *
 * Three rules follow, all encoded below rather than left to a comment, because each fails quietly:
 *
 * 1. **Mask, never `background-image`.** `background: currentColor` behind a mask makes the icon take the
 *    colour of the text beside it, so it re-themes with everything else. A background image bakes in the
 *    colour the artwork was drawn as, which is invisible on the opposite theme.
 * 2. **Every reference needs a fallback, and `none` is the wrong one.** An unresolved `var()` makes the
 *    declaration invalid at computed-value time, so `mask-image` reverts to its initial `none` — an
 *    *unmasked* element painting `currentColor` across its whole box. A missing icon would be a solid
 *    square, not a blank space. {@link BLANK} masks with an empty SVG instead, so an older host renders
 *    nothing and leaves the label beside it doing the work.
 * 3. **Never declare into `--mc-*`.** That prefix is the host's; defining into it would shadow the real
 *    token for this plugin's subtree the moment core publishes one. This plugin's own is
 *    `--wiki-icon-blank`.
 *
 * The published names are a contract — core adds freely and renames never — so referencing one is safe,
 * and a name core has not published yet renders as nothing (rule 2) rather than breaking the page.
 */

import { iconCss } from '@mosaicast/plugin-sdk';

/**
 * The host icons this plugin draws, in the shell's own vocabulary (core's `frontend/dev/icons.txt`).
 *
 * A closed set rather than an open `string`: a typo'd token silently renders nothing, which is exactly
 * the kind of bug that ships. Naming them here makes `<Icon name="serch" />` a compile error, and the
 * SDK's `KnownIconName` catches a name core does not publish.
 */
export const ICON_NAMES = [
  'add',
  'arrow-left',
  'check',
  'clock',
  'delete',
  'dice',
  'edit',
  'history',
  'image',
  'link',
  'list-numbered',
  'music',
  'quote',
  'refresh',
  'search',
  'save',
  'tag',
  'translate',
  'upload',
  'warning',
] as const;

/** One of the host icons {@link ICON_NAMES} declares. */
export type IconName = (typeof ICON_NAMES)[number];

/**
 * The stylesheet behind {@link Icon} — concatenate it into a component's `<style>`.
 *
 * **The SDK builds this since 0.9.0.** It used to be hand-rolled here, and the rule that mattered was the
 * one easiest to get wrong: every reference needs a *blank SVG* fallback, because an unresolved `var()`
 * reverts `mask-image` to its initial `none` and paints `currentColor` across the whole box — a solid
 * square, not a blank space. `iconCss` guarantees that, and adds the `-webkit-` prefixes this plugin's
 * hand-rolled version was missing.
 *
 * The class name is **kebab-case or the SDK throws** — at runtime, inside a render, which the host's error
 * boundary turns into a blanked tile. `tsc` does not catch it.
 */
const ICON_CLASS = 'wiki-icon';

export const ICON_CSS = iconCss(ICON_NAMES, { className: ICON_CLASS });

/**
 * One host icon, as a decorative inline element.
 *
 * Always `aria-hidden`: every call site here puts an icon *beside* a real label, so announcing it would
 * read the meaning twice ("link Linked from").
 *
 * @param name the host icon to draw; see {@link ICON_NAMES}
 */
export function Icon({ name }: { name: IconName }) {
  return <span className={`${ICON_CLASS} ${ICON_CLASS}-${name}`} aria-hidden="true" />;
}
