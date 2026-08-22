// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockBlobs, makeMockCtx, makeMockSchema, type MockSchemaClient } from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush } from '../test-utils';

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

const PODCASTER = { id: 'u1', role: 'podcaster' as const };

function ctxFor(path: string, overrides: Parameters<typeof makeMockCtx>[0] = {}) {
  return makeMockCtx({
    route: { path },
    user: PODCASTER,
    apiResponses: { 'data/site/main/index': INDEX },
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
    const ctx = ctxFor('the-kraken/edit', { user: { id: 'u2', role: 'fan' } });

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

    const put = ctx.api.calls.find((call) => call.method === 'put');
    expect(put?.path).toBe('data/site/main/draft:the-kraken');
    expect(put?.body).toMatchObject({
      title: 'The Kraken',
      markdown: 'Seen off Norway and Greenland.',
      tags: ['lore', 'sea'],
      baseRevisionNo: 3,
    });
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
      apiResponses: {
        'data/site/main/index': INDEX,
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
    expect(ctx.api.calls.filter((call) => call.method === 'put')).toHaveLength(0);
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

    expect(ctx.api.calls.some((call) => call.method === 'put' && call.path === 'data/site/main/delete:the-kraken')).toBe(true);
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

    expect(ctx.api.calls.some((call) => call.path.startsWith('data/site/main/delete:'))).toBe(false);
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
    const blobs = makeMockBlobs({ mimeTypes: ['image/png'] });
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
});
