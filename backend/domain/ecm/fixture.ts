/**
 * SYNTHETIC ECM FIXTURE — NOT A BEE PUBLICATION.
 *
 * These rows exist so matching, ranking, groundedness, and the UI can be tested
 * and demonstrated. They are invented labels, not Energy Conservation Measures.
 *
 * Do not copy them into a production `ecm_library`. Do not treat a match against
 * this list as an engineering recommendation. Seeding the real table is a
 * domain-research task (published BEE guide + advisor review), out of scope here.
 */

import { ECM_LIBRARY_ESCALATION, type EcmLibraryRow } from "./types";

export const SYNTHETIC_ECM_SOURCE_REFERENCE =
  "SYNTHETIC FIXTURE — not a BEE publication. Do not use for production decisions.";

/**
 * Fixed ids so unit tests can assert identity without hitting Postgres.
 * The `00000000-0000-4000-a000-` prefix is not a production keyspace.
 */
export const SYNTHETIC_ECM_LIBRARY: EcmLibraryRow[] = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    scheme: "ADEETIE",
    sectorOrCluster: "Foundry",
    equipmentTag: "coke",
    ecmName: "SYNTHETIC cupola coke-bed practice (FIXTURE)",
    description:
      "SYNTHETIC fixture only. Placeholder text about cupola coke-bed height. Not a BEE measure.",
    typicalSavingsRange: "8-15% of related SEC",
    typicalPaybackMonths: 18,
    sourceReference: SYNTHETIC_ECM_SOURCE_REFERENCE,
    sourceUrl: null,
  },
  {
    id: "00000000-0000-4000-a000-000000000002",
    scheme: "ADEETIE",
    sectorOrCluster: "Foundry",
    equipmentTag: "grid-electricity",
    ecmName: "SYNTHETIC purchased-electricity metering (FIXTURE)",
    description:
      "SYNTHETIC fixture only. Placeholder text about purchased-electricity metering. Not a BEE measure.",
    typicalSavingsRange: "10-20% of related SEC",
    typicalPaybackMonths: 24,
    sourceReference: SYNTHETIC_ECM_SOURCE_REFERENCE,
    sourceUrl: null,
  },
  {
    id: "00000000-0000-4000-a000-000000000003",
    scheme: "ADEETIE",
    sectorOrCluster: "Foundry",
    equipmentTag: "png",
    ecmName: "SYNTHETIC PNG burner placeholder (FIXTURE)",
    description:
      "SYNTHETIC fixture only. Placeholder text about a PNG burner. Not a BEE measure.",
    typicalSavingsRange: "3-6% of related SEC",
    typicalPaybackMonths: 8,
    sourceReference: SYNTHETIC_ECM_SOURCE_REFERENCE,
    sourceUrl: null,
  },
  {
    id: "00000000-0000-4000-a000-000000000004",
    scheme: "CCTS",
    sectorOrCluster: "Cement",
    equipmentTag: "coal-kiln",
    ecmName: "SYNTHETIC kiln coal placeholder (FIXTURE)",
    description:
      "SYNTHETIC fixture only. Placeholder text about kiln coal. Not a BEE measure.",
    typicalSavingsRange: "2-5% of related GEI",
    typicalPaybackMonths: 12,
    sourceReference: SYNTHETIC_ECM_SOURCE_REFERENCE,
    sourceUrl: null,
  },
  {
    id: "00000000-0000-4000-a000-000000000005",
    scheme: "CCTS",
    sectorOrCluster: "Cement",
    equipmentTag: "grid-ht",
    ecmName: "SYNTHETIC HT electricity placeholder (FIXTURE)",
    description:
      "SYNTHETIC fixture only. Placeholder text about HT electricity. Not a BEE measure.",
    typicalSavingsRange: "4-8% of related GEI",
    typicalPaybackMonths: 14,
    sourceReference: SYNTHETIC_ECM_SOURCE_REFERENCE,
    sourceUrl: null,
  },
  {
    id: "00000000-0000-4000-a000-000000000006",
    scheme: "ADEETIE",
    sectorOrCluster: "Brass",
    equipmentTag: "coke",
    ecmName: "SYNTHETIC brass coke placeholder (FIXTURE)",
    description:
      "SYNTHETIC fixture only. Present so sector filtering can be tested. Not a BEE measure.",
    typicalSavingsRange: "8-15% of related SEC",
    typicalPaybackMonths: 16,
    sourceReference: SYNTHETIC_ECM_SOURCE_REFERENCE,
    sourceUrl: null,
  },
];

export function isSyntheticEcmRow(row: EcmLibraryRow): boolean {
  return row.sourceReference.toUpperCase().includes("SYNTHETIC FIXTURE");
}

export function libraryKindFromRows(
  rows: EcmLibraryRow[],
  loadedFrom: "database" | "fixture"
): "synthetic_fixture" | "database" {
  if (loadedFrom === "fixture") return "synthetic_fixture";
  if (rows.length === 0) return "synthetic_fixture";
  if (rows.every(isSyntheticEcmRow)) return "synthetic_fixture";
  return "database";
}

export { ECM_LIBRARY_ESCALATION };
