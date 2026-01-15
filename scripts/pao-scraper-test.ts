#!/usr/bin/env tsx
/**
 * PAO Scraper Test Runner
 *
 * Tests the live PAO scrapers against known addresses to verify they work correctly.
 * Run with: pnpm pao:test
 *
 * Usage:
 *   pnpm pao:test                    - Run all tests
 *   pnpm pao:test --county=sarasota  - Test only Sarasota
 *   pnpm pao:test --county=manatee   - Test only Manatee
 *   pnpm pao:test --debug            - Enable debug screenshots
 */

import { config } from "dotenv";
// Load .env.local first, then .env as fallback
config({ path: ".env.local" });
config(); // Load .env file as fallback

import { chromium, type Browser, type Page } from "playwright-core";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const PLAYWRIGHT_WS_ENDPOINT = process.env.PLAYWRIGHT_WS_ENDPOINT;

interface TestAddress {
  address: string;
  description: string;
  expectFound: boolean;
}

interface CountyTestConfig {
  name: string;
  searchUrl: string;
  selectors: {
    addressInput: string;
    searchButton: string;
    resultsTable?: string;
    noResults?: string;
  };
  addresses: TestAddress[];
}

const COUNTY_CONFIGS: Record<string, CountyTestConfig> = {
  manatee: {
    name: "Manatee County PAO",
    searchUrl: "https://www.manateepao.gov/search/",
    selectors: {
      addressInput: "#Address",
      searchButton: 'input[type="submit"].btn-success, input.btn.btn-success',
      resultsTable: "table.table",
      noResults: ".no-results, .alert-info, .alert-warning",
    },
    addresses: [
      {
        address: "4115 39TH ST W, BRADENTON, FL 34205",
        description: "Single-family residential",
        expectFound: true,
      },
      {
        address: "1234 MAIN ST, BRADENTON, FL 34201",
        description: "Common street name (may find partial matches)",
        expectFound: true, // Site does fuzzy matching, will return results
      },
    ],
  },
  sarasota: {
    name: "Sarasota County PAO",
    searchUrl: "https://www.sc-pa.com/propertysearch",
    selectors: {
      addressInput: "#AddressKeywords",
      searchButton: 'button[type="submit"], input[type="submit"], button.btn-primary, .btn-search',
      resultsTable: "table.table, .search-results table",
      noResults: ".alert-warning, .alert-info, .no-results",
    },
    addresses: [
      {
        address: "2040 Java Plum Ave, Sarasota, FL 34232",
        description: "Single-family residential",
        expectFound: true,
      },
      {
        address: "5701 Long Common Cir #13, Sarasota, FL 34235",
        description: "Condo unit (simple)",
        expectFound: true,
      },
      {
        address: "5692 Bentgrass Dr Unit #14-209, Sarasota, FL 34235",
        description: "Condo unit (building-unit format)",
        expectFound: true,
      },
      {
        address: "5682 Bentgrass Dr #12-103, Sarasota, FL 34235",
        description: "Condo unit (building-unit format, second building)",
        expectFound: true,
      },
      {
        address: "100 FAKE NONEXISTENT ST, SARASOTA, FL 34230",
        description: "Non-existent address",
        expectFound: false,
      },
    ],
  },
};

// ============================================================================
// Terminal Colors
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

// ============================================================================
// Utilities
// ============================================================================

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step: string): void {
  console.log(`  ${colors.dim}→ ${step}${colors.reset}`);
}

function logError(message: string): void {
  console.log(`  ${colors.red}✗ ${message}${colors.reset}`);
}

function logSuccess(message: string): void {
  console.log(`  ${colors.green}✓ ${message}${colors.reset}`);
}

function logWarning(message: string): void {
  console.log(`  ${colors.yellow}⚠ ${message}${colors.reset}`);
}

async function saveScreenshot(page: Page, name: string, debugMode: boolean): Promise<void> {
  if (!debugMode) return;

  const screenshotDir = resolve(__dirname, "../.test-screenshots");
  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = resolve(screenshotDir, `${name}-${timestamp}.png`);

  try {
    await page.screenshot({ path: filepath, fullPage: true });
    logStep(`Screenshot saved: ${filepath}`);
  } catch (error) {
    logWarning(`Failed to save screenshot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function savePageHtml(page: Page, name: string, debugMode: boolean): Promise<void> {
  if (!debugMode) return;

  const screenshotDir = resolve(__dirname, "../.test-screenshots");
  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = resolve(screenshotDir, `${name}-${timestamp}.html`);

  try {
    const html = await page.content();
    writeFileSync(filepath, html);
    logStep(`HTML saved: ${filepath}`);
  } catch (error) {
    logWarning(`Failed to save HTML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Browser Connection
// ============================================================================

async function connectToBrowser(): Promise<Browser> {
  if (!PLAYWRIGHT_WS_ENDPOINT) {
    throw new Error("PLAYWRIGHT_WS_ENDPOINT environment variable not set");
  }

  log(`\n${colors.cyan}Connecting to browser...${colors.reset}`);
  logStep(`Endpoint: ${PLAYWRIGHT_WS_ENDPOINT.substring(0, 50)}...`);

  const browser = await chromium.connectOverCDP(PLAYWRIGHT_WS_ENDPOINT, {
    timeout: 30000,
  });

  logSuccess("Connected to remote browser");
  return browser;
}

// ============================================================================
// Test Functions
// ============================================================================

interface TestResult {
  address: string;
  description: string;
  expectFound: boolean;
  actualFound: boolean;
  passed: boolean;
  error?: string;
  timeTakenMs: number;
  debugInfo: Record<string, unknown>;
}

async function testSearchPage(
  page: Page,
  config: CountyTestConfig,
  debugMode: boolean
): Promise<{ ok: boolean; error?: string; debugInfo: Record<string, unknown> }> {
  const debugInfo: Record<string, unknown> = {};

  try {
    logStep(`Navigating to: ${config.searchUrl}`);
    await page.goto(config.searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await saveScreenshot(page, `${config.name.toLowerCase().replace(/\s+/g, "-")}-search-page`, debugMode);

    // Wait for the address input
    logStep("Waiting for search form...");
    const addressInput = await page.waitForSelector(config.selectors.addressInput, { timeout: 10000 });

    if (!addressInput) {
      return { ok: false, error: "Address input not found", debugInfo };
    }

    logSuccess("Search form loaded");
    debugInfo.addressInputFound = true;

    // Check if search button exists
    const buttonSelectors = config.selectors.searchButton.split(",").map(s => s.trim());
    let searchButton = null;
    let usedSelector = "";

    for (const selector of buttonSelectors) {
      searchButton = await page.$(selector);
      if (searchButton) {
        usedSelector = selector;
        break;
      }
    }

    if (searchButton) {
      logSuccess(`Search button found: ${usedSelector}`);
      debugInfo.searchButtonFound = true;
      debugInfo.searchButtonSelector = usedSelector;
    } else {
      // Try to find any submit button
      const allButtons = await page.$$("button, input[type='submit']");
      debugInfo.allButtonsCount = allButtons.length;

      // Get info about all buttons
      const buttonInfo = [];
      for (const btn of allButtons) {
        const text = await btn.textContent().catch(() => "");
        const type = await btn.getAttribute("type").catch(() => "");
        const className = await btn.getAttribute("class").catch(() => "");
        const id = await btn.getAttribute("id").catch(() => "");
        buttonInfo.push({ text: text?.trim(), type, className, id });
      }
      debugInfo.allButtons = buttonInfo;

      logWarning(`Search button not found with selector: ${config.selectors.searchButton}`);
      logStep(`Found ${allButtons.length} buttons on page`);
      buttonInfo.forEach((b, i) => {
        logStep(`  Button ${i}: text="${b.text}", type="${b.type}", class="${b.className}", id="${b.id}"`);
      });

      // Save HTML for debugging
      await savePageHtml(page, `${config.name.toLowerCase().replace(/\s+/g, "-")}-form-debug`, debugMode);
    }

    return { ok: true, debugInfo };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: errorMsg, debugInfo };
  }
}

async function testAddressSearch(
  page: Page,
  config: CountyTestConfig,
  testAddress: TestAddress,
  debugMode: boolean
): Promise<TestResult> {
  const startTime = Date.now();
  const debugInfo: Record<string, unknown> = {};

  try {
    // Navigate to search page
    logStep(`Navigating to search page...`);
    await page.goto(config.searchUrl, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for form
    await page.waitForSelector(config.selectors.addressInput, { timeout: 10000 });

    // Extract street portion only (no city/state/zip for search)
    let streetPart = testAddress.address.split(",")[0].trim();

    // For Sarasota, search for street only (without unit) and match unit from results
    // The actual scraper searches for street only and then matches units from the results list
    if (config.name.includes("Sarasota")) {
      const unitMatch = streetPart.match(/\s*(?:#|Unit|Apt|Suite|Ste)[.\s]*#?([\w-]+)\s*$/i);
      if (unitMatch) {
        // Remove unit from search, we'll match it from results
        streetPart = streetPart.replace(unitMatch[0], "").trim();
      }
    }

    logStep(`Searching for: ${streetPart}`);

    // Fill the address field
    await page.fill(config.selectors.addressInput, streetPart);
    await page.waitForTimeout(500);

    await saveScreenshot(page, `search-filled-${streetPart.replace(/\s+/g, "-").substring(0, 20)}`, debugMode);

    // Find and click search button
    const buttonSelectors = config.selectors.searchButton.split(",").map(s => s.trim());
    let searchButton = null;

    for (const selector of buttonSelectors) {
      searchButton = await page.$(selector);
      if (searchButton) {
        debugInfo.usedButtonSelector = selector;
        break;
      }
    }

    if (!searchButton) {
      // Try alternative methods to submit
      // Method 1: Press Enter in the input field
      logStep("No submit button found, trying Enter key...");
      await page.press(config.selectors.addressInput, "Enter");
    } else {
      await searchButton.click();
    }

    // Wait for results
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.waitForTimeout(1000);

    await saveScreenshot(page, `search-results-${streetPart.replace(/\s+/g, "-").substring(0, 20)}`, debugMode);

    // Check results
    const currentUrl = page.url();
    debugInfo.resultUrl = currentUrl;

    const pageContent = await page.content();
    const lowerContent = pageContent.toLowerCase();

    // Check if we're on a detail page (property found)
    const isDetailPage =
      currentUrl.includes("parid=") ||
      currentUrl.includes("/parcel/") ||
      currentUrl.includes("/details/");

    // Check for no results message
    const hasNoResults =
      lowerContent.includes("no results") ||
      lowerContent.includes("no records found") ||
      lowerContent.includes("no properties found") ||
      lowerContent.includes("0 results") ||
      lowerContent.includes("no matching");

    // Check for results table with actual rows
    let hasResultsWithData = false;
    if (config.selectors.resultsTable) {
      const resultsTable = await page.$(config.selectors.resultsTable);
      if (resultsTable) {
        // Count actual data rows (not header rows)
        const dataRows = await page.$$(`${config.selectors.resultsTable} tbody tr`);
        const rowCount = dataRows.length;
        debugInfo.resultRowCount = rowCount;
        hasResultsWithData = rowCount > 0;
      }
    }

    // Fallback: check for any parcel links on the page (more robust detection)
    if (!hasResultsWithData && !isDetailPage) {
      const parcelLinks = await page.$$('a[href*="/parcel/"]');
      debugInfo.parcelLinkCount = parcelLinks.length;
      if (parcelLinks.length > 0) {
        hasResultsWithData = true;
      }
    }

    debugInfo.isDetailPage = isDetailPage;
    debugInfo.hasNoResults = hasNoResults;
    debugInfo.hasResultsWithData = hasResultsWithData;

    const actualFound = isDetailPage || (hasResultsWithData && !hasNoResults);
    const passed = actualFound === testAddress.expectFound;

    return {
      address: testAddress.address,
      description: testAddress.description,
      expectFound: testAddress.expectFound,
      actualFound,
      passed,
      timeTakenMs: Date.now() - startTime,
      debugInfo,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      address: testAddress.address,
      description: testAddress.description,
      expectFound: testAddress.expectFound,
      actualFound: false,
      passed: !testAddress.expectFound, // If we expect not found and got error, that might be okay
      error: errorMsg,
      timeTakenMs: Date.now() - startTime,
      debugInfo,
    };
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests(): Promise<void> {
  // Parse arguments
  const args = process.argv.slice(2);
  const countyArg = args.find(a => a.startsWith("--county="))?.split("=")[1]?.toLowerCase();
  const debugMode = args.includes("--debug");

  const countiesToTest = countyArg
    ? [countyArg]
    : Object.keys(COUNTY_CONFIGS);

  // Validate county arg
  if (countyArg && !COUNTY_CONFIGS[countyArg]) {
    log(`\n${colors.red}Unknown county: ${countyArg}${colors.reset}`);
    log(`Available counties: ${Object.keys(COUNTY_CONFIGS).join(", ")}`);
    process.exit(1);
  }

  log(`\n${colors.blue}${colors.bold}=== PAO Scraper Tests ===${colors.reset}`);
  log(`${colors.dim}Testing counties: ${countiesToTest.join(", ")}${colors.reset}`);
  if (debugMode) {
    log(`${colors.yellow}Debug mode enabled - screenshots will be saved${colors.reset}`);
  }

  // Check for Playwright endpoint
  if (!PLAYWRIGHT_WS_ENDPOINT) {
    log(`\n${colors.red}ERROR: PLAYWRIGHT_WS_ENDPOINT environment variable not set${colors.reset}`);
    log(`${colors.dim}This is required to connect to the remote browser service.${colors.reset}`);
    process.exit(1);
  }

  let browser: Browser | null = null;
  const results: Map<string, TestResult[]> = new Map();

  try {
    browser = await connectToBrowser();

    for (const countyKey of countiesToTest) {
      const config = COUNTY_CONFIGS[countyKey];
      log(`\n${colors.cyan}${colors.bold}--- ${config.name} ---${colors.reset}`);

      const countyResults: TestResult[] = [];

      // Create a new context for each county
      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
      });

      context.setDefaultTimeout(30000);
      context.setDefaultNavigationTimeout(30000);

      const page = await context.newPage();

      try {
        // First, test that the search page loads correctly
        log(`\n${colors.yellow}Testing search page...${colors.reset}`);
        const pageTest = await testSearchPage(page, config, debugMode);

        if (!pageTest.ok) {
          logError(`Search page test failed: ${pageTest.error}`);
          console.log(`  ${colors.dim}Debug info:${colors.reset}`, JSON.stringify(pageTest.debugInfo, null, 2));
          continue;
        }

        // Test each address
        log(`\n${colors.yellow}Testing addresses...${colors.reset}`);

        for (const testAddress of config.addresses) {
          log(`\n${colors.bold}Address: ${testAddress.address}${colors.reset}`);
          log(`${colors.dim}${testAddress.description} (expect ${testAddress.expectFound ? "found" : "not found"})${colors.reset}`);

          // Create a fresh page for each search to avoid state issues
          const searchPage = await context.newPage();

          try {
            const result = await testAddressSearch(searchPage, config, testAddress, debugMode);
            countyResults.push(result);

            if (result.passed) {
              logSuccess(`PASSED (${result.timeTakenMs}ms) - ${result.actualFound ? "Found" : "Not found"}`);
            } else {
              logError(`FAILED (${result.timeTakenMs}ms) - Expected ${result.expectFound ? "found" : "not found"}, got ${result.actualFound ? "found" : "not found"}`);
              if (result.error) {
                logError(`Error: ${result.error}`);
              }
            }

            if (debugMode || !result.passed) {
              console.log(`  ${colors.dim}Debug info:${colors.reset}`, JSON.stringify(result.debugInfo, null, 2));
            }
          } finally {
            await searchPage.close();
          }

          // Small delay between tests
          await new Promise(r => setTimeout(r, 1000));
        }
      } finally {
        await context.close();
      }

      results.set(countyKey, countyResults);
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  // Print summary
  log(`\n${colors.blue}${colors.bold}=== Test Summary ===${colors.reset}`);

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [county, countyResults] of results) {
    const passed = countyResults.filter(r => r.passed).length;
    const failed = countyResults.filter(r => !r.passed).length;
    totalPassed += passed;
    totalFailed += failed;

    log(`\n${colors.cyan}${COUNTY_CONFIGS[county].name}:${colors.reset}`);
    log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
    log(`  ${colors.red}Failed: ${failed}${colors.reset}`);

    // Show failed tests
    const failedTests = countyResults.filter(r => !r.passed);
    if (failedTests.length > 0) {
      log(`\n  ${colors.yellow}Failed tests:${colors.reset}`);
      for (const test of failedTests) {
        log(`    - ${test.address}`);
        if (test.error) {
          log(`      ${colors.red}Error: ${test.error}${colors.reset}`);
        }
      }
    }
  }

  log(`\n${colors.blue}${colors.bold}Overall:${colors.reset}`);
  log(`  Total: ${totalPassed + totalFailed}`);
  log(`  ${colors.green}Passed: ${totalPassed}${colors.reset}`);
  log(`  ${colors.red}Failed: ${totalFailed}${colors.reset}`);

  if (totalFailed > 0) {
    log(`\n${colors.red}Some tests failed!${colors.reset}`);
    process.exit(1);
  }

  log(`\n${colors.green}All tests passed!${colors.reset}\n`);
}

// Run tests
runTests().catch((error) => {
  console.error(`\n${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
