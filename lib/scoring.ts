/**
 * Lead scoring module
 * Calculates a 0-100 score based on enrichment data
 */

import type { BusinessStatus } from "./types";

export interface ScoreBreakdown {
  /** Overall score 0-100 */
  score: number;
  /** Tier based on score */
  tier: "HOT" | "WARM" | "NURTURE" | "COLD";
  /** Reasons explaining the score */
  reasons: string[];
  /** Individual component scores */
  components: {
    contactQuality: number; // 0-25
    propertyMatch: number; // 0-30
    financialSignals: number; // 0-25
    engagementSignals: number; // 0-20
  };
}

/** Minimal property info for scoring - simpler than full PropertyDetails */
export interface ScoringProperty {
  address?: string;
  yearBuilt?: number;
  bedrooms?: number;
  assessedValue?: number;
  marketValue?: number;
}

export interface ScoringInput {
  // Contact info
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasAddress?: boolean;
  hasFullName?: boolean;

  // Property data - accepts simplified property for scoring
  property?: ScoringProperty | null;
  propertyInTargetArea?: boolean;

  // Financial signals
  estimatedHomeValue?: number;
  medianIncomeZip?: number;
  hasRecentSale?: boolean;
  yearsOwned?: number;

  // Engagement signals
  formCompleteness?: number; // 0-1
  isLocalArea?: boolean;
  hasPublicProfile?: boolean;
}

/**
 * Calculate lead score from enrichment data
 */
export function calculateLeadScore(input: ScoringInput): ScoreBreakdown {
  const reasons: string[] = [];
  const components = {
    contactQuality: 0,
    propertyMatch: 0,
    financialSignals: 0,
    engagementSignals: 0,
  };

  // --- Contact Quality (0-25) ---
  if (input.hasEmail) {
    components.contactQuality += 8;
    reasons.push("Valid email provided");
  }
  if (input.hasPhone) {
    components.contactQuality += 8;
    reasons.push("Phone number provided");
  }
  if (input.hasFullName) {
    components.contactQuality += 5;
    reasons.push("Full name provided");
  }
  if (input.hasAddress) {
    components.contactQuality += 4;
    reasons.push("Address provided");
  }

  // --- Property Match (0-30) ---
  if (input.property) {
    components.propertyMatch += 10;
    reasons.push("Property found in PAO records");

    if (input.property.assessedValue && input.property.assessedValue > 200000) {
      components.propertyMatch += 5;
      reasons.push("Property assessed value > $200k");
    }
    if (input.property.assessedValue && input.property.assessedValue > 400000) {
      components.propertyMatch += 5;
      reasons.push("Property assessed value > $400k");
    }

    if (input.property.yearBuilt) {
      const age = new Date().getFullYear() - input.property.yearBuilt;
      if (age < 20) {
        components.propertyMatch += 5;
        reasons.push("Newer construction (< 20 years)");
      } else if (age > 40) {
        components.propertyMatch += 3;
        reasons.push("Older home may need updates");
      }
    }

    if (input.property.bedrooms && input.property.bedrooms >= 3) {
      components.propertyMatch += 3;
      reasons.push("3+ bedroom property");
    }
  }

  if (input.propertyInTargetArea) {
    components.propertyMatch += 5;
    reasons.push("Property in target service area");
  }

  // --- Financial Signals (0-25) ---
  if (input.estimatedHomeValue) {
    if (input.estimatedHomeValue > 500000) {
      components.financialSignals += 10;
      reasons.push("High-value property (>$500k)");
    } else if (input.estimatedHomeValue > 300000) {
      components.financialSignals += 6;
      reasons.push("Mid-range property ($300k-$500k)");
    } else if (input.estimatedHomeValue > 150000) {
      components.financialSignals += 3;
      reasons.push("Entry-level property ($150k-$300k)");
    }
  }

  if (input.medianIncomeZip) {
    if (input.medianIncomeZip > 100000) {
      components.financialSignals += 8;
      reasons.push("High-income zip code (>$100k median)");
    } else if (input.medianIncomeZip > 70000) {
      components.financialSignals += 5;
      reasons.push("Above-average income zip code");
    } else if (input.medianIncomeZip > 50000) {
      components.financialSignals += 2;
      reasons.push("Average income zip code");
    }
  }

  if (input.hasRecentSale) {
    components.financialSignals += 5;
    reasons.push("Recent sale activity on property");
  }

  if (input.yearsOwned !== undefined) {
    if (input.yearsOwned > 10) {
      components.financialSignals += 4;
      reasons.push("Long-term owner (10+ years) - may have equity");
    } else if (input.yearsOwned > 5) {
      components.financialSignals += 2;
      reasons.push("Mid-term owner (5-10 years)");
    }
  }

  // --- Engagement Signals (0-20) ---
  if (input.formCompleteness !== undefined) {
    const completenessPoints = Math.round(input.formCompleteness * 8);
    components.engagementSignals += completenessPoints;
    if (input.formCompleteness > 0.8) {
      reasons.push("High form completeness (>80%)");
    }
  }

  if (input.isLocalArea) {
    components.engagementSignals += 6;
    reasons.push("Lead is in local service area");
  }

  if (input.hasPublicProfile) {
    components.engagementSignals += 6;
    reasons.push("Public profile found (verified identity)");
  }

  // Calculate total score
  const score = Math.min(
    100,
    components.contactQuality +
      components.propertyMatch +
      components.financialSignals +
      components.engagementSignals
  );

  // Determine tier
  let tier: ScoreBreakdown["tier"];
  if (score >= 70) {
    tier = "HOT";
  } else if (score >= 50) {
    tier = "WARM";
  } else if (score >= 30) {
    tier = "NURTURE";
  } else {
    tier = "COLD";
  }

  return {
    score,
    tier,
    reasons,
    components,
  };
}

/**
 * Map score tier to business status
 */
export function tierToBusinessStatus(
  tier: ScoreBreakdown["tier"],
  isLocal: boolean
): BusinessStatus {
  if (!isLocal) {
    return "NOT_LOCAL";
  }
  switch (tier) {
    case "HOT":
      return "HOT";
    case "WARM":
      return "WARM";
    case "NURTURE":
      return "NURTURE";
    case "COLD":
      return "UNKNOWN";
  }
}

