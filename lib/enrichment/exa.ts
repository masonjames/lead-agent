/**
 * Exa Enrichment Service
 *
 * Enhanced person enrichment using Exa AI search with:
 * - Multi-query strategy (general, license, business, social)
 * - Targeted LinkedIn/Facebook searches for better profile discovery
 * - Aggressive domain filtering to remove noise
 * - Result categorization and match scoring
 * - Confidence tiering and candidate grouping for name disambiguation
 * - Structured output for profiles vs web research
 */

import { exa } from "@/lib/exa";
import { buildExaQueryPlan, summarizeQueryPlan, type QueryPlanResult } from "./exa/query-plan";
import { categorizeExaUrl, isProfileCategory, getCategoryDisplayName, type ProfilePlatform } from "./exa/categorize";
import { scoreMatchToLead, shouldIncludeResult, MATCH_THRESHOLDS, type LeadIdentity, type MatchResult } from "./exa/match";
import type { GeoContext } from "./exa/geo";
import type {
  ExaEnrichmentResult,
  ExaEnrichmentParams,
  ExaEnrichedSource,
  ExaPublicProfile,
  ExaWebResearchSource,
  ExaQueryTask,
  ConfidenceTier,
  ExaProfileCandidate,
  NameDisambiguation,
  MatchSignals,
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
 * Normalize URL by unwrapping redirect wrappers (e.g., Facebook l.php)
 */
function normalizeResultUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Handle Facebook redirect URLs like l.facebook.com/l.php?u=...
    if (urlObj.hostname.includes("facebook.com") && urlObj.pathname.includes("/l.php")) {
      const targetUrl = urlObj.searchParams.get("u");
      if (targetUrl) {
        return decodeURIComponent(targetUrl);
      }
    }

    // Handle Google redirect URLs
    if (urlObj.hostname.includes("google.com") && urlObj.pathname.includes("/url")) {
      const targetUrl = urlObj.searchParams.get("url") || urlObj.searchParams.get("q");
      if (targetUrl) {
        return decodeURIComponent(targetUrl);
      }
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * Deduplicate results by URL (with normalization)
 */
function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = normalizeResultUrl(item.url).toLowerCase().replace(/\/$/, "");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * Compute confidence tier based on match score and signals
 */
function computeConfidenceTier(params: {
  matchScore: number;
  signals: MatchSignals;
  platform: ProfilePlatform;
  isProfileUrl: boolean;
}): ConfidenceTier {
  const { matchScore, signals, platform, isProfileUrl } = params;

  // CONFIRMED: Strong verification signals
  if (signals.hasEmailMatch || signals.hasPhoneMatch) {
    return "CONFIRMED";
  }

  // LIKELY: Multiple strong signals or high match score
  const hasCompanyMatch = signals.hasCompanyMatchTitle || signals.hasCompanyMatchText;
  const hasGeoMatch = signals.hasCityMatch || signals.hasZipMatch;

  if (matchScore >= 0.60 && hasCompanyMatch && hasGeoMatch) {
    return "LIKELY";
  }
  if (matchScore >= 0.50 && hasCompanyMatch) {
    return "LIKELY";
  }
  if (matchScore >= 0.50 && hasGeoMatch && isProfileUrl) {
    return "LIKELY";
  }

  // POSSIBLE: Moderate signals
  if (matchScore >= 0.30 && (hasCompanyMatch || hasGeoMatch)) {
    return "POSSIBLE";
  }
  if (matchScore >= 0.40 && isProfileUrl) {
    return "POSSIBLE";
  }
  if (["LinkedIn", "Facebook"].includes(platform) && isProfileUrl && matchScore >= 0.20) {
    return "POSSIBLE";
  }

  // LOW: Weak match
  return "LOW";
}

/**
 * Build a candidate group key from signals
 */
function buildCandidateKey(params: {
  signals: MatchSignals;
  hasCompanyMatch: boolean;
  geoLabel?: string;
}): string {
  const { signals, hasCompanyMatch, geoLabel } = params;

  // Use conflicting state as the key if present and no target state match
  if (signals.conflictingStates.length > 0 && !signals.hasStateMatch) {
    return `other_${signals.conflictingStates[0]}`;
  }

  // Use company + geo as key
  if (hasCompanyMatch && geoLabel) {
    return `company_${geoLabel}`;
  }

  // Use geo as key
  if (geoLabel && (signals.hasCityMatch || signals.hasStateMatch)) {
    return `geo_${geoLabel}`;
  }

  // Default group
  return "unknown";
}

interface ProfileWithSignals extends ExaPublicProfile {
  _signals?: MatchSignals;
  _score?: number;
}

/**
 * Build profile candidate groups for disambiguation
 */
function buildProfileCandidates(params: {
  leadName?: string;
  leadCompany?: string;
  geoLabel?: string;
  profiles: ProfileWithSignals[];
}): {
  candidates: ExaProfileCandidate[];
  annotatedProfiles: ExaPublicProfile[];
  nameDisambiguation: NameDisambiguation;
} {
  const { leadName, leadCompany, geoLabel, profiles } = params;

  // Group profiles by candidate key
  const groups = new Map<string, ProfileWithSignals[]>();

  for (const profile of profiles) {
    const signals = profile._signals || {
      hasEmailMatch: false,
      hasPhoneMatch: false,
      hasCompanyMatchTitle: false,
      hasCompanyMatchText: false,
      hasCityMatch: false,
      hasStateMatch: false,
      hasZipMatch: false,
      conflictingStates: [],
    };

    const hasCompanyMatch = signals.hasCompanyMatchTitle || signals.hasCompanyMatchText;
    const key = buildCandidateKey({ signals, hasCompanyMatch, geoLabel });

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(profile);
  }

  // Convert groups to candidates
  const candidates: ExaProfileCandidate[] = [];
  let candidateIndex = 0;

  for (const [key, groupProfiles] of groups.entries()) {
    candidateIndex++;
    const id = `candidate_${candidateIndex}`;

    // Determine label for this candidate
    let label = "Possible match";
    if (key.startsWith("company_")) {
      label = leadCompany ? `${leadCompany}` : "Company match";
      if (geoLabel) label += ` - ${geoLabel}`;
    } else if (key.startsWith("geo_")) {
      label = geoLabel || "Location match";
    } else if (key.startsWith("other_")) {
      const state = key.replace("other_", "");
      label = `Other location (${state})`;
    }

    // Calculate aggregate confidence
    const maxScore = Math.max(...groupProfiles.map((p) => p._score || p.confidence));
    const bestTier = groupProfiles.reduce<ConfidenceTier>((best, p) => {
      const tier = p.confidenceTier || "LOW";
      const tierOrder: Record<ConfidenceTier, number> = {
        CONFIRMED: 4,
        LIKELY: 3,
        POSSIBLE: 2,
        LOW: 1,
      };
      return tierOrder[tier] > tierOrder[best] ? tier : best;
    }, "LOW");

    // Collect unique reasons
    const allReasons = new Set<string>();
    for (const p of groupProfiles) {
      p.matchReasons.forEach((r) => allReasons.add(r));
    }

    candidates.push({
      id,
      label,
      confidenceTier: bestTier,
      confidence: maxScore,
      reasons: Array.from(allReasons).slice(0, 5),
      profiles: groupProfiles.map((p) => {
        // Clean up internal fields
        const { _signals, _score, ...cleanProfile } = p;
        return cleanProfile;
      }),
    });
  }

  // Sort candidates by confidence (best first)
  candidates.sort((a, b) => {
    const tierOrder: Record<ConfidenceTier, number> = {
      CONFIRMED: 4,
      LIKELY: 3,
      POSSIBLE: 2,
      LOW: 1,
    };
    const tierDiff = tierOrder[b.confidenceTier] - tierOrder[a.confidenceTier];
    if (tierDiff !== 0) return tierDiff;
    return b.confidence - a.confidence;
  });

  // Annotate profiles with candidate info
  const annotatedProfiles: ExaPublicProfile[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const rank = i + 1;
    const isPrimary = i === 0;

    for (const profile of candidate.profiles) {
      annotatedProfiles.push({
        ...profile,
        candidate: {
          id: candidate.id,
          label: candidate.label,
          rank,
          isPrimary,
        },
      });
    }
  }

  // Sort annotated profiles by rank, then confidence
  annotatedProfiles.sort((a, b) => {
    const rankDiff = (a.candidate?.rank || 999) - (b.candidate?.rank || 999);
    if (rankDiff !== 0) return rankDiff;
    return b.confidence - a.confidence;
  });

  // Build disambiguation metadata
  const nameDisambiguation: NameDisambiguation = {
    isAmbiguous: candidates.length > 1,
    candidateCount: candidates.length,
  };

  if (candidates.length > 1) {
    nameDisambiguation.note = `Found ${candidates.length} possible matches for "${leadName}". Primary match shown first.`;
  }

  return { candidates, annotatedProfiles, nameDisambiguation };
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
function buildPublicProfile(
  source: ExaEnrichedSource,
  matchResult: MatchResult,
  categorization: { isProfile: boolean }
): ProfileWithSignals {
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

  // Compute confidence tier
  const confidenceTier = computeConfidenceTier({
    matchScore: source.matchScore,
    signals: matchResult.signals,
    platform: source.platform,
    isProfileUrl: categorization.isProfile,
  });

  return {
    platform: source.platform,
    category: source.category,
    url: source.url,
    displayName,
    headline: source.snippet?.substring(0, 150),
    confidence: source.matchScore,
    confidenceTier,
    matchReasons: source.matchReasons,
    // Internal fields for candidate grouping (will be removed later)
    _signals: matchResult.signals,
    _score: source.matchScore,
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
 * Format confidence tier for display
 */
function formatConfidenceTier(tier?: ConfidenceTier): string {
  switch (tier) {
    case "CONFIRMED":
      return "Confirmed";
    case "LIKELY":
      return "Likely";
    case "POSSIBLE":
      return "Possible";
    case "LOW":
      return "Low";
    default:
      return "";
  }
}

/**
 * Generate a summary markdown from the enrichment results
 */
function generateSummaryMarkdown(
  profiles: ExaPublicProfile[],
  webSources: ExaWebResearchSource[],
  nameDisambiguation?: NameDisambiguation
): string {
  const parts: string[] = [];

  // Add disambiguation notice if multiple candidates
  if (nameDisambiguation?.isAmbiguous && nameDisambiguation.note) {
    parts.push(`**Note:** ${nameDisambiguation.note}`);
    parts.push("");
  }

  if (profiles.length > 0) {
    parts.push("**Verified Profiles:**");
    // Show up to 10 profiles instead of 5
    for (const profile of profiles.slice(0, 10)) {
      const platformLabel = profile.platform !== "Other" ? `[${profile.platform}]` : "";
      const confidence = Math.round(profile.confidence * 100);
      const tierLabel = profile.confidenceTier ? ` (${formatConfidenceTier(profile.confidenceTier)})` : "";
      const candidateLabel = profile.candidate?.isPrimary ? "" : profile.candidate?.label ? ` - ${profile.candidate.label}` : "";

      parts.push(
        `- ${platformLabel} ${profile.displayName || "Profile"} - ${confidence}% match${tierLabel}${candidateLabel}`
      );
      if (profile.headline) {
        parts.push(`  ${profile.headline}`);
      }
      parts.push(`  [View](${profile.url})`);
    }
    if (profiles.length > 10) {
      parts.push(`  ... and ${profiles.length - 10} more profiles`);
    }
    parts.push("");
  }

  if (webSources.length > 0) {
    parts.push("**Additional Sources:**");
    for (const source of webSources.slice(0, 5)) {
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
 * - Professional and social profiles (LinkedIn, Facebook, etc.)
 * - License and business registry records
 * - Relevant web mentions
 *
 * Results include confidence tiers and candidate grouping for disambiguation
 * when multiple people may share the same name.
 */
export async function enrichWithExa(params: ExaEnrichmentParams): Promise<ExaEnrichmentResult> {
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

  // Build the query plan (now returns geo context too)
  const queryPlanResult = buildExaQueryPlan(params);
  const { tasks: queryPlan, geo } = queryPlanResult;
  console.log(`[Exa Enrichment] ${summarizeQueryPlan(queryPlanResult)}`);

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
    // Build lead identity for matching (using geo context)
    const leadIdentity: LeadIdentity = {
      name: params.name,
      email: params.email,
      phone: params.phone,
      address: params.address,
      company: params.company,
      city: geo.city,
      state: geo.state,
      zipCode: geo.zipCode,
    };

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
        // Normalize URLs (unwrap redirects) before adding
        const normalizedUrl = normalizeResultUrl(result.url);
        allRawResults.push({
          ...result,
          url: normalizedUrl,
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
    const matchResultsMap = new Map<string, MatchResult>();
    const categorizationMap = new Map<string, { isProfile: boolean }>();

    for (const result of uniqueResults) {
      const domain = extractDomain(result.url);

      // Categorize
      const categorization = categorizeExaUrl({
        url: result.url,
        title: result.title,
        text: result.text,
      });

      // Score match to lead (now with geo context)
      const matchResult = scoreMatchToLead({
        lead: leadIdentity,
        geo,
        doc: {
          url: result.url,
          title: result.title,
          text: result.text,
          category: categorization.category,
          domain,
        },
      });

      // Store for later profile building
      matchResultsMap.set(result.url, matchResult);
      categorizationMap.set(result.url, { isProfile: categorization.isProfile });

      // Check if should include
      // Be more lenient for LinkedIn/Facebook profile URLs
      let inclusion = shouldIncludeResult(categorization.category, matchResult.score);

      // Special handling for social profiles: lower threshold if it's a true profile URL
      if (
        !inclusion.include &&
        categorization.isProfile &&
        (categorization.platform === "LinkedIn" || categorization.platform === "Facebook") &&
        matchResult.score >= 0.12
      ) {
        inclusion = { include: true, asProfile: true };
      }

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
    const profilesWithSignals: ProfileWithSignals[] = [];
    const webResearchSources: ExaWebResearchSource[] = [];

    for (const source of enrichedSources) {
      const isProfile = isProfileCategory(source.category) && source.matchScore >= MATCH_THRESHOLDS.PROFILE_MIN;

      if (isProfile) {
        const matchResult = matchResultsMap.get(source.url);
        const categorization = categorizationMap.get(source.url);
        if (matchResult && categorization) {
          profilesWithSignals.push(buildPublicProfile(source, matchResult, categorization));
        }
      } else {
        webResearchSources.push(buildWebResearchSource(source));
      }
    }

    // Build candidate groups for disambiguation
    const { candidates, annotatedProfiles, nameDisambiguation } = buildProfileCandidates({
      leadName: params.name,
      leadCompany: params.company,
      geoLabel: geo.label,
      profiles: profilesWithSignals,
    });

    // Generate summary markdown (with disambiguation info)
    const webResearchSummaryMarkdown = generateSummaryMarkdown(
      annotatedProfiles,
      webResearchSources,
      nameDisambiguation
    );

    // Also generate backward-compatible summaryMarkdown
    const summaryMarkdown =
      annotatedProfiles.length > 0 || webResearchSources.length > 0
        ? `Found ${annotatedProfiles.length} profile(s) and ${webResearchSources.length} web source(s).\n\n${webResearchSummaryMarkdown}`
        : "No verified profiles or relevant web mentions found.";

    // Calculate overall confidence
    let confidence = 0.3; // Base confidence
    if (annotatedProfiles.length > 0) confidence += 0.3;
    if (annotatedProfiles.some((p) => p.confidence >= MATCH_THRESHOLDS.HIGH_CONFIDENCE)) confidence += 0.2;
    if (annotatedProfiles.some((p) => p.confidenceTier === "CONFIRMED" || p.confidenceTier === "LIKELY")) {
      confidence += 0.1;
    }
    if (webResearchSources.length > 0) confidence += 0.1;

    console.log(
      `[Exa Enrichment] Found ${annotatedProfiles.length} profiles (${candidates.length} candidates), ` +
        `${webResearchSources.length} web sources, confidence: ${Math.round(confidence * 100)}%`
    );

    return {
      status: "SUCCESS",
      data: {
        summaryMarkdown,
        profilesFound: annotatedProfiles.length,
        publicProfiles: annotatedProfiles,
        webResearchSummaryMarkdown,
        webResearchSources,
        profileCandidates: candidates.length > 1 ? candidates : undefined,
        nameDisambiguation: nameDisambiguation.isAmbiguous ? nameDisambiguation : undefined,
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
