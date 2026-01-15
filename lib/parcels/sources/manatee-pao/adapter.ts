/**
 * Manatee County PAO Adapter
 * 
 * Wraps the existing Playwright-based scraper to implement
 * the ParcelSourceAdapter interface.
 */

import "server-only";

import type {
  ParcelSourceAdapter,
  ParcelIngestionContext,
  ParcelResolveInput,
  ParcelResolveResult,
  ParcelFetchInput,
  ParcelFetchResult,
  ParcelExtractInput,
  ParcelExtractResult,
  ParcelNormalizeInput,
  ParcelNormalizeResult,
} from "../../adapters/types";
import type { PropertyDetails } from "@/lib/realestate/property-types";
import {
  canUsePlaywrightInThisEnv,
  PlaywrightError,
} from "@/lib/realestate/playwright/browser";
import { scrapeManateePaoPropertyByAddressPlaywright } from "@/lib/realestate/pao/manatee-pao.playwright";
import { sha256 } from "../../utils/hash";
import { normalizeManateePaoPropertyDetails } from "./normalize";
import {
  MANATEE_PAO_SOURCE_KEY,
  MANATEE_PAO_CONFIG,
  PARSER_VERSION,
} from "./constants";

// ============================================================================
// Adapter Implementation
// ============================================================================

export class ManateePaoAdapter implements ParcelSourceAdapter {
  key = MANATEE_PAO_SOURCE_KEY;
  displayName = "Manatee County Property Appraiser";
  config = MANATEE_PAO_CONFIG;

  /**
   * Resolve: Find parcel detail URL from address
   * 
   * For Manatee PAO, we use the existing scraper's search functionality.
   * This is a combined resolve+fetch+extract operation under the hood,
   * but we expose it as separate phases for the platform interface.
   */
  async resolve(
    input: ParcelResolveInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelResolveResult> {
    const stepStart = ctx.now();
    ctx.observer?.onStepStart({ runId: ctx.runId, step: "resolve" });

    try {
      // Check Playwright availability
      const playwrightCheck = canUsePlaywrightInThisEnv();
      if (!playwrightCheck.ok) {
        ctx.observer?.onStepEnd({
          runId: ctx.runId,
          step: "resolve",
          ok: false,
          durationMs: ctx.now() - stepStart,
          data: { reason: playwrightCheck.reason },
        });
        return {
          found: false,
          debug: { skipped: true, reason: playwrightCheck.reason },
        };
      }

      if (!input.address) {
        return {
          found: false,
          debug: { error: "No address provided" },
        };
      }

      // Use the existing scraper - it combines resolve+fetch+extract
      // We'll capture the detail URL from the result
      const result = await scrapeManateePaoPropertyByAddressPlaywright(input.address, {
        timeoutMs: 60000,
        navTimeoutMs: 45000,
      });

      const durationMs = ctx.now() - stepStart;

      if (!result.detailUrl) {
        ctx.observer?.onStepEnd({
          runId: ctx.runId,
          step: "resolve",
          ok: false,
          durationMs,
          data: { found: false },
        });
        return {
          found: false,
          debug: result.debug,
        };
      }

      ctx.observer?.onStepEnd({
        runId: ctx.runId,
        step: "resolve",
        ok: true,
        durationMs,
        data: { detailUrl: result.detailUrl },
      });

      // Store the scraped data in context for later phases
      // This is a bit of a hack, but necessary because the scraper
      // does everything in one pass
      (this as ManateePaoAdapterWithCache)._cachedResult = result;

      return {
        found: true,
        parcelIdRaw: result.scraped?.parcelId,
        detailUrl: result.detailUrl,
        confidence: result.scraped ? 0.9 : 0.5,
        debug: result.debug,
      };
    } catch (error) {
      const durationMs = ctx.now() - stepStart;
      ctx.observer?.onStepEnd({
        runId: ctx.runId,
        step: "resolve",
        ok: false,
        durationMs,
        data: { error: error instanceof Error ? error.message : String(error) },
      });

      if (error instanceof PlaywrightError) {
        return {
          found: false,
          debug: {
            error: error.message,
            code: error.code,
          },
        };
      }

      throw error;
    }
  }

  /**
   * Fetch: Retrieve raw HTML content
   * 
   * For Manatee PAO, the scraper already fetched the content during resolve.
   * We simulate the fetch phase by returning a hash of the implied content.
   */
  async fetch(
    input: ParcelFetchInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelFetchResult> {
    const stepStart = ctx.now();
    ctx.observer?.onStepStart({ runId: ctx.runId, step: "fetch" });

    // Use cached result from resolve phase
    const cached = (this as ManateePaoAdapterWithCache)._cachedResult;
    
    // Create a synthetic "fetch result" from the cached scrape
    // In a proper multi-step implementation, we'd actually fetch the page again
    // but for efficiency we reuse the cached data
    const fetchedAt = ctx.timestamp();
    
    // Create a content hash from the scraped data
    // This serves as the "body" for provenance tracking
    const contentJson = JSON.stringify(cached?.scraped || {});
    const bodySha256 = sha256(contentJson);

    const durationMs = ctx.now() - stepStart;
    ctx.observer?.onStepEnd({
      runId: ctx.runId,
      step: "fetch",
      ok: true,
      durationMs,
      data: { bodySha256 },
    });

    return {
      html: undefined, // We don't have raw HTML in cached mode
      json: cached?.scraped,
      fetchedAt,
      responseStatus: 200,
      bodySha256,
      debug: cached?.debug,
    };
  }

  /**
   * Extract: Parse content into source-specific structure
   * 
   * For Manatee PAO, extraction is already done during resolve.
   * We return the cached PropertyDetails.
   */
  async extract(
    input: ParcelExtractInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelExtractResult> {
    const stepStart = ctx.now();
    ctx.observer?.onStepStart({ runId: ctx.runId, step: "extract" });

    const cached = (this as ManateePaoAdapterWithCache)._cachedResult;
    const raw = cached?.scraped || input.json || {};

    // Compute DOM signature from key fields for change detection
    const domSignatureFields = [
      (raw as Partial<PropertyDetails>).parcelId,
      (raw as Partial<PropertyDetails>).address,
      (raw as Partial<PropertyDetails>).owner,
    ].filter(Boolean);
    const domSignature = sha256(domSignatureFields.join("|"));

    const durationMs = ctx.now() - stepStart;
    ctx.observer?.onStepEnd({
      runId: ctx.runId,
      step: "extract",
      ok: true,
      durationMs,
      data: { fieldCount: Object.keys(raw).length },
    });

    return {
      raw,
      parserVersion: PARSER_VERSION,
      domSignature,
      debug: cached?.debug,
    };
  }

  /**
   * Normalize: Convert to platform-standard NormalizedParcel
   */
  async normalize(
    input: ParcelNormalizeInput,
    ctx: ParcelIngestionContext
  ): Promise<ParcelNormalizeResult> {
    const stepStart = ctx.now();
    ctx.observer?.onStepStart({ runId: ctx.runId, step: "normalize" });

    const raw = input.raw as Partial<PropertyDetails>;

    const normalized = normalizeManateePaoPropertyDetails(raw, {
      sourceUrl: input.detailUrl,
      timestamp: input.fetchedAt,
      method: "playwright",
    });

    const durationMs = ctx.now() - stepStart;
    ctx.observer?.onStepEnd({
      runId: ctx.runId,
      step: "normalize",
      ok: true,
      durationMs,
      data: { confidence: normalized.confidence },
    });

    // Clear cached result
    (this as ManateePaoAdapterWithCache)._cachedResult = undefined;

    return { normalized };
  }
}

// Type extension for cached result
interface ManateePaoAdapterWithCache extends ManateePaoAdapter {
  _cachedResult?: {
    detailUrl: string | null;
    scraped?: Partial<PropertyDetails>;
    debug?: Record<string, unknown>;
  };
}

// ============================================================================
// Factory Function
// ============================================================================

export function createManateePaoAdapter(): ParcelSourceAdapter {
  return new ManateePaoAdapter();
}
