/**
 * Playwright Browser Manager
 *
 * Centralized browser lifecycle management for Playwright-based scraping.
 * Supports both local Chromium and remote browser connections.
 */

import "server-only";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

// Configuration from environment
const PLAYWRIGHT_WS_ENDPOINT = process.env.PLAYWRIGHT_WS_ENDPOINT;
const PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "false";
const DEFAULT_NAV_TIMEOUT_MS = parseInt(process.env.PAO_NAV_TIMEOUT_MS || "45000", 10);
const DEFAULT_OP_TIMEOUT_MS = parseInt(process.env.PAO_SCRAPE_TIMEOUT_MS || "60000", 10);

// Browser singleton for connection reuse (helps in warm lambdas / long-running servers)
let browserInstance: Browser | null = null;
let browserConnectionPromise: Promise<Browser> | null = null;

export type PlaywrightBrowserMode = "remote" | "local" | "auto";

export interface PlaywrightBrowserConfig {
  wsEndpoint?: string;
  mode?: PlaywrightBrowserMode;
  navTimeoutMs?: number;
  opTimeoutMs?: number;
  userAgent?: string;
  headless?: boolean;
}

/**
 * Hardened launch arguments for local Chromium
 * Reduces detection and improves stability
 */
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

/**
 * Default user agent to use (modern Chrome on Windows)
 */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Check if Playwright is configured and available for use in this environment
 * 
 * @returns Object with ok status and optional reason if not configured
 */
export function canUsePlaywrightInThisEnv(): { ok: boolean; reason?: string } {
  const isProduction = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  
  // In production (Vercel), require remote WS endpoint
  if (isProduction && !PLAYWRIGHT_WS_ENDPOINT) {
    return {
      ok: false,
      reason: "PLAYWRIGHT_WS_ENDPOINT not set - remote browser required in production",
    };
  }
  
  // In development, always allow (will attempt local launch)
  return { ok: true };
}

/**
 * Get or create a browser instance
 * Uses singleton pattern for connection reuse
 */
export async function getBrowser(config?: PlaywrightBrowserConfig): Promise<Browser> {
  const wsEndpoint = config?.wsEndpoint || PLAYWRIGHT_WS_ENDPOINT;
  const mode = config?.mode || "auto";

  // Determine connection mode
  const useRemote = mode === "remote" || (mode === "auto" && wsEndpoint);

  // Check if existing browser is still connected
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  // Avoid concurrent connection attempts
  if (browserConnectionPromise) {
    return browserConnectionPromise;
  }

  browserConnectionPromise = (async () => {
    try {
      if (useRemote && wsEndpoint) {
        console.log("[Playwright] Connecting to remote browser:", wsEndpoint.substring(0, 50) + "...");
        browserInstance = await chromium.connect(wsEndpoint, {
          timeout: config?.opTimeoutMs || DEFAULT_OP_TIMEOUT_MS,
        });
      } else {
        console.log("[Playwright] Launching local Chromium browser");
        browserInstance = await chromium.launch({
          headless: config?.headless ?? PLAYWRIGHT_HEADLESS,
          args: HARDENED_LAUNCH_ARGS,
        });
      }

      // Handle browser disconnect
      browserInstance.on("disconnected", () => {
        console.log("[Playwright] Browser disconnected");
        browserInstance = null;
        browserConnectionPromise = null;
      });

      return browserInstance;
    } catch (error) {
      browserConnectionPromise = null;
      throw error;
    }
  })();

  return browserConnectionPromise;
}

/**
 * Close the browser instance if it exists
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore close errors
    }
    browserInstance = null;
    browserConnectionPromise = null;
  }
}

/**
 * Execute a function with a new page, handling context creation and cleanup
 * This is the primary API for running Playwright operations
 */
export async function withPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
  config?: PlaywrightBrowserConfig
): Promise<T> {
  const browser = await getBrowser(config);
  const navTimeout = config?.navTimeoutMs || DEFAULT_NAV_TIMEOUT_MS;
  const opTimeout = config?.opTimeoutMs || DEFAULT_OP_TIMEOUT_MS;
  const userAgent = config?.userAgent || DEFAULT_USER_AGENT;

  // Create a fresh browser context for isolation
  const context = await browser.newContext({
    userAgent,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1920, height: 1080 },
    // Avoid some detection techniques
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });

  // Set default timeouts
  context.setDefaultTimeout(opTimeout);
  context.setDefaultNavigationTimeout(navTimeout);

  const page = await context.newPage();

  try {
    return await fn(page, context);
  } finally {
    // Always close the context to free resources
    try {
      await context.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Check if Playwright is configured and available
 * For local mode, always returns true (will attempt local launch)
 * For remote mode, checks if endpoint is configured
 */
export function isPlaywrightConfigured(mode?: PlaywrightBrowserMode): boolean {
  const effectiveMode = mode || "auto";
  
  if (effectiveMode === "remote") {
    return !!PLAYWRIGHT_WS_ENDPOINT;
  }
  
  // Local and auto modes are always considered "configured"
  // (may fail at runtime if Chromium isn't installed)
  return true;
}

/**
 * Common error types for Playwright operations
 */
export class PlaywrightError extends Error {
  constructor(
    message: string,
    public readonly code: "BROWSER_LAUNCH_FAILED" | "NAVIGATION_FAILED" | "TIMEOUT" | "BLOCKED" | "PARSE_ERROR",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "PlaywrightError";
  }
}

/**
 * Detect common bot detection / blocking patterns
 * Uses specific phrases to avoid false positives from normal page content
 */
export function detectBlocking(pageContent: string): { blocked: boolean; reason?: string } {
  const lowerContent = pageContent.toLowerCase();

  // More specific blocking patterns to avoid false positives
  const blockPatterns = [
    // CAPTCHA patterns
    { pattern: "recaptcha", reason: "reCAPTCHA detected" },
    { pattern: "hcaptcha", reason: "hCaptcha detected" },
    { pattern: "solve this captcha", reason: "CAPTCHA detected" },
    { pattern: "complete the captcha", reason: "CAPTCHA detected" },
    
    // Human verification
    { pattern: "verify you are human", reason: "Human verification required" },
    { pattern: "prove you're not a robot", reason: "Human verification required" },
    { pattern: "i'm not a robot", reason: "Human verification required" },
    
    // Cloudflare specific
    { pattern: "checking your browser", reason: "Cloudflare protection detected" },
    { pattern: "ray id:", reason: "Cloudflare protection detected" },
    { pattern: "enable javascript and cookies", reason: "Cloudflare protection detected" },
    
    // Access denial patterns (more specific)
    { pattern: "access to this page has been denied", reason: "Access denied" },
    { pattern: "you have been blocked", reason: "IP blocked" },
    { pattern: "your ip has been blocked", reason: "IP blocked" },
    { pattern: "your access has been blocked", reason: "Access blocked" },
    
    // Rate limiting (more specific)
    { pattern: "rate limit exceeded", reason: "Rate limited" },
    { pattern: "too many requests", reason: "Too many requests" },
    { pattern: "please slow down", reason: "Rate limited" },
    
    // Bot detection
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
