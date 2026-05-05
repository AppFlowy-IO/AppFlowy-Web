export {
  approveMcpClient as approveClient,
  disconnectMcpConnections as disconnectConnections,
  getMcpWorkspaceSettings as getWorkspaceSettings,
  listMcpConnections as listConnections,
  revokeMcpClientApproval as revokeClientApproval,
  updateMcpWorkspaceSettings as updateWorkspaceSettings,
} from '../js-services/http/mcp-api';

export type {
  McpApprovedClient,
  McpConnectionSummary,
  McpConnectionsResponse,
  McpDisconnectResponse,
  McpWorkspaceAdminSettings,
} from '../js-services/http/mcp-api';
