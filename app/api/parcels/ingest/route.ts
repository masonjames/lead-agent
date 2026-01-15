/**
 * POST /api/parcels/ingest
 * 
 * Ingest a parcel by address or parcel ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { ingestRequestSchema } from "@/lib/parcels/api/schemas";
import { ingestParcelByAddress } from "@/lib/parcels/ingestion";

export const runtime = "nodejs";
export const maxDuration = 120; // 2 minutes for Playwright operations

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request
    const parsed = ingestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { address, parcelId, sourceKey, force } = parsed.data;

    // Run ingestion pipeline
    const result = await ingestParcelByAddress({
      sourceKey,
      address,
      parcelId,
      force,
    });

    // Return appropriate status based on result
    if (result.status === "SUCCESS") {
      return NextResponse.json(result, { status: 200 });
    } else if (result.status === "SKIPPED") {
      return NextResponse.json(result, { status: 404 });
    } else {
      return NextResponse.json(result, { status: 500 });
    }
  } catch (error) {
    console.error("[API /parcels/ingest] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
