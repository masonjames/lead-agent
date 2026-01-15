/**
 * PAO Enrichment Service
 *
 * Multi-county PAO enrichment that routes to the correct
 * Property Appraiser based on address/ZIP code.
 *
 * Supported Counties:
 * - Manatee County (manateepao.gov)
 * - Sarasota County (sc-pa.com)
 */

import { canUsePlaywrightInThisEnv, PlaywrightError } from "@/lib/realestate/playwright/browser";
import { scrapeManateePaoPropertyByAddressPlaywright } from "@/lib/realestate/pao/manatee-pao.playwright";
import { scrapeSarasotaPaoPropertyByAddressPlaywright } from "@/lib/realestate/pao/sarasota-pao.playwright";
import type { PropertyDetails } from "@/lib/realestate/property-types";

export type EnrichmentStatus = "SUCCESS" | "SKIPPED" | "FAILED";

export interface PaoEnrichmentResult {
  status: EnrichmentStatus;
  property?: Partial<PropertyDetails>;
  error?: string;
  debug?: Record<string, unknown>;
}

export type PaoSource = "manatee_pao" | "sarasota_pao";

/**
 * Enrichment result with provenance tracking
 */
export interface PaoEnrichmentWithProvenance extends PaoEnrichmentResult {
  provenance: {
    source: PaoSource;
    method: "playwright";
    confidence: number;
    sourceUrl?: string;
    timestamp: string;
  };
}

// ============================================================================
// County Detection from Address/ZIP
// ============================================================================

/**
 * ZIP codes by county for routing
 * Source: US Census Bureau / USPS
 */
const MANATEE_COUNTY_ZIPS = new Set([
  // Bradenton area
  "34201", "34202", "34203", "34204", "34205", "34206", "34207", "34208", "34209", "34210", "34211", "34212",
  // Beach communities
  "34215", "34216", "34217", "34218",
  // Palmetto/Ellenton
  "34220", "34221", "34222",
  // Parrish
  "34219",
  // Rural
  "34250", "34251", "34270",
  // Longboat Key (split with Sarasota - Manatee side)
  "34228",
]);

const SARASOTA_COUNTY_ZIPS = new Set([
  // Sarasota City
  "34230", "34231", "34232", "34233", "34234", "34235", "34236", "34237", "34238", "34239",
  "34240", "34241", "34242", "34243",
  // Venice
  "34275", "34284", "34285", "34286", "34287", "34288", "34289", "34292", "34293",
  // North Port
  "34286", "34287", "34288", "34289",
  // Englewood (split with Charlotte)
  "34223", "34224",
  // Osprey/Nokomis
  "34229", "34274", "34275",
  // Longboat Key (split with Manatee - Sarasota side)
  "34228",
]);

/**
 * Known cities/areas by county
 */
const MANATEE_CITIES = [
  "bradenton", "palmetto", "ellenton", "parrish", "lakewood ranch",
  "anna maria", "holmes beach", "bradenton beach", "cortez",
  "myakka city", "terra ceia", "tallevast",
];

const SARASOTA_CITIES = [
  "sarasota", "venice", "north port", "englewood", "osprey", "nokomis",
  "siesta key", "bird key", "lido key", "bee ridge", "gulf gate",
];

/**
 * Extract ZIP code from address string
 */
function extractZipCode(address: string): string | null {
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return zipMatch ? zipMatch[1] : null;
}

/**
 * Detect county from address
 * Returns null if county cannot be determined (will try both)
 */
function detectCountyFromAddress(address: string): PaoSource | null {
  const lowerAddress = address.toLowerCase();
  const zipCode = extractZipCode(address);

  // First, check ZIP code (most reliable)
  if (zipCode) {
    if (MANATEE_COUNTY_ZIPS.has(zipCode) && !SARASOTA_COUNTY_ZIPS.has(zipCode)) {
      return "manatee_pao";
    }
    if (SARASOTA_COUNTY_ZIPS.has(zipCode) && !MANATEE_COUNTY_ZIPS.has(zipCode)) {
      return "sarasota_pao";
    }
    // Some ZIPs are shared (like Longboat Key 34228) - continue to city check
  }

  // Second, check for city names
  for (const city of SARASOTA_CITIES) {
    if (lowerAddress.includes(city)) {
      return "sarasota_pao";
    }
  }

  for (const city of MANATEE_CITIES) {
    if (lowerAddress.includes(city)) {
      return "manatee_pao";
    }
  }

  // Could not determine county
  return null;
}

// ============================================================================
// PAO Scraper Functions
// ============================================================================

interface ScrapeResult {
  detailUrl: string | null;
  scraped: Partial<PropertyDetails>;
  debug: Record<string, unknown>;
}

type ScrapeFunction = (
  address: string,
  options: { timeoutMs: number; navTimeoutMs: number }
) => Promise<ScrapeResult>;

const SCRAPERS: Record<PaoSource, { name: string; scrape: ScrapeFunction }> = {
  manatee_pao: {
    name: "Manatee County PAO",
    scrape: scrapeManateePaoPropertyByAddressPlaywright,
  },
  sarasota_pao: {
    name: "Sarasota County PAO",
    scrape: scrapeSarasotaPaoPropertyByAddressPlaywright,
  },
};

// ============================================================================
// Main Enrichment Function
// ============================================================================

/**
 * Enrich a lead with property data from the appropriate county PAO
 *
 * This function is designed to be workflow-safe:
 * - Returns SKIPPED if Playwright is not configured (doesn't fail workflow)
 * - Returns FAILED for actual errors but doesn't throw
 * - Automatically routes to the correct county PAO based on address
 *
 * @param params - Enrichment parameters
 * @returns Enrichment result with status, data, and provenance
 */
export async function enrichPaoByAddress(params: {
  address?: string;
  timeoutMs?: number;
  navTimeoutMs?: number;
  forceSource?: PaoSource; // Override automatic detection
}): Promise<PaoEnrichmentWithProvenance> {
  const timestamp = new Date().toISOString();

  // Helper to create failed/skipped result
  const makeResult = (
    status: EnrichmentStatus,
    source: PaoSource,
    error?: string,
    debug?: Record<string, unknown>
  ): PaoEnrichmentWithProvenance => ({
    status,
    error,
    debug,
    provenance: {
      source,
      method: "playwright",
      timestamp,
      confidence: 0,
    },
  });

  // Check if address is provided
  if (!params.address || !params.address.trim()) {
    return makeResult("SKIPPED", "manatee_pao", "No address provided for PAO enrichment");
  }

  // Check if Playwright is configured for this environment
  const playwrightCheck = canUsePlaywrightInThisEnv();
  if (!playwrightCheck.ok) {
    console.log(`[PAO Enrichment] Skipping: ${playwrightCheck.reason}`);
    return makeResult("SKIPPED", "manatee_pao", playwrightCheck.reason);
  }

  const address = params.address.trim();

  // Detect county from address
  let detectedSource = params.forceSource || detectCountyFromAddress(address);
  const sourcesToTry: PaoSource[] = detectedSource
    ? [detectedSource]
    : ["manatee_pao", "sarasota_pao"]; // Try both if unknown

  console.log(
    `[PAO Enrichment] Starting enrichment for: "${address}" (detected: ${detectedSource || "unknown, trying both"})`
  );

  let lastDebug: Record<string, unknown> | undefined;

  // Try each source until we find a match
  for (const source of sourcesToTry) {
    const scraper = SCRAPERS[source];
    console.log(`[PAO Enrichment] Trying ${scraper.name}...`);

    try {
      const result = await scraper.scrape(address, {
        timeoutMs: params.timeoutMs || 60000,
        navTimeoutMs: params.navTimeoutMs || 45000,
      });

      // Check if property was found
      if (result.detailUrl && result.scraped && Object.keys(result.scraped).length > 0) {
        const confidence = calculateConfidence(result.scraped);

        console.log(
          `[PAO Enrichment] Success! Found property in ${scraper.name} with ${Math.round(confidence * 100)}% confidence`
        );

        return {
          status: "SUCCESS",
          property: result.scraped,
          debug: { ...result.debug, source },
          provenance: {
            source,
            method: "playwright",
            confidence,
            sourceUrl: result.detailUrl,
            timestamp,
          },
        };
      }

      console.log(`[PAO Enrichment] No property found in ${scraper.name}`);
      if (result.debug) {
        lastDebug = { ...result.debug, source };
      } else {
        lastDebug = { source };
      }
    } catch (error) {
      // Log error but continue to next source
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`[PAO Enrichment] ${scraper.name} error: ${errorMsg}`);

      // For blocking errors, return immediately
      if (error instanceof PlaywrightError && error.code === "BLOCKED") {
        return {
          status: "FAILED",
          error: `${scraper.name} site detected automated access - manual review recommended`,
          debug: { errorCode: error.code, source },
          provenance: {
            source,
            method: "playwright",
            timestamp,
            confidence: 0,
          },
        };
      }

      // Configuration errors should be treated as workflow-safe skips
      if (error instanceof PlaywrightError && error.code === "CONFIG_MISSING") {
        return makeResult("SKIPPED", source, error.message, { errorCode: error.code, source });
      }

      // For browser launch failures in development, skip
      if (error instanceof PlaywrightError && error.code === "BROWSER_LAUNCH_FAILED") {
        const isProduction = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
        if (!isProduction) {
          return makeResult(
            "SKIPPED",
            source,
            "Playwright browser not available in development (set PLAYWRIGHT_CDP_ENDPOINT or PLAYWRIGHT_MODE=local)"
          );
        }
      }
    }
  }

  // No property found in any source
  const triedSources = sourcesToTry.map((s) => SCRAPERS[s].name).join(" and ");
  console.log(`[PAO Enrichment] No property found for address: "${address}"`);

  return {
    status: "FAILED",
    error: `No property found in ${triedSources} for address: "${address}"`,
    debug: { sourcesChecked: sourcesToTry, lastDebug },
    provenance: {
      source: sourcesToTry[0],
      method: "playwright",
      timestamp,
      confidence: 0,
    },
  };
}

// ============================================================================
// Confidence Calculation
// ============================================================================

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

// ============================================================================
// Property Summary Extraction
// ============================================================================

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
    const latest = property.valuations.reduce((a, b) => ((b.year || 0) > (a.year || 0) ? b : a));
    if (latest.assessed?.total) summary.assessedValue = latest.assessed.total;
    if (latest.just?.total) summary.marketValue = latest.just.total;
  }

  // Sales history - get most recent
  if (property.salesHistory && property.salesHistory.length > 0) {
    const recent = property.salesHistory.find((s) => s.price && s.price > 0);
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
