/**
 * GET /api/parcels/sources
 * 
 * List all available parcel sources.
 */

import { NextResponse } from "next/server";
import { listParcelSources } from "@/lib/parcels/registry";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sources = listParcelSources();

    return NextResponse.json({
      sources: sources.map((source) => ({
        key: source.key,
        displayName: source.displayName,
        stateFips: source.config.stateFips,
        countyFips: source.config.countyFips,
        sourceType: source.config.sourceType,
        platformFamily: source.config.platformFamily,
        baseUrl: source.config.baseUrl,
        capabilities: source.config.capabilities,
      })),
    });
  } catch (error) {
    console.error("[API /parcels/sources] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
