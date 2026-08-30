// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { isPluginApiError } from '@mosaicast/plugin-sdk';
import { SITE_PATH } from '../types';

/** What a fetch is doing right now. `error` never carries a server message — the UI translates its own. */
export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  failed: boolean;
}

/**
 * Reads one site-scoped doc key.
 *
 * A **404 is not a failure** here: an absent document is the correct answer for a wiki nobody has written
 * to yet, and treating it as an error would show a scary tile on a healthy empty install. Anything else is
 * reported, because a 403 (a misdeclared `readableBy` floor) must not look like emptiness.
 *
 * @param ctx the host context
 * @param key the doc key below `data/site/main/`
 * @returns the document, or `null` when it does not exist yet
 */
export function useSiteDoc<T>(ctx: PluginContext, key: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, loading: true, failed: false });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, failed: false });

    // `getOrNull` resolves an absent document to null instead of rejecting. Before SDK 0.9 this was a
    // `catch` that sniffed the message for "404" -- which also swallowed the 403 and the 500 it could not
    // tell apart, and a plugin silently showing an empty tile is exactly how a misdeclared read floor
    // hides.
    ctx.api
      .getOrNull<T>(`${SITE_PATH}/${key}`)
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, failed: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        ctx.log('warn', `wiki: could not read ${key}: ${describeApiError(error)}`);
        setState({ data: null, loading: false, failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, key]);

  return state;
}

/** The status and problem type behind a rejection, so a log line says which rule refused. */
export function describeApiError(error: unknown): string {
  // Not `instanceof`: the error crosses a bundle boundary from the host, so identity is not reliable.
  return isPluginApiError(error)
    ? `${error.status} ${error.problem?.type ?? ''}`.trim()
    : String(error);
}
