// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  makeMockBlobs,
  makeMockCtx,
  makeMockDocs,
  makeMockSchema,
  type MockDocClient,
  makeMockTranslation,
  type MockSchemaClient,
} from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush, mockUser } from '../test-utils';
import { clearTranslation, peekTranslation } from '../translate';

/** The in-memory doc store behind a mock ctx — the editor writes through `ctx.docs`, not `ctx.api`. */
const docsOf = (ctx: ReturnType<typeof makeMockCtx>) => ctx.docs as MockDocClient;

const KRAKEN = {
  id: 1,
  slug: 'the-kraken',
  title: 'The Kraken',
  summary: 'A very large squid.',
  markdown: 'Seen off Norway.',
  searchText: 'The Kraken',
  tags: 'lore,sea',
  status: 'published',
  updatedAt: '2026-08-01T10:00:00Z',
  revisionNo: 3,
};

const INDEX = {
  'the-kraken': { title: 'The Kraken', summary: 'A very large squid.', tags: 'lore,sea', updatedAt: '2026-08-01T10:00:00Z' },
};

const PODCASTER = mockUser('u1', 'podcaster', 'Ada Lovelace');

function ctxFor(path: string, overrides: Parameters<typeof makeMockCtx>[0] = {}) {
  return makeMockCtx({
    route: { path },
    user: PODCASTER,
    docs: makeMockDocs({ 'data/site/main/index': INDEX }),
    schema: makeMockSchema({ page: [KRAKEN], link: [], source: [], media: [], revision: [] }),
    blobs: makeMockBlobs(),
    ...overrides,
  });
}

describe('<EditorView>', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const render = async (ctx: ReturnType<typeof makeMockCtx>) => {
    await act(async () => {
      root.render(<WikiPage ctx={ctx} />);
    });
    await flush();
    await flush();
  };

  /** A site that authors in English and German — the smallest multilingual case. */
  const bilingual = () => ({
    current: () => 'en',
    onChange: () => () => {},
    available: () => [
      { code: 'en', nativeName: 'English', isDefault: true },
      { code: 'de', nativeName: 'Deutsch', isDefault: false },
    ],
    content: () => [
      { code: 'en', nativeName: 'English', isDefault: true },
      { code: 'de', nativeName: 'Deutsch', isDefault: false },
    ],
  });

  const click = async (selector: string) => {
    const button = host.querySelector<HTMLButtonElement>(selector)!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
  };

  const pick = async (selector: string, value: string) => {
    const field = host.querySelector<HTMLSelectElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  const type = async (selector: string, value: string) => {
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  // The search box in the page chrome is also a form, and it comes first in the DOM -- so reach the
  // editor's through a field only it has.
  const editorForm = () => host.querySelector('#wiki-title')!.closest('form')!;

  const submit = async () => {
    await act(async () => {
      editorForm().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  it('hides the editor from someone whose save could never land', async () => {
    // data.writableBy is podcaster, so the host refuses a fan's PUT regardless. This is courtesy, not
    // security — but showing a form that cannot save is worse than saying why.
    const ctx = ctxFor('the-kraken/edit', { user: mockUser('u2', 'fan') });

    await render(ctx);

    expect(host.textContent).toContain('Only a podcaster can edit the wiki.');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('loads the page it is editing', async () => {
    const ctx = ctxFor('the-kraken/edit');

    await render(ctx);

    expect(host.querySelector<HTMLInputElement>('#wiki-title')?.value).toBe('The Kraken');
    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value).toBe('Seen off Norway.');
    expect(host.querySelector<HTMLInputElement>('#wiki-tags')?.value).toBe('lore, sea');
  });

  it('writes a draft rather than the page, carrying the revision it started from', async () => {
    // There are no schema writes over HTTP: this is a request to write, and baseRevisionNo is what lets
    // the backend refuse it if someone else got there first.
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);

    await type('#wiki-body', 'Seen off Norway and Greenland.');
    await submit();

    expect(docsOf(ctx).stored['data/site/main/draft:the-kraken']).toMatchObject({
      title: 'The Kraken',
      markdown: 'Seen off Norway and Greenland.',
      tags: ['lore', 'sea'],
      baseRevisionNo: 3,
    });
  });

  it('offers no language controls on a site that authors in one language', async () => {
    // A picker with one option and a "translation of" box nothing can answer. Both would be clutter on
    // every wiki that is not multilingual, which is most of them.
    const ctx = ctxFor('the-kraken/edit');

    await render(ctx);

    expect(host.querySelector('#wiki-locale')).toBeNull();
    expect(host.querySelector('#wiki-translation-of')).toBeNull();
  });

  it('carries the language and the original into the draft the backend validates', async () => {
    const ctx = ctxFor('the-kraken/edit', { locale: bilingual() });
    await render(ctx);

    await pick('#wiki-locale', 'de');
    await submit();

    expect(docsOf(ctx).stored['data/site/main/draft:the-kraken']).toMatchObject({
      locale: 'de',
      translationOf: null,
    });
  });

  it('builds the picker from the content languages, not the ones the shell renders in', async () => {
    // The two lists come apart on exactly this: an admin permits authoring in a language the UI does not
    // offer. Building the editor from `available()` would refuse the language the operator asked for.
    const ctx = ctxFor('the-kraken/edit', {
      locale: {
        current: () => 'en',
        onChange: () => () => {},
        available: () => [{ code: 'en', nativeName: 'English', isDefault: true }],
        content: () => [
          { code: 'en', nativeName: 'English', isDefault: true },
          { code: 'nl', nativeName: 'Nederlands', isDefault: false },
        ],
      },
    });

    await render(ctx);

    const codes = [...host.querySelectorAll<HTMLOptionElement>('#wiki-locale option')].map((o) => o.value);
    expect(codes).toEqual(['', 'en', 'nl']);
  });

  it('warns before the tick that a language is already taken in that group', async () => {
    // The backend refuses this on its next pass; saying so here means the author learns now rather than
    // from a rejection receipt seconds later.
    const ctx = ctxFor('a-third/edit', {
      locale: bilingual(),
      schema: makeMockSchema({
        page: [KRAKEN, { ...KRAKEN, id: 3, slug: 'a-third', title: 'A third', revisionNo: 1 }],
        link: [],
        source: [],
        media: [],
        revision: [],
      }),
      docs: makeMockDocs({
        'data/site/main/index': {
          ...INDEX,
          'der-krake': {
            title: 'Der Krake',
            summary: null,
            tags: null,
            updatedAt: null,
            locale: 'de',
            translationOf: 'the-kraken',
          },
          'a-third': {
            title: 'A third',
            summary: null,
            tags: null,
            updatedAt: null,
            locale: null,
            translationOf: null,
          },
        },
      }),
    });
    await render(ctx);

    await pick('#wiki-locale', 'de');
    await pick('#wiki-translation-of', 'the-kraken');

    expect(host.textContent).toContain('der-krake');
  });

  it('offers no translation at all when the handle is null', async () => {
    // Two reasons, deliberately indistinguishable: this manifest did not declare `external.kinds`, or the
    // operator configured no provider — which is every site by default. Both look like this.
    const ctx = ctxFor('the-kraken/edit', { locale: bilingual() });

    await render(ctx);

    const button = host.querySelector<HTMLButtonElement>('.wiki__translate button');
    expect(button?.disabled).toBe(true);
    expect(host.textContent).toContain('no translation provider configured');
  });

  it('translates into the language asked for, and saves none of it', async () => {
    const translation = makeMockTranslation();
    const ctx = ctxFor('the-kraken/edit', { locale: bilingual(), translation });
    await render(ctx);

    await pick('#wiki-translate-target', 'de');
    await click('.wiki__translate button');

    expect(translation.requests.every((request) => request.to === 'de')).toBe(true);
    expect(host.querySelector('.wiki__machine')?.textContent).toContain('[de]');
    // The whole posture of this feature: a machine draft is a proposal, and nothing reached the store.
    expect(docsOf(ctx).calls.filter((call) => call.method === 'put')).toEqual([]);
  });

  it('says a refusal out loud rather than falling back to the untranslated original', async () => {
    const ctx = ctxFor('the-kraken/edit', {
      locale: bilingual(),
      translation: makeMockTranslation({ fail: apiError(403, { detail: 'below external.usedBy' }) }),
    });
    await render(ctx);

    await pick('#wiki-translate-target', 'de');
    await click('.wiki__translate button');

    expect(host.textContent).toContain('not allowed to use');
    expect(host.querySelector('.wiki__machine')).toBeNull();
  });

  it('opens the draft as a new page, carrying the language and the original it belongs to', async () => {
    const ctx = ctxFor('the-kraken/edit', { locale: bilingual(), translation: makeMockTranslation() });
    await render(ctx);
    await pick('#wiki-translate-target', 'de');
    await click('.wiki__translate button');

    await click('.wiki__machine .wiki__btn');

    expect(ctx.navigations.map((n) => n.subpath)).toEqual(['_new']);
    const parked = peekTranslation();
    clearTranslation();
    expect(parked).toMatchObject({
      slug: 'the-kraken-de',
      locale: 'de',
      translationOf: 'the-kraken',
    });
    expect(parked?.markdown).toContain('[de]');
  });

  it('inserts a wiki link chosen from a list, so nobody has to know a slug', async () => {
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);

    await click('.wiki__upload button');            // "Link a page"
    await click('.wiki__pickerlist button');

    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value).toContain('[[the-kraken|The Kraken]]');
  });

  it('cites an episode by its title, with the timestamp the shared grammar accepts', async () => {
    // `ctx.episodes` is the access-filtered list and `ctx.episodeLabels` the human names; the SDK says to
    // use them in pickers for exactly this reason. The stamp goes through `parseTimestamp`, not a fifth
    // implementation of the `?t=` grammar.
    const ctx = ctxFor('the-kraken/edit', {
      episodes: ['s01e02'],
      episodeLabels: { s01e02: 'S01E02 · The Lighthouse' },
    });
    await render(ctx);

    await click('.wiki__upload button:nth-of-type(2)');   // "Cite an episode"
    await type('.wiki__stamp', '12:04');
    await click('.wiki__pickerlist button');

    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value)
      .toContain('[[episode:s01e02@12:04|S01E02 · The Lighthouse]]');
  });

  it('says a timestamp is unreadable instead of guessing at one', async () => {
    const ctx = ctxFor('the-kraken/edit', {
      episodes: ['s01e02'],
      episodeLabels: { s01e02: 'S01E02 · The Lighthouse' },
    });
    await render(ctx);

    await click('.wiki__upload button:nth-of-type(2)');
    await type('.wiki__stamp', 'halfway');

    expect(host.textContent).toContain('Not a time this reads');
  });

  it('files an upload in the library, which is also what keeps it alive', async () => {
    // A library entry is the only thing referencing a file between uploading it and placing it on a page.
    // Without the doc the backend's sweep would delete it an hour later.
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);

    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'kraken photo.png', { type: 'image/png' })],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    await flush();

    const filed = Object.entries(docsOf(ctx).stored).find(([path]) => path.startsWith('data/site/main/asset:'));
    expect(filed?.[1]).toMatchObject({ name: 'kraken photo', mime: 'image/png' });
    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value).toContain('](blob:');
  });

  it('offers what is already in the library rather than a second upload', async () => {
    const ctx = ctxFor('the-kraken/edit', {
      docs: makeMockDocs({
        'data/site/main/index': INDEX,
        'data/site/main/asset:abc-123': { name: 'The kraken photo', mime: 'image/png' },
      }),
    });
    await render(ctx);

    await click('.wiki__upload button:nth-of-type(3)');   // "From the library"
    await flush();
    await click('.wiki__pickerlist button');

    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value)
      .toContain('![The kraken photo](blob:abc-123)');
  });

  it('inserts a library image at the size and placement chosen in the box', async () => {
    // The syntax is now something an author can discover rather than has to know.
    const ctx = ctxFor('the-kraken/edit', {
      docs: makeMockDocs({
        'data/site/main/index': INDEX,
        'data/site/main/asset:abc-123': { name: 'The kraken photo', mime: 'image/png' },
      }),
    });
    await render(ctx);

    await click('.wiki__upload button:nth-of-type(3)');
    await flush();
    await type('.wiki__imgopts input', '320');
    await pick('.wiki__imgopts select', 'right');
    await click('.wiki__pickerlist button');

    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value)
      .toContain('![The kraken photo](blob:abc-123){width=320px align=right}');
  });

  it('defaults to the plain token, so leaving the box alone changes nothing', async () => {
    const ctx = ctxFor('the-kraken/edit', {
      docs: makeMockDocs({
        'data/site/main/index': INDEX,
        'data/site/main/asset:abc-123': { name: 'The kraken photo', mime: 'image/png' },
      }),
    });
    await render(ctx);

    await click('.wiki__upload button:nth-of-type(3)');
    await flush();
    await click('.wiki__pickerlist button');

    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value)
      .toContain('![The kraken photo](blob:abc-123)');
    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value).not.toContain('{');
  });

  it('offers the size box for the image the caret is in, and rewrites that one', async () => {
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);
    await type('#wiki-body', 'Before.\n\n![A squid](blob:abc)\n\nAfter.');

    const area = host.querySelector<HTMLTextAreaElement>('#wiki-body')!;
    await act(async () => {
      area.selectionStart = area.selectionEnd = area.value.indexOf('squid');
      // keyup, not select: React synthesises onSelect from several events rather than binding the native
      // one, so a raw `select` event does not reach the handler.
      area.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
    });

    expect(host.querySelector('.wiki__caretimg')).not.toBeNull();

    await type('.wiki__caretimg input', '50%');

    const value = host.querySelector<HTMLTextAreaElement>('#wiki-body')!.value;
    expect(value).toContain('![A squid](blob:abc){width=50%}');
    expect(value).toContain('Before.');
    expect(value).toContain('After.');
  });

  it('replaces the options on a second edit rather than appending another block', async () => {
    // Typing a width is several edits in a row — "3", "32", "320". Each one has to rewrite the same span,
    // which means knowing the token's new end synchronously rather than after a repaint.
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);
    await type('#wiki-body', 'Before.\n\n![A squid](blob:abc)\n\nAfter.');

    const area = host.querySelector<HTMLTextAreaElement>('#wiki-body')!;
    await act(async () => {
      area.selectionStart = area.selectionEnd = area.value.indexOf('squid');
      area.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
    });

    await type('.wiki__caretimg input', '3');
    await type('.wiki__caretimg input', '32');
    await type('.wiki__caretimg input', '320');

    const value = host.querySelector<HTMLTextAreaElement>('#wiki-body')!.value;
    expect(value).toContain('![A squid](blob:abc){width=320px}');
    expect(value.match(/\{width/g)).toHaveLength(1);
  });

  it('keeps the width already on an image, and adds an alignment beside it', async () => {
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);
    await type('#wiki-body', '![A squid](blob:abc){width=320}');

    const area = host.querySelector<HTMLTextAreaElement>('#wiki-body')!;
    await act(async () => {
      area.selectionStart = area.selectionEnd = area.value.indexOf('squid');
      area.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
    });

    await pick('.wiki__caretimg select', 'center');

    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')!.value)
      .toBe('![A squid](blob:abc){width=320px align=center}');
  });

  it('shows no size box while the caret is in ordinary prose', async () => {
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);
    await type('#wiki-body', 'Just prose, no image.');

    const area = host.querySelector<HTMLTextAreaElement>('#wiki-body')!;
    await act(async () => {
      area.selectionStart = area.selectionEnd = 4;
      area.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
    });

    expect(host.querySelector('.wiki__caretimg')).toBeNull();
  });

  it('says a save is queued instead of claiming it landed', async () => {
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);

    await type('#wiki-body', 'Changed.');
    await submit();

    expect(host.textContent).toContain('Queued.');
    expect(host.textContent).not.toContain('Saved.');
  });

  it('reports the conflict the backend recorded, without losing the writing', async () => {
    vi.useFakeTimers();
    const ctx = ctxFor('the-kraken/edit', {
      docs: makeMockDocs({ 'data/site/main/index': INDEX }),
      // The receipt poll reads through `ctx.api`, past the docs client's memory of a miss.
      apiResponses: {
        'data/site/main/ingest:the-kraken': {
          state: 'conflict',
          detail: 'edited from revision 3, now at 4',
          revisionNo: 4,
          at: '2026-08-21T10:00:00Z',
        },
      },
    });
    await render(ctx);
    await type('#wiki-body', 'My version.');
    await submit();

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    await flush();

    expect(host.textContent).toContain('Someone else edited this page');
    // The text is still in the box: the backend keeps the draft, and so does the form.
    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')?.value).toBe('My version.');
  });

  it('refuses a new page whose address is already taken', async () => {
    const ctx = ctxFor('_new');
    await render(ctx);

    await type('#wiki-title', 'The Kraken');
    await submit();

    expect(host.textContent).toContain('A page already lives at the-kraken.');
    expect(docsOf(ctx).calls.filter((call) => call.method === 'put')).toHaveLength(0);
  });

  it('derives the address from the title until someone edits it', async () => {
    const ctx = ctxFor('_new');
    await render(ctx);

    await type('#wiki-title', 'Deep Sea Trenches!');

    expect(host.querySelector<HTMLInputElement>('#wiki-slug')?.value).toBe('deep-sea-trenches');
  });

  it('requests a delete as a tombstone, so the cascade stays the backend job', async () => {
    const ctx = ctxFor('the-kraken/edit');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render(ctx);

    const remove = [...host.querySelectorAll('button')].find((b) => /Delete page/.test(b.textContent ?? ''))!;
    await act(async () => {
      remove.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect('data/site/main/delete:the-kraken' in docsOf(ctx).stored).toBe(true);
  });

  it('does not delete when the confirmation is declined', async () => {
    const ctx = ctxFor('the-kraken/edit');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render(ctx);

    const remove = [...host.querySelectorAll('button')].find((b) => /Delete page/.test(b.textContent ?? ''))!;
    await act(async () => {
      remove.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(Object.keys(docsOf(ctx).stored).some((path) => path.startsWith('data/site/main/delete:'))).toBe(false);
  });

  it('previews the body through the same sanitiser the reader uses', async () => {
    // A preview must not be the one place author markup reaches the DOM unfiltered.
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);

    await type('#wiki-body', 'Hi <script>alert(1)</script>');

    const preview = host.querySelector('.wiki__preview');
    expect(preview?.innerHTML).not.toContain('<script');
    expect(preview?.textContent).toContain('Hi');
  });

  it('shows the effective quota before anyone picks a file', async () => {
    // An admin's grant replaces the manifest's ask, so quota() is the only honest source. Telling someone
    // the ceiling beats refusing them after the upload.
    const ctx = ctxFor('the-kraken/edit');
    await render(ctx);

    expect(host.textContent).toMatch(/of .* used/);
  });

  it('uploads a picked file and writes its ref, never its URL, into the body', async () => {
    // The ref is the identity; urlFor is derived at render time. A URL in the body would be a copy of a
    // decision the host is entitled to change.
    const blobs = makeMockBlobs();
    const ctx = ctxFor('the-kraken/edit', { blobs });
    await render(ctx);

    const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'diagram.png', { type: 'image/png' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(blobs.uploads[0]).toMatchObject({ filename: 'diagram.png' });
    const body = host.querySelector<HTMLTextAreaElement>('#wiki-body')!.value;
    expect(body).toContain(`blob:${blobs.stored[0].ref}`);
    expect(body).not.toContain('/api/plugins/');
  });

  it('surfaces a refusal to the person who picked the file', async () => {
    // Only they can pick a different one, so swallowing this would leave them with a body that renders
    // nothing and no idea why.
    //
    // The rejection is built here rather than taken from `makeMockBlobs`, which refuses with a plain
    // `Error`: the host refuses with a typed 415 (`isPluginApiError`, `status`), and since SDK 0.9 that
    // status is what a component is told to branch on. Reported to the SDK; until the double carries a
    // status, a test that used it would only prove the fallback branch.
    const blobs = makeMockBlobs({ mimeTypes: ['image/png'] });
    blobs.upload = () =>
      Promise.reject(Object.assign(new Error('content type not allowed'), {
        status: 415,
        problem: { type: 'https://mosaicast.dev/problems/blob-type-not-allowed' },
      }));
    const ctx = ctxFor('the-kraken/edit', { blobs });
    await render(ctx);

    const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => {
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(host.textContent).toContain('That file type cannot be stored here.');
    expect(host.querySelector<HTMLTextAreaElement>('#wiki-body')!.value).not.toContain('blob:');
  });

  it('offers no upload control when the plugin has no file storage', async () => {
    const ctx = ctxFor('the-kraken/edit', { blobs: null });

    await render(ctx);

    expect(host.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('<HistoryView> and <RevisionView>', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = async (ctx: ReturnType<typeof makeMockCtx>) => {
    await act(async () => {
      root.render(<WikiPage ctx={ctx} />);
    });
    await flush();
    await flush();
  };

  const REVISIONS = [
    { id: 2, pageSlug: 'the-kraken', revisionNo: 2, title: 'The Kraken', markdown: 'Seen off Norway.', comment: 'expanded', author: 'u1', createdAt: '2026-08-02T10:00:00Z' },
    { id: 1, pageSlug: 'the-kraken', revisionNo: 1, title: 'The Kraken', markdown: 'A squid.', comment: 'first', author: 'u1', createdAt: '2026-08-01T10:00:00Z' },
  ];

  it('lists revisions newest first, without reading any body', async () => {
    const ctx = ctxFor('the-kraken/history', {
      schema: makeMockSchema({ page: [KRAKEN], revision: REVISIONS, link: [], source: [], media: [] }),
    });

    await render(ctx);

    const query = (ctx.schema as MockSchemaClient).queries.find((q) => q.entity === 'revision');
    expect(query?.query?.orderBy).toEqual([{ field: 'revisionNo', direction: 'desc' }]);
    expect(host.textContent).toContain('revision 2');
    expect(host.textContent).toContain('expanded');
  });

  it('diffs a revision against what the page says now', async () => {
    const ctx = ctxFor('the-kraken/rev/1', {
      schema: makeMockSchema({ page: [KRAKEN], revision: REVISIONS, link: [], source: [], media: [] }),
    });

    await render(ctx);

    expect(host.querySelector('.wiki__diff-line--removed')?.textContent).toContain('A squid.');
    expect(host.querySelector('.wiki__diff-line--added')?.textContent).toContain('Seen off Norway.');
    expect(host.textContent).toContain('1 added, 1 removed');
  });

  it('says so when a revision matches the page exactly', async () => {
    const ctx = ctxFor('the-kraken/rev/2', {
      schema: makeMockSchema({ page: [KRAKEN], revision: REVISIONS, link: [], source: [], media: [] }),
    });

    await render(ctx);

    expect(host.textContent).toContain('Nothing changed since this revision.');
  });

  it('reports a revision number that does not exist', async () => {
    const ctx = ctxFor('the-kraken/rev/99', {
      schema: makeMockSchema({ page: [KRAKEN], revision: REVISIONS, link: [], source: [], media: [] }),
    });

    await render(ctx);

    expect(host.textContent).toContain('There is no revision 99');
  });

  it('keeps an unsaved body when the host hands the plugin a new ctx', async () => {
    // The whole point of the 0.15.0 element change, and it needed two more fixes to be true: the SDK no
    // longer tears the render down, `useSiteDoc` no longer drops to `loading` on a refetch (which unmounted
    // every view gated on it, the editor included), and the editor's load is keyed on the page rather than
    // on the context object (or it would `setMarkdown` over what was typed).
    //
    // `ctx` is reassigned on a login, a theme change and a language change, so losing an edit to one is a
    // live defect, not a hypothetical.
    await act(async () => root.render(<WikiPage ctx={ctxFor('the-kraken/edit')} />));
    await flush();

    const body = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(body).not.toBeNull();
    expect(body.value).toBe(KRAKEN.markdown);

    const typed = 'Seen off Norway. And, once, off Bergen.';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(body, typed);
      body.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(body.value).toBe(typed);

    // A different context object carrying the same thing: what the host does several times over an edit.
    await act(async () => root.render(<WikiPage ctx={ctxFor('the-kraken/edit')} />));
    await flush();

    const after = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(after).toBe(body);            // not remounted
    expect(after.value).toBe(typed);     // not overwritten by the stored body
  });
});
