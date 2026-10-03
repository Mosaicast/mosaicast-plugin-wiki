// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The wiki's stylesheet, injected into the shadow root by each element.
 *
 * Every colour is a host theme token (`--mc-*`), never a literal: the shell owns light/dark and the accent
 * seed, and a plugin that hardcodes a colour looks broken the moment an operator changes either. The SDK
 * sets those custom properties on the shadow root for us.
 *
 * `style-src 'unsafe-inline'` is kept by the host precisely because a runtime-constructed shadow root
 * cannot carry a nonce, so an inline `<style>` is the supported way to do this.
 */
import { ICON_CSS } from '../icons';

// NOTE: no backticks in the comments below — this whole block is one template literal, and a stray
// backtick ends it mid-rule. It has broken the build three times; `npm run typecheck` is what catches it.
export const WIKI_CSS = ICON_CSS + `
  :host { display: block; container-type: inline-size; --wiki-pane: 26rem; }
  .wiki {
    color: var(--mc-text);
    font: inherit;
    line-height: 1.6;
  }
  /* The page region hands a plugin the bare width of the viewport: the shell adds no gutter there,
     because a deep-link page is the plugin's whole canvas. A tile in the site or main region sits in a
     host container that already has one, so only the page view adds its own. */
  .wiki--page {
    max-width: 56rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  .wiki a { color: var(--mc-accent-text); text-decoration: none; }
  .wiki a:hover, .wiki a:focus-visible { text-decoration: underline; }
  .wiki__bar {
    display: flex; flex-wrap: wrap; gap: .5rem; align-items: center;
    margin-bottom: 1.25rem;
  }
  .wiki__crumbs { color: var(--mc-text-muted); font-size: .875rem; }
  .wiki__search { display: flex; gap: .5rem; flex: 1 1 16rem; min-width: 0; }
  .wiki__input {
    flex: 1 1 auto; min-width: 0;
    padding: .5rem .75rem;
    color: var(--mc-text);
    background: var(--mc-bg);
    border: 1px solid var(--mc-border);
    border-radius: .5rem;
    font: inherit;
  }
  .wiki__input:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .wiki__btn {
    display: inline-flex; align-items: center; gap: .35rem;
    padding: .5rem .9rem;
    color: var(--mc-accent-contrast);
    background: var(--mc-accent);
    border: 1px solid transparent;
    border-radius: .5rem;
    font: inherit; cursor: pointer;
  }
  .wiki__btn--ghost { color: var(--mc-text); background: transparent; border-color: var(--mc-border); }
  .wiki__title { margin: 0 0 .25rem; font-size: 1.5rem; line-height: 1.25; }
  .wiki__meta { margin: 0 0 1rem; color: var(--mc-text-muted); font-size: .875rem; }
  /* A contributor: the avatar the host generates for every account, and the name it resolves now — never
     a name this plugin stored, which would outlive the rename or erasure meant to change it. */
  .wiki__who { display: inline-flex; align-items: center; gap: .3rem; vertical-align: middle; }
  .wiki__who--gone { font-style: italic; opacity: .8; }
  .wiki__avatar { width: 1.25rem; height: 1.25rem; border-radius: 50%; object-fit: cover; }
  .wiki__empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--mc-text-muted);
    background: var(--mc-surface);
    border: 1px dashed var(--mc-border);
    border-radius: .75rem;
  }
  .wiki__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
  .wiki__item {
    padding: .75rem .9rem;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: .625rem;
  }
  .wiki__item h3 { margin: 0 0 .15rem; font-size: 1rem; }
  .wiki__item p { margin: 0; color: var(--mc-text-muted); font-size: .875rem; }
  .wiki__tags { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .5rem; }
  .wiki__tag {
    padding: .1rem .5rem;
    color: var(--mc-text-muted);
    border: 1px solid var(--mc-border);
    border-radius: 999px;
    font-size: .75rem;
  }
  .wiki__error { color: var(--mc-text); background: var(--mc-surface);
                 border: 1px solid var(--mc-border); border-left: 3px solid var(--mc-accent-2);
                 border-radius: .5rem; padding: .75rem .9rem; }
  .wiki__section { margin-top: 2rem; }
  .wiki__section h2 { font-size: 1.125rem; margin: 0 0 .6rem; }
  .wiki__section-title { font-size: 1.125rem; margin: 1.5rem 0 .6rem; }
  .wiki__toc {
    margin: 0 0 1.5rem;
    padding: .75rem 1rem;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: .625rem;
  }
  .wiki__toc h2 { margin: 0 0 .4rem; font-size: .8125rem; text-transform: uppercase;
                  letter-spacing: .06em; color: var(--mc-text-muted); }
  .wiki__toc ul { list-style: none; margin: 0; padding: 0; }
  .wiki__toc li[data-level="3"] { padding-left: 1rem; }
  .wiki__body { overflow-wrap: anywhere; }
  .wiki__body h2 { font-size: 1.25rem; margin: 1.75rem 0 .5rem; }
  .wiki__body h3 { font-size: 1.0625rem; margin: 1.25rem 0 .4rem; }
  .wiki__body p { margin: 0 0 1rem; }
  .wiki__body ul, .wiki__body ol { margin: 0 0 1rem; padding-left: 1.25rem; }
  .wiki__body img { max-width: 100%; height: auto; border-radius: .5rem; }
  /* An author-chosen width arrives as an inline style; max-width above stays the ceiling, so a width
     wider than the column still cannot overflow on a phone. */
  .wiki__body img.wiki__img { display: block; }
  .wiki__body img.wiki__img--center { margin-inline: auto; }
  .wiki__body img.wiki__img--left  { float: left;  margin: .25rem 1rem .5rem 0; }
  .wiki__body img.wiki__img--right { float: right; margin: .25rem 0 .5rem 1rem; }
  /* A float must not escape its paragraph into the next section's heading. */
  .wiki__body h2, .wiki__body h3 { clear: both; }
  .wiki__body blockquote {
    margin: 0 0 1rem; padding: .25rem 0 .25rem .9rem;
    border-left: 3px solid var(--mc-border); color: var(--mc-text-muted);
  }
  .wiki__body code {
    padding: .1rem .3rem; background: var(--mc-surface);
    border: 1px solid var(--mc-border); border-radius: .25rem; font-size: .9em;
  }
  /* A wide table or code block scrolls inside itself; the page must never scroll sideways. */
  .wiki__body pre { overflow-x: auto; padding: .75rem .9rem; background: var(--mc-surface);
                    border: 1px solid var(--mc-border); border-radius: .5rem; }
  .wiki__body pre code { padding: 0; background: none; border: 0; }
  .wiki__table-wrap, .wiki__body table { display: block; overflow-x: auto; max-width: 100%; }
  /* A link to a page nobody has written yet: shown as missing rather than silently dead. */
  .wiki-link--missing { color: var(--mc-text-muted); text-decoration: underline dotted; }
  /* An episode citation is marked with the shell's own icon, masked so it takes the link's colour.
     This used to be a literal note character, which rendered as whatever emoji font the visitor had. */
  .wiki-ep::before {
    content: "";
    display: inline-block;
    width: 1em; height: 1em;
    margin-right: .25rem;
    vertical-align: -0.125em;
    mask-image: var(--mc-icon-music, var(--wiki-icon-blank));
    mask-size: contain; mask-repeat: no-repeat; mask-position: center;
    background: currentColor;
  }
  /* Rule 2 in icons.tsx: an unresolved var() reverts mask-image to its initial "none" and paints a solid
     square, so every reference above needs this fallback declared somewhere it inherits from. */
  .wiki { --wiki-icon-blank: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"); }
  .wiki__section h2 .wiki-icon, .wiki__toc h2 .wiki-icon { margin-right: .35rem; opacity: .75; }
  .wiki__tag .wiki-icon { margin-right: .2rem; opacity: .7; }
  .wiki__sources { margin: 0; padding-left: 1.25rem; }
  .wiki__sources li { margin-bottom: .35rem; }
  .wiki__note { color: var(--mc-text-muted); }
  a.wiki__tag:hover { color: var(--mc-text); border-color: var(--mc-accent); text-decoration: none; }


  /* The title and the controls that act on this page, on one line. Right-aligned so the heading keeps the
     left edge every other block on the page shares. */
  /* flow-root, so the float is contained without overflow:hidden -- which would clip the language menu
     the moment it opened. */
  .wiki__titlerow { display: flow-root; margin-bottom: .25rem; }
  .wiki__titlerow .wiki__title { margin: 0; }
  /* Floated rather than a flex sibling: a flex row can only shrink the heading or push the controls onto
     their own line, and neither is what a title longer than one line should do. A float shortens just the
     line boxes it sits beside, so the controls stay level with the first line and the rest of the title
     wraps full width underneath them. */
  .wiki__pagetools {
    float: right; display: flex; align-items: center; gap: .25rem;
    margin-left: 1rem;
  }

  /* Icon-only, so it needs a hit area a finger can reach and a label only a screen reader reads. */
  .wiki__iconbtn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 2rem; height: 2rem;
    color: var(--mc-text-muted); border: 1px solid transparent; border-radius: .375rem;
  }
  .wiki__iconbtn:hover { color: var(--mc-text); border-color: var(--mc-border); text-decoration: none; }
  .wiki__iconbtn:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .wiki__vh {
    position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
  }

  /* The language menu. The details element gives the open state, Escape and keyboard operation for free;
     all this has to add is the popover's position and taking the disclosure marker off. */
  .wiki__langmenu { position: relative; }
  .wiki__langmenu > summary {
    display: inline-flex; align-items: center; gap: .3rem;
    height: 2rem; padding: 0 .5rem;
    color: var(--mc-text-muted); border: 1px solid transparent; border-radius: .375rem;
    font-size: .8125rem; cursor: pointer; list-style: none;
  }
  .wiki__langmenu > summary::-webkit-details-marker { display: none; }
  .wiki__langmenu > summary:hover,
  .wiki__langmenu[open] > summary { color: var(--mc-text); border-color: var(--mc-border); }
  .wiki__langmenu > summary:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  .wiki__caret {
    width: 0; height: 0; margin-left: .1rem;
    border-left: .25rem solid transparent; border-right: .25rem solid transparent;
    border-top: .3rem solid currentColor;
  }
  .wiki__langmenu[open] .wiki__caret { transform: rotate(180deg); }
  .wiki__langlist {
    position: absolute; top: calc(100% + .25rem); right: 0; z-index: 2;
    min-width: 10rem; margin: 0; padding: .25rem; list-style: none;
    background: var(--mc-surface); border: 1px solid var(--mc-border); border-radius: .5rem;
  }
  .wiki__langlist .wiki__lang {
    display: block; padding: .3rem .5rem; border-radius: .25rem;
    color: var(--mc-text-muted); font-size: .875rem; white-space: nowrap;
  }
  .wiki__langlist a.wiki__lang:hover { color: var(--mc-text); background: var(--mc-bg); text-decoration: none; }
  .wiki__lang--current { color: var(--mc-text); font-weight: 600; }
  /* A page's language, shown on a list row only where the site has more than one to tell apart. */
  .wiki__langchip {
    margin-left: .4rem; padding: 0 .35rem;
    color: var(--mc-text-muted); border: 1px solid var(--mc-border); border-radius: .25rem;
    font-size: .6875rem; text-transform: uppercase; letter-spacing: .03em;
  }

  .wiki__field { margin-bottom: 1rem; }
  /* Size and placement for an image, so the syntax is something you can learn rather than must know. */
  .wiki__imgopts { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: .5rem; }
  .wiki__imgopts label {
    display: flex; align-items: center; gap: .4rem; margin: 0;
    font-size: .8125rem; font-weight: 600; color: var(--mc-text-muted);
  }
  .wiki__imgopts .wiki__input { width: auto; flex: 0 0 8rem; }
  .wiki__imgopts .wiki__error { flex: 1 0 100%; margin: 0; }
  .wiki__caretimg {
    margin-top: .5rem; padding: .5rem .6rem;
    background: var(--mc-surface); border: 1px solid var(--mc-border); border-radius: .5rem;
  }
  .wiki__caretimg .wiki__hint { margin: 0; }
  /* Two fields side by side where there is room; the container query below stacks them. */
  .wiki__row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .wiki__field label, .wiki__label {
    display: block; margin-bottom: .3rem;
    font-size: .8125rem; font-weight: 600; color: var(--mc-text-muted);
  }
  .wiki__hint { margin: .3rem 0 0; font-size: .8125rem; color: var(--mc-text-muted); }
  /* In the bar an input is a flex child; in a field it is the whole row. */
  .wiki__field .wiki__input { width: 100%; box-sizing: border-box; }
  /* One height for the body and the preview, so the two halves line up and can be scrolled against each
     other. A shared token rather than two numbers that drift apart. */
  .wiki__area {
    display: block; width: 100%; box-sizing: border-box; height: var(--wiki-pane);
    padding: .6rem .75rem;
    color: var(--mc-text); background: var(--mc-bg);
    border: 1px solid var(--mc-border); border-radius: .5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875rem; line-height: 1.55;
    resize: vertical;
  }
  .wiki__area:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: 1px; }
  /* Two columns where there is room; the container query below stacks them on a phone. */
  .wiki__editor { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; align-items: start; }
  .wiki__preview {
    height: var(--wiki-pane); box-sizing: border-box; overflow-y: auto;
    padding: .6rem .75rem;
    background: var(--mc-surface); border: 1px solid var(--mc-border); border-radius: .5rem;
  }
  .wiki__translate { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .wiki__translate .wiki__input { flex: 0 1 14rem; }
  /* A machine draft is walled off from the form around it: it is a proposal, not a field. */
  .wiki__machine {
    margin-top: .75rem; padding: .75rem;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border); border-left: 3px solid var(--mc-accent-2);
    border-radius: .5rem;
  }
  .wiki__machine h3 { margin: .25rem 0 .5rem; font-size: 1rem; }
  .wiki__machine .wiki-icon { margin-right: .3rem; }
  .wiki__machinebody {
    max-height: 18rem; margin: 0; padding: .5rem .6rem; overflow: auto;
    background: var(--mc-bg); border: 1px solid var(--mc-border); border-radius: .375rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
  }
  /* One row of insert controls, so "add an image" sits with the other three ways of putting something in
     the body rather than below whatever panel one of them opened. */
  .wiki__upload { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .5rem; }

  /* An insert picker: a search field and a list of things to click, opened under the toolbar it belongs to
     rather than in a dialog. It replaces knowing a slug by heart, so it has to be quicker than typing one. */
  .wiki__picker {
    margin-top: .5rem; padding: .5rem;
    background: var(--mc-surface); border: 1px solid var(--mc-border); border-radius: .5rem;
  }
  .wiki__pickerbar { display: flex; flex-wrap: wrap; gap: .5rem; }
  .wiki__pickerbar .wiki__input { flex: 1 1 12rem; }
  .wiki__stamp { flex: 0 0 7rem; }
  .wiki__pickerlist { max-height: 15rem; margin: .5rem 0 0; padding: 0; overflow-y: auto; list-style: none; }
  .wiki__pickerlist button {
    display: flex; align-items: center; gap: .5rem; width: 100%;
    padding: .35rem .5rem; border: 0; border-radius: .375rem;
    color: var(--mc-text); background: transparent;
    font: inherit; font-size: .875rem; text-align: left; cursor: pointer;
  }
  .wiki__pickerlist button:hover { background: var(--mc-bg); }
  .wiki__pickerlist button:focus-visible { outline: 2px solid var(--mc-accent-text); outline-offset: -2px; }
  .wiki__pickerlist span { flex: 1 1 auto; }
  .wiki__pickerlist code {
    flex: none; color: var(--mc-text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .75rem;
  }
  .wiki__pickerlist .wiki__phase {
    flex: none; padding: .05rem .45rem; border: 1px solid var(--mc-border); border-radius: 999px;
    color: var(--mc-text-muted); font-size: .6875rem; white-space: nowrap;
  }
  .wiki__phase--planned { border-color: var(--mc-accent-2); color: var(--mc-text); }
  .wiki__thumb { flex: none; width: 2.5rem; height: 2.5rem; object-fit: cover; border-radius: .25rem; }
  .wiki__upload .wiki__btn { cursor: pointer; }
  .wiki__actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.25rem; }
  .wiki__btn--danger { color: var(--mc-text); background: transparent; border-color: var(--mc-accent-2); }
  .wiki__btn:disabled { opacity: .6; cursor: default; }
  .wiki__status {
    display: flex; align-items: center; gap: .4rem;
    margin: 1rem 0 0; padding: .6rem .8rem;
    color: var(--mc-text-muted); background: var(--mc-surface);
    border: 1px solid var(--mc-border); border-radius: .5rem; font-size: .875rem;
  }
  .wiki__status--ok { color: var(--mc-text); border-color: var(--mc-accent); }
  /* A diff is monospace and scrolls inside itself; the page must never scroll sideways for it. */
  .wiki__diff {
    overflow-x: auto;
    border: 1px solid var(--mc-border); border-radius: .5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; line-height: 1.6;
  }
  .wiki__diff-line { display: flex; gap: .5rem; padding: 0 .5rem; white-space: pre; }
  .wiki__diff-no {
    flex: none; width: 2.5rem; text-align: right;
    color: var(--mc-text-muted); opacity: .7; user-select: none;
  }
  .wiki__diff-mark { flex: none; width: 1ch; user-select: none; }
  .wiki__diff-text { flex: 1 1 auto; }
  /* Colour alone must not carry the added/removed distinction, so every line keeps its +/- mark. */
  .wiki__diff-line--added { background: color-mix(in oklab, var(--mc-accent) 14%, transparent); }
  .wiki__diff-line--removed { background: color-mix(in oklab, var(--mc-accent-2) 14%, transparent); }
  .wiki__diff-gap {
    padding: .15rem .5rem; color: var(--mc-text-muted);
    background: var(--mc-surface); border-block: 1px solid var(--mc-border); user-select: none;
  }

  .wiki__counters {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: .5rem; margin: 0 0 1.5rem;
  }
  .wiki__counter {
    padding: .6rem .8rem; background: var(--mc-surface);
    border: 1px solid var(--mc-border); border-radius: .625rem;
  }
  .wiki__counter dt { margin: 0 0 .15rem; font-size: .75rem; text-transform: uppercase;
                      letter-spacing: .05em; color: var(--mc-text-muted); }
  .wiki__counter dd { margin: 0; font-size: 1.5rem; line-height: 1.1; }
  .wiki__count {
    margin-left: .4rem; padding: 0 .4rem;
    color: var(--mc-accent-contrast); background: var(--mc-accent);
    border-radius: 999px; font-size: .75rem; vertical-align: .1em;
  }
  .wiki__item code { font-size: .875em; }

  .wiki__epcards { display: grid; gap: .5rem; }
  .wiki__epcard {
    display: flex; gap: .75rem; align-items: flex-start;
    padding: .7rem .8rem;
    background: var(--mc-surface); border: 1px solid var(--mc-border); border-radius: .625rem;
    color: inherit;
  }
  .wiki__epcard:hover { border-color: var(--mc-accent); text-decoration: none; }
  .wiki__epcard img { flex: none; width: 4rem; height: 4rem; object-fit: cover; border-radius: .5rem; }
  .wiki__epcard-body { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
  .wiki__epcard-title { color: var(--mc-accent-text); font-weight: 600; }
  .wiki__epcard-meta { color: var(--mc-text-muted); font-size: .8125rem; }
  .wiki__epcard-note {
    color: var(--mc-text-muted); font-size: .875rem;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* The lead: an article's own summary, set apart from the body it introduces. */
  .wiki__lead {
    margin: 0 0 1.25rem; padding-left: .9rem;
    border-left: 3px solid var(--mc-accent);
    font-size: 1.0625rem; line-height: 1.55;
  }
  .wiki__intro { margin-bottom: 2rem; }
  .wiki__intro .wiki__body > :last-child { margin-bottom: .25rem; }
  .wiki__intro .wiki__meta { margin-top: .75rem; }
  .wiki__random .wiki__btn { margin-top: .6rem; }
  .wiki__random + .wiki__tags { margin-top: 1.5rem; }

  /* One narrow-container block, so there is a single place to look for the phone layout. */
  @container (max-width: 30rem) {
    .wiki--page { padding: 1rem .75rem 2rem; }
    .wiki__bar { flex-direction: column; align-items: stretch; }
    /* The bar becomes a column here, and in a column flex container flex-basis sizes the HEIGHT — so the
       row layout's "flex: 1 1 16rem" would make the search field 16rem tall instead of 16rem wide. */
    .wiki__search { flex: 0 0 auto; }
    /* Side-by-side editing needs width the phone has not got; the preview follows the body instead. */
    .wiki__editor, .wiki__row { grid-template-columns: 1fr; }
    /* A floated image beside a 20-character measure is not a layout. Below this width they stack. */
    .wiki__body img.wiki__img--left,
    .wiki__body img.wiki__img--right { float: none; margin: .25rem 0 .5rem; }
    /* Icon only: at this width the language's name is the difference between a title with room to breathe
       and one broken across three lines. The summary keeps its aria-label, so the control is still named
       for anyone who cannot see which icon it is. */
    .wiki__langmenu > summary { padding: 0 .35rem; }
    .wiki__langcurrent { display: none; }
    /* On the container, not :host — a container query cannot restyle the element it queries, and the
       token inherits down from .wiki just as well. */
    .wiki { --wiki-pane: 16rem; }
  }
`;
