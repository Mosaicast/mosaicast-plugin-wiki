// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { PluginContext, UserRef } from '@mosaicast/plugin-sdk';

/**
 * Turns the user ids the wiki stores into the people who wrote the pages.
 *
 * **The wiki has always had ids and never had names.** A revision records `author` and a page records
 * `updatedBy`, both plain UUIDs, because those are the only thing `ctx.user.id` ever gave it — so the
 * history list rendered `5e3410cf-fe81-…` beside every revision. `ctx.users` (SDK 0.13.0) is the lookup
 * that fixes it without the plugin storing a single display name of its own.
 *
 * **Never persist what this returns.** A name and an avatar are presentation; the id is identity. Copying
 * a display name into the schema would outlive the rename meant to shed it and the erasure meant to end
 * it, and the host cannot stop that — it provisioned these tables without ever learning which column holds
 * a person (§12.8). This hook exists so the copy is never made.
 *
 * **Absent, not redacted.** An id that is unknown, erased or pseudonymised is simply missing from the
 * answer — no `null`, no tombstone, and the array is not index-aligned with what was asked. So the result
 * is a `Map` keyed on the id, and a caller renders its own placeholder for a miss. That is exactly the
 * shape this plugin needs: `eraseUser` already nulls the author column, and a revision whose author left
 * is still a revision.
 *
 * @param ctx the plugin context
 * @param ids the user ids to resolve; blanks and duplicates are fine and are dropped
 * @returns the people found, and whether this plugin can name anyone at all — a caller must not render
 *          "a former contributor" for every author just because the directory is absent, which is a lie
 *          about a live one. Without `identity` the honest thing is to attribute nothing.
 */
export function useContributors(
  ctx: PluginContext,
  ids: (string | null | undefined)[],
): { people: Map<string, UserRef>; enabled: boolean } {
  const [people, setPeople] = useState<Map<string, UserRef>>(new Map());

  // Sorted and joined so the effect re-runs when the *set* changes, not when a re-render hands it a new
  // array with the same contents — which is every render, since callers build this list inline.
  const wanted = [...new Set(ids.filter((id): id is string => !!id && id.trim() !== ''))].sort();
  const key = wanted.join(',');

  useEffect(() => {
    const directory = ctx.users;
    if (!directory || wanted.length === 0) {
      setPeople(new Map());
      return;
    }
    let cancelled = false;
    directory
      .resolve(wanted)
      .then((found) => {
        if (!cancelled) {
          setPeople(new Map(found.map((person) => [person.id, person])));
        }
      })
      // Swallowed narrowly, and the fallback is already designed: a caller that cannot name someone shows
      // the same placeholder it shows for an erased account. A history list is not worth failing over.
      .catch((error: unknown) => ctx.log('warn', `wiki: could not resolve contributors: ${String(error)}`));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the identity of `wanted`
  }, [ctx, key]);

  return { people, enabled: ctx.users !== null };
}
