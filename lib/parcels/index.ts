/**
 * Parcel Data Ingestion Platform
 * 
 * Main entry point for the parcel ingestion system.
 */

// Core types
export * from "./types";

// Observability (export first to avoid conflicts)
export * from "./observability";

// Adapters (excluding ParcelIngestionObserver which is exported from observability)
export {
  type ParcelIngestionContext,
  type ParcelResolveInput,
  type ParcelResolveResult,
  type ParcelFetchInput,
  type ParcelFetchResult,
  type ParcelExtractInput,
  type ParcelExtractResult,
  type ParcelNormalizeInput,
  type ParcelNormalizeResult,
  type ParcelSourceAdapter,
  type ParcelAdapterFactory,
} from "./adapters/types";

// Registry
export * from "./registry";

// Ingestion pipeline
export * from "./ingestion";

// Storage
export * from "./storage";

// Utils
export * from "./utils/hash";
export * from "./utils/parcel-id";

// Sources (auto-registers adapters)
// Explicit exports to avoid naming conflicts (e.g., PARSER_VERSION)
export {
  MANATEE_PAO_SOURCE_KEY,
  MANATEE_STATE_FIPS,
  MANATEE_COUNTY_FIPS,
  MANATEE_PAO_CONFIG,
  PARSER_VERSION as MANATEE_PARSER_VERSION,
  normalizeManateePaoPropertyDetails,
  ManateePaoAdapter,
  createManateePaoAdapter,
} from "./sources/manatee-pao";

export {
  SARASOTA_PAO_SOURCE_KEY,
  SARASOTA_STATE_FIPS,
  SARASOTA_COUNTY_FIPS,
  SARASOTA_PAO_CONFIG,
  PARSER_VERSION as SARASOTA_PARSER_VERSION,
  normalizeSarasotaPaoPropertyDetails,
  SarasotaPaoAdapter,
  createSarasotaPaoAdapter,
} from "./sources/sarasota-pao";
