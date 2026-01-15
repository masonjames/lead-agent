/**
 * Exa Enrichment Service
 * 
 * Uses Exa AI to find public information about leads
 * for identity validation and additional context.
 */

import { exa } from "@/lib/exa";

export type EnrichmentStatus = "SUCCESS" | "SKIPPED" | "FAILED";

export interface ExaEnrichmentResult {
  status: EnrichmentStatus;
  data?: {
    summaryMarkdown: string;
    sources: Array<{
      url: string;
      title?: string;
      snippet?: string;
    }>;
    profilesFound: number;
  };
  error?: string;
  provenance: {
    source: "exa";
    method: "search_and_contents";
    confidence: number;
    timestamp: string;
  };
}

/**
 * Enrich a lead with public information from Exa AI
 * 
 * Searches for public profiles and information to help validate
 * the lead's identity and provide additional context.
 */
export async function enrichWithExa(params: {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  location?: string;
}): Promise<ExaEnrichmentResult> {
  const timestamp = new Date().toISOString();
  const baseProvenance = {
    source: "exa" as const,
    method: "search_and_contents" as const,
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

  // Build search query
  const queryParts: string[] = [];
  
  if (params.name) {
    queryParts.push(`"${params.name}"`);
  }
  
  // Add location context if available
  const location = params.location || params.address;
  if (location) {
    // Extract city/state for broader matching
    const locationMatch = location.match(/([A-Za-z\s]+),?\s*(?:FL|Florida)/i);
    if (locationMatch) {
      queryParts.push(locationMatch[1].trim());
    } else {
      queryParts.push("Manatee County Florida");
    }
  } else {
    // Default to Manatee County for real estate context
    queryParts.push("Manatee County Florida");
  }

  const query = queryParts.join(" ");
  console.log(`[Exa Enrichment] Searching for: ${query}`);

  try {
    // Search for personal/professional profiles specifically
    const response = await exa.searchAndContents(query, {
      type: "auto",
      numResults: 5,
      text: { maxCharacters: 1500 },
      useAutoprompt: false,
      // Filter to more relevant result types - exclude generic government sites
      excludeDomains: [
        "mymanatee.org",
        "fl-counties.com",
        "manateeclerk.com",
        "votemanatee.gov",
        "manatee.k12.fl.us",
      ],
    });

    if (!response.results || response.results.length === 0) {
      console.log("[Exa Enrichment] No results found");
      return {
        status: "SUCCESS",
        data: {
          summaryMarkdown: "No public profiles or information found for this lead.",
          sources: [],
          profilesFound: 0,
        },
        provenance: {
          ...baseProvenance,
          confidence: 0.3,
        },
      };
    }

    // Process results
    const sources = response.results.map((result) => ({
      url: result.url || "",
      title: result.title ?? undefined,
      snippet: result.text?.substring(0, 200),
    }));

    // Build summary
    const summaryParts: string[] = [];
    summaryParts.push(`Found ${response.results.length} potential matches:`);
    summaryParts.push("");

    for (const result of response.results) {
      if (result.title) {
        summaryParts.push(`- **${result.title}**`);
        if (result.url) {
          summaryParts.push(`  Source: ${result.url}`);
        }
        if (result.text) {
          const snippet = result.text.substring(0, 150).replace(/\n/g, " ").trim();
          summaryParts.push(`  ${snippet}...`);
        }
        summaryParts.push("");
      }
    }

    const summaryMarkdown = summaryParts.join("\n");

    // Calculate confidence based on result quality
    let confidence = 0.5;
    if (response.results.length >= 3) confidence += 0.2;
    if (response.results.some((r) => r.title?.toLowerCase().includes(params.name?.toLowerCase() || ""))) {
      confidence += 0.2;
    }

    console.log(`[Exa Enrichment] Found ${response.results.length} results`);

    return {
      status: "SUCCESS",
      data: {
        summaryMarkdown,
        sources,
        profilesFound: response.results.length,
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
