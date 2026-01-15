/**
 * Exa Search Result Matching
 * 
 * Scores how well a search result matches the lead's identity.
 * Used to filter out irrelevant results and rank relevant ones.
 */

import type { ExaSourceCategory } from "./categorize";

export interface LeadIdentity {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  company?: string;
}

export interface MatchResult {
  score: number;           // 0 to 1
  reasons: string[];       // Why it matched
  extracted: {
    emails: string[];
    phones: string[];
    locations: string[];
    personNameMentions: string[];
  };
}

/**
 * Normalize a name for comparison (lowercase, remove extra spaces, handle common variations)
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .trim();
}

/**
 * Extract first and last name from a full name
 */
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  };
}

/**
 * Normalize phone number to digits only
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Extract emails from text
 */
function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(emailRegex) || [])].map(e => e.toLowerCase());
}

/**
 * Extract phone numbers from text
 */
function extractPhones(text: string): string[] {
  // Match various phone formats
  const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)?[2-9]\d{2}[-.\s]?\d{4}/g;
  const matches = text.match(phoneRegex) || [];
  return [...new Set(matches.map(p => normalizePhone(p)).filter(p => p.length >= 10))];
}

/**
 * Extract location mentions from text
 */
function extractLocations(text: string, targetLocations: string[]): string[] {
  const found: string[] = [];
  const lowerText = text.toLowerCase();
  
  for (const location of targetLocations) {
    if (lowerText.includes(location.toLowerCase())) {
      found.push(location);
    }
  }
  
  // Also look for Florida ZIP codes (start with 32, 33, 34)
  const zipRegex = /\b(32\d{3}|33\d{3}|34\d{3})\b/g;
  const zips = text.match(zipRegex) || [];
  found.push(...zips);
  
  return [...new Set(found)];
}

/**
 * Extract name mentions from text
 */
function extractNameMentions(text: string, leadName: string): string[] {
  const mentions: string[] = [];
  const { firstName, lastName } = parseFullName(leadName);
  const lowerText = text.toLowerCase();
  
  // Check for full name
  if (lowerText.includes(normalizeName(leadName))) {
    mentions.push(leadName);
  }
  
  // Check for variations
  if (firstName && lastName) {
    // "Last, First" format
    if (lowerText.includes(`${lastName.toLowerCase()}, ${firstName.toLowerCase()}`)) {
      mentions.push(`${lastName}, ${firstName}`);
    }
    // "F. Last" format
    if (lowerText.includes(`${firstName[0].toLowerCase()}. ${lastName.toLowerCase()}`)) {
      mentions.push(`${firstName[0]}. ${lastName}`);
    }
  }
  
  return mentions;
}

/**
 * Score how well a document matches a lead's identity
 */
export function scoreMatchToLead(params: {
  lead: LeadIdentity;
  doc: {
    url: string;
    title?: string;
    text?: string;
    category: ExaSourceCategory;
    domain: string;
  };
}): MatchResult {
  const { lead, doc } = params;
  const reasons: string[] = [];
  let score = 0;
  
  // Combine title and text for searching
  const combinedText = [doc.title || "", doc.text || ""].join(" ");
  const lowerText = combinedText.toLowerCase();
  const lowerTitle = (doc.title || "").toLowerCase();
  
  // Extract data from the document
  const extractedEmails = extractEmails(combinedText);
  const extractedPhones = extractPhones(combinedText);
  
  // Build location tokens to look for
  const locationTokens: string[] = [];
  if (lead.city) locationTokens.push(lead.city);
  if (lead.state) locationTokens.push(lead.state);
  if (lead.zipCode) locationTokens.push(lead.zipCode);
  // Add Manatee County area locations
  locationTokens.push("Bradenton", "Manatee", "Palmetto", "Lakewood Ranch", "FL", "Florida");
  
  const extractedLocations = extractLocations(combinedText, locationTokens);
  const extractedNameMentions = lead.name ? extractNameMentions(combinedText, lead.name) : [];
  
  // --- Scoring signals ---
  
  // STRONG: Email exact match (+0.35)
  if (lead.email && extractedEmails.includes(lead.email.toLowerCase())) {
    score += 0.35;
    reasons.push("Email match found");
  }
  
  // STRONG: Phone match (+0.30)
  if (lead.phone) {
    const normalizedLeadPhone = normalizePhone(lead.phone);
    if (extractedPhones.some(p => p.includes(normalizedLeadPhone) || normalizedLeadPhone.includes(p))) {
      score += 0.30;
      reasons.push("Phone match found");
    }
  }
  
  // MEDIUM-STRONG: Full name in title (+0.25)
  if (lead.name && lowerTitle.includes(normalizeName(lead.name))) {
    score += 0.25;
    reasons.push("Full name in title");
  }
  // MEDIUM: Full name in text (+0.15)
  else if (lead.name && lowerText.includes(normalizeName(lead.name))) {
    score += 0.15;
    reasons.push("Full name in content");
  }
  
  // MEDIUM: First + Last name both present (+0.12)
  const { firstName, lastName } = lead.name ? parseFullName(lead.name) : { firstName: "", lastName: "" };
  if (firstName && lastName && firstName.length > 1 && lastName.length > 1) {
    const hasFirst = lowerText.includes(firstName.toLowerCase());
    const hasLast = lowerText.includes(lastName.toLowerCase());
    if (hasFirst && hasLast && lead.name && !lowerText.includes(normalizeName(lead.name))) {
      score += 0.12;
      reasons.push("First and last name present");
    }
  }
  
  // MEDIUM: Location match in Manatee County area (+0.10)
  const hasLocalLocation = extractedLocations.some(loc => 
    ["bradenton", "manatee", "palmetto", "lakewood ranch"].includes(loc.toLowerCase()) ||
    loc.startsWith("34") // Manatee County ZIP codes
  );
  if (hasLocalLocation) {
    score += 0.10;
    reasons.push("Local area mentioned");
  }
  
  // MEDIUM: ZIP code match (+0.08)
  if (lead.zipCode && lowerText.includes(lead.zipCode)) {
    score += 0.08;
    reasons.push("ZIP code match");
  }

  // STRONG: Company name match (+0.30 in title, +0.20 in text)
  // Very important for finding company websites and business listings
  if (lead.company) {
    const normalizedCompany = lead.company.toLowerCase().trim();
    // Check for exact company name or significant portion
    if (lowerTitle.includes(normalizedCompany)) {
      score += 0.30;
      reasons.push("Company name in title");
    } else if (lowerText.includes(normalizedCompany)) {
      score += 0.20;
      reasons.push("Company name in content");
    }
    // Also check URL for company name (common for company websites)
    const normalizedUrl = doc.url.toLowerCase();
    const companySlug = normalizedCompany.replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
    if (normalizedUrl.includes(companySlug) || normalizedUrl.includes(normalizedCompany.replace(/\s+/g, "-"))) {
      score += 0.15;
      reasons.push("Company name in URL");
    }
  }

  // BONUS: Category-based adjustments
  if (doc.category === "LICENSE_REGISTRY" || doc.category === "BUSINESS_REGISTRY") {
    // These are high-value sources, slight bonus
    score += 0.05;
    reasons.push("Official registry source");
  }
  
  if (doc.category === "PROFESSIONAL_PROFILE" || doc.category === "SOCIAL_PROFILE") {
    // Profile pages are more likely to be about the person
    score += 0.03;
  }

  if (doc.category === "BUSINESS_LISTING" || doc.category === "COMPANY_WEBSITE") {
    // Business listings are high-value for company research
    score += 0.05;
    reasons.push("Business listing source");
  }

  // NEGATIVE: People directory with weak match
  if (doc.category === "PEOPLE_DIRECTORY" && score < 0.4) {
    score *= 0.5; // Heavily penalize weak people directory matches
    reasons.push("People directory (low confidence)");
  }
  
  // NEGATIVE: Location mismatch (different state, not Florida)
  const hasNonFloridaState = /\b(CA|NY|TX|AZ|NV|WA|OR|CO|GA|NC|VA|PA|OH|IL|MI|MA)\b/.test(combinedText) &&
                            !lowerText.includes("florida") && !lowerText.includes(" fl ");
  if (hasNonFloridaState && score > 0) {
    score *= 0.7;
    reasons.push("Out-of-state location");
  }
  
  // Cap score at 1.0
  score = Math.min(score, 1.0);
  
  return {
    score,
    reasons,
    extracted: {
      emails: extractedEmails,
      phones: extractedPhones,
      locations: extractedLocations,
      personNameMentions: extractedNameMentions,
    },
  };
}

/**
 * Default thresholds for filtering results
 *
 * NOTE: Thresholds are intentionally low to avoid missing valuable results.
 * For real estate leads, showing more results is better than missing profiles.
 */
export const MATCH_THRESHOLDS = {
  /** Minimum score to be included as a public profile */
  PROFILE_MIN: 0.20,
  /** Minimum score to be included as web research */
  WEB_RESEARCH_MIN: 0.15,
  /** Score above which a result is considered high confidence */
  HIGH_CONFIDENCE: 0.50,
  /** People directories need higher score to be shown */
  PEOPLE_DIRECTORY_MIN: 0.60,
  /** High-value domains (brokerages, agent sites) get auto-included above this */
  HIGH_VALUE_DOMAIN_MIN: 0.10,
};

/**
 * Check if a result should be included based on category and score
 */
export function shouldIncludeResult(
  category: ExaSourceCategory,
  score: number
): { include: boolean; asProfile: boolean } {
  // People directories need high confidence
  if (category === "PEOPLE_DIRECTORY") {
    return {
      include: score >= MATCH_THRESHOLDS.PEOPLE_DIRECTORY_MIN,
      asProfile: false,
    };
  }

  // High-value profile categories - be very lenient
  const highValueCategories: ExaSourceCategory[] = [
    "REAL_ESTATE_PROFILE",
    "LICENSE_REGISTRY",
    "BUSINESS_REGISTRY",
    "BUSINESS_LISTING",
    "COMPANY_WEBSITE",
  ];

  if (highValueCategories.includes(category)) {
    return {
      include: score >= MATCH_THRESHOLDS.HIGH_VALUE_DOMAIN_MIN,
      asProfile: score >= MATCH_THRESHOLDS.HIGH_VALUE_DOMAIN_MIN,
    };
  }

  // Social/professional profiles
  const profileCategories: ExaSourceCategory[] = [
    "SOCIAL_PROFILE",
    "PROFESSIONAL_PROFILE",
  ];

  if (profileCategories.includes(category)) {
    return {
      include: score >= MATCH_THRESHOLDS.PROFILE_MIN,
      asProfile: score >= MATCH_THRESHOLDS.PROFILE_MIN,
    };
  }

  // News and other
  return {
    include: score >= MATCH_THRESHOLDS.WEB_RESEARCH_MIN,
    asProfile: false,
  };
}
