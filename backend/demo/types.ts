import type { Quantity } from "@verifystack/backend/domain/units";
import type { CalcResult } from "@verifystack/backend/domain/calc/engine";
import type { RuleRunResult } from "@verifystack/backend/domain/rules/rules";
import type { CarDraft } from "@verifystack/backend/domain/ai/draftCar";

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DemoFact {
  id: string;
  documentId: string;
  field: string;
  display: string;
  value: number | string;
  unit?: string;
  confidence: number;
  state: "suggested" | "accepted";
  page: number;
  bbox: BBox;
  sourceText: string;
}

export interface DemoDocument {
  id: string;
  title: string;
  kind:
    | "fuel_invoice"
    | "electricity_bill"
    | "lab_certificate"
    | "production_log";
  subtitle: string;
  pages: number;
}

export interface TraceableNumber {
  id: string;
  label: string;
  value: string;
  factIds: string[];
  derivation?: string;
  scope?: 1 | 2;
}

export interface AiActionRow {
  id: string;
  tool: string;
  model: string;
  promptVersion: string;
  ok: boolean;
  note: string;
  humanDecision: "accepted" | "pending";
}

export interface DemoPayload {
  engagement: {
    id: string;
    client: string;
    plant: string;
    sector: string;
    mechanism: string;
    complianceYear: string;
    acva: string;
    leadVerifier: string;
    geiTarget: number;
    draftMode: true;
  };
  documents: DemoDocument[];
  facts: DemoFact[];
  calc: CalcResult;
  rules: RuleRunResult;
  cars: CarDraft[];
  traceables: TraceableNumber[];
  aiActions: AiActionRow[];
  disclaimer: string;
}

export type { Quantity };
