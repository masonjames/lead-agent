/**
 * Parcel ID Normalization Utilities
 */

/**
 * Normalize a parcel ID to a canonical form.
 * 
 * For Manatee County (and most Florida counties):
 * - Strip non-alphanumeric characters
 * - Convert to uppercase
 * - Preserve leading zeros
 */
export function normalizeParcelId(raw: string): string {
  if (!raw) return "";
  
  // Strip non-alphanumeric characters except hyphens
  // (some counties use hyphenated IDs)
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toUpperCase();
}

/**
 * Normalize a numeric-only parcel ID.
 * Strips all non-digits.
 */
export function normalizeNumericParcelId(raw: string): string {
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

/**
 * Extract parcel ID from a Manatee PAO detail URL.
 * URLs look like: https://www.manateepao.gov/property/?parid=12345
 */
export function extractParcelIdFromManateePaoUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const parid = urlObj.searchParams.get("parid");
    return parid ? normalizeParcelId(parid) : null;
  } catch {
    // Try regex fallback
    const match = url.match(/parid=([^&]+)/i);
    return match ? normalizeParcelId(match[1]) : null;
  }
}

/**
 * Extract parcel ID from a Sarasota PAO detail URL.
 * URLs look like: https://www.sc-pa.com/propertysearch/parcel/details/1234567890
 * or https://www.sc-pa.com/propertysearch/parcel/1234567890
 */
export function extractParcelIdFromSarasotaPaoUrl(url: string): string | null {
  // Sarasota uses 10-digit parcel IDs in the URL path
  const match = url.match(/\/parcel(?:\/details)?\/(\d+)/);
  return match ? normalizeParcelId(match[1]) : null;
}
