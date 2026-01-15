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

// Retry configuration
const MAX_CONNECTION_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const CONNECTION_TIMEOUT_MS = 30000;

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
 * Sleep utility for retry delays
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect to remote browser with retry logic
 */
async function connectWithRetry(
  wsEndpoint: string,
  timeout: number,
  maxRetries: number = MAX_CONNECTION_RETRIES
): Promise<Browser> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Playwright] Connection attempt ${attempt}/${maxRetries}...`);

      // Use connectOverCDP for Browserless.io and similar services
      // This is the recommended method for CDP-based browser services
      const browser = await chromium.connectOverCDP(wsEndpoint);

      console.log(`[Playwright] Connected to remote browser on attempt ${attempt}`);
      return browser;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[Playwright] Connection attempt ${attempt} failed: ${lastError.message}`);

      // Don't retry on the last attempt
      if (attempt < maxRetries) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`[Playwright] Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw new PlaywrightError(
    `Failed to connect to remote browser after ${maxRetries} attempts: ${lastError?.message}`,
    "BROWSER_LAUNCH_FAILED",
    lastError
  );
}

/**
 * Get or create a browser instance
 * Uses singleton pattern for connection reuse with retry logic
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

  // Reset if browser exists but is disconnected
  if (browserInstance && !browserInstance.isConnected()) {
    console.log("[Playwright] Browser disconnected, reconnecting...");
    browserInstance = null;
    browserConnectionPromise = null;
  }

  // Avoid concurrent connection attempts
  if (browserConnectionPromise) {
    return browserConnectionPromise;
  }

  browserConnectionPromise = (async () => {
    try {
      if (useRemote && wsEndpoint) {
        console.log("[Playwright] Connecting to remote browser:", wsEndpoint.substring(0, 50) + "...");
        browserInstance = await connectWithRetry(
          wsEndpoint,
          config?.opTimeoutMs || CONNECTION_TIMEOUT_MS
        );
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
 * Includes retry logic for connection failures during operation
 */
export async function withPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
  config?: PlaywrightBrowserConfig
): Promise<T> {
  const navTimeout = config?.navTimeoutMs || DEFAULT_NAV_TIMEOUT_MS;
  const opTimeout = config?.opTimeoutMs || DEFAULT_OP_TIMEOUT_MS;
  const userAgent = config?.userAgent || DEFAULT_USER_AGENT;

  const maxRetries = 2; // Retry once if browser disconnects
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let context: BrowserContext | null = null;

    try {
      const browser = await getBrowser(config);

      // Create a fresh browser context for isolation
      context = await browser.newContext({
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

      const result = await fn(page, context);

      // Close context on success
      try {
        await context.close();
      } catch {
        // Ignore close errors
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message.toLowerCase();

      // Check if this is a recoverable connection error
      const isConnectionError =
        errorMsg.includes("browser has been closed") ||
        errorMsg.includes("target closed") ||
        errorMsg.includes("connection refused") ||
        errorMsg.includes("websocket error") ||
        errorMsg.includes("disconnected");

      // Always try to close the context
      if (context) {
        try {
          await context.close();
        } catch {
          // Ignore close errors
        }
      }

      // Only retry on connection errors
      if (isConnectionError && attempt < maxRetries) {
        console.warn(`[Playwright] Operation failed due to connection error, retrying (attempt ${attempt}/${maxRetries})...`);
        // Reset browser instance to force reconnection
        browserInstance = null;
        browserConnectionPromise = null;
        await sleep(INITIAL_RETRY_DELAY_MS);
        continue;
      }

      // Not a connection error or out of retries
      throw lastError;
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError || new Error("withPage failed without error");
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
