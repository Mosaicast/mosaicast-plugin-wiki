// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { PLATFORM_API_VERSION } from '@mosaicast/plugin-sdk';
import manifest from '../../plugin.json';

/**
 * The manifest is the one file no compiler checks, and the failures it causes are load-time: a version
 * bumped in one place only, or a `backendOwned` pattern that swallows a key the plugin's own UI writes.
 */
describe('plugin.json', () => {
  it('declares the SDK version the bundle was built against', () => {
    expect(manifest.platformApi).toBe(PLATFORM_API_VERSION);
  });

  it('reserves no key the client writes', () => {
    // Reserving `draft:*` would 403 the editor against its own plugin — the exact self-inflicted wound
    // `backendOwned` makes easy to write.
    const covered = (key: string) =>
      manifest.data.backendOwned.some((pattern) =>
        pattern === '*' ? true : pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern,
      );

    for (const key of ['draft:kraken', 'delete:kraken']) {
      expect(covered(key)).toBe(false);
    }
    for (const key of ['index', 'episodes', 'wikistats', 'ingest:kraken']) {
      expect(covered(key)).toBe(true);
    }
  });

  it('declares anonymous reads explicitly, since the default is the write floor', () => {
    // Omitting `readableBy` would silently 403 every anonymous visitor — the wiki must be readable by all.
    expect(manifest.data.readableBy).toBe('anonymous');
    expect(manifest.data.writableBy).toBe('podcaster');
  });

  it('puts the deep-link page slot at site scope, or /p/wiki/* is a real 404', () => {
    const page = manifest.slots.find((slot) => slot.placement === 'page');
    expect(page).toBeDefined();
    expect(page?.scope).toBe('site');
  });

  it('declares every element it mounts', () => {
    for (const slot of manifest.slots) {
      expect(manifest.frontend.elements).toContain(slot.element);
    }
  });

  it('declares a fulltext field, which is the whole reason for a schema', () => {
    const fields = Object.values(manifest.storage.schema.page) as string[];
    expect(fields.some((type) => type.includes(':fulltext'))).toBe(true);
  });
});
