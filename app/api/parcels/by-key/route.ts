/**
 * GET /api/parcels/by-key
 * 
 * Get a parcel by its unique key (stateFips, countyFips, parcelIdNorm).
 */

import { NextRequest, NextResponse } from "next/server";
import { parcelKeySchema } from "@/lib/parcels/api/schemas";
import {
  findParcelByKey,
  getParcelAssessments,
  getParcelSales,
} from "@/lib/parcels/storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Extract and validate params
    const params = {
      stateFips: searchParams.get("stateFips"),
      countyFips: searchParams.get("countyFips"),
      parcelIdNorm: searchParams.get("parcelIdNorm"),
    };

    const parsed = parcelKeySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Find parcel
    const parcel = await findParcelByKey(parsed.data);
    if (!parcel) {
      return NextResponse.json(
        { error: "Parcel not found" },
        { status: 404 }
      );
    }

    // Check if assessments and sales should be included
    const includeAssessments = searchParams.get("includeAssessments") !== "false";
    const includeSales = searchParams.get("includeSales") !== "false";

    // Fetch related data
    const [assessments, sales] = await Promise.all([
      includeAssessments ? getParcelAssessments(parcel.id) : Promise.resolve([]),
      includeSales ? getParcelSales(parcel.id) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      parcel,
      assessments: includeAssessments ? assessments : undefined,
      sales: includeSales ? sales : undefined,
    });
  } catch (error) {
    console.error("[API /parcels/by-key] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
