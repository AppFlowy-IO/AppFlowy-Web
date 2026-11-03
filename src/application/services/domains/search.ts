export {
  generateSearchSummary,
  generateSearchSummaryForDocuments,
  searchWorkspace,
  searchWorkspaceDocumentPage,
  searchWorkspaceDocuments,
} from '../js-services/http/misc-api';
export type {
  SearchDocumentPageResponse,
  SearchDocumentResponseItem,
  SearchEvidence,
  SearchSummary,
  SearchSummaryResult,
} from '../js-services/http/misc-api';
export { searchWorkspaceDocumentStream, SearchStreamUnsupportedError } from '../js-services/http/search-stream-api';
export type { SearchStreamOptions, SearchStreamSnapshot } from '../js-services/http/search-stream-api';
export { reportSearchPresentationMetrics } from '../js-services/http/search-presentation-metrics';
export type { SearchPresentationMetrics } from '../js-services/http/search-presentation-metrics';
