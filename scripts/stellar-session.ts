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

async function waitForDaVinciWidget(page: Page, timeoutMs: number = 15000): Promise<void> {
  log("[stellar-session] Waiting for DaVinci login widget to load...");

  try {
    // Wait for any input field to appear (widget has rendered)
    await page.waitForSelector("input", { timeout: timeoutMs });
  } catch {
    log("[stellar-session] No input field appeared within timeout");
  }

  // Additional wait for network activity to settle
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

/**
 * Detect MFA prompts by checking for specific UI elements, not CSS class names
 * This avoids false positives from stylesheet content
 */
function detectMfaRequired(pageContent: string): { required: boolean; reason?: string } {
  // Only check the visible text content, not style/script blocks
  // Remove style and script blocks to avoid false positives
  const cleanedContent = pageContent
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .toLowerCase();

  const mfaPatterns = [
    { pattern: "multi-factor authentication", reason: "MFA prompt detected" },
    { pattern: "enter verification code", reason: "Verification code requested" },
    { pattern: "one-time password", reason: "OTP requested" },
    { pattern: "enter the code", reason: "Code entry requested" },
    { pattern: "we sent a code", reason: "Code sent notification" },
    { pattern: "authentication code", reason: "Auth code requested" },
    { pattern: "verify your identity", reason: "Identity verification required" },
    { pattern: "two-factor authentication", reason: "2FA prompt detected" },
    { pattern: "security code", reason: "Security code requested" },
    { pattern: "6-digit code", reason: "OTP code requested" },
  ];

  for (const { pattern, reason } of mfaPatterns) {
    if (cleanedContent.includes(pattern)) {
      return { required: true, reason };
    }
  }

  return { required: false };
}

async function ensureLoggedIn(page: Page): Promise<void> {
  const loginUrl = process.env.STELLARMLS_PING_AUTHORIZE_URL;
  if (!loginUrl) {
    throw new PlaywrightError("Missing STELLARMLS_PING_AUTHORIZE_URL");
  }

  const username = process.env.STELLARMLS_USERNAME;
  const password = process.env.STELLARMLS_PASSWORD;

  if (!username || !password) {
    throw new PlaywrightError("Missing STELLARMLS_USERNAME or STELLARMLS_PASSWORD");
  }

  log("[stellar-session] Navigating to StellarMLS login...");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  const html = await page.content();
  const block = detectBlocking(html);
  if (block.blocked) {
    throw new PlaywrightError(`Blocked during StellarMLS login: ${block.reason}`);
  }

  // Wait for DaVinci widget to render
  await waitForDaVinciWidget(page);

  // PingOne DaVinci login flow - Step 1: Enter MLS ID
  // The form uses React Aria components, so we need flexible selectors
  const mlsIdSelectors = [
    // DaVinci widget selectors (React Aria)
    'input[aria-labelledby*="Stellar MLS ID" i]',
    'label:has-text("Stellar MLS ID") + div input',
    'label:has-text("MLS ID") + div input',
    // Generic visible input (DaVinci form usually has one input per step)
    'form.rjsf input:not([type="hidden"])',
    'input.is-default',
    // Fallback traditional selectors
    'input[name="pf.username"]',
    'input[name="username"]',
    'input[type="text"]:visible',
    'input:not([type="hidden"]):not([type="submit"]):visible',
  ];

  let inputField = await findFirstVisible(page, mlsIdSelectors);

  if (!inputField) {
    // Try to find any visible input
    const allInputs = await page.locator("input:visible").all();
    log(`[stellar-session] Found ${allInputs.length} visible inputs`);
    if (allInputs.length > 0) {
      inputField = allInputs[0];
    }
  }

  if (!inputField) {
    throw new PlaywrightError("Could not find MLS ID input field");
  }

  log("[stellar-session] Entering MLS ID...");
  await inputField.fill(username, { timeout: 10000 });

  // Find and click submit button
  const submitSelectors = [
    'button[data-id="form-submit-button"]',
    'button[type="submit"]',
    'button:has-text("Log In")',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'input[type="submit"]',
  ];

  let submitButton = await findFirstVisible(page, submitSelectors);
  if (submitButton) {
    log("[stellar-session] Clicking submit button...");
    await submitButton.click();
  } else {
    log("[stellar-session] No submit button found, pressing Enter...");
    await inputField.press("Enter");
  }

  // Wait for next step
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  // Step 2: Check for password field (multi-step login)
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="pf.pass"]',
    'input[name="password"]',
    'label:has-text("Password") + div input',
    'input[autocomplete="current-password"]',
  ];

  let passwordField = await findFirstVisible(page, passwordSelectors);

  // If no password field, check if we're on a different step or need to wait
  if (!passwordField) {
    log("[stellar-session] Waiting for password field...");
    await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
    passwordField = await findFirstVisible(page, passwordSelectors);
  }

  if (passwordField) {
    log("[stellar-session] Entering password...");
    await passwordField.fill(password, { timeout: 10000 });

    submitButton = await findFirstVisible(page, submitSelectors);
    if (submitButton) {
      await submitButton.click();
    } else {
      await passwordField.press("Enter");
    }

    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  }

  // Check for MFA prompt using improved detection
  const postLoginHtml = await page.content().catch(() => "");
  const mfaCheck = detectMfaRequired(postLoginHtml);
  if (mfaCheck.required) {
    throw new PlaywrightError(`MFA required for StellarMLS login: ${mfaCheck.reason}`);
  }

  // Check for login errors
  const lowerHtml = postLoginHtml.toLowerCase();
  if (lowerHtml.includes("invalid") && lowerHtml.includes("credentials")) {
    throw new PlaywrightError("Invalid credentials for StellarMLS login");
  }
  if (lowerHtml.includes("account locked") || lowerHtml.includes("account disabled")) {
    throw new PlaywrightError("StellarMLS account is locked or disabled");
  }

  log("[stellar-session] Login complete, navigating to Realist...");
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
