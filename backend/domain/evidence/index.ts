/**
 * Canonical Evidence — public surface.
 *
 * Import types from here, not directly from types.ts or operations.ts, so
 * the internal module structure can be refactored without changing consumers.
 */

export type {
  CanonicalEvidenceValue,
  CevExtractionMethod,
  CevPeriodKind,
  CevState,
  CevAggregationMethod,
  CevBbox,
  CevActiveSummary,
  CevCorroborationGroup,
  CreateCevFromExtraction,
  CreateCevFromProposal,
  CreateCevFromManualEntry,
  AcceptCevInput,
  CorrectCevInput,
  RejectCevInput,
  WithdrawCevInput,
  RollUpInput,
  RollUpResult,
} from "./types";

export { effectiveValue } from "./types";

export {
  createCevFromExtraction,
  createCevFromProposal,
  createCevFromManualEntry,
  acceptCanonicalEvidenceValue,
  correctCanonicalEvidenceValue,
  rejectCanonicalEvidenceValue,
  withdrawCanonicalEvidenceValue,
  rollUpCanonicalEvidenceValues,
  promoteToFact,
} from "./operations";

