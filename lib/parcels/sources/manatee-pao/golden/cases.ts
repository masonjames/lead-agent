/**
 * Golden Parcel Test Cases for Manatee PAO
 * 
 * These cases validate that normalization produces stable,
 * expected outputs from known PropertyDetails inputs.
 */

import type { NormalizedParcel } from "../../../types";

export interface GoldenParcelCase {
  id: string;
  name: string;
  fixturePath: string;
  expect: {
    parcelIdNorm: string;
    normalizedFullAddress: string;
    ownerName?: string;
    yearBuilt?: number;
    bedrooms?: number;
    bathrooms?: number;
    livingAreaSqFt?: number;
    assessmentYears?: number[];
    saleCount?: number;
    confidenceMin?: number;
  };
}

export const manateePaoGoldenCases: GoldenParcelCase[] = [
  {
    id: "manatee-residential-1",
    name: "Standard Residential Property",
    fixturePath: "./fixtures/residential-1.json",
    expect: {
      parcelIdNorm: "123456789",
      normalizedFullAddress: "123 MAIN ST, BRADENTON, FL, 34208",
      ownerName: "SMITH JOHN & JANE",
      yearBuilt: 1985,
      bedrooms: 3,
      bathrooms: 2,
      livingAreaSqFt: 1850,
      assessmentYears: [2024, 2023, 2022, 2021, 2020],
      saleCount: 2,
      confidenceMin: 0.8,
    },
  },
  {
    id: "manatee-condo-1",
    name: "Condominium Unit",
    fixturePath: "./fixtures/condo-1.json",
    expect: {
      parcelIdNorm: "987654321",
      normalizedFullAddress: "456 BEACH DR UNIT 302, BRADENTON BEACH, FL, 34217",
      ownerName: "DOE ROBERT",
      yearBuilt: 2005,
      bedrooms: 2,
      bathrooms: 2,
      livingAreaSqFt: 1200,
      assessmentYears: [2024, 2023],
      saleCount: 1,
      confidenceMin: 0.7,
    },
  },
  {
    id: "manatee-vacant-1",
    name: "Vacant Land",
    fixturePath: "./fixtures/vacant-1.json",
    expect: {
      parcelIdNorm: "555555555",
      normalizedFullAddress: "0 VACANT LOT RD, PALMETTO, FL, 34221",
      ownerName: "LAND HOLDINGS LLC",
      yearBuilt: undefined,
      bedrooms: undefined,
      bathrooms: undefined,
      livingAreaSqFt: undefined,
      assessmentYears: [2024],
      saleCount: 0,
      confidenceMin: 0.5,
    },
  },
];

/**
 * Validate a normalized parcel against expected values.
 */
export function validateGoldenCase(
  normalized: NormalizedParcel,
  expected: GoldenParcelCase["expect"]
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  // Required fields
  if (normalized.parcelIdNorm !== expected.parcelIdNorm) {
    failures.push(
      `parcelIdNorm: expected "${expected.parcelIdNorm}", got "${normalized.parcelIdNorm}"`
    );
  }

  if (normalized.situsAddress.normalizedFull !== expected.normalizedFullAddress) {
    failures.push(
      `normalizedFullAddress: expected "${expected.normalizedFullAddress}", got "${normalized.situsAddress.normalizedFull}"`
    );
  }

  // Optional fields
  if (expected.ownerName !== undefined && normalized.ownerName !== expected.ownerName) {
    failures.push(
      `ownerName: expected "${expected.ownerName}", got "${normalized.ownerName}"`
    );
  }

  if (expected.yearBuilt !== undefined && normalized.improvements?.yearBuilt !== expected.yearBuilt) {
    failures.push(
      `yearBuilt: expected ${expected.yearBuilt}, got ${normalized.improvements?.yearBuilt}`
    );
  }

  if (expected.bedrooms !== undefined && normalized.improvements?.bedrooms !== expected.bedrooms) {
    failures.push(
      `bedrooms: expected ${expected.bedrooms}, got ${normalized.improvements?.bedrooms}`
    );
  }

  if (expected.bathrooms !== undefined && normalized.improvements?.bathrooms !== expected.bathrooms) {
    failures.push(
      `bathrooms: expected ${expected.bathrooms}, got ${normalized.improvements?.bathrooms}`
    );
  }

  if (expected.livingAreaSqFt !== undefined && normalized.improvements?.livingAreaSqFt !== expected.livingAreaSqFt) {
    failures.push(
      `livingAreaSqFt: expected ${expected.livingAreaSqFt}, got ${normalized.improvements?.livingAreaSqFt}`
    );
  }

  // Assessment years
  if (expected.assessmentYears !== undefined) {
    const actualYears = (normalized.assessments || []).map((a) => a.taxYear).sort((a, b) => b - a);
    const expectedYears = [...expected.assessmentYears].sort((a, b) => b - a);
    
    if (actualYears.length < expectedYears.length) {
      failures.push(
        `assessmentYears: expected at least ${expectedYears.length} years, got ${actualYears.length}`
      );
    }
  }

  // Sale count
  if (expected.saleCount !== undefined) {
    const actualCount = (normalized.sales || []).length;
    if (actualCount !== expected.saleCount) {
      failures.push(
        `saleCount: expected ${expected.saleCount}, got ${actualCount}`
      );
    }
  }

  // Confidence
  if (expected.confidenceMin !== undefined && normalized.confidence < expected.confidenceMin) {
    failures.push(
      `confidence: expected >= ${expected.confidenceMin}, got ${normalized.confidence}`
    );
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
