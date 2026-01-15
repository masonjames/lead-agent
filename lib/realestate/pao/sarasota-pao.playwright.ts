/**
 * Sarasota County Property Appraiser Playwright Scraper
 *
 * Scrapes property data from https://www.sc-pa.com/propertysearch
 * Uses Playwright to handle the jQuery-based search form and extract
 * property details from the detail page.
 */

import "server-only";
import * as cheerio from "cheerio";
import { withPage, PlaywrightError, detectBlocking } from "@/lib/realestate/playwright/browser";
import { normalizeStreetForUsps } from "@/lib/realestate/address/normalize";
import type { Page } from "playwright-core";
import type {
  PropertyDetails,
  ValuationRecord,
  SaleRecord,
  PropertyBuilding,
  PropertyBasicInfo,
} from "@/lib/realestate/property-types";

// ============================================================================
// Constants
// ============================================================================

const PAO_BASE_URL = "https://www.sc-pa.com";
const PAO_SEARCH_URL = "https://www.sc-pa.com/propertysearch";

const SELECTORS = {
  // Search form
  addressInput: "#AddressKeywords",
  // Multiple fallback selectors for the submit button
  // input[type="submit"] is the primary selector (confirmed working as of Jan 2026)
  searchButtonSelectors: [
    'input[type="submit"]',
    'button[type="submit"]',
    'button.btn-primary',
    'button.btn-search',
    '.search-form button',
    'form button',
    '#search-button',
    '.btn-submit',
  ],

  // Results
  resultsTable: "table.table",
  resultsRows: "table.table tbody tr",
  noResults: ".alert-warning, .alert-info",

  // Detail page
  ownerName: "dl.dl-horizontal dt:contains('Owner') + dd, .owner-info",
  situsAddress: "dl.dl-horizontal dt:contains('Situs') + dd",
  parcelId: "dl.dl-horizontal dt:contains('Parcel') + dd, h4:contains('Parcel')",

  // Tables on detail page
  buildingTable: "table:has(th:contains('Beds'))",
  valuationsTable: "table:has(th:contains('Just'))",
  salesTable: "table:has(th:contains('Transfer Date'))",
  landInfo: "dl.dl-horizontal",
};

// ============================================================================
// Types
// ============================================================================

export interface SarasotaPaoPlaywrightOptions {
  timeoutMs?: number;
  navTimeoutMs?: number;
  debug?: boolean;
}

export interface SarasotaPaoScrapeResult {
  detailUrl: string | null;
  scraped: Partial<PropertyDetails>;
  debug: Record<string, unknown>;
}

interface AddressParts {
  street: string;
  streetNo?: string;
  streetName?: string;
  unit?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

interface SearchRow {
  parcelId: string;
  address: string;
  owner?: string;
  href: string;
}

// ============================================================================
// Address Parsing
// ============================================================================

function parseAddressForSarasota(address: string): AddressParts {
  const parts = address.split(",").map((p) => p.trim());

  let street = parts[0] || "";
  let city: string | undefined;
  let state: string | undefined;
  let zipCode: string | undefined;
  let unit: string | undefined;

  // Extract unit from street (handles #13, Unit 13, Apt 13, Unit #14-209, etc.)
  // Pattern handles:
  // - Simple: #13, Unit 13, Apt 5
  // - With hash: Unit #14, Apt #5
  // - With hyphen: #14-209, Unit 14-209, Unit #14-209 (condo building-unit format)
  // - Alphanumeric: Unit A, Apt 201B, #A-101
  const unitMatch = street.match(/\s*(?:#|Unit|Apt|Suite|Ste)[.\s]*#?([\w-]+)\s*$/i);
  if (unitMatch) {
    unit = unitMatch[1];
    street = street.replace(unitMatch[0], "").trim();
  }

  // Parse city, state, zip from remaining parts
  if (parts.length >= 2) {
    city = parts[1];
  }
  if (parts.length >= 3) {
    // Could be "FL" or "FL 34235"
    const stateZip = parts[2].trim();
    const stateZipMatch = stateZip.match(/^([A-Z]{2})\s*(\d{5})?/i);
    if (stateZipMatch) {
      state = stateZipMatch[1].toUpperCase();
      zipCode = stateZipMatch[2];
    } else if (/^\d{5}/.test(stateZip)) {
      zipCode = stateZip.substring(0, 5);
    }
  }
  if (parts.length >= 4 && !zipCode) {
    const possibleZip = parts[3].trim();
    if (/^\d{5}/.test(possibleZip)) {
      zipCode = possibleZip.substring(0, 5);
    }
  }

  // Extract street number and name
  const streetMatch = street.match(/^(\d+)\s+(.+)$/);
  const streetNo = streetMatch?.[1];
  const streetName = streetMatch ? normalizeStreetForUsps(streetMatch[2]) : normalizeStreetForUsps(street);

  return {
    street,
    streetNo,
    streetName,
    unit,
    city,
    state: state || "FL",
    zipCode,
  };
}

// ============================================================================
// Search Functions
// ============================================================================

async function findSarasotaPaoDetailUrlOnPage(
  page: Page,
  address: string,
  options?: SarasotaPaoPlaywrightOptions
): Promise<{
  detailUrl: string | null;
  parcelId: string | null;
  debug: Record<string, unknown>;
}> {
  const debug: Record<string, unknown> = {};
  const addressParts = parseAddressForSarasota(address);
  debug.addressParts = addressParts;

  try {
    // Navigate to search page with domcontentloaded (faster and more reliable)
    console.log("[Sarasota PAO] Navigating to search page...");
    await page.goto(PAO_SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: options?.navTimeoutMs || 30000,
    });

    // Wait a bit for JavaScript to initialize
    await page.waitForTimeout(1000);

    // Wait for search form to load
    await page.waitForSelector(SELECTORS.addressInput, { timeout: 10000 });
    console.log("[Sarasota PAO] Search form loaded");

    // Build search query - search for street only, match unit from results
    // The PAO site works better when we search without the unit and then
    // match the specific unit from the results list
    const searchQuery = addressParts.street;
    debug.searchQuery = searchQuery;
    debug.targetUnit = addressParts.unit;

    // Fill address field
    console.log(`[Sarasota PAO] Searching for: ${searchQuery}`);
    await page.fill(SELECTORS.addressInput, searchQuery);

    // Wait a moment for autocomplete to settle and dismiss any popups
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape"); // Dismiss autocomplete dropdown if present
    await page.waitForTimeout(200);

    // Try to find and click the submit button using multiple selectors
    let buttonClicked = false;
    for (const selector of SELECTORS.searchButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const isVisible = await button.isVisible();
          if (isVisible) {
            console.log(`[Sarasota PAO] Found submit button with selector: ${selector}`);
            debug.usedButtonSelector = selector;
            await button.click();
            buttonClicked = true;
            break;
          }
        }
      } catch {
        // Continue to next selector
      }
    }

    // If no button found, try submitting with Enter key
    if (!buttonClicked) {
      console.log("[Sarasota PAO] No submit button found, trying Enter key...");
      debug.submittedViaEnter = true;
      await page.press(SELECTORS.addressInput, "Enter");
    }

    // Wait for navigation/results
    console.log("[Sarasota PAO] Waiting for results...");
    await page.waitForLoadState("domcontentloaded", { timeout: options?.navTimeoutMs || 30000 });
    await page.waitForTimeout(1500); // Additional wait for dynamic content

    // Check for blocking
    const content = await page.content();
    const blockCheck = detectBlocking(content);
    if (blockCheck.blocked) {
      throw new PlaywrightError(
        `Sarasota PAO site blocked: ${blockCheck.reason}`,
        "BLOCKED"
      );
    }

    // Check if we're already on a detail page (single result redirect)
    const currentUrl = page.url();
    if (currentUrl.includes("/parcel/details/") || currentUrl.includes("/parcel/")) {
      const parcelMatch = currentUrl.match(/\/parcel(?:\/details)?\/(\d+)/);
      const parcelId = parcelMatch?.[1] || null;
      debug.directRedirect = true;
      debug.parcelId = parcelId;
      return {
        detailUrl: currentUrl,
        parcelId,
        debug,
      };
    }

    // Parse search results
    const resultsHtml = await page.content();
    const rows = parseSearchResults(resultsHtml);
    debug.resultCount = rows.length;

    if (rows.length === 0) {
      // Check for no results message
      const noResults = detectNoResults(resultsHtml);
      if (noResults) {
        debug.noResults = true;
        return { detailUrl: null, parcelId: null, debug };
      }
    }

    // Select best match - pass unit for condo matching
    const best = selectBestResult(rows, address, addressParts.unit);
    debug.bestMatch = best;

    if (!best.href) {
      return { detailUrl: null, parcelId: null, debug };
    }

    // Build full detail URL
    const detailUrl = best.href.startsWith("http")
      ? best.href
      : `${PAO_BASE_URL}${best.href}`;

    return {
      detailUrl,
      parcelId: best.parcelId || null,
      debug,
    };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);

    if (error instanceof PlaywrightError) {
      throw error;
    }

    throw new PlaywrightError(
      `Failed to search Sarasota PAO: ${debug.error}`,
      "NAVIGATION_FAILED",
      error
    );
  }
}

function parseSearchResults(html: string): SearchRow[] {
  const $ = cheerio.load(html);
  const rows: SearchRow[] = [];

  // Look for results table rows
  $("table tbody tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");

    if (cells.length >= 2) {
      // Try to find a link to the detail page
      const link = $row.find("a[href*='/parcel']").first();
      const href = link.attr("href") || "";

      // Extract parcel ID from href or from cell content
      let parcelId = "";
      const parcelMatch = href.match(/\/parcel(?:\/details)?\/(\d+)/);
      if (parcelMatch) {
        parcelId = parcelMatch[1];
      } else {
        // Try first cell
        parcelId = cells.eq(0).text().trim().replace(/\D/g, "");
      }

      const address = cells.eq(1).text().trim() || link.text().trim();
      const owner = cells.length >= 3 ? cells.eq(2).text().trim() : undefined;

      if (href && (parcelId || address)) {
        rows.push({ parcelId, address, owner, href });
      }
    }
  });

  return rows;
}

function detectNoResults(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  return (
    lowerHtml.includes("no results") ||
    lowerHtml.includes("no records found") ||
    lowerHtml.includes("no properties found") ||
    lowerHtml.includes("0 results")
  );
}

function selectBestResult(
  rows: SearchRow[],
  searchAddress: string,
  targetUnit?: string
): { href: string | null; parcelId: string | null; confidence: number } {
  if (rows.length === 0) {
    return { href: null, parcelId: null, confidence: 0 };
  }

  if (rows.length === 1) {
    return { href: rows[0].href, parcelId: rows[0].parcelId, confidence: 0.9 };
  }

  // If we have a target unit, prioritize results that contain that unit
  if (targetUnit) {
    const normalizedUnit = targetUnit.toUpperCase().replace(/[^A-Z0-9]/g, "");

    for (const row of rows) {
      const normalizedRowAddress = row.address.toUpperCase().replace(/[^A-Z0-9]/g, "");

      // Check if the row address contains the unit number
      // Handle formats like: "5692 BENTGRASS DR #14-209" or "5692 BENTGRASS DR UNIT 14-209"
      if (normalizedRowAddress.includes(normalizedUnit)) {
        console.log(`[Sarasota PAO] Found unit match: ${row.address} contains ${targetUnit}`);
        return { href: row.href, parcelId: row.parcelId, confidence: 0.95 };
      }
    }

    // If no exact unit match found, try partial matching (just the unit number without building prefix)
    // e.g., "14-209" might appear as "209" in some cases
    const unitParts = targetUnit.split("-");
    if (unitParts.length > 1) {
      const lastPart = unitParts[unitParts.length - 1].toUpperCase();
      for (const row of rows) {
        const normalizedRowAddress = row.address.toUpperCase();
        // Look for the unit number at the end of the address
        if (normalizedRowAddress.includes(`#${lastPart}`) ||
            normalizedRowAddress.includes(`UNIT ${lastPart}`) ||
            normalizedRowAddress.endsWith(lastPart)) {
          console.log(`[Sarasota PAO] Found partial unit match: ${row.address} contains ${lastPart}`);
          return { href: row.href, parcelId: row.parcelId, confidence: 0.8 };
        }
      }
    }
  }

  // Fallback: Normalize search address for comparison
  const normalizedSearch = searchAddress.toUpperCase().replace(/[^A-Z0-9]/g, "");

  let bestMatch = rows[0];
  let bestScore = 0;

  for (const row of rows) {
    const normalizedRow = row.address.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Simple scoring: count matching characters
    let score = 0;
    const minLen = Math.min(normalizedSearch.length, normalizedRow.length);
    for (let i = 0; i < minLen; i++) {
      if (normalizedSearch[i] === normalizedRow[i]) {
        score++;
      }
    }

    // Bonus for exact length match
    if (normalizedSearch.length === normalizedRow.length) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = row;
    }
  }

  const confidence = Math.min(bestScore / normalizedSearch.length, 1);
  return { href: bestMatch.href, parcelId: bestMatch.parcelId, confidence };
}

// ============================================================================
// Detail Page Extraction
// ============================================================================

async function extractSarasotaPaoPropertyFromDetailPage(
  page: Page,
  detailUrl: string,
  options?: SarasotaPaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { detailUrl };

  try {
    // Navigate to detail page if not already there
    if (!page.url().includes(detailUrl.replace(PAO_BASE_URL, ""))) {
      console.log(`[Sarasota PAO] Navigating to detail page: ${detailUrl}`);
      await page.goto(detailUrl, {
        waitUntil: "networkidle",
        timeout: options?.navTimeoutMs || 30000,
      });
    }

    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");

    // Get page content
    const html = await page.content();

    // Check for blocking
    const blockCheck = detectBlocking(html);
    if (blockCheck.blocked) {
      throw new PlaywrightError(
        `Sarasota PAO blocked on detail page: ${blockCheck.reason}`,
        "BLOCKED"
      );
    }

    // Parse the page
    const scraped = parseDetailPage(html, detailUrl);
    debug.fieldsExtracted = Object.keys(scraped).length;

    return { scraped, debug };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);

    if (error instanceof PlaywrightError) {
      throw error;
    }

    throw new PlaywrightError(
      `Failed to extract Sarasota PAO property: ${debug.error}`,
      "PARSE_ERROR",
      error
    );
  }
}

function parseDetailPage(html: string, detailUrl: string): Partial<PropertyDetails> {
  const $ = cheerio.load(html);
  const property: Partial<PropertyDetails> = {};

  // Extract parcel ID from URL
  const parcelMatch = detailUrl.match(/\/parcel(?:\/details)?\/(\d+)/);
  if (parcelMatch) {
    property.parcelId = parcelMatch[1];
  }

  // Extract from definition lists (dl.dl-horizontal)
  const extractFromDl = (label: string): string | undefined => {
    let value: string | undefined;
    $("dl dt").each((_, dt) => {
      const $dt = $(dt);
      if ($dt.text().toLowerCase().includes(label.toLowerCase())) {
        const $dd = $dt.next("dd");
        if ($dd.length) {
          value = $dd.text().trim();
        }
      }
    });
    return value;
  };

  // Owner
  property.owner = extractFromDl("owner");
  if (!property.owner) {
    // Try alternative selectors
    property.owner = $("h5:contains('Owner')").next().text().trim() ||
                     $(".owner-name").first().text().trim();
  }

  // Situs address
  const situsRaw = extractFromDl("situs");
  if (situsRaw) {
    property.address = situsRaw.split(",")[0]?.trim();
    const parts = situsRaw.split(",");
    if (parts.length >= 2) {
      property.city = parts[1]?.trim();
    }
    // Extract zip from address
    const zipMatch = situsRaw.match(/\b(\d{5})\b/);
    if (zipMatch) {
      property.zipCode = zipMatch[1];
    }
    property.state = "FL";
  }

  // Basic info
  const basicInfo: PropertyBasicInfo = {};

  basicInfo.useCode = extractFromDl("use code") || extractFromDl("property use");
  basicInfo.useDescription = extractFromDl("use") || extractFromDl("property use");
  basicInfo.legalDescription = extractFromDl("legal") || extractFromDl("description");
  basicInfo.subdivision = extractFromDl("subdivision");
  basicInfo.municipality = extractFromDl("municipality");
  basicInfo.situsAddress = situsRaw;

  // Land area
  const landArea = extractFromDl("land area") || extractFromDl("acres");
  if (landArea) {
    const acresMatch = landArea.match(/([\d.]+)\s*(?:ac|acres?)/i);
    if (acresMatch) {
      const acres = parseFloat(acresMatch[1]);
      property.land = {
        lotSizeAcres: acres,
        lotSizeSqFt: Math.round(acres * 43560),
      };
    }
  }

  // Check for homestead
  const exemptions = extractFromDl("exemptions") || "";
  basicInfo.homesteadExemption = exemptions.toLowerCase().includes("homestead");

  property.basicInfo = basicInfo;

  // Extract building info from table
  const buildings = parseBuildingTable($);
  if (buildings.length > 0) {
    const primary = buildings[0];
    property.building = primary;
    property.yearBuilt = primary.yearBuilt;
    property.bedrooms = primary.bedrooms;
    property.bathrooms = primary.bathrooms;
    property.sqft = primary.livingAreaSqFt;
  }

  // Extract valuations
  property.valuations = parseValuationsTable($);
  if (property.valuations.length > 0) {
    const latest = property.valuations[0];
    property.assessedValue = latest.assessed?.total;
    property.marketValue = latest.just?.total;
  }

  // Extract sales history
  property.salesHistory = parseSalesTable($);
  if (property.salesHistory.length > 0) {
    const lastSale = property.salesHistory[0];
    property.lastSaleDate = lastSale.date;
    property.lastSalePrice = lastSale.price;
  }

  return property;
}

function parseBuildingTable($: cheerio.CheerioAPI): PropertyBuilding[] {
  const buildings: PropertyBuilding[] = [];

  // Find building table by header content
  $("table").each((_, table) => {
    const $table = $(table);
    const headers = $table.find("th").map((_, th) => $(th).text().toLowerCase()).get();

    if (headers.some(h => h.includes("beds") || h.includes("bath") || h.includes("living"))) {
      // This is a building table
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length >= 4) {
          const building: PropertyBuilding = {};

          // Parse based on header order - common patterns
          cells.each((idx, cell) => {
            const text = $(cell).text().trim();
            const header = headers[idx] || "";

            if (header.includes("beds") || header.includes("bed")) {
              building.bedrooms = parseInt(text) || undefined;
            } else if (header.includes("bath") && !header.includes("half")) {
              building.bathrooms = parseFloat(text) || undefined;
            } else if (header.includes("half")) {
              building.halfBathrooms = parseInt(text) || undefined;
            } else if (header.includes("year") && header.includes("built")) {
              building.yearBuilt = parseInt(text) || undefined;
            } else if (header.includes("effective")) {
              building.effectiveYearBuilt = parseInt(text) || undefined;
            } else if (header.includes("living") || header.includes("sqft") || header.includes("area")) {
              building.livingAreaSqFt = parseInt(text.replace(/,/g, "")) || undefined;
            } else if (header.includes("gross")) {
              building.totalAreaSqFt = parseInt(text.replace(/,/g, "")) || undefined;
            } else if (header.includes("stories") || header.includes("story")) {
              building.stories = parseFloat(text) || undefined;
            }
          });

          if (Object.keys(building).length > 0) {
            buildings.push(building);
          }
        }
      });
    }
  });

  return buildings;
}

function parseValuationsTable($: cheerio.CheerioAPI): ValuationRecord[] {
  const valuations: ValuationRecord[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headers = $table.find("th").map((_, th) => $(th).text().toLowerCase()).get();

    if (headers.some(h => h.includes("just") || h.includes("assessed") || h.includes("taxable"))) {
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length >= 3) {
          const valuation: ValuationRecord = {};

          cells.each((idx, cell) => {
            const text = $(cell).text().trim();
            const header = headers[idx] || "";
            const numValue = parseMoney(text);

            if (header.includes("year")) {
              valuation.year = parseInt(text) || undefined;
            } else if (header.includes("land")) {
              if (!valuation.just) valuation.just = {};
              valuation.just.land = numValue;
            } else if (header.includes("building") || header.includes("impr")) {
              if (!valuation.just) valuation.just = {};
              valuation.just.building = numValue;
            } else if (header.includes("just") || header.includes("market")) {
              if (!valuation.just) valuation.just = {};
              valuation.just.total = numValue;
            } else if (header.includes("assessed")) {
              if (!valuation.assessed) valuation.assessed = {};
              valuation.assessed.total = numValue;
            } else if (header.includes("taxable")) {
              if (!valuation.taxable) valuation.taxable = {};
              valuation.taxable.total = numValue;
            }
          });

          if (valuation.year) {
            valuations.push(valuation);
          }
        }
      });
    }
  });

  // Sort by year descending
  return valuations.sort((a, b) => (b.year || 0) - (a.year || 0));
}

function parseSalesTable($: cheerio.CheerioAPI): SaleRecord[] {
  const sales: SaleRecord[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headers = $table.find("th").map((_, th) => $(th).text().toLowerCase()).get();

    if (headers.some(h => h.includes("transfer") || h.includes("sale") || h.includes("recorded"))) {
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length >= 2) {
          const sale: SaleRecord = {};

          cells.each((idx, cell) => {
            const text = $(cell).text().trim();
            const header = headers[idx] || "";

            if (header.includes("date") || header.includes("transfer")) {
              sale.date = text;
            } else if (header.includes("price") || header.includes("consideration")) {
              sale.price = parseMoney(text);
            } else if (header.includes("instrument") && header.includes("number")) {
              sale.instrumentNumber = text;
            } else if (header.includes("instrument") && header.includes("type")) {
              sale.deedType = text;
            } else if (header.includes("qual")) {
              sale.qualified = text.toLowerCase().includes("q") ||
                               text.toLowerCase().includes("yes");
            } else if (header.includes("grantor") || header.includes("seller")) {
              sale.grantor = text;
            } else if (header.includes("grantee") || header.includes("buyer")) {
              sale.grantee = text;
            }
          });

          if (sale.date || sale.price) {
            sales.push(sale);
          }
        }
      });
    }
  });

  // Sort by date descending
  return sales.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

function parseMoney(input?: string): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Scrape a property from Sarasota PAO by address.
 * This is the main orchestrator function that handles the full flow.
 */
export async function scrapeSarasotaPaoPropertyByAddressPlaywright(
  address: string,
  options?: SarasotaPaoPlaywrightOptions
): Promise<SarasotaPaoScrapeResult> {
  const timeoutMs = options?.timeoutMs || 60000;

  return withPage(
    async (page) => {
      // Set longer default timeout for navigation
      page.setDefaultTimeout(timeoutMs);

      // Step 1: Find detail URL via search
      const searchResult = await findSarasotaPaoDetailUrlOnPage(page, address, options);

      if (!searchResult.detailUrl) {
        return {
          detailUrl: null,
          scraped: {},
          debug: searchResult.debug,
        };
      }

      // Step 2: Extract property details
      const extractResult = await extractSarasotaPaoPropertyFromDetailPage(
        page,
        searchResult.detailUrl,
        options
      );

      return {
        detailUrl: searchResult.detailUrl,
        scraped: extractResult.scraped,
        debug: {
          ...searchResult.debug,
          ...extractResult.debug,
        },
      };
    },
    { opTimeoutMs: timeoutMs }
  );
}

/**
 * Extract property details from a known Sarasota PAO detail URL.
 */
export async function extractSarasotaPaoPropertyPlaywright(
  detailUrl: string,
  options?: SarasotaPaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const timeoutMs = options?.timeoutMs || 60000;

  return withPage(
    async (page) => {
      page.setDefaultTimeout(timeoutMs);
      return extractSarasotaPaoPropertyFromDetailPage(page, detailUrl, options);
    },
    { opTimeoutMs: timeoutMs }
  );
}
