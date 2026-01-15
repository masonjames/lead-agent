/**
 * Manatee County PAO Constants
 */

import type { SourceConfig } from "../../types";

export const MANATEE_PAO_SOURCE_KEY = "fl-manatee-pa" as const;
export const MANATEE_STATE_FIPS = "12";
export const MANATEE_COUNTY_FIPS = "081";

export const MANATEE_PAO_CONFIG: SourceConfig = {
  sourceKey: MANATEE_PAO_SOURCE_KEY,
  name: "Manatee County Property Appraiser",
  stateFips: MANATEE_STATE_FIPS,
  countyFips: MANATEE_COUNTY_FIPS,
  sourceType: "county_pa",
  platformFamily: "playwright",
  baseUrl: "https://www.manateepao.gov",
  capabilities: {
    addressSearch: true,
    parcelSearch: true,
    assessmentHistory: true,
    salesHistory: true,
    owner: true,
    improvements: true,
    land: true,
  },
  rateLimit: {
    rps: 0.2,
    burst: 2,
  },
  retry: {
    maxAttempts: 3,
    backoffSeconds: [2, 5, 15],
  },
};

export const PARSER_VERSION = "manatee-pao-v1.0.0";
