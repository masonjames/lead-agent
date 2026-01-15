/**
 * GET /api/parcels/:parcelId
 * 
 * Get a parcel by its UUID, including assessments and sales.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  findParcelById,
  getParcelAssessments,
  getParcelSales,
} from "@/lib/parcels/storage";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ parcelId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { parcelId } = await params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(parcelId)) {
      return NextResponse.json(
        { error: "Invalid parcel ID format" },
        { status: 400 }
      );
    }

    // Find parcel
    const parcel = await findParcelById(parcelId);
    if (!parcel) {
      return NextResponse.json(
        { error: "Parcel not found" },
        { status: 404 }
      );
    }

    // Check if assessments and sales should be included
    const includeAssessments = request.nextUrl.searchParams.get("includeAssessments") !== "false";
    const includeSales = request.nextUrl.searchParams.get("includeSales") !== "false";

    // Fetch related data
    const [assessments, sales] = await Promise.all([
      includeAssessments ? getParcelAssessments(parcelId) : Promise.resolve([]),
      includeSales ? getParcelSales(parcelId) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      parcel,
      assessments: includeAssessments ? assessments : undefined,
      sales: includeSales ? sales : undefined,
    });
  } catch (error) {
    console.error("[API /parcels/:parcelId] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
