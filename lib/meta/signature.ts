/**
 * Meta Webhook Signature Verification
 * 
 * Verifies X-Hub-Signature-256 header from Meta webhooks
 * using HMAC SHA256 with the app secret.
 */

import crypto from "crypto";

/**
 * Verify the X-Hub-Signature-256 header from a Meta webhook
 * 
 * @param params - Verification parameters
 * @returns Result object with ok status and optional reason
 */
export function verifyXHubSignature256(params: {
  rawBody: ArrayBuffer | Buffer | string;
  header: string | null;
  appSecret: string;
}): { ok: boolean; reason?: string } {
  const { rawBody, header, appSecret } = params;

  // Header is required
  if (!header) {
    return { ok: false, reason: "Missing X-Hub-Signature-256 header" };
  }

  // Header format: "sha256=<hex>"
  if (!header.startsWith("sha256=")) {
    return { ok: false, reason: "Invalid signature format (expected sha256=...)" };
  }

  const providedSignature = header.slice(7); // Remove "sha256=" prefix

  // Validate hex format
  if (!/^[a-f0-9]{64}$/i.test(providedSignature)) {
    return { ok: false, reason: "Invalid signature hex format" };
  }

  // Convert rawBody to Buffer
  let bodyBuffer: Buffer;
  if (typeof rawBody === "string") {
    bodyBuffer = Buffer.from(rawBody, "utf-8");
  } else if (rawBody instanceof ArrayBuffer) {
    bodyBuffer = Buffer.from(rawBody);
  } else {
    bodyBuffer = rawBody;
  }

  // Compute expected signature
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(bodyBuffer)
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );

    if (!isValid) {
      return { ok: false, reason: "Signature mismatch" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "Signature comparison failed" };
  }
}

/**
 * Parse the Meta webhook payload to extract leadgen entries
 * 
 * Meta sends webhooks with this structure:
 * {
 *   "object": "page",
 *   "entry": [
 *     {
 *       "id": "page_id",
 *       "time": 1234567890,
 *       "changes": [
 *         {
 *           "field": "leadgen",
 *           "value": {
 *             "leadgen_id": "123456789",
 *             "page_id": "page_id",
 *             "form_id": "form_id",
 *             "ad_id": "ad_id",
 *             "created_time": 1234567890
 *           }
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
export interface MetaWebhookLeadgenEntry {
  leadgenId: string;
  pageId?: string;
  formId?: string;
  adId?: string;
  createdTime?: number;
}

export interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    changes: Array<{
      field: string;
      value: {
        leadgen_id: string;
        page_id?: string;
        form_id?: string;
        ad_id?: string;
        created_time?: number;
      };
    }>;
  }>;
}

/**
 * Extract leadgen entries from a Meta webhook payload
 */
export function extractLeadgenEntries(payload: MetaWebhookPayload): MetaWebhookLeadgenEntry[] {
  const entries: MetaWebhookLeadgenEntry[] = [];

  if (payload.object !== "page") {
    console.warn(`[Meta Webhook] Unexpected object type: ${payload.object}`);
    return entries;
  }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === "leadgen" && change.value?.leadgen_id) {
        entries.push({
          leadgenId: change.value.leadgen_id,
          pageId: change.value.page_id,
          formId: change.value.form_id,
          adId: change.value.ad_id,
          createdTime: change.value.created_time,
        });
      }
    }
  }

  return entries;
}
