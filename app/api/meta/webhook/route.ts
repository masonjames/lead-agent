/**
 * Meta Webhooks Endpoint
 * 
 * Handles Facebook Lead Ads webhook events:
 * - GET: Verification handshake (hub.challenge)
 * - POST: Lead events with X-Hub-Signature-256 validation
 */

import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { verifyXHubSignature256, extractLeadgenEntries } from "@/lib/meta/signature";
import type { MetaWebhookPayload } from "@/lib/meta/signature";
import { workflowMetaLead } from "@/workflows/meta";

// Force Node.js runtime for crypto operations
export const runtime = "nodejs";

/**
 * GET /api/meta/webhook
 * 
 * Meta verification handshake - responds with hub.challenge
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  console.log("[Meta Webhook] Verification request:", { mode, hasToken: !!token, hasChallenge: !!challenge });

  const verifyToken = process.env.META_VERIFY_TOKEN;
  
  if (!verifyToken) {
    console.error("[Meta Webhook] META_VERIFY_TOKEN not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[Meta Webhook] Verification successful");
    // Return challenge as plain text (Meta expects this)
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[Meta Webhook] Verification failed - token mismatch or invalid mode");
  return NextResponse.json(
    { error: "Verification failed" },
    { status: 403 }
  );
}

/**
 * POST /api/meta/webhook
 * 
 * Receives lead events from Meta and starts enrichment workflows
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.META_APP_SECRET;
  
  if (!appSecret) {
    console.error("[Meta Webhook] META_APP_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  // Read raw body for signature verification
  const rawBody = await request.arrayBuffer();
  const signatureHeader = request.headers.get("X-Hub-Signature-256");

  // Verify signature
  const verification = verifyXHubSignature256({
    rawBody,
    header: signatureHeader,
    appSecret,
  });

  if (!verification.ok) {
    console.error("[Meta Webhook] Signature verification failed:", verification.reason);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // Parse payload
  let payload: MetaWebhookPayload;
  try {
    const bodyText = Buffer.from(rawBody).toString("utf-8");
    payload = JSON.parse(bodyText);
  } catch (error) {
    console.error("[Meta Webhook] Failed to parse payload:", error);
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  console.log("[Meta Webhook] Received webhook:", {
    object: payload.object,
    entryCount: payload.entry?.length || 0,
  });

  // Extract leadgen entries
  const leadgenEntries = extractLeadgenEntries(payload);
  
  if (leadgenEntries.length === 0) {
    console.log("[Meta Webhook] No leadgen entries found in payload");
    return NextResponse.json({ received: true, leads: 0 });
  }

  console.log(`[Meta Webhook] Processing ${leadgenEntries.length} lead(s)`);

  // Start workflows for each lead (async, non-blocking)
  const workflowResults: Array<{ leadgenId: string; status: string; error?: string }> = [];

  for (const entry of leadgenEntries) {
    try {
      console.log(`[Meta Webhook] Starting workflow for lead ${entry.leadgenId}`);
      
      // Start the enrichment workflow
      // Using leadgenId as a stable identifier for potential deduplication
      await start(workflowMetaLead, [{
        leadgenId: entry.leadgenId,
        formId: entry.formId,
        pageId: entry.pageId,
        adId: entry.adId,
        createdTime: entry.createdTime,
        rawWebhook: payload,
      }]);

      workflowResults.push({
        leadgenId: entry.leadgenId,
        status: "started",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Meta Webhook] Failed to start workflow for lead ${entry.leadgenId}:`, errorMessage);
      
      workflowResults.push({
        leadgenId: entry.leadgenId,
        status: "failed",
        error: errorMessage,
      });
    }
  }

  // Respond quickly to Meta (they expect fast responses)
  return NextResponse.json({
    received: true,
    leads: leadgenEntries.length,
    results: workflowResults,
  });
}
