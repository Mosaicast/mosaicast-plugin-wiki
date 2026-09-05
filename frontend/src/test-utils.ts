// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import type { Role } from '@mosaicast/plugin-sdk';

/**
 * Flushes pending microtasks under `act()`. The mock `ctx.api` client resolves its own promise before
 * a component's `.then(setState)` runs, so a single `await Promise.resolve()` isn't enough — two hops are
 * needed before React's state update actually lands.
 */
export async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * A signed-in user for `makeMockCtx({ user })`.
 *
 * `ctx.user` grew `displayName` and `avatarUrl` in SDK 0.13.0, so a hand-built literal stopped compiling.
 * Built here rather than fixed at each call site so the avatar keeps the host's shape —
 * `/api/users/{id}/avatar`, always host-relative and always populated (§8.7), never a provider URL.
 *
 * @param id          the user's id
 * @param role        their role
 * @param displayName what the directory would call them
 * @returns the shape `ctx.user` has
 */
export function mockUser(id: string, role: Role, displayName = `User ${id}`) {
  return { id, role, displayName, avatarUrl: `/api/users/${id}/avatar` };
}
