/**
 * Golden Parcel Test Cases for Sarasota PAO
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

export const sarasotaPaoGoldenCases: GoldenParcelCase[] = [
  {
    id: "sarasota-condo-1",
    name: "Condominium Unit (Long Common)",
    fixturePath: "./fixtures/condo-1.json",
    expect: {
      parcelIdNorm: "2043131013",
      normalizedFullAddress: "5701 LONG COMMON CIR #13, SARASOTA, FL, 34235",
      ownerName: "TEST OWNER NAME",
      yearBuilt: 1984,
      bedrooms: 2,
      bathrooms: 2,
      livingAreaSqFt: 1090,
      assessmentYears: [2024, 2023],
      saleCount: 1,
      confidenceMin: 0.7,
    },
  },
  {
    id: "sarasota-residential-1",
    name: "Standard Residential Property",
    fixturePath: "./fixtures/residential-1.json",
    expect: {
      parcelIdNorm: "1234567890",
      normalizedFullAddress: "100 EXAMPLE BLVD, SARASOTA, FL, 34231",
      ownerName: "JOHNSON MARY & DAVID",
      yearBuilt: 1998,
      bedrooms: 4,
      bathrooms: 3,
      livingAreaSqFt: 2450,
      assessmentYears: [2024, 2023, 2022],
      saleCount: 2,
      confidenceMin: 0.8,
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
