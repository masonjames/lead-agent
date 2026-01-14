/**
 * Address Normalization Utility
 *
 * Normalizes addresses to USPS standard abbreviations for reliable PAO search.
 * The Manatee County PAO search requires exact USPS abbreviations for street
 * suffixes (e.g., "Ter" not "Terrace", "Blvd" not "Boulevard").
 *
 * This module provides:
 * - Street suffix normalization (Terrace → Ter, Boulevard → Blvd)
 * - Directional normalization (North → N, Southwest → SW)
 * - Unit designator normalization (Apartment → Apt, Suite → Ste)
 */

// ============================================================================
// USPS Standard Abbreviations
// ============================================================================

/**
 * USPS Street Suffix Abbreviations
 * Source: USPS Publication 28 - Postal Addressing Standards
 * https://pe.usps.com/text/pub28/28apc_002.htm
 *
 * Key: Full word (lowercase) → USPS abbreviation
 */
const STREET_SUFFIX_MAP: Record<string, string> = {
  // Common suffixes (most frequently mistyped)
  alley: "Aly",
  avenue: "Ave",
  boulevard: "Blvd",
  circle: "Cir",
  court: "Ct",
  drive: "Dr",
  expressway: "Expy",
  freeway: "Fwy",
  highway: "Hwy",
  lane: "Ln",
  parkway: "Pkwy",
  place: "Pl",
  road: "Rd",
  street: "St",
  terrace: "Ter",
  trail: "Trl",
  way: "Way",

  // Additional common suffixes
  arcade: "Arc",
  bayou: "Byu",
  beach: "Bch",
  bend: "Bnd",
  bluff: "Blf",
  bluffs: "Blfs",
  bottom: "Btm",
  branch: "Br",
  bridge: "Brg",
  brook: "Brk",
  brooks: "Brks",
  burg: "Bg",
  burgs: "Bgs",
  bypass: "Byp",
  camp: "Cp",
  canyon: "Cyn",
  cape: "Cpe",
  causeway: "Cswy",
  center: "Ctr",
  centers: "Ctrs",
  cliff: "Clf",
  cliffs: "Clfs",
  club: "Clb",
  common: "Cmn",
  commons: "Cmns",
  corner: "Cor",
  corners: "Cors",
  course: "Crse",
  cove: "Cv",
  coves: "Cvs",
  creek: "Crk",
  crescent: "Cres",
  crest: "Crst",
  crossing: "Xing",
  crossroad: "Xrd",
  crossroads: "Xrds",
  curve: "Curv",
  dale: "Dl",
  dam: "Dm",
  divide: "Dv",
  drives: "Drs",
  estate: "Est",
  estates: "Ests",
  extension: "Ext",
  extensions: "Exts",
  fall: "Fall",
  falls: "Fls",
  ferry: "Fry",
  field: "Fld",
  fields: "Flds",
  flat: "Flt",
  flats: "Flts",
  ford: "Frd",
  fords: "Frds",
  forest: "Frst",
  forge: "Frg",
  forges: "Frgs",
  fork: "Frk",
  forks: "Frks",
  fort: "Ft",
  garden: "Gdn",
  gardens: "Gdns",
  gateway: "Gtwy",
  glen: "Gln",
  glens: "Glns",
  green: "Grn",
  greens: "Grns",
  grove: "Grv",
  groves: "Grvs",
  harbor: "Hbr",
  harbors: "Hbrs",
  haven: "Hvn",
  heights: "Hts",
  hill: "Hl",
  hills: "Hls",
  hollow: "Holw",
  inlet: "Inlt",
  island: "Is",
  islands: "Iss",
  isle: "Isle",
  junction: "Jct",
  junctions: "Jcts",
  key: "Ky",
  keys: "Kys",
  knoll: "Knl",
  knolls: "Knls",
  lake: "Lk",
  lakes: "Lks",
  land: "Land",
  landing: "Lndg",
  light: "Lgt",
  lights: "Lgts",
  loaf: "Lf",
  lock: "Lck",
  locks: "Lcks",
  lodge: "Ldg",
  loop: "Loop",
  mall: "Mall",
  manor: "Mnr",
  manors: "Mnrs",
  meadow: "Mdw",
  meadows: "Mdws",
  mews: "Mews",
  mill: "Ml",
  mills: "Mls",
  mission: "Msn",
  motorway: "Mtwy",
  mount: "Mt",
  mountain: "Mtn",
  mountains: "Mtns",
  neck: "Nck",
  orchard: "Orch",
  oval: "Oval",
  overpass: "Opas",
  park: "Park",
  parks: "Parks",
  pass: "Pass",
  passage: "Psge",
  path: "Path",
  pike: "Pike",
  pine: "Pne",
  pines: "Pnes",
  plain: "Pln",
  plains: "Plns",
  plaza: "Plz",
  point: "Pt",
  points: "Pts",
  port: "Prt",
  ports: "Prts",
  prairie: "Pr",
  radial: "Radl",
  ramp: "Ramp",
  ranch: "Rnch",
  rapid: "Rpd",
  rapids: "Rpds",
  rest: "Rst",
  ridge: "Rdg",
  ridges: "Rdgs",
  river: "Riv",
  roads: "Rds",
  route: "Rte",
  row: "Row",
  rue: "Rue",
  run: "Run",
  shoal: "Shl",
  shoals: "Shls",
  shore: "Shr",
  shores: "Shrs",
  skyway: "Skwy",
  spring: "Spg",
  springs: "Spgs",
  spur: "Spur",
  spurs: "Spurs",
  square: "Sq",
  squares: "Sqs",
  station: "Sta",
  stravenue: "Stra",
  stream: "Strm",
  streets: "Sts",
  summit: "Smt",
  throughway: "Trwy",
  trace: "Trce",
  track: "Trak",
  trafficway: "Trfy",
  trails: "Trls",
  trailer: "Trlr",
  tunnel: "Tunl",
  turnpike: "Tpke",
  underpass: "Upas",
  union: "Un",
  unions: "Uns",
  valley: "Vly",
  valleys: "Vlys",
  viaduct: "Via",
  view: "Vw",
  views: "Vws",
  village: "Vlg",
  villages: "Vlgs",
  ville: "Vl",
  vista: "Vis",
  walk: "Walk",
  walks: "Walks",
  wall: "Wall",
  ways: "Ways",
  well: "Wl",
  wells: "Wls",
};

/**
 * USPS Directional Abbreviations
 */
const DIRECTIONAL_MAP: Record<string, string> = {
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  northeast: "NE",
  northwest: "NW",
  southeast: "SE",
  southwest: "SW",
};

/**
 * USPS Unit Designator Abbreviations
 */
const UNIT_DESIGNATOR_MAP: Record<string, string> = {
  apartment: "Apt",
  basement: "Bsmt",
  building: "Bldg",
  department: "Dept",
  floor: "Fl",
  front: "Frnt",
  hangar: "Hngr",
  lobby: "Lbby",
  lot: "Lot",
  lower: "Lowr",
  office: "Ofc",
  penthouse: "Ph",
  pier: "Pier",
  rear: "Rear",
  room: "Rm",
  side: "Side",
  slip: "Slip",
  space: "Spc",
  stop: "Stop",
  suite: "Ste",
  trailer: "Trlr",
  unit: "Unit",
  upper: "Uppr",
};

// ============================================================================
// Types
// ============================================================================

export interface AddressComponents {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface NormalizedAddress extends AddressComponents {
  /** The original input address */
  original: string;
  /** The normalized street address */
  normalizedStreet?: string;
  /** The fully normalized address string */
  normalizedFull: string;
  /** Whether any normalization was applied */
  wasNormalized: boolean;
  /** List of normalizations applied (for debugging) */
  normalizations: string[];
}

// ============================================================================
// Main Normalization Functions
// ============================================================================

/**
 * Normalize an address for PAO search
 *
 * This is the main entry point. It:
 * 1. Parses the address into components
 * 2. Normalizes the street portion (suffixes, directionals)
 * 3. Reconstructs the full address
 *
 * @param input - Raw address string (e.g., "4659 56th Terrace East, Bradenton, FL 34208")
 * @returns Normalized address with metadata
 */
export function normalizeAddressForPao(input: string): NormalizedAddress {
  const original = input.trim();
  const normalizations: string[] = [];

  // Parse address into components
  const components = parseAddressComponents(original);

  // Normalize the street portion
  let normalizedStreet = components.street;
  if (normalizedStreet) {
    const streetResult = normalizeStreet(normalizedStreet);
    normalizedStreet = streetResult.normalized;
    normalizations.push(...streetResult.changes);
  }

  // Reconstruct the full address
  const parts: string[] = [];
  if (normalizedStreet) parts.push(normalizedStreet);
  if (components.city) parts.push(components.city);
  if (components.state && components.zipCode) {
    parts.push(`${components.state} ${components.zipCode}`);
  } else if (components.state) {
    parts.push(components.state);
  } else if (components.zipCode) {
    parts.push(components.zipCode);
  }

  const normalizedFull = parts.join(", ");

  return {
    original,
    street: components.street,
    city: components.city,
    state: components.state,
    zipCode: components.zipCode,
    normalizedStreet,
    normalizedFull,
    wasNormalized: normalizations.length > 0,
    normalizations,
  };
}

/**
 * Normalize just the street portion of an address
 *
 * Use this when you only have the street and want to normalize suffixes/directionals.
 *
 * @param street - Street address (e.g., "4659 56th Terrace East")
 * @returns Normalized street (e.g., "4659 56th Ter E")
 */
export function normalizeStreetForUsps(street: string): string {
  return normalizeStreet(street).normalized;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Normalize a street address
 * Returns both the normalized string and a list of changes made
 */
function normalizeStreet(street: string): { normalized: string; changes: string[] } {
  const changes: string[] = [];
  let result = street.trim();

  // Normalize whitespace
  result = result.replace(/\s+/g, " ");

  // Tokenize the street
  const tokens = result.split(" ");
  const normalizedTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lowerToken = token.toLowerCase();

    // Check if this is a directional
    // Directionals can appear at the beginning (pre-directional) or end (post-directional)
    if (DIRECTIONAL_MAP[lowerToken]) {
      const abbrev = DIRECTIONAL_MAP[lowerToken];
      if (token !== abbrev) {
        changes.push(`${token} → ${abbrev}`);
      }
      normalizedTokens.push(abbrev);
      continue;
    }

    // Check if this is a street suffix
    // Suffixes typically appear near the end, but before post-directional
    // We check if this looks like a suffix position (not the first token, not purely numeric)
    if (STREET_SUFFIX_MAP[lowerToken] && i > 0 && !/^\d+$/.test(token)) {
      const abbrev = STREET_SUFFIX_MAP[lowerToken];
      if (token.toLowerCase() !== abbrev.toLowerCase()) {
        changes.push(`${token} → ${abbrev}`);
      }
      normalizedTokens.push(abbrev);
      continue;
    }

    // Check if this is a unit designator
    if (UNIT_DESIGNATOR_MAP[lowerToken]) {
      const abbrev = UNIT_DESIGNATOR_MAP[lowerToken];
      if (token !== abbrev) {
        changes.push(`${token} → ${abbrev}`);
      }
      normalizedTokens.push(abbrev);
      continue;
    }

    // Keep the token as-is
    normalizedTokens.push(token);
  }

  return {
    normalized: normalizedTokens.join(" "),
    changes,
  };
}

/**
 * Parse an address string into components
 * Handles formats like:
 * - "123 Main St, Bradenton, FL 34208"
 * - "123 Main St, Bradenton FL 34208"
 * - "123 Main St"
 */
function parseAddressComponents(address: string): AddressComponents {
  const parts = address.split(",").map((p) => p.trim());
  const result: AddressComponents = {};

  if (parts.length >= 1) {
    result.street = parts[0];
  }

  if (parts.length >= 2) {
    result.city = parts[1];
  }

  if (parts.length >= 3) {
    // Parse "FL 34208" or just "FL"
    const stateZipParts = parts[2].split(/\s+/);
    if (stateZipParts.length >= 1) {
      // Check if first part is a state abbreviation (2 letters)
      if (/^[A-Z]{2}$/i.test(stateZipParts[0])) {
        result.state = stateZipParts[0].toUpperCase();
      }
    }
    if (stateZipParts.length >= 2) {
      // Check if second part is a zip code
      if (/^\d{5}(-\d{4})?$/.test(stateZipParts[1])) {
        result.zipCode = stateZipParts[1];
      }
    }
  }

  if (parts.length >= 4) {
    // Handle "123 Main St, Bradenton, FL, 34208" format
    if (/^\d{5}(-\d{4})?$/.test(parts[3])) {
      result.zipCode = parts[3];
    }
  }

  return result;
}

// ============================================================================
// Lookup Functions (for reference/debugging)
// ============================================================================

/**
 * Get the USPS abbreviation for a street suffix
 * @param suffix - Full suffix word (e.g., "Terrace", "Boulevard")
 * @returns USPS abbreviation or undefined if not found
 */
export function getStreetSuffixAbbreviation(suffix: string): string | undefined {
  return STREET_SUFFIX_MAP[suffix.toLowerCase()];
}

/**
 * Get the USPS abbreviation for a directional
 * @param directional - Full directional word (e.g., "North", "Southwest")
 * @returns USPS abbreviation or undefined if not found
 */
export function getDirectionalAbbreviation(directional: string): string | undefined {
  return DIRECTIONAL_MAP[directional.toLowerCase()];
}

/**
 * Check if a word is a known street suffix
 */
export function isStreetSuffix(word: string): boolean {
  return word.toLowerCase() in STREET_SUFFIX_MAP;
}

/**
 * Check if a word is a known directional
 */
export function isDirectional(word: string): boolean {
  return word.toLowerCase() in DIRECTIONAL_MAP;
}
