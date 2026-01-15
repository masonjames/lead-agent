import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { externalSessions } from "@/lib/db/schema";
import type { PlaywrightStorageState } from "./session";

export async function getLatestSession(
  provider: string,
  accountKey?: string
): Promise<PlaywrightStorageState | null> {
  const filters = [eq(externalSessions.provider, provider)];

  if (accountKey) {
    filters.push(eq(externalSessions.accountKey, accountKey));
  } else {
    filters.push(isNull(externalSessions.accountKey));
  }

  const [row] = await db
    .select({ storageState: externalSessions.storageState })
    .from(externalSessions)
    .where(and(...filters))
    .orderBy(desc(externalSessions.updatedAt))
    .limit(1);

  return (row?.storageState as PlaywrightStorageState | undefined) ?? null;
}

export async function upsertSession(
  provider: string,
  accountKey: string | undefined,
  state: PlaywrightStorageState
): Promise<void> {
  const filters = [eq(externalSessions.provider, provider)];

  if (accountKey) {
    filters.push(eq(externalSessions.accountKey, accountKey));
  } else {
    filters.push(isNull(externalSessions.accountKey));
  }

  const [existing] = await db
    .select({ id: externalSessions.id })
    .from(externalSessions)
    .where(and(...filters))
    .limit(1);

  if (existing?.id) {
    await db
      .update(externalSessions)
      .set({ storageState: state, updatedAt: new Date() })
      .where(eq(externalSessions.id, existing.id));
    return;
  }

  await db.insert(externalSessions).values({
    provider,
    accountKey: accountKey || null,
    storageState: state,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
