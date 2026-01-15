/**
 * Exa Enrichment Types
 * 
 * Type definitions for the enhanced Exa enrichment system.
 */

import type { ExaSourceCategory, ProfilePlatform } from "./categorize";

/**
 * Query task for Exa search
 */
export interface ExaQueryTask {
  /** Intent/purpose of this query */
  intent: string;
  /** The search query string */
  query: string;
  /** Domains to include (optional, for targeted searches) */
  includeDomains?: string[];
  /** Domains to exclude */
  excludeDomains?: string[];
  /** Number of results to fetch */
  numResults: number;
  /** Max characters per result */
  maxCharacters: number;
}

/**
 * Enriched source with categorization and match scoring
 */
export interface ExaEnrichedSource {
  /** Source URL */
  url: string;
  /** Extracted domain */
  domain: string;
  /** Page title */
  title?: string;
  /** Snippet/excerpt from the page */
  snippet?: string;
  /** Category determined by URL/content analysis */
  category: ExaSourceCategory;
  /** Platform (for profiles) */
  platform: ProfilePlatform;
  /** Match score against lead identity (0-1) */
  matchScore: number;
  /** Reasons why this matched */
  matchReasons: string[];
  /** Data extracted from the content */
  extracted?: {
    emails?: string[];
    phones?: string[];
    locations?: string[];
    personNameMentions?: string[];
  };
  /** Provenance info */
  provenance: {
    queryIntent: string;
    query: string;
  };
}

/**
 * Public profile for display in reports
 */
export interface ExaPublicProfile {
  /** Platform name */
  platform: ProfilePlatform;
  /** Source category */
  category: ExaSourceCategory;
  /** Profile URL */
  url: string;
  /** Display name (from title or extracted) */
  displayName?: string;
  /** Headline/description */
  headline?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Why this was matched */
  matchReasons: string[];
}

/**
 * Web research source for display in reports
 */
export interface ExaWebResearchSource {
  /** Source URL */
  url: string;
  /** Page title */
  title?: string;
  /** Snippet/excerpt */
  snippet?: string;
  /** Category */
  category: ExaSourceCategory;
  /** Match score */
  matchScore: number;
}

/**
 * Status of enrichment operation
 */
export type EnrichmentStatus = "SUCCESS" | "SKIPPED" | "FAILED";

/**
 * Result from Exa enrichment
 */
export interface ExaEnrichmentResult {
  status: EnrichmentStatus;
  data?: {
    /** Backward-compatible summary */
    summaryMarkdown: string;
    /** Number of profiles found */
    profilesFound: number;
    
    // NEW: Structured outputs
    /** Public profiles (high-confidence, profile-type sources) */
    publicProfiles: ExaPublicProfile[];
    /** Web research summary in markdown */
    webResearchSummaryMarkdown: string;
    /** Web research sources */
    webResearchSources: ExaWebResearchSource[];
    
    // Debug/trace info
    /** All enriched sources */
    sources: ExaEnrichedSource[];
    /** Queries that were run */
    queriesRun: Array<{
      intent: string;
      query: string;
      includeDomains?: string[];
      excludeDomains?: string[];
      resultsCount: number;
    }>;
  };
  error?: string;
  provenance: {
    source: "exa";
    method: "multi_search_and_contents";
    confidence: number;
    timestamp: string;
  };
}

/**
 * Parameters for Exa enrichment
 */
export interface ExaEnrichmentParams {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  location?: string;
}
