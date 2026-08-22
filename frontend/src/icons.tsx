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

/**
 * An empty SVG, used as the fallback mask for every icon.
 *
 * Masking with a document that draws nothing hides the element; falling through to `mask-image: none`
 * would show it, filled edge to edge with `currentColor`. This constant is the whole difference between
 * "old host, no icon" and "old host, a black square in every heading".
 */
const BLANK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E\")";

/**
 * The host icons this plugin draws, in the shell's own vocabulary (core's `frontend/dev/icons.txt`).
 *
 * A closed set rather than an open `string`: a typo'd token silently renders nothing (rule 2), which is
 * exactly the kind of bug that ships. Naming them here makes `<Icon name="serch" />` a compile error.
 */
export const ICON_NAMES = [
  'arrow-left',
  'check',
  'clock',
  'delete',
  'edit',
  'history',
  'link',
  'list-numbered',
  'music',
  'quote',
  'search',
  'save',
  'tag',
  'upload',
  'warning',
] as const;

/** One of the host icons {@link ICON_NAMES} declares. */
export type IconName = (typeof ICON_NAMES)[number];

/**
 * The stylesheet behind {@link Icon} and the `::before` marks — concatenate it into a component's
 * `<style>`.
 *
 * A string rather than a CSS file because each of this plugin's elements renders into its own shadow
 * root: a bundled stylesheet would land in the host document, where it could reach none of them.
 *
 * `em` sizing throughout, so an icon scales with the text it sits beside — a tag chip and a section
 * heading get proportionate icons without either naming a pixel size.
 */
export const ICON_CSS = `
  .wikiIcon {
    --wiki-icon-blank: ${BLANK};
    display: inline-block;
    flex: none;
    width: 1em;
    height: 1em;
    vertical-align: -0.125em;
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-position: center;
    background: currentColor;
  }
${ICON_NAMES.map((name) => `  .wikiIcon--${name} { mask-image: var(--mc-icon-${name}, var(--wiki-icon-blank)); }`).join('\n')}
`;

/**
 * One host icon, as a decorative inline element.
 *
 * Always `aria-hidden`: every call site here puts an icon *beside* a real label, so announcing it would
 * read the meaning twice ("link Linked from"). An icon carrying meaning on its own would need a visible
 * or `aria-label`led name instead.
 *
 * @param name the host icon to draw; see {@link ICON_NAMES}
 */
export function Icon({ name }: { name: IconName }) {
  return <span className={`wikiIcon wikiIcon--${name}`} aria-hidden="true" />;
}
