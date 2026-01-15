import "server-only";

import { withContext, PlaywrightError, detectBlocking } from "@/lib/realestate/playwright/browser";
import type { Page } from "playwright-core";
import { REALIST_SAML_URL, PARSER_VERSION } from "./constants";
import {
  exportStorageState,
  loadStellarStorageState,
  saveStellarStorageState,
  type PlaywrightStorageState,
} from "./session";

export interface StellarRealistPlaywrightOptions {
  timeoutMs?: number;
  navTimeoutMs?: number;
  debug?: boolean;
}

export interface StellarRealistData {
  addressSearched: string;
  matchedAddress?: string;
  sellScore?: { indicator?: string; score?: number; asOf?: string };
  realAvm?: {
    value?: number;
    low?: number;
    high?: number;
    confidence?: number;
    confidenceLabel?: string;
    asOf?: string;
  };
  rentalTrends?: {
    summary?: string;
    currentRent?: number;
    yoyChangePct?: number;
    series?: Array<{ period: string; value: number }>;
  };
  listings?: Array<{
    status?: string;
    listPrice?: number;
    closePrice?: number;
    listDate?: string;
    closeDate?: string;
    daysOnMarket?: number;
    mlsNumber?: string;
    brokerage?: string;
    agent?: string;
  }>;
  sourceUrl?: string;
}

export interface StellarRealistScrapeResult {
  detailUrl?: string;
  data?: StellarRealistData;
  raw?: {
    htmlSnapshots?: Record<string, string>;
    apiResponses?: Array<{ url: string; status: number; body: unknown }>;
    finalUrl?: string;
  };
  debug: Record<string, unknown>;
  session: { reused: boolean };
  storageState?: PlaywrightStorageState;
}

const LOGIN_URL_ENV = "STELLARMLS_PING_AUTHORIZE_URL";

function toNumber(input?: string): number | undefined {
  if (!input) return undefined;
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function sanitizeHtml(input: string): string {
  return input
    .replace(/name="SAMLResponse"[\s\S]*?>/gi, "name=\"SAMLResponse\" value=\"[REDACTED]\">")
    .replace(/name="RelayState"[\s\S]*?>/gi, "name=\"RelayState\" value=\"[REDACTED]\">")
    .replace(/value="[^"]{100,}"/g, 'value="[REDACTED]"');
}

function attachJsonResponseCapture(page: Page, urlIncludes: string[]) {
  const captured: Array<{ url: string; status: number; body: unknown }> = [];

  page.on("response", async (response) => {
    const url = response.url();
    const match = urlIncludes.some((needle) => url.toLowerCase().includes(needle));
    if (!match) return;

    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json")) return;

    try {
      const body = await response.json();
      captured.push({ url, status: response.status(), body });
    } catch {
      // ignore non-JSON
    }
  });

  return {
    getCaptured: () => captured,
  };
}

async function findFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function ensureLoggedIn(page: Page, debug: Record<string, unknown>): Promise<void> {
  const loginUrl = process.env[LOGIN_URL_ENV];
  if (!loginUrl) {
    throw new PlaywrightError(
      `Missing ${LOGIN_URL_ENV} for StellarMLS login`,
      "CONFIG_MISSING"
    );
  }

  debug.loginUrl = loginUrl;

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  const html = await page.content();
  const block = detectBlocking(html);
  if (block.blocked) {
    throw new PlaywrightError(`Blocked during StellarMLS login: ${block.reason}`, "BLOCKED");
  }

  const usernameSelector = [
    'input[name="pf.username"]',
    'input[name="username"]',
    'input[name*="user"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
    '#username',
  ];
  const passwordSelector = [
    'input[name="pf.pass"]',
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    '#password',
  ];

  let usernameField = await findFirstVisible(page, usernameSelector);
  let passwordField = await findFirstVisible(page, passwordSelector);

  if (usernameField || passwordField) {
    const username = process.env.STELLARMLS_USERNAME;
    const password = process.env.STELLARMLS_PASSWORD;

    if (!username || !password) {
      throw new PlaywrightError(
        "Missing STELLARMLS_USERNAME or STELLARMLS_PASSWORD",
        "CONFIG_MISSING"
      );
    }

    if (usernameField && !passwordField) {
      await usernameField.fill(username, { timeout: 10000 });
      const submitButton = await findFirstVisible(page, [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Next")',
        'button:has-text("Continue")',
      ]);
      if (submitButton) {
        await submitButton.click();
      } else {
        await usernameField.press("Enter");
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 45000 }).catch(() => undefined);
      passwordField = await findFirstVisible(page, passwordSelector);
    }

    if (passwordField) {
      if (!usernameField) {
        usernameField = await findFirstVisible(page, usernameSelector);
        if (usernameField) {
          await usernameField.fill(username, { timeout: 10000 });
        }
      }

      await passwordField.fill(password, { timeout: 10000 });

      const submitButton = await findFirstVisible(page, [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Sign On")',
        'button:has-text("Log In")',
        'button:has-text("Sign In")',
      ]);

      if (submitButton) {
        await submitButton.click();
      } else {
        await passwordField.press("Enter");
      }

      await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => undefined);
    }
  }

  const postLoginHtml = await page.content().catch(() => "");
  const lowerHtml = postLoginHtml.toLowerCase();
  if (
    lowerHtml.includes("multi-factor") ||
    lowerHtml.includes("verification code") ||
    lowerHtml.includes("one-time") ||
    lowerHtml.includes("mfa")
  ) {
    throw new PlaywrightError("MFA required for StellarMLS login", "BLOCKED");
  }

  await page.goto(REALIST_SAML_URL, { waitUntil: "domcontentloaded" });
}

async function searchByAddress(page: Page, address: string): Promise<void> {
  const input = await findFirstVisible(page, [
    'input[placeholder*="Address"]',
    'input[aria-label*="Address"]',
    'input[name*="address"]',
    'input[type="search"]',
    'input[placeholder*="Search"]',
  ]);

  if (!input) {
    throw new PlaywrightError("Unable to locate Realist address search input", "NAVIGATION_FAILED");
  }

  await input.fill(address, { timeout: 15000 });
  await input.press("Enter");

  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => undefined);
}

function extractFromCapturedResponses(
  captured: Array<{ url: string; status: number; body: unknown }>,
  address: string
): StellarRealistData {
  const data: StellarRealistData = { addressSearched: address };

  const visit = (value: unknown, cb: (key: string, val: unknown) => void) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, cb));
      return;
    }
    for (const [key, val] of Object.entries(value)) {
      cb(key, val);
      visit(val, cb);
    }
  };

  const pickSellScore = (val: unknown) => {
    if (!val || typeof val !== "object") return;
    const obj = val as Record<string, unknown>;
    data.sellScore = data.sellScore || {};
    data.sellScore.score = data.sellScore.score ?? toNumber(String(obj.score ?? obj.value ?? ""));
    data.sellScore.indicator =
      data.sellScore.indicator ??
      (typeof obj.indicator === "string" ? obj.indicator : undefined);
    data.sellScore.asOf =
      data.sellScore.asOf ?? (typeof obj.asOf === "string" ? obj.asOf : undefined);
  };

  const pickAvm = (val: unknown) => {
    if (!val || typeof val !== "object") return;
    const obj = val as Record<string, unknown>;
    data.realAvm = data.realAvm || {};
    data.realAvm.value = data.realAvm.value ?? toNumber(String(obj.value ?? obj.avm ?? ""));
    data.realAvm.low = data.realAvm.low ?? toNumber(String(obj.low ?? obj.min ?? ""));
    data.realAvm.high = data.realAvm.high ?? toNumber(String(obj.high ?? obj.max ?? ""));
    data.realAvm.confidence =
      data.realAvm.confidence ?? toNumber(String(obj.confidence ?? obj.confidenceScore ?? ""));
    data.realAvm.confidenceLabel =
      data.realAvm.confidenceLabel ??
      (typeof obj.confidenceLabel === "string" ? obj.confidenceLabel : undefined);
    data.realAvm.asOf = data.realAvm.asOf ?? (typeof obj.asOf === "string" ? obj.asOf : undefined);
  };

  const pickRental = (val: unknown) => {
    if (!val || typeof val !== "object") return;
    const obj = val as Record<string, unknown>;
    data.rentalTrends = data.rentalTrends || {};
    data.rentalTrends.summary =
      data.rentalTrends.summary ?? (typeof obj.summary === "string" ? obj.summary : undefined);
    data.rentalTrends.currentRent =
      data.rentalTrends.currentRent ?? toNumber(String(obj.currentRent ?? obj.rent ?? ""));
    data.rentalTrends.yoyChangePct =
      data.rentalTrends.yoyChangePct ?? toNumber(String(obj.yoyChangePct ?? obj.yoy ?? ""));
    if (Array.isArray(obj.series)) {
      data.rentalTrends.series = obj.series
        .map((item) => ({
          period: typeof item.period === "string" ? item.period : "",
          value: toNumber(String(item.value ?? "")) ?? 0,
        }))
        .filter((item) => item.period && item.value);
    }
  };

  const pickListings = (val: unknown) => {
    if (!Array.isArray(val)) return;
    const listings = val
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          status: typeof obj.status === "string" ? obj.status : undefined,
          listPrice: toNumber(String(obj.listPrice ?? obj.price ?? "")),
          closePrice: toNumber(String(obj.closePrice ?? obj.soldPrice ?? "")),
          listDate: typeof obj.listDate === "string" ? obj.listDate : undefined,
          closeDate: typeof obj.closeDate === "string" ? obj.closeDate : undefined,
          daysOnMarket: toNumber(String(obj.daysOnMarket ?? "")),
          mlsNumber: typeof obj.mlsNumber === "string" ? obj.mlsNumber : undefined,
          brokerage: typeof obj.brokerage === "string" ? obj.brokerage : undefined,
          agent: typeof obj.agent === "string" ? obj.agent : undefined,
        };
      })
      .filter(Boolean) as NonNullable<StellarRealistData["listings"]>;

    if (listings.length) {
      data.listings = listings.slice(0, 25);
    }
  };

  captured.forEach(({ body }) => {
    visit(body, (key, val) => {
      const lower = key.toLowerCase();
      if (lower.includes("sell") && lower.includes("score")) {
        pickSellScore(val);
      }
      if (lower.includes("avm")) {
        pickAvm(val);
      }
      if (lower.includes("rent")) {
        pickRental(val);
      }
      if (lower.includes("listing")) {
        pickListings(val);
      }
      if (lower === "address" && typeof val === "string" && !data.matchedAddress) {
        data.matchedAddress = val;
      }
    });
  });

  return data;
}

async function extractFromDom(page: Page, data: StellarRealistData) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (!bodyText) return;

  if (!data.sellScore?.score) {
    const match = bodyText.match(/Sell\s*Score[^0-9]{0,20}(\d{1,3})/i);
    if (match) {
      data.sellScore = { ...data.sellScore, score: toNumber(match[1]) };
    }
  }

  if (!data.realAvm?.value) {
    const match = bodyText.match(/Real\s*AVM[^\d$]{0,20}\$?([\d,]+)/i);
    if (match) {
      data.realAvm = { ...data.realAvm, value: toNumber(match[1]) };
    }
  }

  if (!data.realAvm?.confidence) {
    const match = bodyText.match(/Confidence[^0-9]{0,20}(\d{1,3})%/i);
    if (match) {
      data.realAvm = { ...data.realAvm, confidence: toNumber(match[1]) };
    }
  }

  if (!data.rentalTrends?.currentRent) {
    const match = bodyText.match(/Rent(?:al)?\s*Trend[^\d$]{0,20}\$?([\d,]+)/i);
    if (match) {
      data.rentalTrends = { ...data.rentalTrends, currentRent: toNumber(match[1]) };
    }
  }
}

export async function scrapeStellarRealistByAddressPlaywright(
  address: string,
  options?: StellarRealistPlaywrightOptions
): Promise<StellarRealistScrapeResult> {
  const timeoutMs = options?.timeoutMs || 90000;
  const navTimeoutMs = options?.navTimeoutMs || 45000;
  const debug: Record<string, unknown> = {
    parserVersion: PARSER_VERSION,
    startedAt: new Date().toISOString(),
  };

  const storageStateInput = await loadStellarStorageState();
  const reused = Boolean(storageStateInput);

  return withContext(async (context) => {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(navTimeoutMs);

    const capture = attachJsonResponseCapture(page, [
      "realist",
      "avm",
      "rent",
      "listing",
      "sellscore",
    ]);

    let storageState: PlaywrightStorageState | undefined;

    try {
      await ensureLoggedIn(page, debug);
      await searchByAddress(page, address);

      const captured = capture.getCaptured();
      const data = extractFromCapturedResponses(captured, address);
      await extractFromDom(page, data);

      data.sourceUrl = page.url();

      if (!data.matchedAddress) {
        const title = await page.title().catch(() => undefined);
        if (title) {
          data.matchedAddress = title;
        }
      }

      if (options?.debug) {
        const bodyHtml = await page.content().catch(() => "");
        if (bodyHtml) {
          debug.htmlSnapshotTaken = true;
        }
      }

      storageState = await exportStorageState(context);
      await saveStellarStorageState(storageState);

      return {
        detailUrl: page.url(),
        data,
        raw: {
          apiResponses: captured,
          finalUrl: page.url(),
          htmlSnapshots: options?.debug
            ? { main: sanitizeHtml(await page.content().catch(() => "")) }
            : undefined,
        },
        debug,
        session: { reused },
        storageState,
      };
    } catch (error) {
      debug.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }, {
    navTimeoutMs,
    opTimeoutMs: timeoutMs,
    storageState: storageStateInput,
  });
}
