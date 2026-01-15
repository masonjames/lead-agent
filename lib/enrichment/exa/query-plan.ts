/**
 * Exa Query Plan Builder
 *
 * Builds targeted search queries for lead enrichment.
 * Focuses on actionable, person-specific results for real estate leads.
 */

import {
  EXA_GLOBAL_EXCLUDE_DOMAINS,
  INCLUDE_DOMAINS_LICENSE_FL,
  INCLUDE_DOMAINS_BUSINESS_REGISTRY_FL,
  INCLUDE_DOMAINS_SOCIAL_PROFILES,
} from "./domains";
import { deriveGeoContext, type GeoContext } from "./geo";
import type { ExaQueryTask } from "./types";

// Configuration (can be moved to env vars)
// Increased default results to surface more potential matches
const DEFAULT_NUM_RESULTS = Number(process.env.EXA_DEFAULT_NUM_RESULTS ?? 10);
const SOCIAL_NUM_RESULTS = Number(process.env.EXA_SOCIAL_NUM_RESULTS ?? 8);
const DEFAULT_MAX_CHARACTERS = 1500;

export interface QueryPlanParams {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  location?: string;
  company?: string;
}

/**
 * Parse a name into first and last components
 */
function parseName(fullName: string): { firstName: string; lastName: string } {
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
 * Result interface with geo context for callers
 */
export interface QueryPlanResult {
  tasks: ExaQueryTask[];
  geo: GeoContext;
}

/**
 * Build the query plan for a lead
 *
 * Strategy:
 * 1. General identity search (name + location, broad but filtered)
 * 2. Targeted LinkedIn/Facebook searches (site-specific)
 * 3. Florida license registry search (high-value, targeted)
 * 4. Florida business registry search (high-value, targeted)
 * 5. Social profile search (general)
 * 6. Company/Business search (if company provided)
 *
 * Returns both the tasks and the derived geo context for use in scoring.
 */
export function buildExaQueryPlan(params: QueryPlanParams): QueryPlanResult {
  const tasks: ExaQueryTask[] = [];
  const { name, email, phone, address, location, company } = params;

  // Derive geographic context using the new geo module
  const geo = deriveGeoContext({ address, location, defaultState: "FL" });
  const locationContext = geo.label || location || "Florida";

  // Extract useful components
  const parsedName = name ? parseName(name) : null;

  // Skip if no identifiable information
  if (!name && !email && !phone) {
    return { tasks, geo };
  }

  // --- Task 1: General Identity Search ---
  // Broad search for the person, heavily filtered to remove noise
  if (name) {
    const generalQuery = email
      ? `"${name}" "${email}"` // Include email if available for precision
      : `"${name}" ${locationContext}`;

    tasks.push({
      intent: "identity_general",
      query: generalQuery,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: DEFAULT_NUM_RESULTS,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  // --- Task 2: Targeted LinkedIn Search ---
  // Highly valuable for professional profiles
  if (name && parsedName?.lastName) {
    // LinkedIn with name + company + location for better targeting
    const linkedinQuery = company
      ? `site:linkedin.com/in "${name}" "${company}"`
      : `site:linkedin.com/in "${name}" ${locationContext}`;

    tasks.push({
      intent: "linkedin_profile",
      query: linkedinQuery,
      includeDomains: ["linkedin.com"],
      numResults: SOCIAL_NUM_RESULTS,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });

    // Also search LinkedIn with just name + geo (catches profiles without company)
    if (company) {
      tasks.push({
        intent: "linkedin_profile_geo",
        query: `site:linkedin.com/in "${name}" ${locationContext}`,
        includeDomains: ["linkedin.com"],
        numResults: SOCIAL_NUM_RESULTS,
        maxCharacters: DEFAULT_MAX_CHARACTERS,
      });
    }
  }

  // --- Task 3: Targeted Facebook Search ---
  // Can find personal profiles
  if (name && parsedName?.lastName) {
    // Facebook with name + location
    const facebookQuery = company
      ? `site:facebook.com "${name}" "${company}"`
      : `site:facebook.com "${name}" ${locationContext}`;

    tasks.push({
      intent: "facebook_profile",
      query: facebookQuery,
      includeDomains: ["facebook.com"],
      numResults: SOCIAL_NUM_RESULTS,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });

    // Also try with geo if company was used
    if (company && geo.city) {
      tasks.push({
        intent: "facebook_profile_geo",
        query: `site:facebook.com "${name}" ${geo.city}`,
        includeDomains: ["facebook.com"],
        numResults: 5,
        maxCharacters: DEFAULT_MAX_CHARACTERS,
      });
    }
  }

  // --- Task 4: Florida License Registry Search ---
  // High-value: find professional licenses (RE agent, contractor, etc.)
  if (name && parsedName) {
    // DBPR uses "LastName, FirstName" format in many cases
    const licenseQuery = `"${parsedName.lastName}" "${parsedName.firstName}" Florida license`;

    tasks.push({
      intent: "license_registry_fl",
      query: licenseQuery,
      includeDomains: INCLUDE_DOMAINS_LICENSE_FL,
      numResults: 5,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  // --- Task 5: Florida Business Registry Search ---
  // High-value: find business ownership/officer roles
  if (name) {
    const sunbizQuery = `"${name}" Florida corporation LLC`;

    tasks.push({
      intent: "business_registry_fl",
      query: sunbizQuery,
      includeDomains: INCLUDE_DOMAINS_BUSINESS_REGISTRY_FL,
      numResults: 5,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  // --- Task 6: General Social Profiles Search ---
  // Catch-all for other social platforms
  if (name && parsedName?.lastName) {
    const socialQuery = `"${name}" ${locationContext} profile`;

    tasks.push({
      intent: "social_profiles_general",
      query: socialQuery,
      includeDomains: INCLUDE_DOMAINS_SOCIAL_PROFILES,
      numResults: SOCIAL_NUM_RESULTS,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  // --- Task 7: Email-specific Search (if email available) ---
  // Very high precision when email is in public content
  if (email && name) {
    tasks.push({
      intent: "identity_email",
      query: `"${email}"`,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 5,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  // --- Task 8: Company/Business Search (if company provided) ---
  // High-value: finds company websites, business listings, team pages
  if (company) {
    // Search for company name + location to find their website
    const companyLocationQuery = `"${company}" ${locationContext}`;

    tasks.push({
      intent: "company_website",
      query: companyLocationQuery,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 5,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });

    // Search for company on business listing/review sites
    const companyListingQuery = `"${company}" site:yelp.com OR site:bbb.org OR site:google.com/maps`;

    tasks.push({
      intent: "company_listing",
      query: companyListingQuery,
      numResults: 5,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });

    // If we also have a name, search for person at company
    if (name) {
      const personAtCompanyQuery = `"${name}" "${company}"`;

      tasks.push({
        intent: "person_at_company",
        query: personAtCompanyQuery,
        excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
        numResults: 5,
        maxCharacters: DEFAULT_MAX_CHARACTERS,
      });

      // Name + company + industry/role hint (helps find brokerage team pages)
      if (parsedName?.lastName) {
        tasks.push({
          intent: "person_at_company_role",
          query: `"${name}" "${company}" (agent OR realtor OR broker OR sales)`,
          excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
          numResults: 5,
          maxCharacters: DEFAULT_MAX_CHARACTERS,
        });
      }
    }
  }

  return { tasks, geo };
}

/**
 * Get a summary of the query plan for logging
 */
export function summarizeQueryPlan(result: QueryPlanResult): string {
  const { tasks, geo } = result;
  if (tasks.length === 0) {
    return "No queries planned (insufficient lead data)";
  }

  const intents = tasks.map((t) => t.intent).join(", ");
  const geoInfo = geo.label ? ` [geo: ${geo.label}]` : "";
  return `${tasks.length} queries planned: ${intents}${geoInfo}`;
}
