/**
 * Exa Search Result Categorization
 * 
 * Determines the category and platform type of search results based on
 * URL patterns, domain, and content signals.
 */

import { DOMAIN_CATEGORY_PATTERNS } from "./domains";

/**
 * Categories for Exa search results
 */
export type ExaSourceCategory =
  | "SOCIAL_PROFILE"
  | "PROFESSIONAL_PROFILE"
  | "REAL_ESTATE_PROFILE"
  | "LICENSE_REGISTRY"
  | "BUSINESS_REGISTRY"
  | "BUSINESS_LISTING"
  | "COMPANY_WEBSITE"
  | "NEWS_MENTION"
  | "PEOPLE_DIRECTORY"
  | "OTHER";

/**
 * Platform types for public profiles
 */
export type ProfilePlatform =
  | "LinkedIn"
  | "Facebook"
  | "Instagram"
  | "X"
  | "Realtor.com"
  | "Zillow"
  | "Redfin"
  | "Brokerage"
  | "License"
  | "Business"
  | "Yelp"
  | "BBB"
  | "Google"
  | "Company"
  | "News"
  | "Other";

export interface CategorizationResult {
  category: ExaSourceCategory;
  platform: ProfilePlatform;
  isProfile: boolean;
  confidence: number;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Check if domain matches any pattern in a list
 */
function domainMatches(domain: string, patterns: string[]): boolean {
  return patterns.some(
    pattern => domain === pattern || domain.endsWith(`.${pattern}`)
  );
}

/**
 * Categorize a URL based on domain and path patterns
 */
export function categorizeExaUrl(input: {
  url: string;
  title?: string;
  text?: string;
}): CategorizationResult {
  const { url, title, text } = input;
  const domain = extractDomain(url);
  const lowerUrl = url.toLowerCase();
  const lowerTitle = (title || "").toLowerCase();
  
  // Check for LinkedIn profiles
  // Support various subdomains: www.linkedin.com, m.linkedin.com, etc.
  if (domainMatches(domain, ["linkedin.com"])) {
    // Person profile URLs: /in/username, /pub/username, with optional query params
    const isPersonProfile =
      /linkedin\.com\/in\/[a-zA-Z0-9_-]+/i.test(url) ||
      /linkedin\.com\/pub\/[a-zA-Z0-9_-]+/i.test(url);
    const isCompanyPage = lowerUrl.includes("/company/");
    const isSchoolPage = lowerUrl.includes("/school/");

    if (isPersonProfile) {
      return {
        category: "PROFESSIONAL_PROFILE",
        platform: "LinkedIn",
        isProfile: true,
        confidence: 0.9,
      };
    }
    if (isCompanyPage || isSchoolPage) {
      return {
        category: "BUSINESS_REGISTRY",
        platform: "LinkedIn",
        isProfile: false,
        confidence: 0.7,
      };
    }
    // Generic LinkedIn page (search results, posts, etc.)
    return {
      category: "PROFESSIONAL_PROFILE",
      platform: "LinkedIn",
      isProfile: false,
      confidence: 0.5,
    };
  }
  
  // Check for Facebook profiles
  // Support various subdomains: www.facebook.com, m.facebook.com, l.facebook.com, etc.
  if (domainMatches(domain, ["facebook.com", "fb.com"])) {
    // Detect various Facebook profile URL patterns
    const isVanityUrl =
      /facebook\.com\/(?!pages|groups|events|watch|marketplace|gaming|business|ads|help|settings|policies|reel)[a-zA-Z0-9.]+\/?(?:\?|$)/i.test(
        url
      );
    const isProfilePhpUrl = /facebook\.com\/profile\.php\?id=\d+/i.test(url);
    const isPeopleUrl = /facebook\.com\/people\/[^/]+\/\d+/i.test(url);
    const isPublicUrl = /facebook\.com\/public\/[^/]+/i.test(url);

    const isProfileUrl = isVanityUrl || isProfilePhpUrl || isPeopleUrl || isPublicUrl;

    // Business pages and groups
    const isBusinessPage =
      lowerUrl.includes("/pages/") ||
      lowerUrl.includes("/groups/") ||
      lowerUrl.includes("/business/");

    if (isProfileUrl && !isBusinessPage) {
      return {
        category: "SOCIAL_PROFILE",
        platform: "Facebook",
        isProfile: true,
        confidence: 0.85,
      };
    }
    if (isBusinessPage) {
      return {
        category: "BUSINESS_LISTING",
        platform: "Facebook",
        isProfile: false,
        confidence: 0.7,
      };
    }
    // Generic Facebook page (posts, photos, etc.)
    return {
      category: "SOCIAL_PROFILE",
      platform: "Facebook",
      isProfile: false,
      confidence: 0.5,
    };
  }
  
  // Check for Instagram profiles
  if (domainMatches(domain, ["instagram.com"])) {
    const isProfileUrl = /instagram\.com\/[a-zA-Z0-9._]+\/?$/i.test(url) && 
                         !lowerUrl.includes("/p/") && 
                         !lowerUrl.includes("/reel/");
    return {
      category: "SOCIAL_PROFILE",
      platform: "Instagram",
      isProfile: isProfileUrl,
      confidence: isProfileUrl ? 0.8 : 0.5,
    };
  }
  
  // Check for X/Twitter profiles
  if (domainMatches(domain, ["twitter.com", "x.com"])) {
    const isProfileUrl = /(?:twitter|x)\.com\/[a-zA-Z0-9_]+\/?$/i.test(url) &&
                         !lowerUrl.includes("/status/");
    return {
      category: "SOCIAL_PROFILE",
      platform: "X",
      isProfile: isProfileUrl,
      confidence: isProfileUrl ? 0.8 : 0.5,
    };
  }
  
  // Check for Florida license registries
  if (domainMatches(domain, DOMAIN_CATEGORY_PATTERNS.LICENSE_REGISTRY)) {
    // Check if it's a license detail page vs search page
    const isDetailPage = lowerUrl.includes("licenseid") || 
                         lowerUrl.includes("licensedetail") ||
                         lowerUrl.includes("/verify/") ||
                         /\d{6,}/.test(url); // License numbers are typically 6+ digits
    return {
      category: "LICENSE_REGISTRY",
      platform: "License",
      isProfile: isDetailPage,
      confidence: isDetailPage ? 0.9 : 0.6,
    };
  }
  
  // Check for business registries
  if (domainMatches(domain, DOMAIN_CATEGORY_PATTERNS.BUSINESS_REGISTRY)) {
    const isEntityPage = lowerUrl.includes("detailreport") || 
                         lowerUrl.includes("/detail/") ||
                         /document.*number/i.test(lowerUrl);
    return {
      category: "BUSINESS_REGISTRY",
      platform: "Business",
      isProfile: isEntityPage,
      confidence: isEntityPage ? 0.9 : 0.6,
    };
  }
  
  // Check for real estate platforms
  if (domainMatches(domain, DOMAIN_CATEGORY_PATTERNS.REAL_ESTATE_PROFILE)) {
    // Determine specific platform
    let platform: ProfilePlatform = "Other";
    if (domain.includes("realtor.com")) platform = "Realtor.com";
    else if (domain.includes("zillow.com")) platform = "Zillow";
    else if (domain.includes("redfin.com")) platform = "Redfin";
    else platform = "Brokerage";
    
    // Check if it's an agent profile vs property listing
    const isAgentProfile = lowerUrl.includes("/agent/") ||
                          lowerUrl.includes("/realtor/") ||
                          lowerUrl.includes("/profile/") ||
                          lowerTitle.includes("agent") ||
                          lowerTitle.includes("realtor");
    
    const isPropertyListing = lowerUrl.includes("/homedetails/") ||
                             lowerUrl.includes("/homes/") ||
                             /\/\d{5,}\//.test(url); // Property IDs
    
    if (isAgentProfile) {
      return {
        category: "REAL_ESTATE_PROFILE",
        platform,
        isProfile: true,
        confidence: 0.85,
      };
    }
    
    // Property listings are less useful for person enrichment
    return {
      category: "OTHER",
      platform,
      isProfile: false,
      confidence: 0.3,
    };
  }
  
  // Check for news publications
  if (domainMatches(domain, DOMAIN_CATEGORY_PATTERNS.NEWS_PUBLICATION)) {
    return {
      category: "NEWS_MENTION",
      platform: "News",
      isProfile: false,
      confidence: 0.7,
    };
  }

  // Check for business listing sites (Yelp, BBB, Google Business, etc.)
  if (domainMatches(domain, DOMAIN_CATEGORY_PATTERNS.BUSINESS_LISTING)) {
    // Determine specific platform
    let platform: ProfilePlatform = "Other";
    if (domain.includes("yelp.com")) platform = "Yelp";
    else if (domain.includes("bbb.org")) platform = "BBB";
    else if (domain.includes("google.com")) platform = "Google";

    // Check if it's a business page (vs generic search results)
    const isBusinessPage =
      lowerUrl.includes("/biz/") ||           // Yelp business page
      lowerUrl.includes("/business/") ||      // BBB business page
      lowerUrl.includes("/place/") ||         // Google Maps place
      lowerUrl.includes("/maps/place/") ||
      lowerTitle.includes("reviews") ||
      lowerTitle.includes("business");

    return {
      category: "BUSINESS_LISTING",
      platform,
      isProfile: isBusinessPage,
      confidence: isBusinessPage ? 0.85 : 0.6,
    };
  }

  // Check for people directories (should have been filtered, but catch stragglers)
  if (domainMatches(domain, DOMAIN_CATEGORY_PATTERNS.PEOPLE_DIRECTORY)) {
    return {
      category: "PEOPLE_DIRECTORY",
      platform: "Other",
      isProfile: false,
      confidence: 0.2, // Low confidence = low value
    };
  }

  // Check for personal agent/team websites
  // Common patterns: team*.com, *realtor.com, *realestate*.com, *homes.com
  const isPersonalAgentSite =
    domain.startsWith("team") ||
    domain.includes("realtor") ||
    domain.includes("realestate") ||
    domain.includes("realty") ||
    (domain.includes("homes") && !domainMatches(domain, ["homes.com"])) ||
    // Check if title suggests an agent page
    (lowerTitle.includes("real estate") && lowerTitle.includes("agent")) ||
    (lowerTitle.includes("realtor") && !lowerTitle.includes("realtor.com"));

  if (isPersonalAgentSite) {
    return {
      category: "REAL_ESTATE_PROFILE",
      platform: "Brokerage",
      isProfile: true,
      confidence: 0.75,
    };
  }

  // Default: OTHER
  return {
    category: "OTHER",
    platform: "Other",
    isProfile: false,
    confidence: 0.4,
  };
}

/**
 * Check if a category represents a profile-type result
 */
export function isProfileCategory(category: ExaSourceCategory): boolean {
  return [
    "SOCIAL_PROFILE",
    "PROFESSIONAL_PROFILE",
    "REAL_ESTATE_PROFILE",
    "LICENSE_REGISTRY",
    "BUSINESS_REGISTRY",
    "BUSINESS_LISTING",
    "COMPANY_WEBSITE",
  ].includes(category);
}

/**
 * Get display name for a category
 */
export function getCategoryDisplayName(category: ExaSourceCategory): string {
  const names: Record<ExaSourceCategory, string> = {
    SOCIAL_PROFILE: "Social Media",
    PROFESSIONAL_PROFILE: "Professional",
    REAL_ESTATE_PROFILE: "Real Estate",
    LICENSE_REGISTRY: "License Registry",
    BUSINESS_REGISTRY: "Business Registry",
    BUSINESS_LISTING: "Business Listing",
    COMPANY_WEBSITE: "Company Website",
    NEWS_MENTION: "News",
    PEOPLE_DIRECTORY: "Directory",
    OTHER: "Web",
  };
  return names[category];
}
