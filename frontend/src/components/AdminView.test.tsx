// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockBlobs, makeMockCtx, makeMockSchema } from '@mosaicast/plugin-sdk/testing';
import { WikiPage } from './WikiPage';
import { flush, mockUser } from '../test-utils';

const INDEX = {
  'the-kraken': { title: 'The Kraken', summary: 'A very large squid.', tags: 'lore', updatedAt: '2026-08-01T10:00:00Z' },
  glossary: { title: 'Glossary', summary: null, tags: null, updatedAt: '2026-08-02T10:00:00Z' },
};

/** Links: the glossary points at a page that exists and at one that does not. */
const LINKS = [
  { id: 1, fromSlug: 'glossary', toSlug: 'the-kraken', kind: 'wiki', label: 'the kraken' },
  { id: 2, fromSlug: 'glossary', toSlug: 'nowhere', kind: 'wiki', label: 'nowhere' },
];

const MEDIA = [
  { id: 1, pageSlug: 'the-kraken', url: null, uploadRef: 'abc-123', kind: 'image', provider: null, caption: null, position: 0 },
  { id: 2, pageSlug: 'the-kraken', url: 'https://cdn.example.com/a.png', uploadRef: null, kind: 'image', provider: 'cdn.example.com', caption: null, position: 1 },
];

function ctxFor(overrides: Parameters<typeof makeMockCtx>[0] = {}) {
  return makeMockCtx({
    route: { path: '_admin' },
    user: mockUser('u1', 'podcaster', 'Ada'),
    apiResponses: {
      'data/site/main/index': INDEX,
      'data/site/main/wikistats': { pages: 2, orphans: 1, brokenLinks: 1, pendingDrafts: 1 },
      'data/site/main?prefix=draft:&size=100': { items: [{ key: 'draft:the-kraken', value: {} }] },
      'data/site/main?prefix=ingest:&size=200': {
        items: [{ key: 'ingest:the-kraken', value: { state: 'conflict', detail: 'edited from revision 1, now at 2' } }],
      },
    },
    schema: makeMockSchema({ page: [], link: LINKS, media: MEDIA, source: [], revision: [] }),
    blobs: makeMockBlobs(),
    ...overrides,
  });
}

describe('<AdminView>', () => {
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

  it('is not offered to someone who cannot act on it', async () => {
    const ctx = ctxFor({ user: mockUser('u2', 'fan') });

    await render(ctx);

    expect(host.textContent).toContain('Only a podcaster can edit the wiki.');
    expect(host.textContent).not.toContain('Wiki dashboard');
  });

  it('names the link that points nowhere, and the page it is on', async () => {
    const ctx = ctxFor();

    await render(ctx);

    expect(host.textContent).toContain('Links to pages that do not exist');
    expect(host.textContent).toContain('Glossary');
    expect(host.textContent).toContain('nowhere');
  });

  it('does not report a link whose target exists', async () => {
    const ctx = ctxFor();

    await render(ctx);

    const broken = [...host.querySelectorAll('.wiki__section')].find((s) =>
      s.textContent?.includes('Links to pages that do not exist'),
    );
    expect(broken?.textContent).not.toContain('The Kraken');
  });

  it('lists a page nothing links to', async () => {
    // The glossary links to the kraken, so the glossary itself is the orphan.
    const ctx = ctxFor();

    await render(ctx);

    const orphans = [...host.querySelectorAll('.wiki__section')].find((s) =>
      s.textContent?.includes('Pages nothing links to'),
    );
    expect(orphans?.textContent).toContain('Glossary');
  });

  it('shows a queued save with the reason it has not landed', async () => {
    const ctx = ctxFor();

    await render(ctx);

    expect(host.textContent).toContain('Saves not applied yet');
    expect(host.textContent).toContain('conflict');
    expect(host.textContent).toContain('edited from revision 1, now at 2');
  });

  it('separates what the wiki stores from what it borrows', async () => {
    // The distinction the section exists for: an uploaded file is the site's own, an external one is a
    // dependency on somebody else's server and a hint to that server about the visitor.
    const ctx = ctxFor();

    await render(ctx);

    expect(host.textContent).toContain('1 uploaded');
    expect(host.textContent).toContain('cdn.example.com');
  });

  it('says a clean section is clean rather than hiding it', async () => {
    // A section that disappears when there is nothing wrong leaves a podcaster wondering whether it ran.
    const ctx = ctxFor({
      schema: makeMockSchema({ page: [], link: [], media: [], source: [], revision: [] }),
    });

    await render(ctx);

    expect(host.textContent).toContain('Every wiki link points at a page.');
  });

  it('still renders when the plugin has no file storage', async () => {
    const ctx = ctxFor({ blobs: null });

    await render(ctx);

    expect(host.textContent).toContain('Wiki dashboard');
  });
});
