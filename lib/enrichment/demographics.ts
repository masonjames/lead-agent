/**
 * Demographics Enrichment Service
 *
 * Provides demographic insights based on location (zip code, city).
 * Uses static census data for Manatee County (instant, reliable)
 * with Exa AI fallback for other areas.
 */

import { exa } from "@/lib/exa";
import {
  getZipCodeDemographics,
  isManateeCountyZip,
  isSarasotaCountyZip,
  getCountyForZip,
  formatIncome,
  formatHomeValue,
  MANATEE_COUNTY_DEFAULTS,
  SARASOTA_COUNTY_DEFAULTS,
  type ZipCodeDemographics,
} from "./demographics-data";

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
    method: "search_inference" | "static_lookup";
    confidence: number;
    timestamp: string;
  };
}

/**
 * Convert ZIP code lookup data to DemographicInsights format
 */
function zipDataToInsights(zipData: ZipCodeDemographics): DemographicInsights {
  return {
    medianHouseholdIncome: formatIncome(zipData.medianHouseholdIncome),
    medianHomeValue: formatHomeValue(zipData.medianHomeValue),
    incomeProxy: zipData.incomeProxy,
    populationDensity: zipData.populationDensity || "suburban",
    lifestyleIndicators: zipData.characteristics,
  };
}

/**
 * Get demographic insights for a location
 *
 * Strategy:
 * 1. For Manatee County ZIP codes: Use instant static lookup (100% reliable)
 * 2. For other areas: Fall back to Exa search (variable results)
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

  // === PRIORITY 1: Static lookup for Manatee County ZIP codes ===
  if (params.zipCode) {
    const zipData = getZipCodeDemographics(params.zipCode);

    if (zipData) {
      console.log(
        `[Demographics Enrichment] Using cached census data for ZIP ${params.zipCode} (${zipData.city} - ${zipData.area || ""})`
      );

      return {
        status: "SUCCESS",
        data: zipDataToInsights(zipData),
        provenance: {
          ...baseProvenance,
          method: "static_lookup" as const,
          confidence: 0.95, // High confidence for census data
        },
      };
    }

    // Check if it's a known county ZIP we don't have specific data for
    const county = getCountyForZip(params.zipCode);
    if (county) {
      const defaults = county === "Manatee" ? MANATEE_COUNTY_DEFAULTS : SARASOTA_COUNTY_DEFAULTS;
      console.log(
        `[Demographics Enrichment] ZIP ${params.zipCode} is in ${county} County but no specific data, using county defaults`
      );

      return {
        status: "SUCCESS",
        data: zipDataToInsights(defaults),
        provenance: {
          ...baseProvenance,
          method: "static_lookup" as const,
          confidence: 0.7,
        },
      };
    }
  }

  // === PRIORITY 2: Exa search for non-Manatee County areas ===
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
  console.log(`[Demographics Enrichment] Searching Exa for: ${query}`);

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

    // Use regional defaults if no data found
    if (Object.keys(insights).length === 0) {
      // Sarasota-Manatee area average data (2023-2024 estimates)
      insights.medianHouseholdIncome = "$65,000 (regional avg)";
      insights.medianHomeValue = "$380,000 (regional avg)";
      insights.incomeProxy = "MEDIUM";

      console.log("[Demographics Enrichment] Using regional defaults");
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
        medianHouseholdIncome: "$65,000 (regional est.)",
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
