export {
  ECM_LIBRARY_PRODUCTION_READY,
  ECM_NO_MATCH_MESSAGE,
  ECM_LIBRARY_ESCALATION,
  type EcmLibraryRow,
  type IntensityGap,
  type EcmMatchInput,
  type RankedEcm,
  type EcmMatchStatus,
  type EcmMatchResult,
  type EcmPresentation,
  type StyledEcm,
  type EcmLibraryKind,
  type EcmSuggestionView,
  type EcmSuggestionsPayload,
} from "./types";
export {
  SYNTHETIC_ECM_LIBRARY,
  SYNTHETIC_ECM_SOURCE_REFERENCE,
  isSyntheticEcmRow,
  libraryKindFromRows,
} from "./fixture";
export { deriveEquipmentTags } from "./equipment";
export { gapFromGeiResult, gapFromSecRuns, impliedSecBenchmark } from "./gap";
export { matchEcmLibrary, parseSavingsRange, relevanceDistance } from "./match";
