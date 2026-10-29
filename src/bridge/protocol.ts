/**
 * TouchDesigner Bridge Communication Protocol
 * Types and interfaces for JSON-RPC / WebSocket messaging between VS Code and TouchDesigner.
 */

export type OpFamily = 'COMP' | 'TOP' | 'CHOP' | 'SOP' | 'DAT' | 'MAT' | 'custom' | string;

export interface OpNode {
  name: string;
  path: string;
  family: OpFamily;
  type: string;
  hasChildren: boolean;
  children?: OpNode[];
  isDat?: boolean;
  isScript?: boolean;
  isExtension?: boolean;
  isGLSL?: boolean;
  error?: string | null;
  warning?: string | null;
  numChildren?: number;
}

export interface OpParamInfo {
  name: string;
  label: string;
  page: string;
  type: string;
  val: any;
  defaultVal?: any;
  isCustom: boolean;
  readOnly: boolean;
  min?: number;
  max?: number;
  normMin?: number;
  normMax?: number;
  menuLabels?: string[];
  menuNames?: string[];
}

export interface OpDetails {
  path: string;
  name: string;
  family: OpFamily;
  type: string;
  cooked: boolean;
  cookTime?: number;
  cpuCookTime?: number;
  gpuCookTime?: number;
  params: OpParamInfo[];
  customMethods: string[];
  customMembers: string[];
  error?: string | null;
  warning?: string | null;
  isDat: boolean;
  datText?: string;
}

export interface OpCompletionItem {
  label: string;
  path: string;
  family: OpFamily;
  type: string;
  isDat?: boolean;
  detail?: string;
  documentation?: string;
}

// Client -> Server Requests
export interface BaseRequest {
  id?: string;
  action: string;
}

export interface PingRequest extends BaseRequest {
  action: 'ping';
}

export interface EvalRequest extends BaseRequest {
  action: 'eval';
  code: string;
  contextOp?: string;
  syncDatPath?: string;
}

export interface GetOpTreeRequest extends BaseRequest {
  action: 'get_op_tree';
  rootPath?: string;
  depth?: number;
  includeDatsOnly?: boolean;
}

export interface GetOpDetailsRequest extends BaseRequest {
  action: 'get_op_details';
  path: string;
}

export interface GetOpCompletionsRequest extends BaseRequest {
  action: 'get_op_completions';
  prefix?: string;
  familyFilter?: OpFamily[];
}

export interface GetOpParamsRequest extends BaseRequest {
  action: 'get_op_params';
  path: string;
}

export interface SyncDatRequest extends BaseRequest {
  action: 'sync_dat';
  path: string;
  content: string;
}

export interface FetchDatRequest extends BaseRequest {
  action: 'fetch_dat';
  path: string;
}

export interface CookOpRequest extends BaseRequest {
  action: 'cook_op';
  path: string;
  force?: boolean;
}

export interface SetOpParamRequest extends BaseRequest {
  action: 'set_op_param';
  path: string;
  param: string;
  val: any;
}

export interface PulseOpParamRequest extends BaseRequest {
  action: 'pulse_op_param';
  path: string;
  param: string;
}

export interface BatchFetchDatsRequest extends BaseRequest {
  action: 'batch_fetch_dats';
  rootPath?: string;
}

export interface ApplyParamSnapshotRequest extends BaseRequest {
  action: 'apply_param_snapshot';
  path: string;
  snapshot: Record<string, any>;
}

export type ClientRequest =
  | PingRequest
  | EvalRequest
  | GetOpTreeRequest
  | GetOpDetailsRequest
  | GetOpCompletionsRequest
  | GetOpParamsRequest
  | SyncDatRequest
  | FetchDatRequest
  | CookOpRequest
  | SetOpParamRequest
  | PulseOpParamRequest
  | BatchFetchDatsRequest
  | ApplyParamSnapshotRequest;

// Server -> Client Responses
export interface BaseResponse {
  id?: string;
  action: string;
  success: boolean;
  error?: string;
}

export interface PongResponse extends BaseResponse {
  action: 'pong';
  version: string;
  tdVersion: string;
  tdBuild: string;
  os: string;
  projectName: string;
  projectPath: string;
}

export interface EvalResponse extends BaseResponse {
  action: 'eval';
  result?: any;
  resultType?: string;
  stdout?: string;
  stderr?: string;
  executionTimeMs?: number;
}

export interface GetOpTreeResponse extends BaseResponse {
  action: 'get_op_tree';
  tree: OpNode[];
}

export interface GetOpDetailsResponse extends BaseResponse {
  action: 'get_op_details';
  details?: OpDetails;
}

export interface GetOpCompletionsResponse extends BaseResponse {
  action: 'get_op_completions';
  items: OpCompletionItem[];
}

export interface GetOpParamsResponse extends BaseResponse {
  action: 'get_op_params';
  path: string;
  params: OpParamInfo[];
  customMethods: string[];
  customMembers: string[];
}

export interface CompileDiagnostic {
  path: string;
  opType?: string;
  error?: string;
  warning?: string;
}

export interface SyncDatResponse extends BaseResponse {
  action: 'sync_dat';
  path: string;
  reloadedOps?: string[];
  compileErrors?: CompileDiagnostic[];
}

export interface FetchDatResponse extends BaseResponse {
  action: 'fetch_dat';
  path: string;
  content: string;
  isTable: boolean;
}

export interface CookOpResponse extends BaseResponse {
  action: 'cook_op';
  path: string;
}

export interface SetOpParamResponse extends BaseResponse {
  action: 'set_op_param';
  path: string;
  param: string;
  val: any;
}

export interface PulseOpParamResponse extends BaseResponse {
  action: 'pulse_op_param';
  path: string;
  param: string;
}

export interface BatchDatItem {
  path: string;
  name: string;
  type: string;
  content: string;
  isTable: boolean;
}

export interface BatchFetchDatsResponse extends BaseResponse {
  action: 'batch_fetch_dats';
  rootPath: string;
  items: BatchDatItem[];
}

export interface ApplyParamSnapshotResponse extends BaseResponse {
  action: 'apply_param_snapshot';
  path: string;
  appliedCount: number;
  errors?: string[];
}

// Server -> Client Events
export interface TextportEvent {
  event: 'textport';
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  timestamp: number;
}

export interface OpTreeChangedEvent {
  event: 'tree_changed';
  affectedPath?: string;
}

export type ServerMessage =
  | PongResponse
  | EvalResponse
  | GetOpTreeResponse
  | GetOpDetailsResponse
  | GetOpCompletionsResponse
  | GetOpParamsResponse
  | SyncDatResponse
  | FetchDatResponse
  | CookOpResponse
  | SetOpParamResponse
  | PulseOpParamResponse
  | BatchFetchDatsResponse
  | ApplyParamSnapshotResponse
  | TextportEvent
  | OpTreeChangedEvent;
