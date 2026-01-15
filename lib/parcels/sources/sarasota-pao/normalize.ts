/**
 * Sarasota PAO Normalization
 *
 * Transforms PropertyDetails (from the Playwright scraper) into
 * the platform-standard NormalizedParcel format.
 */

import type { PropertyDetails, ValuationRecord, SaleRecord } from "@/lib/realestate/property-types";
import type {
  NormalizedParcel,
  NormalizedAddress,
  NormalizedAssessment,
  NormalizedSale,
  ParcelProvenance,
} from "../../types";
import { normalizeParcelId, extractParcelIdFromSarasotaPaoUrl } from "../../utils/parcel-id";
import { computeSaleKeySha256 } from "../../utils/hash";
import {
  SARASOTA_PAO_SOURCE_KEY,
  SARASOTA_STATE_FIPS,
  SARASOTA_COUNTY_FIPS,
} from "./constants";

// ============================================================================
// Main Normalization Function
// ============================================================================

export function normalizeSarasotaPaoPropertyDetails(
  input: Partial<PropertyDetails>,
  meta: {
    sourceUrl?: string;
    timestamp: string;
    method: string;
  }
): NormalizedParcel {
  const provenance: Record<string, ParcelProvenance> = {};

  const makeProvenance = (confidence: number): ParcelProvenance => ({
    source: SARASOTA_PAO_SOURCE_KEY,
    method: meta.method,
    sourceUrl: meta.sourceUrl,
    timestamp: meta.timestamp,
    confidence,
  });

  // Extract parcel ID
  let parcelIdRaw = input.parcelId;
  let parcelIdNorm = "";

  // Try to get from URL if not in data
  if (!parcelIdRaw && meta.sourceUrl) {
    parcelIdRaw = extractParcelIdFromSarasotaPaoUrl(meta.sourceUrl) || undefined;
  }

  if (parcelIdRaw) {
    parcelIdNorm = normalizeParcelId(parcelIdRaw);
    provenance.parcelId = makeProvenance(1.0);
  }

  // Normalize situs address
  const situsAddress = normalizeAddress(input.address, input.city, input.state, input.zipCode);
  if (situsAddress.normalizedFull) {
    provenance.situsAddress = makeProvenance(0.9);
  }

  // Owner name
  const ownerName = input.owner?.trim() || undefined;
  if (ownerName) {
    provenance.ownerName = makeProvenance(0.9);
  }

  // Land info
  const land = normalizeLand(input);
  if (Object.keys(land).length > 0) {
    provenance.land = makeProvenance(0.8);
  }

  // Improvements
  const improvements = normalizeImprovements(input);
  if (Object.keys(improvements).length > 0) {
    provenance.improvements = makeProvenance(0.8);
  }

  // Assessments
  const assessments = normalizeAssessments(input.valuations || []);
  if (assessments.length > 0) {
    provenance.assessments = makeProvenance(0.9);
  }

  // Sales
  const sales = normalizeSales(input.salesHistory || []);
  if (sales.length > 0) {
    provenance.sales = makeProvenance(0.9);
  }

  // Calculate overall confidence
  const confidence = calculateConfidence(input);

  return {
    stateFips: SARASOTA_STATE_FIPS,
    countyFips: SARASOTA_COUNTY_FIPS,
    parcelIdRaw,
    parcelIdNorm,
    situsAddress,
    ownerName,
    land: Object.keys(land).length > 0 ? land : undefined,
    improvements: Object.keys(improvements).length > 0 ? improvements : undefined,
    assessments: assessments.length > 0 ? assessments : undefined,
    sales: sales.length > 0 ? sales : undefined,
    provenance,
    confidence,
  };
}

// ============================================================================
// Address Normalization
// ============================================================================

function normalizeAddress(
  address?: string,
  city?: string,
  state?: string,
  zipCode?: string
): NormalizedAddress {
  const raw = address?.trim();

  // Build normalized full address
  const parts: string[] = [];
  if (raw) parts.push(raw);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zipCode) parts.push(zipCode);

  const normalizedFull = parts.join(", ").toUpperCase();

  return {
    raw,
    line1: raw,
    city: city?.trim(),
    state: state?.trim() || "FL",
    zipCode: zipCode?.trim(),
    normalizedFull,
  };
}

// ============================================================================
// Land Normalization
// ============================================================================

function normalizeLand(input: Partial<PropertyDetails>): NonNullable<NormalizedParcel["land"]> {
  const land: NonNullable<NormalizedParcel["land"]> = {};

  if (input.basicInfo?.useCode) {
    land.useCode = input.basicInfo.useCode;
  }
  if (input.basicInfo?.useDescription) {
    land.useDescription = input.basicInfo.useDescription;
  }
  if (input.basicInfo?.legalDescription || input.legal) {
    land.legalDescription = input.basicInfo?.legalDescription || input.legal;
  }
  if (input.land?.lotSizeAcres) {
    land.acreage = input.land.lotSizeAcres;
  }
  if (input.land?.lotSizeSqFt) {
    land.lotSizeSqFt = input.land.lotSizeSqFt;
  }
  if (input.zoning) {
    land.zoning = input.zoning;
  }

  return land;
}

// ============================================================================
// Improvements Normalization
// ============================================================================

function normalizeImprovements(input: Partial<PropertyDetails>): NonNullable<NormalizedParcel["improvements"]> {
  const improvements: NonNullable<NormalizedParcel["improvements"]> = {};
  const building = input.building;

  // Year built
  if (input.yearBuilt || building?.yearBuilt) {
    improvements.yearBuilt = input.yearBuilt || building?.yearBuilt;
  }
  if (building?.effectiveYearBuilt) {
    improvements.effectiveYearBuilt = building.effectiveYearBuilt;
  }

  // Square footage
  if (input.sqft || building?.livingAreaSqFt) {
    improvements.livingAreaSqFt = input.sqft || building?.livingAreaSqFt;
  }
  if (building?.totalAreaSqFt) {
    improvements.totalAreaSqFt = building.totalAreaSqFt;
  }

  // Rooms
  if (input.bedrooms !== undefined || building?.bedrooms !== undefined) {
    improvements.bedrooms = input.bedrooms ?? building?.bedrooms;
  }
  if (input.bathrooms !== undefined || building?.bathrooms !== undefined) {
    improvements.bathrooms = input.bathrooms ?? building?.bathrooms;
  }

  // Structure
  if (building?.stories) {
    improvements.stories = building.stories;
  }
  if (building?.constructionType) {
    improvements.constructionType = building.constructionType;
  }
  if (building?.pool?.hasPool) {
    improvements.pool = true;
  }
  if (building?.garage?.spaces && building.garage.spaces > 0) {
    improvements.garage = true;
  }

  return improvements;
}

// ============================================================================
// Assessments Normalization
// ============================================================================

function normalizeAssessments(valuations: ValuationRecord[]): NormalizedAssessment[] {
  return valuations
    .filter((v) => v.year !== undefined)
    .map((v) => ({
      taxYear: v.year!,
      justValue: v.just?.total,
      assessedValue: v.assessed?.total,
      taxableValue: v.taxable?.total,
      landValue: v.just?.land || v.assessed?.land,
      improvementValue: v.just?.building || v.assessed?.building,
      adValoremTaxes: v.adValoremTaxes,
      nonAdValoremTaxes: v.nonAdValoremTaxes,
    }))
    .sort((a, b) => b.taxYear - a.taxYear); // Most recent first
}

// ============================================================================
// Sales Normalization
// ============================================================================

function normalizeSales(sales: SaleRecord[]): NormalizedSale[] {
  return sales
    .filter((s) => s.date || s.price) // Must have at least date or price
    .map((s) => {
      const normalized: NormalizedSale = {
        saleDate: s.date,
        salePrice: s.price,
        qualified: s.qualified,
        deedType: s.deedType,
        instrument: s.instrumentNumber,
        bookPage: s.bookPage,
        grantor: s.grantor,
        grantee: s.grantee,
        saleKeySha256: computeSaleKeySha256({
          saleDate: s.date,
          salePrice: s.price,
          bookPage: s.bookPage,
          instrument: s.instrumentNumber,
          grantee: s.grantee,
        }),
      };
      return normalized;
    })
    .sort((a, b) => {
      // Sort by date descending (most recent first)
      if (!a.saleDate) return 1;
      if (!b.saleDate) return -1;
      return new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
    });
}

// ============================================================================
// Confidence Calculation
// ============================================================================

/**
 * Calculate confidence score based on data quality.
 *
 * Factors:
 * - Parcel ID present: +0.15
 * - Owner name present: +0.15
 * - Address present: +0.15
 * - Valuations present: +0.20
 * - Sales history: +0.15
 * - Building details: +0.10
 * - Extra features: +0.10
 */
function calculateConfidence(property: Partial<PropertyDetails>): number {
  let confidence = 0;

  // Parcel ID
  if (property.parcelId) {
    confidence += 0.15;
  }

  // Owner name
  if (property.owner && property.owner.length > 2) {
    confidence += 0.15;
  }

  // Address present
  if (property.address && property.address.length > 5) {
    confidence += 0.15;
  }

  // Valuations
  if (property.valuations && property.valuations.length > 0) {
    confidence += 0.20;
  }

  // Sales history
  if (property.salesHistory && property.salesHistory.length > 0) {
    confidence += 0.15;
  }

  // Building details
  if (
    property.building?.bedrooms ||
    property.building?.bathrooms ||
    property.building?.livingAreaSqFt
  ) {
    confidence += 0.10;
  }

  // Extra features
  if (
    property.extras?.paoExtraFeatures?.length ||
    property.extras?.inspections?.length
  ) {
    confidence += 0.10;
  }

  return Math.min(confidence, 1);
}
