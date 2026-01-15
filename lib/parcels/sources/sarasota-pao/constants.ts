/**
 * Sarasota County PAO Constants
 */

import type { SourceConfig } from "../../types";

export const SARASOTA_PAO_SOURCE_KEY = "fl-sarasota-pa" as const;
export const SARASOTA_STATE_FIPS = "12";
export const SARASOTA_COUNTY_FIPS = "115";

export const SARASOTA_PAO_CONFIG: SourceConfig = {
  sourceKey: SARASOTA_PAO_SOURCE_KEY,
  name: "Sarasota County Property Appraiser",
  stateFips: SARASOTA_STATE_FIPS,
  countyFips: SARASOTA_COUNTY_FIPS,
  sourceType: "county_pa",
  platformFamily: "playwright",
  baseUrl: "https://www.sc-pa.com",
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

export const PARSER_VERSION = "sarasota-pao-v1.0.0";
