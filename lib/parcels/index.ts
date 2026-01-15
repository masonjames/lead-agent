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
export * from "./sources/manatee-pao";
