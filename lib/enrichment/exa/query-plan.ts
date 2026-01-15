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
import type { ExaQueryTask } from "./types";

// Configuration (can be moved to env vars)
const DEFAULT_NUM_RESULTS = 5;
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
 * Extract city from an address string
 */
function extractCity(address: string): string | null {
  // Look for common patterns like "City, FL" or "City, State ZIP"
  const match = address.match(/([A-Za-z\s]+),\s*(?:FL|Florida)/i);
  if (match) {
    return match[1].trim();
  }
  // Check for known Manatee County cities
  const knownCities = ["Bradenton", "Palmetto", "Lakewood Ranch", "Myakka City", "Ellenton", "Parrish"];
  for (const city of knownCities) {
    if (address.toLowerCase().includes(city.toLowerCase())) {
      return city;
    }
  }
  return null;
}

/**
 * Build the query plan for a lead
 * 
 * Strategy:
 * 1. General identity search (name + location, broad but filtered)
 * 2. Florida license registry search (high-value, targeted)
 * 3. Florida business registry search (high-value, targeted)
 * 4. Social profile search (optional, can be noisy)
 */
export function buildExaQueryPlan(params: QueryPlanParams): ExaQueryTask[] {
  const tasks: ExaQueryTask[] = [];
  const { name, email, phone, address, location } = params;
  
  // Extract useful components
  const parsedName = name ? parseName(name) : null;
  const city = address ? extractCity(address) : null;
  const locationContext = location || city || "Bradenton FL";
  
  // Skip if no identifiable information
  if (!name && !email && !phone) {
    return tasks;
  }
  
  // --- Task 1: General Identity Search ---
  // Broad search for the person, heavily filtered to remove noise
  if (name) {
    const generalQuery = email
      ? `"${name}" "${email}"`  // Include email if available for precision
      : `"${name}" ${locationContext}`;
    
    tasks.push({
      intent: "identity_general",
      query: generalQuery,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: DEFAULT_NUM_RESULTS,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }
  
  // --- Task 2: Florida License Registry Search ---
  // High-value: find professional licenses (RE agent, contractor, etc.)
  if (name && parsedName) {
    // DBPR uses "LastName, FirstName" format in many cases
    const licenseQuery = `"${parsedName.lastName}" "${parsedName.firstName}" Florida license`;
    
    tasks.push({
      intent: "license_registry_fl",
      query: licenseQuery,
      includeDomains: INCLUDE_DOMAINS_LICENSE_FL,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 3,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }
  
  // --- Task 3: Florida Business Registry Search ---
  // High-value: find business ownership/officer roles
  if (name) {
    const sunbizQuery = `"${name}" Florida corporation LLC`;
    
    tasks.push({
      intent: "business_registry_fl",
      query: sunbizQuery,
      includeDomains: INCLUDE_DOMAINS_BUSINESS_REGISTRY_FL,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 3,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }
  
  // --- Task 4: Social Profiles Search (Optional) ---
  // Can be noisy but sometimes finds LinkedIn/Facebook profiles
  if (name && parsedName?.lastName) {
    // More specific query to reduce noise
    const socialQuery = `"${name}" ${locationContext} profile`;
    
    tasks.push({
      intent: "social_profiles",
      query: socialQuery,
      includeDomains: INCLUDE_DOMAINS_SOCIAL_PROFILES,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 3,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }
  
  // --- Task 5: Email-specific Search (if email available) ---
  // Very high precision when email is in public content
  if (email && name) {
    tasks.push({
      intent: "identity_email",
      query: `"${email}"`,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 3,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  // --- Task 6: Company/Team Website Search (if company provided) ---
  // High-value: finds team websites, brokerage profiles
  const { company } = params;
  if (company && name) {
    // Search for company name + person name together
    const companyQuery = `"${company}" "${name}"`;

    tasks.push({
      intent: "company_website",
      query: companyQuery,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 5,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });

    // Also search for just the company name to find their website directly
    const companyOnlyQuery = `"${company}" real estate`;

    tasks.push({
      intent: "company_direct",
      query: companyOnlyQuery,
      excludeDomains: EXA_GLOBAL_EXCLUDE_DOMAINS,
      numResults: 3,
      maxCharacters: DEFAULT_MAX_CHARACTERS,
    });
  }

  return tasks;
}

/**
 * Get a summary of the query plan for logging
 */
export function summarizeQueryPlan(tasks: ExaQueryTask[]): string {
  if (tasks.length === 0) {
    return "No queries planned (insufficient lead data)";
  }
  
  const intents = tasks.map(t => t.intent).join(", ");
  return `${tasks.length} queries planned: ${intents}`;
}
