import type { EvidenceSlot, MethodologyPack } from "../types";
import type { ProformaInput } from "../../proforma/types";

/**
 * CCTS-CEMENT-v1 — runnable pack assembled from verified CCTS regulations,
 * schemas, rules, and Cement factors. Process 3.0/5.0 load this record;
 * they do not branch on sector.
 *
 * Grounded in:
 * - BEE "Detailed Procedure for Compliance Mechanism under CCTS" (v1.0, July 2024)
 * - BEE "CCTS – Monitoring Plan Template Instruction" (July 2024)
 * - BEE "Accreditation Procedure and Eligibility Criteria for ACVA" (v1.0, July 2024)
 *
 * Sub-sectors supported:
 * 1. "Cement Integrated": Involves clinker production in kilns, calcination process CO2,
 *    CPP / WHRS generation, and finish grinding.
 * 2. "Cement Grinding": Standalone grinding terminal purchasing clinker; kiln combustion
 *    and calcination are not applicable; activity is predominantly imported HT electricity.
 */

/**
 * Where the run's inputs sit in the master pro forma (sector-specific workbook,
 * sheets 1 to 4). Labels are matched, not cell addresses, so a re-ordered copy
 * still reads. Quantities are the annual figures in the workbook.
 */
const CEMENT_PROFORMA_INPUTS: ProformaInput[] = [
  {
    fieldPath: "production",
    sheet: "summary|form ?1",
    label: "^Total Equivalent Product",
    unit: "t",
    description: "Total equivalent product (t)",
  },
  {
    fieldPath: "quantity",
    sheet: "ghg",
    label: "^Coal Consumed Total",
    unit: "t",
    description: "Coal consumed (t)",
  },
  {
    fieldPath: "calorificValue",
    sheet: "ghg",
    label: "^GCV\\s*(of\\s*)?Coal",
    unit: "kcal/kg",
    description: "GCV of coal (kcal/kg)",
  },
  {
    fieldPath: "activeEnergy",
    sheet: "ghg",
    label: "^Grid Import",
    unit: "kWh",
    scale: 100000,
    description: "Grid import (kWh)",
    note: "Workbook unit is Lakh kWh.",
  },
  {
    fieldPath: "petcoke.quantity",
    sheet: "ghg",
    label: "^Petcoke Consumed Total",
    unit: "t",
    description: "Petroleum coke consumed (t)",
    note: "Optional petcoke line for plants co-firing petcoke in kiln.",
  },
  {
    fieldPath: null,
    sheet: "ghg",
    label: "^Fuel Oil Consumed",
    unit: "t",
    description: "Fuel oil consumed (t)",
    note: "The pro forma counts fuel oil in its GHG total. The cement pack has no fuel-oil stream, so a run leaves it out.",
  },
];

const CEMENT_EVIDENCE_SLOTS: EvidenceSlot[] = [
  {
    id: "proforma_workbook",
    label: "Sector pro forma workbook",
    gate: "run",
    accepts:
      "One Excel workbook: the entity's sector-specific pro forma (Section 5.21 & 6.5.i / Annexure V). Cells are mapped, not read.",
    basis: "Test set file 15_sector_specific_proforma.xlsx & BEE Detailed Procedure Section 5.21 / 6.5(i)",
  },
  {
    id: "production_evidence",
    label: "Production evidence",
    gate: "run",
    accepts:
      "Monthly production report (MPR), SCADA or DCS trend export, daily production report (DPR), SAP printout. Several may be attached.",
    basis: "Test set 01, 02, 03, 04 & BEE Detailed Procedure Clause 4(5)",
  },
  {
    id: "coal_quality",
    label: "Coal quality",
    gate: "run",
    accepts:
      "Internal lab daily log (Excel or CSV) and the NABL external certificate (PDF).",
    basis: "Test set 08, 09 & BEE Detailed Procedure Clause 4(8)–(10) / Section 5.14",
  },
  {
    id: "grid_electricity",
    label: "Grid electricity bill",
    gate: "run",
    accepts:
      "Electricity bills (PDF, Excel or CSV). Several months may be attached.",
    basis: "Test set 12 & BEE Detailed Procedure Clause 4(4)(vii) / Section 5.10",
  },
  {
    id: "petcoke_log",
    label: "Petcoke consumption log",
    gate: "none",
    accepts: "Daily or monthly petcoke and coal consumption log.",
    basis: "Test set 11 & BEE Detailed Procedure Annexure IV row 17",
  },
  {
    id: "sampling_plan",
    label: "Sampling plan and procedure",
    gate: "submission",
    accepts:
      "Written procedure detailing auto-sampler locations, sampling frequency (coal per 20,000 t, raw materials per 50,000 t), preparation, storage, and testing.",
    basis: "BEE Detailed Procedure Section 5.13(iv) / Clause 4(8)",
  },
  {
    id: "data_flow_sop",
    label: "Data flow & control activity SOP",
    gate: "submission",
    accepts:
      "Quality assurance procedures, meter calibration records, IT data systems flow, and internal review records.",
    basis: "BEE Detailed Procedure Section 5.20 / Slide 33",
  },
  {
    id: "cpp_generation",
    label: "Captive power plant generation",
    gate: "none",
    accepts: "CPP daily generation report and monthly generation report.",
    basis: "Test set 06, 07 & BEE Detailed Procedure Clause 4(11) / Section 5.16",
  },
  {
    id: "coal_purchase",
    label: "Coal purchase order",
    gate: "none",
    accepts: "Purchase order or supplier invoice for coal.",
    basis: "Test set 10. Corroborates lab and quantity; feeds no pro forma cell.",
  },
  {
    id: "rec_declaration",
    label: "REC or renewable declaration",
    gate: "none",
    accepts:
      "Renewable energy certificate status or an onsite / open-access declaration. RECs cannot be claimed as zero emissions under Clause 4(12)(iii).",
    basis: "Test set 13 & BEE Detailed Procedure Clause 4(12)(iii)",
  },
  {
    id: "re_undertaking",
    label: "Renewable energy PPA & undertaking",
    gate: "none",
    accepts:
      "Contracts, wheeling agreements, and statutory undertaking demonstrating no double-counting with RE generator per Clause 4(12)(ii).",
    basis: "BEE Detailed Procedure Clause 4(12)(ii)",
  },
  {
    id: "form1",
    label: "Form 1 (entity claim)",
    gate: "submission",
    accepts:
      "Form 1 Annual Energy Consumption and GHG Emissions (Annexure V), as submitted by the entity.",
    basis: "Test set 16 & BEE Detailed Procedure Section 6.1(ii) / Annexure V",
  },
];

export const CCTS_CEMENT_V1: MethodologyPack = {
  pack_id: "CCTS-CEMENT-v1",
  scheme: "CCTS",
  sector_or_cluster: "Cement",
  status: "runnable",
  version: "1.0.0",
  document_taxonomy: [
    {
      id: "proforma_workbook",
      label: "GHG Emission Calculation Pro-forma",
      extractable: false,
      notes:
        "BEE standardized IT/Excel sector workbook (Section 5.21 & 6.5.i / Annexure V). Core working file reconciling activity data to Form 1.",
    },
    {
      id: "form1",
      label: "Form 1 / E2 Form (Annual Energy Consumption and GHG Emissions)",
      extractable: true,
      notes:
        "Regulator-defined compliance return (Annexure V). Required attachment to Form A under Section 6.1(ii).",
    },
    {
      id: "sampling_plan",
      label: "Sampling plan and procedure",
      extractable: false,
      notes:
        "Mandatory written SOP per Section 5.13(iv) / Clause 4(8) detailing auto-sampler locations, frequencies, sample prep, and testing.",
    },
    {
      id: "data_flow_sop",
      label: "Data flow and control activity documentation",
      extractable: false,
      notes:
        "SOP register per Section 5.20 / Slide 33 covering primary data sources, meter calibration, IT QA, and internal review.",
    },
    {
      id: "fuel_invoice",
      label: "Fuel invoice / purchase order",
      extractable: true,
      notes:
        "Commercial invoice/PO for solid/liquid fuels corroborating fuel receipts and stock movements.",
    },
    {
      id: "tax_invoice",
      label: "GST / commercial tax invoice",
      extractable: true,
      notes: "Supporting commercial tax evidence.",
    },
    {
      id: "electricity_bill",
      label: "Electricity bill (HT)",
      extractable: true,
      notes: "Monthly grid HT utility bills and meter reading statements.",
    },
    {
      id: "lab_certificate",
      label: "NABL external lab test certificate",
      extractable: true,
      notes:
        "Quarterly/monthly NABL accredited laboratory certificate for NCV, proximate and ultimate analysis.",
    },
    {
      id: "fuel_lab_log",
      label: "Internal fuel testing laboratory register",
      extractable: true,
      notes:
        "Daily/batch internal lab analysis log for GCV, moisture, ash, and volatile matter.",
    },
    {
      id: "production_log",
      label: "Production and equivalent product register",
      extractable: true,
      notes:
        "Monthly and daily production reports (MPR/DPR), SCADA/DCS trend logs, SAP PP printouts.",
    },
    {
      id: "cpp_generation_log",
      label: "Captive power plant generation & heat rate register",
      extractable: true,
      notes:
        "Daily/monthly CPP gross generation, auxiliary consumption, and net heat rate logs.",
    },
    {
      id: "whrs_generation_log",
      label: "Waste Heat Recovery System (WHRS) generation log",
      extractable: true,
      notes: "WHRS generation and power export logs.",
    },
    {
      id: "re_undertaking",
      label: "Renewable energy PPA & no-double-counting undertaking",
      extractable: false,
      notes:
        "Mandatory agreement demonstrating zero-emission RE procurement without double counting (Section 5.17.ii / Clause 4(12)(ii)).",
    },
    {
      id: "weighbridge_slip",
      label: "Weighbridge delivery slip",
      extractable: false,
      notes: "Delivery weighment slips for stock corroboration.",
    },
    {
      id: "monitoring_plan",
      label: "Monitoring plan",
      extractable: false,
      notes: "Formal approved CCTS monitoring plan per Section 4(1)–(3) & 5.6.",
    },
  ],
  field_schemas: {
    fuel_invoice: "FuelInvoiceSchema",
    tax_invoice: "TaxInvoiceSchema",
    electricity_bill: "ElectricityBillSchema",
    lab_certificate: "LabCertificateSchema",
    production_log: "ProductionLogSchema",
  },
  calculation_method: "GEI",
  evidence_slots: CEMENT_EVIDENCE_SLOTS,
  proforma_inputs: CEMENT_PROFORMA_INPUTS,
  emission_or_energy_factors: [
    {
      factorKey: "cea_grid_ef",
      vintage: "FY2024-25",
      role: "grid",
    },
    {
      factorKey: "ef_coal_subbituminous",
      vintage: "IPCC2006",
      role: "fuel",
    },
    {
      factorKey: "ef_petcoke",
      vintage: "IPCC2006",
      role: "fuel",
    },
    {
      factorKey: "ef_lignite",
      vintage: "IPCC2006",
      role: "fuel",
    },
    {
      factorKey: "ef_natural_gas",
      vintage: "IPCC2006",
      role: "fuel",
    },
    {
      factorKey: "ef_charcoal",
      vintage: "IPCC2006",
      role: "fuel",
    },
    {
      factorKey: "ef_clinker_calcination",
      vintage: "CCTS-Annexure-II-G1",
      role: "process",
    },
  ],
  // The first two streams are pinned: they reproduce the pre-refactor Cement
  // mapping exactly (see calc/golden.test.ts). Additional kiln fuels and
  // calcination are optional and omitted when facts are absent.
  stream_bindings: [
    {
      kind: "fuel_combustion",
      streamId: "coal-kiln",
      label: "Kiln coal",
      quantity: { path: "quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "MJ/kg",
      },
      factorKey: "ef_coal_subbituminous",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "electricity_import",
      streamId: "grid-ht",
      label: "Imported HT electricity",
      quantity: { path: "activeEnergy", units: ["kWh", "MWh"], defaultUnit: "MWh" },
      factorKey: "cea_grid_ef",
      factorVintage: "FY2024-25",
    },
    {
      kind: "fuel_combustion",
      streamId: "petcoke-kiln",
      label: "Kiln petroleum coke",
      quantity: { path: "petcoke.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "petcoke.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_petcoke",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "fuel_combustion",
      streamId: "lignite-kiln",
      label: "Kiln lignite",
      quantity: { path: "lignite.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "lignite.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_lignite",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "fuel_combustion",
      streamId: "natural-gas",
      label: "Natural gas",
      quantity: { path: "naturalGas.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "naturalGas.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "MJ/kg",
      },
      factorKey: "ef_natural_gas",
      factorVintage: "IPCC2006",
      phase: "gaseous",
    },
    {
      kind: "fuel_combustion",
      streamId: "afr-biomass",
      label: "Alternative fuel / biomass (kiln)",
      quantity: { path: "biomass.quantity", units: ["kg", "t"], defaultUnit: "t" },
      calorificValue: {
        path: "biomass.calorificValue",
        units: ["kcal/kg", "MJ/kg"],
        defaultUnit: "kcal/kg",
      },
      factorKey: "ef_charcoal",
      factorVintage: "IPCC2006",
      phase: "solid",
    },
    {
      kind: "process_direct",
      streamId: "clinker-calcination",
      label: "Clinker calcination process CO2 (output-based method)",
      quantity: {
        path: "process.calcinationEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "BEE CCTS Detailed Procedure Annexure II.G.1 Equations IX–XIII: Output-based calcination from clinker CaO and MgO fractions, adjusted for CKD (Eq. X), bypass dust (Eq. XI), and raw meal organic carbon (Eq. XII). Applicable to Cement Integrated sub-sector.",
    },
    {
      kind: "process_direct",
      streamId: "raw-meal-calcination",
      label: "Raw meal carbonate calcination process CO2 (input-based method)",
      quantity: {
        path: "process.rawMealCalcinationEmissions",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "BEE CCTS Detailed Procedure Annexure II.G.1 & Annexure IV: Input-based calcination from raw meal carbonate content (CaCO3, MgCO3, FeCO3 stoichiometric factors). Applicable to Cement Integrated sub-sector.",
    },
    {
      kind: "process_direct",
      streamId: "power-export",
      label: "Exported electricity emission deduction",
      quantity: {
        path: "process.exportedPowerDeduction",
        units: ["tCO2e", "kgCO2e"],
        defaultUnit: "tCO2e",
      },
      methodologyRef:
        "BEE CCTS Detailed Procedure Clause 4(11) / Section 5.16: Electricity exported from CPP / WHRS adjusted using Net Heat Rate or CEA grid factor, deducted from overall entity emissions.",
    },
  ],
  production_binding: {
    path: "production",
    units: ["t"],
    defaultUnit: "t",
    productUnitLabel: "tonne_equivalent_product",
    productLabel: "Cement equivalent product",
  },
  reconciliation_rules: [
    "MB001",
    "CV001",
    "CV002",
    "LB001",
    "TS001",
    "EF001",
    "SM001",
    "MT001",
    "DEV001",
    "REC001",
    "BIO001",
    "EXP001",
  ],
  clause_citations: [
    {
      ruleId: "MB001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(5)(ii) & Section 5.20 — Fuel stock balance reconciliation and data control activities",
    },
    {
      ruleId: "CV001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(6) & Annexure III — Mandatory NCV basis (5% solid/liquid default if lab unavailable)",
    },
    {
      ruleId: "CV002",
      clauseRef: "Physical plausibility gate (internal control)",
    },
    {
      ruleId: "LB001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(8)–(10) & Section 5.14 — NABL accredited lab testing and accreditation validity",
    },
    {
      ruleId: "TS001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(5)(i)(b) & Section 5.6 — Completeness of monthly monitored data series",
    },
    {
      ruleId: "EF001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(4)(vii) & Section 5.10(vi) — CEA grid emission factor frozen at baseline year",
    },
    {
      ruleId: "SM001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(8)(iii) & Section 5.13 — Mandatory sampling frequency (coal monthly or per 20,000 t; raw material monthly or per 50,000 t)",
    },
    {
      ruleId: "MT001",
      clauseRef:
        "BEE CCTS Detailed Procedure Section 6.12 & ISO 14064-3 — 2% statutory materiality threshold on aggregate discrepancies",
    },
    {
      ruleId: "DEV001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(10)(ii)–(iii) — NABL external vs internal lab deviation limit (±71.7 kcal/kg for coal per ISO 1928, ±2% for material)",
    },
    {
      ruleId: "REC001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(12)(iii) — Exclusion of Renewable Energy Certificates (RECs) from renewable energy claims",
    },
    {
      ruleId: "BIO001",
      clauseRef:
        "BEE CCTS Detailed Procedure Section 5.17 — Exclusion of biogenic CO2 emissions from compliance total",
    },
    {
      ruleId: "EXP001",
      clauseRef:
        "BEE CCTS Detailed Procedure Clause 4(11) / Section 5.16 — Net power export emissions deduction",
    },
  ],
  report_template: "ccts-gei-form-ab-v1",
  notes:
    "Runnable. Grounded in BEE Detailed Procedure for Compliance Mechanism under CCTS (v1.0, July 2024). Sub-sectors: 'Cement Integrated' (kiln combustion, calcination, CPP, WHRS, finish grinding) vs 'Cement Grinding' (imported grid HT electricity and inbound clinker; kiln fuels and calcination are not applicable). Pinned kiln coal + HT electricity reproduce the original Cement mapping byte-for-byte. Process calcination offers output-based (Eq. IX–XIII) and input-based (raw meal carbonates) methods. Grid emission factor is frozen at baseline year vintage per Section 5.10(vi). Biogenic CO2 from AFR/biomass is excluded from compliance total per Section 5.17.",
};
