/**
 * Hashing Utilities for Parcel Platform
 */

import { createHash } from "crypto";

/**
 * Compute SHA256 hash of a string.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Compute a dedupe key for a sale record.
 * Combines key fields to create a stable identifier.
 */
export function computeSaleKeySha256(sale: {
  saleDate?: string;
  salePrice?: number;
  bookPage?: string;
  instrument?: string;
  grantee?: string;
}): string {
  const parts = [
    sale.saleDate || "",
    sale.salePrice?.toString() || "",
    sale.bookPage || "",
    sale.instrument || "",
    sale.grantee || "",
  ];
  return sha256(parts.join("|"));
}

/**
 * Compute a DOM signature hash from key selectors.
 * Used to detect when a page structure changes.
 */
export function computeDomSignature(signatures: string[]): string {
  return sha256(signatures.sort().join("|"));
}
