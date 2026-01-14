/**
 * Meta Leadgen Normalizer
 * 
 * Normalizes Meta Lead Ads field data into structured contact information.
 * Handles common Meta Lead form field names and variations.
 */

export interface MetaLeadFieldData {
  name: string;
  values?: string[];
}

export interface MetaLeadgen {
  id: string;
  created_time?: string;
  field_data?: MetaLeadFieldData[];
}

export interface NormalizedMetaLead {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  addressParts?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  /** For debugging / future improvements */
  matchedKeys?: Record<string, string | undefined>;
}

function normKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function firstValue(field?: MetaLeadFieldData): string | undefined {
  const v = field?.values?.[0];
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : undefined;
}

function findField(fields: MetaLeadFieldData[], candidates: string[]): MetaLeadFieldData | undefined {
  const set = new Set(candidates.map(normKey));
  return fields.find((f) => set.has(normKey(f.name)));
}

function findByHeuristic(fields: MetaLeadFieldData[], predicate: (k: string) => boolean): MetaLeadFieldData | undefined {
  return fields.find((f) => predicate(normKey(f.name)));
}

/**
 * Normalize Meta Lead Ads field data into structured contact information
 * 
 * @param lead - The leadgen response from Meta Graph API
 * @returns Normalized lead data with name, email, phone, and address
 */
export function normalizeMetaLeadgen(lead: MetaLeadgen): NormalizedMetaLead {
  const fields = lead.field_data ?? [];

  // --- email ---
  const emailField =
    findField(fields, ["email", "email_address", "e_mail"]) ??
    findByHeuristic(fields, (k) => k.includes("email"));

  const email = firstValue(emailField);

  // --- phone ---
  const phoneField =
    findField(fields, ["phone_number", "phone", "mobile_phone_number", "mobile", "cell", "cell_phone"]) ??
    findByHeuristic(fields, (k) => k.includes("phone") || k.includes("mobile") || k.includes("cell"));

  const phoneRaw = firstValue(phoneField);
  const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, "").trim() : undefined;

  // --- name ---
  const fullNameField =
    findField(fields, ["full_name", "fullname", "name"]) ??
    findByHeuristic(fields, (k) => k === "full_name" || k === "name" || k.includes("full_name"));

  const firstNameField = findField(fields, ["first_name", "firstname", "given_name"]);
  const lastNameField = findField(fields, ["last_name", "lastname", "surname", "family_name"]);

  const fullName = firstValue(fullNameField);
  const firstName = firstValue(firstNameField);
  const lastName = firstValue(lastNameField);

  const name =
    fullName ??
    ([firstName, lastName].filter(Boolean).join(" ").trim() || undefined);

  // --- address (best-effort) ---
  const streetField =
    findField(fields, ["street_address", "address", "home_address", "property_address"]) ??
    findByHeuristic(fields, (k) => k.includes("street") || (k.includes("address") && !k.includes("email")));

  const cityField = findField(fields, ["city", "town"]);
  const stateField = findField(fields, ["state", "province", "region"]);
  const zipField = findField(fields, ["zip", "zipcode", "postal_code", "postcode"]);
  const countryField = findField(fields, ["country"]);

  const street = firstValue(streetField);
  const city = firstValue(cityField);
  const state = firstValue(stateField);
  const zip = firstValue(zipField);
  const country = firstValue(countryField);

  const addressParts = { street, city, state, zip, country };

  // Build a single-line address if we have at least street or (city/state/zip)
  const addressPieces: string[] = [];
  if (street) addressPieces.push(street);

  const cityStateZip: string[] = [];
  if (city) cityStateZip.push(city);
  if (state) cityStateZip.push(state);
  if (zip) cityStateZip.push(zip);

  if (cityStateZip.length) addressPieces.push(cityStateZip.join(", ").replace(/,\s*,/g, ", "));
  if (country) addressPieces.push(country);

  const address = addressPieces.length ? addressPieces.join(", ") : undefined;

  return {
    name,
    email,
    phone,
    address,
    addressParts: Object.values(addressParts).some(Boolean) ? addressParts : undefined,
    matchedKeys: {
      email: emailField?.name,
      phone: phoneField?.name,
      full_name: fullNameField?.name,
      first_name: firstNameField?.name,
      last_name: lastNameField?.name,
      street_address: streetField?.name,
      city: cityField?.name,
      state: stateField?.name,
      zip: zipField?.name,
      country: countryField?.name,
    },
  };
}
