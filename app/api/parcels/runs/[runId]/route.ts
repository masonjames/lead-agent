/**
 * GET /api/parcels/runs/:runId
 * 
 * Get details of an ingestion run.
 */

import { NextRequest, NextResponse } from "next/server";
import { getIngestionRun } from "@/lib/parcels/storage";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { runId } = await params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(runId)) {
      return NextResponse.json(
        { error: "Invalid run ID format" },
        { status: 400 }
      );
    }

    // Find run
    const run = await getIngestionRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: "Run not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ run });
  } catch (error) {
    console.error("[API /parcels/runs/:runId] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
