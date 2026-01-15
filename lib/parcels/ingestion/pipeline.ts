/**
 * Parcel Ingestion Pipeline
 * 
 * Orchestrates the full ingestion flow:
 * resolve → fetch → extract → normalize → store
 */

import "server-only";

import { randomUUID } from "crypto";
import type { ParcelIngestionContext } from "../adapters/types";
import type { ParcelIngestionResult, ParcelSourceKey, IngestionStatus } from "../types";
import { getParcelAdapter, resolveSourceKey } from "../registry";
import { createConsoleObserver, type ParcelIngestionObserver } from "../observability";
import {
  createIngestionRun,
  updateIngestionRun,
  createIngestionJob,
  updateIngestionJob,
  findOrCreateSource,
  storeRawFetch,
  storeParseArtifact,
  storeNormalizedParcel,
} from "../storage";

// Import the Manatee PAO adapter to auto-register it
import "../sources/manatee-pao";

// ============================================================================
// Pipeline Configuration
// ============================================================================

export interface IngestParcelRequest {
  sourceKey?: string;
  address?: string;
  parcelId?: string;
  force?: boolean;
  observer?: ParcelIngestionObserver;
}

// ============================================================================
// Context Factory
// ============================================================================

function createIngestionContext(
  runId: string,
  observer?: ParcelIngestionObserver
): ParcelIngestionContext {
  return {
    runId,
    now: () => Date.now(),
    timestamp: () => new Date().toISOString(),
    observer,
  };
}

// ============================================================================
// Main Pipeline Function
// ============================================================================

export async function ingestParcelByAddress(
  request: IngestParcelRequest
): Promise<ParcelIngestionResult> {
  const runId = randomUUID();
  const observer = request.observer || createConsoleObserver();
  const runStart = Date.now();

  // Resolve source key
  const sourceKey = resolveSourceKey(request.sourceKey) as ParcelSourceKey;

  // Input for tracking
  const input = {
    address: request.address,
    parcelId: request.parcelId,
    sourceKey,
  };

  observer.onRunStart({ runId, sourceKey, input });

  let status: IngestionStatus = "FAILED";
  let error: string | undefined;
  let parcelId: string | undefined;
  let parcelKey: ParcelIngestionResult["parcelKey"];

  try {
    // Check if database is available
    const dbAvailable = await isDatabaseAvailable();
    
    // Create run record (if DB available)
    let dbRunId: string | undefined;
    let sourceId: string | undefined;
    let jobId: string | undefined;

    if (dbAvailable) {
      dbRunId = await createIngestionRun({
        triggeredBy: "api",
        purpose: "lead_enrichment",
      });

      // Get adapter and ensure source exists
      const adapter = getParcelAdapter(sourceKey);
      sourceId = await findOrCreateSource({
        sourceKey: adapter.key,
        name: adapter.displayName,
        stateFips: adapter.config.stateFips,
        countyFips: adapter.config.countyFips,
        sourceType: adapter.config.sourceType,
        platformFamily: adapter.config.platformFamily,
        baseUrl: adapter.config.baseUrl,
        capabilities: adapter.config.capabilities as Record<string, boolean>,
        rateLimit: adapter.config.rateLimit as Record<string, number>,
      });

      jobId = await createIngestionJob({
        runId: dbRunId,
        sourceId,
        input,
      });
    }

    // Create context
    const ctx = createIngestionContext(runId, observer);
    if (jobId) ctx.jobId = jobId;
    if (sourceId) ctx.sourceId = sourceId;

    // Get adapter
    const adapter = getParcelAdapter(sourceKey);

    // ========================================================================
    // RESOLVE
    // ========================================================================
    if (dbAvailable && jobId) {
      await updateIngestionJob(jobId, { status: "fetching" });
    }

    const resolveResult = await adapter.resolve(
      { address: request.address, parcelId: request.parcelId },
      ctx
    );

    if (!resolveResult.found || !resolveResult.detailUrl) {
      status = "SKIPPED";
      error = "No parcel found for the given address";
      
      if (dbAvailable && dbRunId) {
        await updateIngestionRun(dbRunId, { status: "skipped", error });
      }

      observer.onRunEnd({
        runId,
        ok: false,
        durationMs: Date.now() - runStart,
        error,
      });

      return { runId, status, error, debug: resolveResult.debug };
    }

    // ========================================================================
    // FETCH
    // ========================================================================
    const fetchResult = await adapter.fetch(
      { detailUrl: resolveResult.detailUrl, parcelIdRaw: resolveResult.parcelIdRaw },
      ctx
    );

    // Store raw fetch (if DB available)
    let fetchId: string | undefined;
    if (dbAvailable && sourceId && dbRunId) {
      fetchId = await storeRawFetch({
        runId: dbRunId,
        jobId,
        sourceId,
        requestUrl: resolveResult.detailUrl,
        responseStatus: fetchResult.responseStatus,
        responseBody: fetchResult.html || JSON.stringify(fetchResult.json),
        bodySha256: fetchResult.bodySha256,
        meta: fetchResult.debug,
      });
    }

    // ========================================================================
    // EXTRACT
    // ========================================================================
    if (dbAvailable && jobId) {
      await updateIngestionJob(jobId, { status: "parsed" });
    }

    const extractResult = await adapter.extract(
      {
        html: fetchResult.html,
        json: fetchResult.json,
        detailUrl: resolveResult.detailUrl,
      },
      ctx
    );

    // Store parse artifact (if DB available)
    if (dbAvailable && sourceId) {
      await storeParseArtifact({
        jobId,
        sourceId,
        fetchId,
        parserVersion: extractResult.parserVersion,
        domSignature: extractResult.domSignature,
        extracted: extractResult.raw as Record<string, unknown>,
        warnings: extractResult.warnings,
      });
    }

    // ========================================================================
    // NORMALIZE
    // ========================================================================
    if (dbAvailable && jobId) {
      await updateIngestionJob(jobId, { status: "normalized" });
    }

    const normalizeResult = await adapter.normalize(
      {
        raw: extractResult.raw,
        detailUrl: resolveResult.detailUrl,
        fetchedAt: fetchResult.fetchedAt,
      },
      ctx
    );

    const normalized = normalizeResult.normalized;

    // ========================================================================
    // STORE
    // ========================================================================
    if (dbAvailable && sourceId && dbRunId) {
      const storeResult = await storeNormalizedParcel({
        normalized,
        runId: dbRunId,
        sourceId,
        fetchId,
      });

      parcelId = storeResult.parcelId;

      // Update job status
      if (jobId) {
        await updateIngestionJob(jobId, { status: "normalized" });
      }

      // Update run with stats
      await updateIngestionRun(dbRunId, {
        status: "succeeded",
        stats: {
          parcelCreated: storeResult.parcelCreated,
          assessmentsUpserted: storeResult.assessmentsUpserted,
          salesUpserted: storeResult.salesUpserted,
          salesSkipped: storeResult.salesSkipped,
        },
      });
    }

    parcelKey = {
      stateFips: normalized.stateFips,
      countyFips: normalized.countyFips,
      parcelIdNorm: normalized.parcelIdNorm,
    };

    status = "SUCCESS";

    observer.onRunEnd({
      runId,
      ok: true,
      durationMs: Date.now() - runStart,
    });

    return {
      runId,
      status,
      parcelId,
      parcelKey,
      normalized,
    };
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    status = "FAILED";

    observer.onRunEnd({
      runId,
      ok: false,
      durationMs: Date.now() - runStart,
      error,
    });

    return { runId, status, error };
  }
}

// ============================================================================
// Database Availability Check
// ============================================================================

async function isDatabaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    return false;
  }

  try {
    // Try to import db - will fail if not properly configured
    const { db } = await import("@/lib/db");
    return !!db;
  } catch {
    return false;
  }
}

// ============================================================================
// Convenience Export
// ============================================================================

export { ingestParcelByAddress as ingestParcel };
