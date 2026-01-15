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
import {
  manateePaoGoldenCases,
  validateGoldenCase,
  type GoldenParcelCase,
} from "../lib/parcels/sources/manatee-pao/golden/cases";

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

function loadFixture(fixturePath: string): Partial<PropertyDetails> {
  const goldenDir = resolve(__dirname, "../lib/parcels/sources/manatee-pao/golden");
  const fullPath = resolve(goldenDir, fixturePath);
  const content = readFileSync(fullPath, "utf-8");
  return JSON.parse(content);
}

async function runGoldenTests(): Promise<void> {
  console.log(`\n${colors.blue}=== Parcel Normalization Golden Tests ===${colors.reset}\n`);

  let passed = 0;
  let failed = 0;
  const failures: Array<{ case: GoldenParcelCase; errors: string[] }> = [];

  for (const testCase of manateePaoGoldenCases) {
    console.log(`${colors.dim}Testing: ${testCase.name} (${testCase.id})${colors.reset}`);

    try {
      // Load fixture
      const fixture = loadFixture(testCase.fixturePath);

      // Run normalization
      const normalized = normalizeManateePaoPropertyDetails(fixture, {
        sourceUrl: `https://www.manateepao.gov/property/?parid=${fixture.parcelId}`,
        timestamp: new Date().toISOString(),
        method: "playwright",
      });

      // Validate
      const result = validateGoldenCase(normalized, testCase.expect);

      if (result.passed) {
        console.log(`  ${colors.green}✓ PASSED${colors.reset}`);
        passed++;
      } else {
        console.log(`  ${colors.red}✗ FAILED${colors.reset}`);
        result.failures.forEach((f) => {
          console.log(`    ${colors.red}- ${f}${colors.reset}`);
        });
        failed++;
        failures.push({ case: testCase, errors: result.failures });
      }
    } catch (error) {
      console.log(`  ${colors.red}✗ ERROR: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
      failed++;
      failures.push({
        case: testCase,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  // Summary
  console.log(`\n${colors.blue}=== Summary ===${colors.reset}`);
  console.log(`  Total: ${passed + failed}`);
  console.log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${failed}${colors.reset}`);

  if (failures.length > 0) {
    console.log(`\n${colors.yellow}=== Failure Details ===${colors.reset}`);
    for (const failure of failures) {
      console.log(`\n  ${failure.case.name} (${failure.case.id}):`);
      failure.errors.forEach((e) => {
        console.log(`    - ${e}`);
      });
    }
  }

  // Exit with error code if any tests failed
  if (failed > 0) {
    process.exit(1);
  }

  console.log(`\n${colors.green}All golden tests passed!${colors.reset}\n`);
}

// Run tests
runGoldenTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
