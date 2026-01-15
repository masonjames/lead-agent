/**
 * Parcel Repository
 * 
 * Handles persistence of parcels, assessments, and sales
 * with proper upsert logic and provenance tracking.
 */

import "server-only";

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  parcels,
  parcelAssessments,
  parcelSales,
  sources,
  rawFetches,
  parseArtifacts,
  ingestionRuns,
  ingestionJobs,
  type NewParcel,
  type NewParcelAssessment,
  type NewParcelSale,
  type NewRawFetch,
  type NewParseArtifact,
  type NewIngestionRun,
  type NewIngestionJob,
} from "@/lib/db/schema";
import type { NormalizedParcel, NormalizedAssessment, NormalizedSale } from "../types";

// ============================================================================
// Ingestion Run Management
// ============================================================================

export async function createIngestionRun(params: {
  triggeredBy: string;
  purpose?: string;
}): Promise<string> {
  const [run] = await db
    .insert(ingestionRuns)
    .values({
      triggeredBy: params.triggeredBy,
      purpose: params.purpose,
      status: "running",
    })
    .returning({ id: ingestionRuns.id });

  return run.id;
}

export async function updateIngestionRun(
  runId: string,
  params: {
    status?: string;
    stats?: Record<string, unknown>;
    error?: string;
  }
): Promise<void> {
  await db
    .update(ingestionRuns)
    .set({
      ...(params.status && { status: params.status }),
      ...(params.stats && { stats: params.stats }),
      ...(params.error && { error: params.error }),
      finishedAt: new Date(),
    })
    .where(eq(ingestionRuns.id, runId));
}

// ============================================================================
// Ingestion Job Management
// ============================================================================

export async function createIngestionJob(params: {
  runId: string;
  sourceId?: string;
  input: Record<string, unknown>;
}): Promise<string> {
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      runId: params.runId,
      sourceId: params.sourceId,
      input: params.input,
      status: "queued",
    })
    .returning({ id: ingestionJobs.id });

  return job.id;
}

export async function updateIngestionJob(
  jobId: string,
  params: {
    status?: string;
    lastError?: string;
    attempts?: number;
  }
): Promise<void> {
  await db
    .update(ingestionJobs)
    .set({
      ...(params.status && { status: params.status }),
      ...(params.lastError && { lastError: params.lastError }),
      ...(params.attempts !== undefined && { attempts: params.attempts }),
      updatedAt: new Date(),
    })
    .where(eq(ingestionJobs.id, jobId));
}

// ============================================================================
// Source Management
// ============================================================================

export async function findOrCreateSource(params: {
  sourceKey: string;
  name: string;
  stateFips: string;
  countyFips?: string;
  sourceType: string;
  platformFamily: string;
  baseUrl: string;
  capabilities?: Record<string, boolean>;
  rateLimit?: Record<string, number>;
}): Promise<string> {
  // Try to find existing source
  const existing = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.sourceKey, params.sourceKey))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Create new source
  const [source] = await db
    .insert(sources)
    .values({
      sourceKey: params.sourceKey,
      name: params.name,
      stateFips: params.stateFips,
      countyFips: params.countyFips,
      sourceType: params.sourceType,
      platformFamily: params.platformFamily,
      baseUrl: params.baseUrl,
      capabilities: params.capabilities || {},
      rateLimit: params.rateLimit || {},
    })
    .returning({ id: sources.id });

  return source.id;
}

// ============================================================================
// Raw Fetch Storage
// ============================================================================

export async function storeRawFetch(params: {
  runId: string;
  jobId?: string;
  sourceId: string;
  requestUrl: string;
  requestMethod?: string;
  responseStatus?: number;
  responseBody?: string;
  bodySha256?: string;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const [fetch] = await db
    .insert(rawFetches)
    .values({
      runId: params.runId,
      jobId: params.jobId,
      sourceId: params.sourceId,
      requestUrl: params.requestUrl,
      requestMethod: params.requestMethod || "GET",
      responseStatus: params.responseStatus,
      responseBody: params.responseBody,
      bodySha256: params.bodySha256,
      meta: params.meta || {},
    })
    .returning({ id: rawFetches.id });

  return fetch.id;
}

// ============================================================================
// Parse Artifact Storage
// ============================================================================

export async function storeParseArtifact(params: {
  jobId?: string;
  sourceId: string;
  fetchId?: string;
  parserVersion: string;
  domSignature?: string;
  extracted: Record<string, unknown>;
  warnings?: string[];
}): Promise<string> {
  const [artifact] = await db
    .insert(parseArtifacts)
    .values({
      jobId: params.jobId,
      sourceId: params.sourceId,
      fetchId: params.fetchId,
      parserVersion: params.parserVersion,
      domSignature: params.domSignature,
      extracted: params.extracted,
      warnings: params.warnings || [],
    })
    .returning({ id: parseArtifacts.id });

  return artifact.id;
}

// ============================================================================
// Parcel Upsert
// ============================================================================

export async function upsertParcel(params: {
  normalized: NormalizedParcel;
  sourceId: string;
  fetchId?: string;
}): Promise<{ parcelId: string; created: boolean }> {
  const { normalized, sourceId, fetchId } = params;

  // Check for existing parcel
  const existing = await db
    .select({ id: parcels.id })
    .from(parcels)
    .where(
      and(
        eq(parcels.stateFips, normalized.stateFips),
        eq(parcels.countyFips, normalized.countyFips),
        eq(parcels.parcelIdNorm, normalized.parcelIdNorm)
      )
    )
    .limit(1);

  const parcelData: NewParcel = {
    stateFips: normalized.stateFips,
    countyFips: normalized.countyFips,
    parcelIdRaw: normalized.parcelIdRaw,
    parcelIdNorm: normalized.parcelIdNorm,
    alternateIds: normalized.alternateIds || [],
    situsAddressRaw: normalized.situsAddress.raw,
    situsAddressNorm: {
      line1: normalized.situsAddress.line1,
      city: normalized.situsAddress.city,
      state: normalized.situsAddress.state,
      zip: normalized.situsAddress.zipCode,
    },
    lat: normalized.coordinates?.lat?.toString(),
    lon: normalized.coordinates?.lon?.toString(),
    ownerName: normalized.ownerName,
    land: normalized.land || {},
    improvements: normalized.improvements || {},
    canonicalSourceId: sourceId,
    canonicalFetchId: fetchId,
    lastSeenAt: new Date(),
  };

  if (existing.length > 0) {
    // Update existing parcel
    await db
      .update(parcels)
      .set({
        ...parcelData,
        updatedAt: new Date(),
      })
      .where(eq(parcels.id, existing[0].id));

    return { parcelId: existing[0].id, created: false };
  }

  // Insert new parcel
  const [newParcel] = await db
    .insert(parcels)
    .values(parcelData)
    .returning({ id: parcels.id });

  return { parcelId: newParcel.id, created: true };
}

// ============================================================================
// Assessment Upsert
// ============================================================================

export async function upsertAssessments(params: {
  parcelId: string;
  assessments: NormalizedAssessment[];
  sourceId: string;
  fetchId?: string;
}): Promise<{ upserted: number }> {
  const { parcelId, assessments, sourceId, fetchId } = params;

  let upserted = 0;

  for (const assessment of assessments) {
    // Check for existing assessment
    const existing = await db
      .select({ id: parcelAssessments.id })
      .from(parcelAssessments)
      .where(
        and(
          eq(parcelAssessments.parcelId, parcelId),
          eq(parcelAssessments.taxYear, assessment.taxYear)
        )
      )
      .limit(1);

    const assessmentData: NewParcelAssessment = {
      parcelId,
      taxYear: assessment.taxYear,
      justValue: assessment.justValue?.toString(),
      assessedValue: assessment.assessedValue?.toString(),
      taxableValue: assessment.taxableValue?.toString(),
      landValue: assessment.landValue?.toString(),
      improvementValue: assessment.improvementValue?.toString(),
      exemptions: assessment.exemptions || [],
      extra: {
        adValoremTaxes: assessment.adValoremTaxes,
        nonAdValoremTaxes: assessment.nonAdValoremTaxes,
      },
      sourceId,
      fetchId,
    };

    if (existing.length > 0) {
      // Update
      await db
        .update(parcelAssessments)
        .set({
          ...assessmentData,
          updatedAt: new Date(),
        })
        .where(eq(parcelAssessments.id, existing[0].id));
    } else {
      // Insert
      await db.insert(parcelAssessments).values(assessmentData);
    }

    upserted++;
  }

  return { upserted };
}

// ============================================================================
// Sales Upsert (with dedupe)
// ============================================================================

export async function upsertSales(params: {
  parcelId: string;
  sales: NormalizedSale[];
  sourceId: string;
  fetchId?: string;
}): Promise<{ upserted: number; skipped: number }> {
  const { parcelId, sales, sourceId, fetchId } = params;

  let upserted = 0;
  let skipped = 0;

  for (const sale of sales) {
    // Check for existing sale using dedupe key
    const existing = await db
      .select({ id: parcelSales.id })
      .from(parcelSales)
      .where(
        and(
          eq(parcelSales.parcelId, parcelId),
          eq(parcelSales.saleKeySha256, sale.saleKeySha256)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Skip duplicate
      skipped++;
      continue;
    }

    // Insert new sale
    const saleData: NewParcelSale = {
      parcelId,
      saleDate: sale.saleDate,
      salePrice: sale.salePrice?.toString(),
      qualified: sale.qualified,
      instrument: sale.instrument,
      bookPage: sale.bookPage,
      deedType: sale.deedType,
      grantor: sale.grantor,
      grantee: sale.grantee,
      saleKeySha256: sale.saleKeySha256,
      extra: {},
      sourceId,
      fetchId,
    };

    await db.insert(parcelSales).values(saleData);
    upserted++;
  }

  return { upserted, skipped };
}

// ============================================================================
// Full Parcel Storage (Orchestrates All Upserts)
// ============================================================================

export interface StoreNormalizedResult {
  parcelId: string;
  parcelCreated: boolean;
  assessmentsUpserted: number;
  salesUpserted: number;
  salesSkipped: number;
}

export async function storeNormalizedParcel(params: {
  normalized: NormalizedParcel;
  runId: string;
  sourceId: string;
  fetchId?: string;
}): Promise<StoreNormalizedResult> {
  const { normalized, sourceId, fetchId } = params;

  // 1. Upsert parcel
  const { parcelId, created: parcelCreated } = await upsertParcel({
    normalized,
    sourceId,
    fetchId,
  });

  // 2. Upsert assessments
  const { upserted: assessmentsUpserted } = await upsertAssessments({
    parcelId,
    assessments: normalized.assessments || [],
    sourceId,
    fetchId,
  });

  // 3. Upsert sales
  const { upserted: salesUpserted, skipped: salesSkipped } = await upsertSales({
    parcelId,
    sales: normalized.sales || [],
    sourceId,
    fetchId,
  });

  return {
    parcelId,
    parcelCreated,
    assessmentsUpserted,
    salesUpserted,
    salesSkipped,
  };
}

// ============================================================================
// Query Functions
// ============================================================================

export async function findParcelByKey(params: {
  stateFips: string;
  countyFips: string;
  parcelIdNorm: string;
}) {
  const result = await db
    .select()
    .from(parcels)
    .where(
      and(
        eq(parcels.stateFips, params.stateFips),
        eq(parcels.countyFips, params.countyFips),
        eq(parcels.parcelIdNorm, params.parcelIdNorm)
      )
    )
    .limit(1);

  return result[0] || null;
}

export async function findParcelById(id: string) {
  const result = await db
    .select()
    .from(parcels)
    .where(eq(parcels.id, id))
    .limit(1);

  return result[0] || null;
}

export async function getParcelAssessments(parcelId: string) {
  return db
    .select()
    .from(parcelAssessments)
    .where(eq(parcelAssessments.parcelId, parcelId))
    .orderBy(parcelAssessments.taxYear);
}

export async function getParcelSales(parcelId: string) {
  return db
    .select()
    .from(parcelSales)
    .where(eq(parcelSales.parcelId, parcelId))
    .orderBy(parcelSales.saleDate);
}

export async function getIngestionRun(runId: string) {
  const result = await db
    .select()
    .from(ingestionRuns)
    .where(eq(ingestionRuns.id, runId))
    .limit(1);

  return result[0] || null;
}
