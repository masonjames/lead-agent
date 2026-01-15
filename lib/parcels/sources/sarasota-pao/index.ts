/**
 * Sarasota County PAO Source
 *
 * Re-exports and auto-registration.
 */

export * from "./constants";
export * from "./normalize";
export { SarasotaPaoAdapter, createSarasotaPaoAdapter } from "./adapter";

// Auto-register the adapter
import { registerParcelAdapter } from "../../registry";
import { createSarasotaPaoAdapter } from "./adapter";
import { SARASOTA_PAO_SOURCE_KEY } from "./constants";

registerParcelAdapter(SARASOTA_PAO_SOURCE_KEY, createSarasotaPaoAdapter);
