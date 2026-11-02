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
  SearchSummary,
  SearchSummaryResult,
} from '../js-services/http/misc-api';
export { searchWorkspaceDocumentStream, SearchStreamUnsupportedError } from '../js-services/http/search-stream-api';
export type { SearchStreamOptions, SearchStreamSnapshot } from '../js-services/http/search-stream-api';
