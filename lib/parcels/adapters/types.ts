/**
 * Parcel Adapter Interface
 *
 * Defines the contract for source adapters that implement the
 * resolve → fetch → extract → normalize pipeline.
 */

import type {
  ParcelSourceKey,
  NormalizedParcel,
  SourceConfig,
} from "../types";
import type { ParcelIngestionObserver } from "../observability/types";

// Re-export for convenience
export type { ParcelIngestionObserver };

// ============================================================================
// Ingestion Context
// ============================================================================

export interface ParcelIngestionContext {
  runId: string;
  jobId?: string;
  sourceId?: string;
  now(): number; // Performance timing (Date.now())
  timestamp(): string; // ISO timestamp
  observer?: ParcelIngestionObserver;
}

// ============================================================================
// Resolve Phase
// ============================================================================

export interface ParcelResolveInput {
  address?: string;
  parcelId?: string;
  ownerName?: string;
}

export interface ParcelResolveResult {
  found: boolean;
  parcelIdRaw?: string;
  detailUrl?: string;
  confidence?: number;
  candidates?: Array<{
    parcelIdRaw: string;
    address?: string;
    matchScore?: number;
  }>;
  debug?: Record<string, unknown>;
}

// ============================================================================
// Fetch Phase
// ============================================================================

export interface ParcelFetchInput {
  detailUrl: string;
  parcelIdRaw?: string;
}

export interface ParcelFetchResult {
  html?: string;
  json?: unknown;
  fetchedAt: string;
  responseStatus?: number;
  bodySha256: string;
  debug?: Record<string, unknown>;
}

// ============================================================================
// Extract Phase
// ============================================================================

export interface ParcelExtractInput {
  html?: string;
  json?: unknown;
  detailUrl: string;
}

export interface ParcelExtractResult {
  raw: unknown; // Source-specific raw extraction (e.g., Partial<PropertyDetails>)
  parserVersion: string;
  domSignature?: string;
  warnings?: string[];
  debug?: Record<string, unknown>;
}

// ============================================================================
// Normalize Phase
// ============================================================================

export interface ParcelNormalizeInput {
  raw: unknown;
  detailUrl?: string;
  fetchedAt: string;
}

export interface ParcelNormalizeResult {
  normalized: NormalizedParcel;
}

// ============================================================================
// Source Adapter Interface
// ============================================================================

export interface ParcelSourceAdapter {
  /** Unique source key */
  key: ParcelSourceKey;
  
  /** Human-readable display name */
  displayName: string;
  
  /** Source configuration */
  config: SourceConfig;

  /**
   * Resolve: Find parcel detail URL from address or parcel ID
   */
  resolve(
    input: ParcelResolveInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelResolveResult>;

  /**
   * Fetch: Retrieve raw content from detail URL
   */
  fetch(
    input: ParcelFetchInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelFetchResult>;

  /**
   * Extract: Parse raw content into source-specific structure
   */
  extract(
    input: ParcelExtractInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelExtractResult>;

  /**
   * Normalize: Convert extracted data to platform-standard NormalizedParcel
   */
  normalize(
    input: ParcelNormalizeInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelNormalizeResult>;
}

// ============================================================================
// Adapter Factory
// ============================================================================

export type ParcelAdapterFactory = () => ParcelSourceAdapter;
