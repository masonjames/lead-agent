/**
 * Parcel Platform Types
 * 
 * Core type definitions shared across the parcel ingestion platform.
 */

// ============================================================================
// Source Keys
// ============================================================================

export type ParcelSourceKey = "fl-manatee-pa" | "fl-sarasota-pa" | "fl-statewide-parcels";

export const FLORIDA_STATE_FIPS = "12";

export const COUNTY_FIPS: Record<string, { fips: string; name: string }> = {
  manatee: { fips: "081", name: "Manatee County" },
  sarasota: { fips: "115", name: "Sarasota County" },
};

// ============================================================================
// Provenance
// ============================================================================

export interface ParcelProvenance {
  source: string;
  method: string;
  sourceUrl?: string;
  timestamp: string;
  confidence: number;
}

export type ParcelFieldProvenanceMap = Record<string, ParcelProvenance>;

// ============================================================================
// Normalized Address
// ============================================================================

export interface NormalizedAddress {
  raw?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  normalizedFull: string;
}

// ============================================================================
// Normalized Parcel (Platform Contract)
// ============================================================================

export interface NormalizedParcel {
  // Identity
  stateFips: string;
  countyFips: string;
  parcelIdRaw?: string;
  parcelIdNorm: string;
  alternateIds?: string[];

  // Address
  situsAddress: NormalizedAddress;
  mailingAddress?: NormalizedAddress;
  coordinates?: {
    lat: number;
    lon: number;
  };

  // Owner
  ownerName?: string;

  // Land info
  land?: {
    useCode?: string;
    useDescription?: string;
    legalDescription?: string;
    acreage?: number;
    lotSizeSqFt?: number;
    zoning?: string;
  };

  // Improvements
  improvements?: {
    yearBuilt?: number;
    effectiveYearBuilt?: number;
    livingAreaSqFt?: number;
    totalAreaSqFt?: number;
    bedrooms?: number;
    bathrooms?: number;
    stories?: number;
    constructionType?: string;
    pool?: boolean;
    garage?: boolean;
  };

  // Assessments (year-indexed)
  assessments?: NormalizedAssessment[];

  // Sales history
  sales?: NormalizedSale[];

  // Provenance
  provenance: ParcelFieldProvenanceMap;
  confidence: number;
}

// ============================================================================
// Normalized Assessment (Year-Indexed)
// ============================================================================

export interface NormalizedAssessment {
  taxYear: number;
  justValue?: number;
  assessedValue?: number;
  taxableValue?: number;
  landValue?: number;
  improvementValue?: number;
  exemptions?: string[];
  adValoremTaxes?: number;
  nonAdValoremTaxes?: number;
}

// ============================================================================
// Normalized Sale
// ============================================================================

export interface NormalizedSale {
  saleDate?: string;
  salePrice?: number;
  qualified?: boolean;
  deedType?: string;
  instrument?: string;
  bookPage?: string;
  grantor?: string;
  grantee?: string;
  saleKeySha256: string; // For deduplication
}

// ============================================================================
// Ingestion Status
// ============================================================================

export type IngestionStatus = "SUCCESS" | "FAILED" | "SKIPPED" | "PARTIAL";

// ============================================================================
// Ingestion Result
// ============================================================================

export interface ParcelIngestionResult {
  runId: string;
  status: IngestionStatus;
  parcelId?: string;
  parcelKey?: {
    stateFips: string;
    countyFips: string;
    parcelIdNorm: string;
  };
  normalized?: NormalizedParcel;
  error?: string;
  debug?: Record<string, unknown>;
}

// ============================================================================
// Source Capabilities
// ============================================================================

export interface SourceCapabilities {
  addressSearch?: boolean;
  parcelSearch?: boolean;
  ownerSearch?: boolean;
  assessmentHistory?: boolean;
  salesHistory?: boolean;
  owner?: boolean;
  improvements?: boolean;
  land?: boolean;
}

// ============================================================================
// Rate Limit Config
// ============================================================================

export interface RateLimitConfig {
  rps?: number;
  burst?: number;
}

// ============================================================================
// Source Config
// ============================================================================

export interface SourceConfig {
  sourceKey: ParcelSourceKey;
  name: string;
  stateFips: string;
  countyFips?: string;
  sourceType: "statewide" | "county_pa" | "tax_collector" | "recorder";
  platformFamily: "arcgis" | "qpublic" | "custom_html" | "custom_json" | "playwright";
  baseUrl: string;
  capabilities: SourceCapabilities;
  rateLimit: RateLimitConfig;
  retry?: {
    maxAttempts?: number;
    backoffSeconds?: number[];
  };
}
