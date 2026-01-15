import "server-only";

import type { BrowserContext } from "playwright-core";
import { getLatestSession, upsertSession } from "./session-repository";

export type PlaywrightStorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax" | "None" | "Strict";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

const PROVIDER_KEY = "stellarmls_realist";

function parseStorageState(input: string): PlaywrightStorageState | undefined {
  try {
    const parsed = JSON.parse(input) as PlaywrightStorageState;
    if (!parsed || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function loadStellarStorageStateFromService(): Promise<PlaywrightStorageState | undefined> {
  const url = process.env.STELLARMLS_SESSION_INFO_URL;
  if (!url) return undefined;

  const headers: Record<string, string> = {};
  const jwt = process.env.STELLARMLS_SESSION_INFO_JWT;
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
  }

  try {
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) return undefined;

    const payload = await response.json();
    if (!payload) return undefined;

    if (typeof payload === "string") {
      const decoded = Buffer.from(payload, "base64").toString("utf-8");
      return parseStorageState(decoded) || parseStorageState(payload);
    }

    const candidate =
      (payload as Record<string, unknown>).storageState ||
      (payload as Record<string, unknown>).storage_state ||
      payload;

    if (typeof candidate === "string") {
      return parseStorageState(candidate);
    }

    if (
      typeof candidate === "object" &&
      candidate &&
      Array.isArray((candidate as PlaywrightStorageState).cookies)
    ) {
      return candidate as PlaywrightStorageState;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getAccountKey(): string | undefined {
  return (
    process.env.STELLARMLS_SESSION_ACCOUNT_KEY ||
    process.env.STELLARMLS_USERNAME ||
    undefined
  );
}

function isDbSessionEnabled(): boolean {
  return process.env.STELLARMLS_SESSION_DB_ENABLED === "true" && !!process.env.DATABASE_URL;
}

export function loadStellarStorageStateFromEnv(): PlaywrightStorageState | undefined {
  const rawJson = process.env.STELLARMLS_STORAGE_STATE_JSON;
  if (rawJson) {
    return parseStorageState(rawJson);
  }

  const rawB64 = process.env.STELLARMLS_STORAGE_STATE_B64;
  if (!rawB64) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(rawB64, "base64").toString("utf-8");
    return parseStorageState(decoded);
  } catch {
    return undefined;
  }
}

export async function loadStellarStorageState(): Promise<PlaywrightStorageState | undefined> {
  const envState = loadStellarStorageStateFromEnv();
  if (envState) {
    return envState;
  }

  const serviceState = await loadStellarStorageStateFromService();
  if (serviceState) {
    return serviceState;
  }

  if (!isDbSessionEnabled()) {
    return undefined;
  }

  return (await getLatestSession(PROVIDER_KEY, getAccountKey())) ?? undefined;
}

export async function saveStellarStorageState(state: PlaywrightStorageState): Promise<void> {
  if (!isDbSessionEnabled()) {
    return;
  }

  await upsertSession(PROVIDER_KEY, getAccountKey(), state);
}

export async function exportStorageState(
  context: BrowserContext
): Promise<PlaywrightStorageState> {
  return (await context.storageState()) as PlaywrightStorageState;
}
