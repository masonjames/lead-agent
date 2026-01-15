/**
 * Exa GeoContext Derivation
 *
 * Converts lead address/location into structured geo context for:
 * - Query construction (better location targeting)
 * - Match scoring (improved geo-based relevance)
 */

import { normalizeAddressForPao } from "@/lib/realestate/address/normalize";

/**
 * Structured geographic context for lead enrichment
 */
export interface GeoContext {
  /** City name (e.g., "Bradenton") */
  city?: string;
  /** State abbreviation (e.g., "FL") */
  state?: string;
  /** ZIP code (e.g., "34205") */
  zipCode?: string;
  /** All location tokens for matching (city, state, zip, variations) */
  tokens: string[];
  /** Human-readable location label (e.g., "Bradenton, FL 34205") */
  label?: string;
  /** County if known */
  county?: string;
}

/**
 * Known cities in Manatee and Sarasota counties
 * Used for fallback matching and expanding geo context
 */
const MANATEE_COUNTY_CITIES = [
  "Bradenton",
  "Palmetto",
  "Lakewood Ranch",
  "Ellenton",
  "Parrish",
  "Myakka City",
  "Longboat Key",
];

const SARASOTA_COUNTY_CITIES = [
  "Sarasota",
  "Venice",
  "North Port",
  "Osprey",
  "Nokomis",
  "Englewood",
  "Siesta Key",
];

const SERVICE_AREA_CITIES = [...MANATEE_COUNTY_CITIES, ...SARASOTA_COUNTY_CITIES];

/**
 * State name mappings
 */
const STATE_NAMES: Record<string, string> = {
  FL: "Florida",
  CA: "California",
  TX: "Texas",
  NY: "New York",
  AZ: "Arizona",
  // Add more as needed
};

/**
 * Derive geographic context from lead address and location info
 *
 * @param params.address - Physical address (e.g., "123 Main St, Bradenton, FL 34205")
 * @param params.location - Location hint (e.g., "Manatee County, Florida")
 * @param params.defaultState - Default state if not found (default: "FL")
 */
export function deriveGeoContext(params: {
  address?: string;
  location?: string;
  defaultState?: string;
}): GeoContext {
  const { address, location, defaultState = "FL" } = params;
  const tokens: string[] = [];

  let city: string | undefined;
  let state: string | undefined;
  let zipCode: string | undefined;
  let county: string | undefined;

  // Extract components from address using the normalize utility
  if (address) {
    const normalized = normalizeAddressForPao(address);
    city = normalized.city;
    state = normalized.state;
    zipCode = normalized.zipCode;

    // Add extracted components to tokens
    if (city) tokens.push(city);
    if (state) {
      tokens.push(state);
      // Add full state name
      if (STATE_NAMES[state]) {
        tokens.push(STATE_NAMES[state]);
      }
    }
    if (zipCode) tokens.push(zipCode);
  }

  // Extract from location hint if provided
  if (location) {
    const lowerLocation = location.toLowerCase();

    // Check for county mentions
    if (lowerLocation.includes("manatee")) {
      county = "Manatee";
      tokens.push("Manatee", "Manatee County");
    } else if (lowerLocation.includes("sarasota")) {
      county = "Sarasota";
      tokens.push("Sarasota", "Sarasota County");
    }

    // Check for state in location if not already found
    if (!state) {
      if (lowerLocation.includes("florida") || lowerLocation.includes(" fl")) {
        state = "FL";
        tokens.push("FL", "Florida");
      }
    }

    // Check for known cities in location if city not found
    if (!city) {
      for (const knownCity of SERVICE_AREA_CITIES) {
        if (lowerLocation.includes(knownCity.toLowerCase())) {
          city = knownCity;
          tokens.push(knownCity);
          break;
        }
      }
    }
  }

  // Apply defaults if still missing
  if (!state && defaultState) {
    state = defaultState;
    tokens.push(state);
    if (STATE_NAMES[state]) {
      tokens.push(STATE_NAMES[state]);
    }
  }

  // Infer county from city if not yet determined
  if (!county && city) {
    if (MANATEE_COUNTY_CITIES.some(c => c.toLowerCase() === city?.toLowerCase())) {
      county = "Manatee";
      tokens.push("Manatee", "Manatee County");
    } else if (SARASOTA_COUNTY_CITIES.some(c => c.toLowerCase() === city?.toLowerCase())) {
      county = "Sarasota";
      tokens.push("Sarasota", "Sarasota County");
    }
  }

  // Add service area cities as fallback tokens if no city found
  // This helps with matching results that mention these cities
  if (!city && (state === "FL" || !state)) {
    // Add common variations for better matching
    tokens.push("Bradenton", "Sarasota", "FL", "Florida");
  }

  // Build label
  let label: string | undefined;
  if (city && state && zipCode) {
    label = `${city}, ${state} ${zipCode}`;
  } else if (city && state) {
    label = `${city}, ${state}`;
  } else if (city) {
    label = city;
  } else if (state) {
    label = STATE_NAMES[state] || state;
  }

  // Deduplicate tokens
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];

  return {
    city,
    state,
    zipCode,
    county,
    tokens: uniqueTokens,
    label,
  };
}

/**
 * Get location tokens for a specific city
 * Useful for targeted queries
 */
export function getCityLocationTokens(city: string): string[] {
  const tokens = [city];

  // Add county if known
  if (MANATEE_COUNTY_CITIES.some(c => c.toLowerCase() === city.toLowerCase())) {
    tokens.push("Manatee", "Manatee County", "FL", "Florida");
  } else if (SARASOTA_COUNTY_CITIES.some(c => c.toLowerCase() === city.toLowerCase())) {
    tokens.push("Sarasota", "Sarasota County", "FL", "Florida");
  }

  return tokens;
}

/**
 * Extract state abbreviations from text
 * Returns array of detected states (for conflict detection)
 */
export function extractStateAbbreviations(text: string): string[] {
  const statePattern = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
  const matches = text.match(statePattern) || [];
  return [...new Set(matches)];
}

/**
 * Check if a result text indicates a conflicting location
 * (i.e., mentions another state without mentioning the target state)
 */
export function hasConflictingLocation(params: {
  text: string;
  targetState?: string;
}): { hasConflict: boolean; conflictingStates: string[] } {
  const { text, targetState = "FL" } = params;
  const lowerText = text.toLowerCase();

  const detectedStates = extractStateAbbreviations(text);

  // If target state is present, no conflict
  if (detectedStates.includes(targetState)) {
    return { hasConflict: false, conflictingStates: [] };
  }

  // Also check for full state name
  const targetStateName = STATE_NAMES[targetState]?.toLowerCase();
  if (targetStateName && lowerText.includes(targetStateName)) {
    return { hasConflict: false, conflictingStates: [] };
  }

  // Filter out the target state and check for conflicts
  const otherStates = detectedStates.filter(s => s !== targetState);

  return {
    hasConflict: otherStates.length > 0,
    conflictingStates: otherStates,
  };
}
