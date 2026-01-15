/**
 * Manatee County PAO Source
 * 
 * Re-exports and auto-registration.
 */

export * from "./constants";
export * from "./normalize";
export { ManateePaoAdapter, createManateePaoAdapter } from "./adapter";

// Auto-register the adapter
import { registerParcelAdapter } from "../../registry";
import { createManateePaoAdapter } from "./adapter";
import { MANATEE_PAO_SOURCE_KEY } from "./constants";

registerParcelAdapter(MANATEE_PAO_SOURCE_KEY, createManateePaoAdapter);
