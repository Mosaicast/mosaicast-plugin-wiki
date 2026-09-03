// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { PLATFORM_API_VERSION } from '@mosaicast/plugin-sdk';
import manifest from '../../plugin.json';
import pkg from '../package.json';

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
    for (const key of ['index', 'wikistats', 'ingest:kraken']) {
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

  it('never asks to store SVG, which is a script container wearing an image extension', () => {
    // Rejected at load, and an operator cannot re-enable it either — it is filtered out of the install's
    // allow-list too. Asserted here so a well-meaning "support vector diagrams" edit fails in tests.
    expect(manifest.blobs.mimeTypes).not.toContain('image/svg+xml');
  });

  it('declares positive blob limits, since a non-positive one is rejected at load', () => {
    expect(manifest.blobs.maxFileBytes).toBeGreaterThan(0);
    expect(manifest.blobs.quotaBytes).toBeGreaterThan(0);
    expect(manifest.blobs.maxFileBytes).toBeLessThanOrEqual(manifest.blobs.quotaBytes);
    // A present-but-empty list is rejected too: omit the field to take the operator's list instead.
    expect(manifest.blobs.mimeTypes.length).toBeGreaterThan(0);
  });

  it('credits itself, and matches the licence this repo actually ships', () => {
    // Shown on the host's public /about page. AGPL matches LICENSE and every SPDX header here -- the
    // sample plugin is Apache-2.0, so this is confirmed rather than copied.
    expect(manifest.license).toBe('AGPL-3.0-or-later');
    expect(manifest.author).toBeTruthy();
    expect(manifest.homepage).toContain('mosaicast-plugin-wiki');
  });

  it('pins the same contract version in the manifest and the npm dependency', () => {
    // Four places name the SDK version and nothing but a check compares them. Two are reachable from here;
    // the two gradle coordinates are compared in `.github/workflows/ci.yml`, which can read a .kts file.
    // Neither side is a literal: a hardcoded version here is the trap core fell into on this very bump --
    // a stale literal in a fixture took 26 of that class's 27 cases down with it.
    // An exact major.minor match: a 0.10.x manifest is rejected outright by a 0.11.x host. The credit
    // fields did not cause any of these bumps -- they are unvalidated and additive; the contract did.
    expect(manifest.platformApi).toBe(PLATFORM_API_VERSION);
    expect(pkg.dependencies['@mosaicast/plugin-sdk']).toBe(PLATFORM_API_VERSION);
  });

  it('declares navigation entries the host will accept', () => {
    // Rejected at load: an entry without a `page` slot, a blank label, a path that needed normalising
    // (refused rather than quietly rewritten into a different URL), or two entries on one path.
    expect(manifest.slots.some((slot) => slot.placement === 'page')).toBe(true);
    const paths = manifest.nav.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const entry of manifest.nav) {
      expect(entry.label.trim()).not.toBe('');
      expect(entry.path).toBe(entry.path.replace(/^\/+/, ''));
      expect(entry.path.split('/')).not.toContain('..');
    }
  });

  it('declares a fulltext field, which is the whole reason for a schema', () => {
    const fields = Object.values(manifest.storage.schema.page) as string[];
    expect(fields.some((type) => type.includes(':fulltext'))).toBe(true);
  });
});
