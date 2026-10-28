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

/** Drafting states (suggested..rejected) and conversation states (open..closed). See domain/issues. */
export type FindingState =
  | "suggested"
  | "accepted"
  | "edited"
  | "rejected"
  | "open"
  | "responded"
  | "verified"
  | "closed";

/** See backend/domain/provenance for what each type must carry. */
export type ProvenanceTypeName =
  | "document_page"
  | "spreadsheet_cell"
  | "spreadsheet_range"
  | "time_series_range"
  | "site_observation";

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
          // 0014. Null for schemes whose stage list is not defined.
          stage: string | null;
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
          stage?: string | null;
        }>;
        Update: Update<{
          status?: EngagementStatus;
          stage?: string | null;
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
          // 0014
          source: "upload" | "evidence_pack" | "entity_response" | "fieldwork";
          finding_id: string | null;
          scan_assessment: Json | null;
          // 0016
          slot: string | null;
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
          source?: "upload" | "evidence_pack" | "entity_response" | "fieldwork";
          finding_id?: string | null;
          scan_assessment?: Json | null;
          slot?: string | null;
        }>;
        Update: Update<{
          page_count?: number | null;
          doc_type?: string | null;
          classification_confidence?: number | null;
          slot?: string | null;
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
          /** Null for proposals from a spreadsheet mapping or a site visit. */
          extraction_job_id: string | null;
          /** Null for site observations. */
          document_id: string | null;
          engagement_id: string;
          field_path: string;
          value_json: Json;
          unit: string | null;
          proposed_by: string | null;
          accept_mode: "individual" | "bulk" | null;
          bulk_batch_id: string | null;
          confidence: number;
          /** Null for spreadsheet, time-series and site-observation provenance. */
          page: number | null;
          bbox: Json | null;
          source_text: string | null;
          provenance_type: ProvenanceTypeName;
          provenance: Json | null;
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
          extraction_job_id?: string | null;
          document_id?: string | null;
          engagement_id: string;
          field_path: string;
          value_json: Json;
          unit?: string | null;
          proposed_by?: string | null;
          accept_mode?: "individual" | "bulk" | null;
          bulk_batch_id?: string | null;
          confidence: number;
          page?: number | null;
          bbox?: Json | null;
          source_text?: string | null;
          provenance_type?: ProvenanceTypeName;
          provenance?: Json | null;
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
          accept_mode?: "individual" | "bulk" | null;
          bulk_batch_id?: string | null;
        }>;
        Relationships: [];
      };
      engagement_stage_events: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          from_stage: string | null;
          to_stage: string;
          direction: "forward" | "back";
          note: string | null;
          actor_user_id: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          from_stage?: string | null;
          to_stage: string;
          direction: "forward" | "back";
          note?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
        }>;
        Update: Update<Record<string, never>>;
        Relationships: [];
      };
      declared_values: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          field_path: string;
          value_json: Json;
          unit: string | null;
          source: "evidence_pack" | "manual" | "setup";
          document_id: string | null;
          created_by: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          field_path: string;
          value_json: Json;
          unit?: string | null;
          source: "evidence_pack" | "manual" | "setup";
          document_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        }>;
        Update: Update<{ value_json?: Json; unit?: string | null; document_id?: string | null }>;
        Relationships: [];
      };
      bulk_accept_batches: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          accepted_by: string;
          accepted_count: number;
          sample_rate: number;
          sample_field_ids: Json;
          accepted_field_ids: Json;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          accepted_by: string;
          accepted_count: number;
          sample_rate: number;
          sample_field_ids: Json;
          accepted_field_ids: Json;
          created_at?: string;
        }>;
        Update: Update<Record<string, never>>;
        Relationships: [];
      };
      issue_responses: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          finding_id: string;
          kind: "entity" | "verifier";
          responder_name: string;
          responder_contact: string | null;
          body: string;
          document_ids: Json;
          recorded_by: string | null;
          ip_hash: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          finding_id: string;
          kind: "entity" | "verifier";
          responder_name: string;
          responder_contact?: string | null;
          body: string;
          document_ids?: Json;
          recorded_by?: string | null;
          ip_hash?: string | null;
          created_at?: string;
        }>;
        Update: Update<Record<string, never>>;
        Relationships: [];
      };
      technical_reviews: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          adeetie_phase: string | null;
          reviewer_user_id: string;
          reviewer_name: string;
          decision: "approved" | "changes_requested";
          comments: string;
          snapshot_hash: string;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          adeetie_phase?: string | null;
          reviewer_user_id: string;
          reviewer_name: string;
          decision: "approved" | "changes_requested";
          comments: string;
          snapshot_hash: string;
          created_at?: string;
        }>;
        Update: Update<Record<string, never>>;
        Relationships: [];
      };
      verification_plans: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          version: number;
          status: "draft" | "approved";
          content: Json;
          content_hash: string;
          overall_risk: "low" | "medium" | "high";
          sample_rate: number;
          created_by: string;
          approved_by: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          version: number;
          status: "draft" | "approved";
          content: Json;
          content_hash: string;
          overall_risk: "low" | "medium" | "high";
          sample_rate: number;
          created_by: string;
          approved_by?: string | null;
          created_at?: string;
        }>;
        Update: Update<Record<string, never>>;
        Relationships: [];
      };
      site_visits: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          planned_for: string | null;
          location: string;
          scope: string;
          assigned_to: string | null;
          status: "planned" | "in_progress" | "completed" | "cancelled";
          created_by: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          planned_for?: string | null;
          location: string;
          scope: string;
          assigned_to?: string | null;
          status?: "planned" | "in_progress" | "completed" | "cancelled";
          created_by?: string | null;
          created_at?: string;
        }>;
        Update: Update<{ status?: "planned" | "in_progress" | "completed" | "cancelled" }>;
        Relationships: [];
      };
      site_observations: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          visit_id: string | null;
          client_id: string;
          kind: "meter_reading" | "nameplate" | "process_note" | "photo" | "interview";
          observer_user_id: string;
          observer_name: string;
          observed_at: string;
          recorded_at: string;
          lat: number | null;
          lng: number | null;
          accuracy_m: number | null;
          field_path: string | null;
          value_json: Json | null;
          unit: string | null;
          note: string | null;
          evidence_file_ids: Json;
          extracted_field_id: string | null;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          visit_id?: string | null;
          client_id: string;
          kind: "meter_reading" | "nameplate" | "process_note" | "photo" | "interview";
          observer_user_id: string;
          observer_name: string;
          observed_at: string;
          recorded_at?: string;
          lat?: number | null;
          lng?: number | null;
          accuracy_m?: number | null;
          field_path?: string | null;
          value_json?: Json | null;
          unit?: string | null;
          note?: string | null;
          evidence_file_ids?: Json;
          extracted_field_id?: string | null;
        }>;
        Update: Update<{ extracted_field_id?: string | null }>;
        Relationships: [];
      };
      savings_dpr_runs: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          engine_version: string;
          input_hash: string;
          previous_run_hash: string | null;
          chain_hash: string;
          inputs: Json;
          result: Json;
          created_by: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          engine_version: string;
          input_hash: string;
          previous_run_hash?: string | null;
          chain_hash: string;
          inputs: Json;
          result: Json;
          created_by?: string | null;
          created_at?: string;
        }>;
        Update: Update<Record<string, never>>;
        Relationships: [];
      };
      desk_readings: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          key: string;
          value: number;
          unit: string | null;
          document_id: string | null;
          page: number | null;
          note: string | null;
          entered_by: string | null;
          entered_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          key: string;
          value: number;
          unit?: string | null;
          document_id?: string | null;
          page?: number | null;
          note?: string | null;
          entered_by?: string | null;
          entered_at?: string;
        }>;
        Update: Update<{
          value?: number;
          unit?: string | null;
          document_id?: string | null;
          page?: number | null;
          note?: string | null;
          entered_by?: string | null;
          entered_at?: string;
        }>;
        Relationships: [];
      };
      desk_reviews: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          pack_id: string;
          results: Json;
          readings: Json;
          notes: Json;
          run_by: string | null;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          pack_id: string;
          results: Json;
          readings: Json;
          notes?: Json;
          run_by?: string | null;
          created_at?: string;
        }>;
        Update: Update<{ notes?: Json }>;
        Relationships: [];
      };
      tabular_datasets: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          document_id: string;
          kind: "spreadsheet" | "time_series";
          name: string;
          columns: Json;
          row_count: number;
          summary: Json;
          created_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          document_id: string;
          kind: "spreadsheet" | "time_series";
          name: string;
          columns?: Json;
          row_count?: number;
          summary?: Json;
          created_at?: string;
        }>;
        Update: Update<{ summary?: Json }>;
        Relationships: [];
      };
      facts: {
        Row: Row<{
          id: string;
          organization_id: string;
          engagement_id: string;
          extracted_field_id: string | null;
          /** Null only for site-observation provenance. */
          document_id: string | null;
          field_path: string;
          value_json: Json;
          unit: string | null;
          page: number | null;
          bbox: Json | null;
          source_text: string | null;
          provenance_type: ProvenanceTypeName;
          provenance: Json | null;
          accept_mode: "individual" | "bulk";
          bulk_batch_id: string | null;
          accepted_by: string | null;
          accepted_at: string;
        }>;
        Insert: Insert<{
          id?: string;
          organization_id: string;
          engagement_id: string;
          extracted_field_id?: string | null;
          document_id?: string | null;
          field_path: string;
          value_json: Json;
          unit?: string | null;
          page?: number | null;
          bbox?: Json | null;
          source_text?: string | null;
          provenance_type?: ProvenanceTypeName;
          provenance?: Json | null;
          accept_mode?: "individual" | "bulk";
          bulk_batch_id?: string | null;
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
          state: FindingState;
          heading: string | null;
          body: string | null;
          required_response: string | null;
          generator: string | null;
          created_at: string;
          updated_at: string;
          // 0014
          due_at: string | null;
          opened_at: string | null;
          responded_at: string | null;
          verified_at: string | null;
          response_nonce: string | null;
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
          state?: FindingState;
          heading?: string | null;
          body?: string | null;
          required_response?: string | null;
          generator?: string | null;
          created_at?: string;
          updated_at?: string;
        }>;
        Update: Update<{
          state?: FindingState;
          heading?: string | null;
          body?: string | null;
          required_response?: string | null;
          generator?: string | null;
          updated_at?: string;
          due_at?: string | null;
          opened_at?: string | null;
          responded_at?: string | null;
          verified_at?: string | null;
          response_nonce?: string | null;
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
          /** 0014. Rupee value of the annual saving, with its basis in `basis`. Null when not recorded. */
          annual_cost_saving_inr: number | null;
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
          annual_cost_saving_inr?: number | null;
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
      append_audit_event_as: {
        Args: {
          p_actor_user_id: string | null;
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
