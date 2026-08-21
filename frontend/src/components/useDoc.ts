// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
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

    ctx.api
      .get<T>(`${SITE_PATH}/${key}`)
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, failed: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const missing = /\b404\b/.test(String(error));
        if (!missing) {
          ctx.log('warn', `wiki: could not read ${key}: ${String(error)}`);
        }
        setState({ data: null, loading: false, failed: !missing });
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, key]);

  return state;
}
