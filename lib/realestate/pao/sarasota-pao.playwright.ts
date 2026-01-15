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
  searchMaxAttempts?: number;
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
  streetNameRaw?: string;
  unit?: string;
  unitRaw?: string;
  unitVariants?: string[];
  streetNoUnitRaw: string;
  streetNoUnitUsps?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

function normalizeForCompare(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripUnitDesignator(value: string): string {
  return value.replace(/^(?:#|UNIT|APT|APARTMENT|SUITE|STE|BLDG|BUILDING)\s*/i, "").trim();
}

function buildUnitVariants(unit?: string): string[] {
  if (!unit) return [];

  const raw = unit.trim();
  const cleaned = stripUnitDesignator(raw);
  const variants = new Set<string>();

  const addVariant = (value?: string) => {
    if (!value) return;
    const normalized = normalizeForCompare(value);
    if (normalized) {
      variants.add(normalized);
    }
  };

  addVariant(raw);
  addVariant(cleaned);
  addVariant(cleaned.replace(/[\s#]+/g, ""));
  addVariant(cleaned.replace(/[^A-Z0-9-]/gi, ""));

  if (cleaned.includes("-")) {
    const lastPart = cleaned.split("-").pop();
    addVariant(lastPart);
  }

  return Array.from(variants);
}

interface SearchRow {
  parcelId: string;
  address: string;
  owner?: string;
  href: string;
  rawText?: string;
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
  let unitRaw: string | undefined;

  // Extract unit from street (handles #13, Unit 13, Apt 13, Unit #14-209, etc.)
  // Pattern handles:
  // - Simple: #13, Unit 13, Apt 5
  // - With hash: Unit #14, Apt #5
  // - With hyphen: #14-209, Unit 14-209, Unit #14-209 (condo building-unit format)
  // - Alphanumeric: Unit A, Apt 201B, #A-101
  const unitMatch = street.match(
    /\s*(?:#|Unit|Apt|Apartment|Suite|Ste|Bldg|Building)[.\s]*#?([\w-]+)\s*$/i
  );
  if (unitMatch) {
    unit = unitMatch[1];
    unitRaw = unitMatch[1];
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
  const streetNoUnitRaw = street.trim();
  const streetMatch = streetNoUnitRaw.match(/^(\d+)\s+(.+)$/);
  const streetNo = streetMatch?.[1];
  const streetNameRaw = streetMatch ? streetMatch[2] : streetNoUnitRaw;
  const streetName = normalizeStreetForUsps(streetNameRaw);
  const streetNoUnitUsps = normalizeStreetForUsps(streetNoUnitRaw);
  const unitVariants = buildUnitVariants(unitRaw || unit);

  return {
    street: streetNoUnitRaw,
    streetNo,
    streetName,
    streetNameRaw,
    unit,
    unitRaw,
    unitVariants,
    streetNoUnitRaw,
    streetNoUnitUsps,
    city,
    state: state || "FL",
    zipCode,
  };
}

// ============================================================================
// Search Functions
// ============================================================================

type SarasotaResultsSignal =
  | { kind: "DETAIL_REDIRECT"; url: string }
  | { kind: "HAS_RESULTS"; parcelLinkCount: number }
  | { kind: "NO_RESULTS"; reason: string }
  | { kind: "TIMEOUT"; reason: string };

interface SarasotaSearchAttempt {
  query: string;
  kind: "PRIMARY" | "NO_NUMBER" | "WITH_UNIT" | "UNIT_LASTPART" | "USPS";
}

interface ParseSearchResultsResult {
  rows: SearchRow[];
  meta: {
    strategy: "TABLE" | "LINK_SCAN";
    tableSelectorUsed?: string;
    rowCountRaw?: number;
    parcelLinkCount?: number;
  };
}

function buildSarasotaSearchAttempts(parts: AddressParts, maxAttempts?: number): SarasotaSearchAttempt[] {
  const attempts: SarasotaSearchAttempt[] = [];
  const seen = new Set<string>();

  const addAttempt = (query: string | undefined, kind: SarasotaSearchAttempt["kind"]) => {
    const trimmed = (query || "").trim();
    if (!trimmed) return;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) return;
    attempts.push({ query: trimmed, kind });
    seen.add(key);
  };

  addAttempt(parts.streetNoUnitRaw, "PRIMARY");
  addAttempt(parts.streetNameRaw, "NO_NUMBER");

  if (parts.unit) {
    const unitForQuery = stripUnitDesignator(parts.unit);
    addAttempt(`${parts.streetNoUnitRaw} ${unitForQuery}`, "WITH_UNIT");
    if (unitForQuery.includes("-")) {
      addAttempt(`${parts.streetNoUnitRaw} ${unitForQuery.split("-").pop()}`, "UNIT_LASTPART");
    }
  }

  if (parts.streetNoUnitUsps && parts.streetNoUnitUsps !== parts.streetNoUnitRaw) {
    addAttempt(parts.streetNoUnitUsps, "USPS");
  }

  return typeof maxAttempts === "number" ? attempts.slice(0, Math.max(maxAttempts, 1)) : attempts;
}

async function waitForSarasotaResults(page: Page, timeoutMs: number): Promise<SarasotaResultsSignal> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    if (currentUrl.includes("/parcel/")) {
      return { kind: "DETAIL_REDIRECT", url: currentUrl };
    }

    try {
      const state = await page.evaluate(() => {
        const parcelLinks = document.querySelectorAll('a[href*="/parcel"]').length;
        const rows = document.querySelectorAll("table tbody tr").length;
        const noResultsElement = document.querySelector(
          ".alert-warning, .alert-info, .no-results, .dataTables_empty"
        );
        const text = document.body?.innerText?.toLowerCase() || "";
        const noResultsText =
          text.includes("no results") ||
          text.includes("no records found") ||
          text.includes("no properties found") ||
          text.includes("no matching records") ||
          text.includes("0 results") ||
          text.includes("showing 0 to 0 of 0 entries");

        return {
          parcelLinks,
          rows,
          noResultsElement: Boolean(noResultsElement),
          noResultsText,
        };
      });

      if (state.parcelLinks > 0 || state.rows > 0) {
        return { kind: "HAS_RESULTS", parcelLinkCount: state.parcelLinks };
      }

      if (state.noResultsElement || state.noResultsText) {
        return {
          kind: "NO_RESULTS",
          reason: state.noResultsElement ? "SELECTOR_MATCH" : "TEXT_MATCH",
        };
      }
    } catch {
      // Ignore transient evaluate errors during navigation.
    }

    await page.waitForTimeout(500);
  }

  return { kind: "TIMEOUT", reason: "timeout" };
}

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

    debug.targetUnit = addressParts.unit;
    debug.searchAttempts = [];

    const searchAttempts = buildSarasotaSearchAttempts(addressParts, options?.searchMaxAttempts);
    const navTimeoutMs = options?.navTimeoutMs || 30000;

    let sawNoResults = false;
    let sawParseFailure = false;
    let sawNoMatch = false;
    let sawTimeout = false;

    for (let index = 0; index < searchAttempts.length; index += 1) {
      const attempt = searchAttempts[index];
      console.log(`[Sarasota PAO] Searching for: ${attempt.query} (${attempt.kind})`);

      const attemptDebug: Record<string, unknown> = {
        attempt: index + 1,
        query: attempt.query,
        kind: attempt.kind,
      };

      // Fill address field
      await page.fill(SELECTORS.addressInput, attempt.query);

      // Wait a moment for autocomplete to settle and dismiss any popups
      await page.waitForTimeout(800);
      await page.keyboard.press("Escape");
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
              attemptDebug.usedButtonSelector = selector;
              await button.click();
              buttonClicked = true;
              break;
            }
          }
        } catch {
          // Continue to next selector
        }
      }

      if (!buttonClicked) {
        console.log("[Sarasota PAO] No submit button found, trying Enter key...");
        attemptDebug.submittedVia = "ENTER";
        await page.press(SELECTORS.addressInput, "Enter");
      } else {
        attemptDebug.submittedVia = "CLICK";
      }

      console.log("[Sarasota PAO] Waiting for results...");
      const signal = await waitForSarasotaResults(page, navTimeoutMs);
      attemptDebug.signal = signal.kind;
      attemptDebug.resultUrl = page.url();
      if (signal.kind === "NO_RESULTS") {
        attemptDebug.noResultsReason = signal.reason;
      }

      if (signal.kind === "TIMEOUT") {
        sawTimeout = true;
      }

      if (signal.kind === "DETAIL_REDIRECT") {
        const parcelMatch = signal.url.match(/\/parcel(?:\/details)?\/(\d+)/);
        const parcelId = parcelMatch?.[1] || null;
        debug.directRedirect = true;
        debug.parcelId = parcelId;
        (debug.searchAttempts as Array<Record<string, unknown>>).push(attemptDebug);
        debug.searchOutcome = "FOUND";
        return {
          detailUrl: signal.url,
          parcelId,
          debug,
        };
      }

      const content = await page.content();
      const blockCheck = detectBlocking(content);
      if (blockCheck.blocked) {
        throw new PlaywrightError(
          `Sarasota PAO site blocked: ${blockCheck.reason}`,
          "BLOCKED"
        );
      }

      const parseResult = parseSearchResults(content);
      const noResults = detectNoResults(content);

      attemptDebug.parse = {
        strategy: parseResult.meta.strategy,
        parsedRowCount: parseResult.rows.length,
        tableSelectorUsed: parseResult.meta.tableSelectorUsed,
      };

      attemptDebug.dom = {
        parcelLinkCount: parseResult.meta.parcelLinkCount ?? 0,
        resultsRowCount: parseResult.rows.length,
        hasResultsTable: Boolean(parseResult.meta.tableSelectorUsed),
        hasNoResultsAlert: noResults.ok,
      };

      attemptDebug.sample = {
        firstParcelHrefs: parseResult.rows.slice(0, 3).map((row) => row.href),
        firstRowAddresses: parseResult.rows.slice(0, 3).map((row) => row.address),
      };

      if (parseResult.rows.length === 0) {
        if (noResults.ok) {
          sawNoResults = true;
          attemptDebug.noResultsReason = attemptDebug.noResultsReason || noResults.reason;
          (debug.searchAttempts as Array<Record<string, unknown>>).push(attemptDebug);
          continue;
        }

        if (parseResult.meta.parcelLinkCount && parseResult.meta.parcelLinkCount > 0) {
          sawParseFailure = true;
        }

        (debug.searchAttempts as Array<Record<string, unknown>>).push(attemptDebug);
        continue;
      }

      const best = selectBestResult(parseResult.rows, addressParts);
      attemptDebug.selection = best;
      debug.bestMatch = best;

      if (!best.href) {
        sawNoMatch = true;
        (debug.searchAttempts as Array<Record<string, unknown>>).push(attemptDebug);
        continue;
      }

      const detailUrl = best.href.startsWith("http")
        ? best.href
        : `${PAO_BASE_URL}${best.href}`;

      (debug.searchAttempts as Array<Record<string, unknown>>).push(attemptDebug);
      debug.searchOutcome = "FOUND";
      return {
        detailUrl,
        parcelId: best.parcelId || null,
        debug,
      };
    }

    if (sawNoMatch) {
      debug.searchOutcome = "NO_MATCH";
    } else if (sawParseFailure) {
      debug.searchOutcome = "PARSE_FAILED";
    } else if (sawNoResults) {
      debug.searchOutcome = "NO_RESULTS_CONFIRMED";
    } else if (sawTimeout) {
      debug.searchOutcome = "TIMEOUT";
    } else {
      debug.searchOutcome = "UNKNOWN";
    }

    return { detailUrl: null, parcelId: null, debug };
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

function parseSearchResults(html: string): ParseSearchResultsResult {
  const $ = cheerio.load(html);
  const rows: SearchRow[] = [];
  const parcelLinkCount = $("a[href*='/parcel']").length;
  const tableSelectors = [
    "table.table tbody tr",
    ".search-results table tbody tr",
    "#searchResults tbody tr",
    "table tbody tr",
  ];

  let tableSelectorUsed: string | undefined;

  for (const selector of tableSelectors) {
    $(selector).each((_, row) => {
      const $row = $(row);
      const cells = $row.find("td");
      const rowText = $row.text().replace(/\s+/g, " ").trim();

      if ($row.find("th").length > 0 || cells.length === 0) return;
      if (/no matching|no results|no records/i.test(rowText)) return;

      const link = $row.find("a[href*='/parcel']").first();
      const href = link.attr("href") || "";

      let parcelId = "";
      const parcelMatch = href.match(/\/parcel(?:\/details)?\/(\d+)/);
      if (parcelMatch) {
        parcelId = parcelMatch[1];
      } else if (cells.length > 0) {
        parcelId = cells.eq(0).text().trim().replace(/\D/g, "");
      }

      const address =
        cells.eq(1).text().trim() ||
        link.text().trim() ||
        rowText;
      const owner = cells.length >= 3 ? cells.eq(2).text().trim() : undefined;

      if ((href || parcelId) && address) {
        rows.push({ parcelId, address, owner, href, rawText: rowText });
      }
    });

    if (rows.length > 0) {
      tableSelectorUsed = selector;
      break;
    }
  }

  if (rows.length > 0) {
    return {
      rows,
      meta: {
        strategy: "TABLE",
        tableSelectorUsed,
        parcelLinkCount,
        rowCountRaw: rows.length,
      },
    };
  }

  const parcelLinks = $("a[href*='/parcel']");
  const seen = new Set<string>();

  parcelLinks.each((_, link) => {
    const $link = $(link);
    const href = $link.attr("href") || "";
    if (!href || seen.has(href)) return;
    seen.add(href);

    const container = $link.closest("tr, li, .search-result, .result, .card, .panel");
    const rawText = (container.length ? container.text() : $link.parent().text())
      .replace(/\s+/g, " ")
      .trim();
    const address = $link.text().trim() || rawText;
    const parcelMatch = href.match(/\/parcel(?:\/details)?\/(\d+)/);
    const parcelId = parcelMatch ? parcelMatch[1] : "";

    rows.push({ parcelId, address, href, rawText });
  });

  return {
    rows,
    meta: {
      strategy: "LINK_SCAN",
      parcelLinkCount,
      rowCountRaw: rows.length,
    },
  };
}

function detectNoResults(html: string): { ok: boolean; reason?: string } {
  const lowerHtml = html.toLowerCase();
  const $ = cheerio.load(html);

  if ($(".dataTables_empty").length > 0) {
    return { ok: true, reason: "DATATABLES_EMPTY" };
  }

  const patterns = [
    "no results",
    "no records found",
    "no properties found",
    "no matching records",
    "0 results",
    "showing 0 to 0 of 0 entries",
  ];

  for (const pattern of patterns) {
    if (lowerHtml.includes(pattern)) {
      return { ok: true, reason: `TEXT_MATCH:${pattern}` };
    }
  }

  const alertText = $(".alert-warning, .alert-info, .no-results").text().toLowerCase();
  if (alertText && patterns.some((pattern) => alertText.includes(pattern))) {
    return { ok: true, reason: "ALERT_TEXT" };
  }

  return { ok: false };
}

function selectBestResult(
  rows: SearchRow[],
  target: AddressParts
): { href: string | null; parcelId: string | null; confidence: number; reason: string; matchedOn?: { streetNo: boolean; streetName: boolean; unit: boolean } } {
  if (rows.length === 0) {
    return { href: null, parcelId: null, confidence: 0, reason: "NO_ROWS" };
  }

  if (rows.length === 1) {
    const unitVariants = target.unitVariants ?? buildUnitVariants(target.unit);
    const rowText = rows[0].address || rows[0].rawText || "";
    const rowNormalized = normalizeForCompare(rowText);
    const unitMatch = unitVariants.length === 0 || unitVariants.some((unit) => rowNormalized.includes(unit));

    return {
      href: rows[0].href,
      parcelId: rows[0].parcelId,
      confidence: unitMatch ? 0.9 : 0.75,
      reason: unitMatch ? "SINGLE_ROW_MATCH" : "SINGLE_ROW_NO_UNIT",
      matchedOn: {
        streetNo: Boolean(target.streetNo),
        streetName: Boolean(target.streetNameRaw || target.streetName),
        unit: unitMatch,
      },
    };
  }

  const streetNo = target.streetNo ? target.streetNo.trim() : "";
  const streetNameSource = target.streetNameRaw || target.streetName || "";
  const streetTokens = streetNameSource
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
  const unitVariants = target.unitVariants ?? buildUnitVariants(target.unit);
  const unitRequired = Boolean(target.unit);

  let bestMatch: SearchRow | null = null;
  let bestScore = 0;
  let bestMatchedOn = { streetNo: false, streetName: false, unit: false };

  for (const row of rows) {
    const rowText = [row.address, row.owner, row.rawText].filter(Boolean).join(" ");
    const rowTextLower = rowText.toLowerCase();
    const rowNormalized = normalizeForCompare(rowText);

    const streetNoMatch = streetNo
      ? new RegExp(`\\b${escapeRegExp(streetNo)}\\b`).test(rowTextLower)
      : true;
    const streetNameMatch =
      streetTokens.length === 0 || streetTokens.some((token) => rowTextLower.includes(token));
    const unitMatch =
      unitVariants.length === 0 || unitVariants.some((variant) => rowNormalized.includes(variant));

    if (unitRequired && !unitMatch && rows.length > 1) {
      continue;
    }

    if (streetNo && !streetNoMatch) {
      continue;
    }

    if (streetTokens.length > 0 && !streetNameMatch) {
      continue;
    }

    let score = 0;
    if (streetNoMatch) score += 0.45;
    if (streetNameMatch) score += 0.35;
    if (unitMatch) score += 0.2;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = row;
      bestMatchedOn = { streetNo: streetNoMatch, streetName: streetNameMatch, unit: unitMatch };
    }
  }

  if (!bestMatch) {
    return {
      href: null,
      parcelId: null,
      confidence: 0,
      reason: unitRequired ? "NO_UNIT_MATCH" : "NO_STREET_MATCH",
    };
  }

  return {
    href: bestMatch.href,
    parcelId: bestMatch.parcelId,
    confidence: Math.min(bestScore, 1),
    reason: "BEST_MATCH",
    matchedOn: bestMatchedOn,
  };
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
