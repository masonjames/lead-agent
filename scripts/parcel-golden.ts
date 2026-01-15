#!/usr/bin/env tsx
/**
 * Golden Parcel Test Runner
 *
 * Validates that normalization produces stable outputs from known inputs.
 * Run with: pnpm parcel:golden
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import type { PropertyDetails } from "../lib/realestate/property-types";
import { normalizeManateePaoPropertyDetails } from "../lib/parcels/sources/manatee-pao/normalize";
import { normalizeSarasotaPaoPropertyDetails } from "../lib/parcels/sources/sarasota-pao/normalize";
import {
  manateePaoGoldenCases,
  validateGoldenCase as validateManateeCase,
  type GoldenParcelCase,
} from "../lib/parcels/sources/manatee-pao/golden/cases";
import {
  sarasotaPaoGoldenCases,
  validateGoldenCase as validateSarasotaCase,
} from "../lib/parcels/sources/sarasota-pao/golden/cases";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
};

interface TestSuite {
  name: string;
  source: string;
  goldenDir: string;
  cases: GoldenParcelCase[];
  normalize: (
    fixture: Partial<PropertyDetails>,
    meta: { sourceUrl?: string; timestamp: string; method: string }
  ) => ReturnType<typeof normalizeManateePaoPropertyDetails>;
  validate: typeof validateManateeCase;
  baseUrl: string;
}

const testSuites: TestSuite[] = [
  {
    name: "Manatee PAO",
    source: "fl-manatee-pa",
    goldenDir: resolve(__dirname, "../lib/parcels/sources/manatee-pao/golden"),
    cases: manateePaoGoldenCases,
    normalize: normalizeManateePaoPropertyDetails,
    validate: validateManateeCase,
    baseUrl: "https://www.manateepao.gov/property/?parid=",
  },
  {
    name: "Sarasota PAO",
    source: "fl-sarasota-pa",
    goldenDir: resolve(__dirname, "../lib/parcels/sources/sarasota-pao/golden"),
    cases: sarasotaPaoGoldenCases,
    normalize: normalizeSarasotaPaoPropertyDetails,
    validate: validateSarasotaCase,
    baseUrl: "https://www.sc-pa.com/propertysearch/parcel/details/",
  },
];

function loadFixture(goldenDir: string, fixturePath: string): Partial<PropertyDetails> {
  const fullPath = resolve(goldenDir, fixturePath);
  const content = readFileSync(fullPath, "utf-8");
  return JSON.parse(content);
}

async function runGoldenTests(): Promise<void> {
  console.log(`\n${colors.blue}=== Parcel Normalization Golden Tests ===${colors.reset}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  const allFailures: Array<{ suite: string; case: GoldenParcelCase; errors: string[] }> = [];

  for (const suite of testSuites) {
    console.log(`\n${colors.blue}--- ${suite.name} ---${colors.reset}\n`);

    let passed = 0;
    let failed = 0;

    for (const testCase of suite.cases) {
      console.log(`${colors.dim}Testing: ${testCase.name} (${testCase.id})${colors.reset}`);

      try {
        // Load fixture
        const fixture = loadFixture(suite.goldenDir, testCase.fixturePath);

        // Run normalization
        const normalized = suite.normalize(fixture, {
          sourceUrl: `${suite.baseUrl}${fixture.parcelId}`,
          timestamp: new Date().toISOString(),
          method: "playwright",
        });

        // Validate
        const result = suite.validate(normalized, testCase.expect);

        if (result.passed) {
          console.log(`  ${colors.green}✓ PASSED${colors.reset}`);
          passed++;
        } else {
          console.log(`  ${colors.red}✗ FAILED${colors.reset}`);
          result.failures.forEach((f) => {
            console.log(`    ${colors.red}- ${f}${colors.reset}`);
          });
          failed++;
          allFailures.push({ suite: suite.name, case: testCase, errors: result.failures });
        }
      } catch (error) {
        console.log(`  ${colors.red}✗ ERROR: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
        failed++;
        allFailures.push({
          suite: suite.name,
          case: testCase,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    console.log(`\n  ${suite.name} Summary: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}`);
    totalPassed += passed;
    totalFailed += failed;
  }

  // Summary
  console.log(`\n${colors.blue}=== Overall Summary ===${colors.reset}`);
  console.log(`  Total: ${totalPassed + totalFailed}`);
  console.log(`  ${colors.green}Passed: ${totalPassed}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${totalFailed}${colors.reset}`);

  if (allFailures.length > 0) {
    console.log(`\n${colors.yellow}=== Failure Details ===${colors.reset}`);
    for (const failure of allFailures) {
      console.log(`\n  [${failure.suite}] ${failure.case.name} (${failure.case.id}):`);
      failure.errors.forEach((e) => {
        console.log(`    - ${e}`);
      });
    }
  }

  // Exit with error code if any tests failed
  if (totalFailed > 0) {
    process.exit(1);
  }

  console.log(`\n${colors.green}All golden tests passed!${colors.reset}\n`);
}

// Run tests
runGoldenTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
