/**
 * API Schemas for Parcel Endpoints
 */

import { z } from "zod";

// ============================================================================
// Ingest Endpoint
// ============================================================================

export const ingestRequestSchema = z.object({
  address: z.string().min(1, "Address is required").optional(),
  parcelId: z.string().optional(),
  sourceKey: z.string().optional(),
  force: z.boolean().optional().default(false),
}).refine(
  (data) => data.address || data.parcelId,
  { message: "Either address or parcelId must be provided" }
);

export type IngestRequest = z.infer<typeof ingestRequestSchema>;

// ============================================================================
// Parcel Query
// ============================================================================

export const parcelKeySchema = z.object({
  stateFips: z.string().length(2, "State FIPS must be 2 digits"),
  countyFips: z.string().length(3, "County FIPS must be 3 digits"),
  parcelIdNorm: z.string().min(1, "Parcel ID is required"),
});

export type ParcelKey = z.infer<typeof parcelKeySchema>;

// ============================================================================
// Response Types
// ============================================================================

export const parcelResponseSchema = z.object({
  id: z.string().uuid(),
  stateFips: z.string(),
  countyFips: z.string(),
  parcelIdNorm: z.string(),
  parcelIdRaw: z.string().nullable(),
  situsAddressRaw: z.string().nullable(),
  situsAddressNorm: z.record(z.string(), z.unknown()).nullable(),
  ownerName: z.string().nullable(),
  land: z.record(z.string(), z.unknown()),
  improvements: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const assessmentResponseSchema = z.object({
  id: z.string().uuid(),
  taxYear: z.number(),
  justValue: z.string().nullable(),
  assessedValue: z.string().nullable(),
  taxableValue: z.string().nullable(),
  landValue: z.string().nullable(),
  improvementValue: z.string().nullable(),
});

export const saleResponseSchema = z.object({
  id: z.string().uuid(),
  saleDate: z.string().nullable(),
  salePrice: z.string().nullable(),
  deedType: z.string().nullable(),
  instrument: z.string().nullable(),
  bookPage: z.string().nullable(),
  grantor: z.string().nullable(),
  grantee: z.string().nullable(),
  qualified: z.boolean().nullable(),
});

export const ingestResponseSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(["SUCCESS", "FAILED", "SKIPPED", "PARTIAL"]),
  parcelId: z.string().uuid().optional(),
  parcelKey: parcelKeySchema.optional(),
  error: z.string().optional(),
});

export const sourceResponseSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  stateFips: z.string(),
  countyFips: z.string().optional(),
  sourceType: z.string(),
  platformFamily: z.string(),
  baseUrl: z.string(),
  capabilities: z.record(z.string(), z.boolean()),
});
