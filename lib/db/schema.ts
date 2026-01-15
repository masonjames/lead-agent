/**
 * Parcel Data Ingestion Platform - Database Schema
 * 
 * This schema supports:
 * - Source registry with YAML config storage
 * - Ingestion runs and jobs with full provenance
 * - Raw fetch artifacts for replay/audit
 * - Parse artifacts for re-normalization
 * - Canonical parcel entities with assessments and sales
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  numeric,
  date,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// 1) Source Registry
// ============================================================================

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().unique(), // e.g. "fl-manatee-pa"
  stateFips: text("state_fips").notNull(), // 2-digit FIPS
  countyFips: text("county_fips"), // 3-digit FIPS (nullable for statewide)
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(), // "statewide", "county_pa", "tax_collector", "recorder"
  platformFamily: text("platform_family").notNull(), // "arcgis", "qpublic", "custom_html", "custom_json"
  baseUrl: text("base_url").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  capabilities: jsonb("capabilities").notNull().default({}), // { address_search, parcel_search, assessment_history, etc. }
  rateLimit: jsonb("rate_limit").notNull().default({}), // { rps, burst }
  configVersion: integer("config_version").notNull().default(1),
  configYaml: text("config_yaml"), // stored config snapshot
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("sources_state_county_idx").on(table.stateFips, table.countyFips),
]);

// ============================================================================
// 2) Ingestion Runs & Jobs
// ============================================================================

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  triggeredBy: text("triggered_by").notNull(), // "api", "cron", "manual", "workflow"
  purpose: text("purpose"), // "lead_enrichment", "backfill", etc.
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("running"), // "running", "succeeded", "failed", "partial", "skipped"
  stats: jsonb("stats").notNull().default({}), // { fetches, parses, upserts, etc. }
  error: text("error"),
});

export const ingestionJobs = pgTable("ingestion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => ingestionRuns.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => sources.id),
  input: jsonb("input").notNull(), // { address, parcel_id, owner_name, ... }
  status: text("status").notNull().default("queued"), // "queued", "fetching", "parsed", "normalized", "failed"
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("ingestion_jobs_run_idx").on(table.runId),
  index("ingestion_jobs_status_idx").on(table.status),
]);

// ============================================================================
// 3) Raw Fetch Artifacts (Provenance Backbone)
// ============================================================================

export const rawFetches = pgTable("raw_fetches", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => ingestionRuns.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => ingestionJobs.id, { onDelete: "set null" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  requestUrl: text("request_url").notNull(),
  requestMethod: text("request_method").notNull().default("GET"),
  requestHeaders: jsonb("request_headers"),
  requestBody: text("request_body"),
  responseStatus: integer("response_status"),
  responseHeaders: jsonb("response_headers"),
  responseBody: text("response_body"), // HTML/JSON body
  contentType: text("content_type"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  bodySha256: text("body_sha256"), // hash for change detection/dedup
  meta: jsonb("meta").notNull().default({}),
}, (table) => [
  index("raw_fetches_source_fetched_idx").on(table.sourceId, table.fetchedAt),
  index("raw_fetches_job_idx").on(table.jobId),
  index("raw_fetches_sha_idx").on(table.bodySha256),
]);

// ============================================================================
// 4) Canonical Parcel Entity
// ============================================================================

export const parcels = pgTable("parcels", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateFips: text("state_fips").notNull(), // 2-digit FIPS
  countyFips: text("county_fips").notNull(), // 3-digit FIPS
  parcelIdRaw: text("parcel_id_raw"),
  parcelIdNorm: text("parcel_id_norm").notNull(),
  alternateIds: jsonb("alternate_ids").notNull().default([]),

  // Situs address
  situsAddressRaw: text("situs_address_raw"),
  situsAddressNorm: jsonb("situs_address_norm"), // { line1, city, state, zip }
  lat: numeric("lat"),
  lon: numeric("lon"),

  // Owner info
  ownerName: text("owner_name"),
  mailingAddressRaw: text("mailing_address_raw"),
  mailingAddressNorm: jsonb("mailing_address_norm"),

  // Land info
  land: jsonb("land").notNull().default({}), // use_code, legal, acreage, zoning
  
  // Improvements
  improvements: jsonb("improvements").notNull().default({}), // beds, baths, sqft, year_built, etc.

  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),

  // Traceability
  canonicalSourceId: uuid("canonical_source_id").references(() => sources.id),
  canonicalFetchId: uuid("canonical_fetch_id").references(() => rawFetches.id),
}, (table) => [
  uniqueIndex("parcels_unique_key").on(table.stateFips, table.countyFips, table.parcelIdNorm),
]);

// ============================================================================
// 5) Parcel Assessments (Year-Indexed)
// ============================================================================

export const parcelAssessments = pgTable("parcel_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  parcelId: uuid("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),

  justValue: numeric("just_value"),
  assessedValue: numeric("assessed_value"),
  taxableValue: numeric("taxable_value"),
  landValue: numeric("land_value"),
  improvementValue: numeric("improvement_value"),

  exemptions: jsonb("exemptions").notNull().default([]),
  extra: jsonb("extra").notNull().default({}),

  sourceId: uuid("source_id").references(() => sources.id),
  fetchId: uuid("fetch_id").references(() => rawFetches.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("parcel_assessments_unique").on(table.parcelId, table.taxYear),
  index("parcel_assessments_year_idx").on(table.taxYear),
]);

// ============================================================================
// 6) Parcel Sales History
// ============================================================================

export const parcelSales = pgTable("parcel_sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  parcelId: uuid("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),

  saleDate: date("sale_date"),
  salePrice: numeric("sale_price"),
  qualified: boolean("qualified"),
  instrument: text("instrument"),
  bookPage: text("book_page"),
  deedType: text("deed_type"),
  grantor: text("grantor"),
  grantee: text("grantee"),

  // Dedupe key to prevent duplicates on re-ingestion
  saleKeySha256: text("sale_key_sha256").notNull(),

  extra: jsonb("extra").notNull().default({}),
  sourceId: uuid("source_id").references(() => sources.id),
  fetchId: uuid("fetch_id").references(() => rawFetches.id),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("parcel_sales_parcel_idx").on(table.parcelId),
  index("parcel_sales_date_idx").on(table.saleDate),
  uniqueIndex("parcel_sales_unique_key").on(table.parcelId, table.saleKeySha256),
]);

// ============================================================================
// 7) Parse Artifacts (Intermediate Extracted State)
// ============================================================================

export const parseArtifacts = pgTable("parse_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").references(() => ingestionJobs.id, { onDelete: "set null" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id),
  fetchId: uuid("fetch_id").references(() => rawFetches.id, { onDelete: "set null" }),

  parserVersion: text("parser_version").notNull(),
  domSignature: text("dom_signature"), // hash of key DOM nodes/selectors for change detection
  extracted: jsonb("extracted").notNull(), // flat + structured extracted fields
  warnings: jsonb("warnings").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("parse_artifacts_source_idx").on(table.sourceId, table.createdAt),
  index("parse_artifacts_fetch_idx").on(table.fetchId),
]);

// ============================================================================
// 8) External Sessions (Playwright storage state)
// ============================================================================

export const externalSessions = pgTable("external_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  accountKey: text("account_key"),
  storageState: jsonb("storage_state").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("external_sessions_provider_account_idx").on(table.provider, table.accountKey),
  index("external_sessions_provider_idx").on(table.provider),
]);

// ============================================================================
// Relations
// ============================================================================

export const sourcesRelations = relations(sources, ({ many }) => ({
  ingestionJobs: many(ingestionJobs),
  rawFetches: many(rawFetches),
  parcels: many(parcels),
  parcelAssessments: many(parcelAssessments),
  parcelSales: many(parcelSales),
  parseArtifacts: many(parseArtifacts),
}));

export const ingestionRunsRelations = relations(ingestionRuns, ({ many }) => ({
  jobs: many(ingestionJobs),
  rawFetches: many(rawFetches),
}));

export const ingestionJobsRelations = relations(ingestionJobs, ({ one, many }) => ({
  run: one(ingestionRuns, {
    fields: [ingestionJobs.runId],
    references: [ingestionRuns.id],
  }),
  source: one(sources, {
    fields: [ingestionJobs.sourceId],
    references: [sources.id],
  }),
  rawFetches: many(rawFetches),
  parseArtifacts: many(parseArtifacts),
}));

export const rawFetchesRelations = relations(rawFetches, ({ one, many }) => ({
  run: one(ingestionRuns, {
    fields: [rawFetches.runId],
    references: [ingestionRuns.id],
  }),
  job: one(ingestionJobs, {
    fields: [rawFetches.jobId],
    references: [ingestionJobs.id],
  }),
  source: one(sources, {
    fields: [rawFetches.sourceId],
    references: [sources.id],
  }),
  parseArtifacts: many(parseArtifacts),
}));

export const parcelsRelations = relations(parcels, ({ one, many }) => ({
  canonicalSource: one(sources, {
    fields: [parcels.canonicalSourceId],
    references: [sources.id],
  }),
  canonicalFetch: one(rawFetches, {
    fields: [parcels.canonicalFetchId],
    references: [rawFetches.id],
  }),
  assessments: many(parcelAssessments),
  sales: many(parcelSales),
}));

export const parcelAssessmentsRelations = relations(parcelAssessments, ({ one }) => ({
  parcel: one(parcels, {
    fields: [parcelAssessments.parcelId],
    references: [parcels.id],
  }),
  source: one(sources, {
    fields: [parcelAssessments.sourceId],
    references: [sources.id],
  }),
  fetch: one(rawFetches, {
    fields: [parcelAssessments.fetchId],
    references: [rawFetches.id],
  }),
}));

export const parcelSalesRelations = relations(parcelSales, ({ one }) => ({
  parcel: one(parcels, {
    fields: [parcelSales.parcelId],
    references: [parcels.id],
  }),
  source: one(sources, {
    fields: [parcelSales.sourceId],
    references: [sources.id],
  }),
  fetch: one(rawFetches, {
    fields: [parcelSales.fetchId],
    references: [rawFetches.id],
  }),
}));

export const parseArtifactsRelations = relations(parseArtifacts, ({ one }) => ({
  job: one(ingestionJobs, {
    fields: [parseArtifacts.jobId],
    references: [ingestionJobs.id],
  }),
  source: one(sources, {
    fields: [parseArtifacts.sourceId],
    references: [sources.id],
  }),
  fetch: one(rawFetches, {
    fields: [parseArtifacts.fetchId],
    references: [rawFetches.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type NewIngestionRun = typeof ingestionRuns.$inferInsert;

export type IngestionJob = typeof ingestionJobs.$inferSelect;
export type NewIngestionJob = typeof ingestionJobs.$inferInsert;

export type RawFetch = typeof rawFetches.$inferSelect;
export type NewRawFetch = typeof rawFetches.$inferInsert;

export type Parcel = typeof parcels.$inferSelect;
export type NewParcel = typeof parcels.$inferInsert;

export type ParcelAssessment = typeof parcelAssessments.$inferSelect;
export type NewParcelAssessment = typeof parcelAssessments.$inferInsert;

export type ParcelSale = typeof parcelSales.$inferSelect;
export type NewParcelSale = typeof parcelSales.$inferInsert;

export type ParseArtifact = typeof parseArtifacts.$inferSelect;
export type NewParseArtifact = typeof parseArtifacts.$inferInsert;

export type ExternalSession = typeof externalSessions.$inferSelect;
export type NewExternalSession = typeof externalSessions.$inferInsert;
