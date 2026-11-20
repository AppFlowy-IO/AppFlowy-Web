export {
  generateSearchSummary,
  generateSearchSummaryForDocuments,
  getRecentOverviews,
  searchWorkspace,
  searchWorkspaceDocumentPage,
  searchWorkspaceDocuments,
} from '../js-services/http/misc-api';
export type {
  RecentOverviewTopic,
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
