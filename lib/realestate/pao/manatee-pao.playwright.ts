/**
 * Manatee County PAO Scraper - Playwright Implementation
 *
 * Replaces Firecrawl-based automation with Playwright for more reliable
 * form filling and deterministic result parsing.
 *
 * Key improvements over Firecrawl:
 * - Deterministic HTML parsing (no LLM hallucination)
 * - Proper "no results" detection
 * - Better error handling and debugging
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  PropertyLand,
  PropertyBasicInfo,
  ExtraFeatureRecord,
  InspectionRecord,
} from "@/lib/realestate/property-types";

// ============================================================================
// Configuration
// ============================================================================

const PAO_SEARCH_URL = "https://www.manateepao.gov/search/";
const PAO_BASE_URL = "https://www.manateepao.gov";

// Form field selectors (discovered via browser inspection)
const SELECTORS = {
  // Text inputs
  ownerLast: "#OwnLast",
  ownerFirst: "#OwnFirst",
  parcelId: "#ParcelId",
  address: "#Address",
  zipCode: "#Zip",
  // Dropdowns
  rollType: "#RollType",
  postalCity: "#PostalCity",
  // Submit button
  submit: 'input[type="submit"].btn-success, input.btn.btn-success',
  // Results table
  resultsTable: "table.table, .search-results table, #searchResults table",
  resultsRow: "tbody tr",
  // No results indicator
  noResults: ".no-results, .alert-info, .alert-warning",
  // Owner content section (main page, NOT iframe)
  ownerContent: ".owner-content, #ownerContent",
  // Tab navigation (click to reveal content)
  tabs: {
    sales: "#sales-nav",
    values: "#valueHistory-nav",
    buildings: "#buildings-nav",
    features: "#features-nav",
    inspections: "#inspections-nav",
  },
  // Data tables (appear after clicking tabs)
  tables: {
    sales: "#tableSales",
    values: "#tableValue",
    buildings: "#tableBuildings",
    features: "#tableFeatures",
    inspections: "#tableInspections",
  },
};

// ============================================================================
// Types
// ============================================================================

export interface ManateePaoPlaywrightOptions {
  timeoutMs?: number;
  navTimeoutMs?: number;
  debug?: boolean;
}

/** Result from finding a detail URL */
export interface ManateePaoDetailUrlResult {
  detailUrl: string | null;
  debug: Record<string, unknown>;
}

/** Result from the combined search + extract orchestrator */
export interface ManateePaoScrapeResult {
  detailUrl: string | null;
  scraped: Partial<PropertyDetails>;
  debug: Record<string, unknown>;
}

interface SearchRow {
  href: string | null;
  text: string;
  parcelId: string | null;
}

interface AddressParts {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

// ============================================================================
// Main Page Data Extraction
// ============================================================================

/**
 * Extract owner/property info from the main page .owner-content section
 */
async function extractOwnerInfoFromMainPage(page: Page): Promise<string | null> {
  console.log("[PAO Playwright] Extracting owner info from main page...");

  try {
    const ownerContent = await page.$(SELECTORS.ownerContent);
    if (ownerContent) {
      const html = await page.evaluate((el) => el.innerHTML, ownerContent);
      console.log(`[PAO Playwright] Found owner content: ${html?.length || 0} chars`);
      return html;
    }
  } catch {
    console.log("[PAO Playwright] Could not find owner content section");
  }

  return null;
}

/**
 * Click a tab and extract the corresponding table
 */
async function clickTabAndExtractTable(
  page: Page,
  tabSelector: string,
  tableSelector: string,
  description: string
): Promise<string | null> {
  try {
    // First check if table is already visible (tab might be active)
    let table = await page.$(tableSelector);
    if (table) {
      const html = await page.evaluate((el) => el.outerHTML, table);
      const rowCount = await page.evaluate((sel) => {
        const t = document.querySelector(sel);
        return t?.querySelectorAll("tbody tr").length || 0;
      }, tableSelector);

      if (rowCount > 0) {
        console.log(`[PAO Playwright] ${description} table already visible: ${rowCount} rows, ${html?.length || 0} chars`);
        return html;
      }
    }

    // Table not visible or empty, need to click tab
    console.log(`[PAO Playwright] Clicking ${description} tab (${tabSelector})...`);
    const tab = await page.$(tabSelector);
    if (!tab) {
      console.log(`[PAO Playwright] ${description} tab not found: ${tabSelector}`);
      return null;
    }

    // Check if tab is disabled (already active)
    const isDisabled = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el?.hasAttribute("disabled") || el?.classList.contains("disabled");
    }, tabSelector);

    if (!isDisabled) {
      await tab.click();
      await page.waitForTimeout(800);
    } else {
      console.log(`[PAO Playwright] ${description} tab is active/disabled, reading table directly`);
    }

    // Wait for the table to appear
    try {
      await page.waitForSelector(tableSelector, { timeout: 3000 });
    } catch {
      console.log(`[PAO Playwright] Table ${tableSelector} not found after ${isDisabled ? 'checking' : 'clicking'} ${description} tab`);
      return null;
    }

    // Extract the table HTML
    table = await page.$(tableSelector);
    if (table) {
      const html = await page.evaluate((el) => el.outerHTML, table);
      console.log(`[PAO Playwright] ${description} table: ${html?.length || 0} chars`);
      return html;
    }

    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`[PAO Playwright] Failed to extract ${description}: ${msg}`);
    return null;
  }
}

/**
 * Extract data from all sections on the main page
 */
async function extractMainPageSections(
  page: Page
): Promise<{
  ownerHtml: string | null;
  salesHtml: string | null;
  valuesHtml: string | null;
  buildingsHtml: string | null;
  featuresHtml: string | null;
  inspectionsHtml: string | null;
}> {
  console.log("[PAO Playwright] Extracting main page sections...");

  const ownerHtml = await extractOwnerInfoFromMainPage(page);

  const salesHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.sales,
    SELECTORS.tables.sales,
    "Sales"
  );

  const inspectionsHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.inspections,
    SELECTORS.tables.inspections,
    "Inspections"
  );

  const valuesHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.values,
    SELECTORS.tables.values,
    "Values"
  );

  const buildingsHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.buildings,
    SELECTORS.tables.buildings,
    "Buildings"
  );

  const featuresHtml = await clickTabAndExtractTable(
    page,
    SELECTORS.tabs.features,
    SELECTORS.tables.features,
    "Features"
  );

  console.log(`[PAO Playwright] Main page sections extracted:`, {
    owner: ownerHtml ? `${ownerHtml.length} chars` : "NOT FOUND",
    sales: salesHtml ? `${salesHtml.length} chars` : "not found",
    values: valuesHtml ? `${valuesHtml.length} chars` : "not found",
    buildings: buildingsHtml ? `${buildingsHtml.length} chars` : "not found",
    features: featuresHtml ? `${featuresHtml.length} chars` : "not found",
    inspections: inspectionsHtml ? `${inspectionsHtml.length} chars` : "not found",
  });

  return { ownerHtml, salesHtml, valuesHtml, buildingsHtml, featuresHtml, inspectionsHtml };
}

// ============================================================================
// HTML Parsing Functions
// ============================================================================

function parseExtraFeaturesFromHtml(html: string): ExtraFeatureRecord[] {
  const $ = cheerio.load(html);
  const features: ExtraFeatureRecord[] = [];

  $("table tr, .feature-row, li").each((_, row) => {
    const $row = $(row);
    const text = $row.text().trim();
    if ($row.find("th").length > 0 || !text) return;

    const cells = $row.find("td");
    if (cells.length >= 1) {
      const description = $(cells[0]).text().trim();
      if (!description) return;

      const feature: ExtraFeatureRecord = { description };

      cells.each((i, cell) => {
        if (i === 0) return;
        const cellText = $(cell).text().trim();

        const yearMatch = cellText.match(/\b(19|20)\d{2}\b/);
        if (yearMatch && !feature.year) {
          feature.year = parseInt(yearMatch[0], 10);
        }

        const areaMatch = cellText.match(/([\d,]+)\s*(?:sq\s*ft|SF)/i);
        if (areaMatch && !feature.areaSqFt) {
          feature.areaSqFt = parseNumber(areaMatch[1]);
        }

        const valueMatch = cellText.match(/\$[\d,]+/);
        if (valueMatch && !feature.value) {
          feature.value = parseMoney(valueMatch[0]);
        }
      });

      features.push(feature);
    }
  });

  return features;
}

function parseInspectionsFromHtml(html: string): InspectionRecord[] {
  const $ = cheerio.load(html);
  const inspections: InspectionRecord[] = [];

  $("table tr").each((_, row) => {
    const $row = $(row);
    if ($row.find("th").length > 0) return;

    const cells = $row.find("td");
    if (cells.length >= 2) {
      const inspection: InspectionRecord = {};

      cells.each((i, cell) => {
        const cellText = $(cell).text().trim();
        if (!cellText) return;

        if (!inspection.date && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(cellText)) {
          inspection.date = cellText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)?.[0];
        } else if (i <= 1 && !inspection.type && cellText.length > 2 && cellText.length < 50) {
          inspection.type = cellText;
        } else if (!inspection.result && /pass|fail|complete|pending|approved/i.test(cellText)) {
          inspection.result = cellText;
        } else if (!inspection.inspector && /^[A-Z][a-z]+ [A-Z]/.test(cellText)) {
          inspection.inspector = cellText;
        } else if (!inspection.notes && cellText.length > 20) {
          inspection.notes = cellText;
        }
      });

      if (inspection.date || inspection.type) {
        inspections.push(inspection);
      }
    }
  });

  return inspections;
}

function parseBuildingsFromHtml(html: string): Partial<PropertyDetails> {
  const $ = cheerio.load(html);
  const details: Partial<PropertyDetails> = {
    building: {},
  };

  const dataRow = $("table tbody tr").first();
  if (!dataRow.length) {
    return details;
  }

  const cells = dataRow.find("td");

  const getValue = (index: number): string => {
    return cells.eq(index).text().trim();
  };

  const yearBuilt = getValue(3);
  if (yearBuilt && /^\d{4}$/.test(yearBuilt)) {
    details.building!.yearBuilt = parseInt(yearBuilt, 10);
  }

  const effYear = getValue(4);
  if (effYear && /^\d{4}$/.test(effYear)) {
    details.building!.effectiveYearBuilt = parseInt(effYear, 10);
  }

  const stories = getValue(5);
  if (stories) {
    const storiesNum = parseFloat(stories);
    if (!isNaN(storiesNum)) {
      details.building!.stories = storiesNum;
    }
  }

  const underRoof = getValue(6);
  if (underRoof) {
    const sqft = parseNumber(underRoof);
    if (sqft) {
      details.building!.totalAreaSqFt = sqft;
    }
  }

  const livBus = getValue(7);
  if (livBus) {
    const sqft = parseNumber(livBus);
    if (sqft) {
      details.building!.livingAreaSqFt = sqft;
    }
  }

  const rooms = getValue(8);
  if (rooms) {
    const roomParts = rooms.split("/");
    if (roomParts.length >= 2) {
      const bedrooms = parseInt(roomParts[0], 10);
      const bathrooms = parseInt(roomParts[1], 10);
      const halfBaths = roomParts[2] ? parseInt(roomParts[2], 10) : 0;

      if (!isNaN(bedrooms)) {
        details.building!.bedrooms = bedrooms;
      }
      if (!isNaN(bathrooms)) {
        details.building!.bathrooms = bathrooms + (halfBaths * 0.5);
        details.building!.fullBathrooms = bathrooms;
        details.building!.halfBathrooms = halfBaths;
      }
    }
  }

  const construction = getValue(9);
  if (construction) {
    const parts = construction.split("/");
    details.building!.constructionType = parts[0]?.trim();
    if (parts[1]) {
      details.building!.exteriorWalls = parts[1].trim();
    }
  }

  const roofMaterial = getValue(10);
  if (roofMaterial) {
    details.building!.roofCover = roofMaterial;
  }

  const roofType = getValue(11);
  if (roofType) {
    details.building!.roofStructure = roofType;
  }

  return details;
}

function parseOwnerInfoFromMainPageHtml(html: string): Partial<PropertyDetails> {
  const $ = cheerio.load(html);
  const details: Partial<PropertyDetails> = {
    basicInfo: {},
    building: {},
    land: {},
  };

  // Build a map of label -> value by traversing Bootstrap row/col structure
  // This is the primary method used by the current PAO website
  const fieldMap: Record<string, string> = {};

  $(".row").each((_, row) => {
    const cols = $(row).find("[class*='col']");
    if (cols.length >= 2) {
      const label = $(cols[0]).text().trim().replace(/:$/, "");
      const value = $(cols[1]).text().trim();
      if (label && value && label.length < 50 && value.length < 500) {
        // Normalize label to lowercase for easier matching
        fieldMap[label.toLowerCase()] = value;
      }
    }
  });

  console.log(`[PAO Playwright] Parsed ${Object.keys(fieldMap).length} fields from owner content`);

  const extractFieldFromMap = (labels: string[]): string | undefined => {
    for (const label of labels) {
      const lowerLabel = label.toLowerCase();
      // Try exact match first
      if (fieldMap[lowerLabel]) {
        return fieldMap[lowerLabel];
      }
      // Try partial match
      for (const [key, value] of Object.entries(fieldMap)) {
        if (key.includes(lowerLabel) || lowerLabel.includes(key)) {
          return value;
        }
      }
    }
    return undefined;
  };

  // Fallback: search in raw HTML for labels that might not be in rows
  const extractFieldFromDom = (labels: string[]): string | undefined => {
    // First try the field map (primary method)
    const mapResult = extractFieldFromMap(labels);
    if (mapResult) return mapResult;

    // Fallback to DOM traversal for edge cases
    for (const label of labels) {
      const lowerLabel = label.toLowerCase();
      let found: string | undefined;

      // Try dt/dd pairs
      const ddValue = $(`dt:contains("${label}")`).next("dd").text().trim();
      if (ddValue) return ddValue;

      // Try table cells
      $("tr").each((_, row) => {
        const cells = $(row).find("td, th");
        cells.each((i, cell) => {
          if ($(cell).text().toLowerCase().includes(lowerLabel) && cells[i + 1]) {
            const value = $(cells[i + 1]).text().trim();
            if (value && value !== "-" && value !== "N/A") {
              found = value;
              return false;
            }
          }
        });
        if (found) return false;
      });

      if (found) return found;

      // Try text content matching
      $("div, span, p").each((_, el) => {
        const text = $(el).text();
        const labelIndex = text.toLowerCase().indexOf(lowerLabel);
        if (labelIndex !== -1) {
          const afterLabel = text.substring(labelIndex + label.length);
          const cleaned = afterLabel.replace(/^[:\s]+/, '').split('\n')[0].trim();
          if (cleaned && cleaned.length > 0 && cleaned.length < 200 && !/^[A-Z][a-z]+:/.test(cleaned)) {
            found = cleaned;
            return false;
          }
        }
      });

      if (found) return found;
    }
    return undefined;
  };

  const cleanValue = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    return value
      .replace(/Go to.*$/i, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const ownership = extractFieldFromDom(['Ownership', 'Owner']);
  if (ownership) {
    const ownerName = ownership.split(/[;\n]/)[0].trim();
    details.owner = ownerName.replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}.*$/, '').trim();
  }

  const ownerType = cleanValue(extractFieldFromDom(['Owner Type']));
  if (ownerType && details.basicInfo) {
    details.basicInfo.ownerType = ownerType;
  }

  const situsAddress = cleanValue(extractFieldFromDom(['Situs Address', 'Property Address', 'Site Address']));
  if (situsAddress) {
    details.address = situsAddress;
    const addressMatch = situsAddress.match(/^(.+?),\s*([A-Z]+)\s+(\d{5}(?:-\d{4})?)/i) ||
                         situsAddress.match(/^(.+?),\s*([^,]+),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i);
    if (addressMatch) {
      if (addressMatch.length === 5) {
        details.city = addressMatch[2]?.trim();
        details.state = addressMatch[3];
        details.zipCode = addressMatch[4];
      } else {
        const streetCity = addressMatch[1];
        const lastComma = streetCity.lastIndexOf(',');
        if (lastComma !== -1) {
          details.city = streetCity.substring(lastComma + 1).trim();
        }
        details.state = addressMatch[2];
        details.zipCode = addressMatch[3];
      }
    }
  }

  const jurisdiction = cleanValue(extractFieldFromDom(['Jurisdiction']));
  if (jurisdiction && details.basicInfo) {
    details.basicInfo.jurisdiction = jurisdiction;
  }

  const taxDistrict = cleanValue(extractFieldFromDom(['Tax District']));
  if (taxDistrict && details.basicInfo) {
    details.basicInfo.taxDistrict = taxDistrict;
  }

  const neighborhood = cleanValue(extractFieldFromDom(['Neighborhood']));
  if (neighborhood && details.basicInfo) {
    details.basicInfo.neighborhood = neighborhood;
  }

  const subdivision = cleanValue(extractFieldFromDom(['Subdivision']));
  if (subdivision && details.basicInfo) {
    details.basicInfo.subdivision = subdivision;
  }

  const landUse = cleanValue(extractFieldFromDom(['Land Use']));
  if (landUse && details.land) {
    details.land.landUse = landUse;
  }

  const landSize = extractFieldFromDom(['Land Size']);
  if (landSize && details.land) {
    const acresMatch = landSize.match(/([\d.]+)\s*Acres?/i);
    if (acresMatch) {
      details.land.lotSizeAcres = parseFloat(acresMatch[1]);
    }
    const sqftMatch = landSize.match(/([\d,]+)\s*(?:Square\s*Feet|Sq\s*Ft|SF)/i);
    if (sqftMatch) {
      details.land.lotSizeSqFt = parseNumber(sqftMatch[1]);
    }
  }

  const buildingArea = extractFieldFromDom(['Building Area']);
  if (buildingArea && details.building) {
    const underRoofMatch = buildingArea.match(/([\d,]+)\s*(?:SqFt|Sq\s*Ft|SF)?\s*Under\s*Roof/i);
    if (underRoofMatch) {
      details.building.totalAreaSqFt = parseNumber(underRoofMatch[1]);
    }
    const livingMatch = buildingArea.match(/([\d,]+)\s*(?:SqFt|Sq\s*Ft|SF)?\s*Living/i);
    if (livingMatch) {
      details.building.livingAreaSqFt = parseNumber(livingMatch[1]);
    }
  }

  const livingUnits = extractFieldFromDom(['Living Units']);
  if (livingUnits) {
    const units = parseInt(livingUnits, 10);
    if (!isNaN(units) && details.basicInfo) {
      details.basicInfo.livingUnits = units;
    }
  }

  const shortDesc = cleanValue(extractFieldFromDom(['Short Description']));
  if (shortDesc && details.basicInfo) {
    details.basicInfo.shortDescription = shortDesc;
  }

  return details;
}

async function extractSupplementalFromMainPage(
  page: Page
): Promise<Partial<PropertyDetails>> {
  const sections = await extractMainPageSections(page);
  let supplemental: Partial<PropertyDetails> = {};

  if (sections.ownerHtml) {
    supplemental = parseOwnerInfoFromMainPageHtml(sections.ownerHtml);
    console.log(`[PAO Playwright] Parsed owner info: ${supplemental.owner || 'unknown'}`);
  }

  if (sections.valuesHtml) {
    const $values = cheerio.load(sections.valuesHtml);
    supplemental.valuations = parseValuationsTable($values);
    console.log(`[PAO Playwright] Parsed ${supplemental.valuations?.length || 0} valuation records`);
  }

  if (sections.salesHtml) {
    const $sales = cheerio.load(sections.salesHtml);
    supplemental.salesHistory = parseSalesTable($sales);
    console.log(`[PAO Playwright] Parsed ${supplemental.salesHistory?.length || 0} sale records`);
  }

  if (sections.buildingsHtml) {
    const buildingInfo = parseBuildingsFromHtml(sections.buildingsHtml);
    if (buildingInfo.building) {
      supplemental.building = { ...supplemental.building, ...buildingInfo.building };
      console.log(`[PAO Playwright] Parsed building info: ${buildingInfo.building.bedrooms || 0} bed, ${buildingInfo.building.bathrooms || 0} bath`);
    }
  }

  if (sections.featuresHtml) {
    const paoExtraFeatures = parseExtraFeaturesFromHtml(sections.featuresHtml);
    if (paoExtraFeatures.length > 0) {
      supplemental.extras = { ...supplemental.extras, paoExtraFeatures };
      console.log(`[PAO Playwright] Parsed ${paoExtraFeatures.length} extra features`);
    }
  }

  if (sections.inspectionsHtml) {
    const inspections = parseInspectionsFromHtml(sections.inspectionsHtml);
    if (inspections.length > 0) {
      supplemental.extras = { ...supplemental.extras, inspections };
      console.log(`[PAO Playwright] Parsed ${inspections.length} inspection records`);
    }
  }

  return supplemental;
}

// ============================================================================
// Page-Scoped Primitives
// ============================================================================

async function findManateePaoDetailUrlOnPage(
  page: Page,
  address: string,
  options?: ManateePaoPlaywrightOptions
): Promise<{
  detailUrl: string | null;
  addressFound: boolean;
  alreadyOnDetailPage: boolean;
  debug: Record<string, unknown>;
}> {
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    address,
    startTime: new Date().toISOString(),
  };

  const parsedAddress = parseAddress(address);
  debug.parsedAddress = parsedAddress;

  console.log("[PAO Playwright] Navigating to search page...");
  await page.goto(PAO_SEARCH_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector(SELECTORS.address, { timeout: 10000 });
  console.log("[PAO Playwright] Search form loaded");

  const pageContent = await page.content();
  const blockCheck = detectBlocking(pageContent);
  if (blockCheck.blocked) {
    throw new PlaywrightError(
      `PAO site blocking detected: ${blockCheck.reason}`,
      "BLOCKED"
    );
  }

  await fillSearchForm(page, parsedAddress);
  console.log("[PAO Playwright] Form filled, submitting...");

  const submitButton = await page.$(SELECTORS.submit);
  if (!submitButton) {
    throw new PlaywrightError("Submit button not found", "PARSE_ERROR");
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: navTimeoutMs }),
    submitButton.click(),
  ]);

  try {
    await page.waitForSelector(
      `${SELECTORS.ownerContent}, ${SELECTORS.resultsTable}, ${SELECTORS.noResults}, table.table`,
      { timeout: navTimeoutMs }
    );
  } catch {
    console.log("[PAO Playwright] No specific result indicator found, continuing...");
  }

  await page.waitForTimeout(1000);

  const resultsHtml = await page.content();
  const currentUrl = page.url();
  debug.resultsPageLength = resultsHtml.length;
  debug.resultsUrl = currentUrl;

  const directParcelMatch = currentUrl.match(/[?&]parid=(\d{9,10})/i);
  if (directParcelMatch) {
    console.log(`[PAO Playwright] Direct navigation to detail page! Parcel ID: ${directParcelMatch[1]}`);
    return {
      detailUrl: currentUrl,
      addressFound: true,
      alreadyOnDetailPage: true,
      debug,
    };
  }

  const resultsBlockCheck = detectBlocking(resultsHtml);
  if (resultsBlockCheck.blocked) {
    throw new PlaywrightError(
      `PAO site blocking on results: ${resultsBlockCheck.reason}`,
      "BLOCKED"
    );
  }

  const rows = parseSearchResults(resultsHtml);
  debug.rowsFound = rows.length;

  if (rows.length === 0) {
    debug.noResultsDetected = detectNoResults(resultsHtml);
    return { detailUrl: null, addressFound: false, alreadyOnDetailPage: false, debug };
  }

  const match = selectBestResult(rows, address);
  debug.matchResult = match;

  if (!match.href) {
    return { detailUrl: null, addressFound: match.addressFound, alreadyOnDetailPage: false, debug };
  }

  const detailUrl = match.href.startsWith("http")
    ? match.href
    : `${PAO_BASE_URL}${match.href.startsWith("/") ? "" : "/"}${match.href}`;

  return {
    detailUrl,
    addressFound: match.addressFound,
    alreadyOnDetailPage: false,
    debug,
  };
}

async function extractManateePaoPropertyFromDetailPage(
  page: Page,
  detailUrl: string,
  _options?: ManateePaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {
    detailUrl,
    startTime: new Date().toISOString(),
  };

  const outerHtml = await page.content();
  debug.outerHtmlLength = outerHtml.length;

  const blockCheck = detectBlocking(outerHtml);
  if (blockCheck.blocked) {
    throw new PlaywrightError(
      `PAO detail page blocking: ${blockCheck.reason}`,
      "BLOCKED"
    );
  }

  console.log("[PAO Playwright] Extracting property data from main page tabs...");
  try {
    const scraped = await extractSupplementalFromMainPage(page);

    debug.mainPageSectionsExtracted = true;
    debug.valuations = scraped.valuations?.length || 0;
    debug.salesHistory = scraped.salesHistory?.length || 0;
    debug.extraFeatures = scraped.extras?.paoExtraFeatures?.length || 0;
    debug.inspections = scraped.extras?.inspections?.length || 0;
    debug.hasOwner = !!scraped.owner;
    debug.hasBuildingInfo = !!(scraped.building?.bedrooms || scraped.building?.yearBuilt);

    debug.totalFieldsExtracted = Object.keys(scraped).filter(
      (k) => scraped[k as keyof typeof scraped] !== undefined
    ).length;

    return { scraped, debug };
  } catch (error) {
    debug.mainPageSectionsError = error instanceof Error ? error.message : String(error);
    console.error("[PAO Playwright] Failed to extract main page sections:", error);
    throw error;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * RECOMMENDED: Single-session orchestrator that searches for a property and extracts all data
 *
 * This is the most efficient approach - it uses a single browser session to:
 * 1. Search for the property by address
 * 2. Navigate to the detail page (or stay if already there)
 * 3. Extract all property data by clicking tabs
 */
export async function scrapeManateePaoPropertyByAddressPlaywright(
  address: string,
  options?: ManateePaoPlaywrightOptions
): Promise<ManateePaoScrapeResult> {
  const timeoutMs = options?.timeoutMs || 60000;
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    address,
    orchestratorUsed: true,
    startTime: new Date().toISOString(),
  };

  try {
    const result = await withPage(
      async (page) => {
        console.log(`[PAO Orchestrator] Starting search for: "${address}"`);
        const findResult = await findManateePaoDetailUrlOnPage(page, address, options);
        debug.findDebug = findResult.debug;

        if (!findResult.detailUrl) {
          console.log("[PAO Orchestrator] No property found for this address");
          return {
            detailUrl: null,
            scraped: {} as Partial<PropertyDetails>,
          };
        }

        if (!findResult.addressFound) {
          console.warn("[PAO Orchestrator] Rejecting URL because address was not found in results");
          return {
            detailUrl: null,
            scraped: {} as Partial<PropertyDetails>,
          };
        }

        debug.detailUrl = findResult.detailUrl;
        debug.alreadyOnDetailPage = findResult.alreadyOnDetailPage;

        if (!findResult.alreadyOnDetailPage) {
          console.log(`[PAO Orchestrator] Navigating to detail page: ${findResult.detailUrl}`);
          await page.goto(findResult.detailUrl, { waitUntil: "domcontentloaded" });
        } else {
          console.log("[PAO Orchestrator] Already on detail page, skipping navigation");
        }

        console.log("[PAO Orchestrator] Extracting property data...");
        const extractResult = await extractManateePaoPropertyFromDetailPage(
          page,
          findResult.detailUrl,
          options
        );
        debug.extractDebug = extractResult.debug;

        return {
          detailUrl: findResult.detailUrl,
          scraped: extractResult.scraped,
        };
      },
      { opTimeoutMs: timeoutMs, navTimeoutMs }
    );

    debug.success = true;
    return {
      detailUrl: result.detailUrl,
      scraped: result.scraped,
      debug,
    };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);
    debug.errorType = error instanceof PlaywrightError ? error.code : "UNKNOWN";
    debug.success = false;

    console.error("[PAO Orchestrator] Scrape failed:", debug.error);

    if (error instanceof PlaywrightError && error.code === "BLOCKED") {
      throw error;
    }

    if (error instanceof PlaywrightError && error.code === "CONFIG_MISSING") {
      throw error;
    }

    return {
      detailUrl: null,
      scraped: {},
      debug,
    };
  }
}

/**
 * Extract property details from a PAO detail page (standalone, starts new session)
 */
export async function extractManateePaoPropertyPlaywright(
  detailUrl: string,
  options?: ManateePaoPlaywrightOptions
): Promise<{ scraped: Partial<PropertyDetails>; debug: Record<string, unknown> }> {
  const timeoutMs = options?.timeoutMs || 60000;
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    detailUrl,
    startTime: new Date().toISOString(),
  };

  try {
    const result = await withPage(
      async (page) => {
        console.log(`[PAO Playwright] Navigating to detail page: ${detailUrl}`);
        await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1000);
        return await extractManateePaoPropertyFromDetailPage(page, detailUrl, options);
      },
      { opTimeoutMs: timeoutMs, navTimeoutMs }
    );

    return {
      scraped: result.scraped,
      debug: { ...debug, ...result.debug, success: true },
    };
  } catch (error) {
    debug.error = error instanceof Error ? error.message : String(error);
    debug.errorType = error instanceof PlaywrightError ? error.code : "UNKNOWN";
    debug.success = false;

    console.error("[PAO Playwright] Extraction failed:", debug.error);

    if (error instanceof PlaywrightError && error.code === "CONFIG_MISSING") {
      throw error;
    }

    return { scraped: {}, debug };
  }
}

// ============================================================================
// Form Filling
// ============================================================================

async function fillSearchForm(page: Page, address: AddressParts): Promise<void> {
  await clearAndFill(page, SELECTORS.ownerLast, "*");
  await clearAndFill(page, SELECTORS.ownerFirst, "*");
  await clearAndFill(page, SELECTORS.parcelId, "*");

  if (address.street) {
    const normalizedStreet = normalizeStreetForUsps(address.street);
    if (normalizedStreet !== address.street) {
      console.log(`[PAO Playwright] Street normalized: "${address.street}" → "${normalizedStreet}"`);
    }
    await clearAndFill(page, SELECTORS.address, normalizedStreet);
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  if (address.zipCode) {
    await clearAndFill(page, SELECTORS.zipCode, address.zipCode);
  }
}

async function clearAndFill(page: Page, selector: string, value: string): Promise<void> {
  try {
    await page.click(selector);
    await page.waitForTimeout(50);
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(50);
    await page.fill(selector, value);
    await page.waitForTimeout(100);
  } catch (error) {
    console.warn(`[PAO Playwright] Could not fill ${selector}:`, error);
  }
}

// ============================================================================
// Results Parsing
// ============================================================================

function parseSearchResults(html: string): SearchRow[] {
  const $ = cheerio.load(html);
  const rows: SearchRow[] = [];

  const tableSelectors = [
    "table.table tbody tr",
    ".search-results table tbody tr",
    "#searchResults tbody tr",
    "table tbody tr",
  ];

  for (const selector of tableSelectors) {
    $(selector).each((_, row) => {
      const $row = $(row);
      const text = $row.text().trim();

      if ($row.find("th").length > 0) return;

      let href: string | null = null;
      let parcelId: string | null = null;

      $row.find("a").each((_, link) => {
        const linkHref = $(link).attr("href") || "";
        if (linkHref.includes("parcel") || linkHref.includes("parid") || linkHref.includes("detail")) {
          href = linkHref;
          const parcelMatch = linkHref.match(/(?:parid|parcel|parcelid)=(\d{9,10})/i);
          if (parcelMatch) {
            parcelId = parcelMatch[1];
          }
        }
      });

      if (!parcelId) {
        const textParcelMatch = text.match(/\b(\d{9,10})\b/);
        if (textParcelMatch) {
          parcelId = textParcelMatch[1];
        }
      }

      if (text && (href || parcelId)) {
        rows.push({ href, text, parcelId });
      }
    });

    if (rows.length > 0) break;
  }

  return rows;
}

function detectNoResults(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  const noResultsPatterns = [
    "no results",
    "no records found",
    "no properties found",
    "no matching",
    "0 results",
    "zero results",
    "search returned no",
  ];

  return noResultsPatterns.some((pattern) => lowerHtml.includes(pattern));
}

function selectBestResult(
  rows: SearchRow[],
  searchAddress: string
): { href: string | null; addressFound: boolean; matchedText?: string } {
  const parsed = parseAddress(searchAddress);
  const streetParts = (parsed.street || "").toLowerCase().split(/\s+/);
  const streetNumber = streetParts[0] || "";
  const streetName = streetParts.slice(1).join(" ");

  for (const row of rows) {
    const rowTextLower = row.text.toLowerCase();

    if (!rowTextLower.includes(streetNumber)) continue;

    const streetNameWords = streetName.split(" ").filter((w) => w.length > 2);
    const hasStreetMatch = streetNameWords.some((word) => rowTextLower.includes(word));

    if (hasStreetMatch) {
      let href = row.href;
      if (!href && row.parcelId) {
        href = `/parcel/?parid=${row.parcelId}`;
      }

      return {
        href,
        addressFound: true,
        matchedText: row.text.substring(0, 100),
      };
    }
  }

  const firstRow = rows[0];
  return {
    href: firstRow?.href || (firstRow?.parcelId ? `/parcel/?parid=${firstRow.parcelId}` : null),
    addressFound: false,
    matchedText: firstRow?.text.substring(0, 100),
  };
}

// ============================================================================
// Valuations and Sales Parsing
// ============================================================================

function parseValuationsTable($: cheerio.CheerioAPI): ValuationRecord[] {
  const valuations: ValuationRecord[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text().toLowerCase();

    if (headerText.includes("year") || headerText.includes("land") || headerText.includes("market") || headerText.includes("value")) {
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 4) return;

        const firstCell = $(cells[0]).text().trim();
        const year = parseInt(firstCell, 10);

        if (year < 2000 || year > 2100) return;

        const valuation: ValuationRecord = {
          year,
          just: {
            land: parseMoney($(cells[2]).text()),
            building: parseMoney($(cells[3]).text()),
            total: parseMoney($(cells[4]).text()),
          },
        };

        if (cells.length > 5) {
          valuation.assessed = { total: parseMoney($(cells[5]).text()) };
        }

        if (cells.length > 7) {
          valuation.taxable = { total: parseMoney($(cells[7]).text()) };
        }

        if (cells.length > 9) {
          const lastCells = cells.toArray().slice(-2);
          valuation.adValoremTaxes = parseMoney($(lastCells[0]).text());
          valuation.nonAdValoremTaxes = parseMoney($(lastCells[1]).text());
        }

        valuations.push(valuation);
      });
    }
  });

  valuations.sort((a, b) => (b.year || 0) - (a.year || 0));

  return valuations;
}

function parseSalesTable($: cheerio.CheerioAPI): SaleRecord[] {
  const sales: SaleRecord[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const headerText = $table.find("th, thead").text().toLowerCase();

    if (headerText.includes("sale") || headerText.includes("grantee") || headerText.includes("price")) {
      $table.find("tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 5) return;

        const dateText = $(cells[0]).text().trim();
        const bookPageText = $(cells[1]).text().trim();
        const instrumentType = $(cells[2]).text().trim();
        const vacantImproved = $(cells[3]).text().trim();
        const qualCode = $(cells[4]).text().trim();
        const priceText = $(cells[5]).text().trim();
        const granteeText = cells.length > 6 ? $(cells[6]).text().trim() : "";

        const dateMatch = dateText.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
        const date = dateMatch ? dateMatch[0] : dateText;

        const price = parseMoney(priceText);

        if (!date && !price) return;

        const sale: SaleRecord = {
          date,
          bookPage: bookPageText || undefined,
          deedType: instrumentType || undefined,
          vacantOrImproved: vacantImproved || undefined,
          qualificationCode: qualCode || undefined,
          price,
          grantee: granteeText || undefined,
        };

        sales.push(sale);
      });
    }
  });

  sales.sort((a, b) => {
    if (!a.date || !b.date) return 0;
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB.getTime() - dateA.getTime();
  });

  return sales;
}

// ============================================================================
// Utility Functions
// ============================================================================

function parseMoney(input?: string): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

function parseNumber(input?: string): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

function parseAddress(address: string): AddressParts {
  const parts = address.split(",").map((p) => p.trim());
  const result: AddressParts = {};

  if (parts.length >= 1) {
    result.street = parts[0];
  }
  if (parts.length >= 2) {
    result.city = parts[1];
  }
  if (parts.length >= 3) {
    const stateZip = parts[2].split(" ");
    result.state = stateZip[0];
    if (stateZip.length > 1) {
      result.zipCode = stateZip[1];
    }
  }
  if (parts.length >= 4) {
    result.zipCode = parts[3];
  }

  return result;
}
