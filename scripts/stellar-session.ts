#!/usr/bin/env tsx
/**
 * StellarMLS Session Generator
 *
 * Logs into StellarMLS (Ping) and outputs Playwright storageState
 * in both JSON (optional) and base64 formats for env usage.
 *
 * Usage:
 *   pnpm stellar:session
 *   pnpm stellar:session --json
 */

import { config } from "dotenv";
// Load .env.local first, then .env as fallback
config({ path: ".env.local" });
config();

import { chromium, type Page } from "playwright-core";
import { REALIST_SAML_URL } from "../lib/realestate/stellar/constants";

const args = new Set(process.argv.slice(2));
const printJson = args.has("--json");

const PLAYWRIGHT_MODE = (process.env.PLAYWRIGHT_MODE || "stealth").toLowerCase();
const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";
const PLAYWRIGHT_CDP_ENDPOINT =
  process.env.PLAYWRIGHT_CDP_ENDPOINT || process.env.PLAYWRIGHT_WS_ENDPOINT;

const HARDENED_LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-setuid-sandbox",
];

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

class PlaywrightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightError";
  }
}

function resolveMode(): "local" | "stealth" | "auto" {
  if (PLAYWRIGHT_MODE === "local") return "local";
  if (PLAYWRIGHT_MODE === "auto") return "auto";
  return "stealth";
}

function detectBlocking(pageContent: string): { blocked: boolean; reason?: string } {
  const lowerContent = pageContent.toLowerCase();

  const blockPatterns = [
    { pattern: "recaptcha", reason: "reCAPTCHA detected" },
    { pattern: "hcaptcha", reason: "hCaptcha detected" },
    { pattern: "solve this captcha", reason: "CAPTCHA detected" },
    { pattern: "complete the captcha", reason: "CAPTCHA detected" },
    { pattern: "verify you are human", reason: "Human verification required" },
    { pattern: "prove you're not a robot", reason: "Human verification required" },
    { pattern: "i'm not a robot", reason: "Human verification required" },
    { pattern: "checking your browser", reason: "Cloudflare protection detected" },
    { pattern: "ray id:", reason: "Cloudflare protection detected" },
    { pattern: "enable javascript and cookies", reason: "Cloudflare protection detected" },
    { pattern: "access to this page has been denied", reason: "Access denied" },
    { pattern: "you have been blocked", reason: "IP blocked" },
    { pattern: "your ip has been blocked", reason: "IP blocked" },
    { pattern: "rate limit exceeded", reason: "Rate limited" },
    { pattern: "too many requests", reason: "Too many requests" },
    { pattern: "please slow down", reason: "Rate limited" },
    { pattern: "automated access", reason: "Bot detected" },
    { pattern: "unusual traffic", reason: "Bot detected" },
    { pattern: "suspicious activity", reason: "Bot detected" },
  ];

  for (const { pattern, reason } of blockPatterns) {
    if (lowerContent.includes(pattern)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false };
}

function log(message: string): void {
  console.log(message);
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

async function ensureLoggedIn(page: Page): Promise<void> {
  const loginUrl = process.env.STELLARMLS_PING_AUTHORIZE_URL;
  if (!loginUrl) {
    throw new PlaywrightError("Missing STELLARMLS_PING_AUTHORIZE_URL");
  }

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  const html = await page.content();
  const block = detectBlocking(html);
  if (block.blocked) {
    throw new PlaywrightError(`Blocked during StellarMLS login: ${block.reason}`);
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
      throw new PlaywrightError("Missing STELLARMLS_USERNAME or STELLARMLS_PASSWORD");
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
    throw new PlaywrightError("MFA required for StellarMLS login");
  }

  await page.goto(REALIST_SAML_URL, { waitUntil: "domcontentloaded" });
}

async function run(): Promise<void> {
  const mode = resolveMode();
  const useLocal = mode === "local" || (mode === "auto" && !PLAYWRIGHT_CDP_ENDPOINT);

  if (!useLocal && !PLAYWRIGHT_CDP_ENDPOINT) {
    throw new PlaywrightError(
      "Missing PLAYWRIGHT_CDP_ENDPOINT (or PLAYWRIGHT_WS_ENDPOINT) for remote session"
    );
  }

  const browser = useLocal
    ? await chromium.launch({ headless: PLAYWRIGHT_HEADLESS, args: HARDENED_LAUNCH_ARGS })
    : await chromium.connectOverCDP(PLAYWRIGHT_CDP_ENDPOINT!, { timeout: 30000 });

  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1920, height: 1080 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });

  context.setDefaultTimeout(90000);
  context.setDefaultNavigationTimeout(45000);

  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);

    const storageState = await context.storageState();
    const json = JSON.stringify(storageState);
    const base64 = Buffer.from(json, "utf-8").toString("base64");

    log("\nGenerated StellarMLS storageState:");
    log(`STELLARMLS_STORAGE_STATE_B64=${base64}`);
    if (printJson) {
      log(`STELLARMLS_STORAGE_STATE_JSON=${json}`);
    } else {
      log("(Pass --json to print raw JSON)");
    }
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("[stellar-session] Failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
