import "server-only";

import { canUsePlaywrightInThisEnv, PlaywrightError } from "@/lib/realestate/playwright/browser";
import {
  scrapeStellarRealistByAddressPlaywright,
  type StellarRealistData,
} from "@/lib/realestate/stellar/realist.playwright";
import { PARSER_VERSION, STELLAR_REALIST_SOURCE_KEY } from "@/lib/realestate/stellar/constants";
import {
  createIngestionJob,
  createIngestionRun,
  findOrCreateSource,
  storeParseArtifact,
  storeRawFetch,
  updateIngestionJob,
  updateIngestionRun,
} from "@/lib/parcels/storage";
import { sha256 } from "@/lib/parcels/utils/hash";

export type EnrichmentStatus = "SUCCESS" | "SKIPPED" | "FAILED";

export interface StellarRealistEnrichmentResult {
  status: EnrichmentStatus;
  data?: StellarRealistData;
  error?: string;
  debug?: Record<string, unknown>;
}

export interface StellarRealistEnrichmentWithProvenance extends StellarRealistEnrichmentResult {
  provenance: {
    source: "stellarmls_realist";
    method: "playwright";
    confidence: number;
    sourceUrl?: string;
    timestamp: string;
    sessionReused: boolean;
  };
}

function isParcelIngestionEnabled(): boolean {
  return process.env.PARCEL_INGESTION_ENABLED === "true" && !!process.env.DATABASE_URL;
}

function calculateConfidence(data?: StellarRealistData): number {
  if (!data) return 0;
  let confidence = 0;
  if (data.matchedAddress) confidence += 0.2;
  if (data.sellScore?.score || data.sellScore?.indicator) confidence += 0.2;
  if (data.realAvm?.value) confidence += 0.3;
  if (data.rentalTrends?.currentRent) confidence += 0.1;
  if (data.listings && data.listings.length > 0) confidence += 0.2;
  return Math.min(confidence, 1);
}

async function persistToDatabase(params: {
  address: string;
  data?: StellarRealistData;
  detailUrl?: string;
  debug?: Record<string, unknown>;
  raw?: {
    apiResponses?: Array<{ url: string; status: number; body: unknown }>;
    htmlSnapshots?: Record<string, string>;
  };
}): Promise<void> {
  if (!isParcelIngestionEnabled()) {
    return;
  }

  const runId = await createIngestionRun({
    triggeredBy: "workflow",
    purpose: "lead_enrichment",
  });

  const sourceId = await findOrCreateSource({
    sourceKey: STELLAR_REALIST_SOURCE_KEY,
    name: "StellarMLS (Realist)",
    stateFips: "12",
    sourceType: "mls",
    platformFamily: "playwright",
    baseUrl: "https://prd.realist.com",
    capabilities: {
      addressSearch: true,
      avm: true,
      rentals: true,
      listings: true,
    },
    rateLimit: { rps: 0.2, burst: 1 },
  });

  const jobId = await createIngestionJob({
    runId,
    sourceId,
    input: { address: params.address },
  });

  await updateIngestionJob(jobId, { status: "fetching" });

  let fetchId: string | undefined;

  if (params.raw?.apiResponses?.length) {
    for (const response of params.raw.apiResponses) {
      fetchId = await storeRawFetch({
        runId,
        jobId,
        sourceId,
        requestUrl: response.url,
        responseStatus: response.status,
        responseBody: JSON.stringify(response.body),
        meta: { kind: "api" },
      });
    }
  }

  if (params.raw?.htmlSnapshots?.main) {
    fetchId = await storeRawFetch({
      runId,
      jobId,
      sourceId,
      requestUrl: params.detailUrl || "https://prd.realist.com",
      responseStatus: 200,
      responseBody: params.raw.htmlSnapshots.main,
      meta: { kind: "html" },
    });
  }

  await updateIngestionJob(jobId, { status: "parsed" });

  const extracted = params.data ? (params.data as Record<string, unknown>) : {};
  const domSignature = sha256(JSON.stringify(extracted));

  await storeParseArtifact({
    jobId,
    sourceId,
    fetchId,
    parserVersion: PARSER_VERSION,
    domSignature,
    extracted,
    warnings: [],
  });

  await updateIngestionJob(jobId, { status: "normalized" });

  await updateIngestionRun(runId, {
    status: "succeeded",
    stats: { stored: true },
  });
}

export async function enrichStellarRealistByAddress(params: {
  address?: string;
  timeoutMs?: number;
  navTimeoutMs?: number;
}): Promise<StellarRealistEnrichmentWithProvenance> {
  const timestamp = new Date().toISOString();

  const makeResult = (
    status: EnrichmentStatus,
    error?: string,
    data?: StellarRealistData,
    debug?: Record<string, unknown>,
    sessionReused: boolean = false,
    sourceUrl?: string
  ): StellarRealistEnrichmentWithProvenance => ({
    status,
    error,
    data,
    debug,
    provenance: {
      source: "stellarmls_realist",
      method: "playwright",
      timestamp,
      confidence: calculateConfidence(data),
      sourceUrl,
      sessionReused,
    },
  });

  if (!params.address || !params.address.trim()) {
    return makeResult("SKIPPED", "No address provided");
  }

  const playwrightCheck = canUsePlaywrightInThisEnv();
  if (!playwrightCheck.ok) {
    return makeResult("SKIPPED", playwrightCheck.reason);
  }

  const address = params.address.trim();

  try {
    const result = await scrapeStellarRealistByAddressPlaywright(address, {
      timeoutMs: params.timeoutMs,
      navTimeoutMs: params.navTimeoutMs,
    });

    const enrichment = makeResult(
      result.data ? "SUCCESS" : "FAILED",
      result.data ? undefined : "No data extracted",
      result.data,
      result.debug,
      result.session.reused,
      result.detailUrl
    );

    await persistToDatabase({
      address,
      data: result.data,
      detailUrl: result.detailUrl,
      debug: result.debug,
      raw: result.raw,
    }).catch((error) => {
      enrichment.debug = {
        ...enrichment.debug,
        persistenceError: error instanceof Error ? error.message : String(error),
      };
    });

    return enrichment;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    if (error instanceof PlaywrightError && error.code === "CONFIG_MISSING") {
      return makeResult("SKIPPED", err.message);
    }

    return makeResult("FAILED", err.message);
  }
}
