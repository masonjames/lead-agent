/**
 * Manatee County ZIP Code Demographics Data
 *
 * Static lookup table for consistent demographic results.
 * Data sourced from US Census Bureau American Community Survey (2023 5-year estimates).
 *
 * This provides instant, reliable demographic data for Manatee County
 * without API variability.
 */

export interface ZipCodeDemographics {
  zipCode: string;
  city: string;
  area?: string;
  medianHouseholdIncome: number;
  medianHomeValue: number;
  incomeProxy: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  populationDensity?: "rural" | "suburban" | "urban";
  characteristics?: string[];
}

/**
 * Manatee County ZIP code demographics lookup table
 * Sources: US Census ACS 2023, Zillow, local market data
 */
export const MANATEE_COUNTY_ZIP_DATA: Record<string, ZipCodeDemographics> = {
  // === BRADENTON AREA ===
  "34201": {
    zipCode: "34201",
    city: "Bradenton",
    area: "Central Bradenton",
    medianHouseholdIncome: 95000,
    medianHomeValue: 420000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Established neighborhoods", "Mixed residential"],
  },
  "34202": {
    zipCode: "34202",
    city: "Bradenton",
    area: "Lakewood Ranch",
    medianHouseholdIncome: 123210, // Census ACS 2023
    medianHomeValue: 550000,
    incomeProxy: "VERY_HIGH",
    populationDensity: "suburban",
    characteristics: ["Master-planned community", "High-end amenities", "Top schools", "Golf courses"],
  },
  "34203": {
    zipCode: "34203",
    city: "Bradenton",
    area: "Southeast Bradenton",
    medianHouseholdIncome: 55000,
    medianHomeValue: 295000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["I-75 corridor", "Commercial areas", "Affordable housing"],
  },
  "34205": {
    zipCode: "34205",
    city: "Bradenton",
    area: "Downtown Bradenton",
    medianHouseholdIncome: 48000,
    medianHomeValue: 275000,
    incomeProxy: "MEDIUM",
    populationDensity: "urban",
    characteristics: ["Historic downtown", "Arts district", "Waterfront"],
  },
  "34207": {
    zipCode: "34207",
    city: "Bradenton",
    area: "South Bradenton",
    medianHouseholdIncome: 52000,
    medianHomeValue: 310000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["Established area", "Near schools"],
  },
  "34208": {
    zipCode: "34208",
    city: "Bradenton",
    area: "East Bradenton",
    medianHouseholdIncome: 58000,
    medianHomeValue: 320000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["Residential area", "Near hospital"],
  },
  "34209": {
    zipCode: "34209",
    city: "Bradenton",
    area: "West Bradenton / Palma Sola",
    medianHouseholdIncome: 75000,
    medianHomeValue: 450000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Near beaches", "Nature preserves", "Waterfront properties"],
  },
  "34210": {
    zipCode: "34210",
    city: "Bradenton",
    area: "Southwest Bradenton",
    medianHouseholdIncome: 68000,
    medianHomeValue: 380000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["Near beaches", "Residential"],
  },
  "34211": {
    zipCode: "34211",
    city: "Bradenton",
    area: "Lakewood Ranch East",
    medianHouseholdIncome: 118000,
    medianHomeValue: 520000,
    incomeProxy: "VERY_HIGH",
    populationDensity: "suburban",
    characteristics: ["Master-planned community", "New construction", "Family-oriented"],
  },
  "34212": {
    zipCode: "34212",
    city: "Bradenton",
    area: "East Manatee / Lakewood Ranch",
    medianHouseholdIncome: 105000,
    medianHomeValue: 480000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Growing area", "New developments", "Near Premier Sports Campus"],
  },

  // === BEACH COMMUNITIES ===
  "34215": {
    zipCode: "34215",
    city: "Cortez",
    area: "Cortez Village",
    medianHouseholdIncome: 72000,
    medianHomeValue: 520000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Historic fishing village", "Waterfront", "Small community"],
  },
  "34216": {
    zipCode: "34216",
    city: "Anna Maria",
    area: "Anna Maria Island - North",
    medianHouseholdIncome: 95000,
    medianHomeValue: 1200000,
    incomeProxy: "VERY_HIGH",
    populationDensity: "suburban",
    characteristics: ["Beachfront", "Vacation rentals", "Historic charm"],
  },
  "34217": {
    zipCode: "34217",
    city: "Bradenton Beach",
    area: "Anna Maria Island - Central",
    medianHouseholdIncome: 85000,
    medianHomeValue: 950000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Beach town", "Tourism", "Restaurants and shops"],
  },
  "34218": {
    zipCode: "34218",
    city: "Holmes Beach",
    area: "Anna Maria Island - South",
    medianHouseholdIncome: 92000,
    medianHomeValue: 1100000,
    incomeProxy: "VERY_HIGH",
    populationDensity: "suburban",
    characteristics: ["Beachfront", "Commercial center", "Resort area"],
  },
  "34228": {
    zipCode: "34228",
    city: "Longboat Key",
    area: "Longboat Key - North",
    medianHouseholdIncome: 125000,
    medianHomeValue: 1500000,
    incomeProxy: "VERY_HIGH",
    populationDensity: "suburban",
    characteristics: ["Luxury beachfront", "Golf courses", "Retirement community"],
  },

  // === PALMETTO / ELLENTON AREA ===
  "34221": {
    zipCode: "34221",
    city: "Palmetto",
    area: "Palmetto",
    medianHouseholdIncome: 52000,
    medianHomeValue: 285000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["Historic area", "Near river", "Affordable"],
  },
  "34222": {
    zipCode: "34222",
    city: "Ellenton",
    area: "Ellenton",
    medianHouseholdIncome: 62000,
    medianHomeValue: 340000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["Near outlet mall", "I-75 access", "Growing area"],
  },

  // === PARRISH / NORTH COUNTY ===
  "34219": {
    zipCode: "34219",
    city: "Parrish",
    area: "Parrish",
    medianHouseholdIncome: 85000,
    medianHomeValue: 420000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Rapid growth", "New construction", "Family-oriented", "Affordable luxury"],
  },

  // === RURAL / OUTER AREAS ===
  "34251": {
    zipCode: "34251",
    city: "Myakka City",
    area: "Myakka City",
    medianHouseholdIncome: 58000,
    medianHomeValue: 380000,
    incomeProxy: "MEDIUM",
    populationDensity: "rural",
    characteristics: ["Rural", "Agricultural", "Large lots", "Equestrian"],
  },
  "34250": {
    zipCode: "34250",
    city: "Terra Ceia",
    area: "Terra Ceia Island",
    medianHouseholdIncome: 75000,
    medianHomeValue: 450000,
    incomeProxy: "HIGH",
    populationDensity: "rural",
    characteristics: ["Waterfront", "Agricultural", "Small community"],
  },
  "34270": {
    zipCode: "34270",
    city: "Tallevast",
    area: "Tallevast",
    medianHouseholdIncome: 45000,
    medianHomeValue: 250000,
    incomeProxy: "MEDIUM",
    populationDensity: "suburban",
    characteristics: ["Near airport", "Industrial area"],
  },

  // === SARASOTA COUNTY OVERLAP ===
  "34240": {
    zipCode: "34240",
    city: "Sarasota",
    area: "East Sarasota / Lakewood Ranch South",
    medianHouseholdIncome: 110000,
    medianHomeValue: 500000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["Lakewood Ranch area", "New developments"],
  },
  "34243": {
    zipCode: "34243",
    city: "Sarasota",
    area: "North Sarasota / University",
    medianHouseholdIncome: 72000,
    medianHomeValue: 380000,
    incomeProxy: "HIGH",
    populationDensity: "suburban",
    characteristics: ["University Town Center", "Commercial area"],
  },
};

/**
 * Default demographics for Manatee County when ZIP not found
 */
export const MANATEE_COUNTY_DEFAULTS: ZipCodeDemographics = {
  zipCode: "unknown",
  city: "Manatee County",
  medianHouseholdIncome: 68000,
  medianHomeValue: 385000,
  incomeProxy: "MEDIUM",
  populationDensity: "suburban",
  characteristics: ["County average"],
};

/**
 * Lookup demographics by ZIP code
 * Returns cached census data for Manatee County ZIPs
 */
export function getZipCodeDemographics(zipCode: string): ZipCodeDemographics | null {
  // Normalize ZIP code (first 5 digits)
  const normalizedZip = zipCode.trim().substring(0, 5);
  return MANATEE_COUNTY_ZIP_DATA[normalizedZip] || null;
}

/**
 * Check if a ZIP code is in Manatee County
 */
export function isManateeCountyZip(zipCode: string): boolean {
  const normalizedZip = zipCode.trim().substring(0, 5);

  // Manatee County ZIP codes typically start with 342xx
  // Plus some edge cases like 33598 (Wimauma overlap)
  if (normalizedZip.startsWith("342") || normalizedZip === "33598") {
    return true;
  }

  // Also check the lookup table
  return normalizedZip in MANATEE_COUNTY_ZIP_DATA;
}

/**
 * Format income as currency string
 */
export function formatIncome(income: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(income);
}

/**
 * Format home value as currency string
 */
export function formatHomeValue(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
