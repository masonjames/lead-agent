/**
 * Property Types for PAO Scraping
 * 
 * Minimal type definitions for Manatee County Property Appraiser data.
 * These types are used by the PAO scraper and enrichment modules.
 */

// Value breakdown for assessments (land, building, extras, total)
export interface ValueBreakdown {
  land?: number;
  building?: number;
  extraFeatures?: number;
  total?: number;
}

// Valuation record for a specific tax year
export interface ValuationRecord {
  year?: number;
  just?: ValueBreakdown; // Just/Market value
  assessed?: ValueBreakdown; // Assessed value
  taxable?: ValueBreakdown; // Taxable value
  adValoremTaxes?: number;
  nonAdValoremTaxes?: number;
}

// Sale transaction record
export interface SaleRecord {
  date?: string;
  price?: number;
  deedType?: string; // QC, WD, etc.
  instrumentNumber?: string;
  bookPage?: string;
  grantor?: string;
  grantee?: string;
  qualified?: boolean;
  vacantOrImproved?: string; // V or I
  qualificationCode?: string;
}

// Extra feature record from PAO
export interface ExtraFeatureRecord {
  description: string;
  year?: number;
  areaSqFt?: number;
  value?: number;
}

// Inspection record from PAO
export interface InspectionRecord {
  date?: string;
  inspector?: string;
  type?: string;
  result?: string;
  notes?: string;
}

// Basic property identification info
export interface PropertyBasicInfo {
  accountNumber?: string;
  useCode?: string;
  useDescription?: string;
  situsAddress?: string;
  mailingAddress?: string;
  subdivision?: string;
  neighborhood?: string;
  municipality?: string;
  jurisdiction?: string;
  taxDistrict?: string;
  sectionTownshipRange?: string;
  legalDescription?: string;
  shortDescription?: string;
  homesteadExemption?: boolean;
  femaValue?: number;
  ownerType?: string;
  livingUnits?: number;
}

// Building/structure details
export interface PropertyBuilding {
  yearBuilt?: number;
  effectiveYearBuilt?: number;
  livingAreaSqFt?: number;
  totalAreaSqFt?: number;
  bedrooms?: number;
  bathrooms?: number;
  fullBathrooms?: number;
  halfBathrooms?: number;
  stories?: number;
  units?: number;
  constructionType?: string;
  foundation?: string;
  exteriorWalls?: string;
  roofCover?: string;
  roofStructure?: string;
  interiorFinish?: string;
  flooring?: string;
  heating?: string;
  cooling?: string;
  electricUtility?: boolean;
  waterSource?: string;
  sewerType?: string;
  garage?: {
    type?: string;
    spaces?: number;
    areaSqFt?: number;
  };
  pool?: {
    hasPool?: boolean;
    type?: string;
    areaSqFt?: number;
  };
  appliances?: string[];
  laundryLocation?: string;
  interiorFeatures?: string[];
  hasFireplace?: boolean;
}

// Land parcel details
export interface PropertyLand {
  lotSizeSqFt?: number;
  lotSizeAcres?: number;
  landUse?: string;
  landUseCode?: string;
  frontageFt?: number;
  depthFt?: number;
  dimensions?: string;
  roadSurfaceType?: string;
}

// Property extras
export interface PropertyExtras {
  features?: string[];
  paoExtraFeatures?: ExtraFeatureRecord[];
  inspections?: InspectionRecord[];
}

// Main property details interface
export interface PropertyDetails {
  // Core identification
  parcelId?: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  owner?: string;
  ownerType?: string;
  propertyType?: string;

  // Summary fields
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: string;
  assessedValue?: number;
  marketValue?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  taxAmount?: number;
  zoning?: string;
  legal?: string;

  // Rich nested data groups
  basicInfo?: PropertyBasicInfo;
  valuations?: ValuationRecord[];
  building?: PropertyBuilding;
  land?: PropertyLand;
  salesHistory?: SaleRecord[];
  extras?: PropertyExtras;

  // Raw data for debugging
  rawData?: Record<string, unknown>;
}
