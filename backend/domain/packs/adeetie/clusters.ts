/**
 * ADEETIE notified cluster reference data.
 *
 * ADEETIE eligibility is geographic: the enterprise must operate in one of the
 * notified clusters, or within 200 km of a notified cluster boundary. That makes
 * this table an eligibility control, not decoration — so it carries a source and
 * a verification flag like any other reference datum.
 *
 * VERIFICATION STATUS: UNVERIFIED.
 * The official list is published at
 *   https://adeetie.beeindia.gov.in/list-of-eligible-clusters-under-adeetie-scheme
 * which returned HTTP 500 when this table was compiled, so some rows came from a
 * secondary source. Every row must be read back against the official page before
 * an eligibility determination is filed. `CLUSTERS_VERIFIED` gates that.
 */

export const CLUSTER_SOURCE_URL =
  "https://adeetie.beeindia.gov.in/list-of-eligible-clusters-under-adeetie-scheme";

export const CLUSTER_SOURCE_NOTE =
  `BEE ADEETIE notified cluster list, ${CLUSTER_SOURCE_URL} — TO VERIFY. ` +
  `The official page returned HTTP 500 at the time of compilation; some rows are ` +
  `from a secondary source and no row has been read back against the gazette.`;

/** Flip to true only when every row below has been checked against the official list. */
export const CLUSTERS_VERIFIED = false;

/** The 14 Phase 1 ADEETIE sectors. */
export const ADEETIE_SECTORS = [
  "Brass",
  "Bricks",
  "Ceramics",
  "Chemicals",
  "Fisheries",
  "Food Processing",
  "Forging",
  "Foundry",
  "Glass & Refractory",
  "Leather",
  "Paper",
  "Pharma",
  "Steel Re-rolling",
  "Textiles",
] as const;

export type AdeetieSector = (typeof ADEETIE_SECTORS)[number];

export interface NotifiedCluster {
  sector: AdeetieSector;
  state: string;
  /** Cluster name as notified. Some rows name several towns in one cluster. */
  cluster: string;
}

/**
 * Notified clusters, grouped by sector.
 *
 * Rows that name multiple towns (e.g. "Batala, Jalandhar & Ludhiana") are a single
 * notified cluster in the source, and are kept as one row rather than split, so
 * the count matches the published total.
 */
export const NOTIFIED_CLUSTERS: NotifiedCluster[] = [
  { sector: "Brass", state: "Haryana", cluster: "Jagadhri" },
  { sector: "Brass", state: "Gujarat", cluster: "Jamnagar" },
  { sector: "Brass", state: "Uttar Pradesh", cluster: "Moradabad" },
  { sector: "Brass", state: "Tamil Nadu", cluster: "Salem" },
  { sector: "Brass", state: "Karnataka", cluster: "Bangalore" },

  { sector: "Bricks", state: "Bihar", cluster: "Begusarai" },
  { sector: "Bricks", state: "Madhya Pradesh", cluster: "Indore" },
  { sector: "Bricks", state: "Maharashtra", cluster: "Nagpur" },
  { sector: "Bricks", state: "Tripura", cluster: "Tripura" },

  { sector: "Ceramics", state: "Gujarat", cluster: "Morbi Region" },
  { sector: "Ceramics", state: "Gujarat", cluster: "Thangadh" },
  { sector: "Ceramics", state: "Gujarat", cluster: "Vapi" },
  { sector: "Ceramics", state: "Uttar Pradesh", cluster: "Khurja" },

  { sector: "Chemicals", state: "Gujarat", cluster: "Ankleshwar & Panoli" },
  { sector: "Chemicals", state: "Jharkhand", cluster: "Jamshedpur" },
  { sector: "Chemicals", state: "Haryana", cluster: "Karnal" },
  { sector: "Chemicals", state: "Maharashtra", cluster: "Thane" },

  { sector: "Fisheries", state: "Kerala", cluster: "Kochi" },
  { sector: "Fisheries", state: "Odisha", cluster: "Bhubaneswar" },
  { sector: "Fisheries", state: "Andhra Pradesh", cluster: "West Godavari" },

  { sector: "Food Processing", state: "Punjab", cluster: "Ludhiana" },
  { sector: "Food Processing", state: "Maharashtra", cluster: "Pune" },
  { sector: "Food Processing", state: "Odisha", cluster: "Ganjam & Nayagarh (Rice)" },
  { sector: "Food Processing", state: "Haryana", cluster: "Kaithal (Rice)" },

  { sector: "Forging", state: "Karnataka", cluster: "Bangalore" },
  { sector: "Forging", state: "Maharashtra", cluster: "Pune" },
  { sector: "Forging", state: "Delhi", cluster: "Delhi-NCR" },
  { sector: "Forging", state: "Tamil Nadu", cluster: "Chennai" },
  { sector: "Forging", state: "Punjab", cluster: "Ludhiana" },

  { sector: "Foundry", state: "Punjab", cluster: "Batala, Jalandhar & Ludhiana" },
  { sector: "Foundry", state: "West Bengal", cluster: "Howrah" },
  { sector: "Foundry", state: "Gujarat", cluster: "Rajkot" },
  { sector: "Foundry", state: "Karnataka", cluster: "Belgaum" },
  { sector: "Foundry", state: "Tamil Nadu", cluster: "Coimbatore" },

  { sector: "Glass & Refractory", state: "Haryana", cluster: "Ambala" },
  { sector: "Glass & Refractory", state: "Jharkhand", cluster: "Chirkunda" },
  {
    sector: "Glass & Refractory",
    state: "Andhra Pradesh",
    cluster: "East & West Godavari",
  },
  { sector: "Glass & Refractory", state: "Uttar Pradesh", cluster: "Firozabad" },

  { sector: "Leather", state: "Uttar Pradesh", cluster: "Kanpur" },
  { sector: "Leather", state: "West Bengal", cluster: "Kolkata" },
  { sector: "Leather", state: "Tamil Nadu", cluster: "Pallavaram" },
  { sector: "Leather", state: "Punjab", cluster: "Jalandhar" },

  { sector: "Paper", state: "Uttar Pradesh", cluster: "Muzaffarnagar & Saharanpur" },
  { sector: "Paper", state: "Uttarakhand", cluster: "Kashipur" },
  { sector: "Paper", state: "Gujarat", cluster: "Vapi" },
  { sector: "Paper", state: "Tamil Nadu", cluster: "Coimbatore & Erode" },

  { sector: "Pharma", state: "Gujarat", cluster: "Ahmedabad" },
  { sector: "Pharma", state: "Himachal Pradesh", cluster: "Baddi" },
  { sector: "Pharma", state: "Telangana", cluster: "Medak Region" },
  { sector: "Pharma", state: "Goa", cluster: "Margao" },
  { sector: "Pharma", state: "Karnataka", cluster: "Bidar" },

  {
    sector: "Steel Re-rolling",
    state: "Punjab",
    cluster: "Mandi Gobindgarh & Ludhiana",
  },
  { sector: "Steel Re-rolling", state: "Rajasthan", cluster: "Jaipur" },
  { sector: "Steel Re-rolling", state: "Maharashtra", cluster: "Jalna" },
  { sector: "Steel Re-rolling", state: "Chhattisgarh", cluster: "Raipur" },

  { sector: "Textiles", state: "Punjab", cluster: "Ludhiana" },
  { sector: "Textiles", state: "Gujarat", cluster: "Surat" },
  { sector: "Textiles", state: "Tamil Nadu", cluster: "Tirupur" },
  { sector: "Textiles", state: "Maharashtra", cluster: "Solapur" },
  { sector: "Textiles", state: "Haryana", cluster: "Panipat" },
];

/**
 * The scheme is described as covering 60 notified clusters. This table holds 60
 * rows. That agreement is asserted in tests so a future edit cannot drift the
 * count without someone noticing.
 */
export const EXPECTED_CLUSTER_COUNT = 60;

export function clustersForSector(sector: AdeetieSector): NotifiedCluster[] {
  return NOTIFIED_CLUSTERS.filter((c) => c.sector === sector);
}

function normalise(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Look up a cluster by sector and name. Exact on the notified name after
 * whitespace and case normalisation — deliberately not fuzzy, because a near
 * match is an eligibility question for a human, not a string-distance problem.
 */
export function findCluster(
  sector: AdeetieSector,
  cluster: string
): NotifiedCluster | null {
  const target = normalise(cluster);
  return (
    NOTIFIED_CLUSTERS.find(
      (c) => c.sector === sector && normalise(c.cluster) === target
    ) ?? null
  );
}

export function isNotifiedCluster(sector: AdeetieSector, cluster: string): boolean {
  return findCluster(sector, cluster) !== null;
}

export function isAdeetieSector(value: string): value is AdeetieSector {
  return (ADEETIE_SECTORS as readonly string[]).includes(value);
}
