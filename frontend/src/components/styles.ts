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
export const WIKI_CSS = `
  :host { display: block; container-type: inline-size; }
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
  .wiki a { color: var(--mc-accent); text-decoration: none; }
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
  .wiki__input:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
  .wiki__btn {
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
  /* One narrow-container block, so there is a single place to look for the phone layout. */
  @container (max-width: 30rem) {
    .wiki--page { padding: 1rem .75rem 2rem; }
    .wiki__bar { flex-direction: column; align-items: stretch; }
    /* The bar becomes a column here, and in a column flex container flex-basis sizes the HEIGHT — so the
       row layout's "flex: 1 1 16rem" would make the search field 16rem tall instead of 16rem wide. */
    .wiki__search { flex: 0 0 auto; }
  }
`;
