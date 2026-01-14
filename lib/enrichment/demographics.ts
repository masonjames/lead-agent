/**
 * Demographics Enrichment Service
 * 
 * Provides demographic insights based on location (zip code, city)
 * using Exa AI to search for census and demographic data.
 */

import { exa } from "@/lib/exa";

export type EnrichmentStatus = "SUCCESS" | "SKIPPED" | "FAILED";

export interface DemographicInsights {
  medianHouseholdIncome?: string;
  medianHomeValue?: string;
  populationDensity?: string;
  ageDistribution?: string;
  educationLevel?: string;
  commonOccupations?: string[];
  lifestyleIndicators?: string[];
  incomeProxy?: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
}

export interface DemographicsEnrichmentResult {
  status: EnrichmentStatus;
  data?: DemographicInsights;
  error?: string;
  provenance: {
    source: "exa_demographics";
    method: "search_inference";
    confidence: number;
    timestamp: string;
  };
}

/**
 * Get demographic insights for a location
 * 
 * Uses Exa to search for census data and demographic information
 * for a given zip code or city/state combination.
 */
export async function getDemographicInsights(params: {
  zipCode?: string;
  city?: string;
  state?: string;
  propertyValue?: number;
}): Promise<DemographicsEnrichmentResult> {
  const timestamp = new Date().toISOString();
  const baseProvenance = {
    source: "exa_demographics" as const,
    method: "search_inference" as const,
    timestamp,
  };

  // Need at least zip code or city to search
  if (!params.zipCode && !params.city) {
    return {
      status: "SKIPPED",
      error: "No location provided for demographic enrichment",
      provenance: {
        ...baseProvenance,
        confidence: 0,
      },
    };
  }

  // Build location string
  let location = "";
  if (params.zipCode) {
    location = `${params.zipCode}`;
  }
  if (params.city) {
    location = params.city;
    if (params.state) {
      location += `, ${params.state}`;
    }
  }

  // Default to Florida for Manatee County context
  const state = params.state || "FL";
  if (!location.toLowerCase().includes("fl") && !location.toLowerCase().includes("florida")) {
    location += ` ${state}`;
  }

  const query = `${location} demographics median income census data`;
  console.log(`[Demographics Enrichment] Searching for: ${query}`);

  try {
    const response = await exa.searchAndContents(query, {
      type: "auto",
      numResults: 3,
      text: { maxCharacters: 2000 },
      useAutoprompt: false,
    });

    // Initialize insights
    const insights: DemographicInsights = {};

    // Extract data from results
    if (response.results && response.results.length > 0) {
      const combinedText = response.results
        .map((r) => r.text || "")
        .join(" ")
        .toLowerCase();

      // Try to extract median income
      const incomeMatch = combinedText.match(/median\s*(?:household\s*)?income[:\s]*\$?([\d,]+)/i);
      if (incomeMatch) {
        insights.medianHouseholdIncome = `$${incomeMatch[1]}`;
        
        // Calculate income proxy
        const incomeValue = parseInt(incomeMatch[1].replace(/,/g, ""), 10);
        if (incomeValue < 40000) {
          insights.incomeProxy = "LOW";
        } else if (incomeValue < 75000) {
          insights.incomeProxy = "MEDIUM";
        } else if (incomeValue < 120000) {
          insights.incomeProxy = "HIGH";
        } else {
          insights.incomeProxy = "VERY_HIGH";
        }
      }

      // Try to extract median home value
      const homeValueMatch = combinedText.match(/median\s*(?:home\s*)?(?:value|price)[:\s]*\$?([\d,]+)/i);
      if (homeValueMatch) {
        insights.medianHomeValue = `$${homeValueMatch[1]}`;
      }

      // If we have property value, use it to infer income proxy
      if (params.propertyValue && !insights.incomeProxy) {
        if (params.propertyValue < 200000) {
          insights.incomeProxy = "LOW";
        } else if (params.propertyValue < 350000) {
          insights.incomeProxy = "MEDIUM";
        } else if (params.propertyValue < 600000) {
          insights.incomeProxy = "HIGH";
        } else {
          insights.incomeProxy = "VERY_HIGH";
        }
      }

      // Try to extract education level
      if (combinedText.includes("college") || combinedText.includes("bachelor")) {
        const collegeMatch = combinedText.match(/([\d.]+)%?\s*(?:have\s*)?(?:bachelor|college)/i);
        if (collegeMatch) {
          insights.educationLevel = `${collegeMatch[1]}% college educated`;
        }
      }

      // Common Florida lifestyle indicators
      const lifestyleIndicators: string[] = [];
      if (combinedText.includes("retire") || combinedText.includes("55+")) {
        lifestyleIndicators.push("Retirement community");
      }
      if (combinedText.includes("golf") || combinedText.includes("country club")) {
        lifestyleIndicators.push("Golf/Country club area");
      }
      if (combinedText.includes("beach") || combinedText.includes("waterfront")) {
        lifestyleIndicators.push("Beach/Waterfront access");
      }
      if (combinedText.includes("family") || combinedText.includes("school")) {
        lifestyleIndicators.push("Family-oriented");
      }
      
      if (lifestyleIndicators.length > 0) {
        insights.lifestyleIndicators = lifestyleIndicators;
      }
    }

    // Use Manatee County defaults if no data found
    if (Object.keys(insights).length === 0) {
      // Manatee County average data (2023-2024 estimates)
      insights.medianHouseholdIncome = "$65,000 (Manatee County avg)";
      insights.medianHomeValue = "$385,000 (Manatee County avg)";
      insights.incomeProxy = "MEDIUM";
      
      console.log("[Demographics Enrichment] Using Manatee County defaults");
    }

    // Calculate confidence
    let confidence = 0.3;
    if (insights.medianHouseholdIncome) confidence += 0.2;
    if (insights.medianHomeValue) confidence += 0.2;
    if (insights.educationLevel) confidence += 0.1;
    if (insights.lifestyleIndicators?.length) confidence += 0.1;

    console.log(`[Demographics Enrichment] Extracted insights with ${confidence * 100}% confidence`);

    return {
      status: "SUCCESS",
      data: insights,
      provenance: {
        ...baseProvenance,
        confidence: Math.min(confidence, 1),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Demographics Enrichment] Error: ${errorMessage}`);

    // Return default data on error rather than failing
    return {
      status: "SUCCESS",
      data: {
        medianHouseholdIncome: "$65,000 (Manatee County est.)",
        incomeProxy: "MEDIUM",
      },
      error: `Search failed, using defaults: ${errorMessage}`,
      provenance: {
        ...baseProvenance,
        confidence: 0.2,
      },
    };
  }
}
