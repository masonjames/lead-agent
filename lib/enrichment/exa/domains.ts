/**
 * Exa Search Domain Configuration
 * 
 * Centralized domain lists for include/exclude filtering in Exa searches.
 * Tuned for real estate lead enrichment in Manatee County, FL.
 */

// ============================================================================
// HIGH-VALUE INCLUDE DOMAINS (use per-intent, not globally)
// ============================================================================

/**
 * Florida professional license lookup domains
 * Best source for "is this person a licensed professional?"
 */
export const INCLUDE_DOMAINS_LICENSE_FL = [
  "myfloridalicense.com",  // DBPR: contractors, RE licenses, etc.
  "flhealthsource.gov",    // FL Dept of Health license lookup
  "floridabar.org",        // Florida Bar (attorneys)
];

/**
 * Florida business registry domains
 * Best source for "does this person own/control an entity?"
 */
export const INCLUDE_DOMAINS_BUSINESS_REGISTRY_FL = [
  "search.sunbiz.org",     // Official FL Division of Corporations
];

/**
 * Local credible publications for Manatee County area
 * Use for "mentions in press" signals
 */
export const INCLUDE_DOMAINS_LOCAL_NEWS_MANATEE = [
  "bradenton.com",         // Bradenton Herald
  "heraldtribune.com",     // Sarasota Herald-Tribune (covers Manatee)
  "businessobserverfl.com", // Business Observer (regional business coverage)
];

/**
 * Real estate listing portals
 * Use to detect if property is already listed or agent association
 */
export const INCLUDE_DOMAINS_REAL_ESTATE_LISTINGS = [
  "realtor.com",
  "zillow.com",
  "redfin.com",
  "homes.com",
  "trulia.com",
];

/**
 * Social/professional profile platforms
 * Can be noisy/blocked but sometimes valuable for identity verification
 */
export const INCLUDE_DOMAINS_SOCIAL_PROFILES = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
];

// ============================================================================
// EXCLUDE DOMAINS (noise/traps to filter out)
// ============================================================================

/**
 * Redirect traps and background-check paywalls
 * These sites require multi-step popups and never provide actionable data
 */
export const EXCLUDE_DOMAINS_REDIRECT_TRAPS = [
  "govbackgroundchecks.com",
  "truthfinder.com",
  "beenverified.com",
  "intelius.com",
  "instantcheckmate.com",
  "peoplefinders.com",
  "peoplelooker.com",
  "spokeo.com",
  "checkpeople.com",
  "publicrecordsnow.com",
];

/**
 * People-search / OSINT directories
 * High noise, low signal for real estate leads
 */
export const EXCLUDE_DOMAINS_PEOPLE_DIRECTORIES = [
  "whitepages.com",
  "fastpeoplesearch.com",
  "truepeoplesearch.com",
  "usphonebook.com",
  "thatsthem.com",
  "radaris.com",
  "clustrmaps.com",
  "familytreenow.com",
  "cocofinder.com",
  "nuwber.com",
  "anywho.com",
  "officialusa.com",
  "addresssearch.com",
  "cyberbackgroundchecks.com",
  "publicdatacheck.com",
  "ussearch.com",
  "peekyou.com",
  "pipl.com",
];

/**
 * B2B data brokers and employee directories
 * Not relevant for individual lead enrichment
 */
export const EXCLUDE_DOMAINS_B2B_BROKERS = [
  "zoominfo.com",
  "rocketreach.co",
  "apollo.io",
  "lusha.com",
  "seamless.ai",
  "signalhire.com",
  "theorg.com",
  "dnb.com",
  "hoovers.com",
  "leadiq.com",
  "clearbit.com",
  "hunter.io",
];

/**
 * Government/tax portals that produce irrelevant hits
 * PAO data is already scraped separately
 */
export const EXCLUDE_DOMAINS_GOV_TAX_NOISE = [
  "taxcollector.com",
  "mymanatee.org",
  "votemanatee.gov",
  "manatee.k12.fl.us",
  "fl-counties.com",
  "manateeclerk.com",
  "manateepao.gov",        // Already scraped via PAO enrichment
  "qpublic.net",
  "propertyappraiser.net",
];

/**
 * Generic noise domains that don't provide person-specific info
 * NOTE: yelp.com and bbb.org are NOT excluded - they're valuable for company lookups
 */
export const EXCLUDE_DOMAINS_GENERIC_NOISE = [
  "wikipedia.org",
  "wikidata.org",
  "amazon.com",
  "ebay.com",
  "youtube.com",           // Video results rarely useful for lead enrichment
  "pinterest.com",
  "glassdoor.com",         // Employee reviews
  "indeed.com",            // Job postings
  "salary.com",
  "payscale.com",
];

/**
 * Business listing and directory domains (useful for company lookups)
 */
export const INCLUDE_DOMAINS_BUSINESS_LISTINGS = [
  "yelp.com",
  "bbb.org",
  "google.com",            // Google Business listings
  "yellowpages.com",
  "manta.com",
  "mapquest.com",
];

/**
 * Combined global exclude list for all Exa searches
 */
export const EXA_GLOBAL_EXCLUDE_DOMAINS = [
  ...EXCLUDE_DOMAINS_REDIRECT_TRAPS,
  ...EXCLUDE_DOMAINS_PEOPLE_DIRECTORIES,
  ...EXCLUDE_DOMAINS_B2B_BROKERS,
  ...EXCLUDE_DOMAINS_GOV_TAX_NOISE,
  ...EXCLUDE_DOMAINS_GENERIC_NOISE,
];

// ============================================================================
// DOMAIN CATEGORIZATION PATTERNS
// ============================================================================

/**
 * Domain patterns for categorizing search results
 */
export const DOMAIN_CATEGORY_PATTERNS = {
  // Social profiles
  SOCIAL_PROFILE: [
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
  ],
  
  // Professional/license registries
  LICENSE_REGISTRY: [
    "myfloridalicense.com",
    "flhealthsource.gov",
    "floridabar.org",
    "dbpr.state.fl.us",
  ],
  
  // Business registries
  BUSINESS_REGISTRY: [
    "sunbiz.org",
    "dos.myflorida.com",
  ],
  
  // Real estate platforms (agent/listing profiles)
  REAL_ESTATE_PROFILE: [
    // Major portals
    "realtor.com",
    "zillow.com",
    "redfin.com",
    "homes.com",
    "trulia.com",
    // National brokerages
    "compass.com",
    "coldwellbanker.com",
    "century21.com",
    "kw.com",
    "remax.com",
    "sothebysrealty.com",
    "berkshirehathawayhs.com",
    "weichert.com",
    "exitrealty.com",
    "exp.com",
    "exprealty.com",
    // Florida brokerages
    "finepropertiesfl.com",
    "michaelsaunders.com",
    "waterfrontgroup.com",
    "premieresothebysrealty.com",
    "floridamoves.com",
    "stockrealty.com",
    "mvausa.com",
    "johnrwood.com",
    "royalshellrealestate.com",
    // Agent team sites (common patterns)
    "team*.com",
  ],
  
  // News/media
  NEWS_PUBLICATION: [
    "bradenton.com",
    "heraldtribune.com",
    "businessobserverfl.com",
    "tampabay.com",
    "floridaweekly.com",
    "patch.com",
  ],

  // Business listings (Yelp, BBB, Google Business, etc.)
  BUSINESS_LISTING: [
    "yelp.com",
    "bbb.org",
    "google.com",
    "yellowpages.com",
    "manta.com",
    "mapquest.com",
    "thumbtack.com",
    "homeadvisor.com",
    "angieslist.com",
    "angi.com",
  ],

  // People directories (if they slip through)
  PEOPLE_DIRECTORY: [
    ...EXCLUDE_DOMAINS_PEOPLE_DIRECTORIES,
    ...EXCLUDE_DOMAINS_REDIRECT_TRAPS,
  ],
};

/**
 * Check if a domain is in the redirect trap list
 * Used to block deep scraping of problematic sites
 */
export function isRedirectTrapDomain(domain: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  return EXCLUDE_DOMAINS_REDIRECT_TRAPS.some(
    trap => normalizedDomain === trap || normalizedDomain.endsWith(`.${trap}`)
  );
}

/**
 * Check if a domain should be excluded from results
 */
export function shouldExcludeDomain(domain: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  return EXA_GLOBAL_EXCLUDE_DOMAINS.some(
    excluded => normalizedDomain === excluded || normalizedDomain.endsWith(`.${excluded}`)
  );
}
