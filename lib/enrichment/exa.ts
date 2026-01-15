/**
 * Exa Enrichment Service
 * 
 * Enhanced person enrichment using Exa AI search with:
 * - Multi-query strategy (general, license, business, social)
 * - Aggressive domain filtering to remove noise
 * - Result categorization and match scoring
 * - Structured output for profiles vs web research
 */

import { exa } from "@/lib/exa";
import { buildExaQueryPlan, summarizeQueryPlan } from "./exa/query-plan";
import { categorizeExaUrl, isProfileCategory, getCategoryDisplayName } from "./exa/categorize";
import { scoreMatchToLead, shouldIncludeResult, MATCH_THRESHOLDS, type LeadIdentity } from "./exa/match";
import type {
  ExaEnrichmentResult,
  ExaEnrichmentParams,
  ExaEnrichedSource,
  ExaPublicProfile,
  ExaWebResearchSource,
  ExaQueryTask,
} from "./exa/types";

// Re-export types for backward compatibility
export type { ExaEnrichmentResult, EnrichmentStatus } from "./exa/types";

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Deduplicate results by URL
 */
function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = item.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Run a single Exa query task
 */
async function runExaTask(
  task: ExaQueryTask
): Promise<Array<{ url: string; title?: string; text?: string }>> {
  try {
    const response = await exa.searchAndContents(task.query, {
      type: "auto",
      numResults: task.numResults,
      text: { maxCharacters: task.maxCharacters },
      useAutoprompt: false,
      includeDomains: task.includeDomains,
      excludeDomains: task.excludeDomains,
    });

    return (response.results || []).map((r) => ({
      url: r.url || "",
      title: r.title ?? undefined,
      text: r.text ?? undefined,
    }));
  } catch (error) {
    console.warn(`[Exa] Task "${task.intent}" failed:`, error);
    return [];
  }
}

/**
 * Build a public profile from an enriched source
 */
function buildPublicProfile(source: ExaEnrichedSource): ExaPublicProfile {
  // Extract a display name from title if possible
  let displayName: string | undefined;
  if (source.title) {
    // Try to extract name from common title patterns
    // e.g., "John Smith - LinkedIn" -> "John Smith"
    // e.g., "John Smith | Realtor.com" -> "John Smith"
    const nameMatch = source.title.match(/^([^|—–\-]+)/);
    if (nameMatch) {
      displayName = nameMatch[1].trim();
    }
  }

  return {
    platform: source.platform,
    category: source.category,
    url: source.url,
    displayName,
    headline: source.snippet?.substring(0, 150),
    confidence: source.matchScore,
    matchReasons: source.matchReasons,
  };
}

/**
 * Build a web research source from an enriched source
 */
function buildWebResearchSource(source: ExaEnrichedSource): ExaWebResearchSource {
  return {
    url: source.url,
    title: source.title,
    snippet: source.snippet?.substring(0, 200),
    category: source.category,
    matchScore: source.matchScore,
  };
}

/**
 * Generate a summary markdown from the enrichment results
 */
function generateSummaryMarkdown(
  profiles: ExaPublicProfile[],
  webSources: ExaWebResearchSource[]
): string {
  const parts: string[] = [];

  if (profiles.length > 0) {
    parts.push("**Verified Profiles:**");
    for (const profile of profiles.slice(0, 5)) {
      const platformLabel = profile.platform !== "Other" ? `[${profile.platform}]` : "";
      const confidence = Math.round(profile.confidence * 100);
      parts.push(`- ${platformLabel} ${profile.displayName || "Profile"} (${confidence}% match)`);
      if (profile.headline) {
        parts.push(`  ${profile.headline}`);
      }
      parts.push(`  [View](${profile.url})`);
    }
    parts.push("");
  }

  if (webSources.length > 0) {
    parts.push("**Additional Sources:**");
    for (const source of webSources.slice(0, 3)) {
      const categoryLabel = getCategoryDisplayName(source.category);
      parts.push(`- [${categoryLabel}] ${source.title || "Web Result"}`);
      if (source.snippet) {
        parts.push(`  ${source.snippet.substring(0, 100)}...`);
      }
    }
    parts.push("");
  }

  if (parts.length === 0) {
    return "No verified profiles or significant web presence found.";
  }

  return parts.join("\n");
}

/**
 * Enrich a lead with public information from Exa AI
 * 
 * Uses a multi-query strategy with domain filtering to find:
 * - Professional and social profiles
 * - License and business registry records
 * - Relevant web mentions
 */
export async function enrichWithExa(
  params: ExaEnrichmentParams
): Promise<ExaEnrichmentResult> {
  const timestamp = new Date().toISOString();
  const baseProvenance = {
    source: "exa" as const,
    method: "multi_search_and_contents" as const,
    timestamp,
  };

  // Need at least name or email to search
  if (!params.name && !params.email) {
    return {
      status: "SKIPPED",
      error: "No name or email provided for Exa enrichment",
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }

  // Check if Exa is configured
  if (!exa) {
    return {
      status: "SKIPPED",
      error: "EXA_API_KEY not configured",
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }

  // Build the query plan
  const queryPlan = buildExaQueryPlan(params);
  console.log(`[Exa Enrichment] ${summarizeQueryPlan(queryPlan)}`);

  if (queryPlan.length === 0) {
    return {
      status: "SKIPPED",
      error: "Insufficient data to build search queries",
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }

  try {
    // Build lead identity for matching
    const leadIdentity: LeadIdentity = {
      name: params.name,
      email: params.email,
      phone: params.phone,
      address: params.address,
    };

    // Parse location info from address
    if (params.address) {
      const cityMatch = params.address.match(/([A-Za-z\s]+),\s*(?:FL|Florida)/i);
      if (cityMatch) {
        leadIdentity.city = cityMatch[1].trim();
      }
      const zipMatch = params.address.match(/\b(\d{5})(?:-\d{4})?\b/);
      if (zipMatch) {
        leadIdentity.zipCode = zipMatch[1];
      }
      leadIdentity.state = "FL";
    }

    // Execute all queries
    const queriesRun: NonNullable<ExaEnrichmentResult["data"]>["queriesRun"] = [];
    const allRawResults: Array<{
      url: string;
      title?: string;
      text?: string;
      queryIntent: string;
      query: string;
    }> = [];

    for (const task of queryPlan) {
      console.log(`[Exa] Running query: ${task.intent}`);
      const results = await runExaTask(task);
      
      queriesRun.push({
        intent: task.intent,
        query: task.query,
        includeDomains: task.includeDomains,
        excludeDomains: task.excludeDomains,
        resultsCount: results.length,
      });

      for (const result of results) {
        allRawResults.push({
          ...result,
          queryIntent: task.intent,
          query: task.query,
        });
      }
    }

    // Deduplicate by URL
    const uniqueResults = dedupeByUrl(allRawResults);
    console.log(`[Exa] ${allRawResults.length} raw results -> ${uniqueResults.length} unique`);

    // Categorize and score each result
    const enrichedSources: ExaEnrichedSource[] = [];

    for (const result of uniqueResults) {
      const domain = extractDomain(result.url);
      
      // Categorize
      const categorization = categorizeExaUrl({
        url: result.url,
        title: result.title,
        text: result.text,
      });

      // Score match to lead
      const matchResult = scoreMatchToLead({
        lead: leadIdentity,
        doc: {
          url: result.url,
          title: result.title,
          text: result.text,
          category: categorization.category,
          domain,
        },
      });

      // Check if should include
      const inclusion = shouldIncludeResult(categorization.category, matchResult.score);
      
      if (inclusion.include) {
        enrichedSources.push({
          url: result.url,
          domain,
          title: result.title,
          snippet: result.text?.substring(0, 300),
          category: categorization.category,
          platform: categorization.platform,
          matchScore: matchResult.score,
          matchReasons: matchResult.reasons,
          extracted: matchResult.extracted,
          provenance: {
            queryIntent: result.queryIntent,
            query: result.query,
          },
        });
      }
    }

    // Sort by match score
    enrichedSources.sort((a, b) => b.matchScore - a.matchScore);

    // Split into profiles vs web research
    const publicProfiles: ExaPublicProfile[] = [];
    const webResearchSources: ExaWebResearchSource[] = [];

    for (const source of enrichedSources) {
      const isProfile = isProfileCategory(source.category) &&
                       source.matchScore >= MATCH_THRESHOLDS.PROFILE_MIN;
      
      if (isProfile) {
        publicProfiles.push(buildPublicProfile(source));
      } else {
        webResearchSources.push(buildWebResearchSource(source));
      }
    }

    // Generate summary markdown
    const webResearchSummaryMarkdown = generateSummaryMarkdown(publicProfiles, webResearchSources);

    // Also generate backward-compatible summaryMarkdown
    const summaryMarkdown = publicProfiles.length > 0 || webResearchSources.length > 0
      ? `Found ${publicProfiles.length} profile(s) and ${webResearchSources.length} web source(s).\n\n${webResearchSummaryMarkdown}`
      : "No verified profiles or relevant web mentions found.";

    // Calculate overall confidence
    let confidence = 0.3; // Base confidence
    if (publicProfiles.length > 0) confidence += 0.3;
    if (publicProfiles.some(p => p.confidence >= MATCH_THRESHOLDS.HIGH_CONFIDENCE)) confidence += 0.2;
    if (webResearchSources.length > 0) confidence += 0.1;

    console.log(
      `[Exa Enrichment] Found ${publicProfiles.length} profiles, ` +
      `${webResearchSources.length} web sources, confidence: ${Math.round(confidence * 100)}%`
    );

    return {
      status: "SUCCESS",
      data: {
        summaryMarkdown,
        profilesFound: publicProfiles.length,
        publicProfiles,
        webResearchSummaryMarkdown,
        webResearchSources,
        sources: enrichedSources,
        queriesRun,
      },
      provenance: {
        ...baseProvenance,
        confidence: Math.min(confidence, 1),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Exa Enrichment] Error: ${errorMessage}`);

    return {
      status: "FAILED",
      error: `Exa search failed: ${errorMessage}`,
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }
}
