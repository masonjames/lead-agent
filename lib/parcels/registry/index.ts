/**
 * Parcel Source Registry
 * 
 * Central registry for parcel source adapters.
 * Provides both code-based adapter implementations and
 * DB-driven configuration/enablement.
 */

import type { ParcelSourceKey, SourceConfig } from "../types";
import type { ParcelSourceAdapter, ParcelAdapterFactory } from "../adapters/types";

// ============================================================================
// Registry State
// ============================================================================

const adapterFactories = new Map<ParcelSourceKey, ParcelAdapterFactory>();
const adapterInstances = new Map<ParcelSourceKey, ParcelSourceAdapter>();

// ============================================================================
// Registration
// ============================================================================

/**
 * Register an adapter factory for a source key.
 * Called at module initialization time.
 */
export function registerParcelAdapter(
  key: ParcelSourceKey,
  factory: ParcelAdapterFactory
): void {
  adapterFactories.set(key, factory);
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get an adapter instance for a source key.
 * Creates the adapter on first access (lazy instantiation).
 */
export function getParcelAdapter(key: ParcelSourceKey): ParcelSourceAdapter {
  // Check cache first
  let adapter = adapterInstances.get(key);
  if (adapter) {
    return adapter;
  }

  // Get factory
  const factory = adapterFactories.get(key);
  if (!factory) {
    throw new Error(`No adapter registered for source key: ${key}`);
  }

  // Create and cache instance
  adapter = factory();
  adapterInstances.set(key, adapter);
  return adapter;
}

/**
 * Check if an adapter is registered for a source key.
 */
export function hasParcelAdapter(key: ParcelSourceKey): boolean {
  return adapterFactories.has(key);
}

/**
 * List all registered source keys.
 */
export function listRegisteredSources(): ParcelSourceKey[] {
  return Array.from(adapterFactories.keys());
}

/**
 * List all sources with their basic info.
 */
export function listParcelSources(): Array<{
  key: ParcelSourceKey;
  displayName: string;
  config: SourceConfig;
}> {
  const sources: Array<{
    key: ParcelSourceKey;
    displayName: string;
    config: SourceConfig;
  }> = [];

  for (const key of adapterFactories.keys()) {
    try {
      const adapter = getParcelAdapter(key);
      sources.push({
        key: adapter.key,
        displayName: adapter.displayName,
        config: adapter.config,
      });
    } catch {
      // Skip adapters that fail to instantiate
    }
  }

  return sources;
}

// ============================================================================
// Default Source Resolution
// ============================================================================

const DEFAULT_SOURCE_KEY: ParcelSourceKey = "fl-manatee-pa";

/**
 * Get the default source key from environment or fallback.
 */
export function getDefaultSourceKey(): ParcelSourceKey {
  const envKey = process.env.PARCEL_DEFAULT_SOURCE as ParcelSourceKey | undefined;
  if (envKey && hasParcelAdapter(envKey)) {
    return envKey;
  }
  return DEFAULT_SOURCE_KEY;
}

/**
 * Resolve a source key, using default if not provided.
 */
export function resolveSourceKey(key?: string): ParcelSourceKey {
  if (key && hasParcelAdapter(key as ParcelSourceKey)) {
    return key as ParcelSourceKey;
  }
  return getDefaultSourceKey();
}
