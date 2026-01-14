/**
 * PAO Enrichment Service
 * 
 * Wrapper around the Manatee County PAO scraper that provides
 * a clean enrichment API with proper error handling for workflows.
 */

import { canUsePlaywrightInThisEnv, PlaywrightError } from "@/lib/realestate/playwright/browser";
import { scrapeManateePaoPropertyByAddressPlaywright } from "@/lib/realestate/pao/manatee-pao.playwright";
import type { PropertyDetails } from "@/lib/realestate/property-types";

export type EnrichmentStatus = "SUCCESS" | "SKIPPED" | "FAILED";

export interface PaoEnrichmentResult {
  status: EnrichmentStatus;
  property?: Partial<PropertyDetails>;
  error?: string;
  debug?: Record<string, unknown>;
}

/**
 * Enrichment result with provenance tracking
 */
export interface PaoEnrichmentWithProvenance extends PaoEnrichmentResult {
  provenance: {
    source: "manatee_pao";
    method: "playwright";
    confidence: number;
    sourceUrl?: string;
    timestamp: string;
  };
}

/**
 * Enrich a lead with property data from Manatee County PAO
 * 
 * This function is designed to be workflow-safe:
 * - Returns SKIPPED if Playwright is not configured (doesn't fail workflow)
 * - Returns FAILED for actual errors but doesn't throw
 * - Only throws for blocking errors that should halt the workflow
 * 
 * @param params - Enrichment parameters
 * @returns Enrichment result with status, data, and provenance
 */
export async function enrichPaoByAddress(params: {
  address?: string;
  timeoutMs?: number;
  navTimeoutMs?: number;
}): Promise<PaoEnrichmentWithProvenance> {
  const timestamp = new Date().toISOString();
  const baseProvenance = {
    source: "manatee_pao" as const,
    method: "playwright" as const,
    timestamp,
  };

  // Check if address is provided
  if (!params.address || !params.address.trim()) {
    return {
      status: "SKIPPED",
      error: "No address provided for PAO enrichment",
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }

  // Check if Playwright is configured for this environment
  const playwrightCheck = canUsePlaywrightInThisEnv();
  if (!playwrightCheck.ok) {
    console.log(`[PAO Enrichment] Skipping: ${playwrightCheck.reason}`);
    return {
      status: "SKIPPED",
      error: playwrightCheck.reason,
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }

  const address = params.address.trim();
  console.log(`[PAO Enrichment] Starting enrichment for: "${address}"`);

  try {
    const result = await scrapeManateePaoPropertyByAddressPlaywright(address, {
      timeoutMs: params.timeoutMs || 60000,
      navTimeoutMs: params.navTimeoutMs || 45000,
    });

    // No property found
    if (!result.detailUrl || !result.scraped || Object.keys(result.scraped).length === 0) {
      console.log(`[PAO Enrichment] No property found for address: "${address}"`);
      return {
        status: "FAILED",
        error: `No property found in Manatee County PAO for address: "${address}"`,
        debug: result.debug,
        provenance: {
          ...baseProvenance,
          confidence: 0,
        },
      };
    }

    // Calculate confidence based on data quality
    const confidence = calculateConfidence(result.scraped);

    console.log(`[PAO Enrichment] Success! Found property with ${confidence * 100}% confidence`);
    
    return {
      status: "SUCCESS",
      property: result.scraped,
      debug: result.debug,
      provenance: {
        ...baseProvenance,
        confidence,
        sourceUrl: result.detailUrl,
      },
    };
  } catch (error) {
    // Handle Playwright-specific errors
    if (error instanceof PlaywrightError) {
      const errorResult: PaoEnrichmentWithProvenance = {
        status: "FAILED",
        error: `PAO scraping error (${error.code}): ${error.message}`,
        debug: { errorCode: error.code },
        provenance: {
          ...baseProvenance,
          confidence: 0,
        },
      };

      // For blocking errors, we might want to flag for manual review
      if (error.code === "BLOCKED") {
        errorResult.error = "PAO site detected automated access - manual review recommended";
      }

      // For browser launch failures in development, mark as skipped
      if (error.code === "BROWSER_LAUNCH_FAILED") {
        const isProduction = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
        if (!isProduction) {
          return {
            status: "SKIPPED",
            error: "Playwright browser not available in development (no PLAYWRIGHT_WS_ENDPOINT)",
            provenance: {
              ...baseProvenance,
              confidence: 0,
            },
          };
        }
      }

      return errorResult;
    }

    // Generic error handling
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PAO Enrichment] Error: ${errorMessage}`);

    return {
      status: "FAILED",
      error: `PAO enrichment failed: ${errorMessage}`,
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }
}

/**
 * Calculate confidence score based on data quality
 * 
 * Factors:
 * - Owner name present: +0.2
 * - Address matches: +0.2
 * - Valuations present: +0.2
 * - Sales history: +0.15
 * - Building details: +0.15
 * - Extra features/inspections: +0.1
 */
function calculateConfidence(property: Partial<PropertyDetails>): number {
  let confidence = 0;

  // Owner name
  if (property.owner && property.owner.length > 2) {
    confidence += 0.2;
  }

  // Address present
  if (property.address && property.address.length > 5) {
    confidence += 0.2;
  }

  // Valuations
  if (property.valuations && property.valuations.length > 0) {
    confidence += 0.2;
  }

  // Sales history
  if (property.salesHistory && property.salesHistory.length > 0) {
    confidence += 0.15;
  }

  // Building details (bedrooms, bathrooms, sqft)
  if (property.building?.bedrooms || property.building?.bathrooms || property.building?.livingAreaSqFt) {
    confidence += 0.15;
  }

  // Extra features or inspections
  if (property.extras?.paoExtraFeatures?.length || property.extras?.inspections?.length) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1);
}

/**
 * Extract key property facts for lead report summary
 */
export function extractPropertySummary(property: Partial<PropertyDetails>): {
  owner?: string;
  address?: string;
  propertyType?: string;
  yearBuilt?: number;
  bedsBaths?: string;
  sqft?: number;
  assessedValue?: number;
  marketValue?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  homesteadExemption?: boolean;
} {
  const summary: ReturnType<typeof extractPropertySummary> = {};

  if (property.owner) summary.owner = property.owner;
  if (property.address) summary.address = property.address;
  if (property.propertyType) summary.propertyType = property.propertyType;
  
  // Building info
  const building = property.building;
  if (building?.yearBuilt) summary.yearBuilt = building.yearBuilt;
  if (building?.bedrooms !== undefined || building?.bathrooms !== undefined) {
    const beds = building.bedrooms ?? 0;
    const baths = building.bathrooms ?? 0;
    summary.bedsBaths = `${beds} bed / ${baths} bath`;
  }
  if (building?.livingAreaSqFt) summary.sqft = building.livingAreaSqFt;

  // Valuation info - get latest year
  if (property.valuations && property.valuations.length > 0) {
    const latest = property.valuations.reduce((a, b) => 
      (b.year || 0) > (a.year || 0) ? b : a
    );
    if (latest.assessed?.total) summary.assessedValue = latest.assessed.total;
    if (latest.just?.total) summary.marketValue = latest.just.total;
  }

  // Sales history - get most recent
  if (property.salesHistory && property.salesHistory.length > 0) {
    const recent = property.salesHistory.find(s => s.price && s.price > 0);
    if (recent) {
      summary.lastSaleDate = recent.date;
      summary.lastSalePrice = recent.price;
    }
  }

  // Homestead
  if (property.basicInfo?.homesteadExemption !== undefined) {
    summary.homesteadExemption = property.basicInfo.homesteadExemption;
  }

  return summary;
}
