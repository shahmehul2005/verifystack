/**
 * Hand-written Database types matching supabase/migrations/0001_init.sql through
 * 0008_adeetie_lifecycle.sql.
 * Regenerate from a live project with `supabase gen types` when one is wired.
 */

export type MembershipRole =
  | "firm_admin"
  | "lead_verifier"
  | "verifier"
  | "independent_reviewer";

export type PackScheme = "CCTS" | "ADEETIE";
export type PackStatus = "runnable" | "scaffold";

export type EngagementStatus =
  | "setup"
  | "intake"
  | "review"
  | "calc"
  | "findings"
  | "signoff"
  | "submitted";

/** MSME classification driving ADEETIE subvention rate and reimbursement cap. */
export type EnterpriseCategory = "Micro" | "Small" | "Medium";

/** ADEETIE lifecycle phase. Orthogonal to EngagementStatus. */
export type AdeetiePhase = "IGEA" | "DPR" | "MV";

export type CalculationMethod = "GEI" | "SEC";
export type SecPhase = "baseline" | "post_implementation";
export type ReportingEnergyUnit = "GJ" | "toe" | "MJ" | "kWh";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Row<T> = T;
type Insert<T> = T;
type Update<T> = Partial<T>;

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Row<{
          id: string;
          name: string;
          kind: "acva" | "energy_auditor_firm";
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          name: string;
          kind?: "acva" | "energy_auditor_firm";
          created_at?: string;
        }>;
        Update: Update<{
          id?: string;
          name?: string;
          kind?: "acva" | "energy_auditor_firm";
          created_at?: string;
        }>;
        Relationships: [];
      };
      memberships: {
        Row: Row<{
          id: string;
          organization_id: string;
          user_id: string;
          role: MembershipRole;
          display_name: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          user_id: string;
          role: MembershipRole;
          display_name?: string | null;
          created_at?: string;
        }>;
        Update: Update<{
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: MembershipRole;
          display_name?: string | null;
          created_at?: string;
        }>;
        Relationships: [];
      };
      methodology_packs: {
        Row: Row<{
          pack_id: string;
          scheme: PackScheme;
          sector_or_cluster: string;
          status: PackStatus;
          version: string;
          document_taxonomy: Json;
          field_schemas: Json;
          calculation_method: string;
          emission_or_energy_factors: Json;
          reconciliation_rules: Json;
          clause_citations: Json;
          report_template: string | null;
          notes: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          pack_id: string;
          scheme: PackScheme;
          sector_or_cluster: string;
          status?: PackStatus;
          version: string;
          document_taxonomy?: Json;
          field_schemas?: Json;
          calculation_method: string;
          emission_or_energy_factors?: Json;
          reconciliation_rules?: Json;
          clause_citations?: Json;
          report_template?: string | null;
          notes?: string | null;
          created_at?: string;
        }>;
        Update: Update<{
          pack_id?: string;
          scheme?: PackScheme;
          sector_or_cluster?: string;
          status?: PackStatus;
          version?: string;
          document_taxonomy?: Json;
          field_schemas?: Json;
          calculation_method?: string;
          emission_or_energy_factors?: Json;
          reconciliation_rules?: Json;
          clause_citations?: Json;
          report_template?: string | null;
          notes?: string | null;
        }>;
        Relationships: [];
      };
      engagements: {
        Row: Row<{
          id: string;
          organization_id: string;
          pack_id: string;
          pack_version: string;
          scheme: PackScheme;
          sector_or_cluster: string;
          client_name: string;
          plant_name: string | null;
          compliance_year: string;
          gei_target: number | null;
          status: EngagementStatus;
          draft_mode: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          // 0002. Nullable throughout: a CCTS engagement has none of these, and an
          // ADEETIE engagement fills them in progressively across its three phases.
          adeetie_cluster: string | null;
          adeetie_state: string | null;
          enterprise_category: EnterpriseCategory | null;
          udyam_registration_no: string | null;
          loan_amount_inr: number | null;
          project_cost_inr: number | null;
          sanctioned_interest_rate_pct: number | null;
          adeetie_phase: AdeetiePhase | null;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          pack_id: string;
          pack_version: string;
          scheme: PackScheme;
          sector_or_cluster: string;
          client_name: string;
          plant_name?: string | null;
          compliance_year: string;
          gei_target?: number | null;
          status?: EngagementStatus;
          draft_mode?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          adeetie_cluster?: string | null;
          adeetie_state?: string | null;
          enterprise_category?: EnterpriseCategory | null;
          udyam_registration_no?: string | null;
          loan_amount_inr?: number | null;
          project_cost_inr?: number | null;
          sanctioned_interest_rate_pct?: number | null;
          adeetie_phase?: AdeetiePhase | null;
        }>;
        Update: Update<{
          status?: EngagementStatus;
          client_name?: string;
          plant_name?: string | null;
          gei_target?: number | null;
          draft_mode?: boolean;
          updated_at?: string;
          adeetie_cluster?: string | null;
          adeetie_state?: string | null;
          enterprise_category?: EnterpriseCategory | null;
          udyam_registration_no?: string | null;
          loan_amount_inr?: number | null;
          project_cost_inr?: number | null;
          sanctioned_interest_rate_pct?: number | null;
          adeetie_phase?: AdeetiePhase | null;
        }>;
        Relationships: [];
      };
      documents: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          sha256: string;
          storage_path: string;
          original_filename: string;
          mime_type: string;
          byte_size: number;
          page_count: number | null;
          doc_type: string | null;
          classification_confidence: number | null;
          created_by: string | null;
          created_at: string;
          adeetie_phase: AdeetiePhase | null;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          sha256: string;
          storage_path: string;
          original_filename: string;
          mime_type: string;
          byte_size: number;
          page_count?: number | null;
          doc_type?: string | null;
          classification_confidence?: number | null;
          created_by?: string | null;
          created_at?: string;
          adeetie_phase?: AdeetiePhase | null;
        }>;
        Update: Update<{
          page_count?: number | null;
          doc_type?: string | null;
          classification_confidence?: number | null;
        }>;
        Relationships: [];
      };
      document_pages: {
        Row: Row<{
          id: string;
          organization_id: string;
          document_id: string;
          page_number: number;
          storage_path: string | null;
          width_px: number | null;
          height_px: number | null;
          text_layer: string | null;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          document_id: string;
          page_number: number;
          storage_path?: string | null;
          width_px?: number | null;
          height_px?: number | null;
          text_layer?: string | null;
        }>;
        Update: Update<{
          storage_path?: string | null;
          width_px?: number | null;
          height_px?: number | null;
          text_layer?: string | null;
        }>;
        Relationships: [];
      };
      extraction_jobs: {
        Row: Row<{
          id: string;
          organization_id: string;
          document_id: string;
          status: "queued" | "running" | "done" | "failed";
          route: "digital" | "vision" | null;
          error: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          document_id: string;
          status?: "queued" | "running" | "done" | "failed";
          route?: "digital" | "vision" | null;
          error?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        }>;
        Update: Update<{
          status?: "queued" | "running" | "done" | "failed";
          route?: "digital" | "vision" | null;
          error?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
        }>;
        Relationships: [];
      };
      extracted_fields: {
        Row: Row<{
          id: string;
          organization_id: string;
          extraction_job_id: string;
          document_id: string;
          engagement_id: string;
          field_path: string;
          value_json: Json;
          unit: string | null;
          confidence: number;
          page: number;
          bbox: Json;
          source_text: string;
          triage_action: "human_review" | "auto_commit";
          state: "suggested" | "accepted" | "rejected" | "corrected";
          correction_json: Json | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          extraction_job_id: string;
          document_id: string;
          engagement_id: string;
          field_path: string;
          value_json: Json;
          unit?: string | null;
          confidence: number;
          page: number;
          bbox: Json;
          source_text: string;
          triage_action: "human_review" | "auto_commit";
          state?: "suggested" | "accepted" | "rejected" | "corrected";
          correction_json?: Json | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        }>;
        Update: Update<{
          state?: "suggested" | "accepted" | "rejected" | "corrected";
          correction_json?: Json | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          value_json?: Json;
        }>;
        Relationships: [];
      };
      facts: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          extracted_field_id: string | null;
          document_id: string;
          field_path: string;
          value_json: Json;
          unit: string | null;
          page: number;
          bbox: Json;
          source_text: string;
          accepted_by: string | null;
          accepted_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          extracted_field_id?: string | null;
          document_id: string;
          field_path: string;
          value_json: Json;
          unit?: string | null;
          page: number;
          bbox: Json;
          source_text: string;
          accepted_by?: string | null;
          accepted_at?: string;
        }>;
        Update: Update<{
          value_json?: Json;
          unit?: string | null;
        }>;
        Relationships: [];
      };
      calculation_runs: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          engine_version: string;
          pack_id: string;
          pack_version: string;
          factor_set_version: string;
          input_hash: string;
          previous_run_hash: string | null;
          inputs: Json;
          result: Json;
          draft_mode: boolean;
          created_by: string | null;
          created_at: string;
          // 0003. `method` discriminates a GEI (CCTS) run from an SEC (ADEETIE) run.
          // The SEC columns are null on GEI rows and are enforced present on SEC
          // rows by calculation_runs_sec_fields_present_check.
          method: CalculationMethod;
          chain_hash: string | null;
          sec_engine_version: string | null;
          period_label: string | null;
          sec_phase: SecPhase | null;
          total_energy_mj: number | null;
          total_energy: number | null;
          reporting_energy_unit: ReportingEnergyUnit | null;
          sec: number | null;
          sec_unit_label: string | null;
          production: number | null;
          product_unit_label: string | null;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          engine_version: string;
          pack_id: string;
          pack_version: string;
          factor_set_version: string;
          input_hash: string;
          previous_run_hash?: string | null;
          inputs: Json;
          result: Json;
          draft_mode: boolean;
          created_by?: string | null;
          created_at?: string;
          method?: CalculationMethod;
          chain_hash?: string | null;
          sec_engine_version?: string | null;
          period_label?: string | null;
          sec_phase?: SecPhase | null;
          total_energy_mj?: number | null;
          total_energy?: number | null;
          reporting_energy_unit?: ReportingEnergyUnit | null;
          sec?: number | null;
          sec_unit_label?: string | null;
          production?: number | null;
          product_unit_label?: string | null;
        }>;
        Update: never;
        Relationships: [];
      };
      factor_verifications: {
        Row: Row<{
          id: string;
          organization_id: string;
          factor_id: string;
          vintage: string;
          cited_source: string;
          corrected_value: number | null;
          previous_value: number | null;
          verified_by: string | null;
          verified_at: string;
          notes: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          factor_id: string;
          vintage: string;
          cited_source: string;
          corrected_value?: number | null;
          previous_value?: number | null;
          verified_by?: string | null;
          verified_at?: string;
          notes?: string | null;
          created_at?: string;
        }>;
        // Append-only, matching the audit_events pattern.
        Update: never;
        Relationships: [];
      };
      factor_verification_state: {
        Row: Row<{
          id: string;
          organization_id: string;
          factor_id: string;
          vintage: string;
          verified: boolean;
          current_value: number | null;
          cited_source: string | null;
          verified_by: string | null;
          verified_at: string | null;
          last_verification_id: string | null;
          updated_at: string;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          factor_id: string;
          vintage: string;
          verified?: boolean;
          current_value?: number | null;
          cited_source?: string | null;
          verified_by?: string | null;
          verified_at?: string | null;
          last_verification_id?: string | null;
          updated_at?: string;
          created_at?: string;
        }>;
        Update: Update<{
          verified?: boolean;
          current_value?: number | null;
          cited_source?: string | null;
          verified_by?: string | null;
          verified_at?: string | null;
          last_verification_id?: string | null;
          updated_at?: string;
        }>;
        Relationships: [];
      };
      adeetie_clusters: {
        // Global reference data, not org-scoped: readable by any authenticated
        // user, writable only by the service role.
        Row: Row<{
          id: string;
          sector: string;
          state: string;
          cluster: string;
          verified: boolean;
          source_note: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          sector: string;
          state: string;
          cluster: string;
          verified?: boolean;
          source_note?: string | null;
          created_at?: string;
        }>;
        Update: Update<{
          verified?: boolean;
          source_note?: string | null;
        }>;
        Relationships: [];
      };
      findings: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          calculation_run_id: string | null;
          rule_id: string;
          severity: "block" | "warn" | "info";
          title: string;
          detail: string;
          clause_ref: string;
          evidence_refs: Json;
          magnitude: Json | null;
          state: "suggested" | "accepted" | "edited" | "rejected" | "closed";
          heading: string | null;
          body: string | null;
          required_response: string | null;
          generator: string | null;
          created_at: string;
          updated_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          calculation_run_id?: string | null;
          rule_id: string;
          severity: "block" | "warn" | "info";
          title: string;
          detail: string;
          clause_ref: string;
          evidence_refs?: Json;
          magnitude?: Json | null;
          state?: "suggested" | "accepted" | "edited" | "rejected" | "closed";
          heading?: string | null;
          body?: string | null;
          required_response?: string | null;
          generator?: string | null;
          created_at?: string;
          updated_at?: string;
        }>;
        Update: Update<{
          state?: "suggested" | "accepted" | "edited" | "rejected" | "closed";
          heading?: string | null;
          body?: string | null;
          required_response?: string | null;
          generator?: string | null;
          updated_at?: string;
        }>;
        Relationships: [];
      };
      signoffs: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          role: MembershipRole;
          attestor_name: string;
          attestor_user_id: string | null;
          report_hash: string;
          statement: string;
          created_at: string;
          adeetie_phase: AdeetiePhase | null;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          role: MembershipRole;
          attestor_name: string;
          attestor_user_id?: string | null;
          report_hash: string;
          statement: string;
          created_at?: string;
          adeetie_phase?: AdeetiePhase | null;
        }>;
        Update: never;
        Relationships: [];
      };
      adeetie_measures: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          description: string;
          projected_annual_saving: number;
          saving_unit: string;
          capital_cost_inr: number;
          basis: string;
          created_by: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          description: string;
          projected_annual_saving: number;
          saving_unit: string;
          capital_cost_inr: number;
          basis: string;
          created_by?: string | null;
          created_at?: string;
        }>;
        Update: never;
        Relationships: [];
      };
      factor_records: {
        Row: Row<{
          id: string;
          organization_id: string | null;
          factor_key: string;
          label: string;
          value: number;
          unit: string;
          vintage: string;
          source: string;
          verified: boolean;
          verified_by: string | null;
          verified_at: string | null;
          cited_source_document: string | null;
          notes: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id?: string | null;
          factor_key: string;
          label: string;
          value: number;
          unit: string;
          vintage: string;
          source: string;
          verified?: boolean;
          verified_by?: string | null;
          verified_at?: string | null;
          cited_source_document?: string | null;
          notes?: string | null;
          created_at?: string;
        }>;
        Update: Update<{
          verified?: boolean;
          verified_by?: string | null;
          verified_at?: string | null;
          cited_source_document?: string | null;
          notes?: string | null;
          source?: string;
        }>;
        Relationships: [];
      };
      audit_events: {
        Row: Row<{
          id: string;
          organization_id: string;
          actor_user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          payload: Json;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          actor_user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          payload?: Json;
          created_at?: string;
        }>;
        Update: never;
        Relationships: [];
      };
      ai_action_logs: {
        Row: Row<{
          id: string;
          organization_id: string;
          tool: string;
          provider: string;
          model: string;
          prompt_version: string;
          input_hash: string;
          evidence_id: string | null;
          page_number: number | null;
          started_at: string;
          duration_ms: number;
          raw_output: string | null;
          ok: boolean;
          error: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          tool: string;
          provider: string;
          model: string;
          prompt_version: string;
          input_hash: string;
          evidence_id?: string | null;
          page_number?: number | null;
          started_at: string;
          duration_ms: number;
          raw_output?: string | null;
          ok: boolean;
          error?: string | null;
          created_at?: string;
        }>;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      append_audit_event: {
        Args: {
          p_organization_id: string;
          p_action: string;
          p_entity_type: string;
          p_entity_id?: string | null;
          p_payload?: Json;
        };
        Returns: string;
      };
      is_org_member: {
        Args: { org_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      membership_role: MembershipRole;
      pack_scheme: PackScheme;
      pack_status: PackStatus;
      engagement_status: EngagementStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
