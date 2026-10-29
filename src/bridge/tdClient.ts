import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  ClientRequest,
  ServerMessage,
  BaseResponse,
  PongResponse,
  EvalResponse,
  GetOpTreeResponse,
  GetOpDetailsResponse,
  GetOpCompletionsResponse,
  GetOpParamsResponse,
  SyncDatResponse,
  FetchDatResponse,
  CookOpResponse,
  SetOpParamResponse,
  PulseOpParamResponse,
  BatchFetchDatsResponse,
  BatchDatItem,
  ApplyParamSnapshotResponse,
  TextportEvent,
  OpNode,
  OpParamInfo,
  OpCompletionItem,
  OpDetails,
} from './protocol';

export interface TDServerInfo {
  version: string;
  tdVersion: string;
  tdBuild: string;
  os: string;
  projectName: string;
  projectPath: string;
}

export class TDClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, {
    resolve: (res: any) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  private reconnectTimer: NodeJS.Timeout | null = null;
  private isExplicitDisconnect: boolean = false;
  private host: string = '127.0.0.1';
  private port: number = 9988;
  private _isConnected: boolean = false;
  private _serverInfo: TDServerInfo | null = null;

  // Cache for instantaneous completions & hover lookups
  private completionCache: { timestamp: number; items: OpCompletionItem[] } | null = null;
  private paramsCache: Map<string, { timestamp: number; params: OpParamInfo[]; customMethods: string[]; customMembers: string[] }> = new Map();
  private CACHE_TTL_MS = 4000;

  constructor() {
    super();
  }

  public get isConnected(): boolean {
    return this._isConnected;
  }

  public get serverInfo(): TDServerInfo | null {
    return this._serverInfo;
  }

  public connect(host: string = '127.0.0.1', port: number = 9988): Promise<boolean> {
    this.host = host;
    this.port = port;
    this.isExplicitDisconnect = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const url = `ws://${this.host}:${this.port}`;
      try {
        this.ws = new WebSocket(url);

        const connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            this.ws.terminate();
            this.handleDisconnect('Connection timeout');
            resolve(false);
          }
        }, 3000);

        this.ws.on('open', async () => {
          clearTimeout(connectionTimeout);
          this._isConnected = true;
          this.emit('connecting_success');

          // Send ping to retrieve TouchDesigner project info
          try {
            const pong = await this.ping();
            this._serverInfo = {
              version: pong.version,
              tdVersion: pong.tdVersion,
              tdBuild: pong.tdBuild,
              os: pong.os,
              projectName: pong.projectName,
              projectPath: pong.projectPath,
            };
          } catch {
            // Ping error isn't fatal, connection is still open
          }

          this.emit('connected', this._serverInfo);
          this.emit('statusChange', true, this._serverInfo);
          resolve(true);
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleIncomingMessage(data.toString());
        });

        this.ws.on('close', (code, reason) => {
          clearTimeout(connectionTimeout);
          this.handleDisconnect(`Closed (${code}: ${reason.toString()})`);
          resolve(false);
        });

        this.ws.on('error', (err) => {
          clearTimeout(connectionTimeout);
          this.handleDisconnect(err.message);
          resolve(false);
        });
      } catch (err: any) {
        this.handleDisconnect(err.message);
        resolve(false);
      }
    });
  }

  public disconnect() {
    this.isExplicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handleDisconnect('Disconnected by user');
  }

  private handleDisconnect(reason: string) {
    const wasConnected = this._isConnected;
    this._isConnected = false;
    this._serverInfo = null;
    this.clearCache();

    // Reject all pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(`Connection lost while waiting for response: ${reason}`));
    }
    this.pendingRequests.clear();

    if (wasConnected) {
      this.emit('disconnected', reason);
      this.emit('statusChange', false);
    }

    if (!this.isExplicitDisconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this._isConnected && !this.isExplicitDisconnect) {
        await this.connect(this.host, this.port);
      }
    }, 4000);
  }

  private handleIncomingMessage(raw: string) {
    try {
      const parsed = JSON.parse(raw);

      // Check for server events
      if (parsed.event) {
        if (parsed.event === 'textport') {
          this.emit('textport', parsed as TextportEvent);
        } else if (parsed.event === 'tree_changed') {
          this.clearCache();
          this.emit('tree_changed');
        }
        return;
      }

      // Check for responses to pending requests
      const message = parsed as ServerMessage;
      if ('id' in message && message.id && this.pendingRequests.has(message.id)) {
        const { resolve, reject, timer } = this.pendingRequests.get(message.id)!;
        clearTimeout(timer);
        this.pendingRequests.delete(message.id);

        if ('success' in message && !message.success) {
          reject(new Error(message.error || 'TouchDesigner operation failed'));
        } else {
          resolve(message);
        }
      }
    } catch (e) {
      console.error('[TDClient] Error parsing incoming message:', e, raw);
    }
  }

  public sendRequest<T extends BaseResponse>(req: ClientRequest, timeoutMs = 8000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('TouchDesigner is not connected'));
    }

    const id = req.id || `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const fullRequest = { ...req, id } as ClientRequest;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request '${req.action}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.ws!.send(JSON.stringify(fullRequest));
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  public async ping(): Promise<PongResponse> {
    return this.sendRequest<PongResponse>({ action: 'ping' }, 2000);
  }

  public async evalCode(code: string, contextOp?: string, syncDatPath?: string): Promise<EvalResponse> {
    return this.sendRequest<EvalResponse>({
      action: 'eval',
      code,
      contextOp,
      syncDatPath,
    }, 15000);
  }

  public async getOpTree(rootPath = '/', depth = 4, includeDatsOnly = false): Promise<OpNode[]> {
    const res = await this.sendRequest<GetOpTreeResponse>({
      action: 'get_op_tree',
      rootPath,
      depth,
      includeDatsOnly,
    });
    return res.tree;
  }

  public async getOpCompletions(prefix?: string, useCache = true): Promise<OpCompletionItem[]> {
    const now = Date.now();
    if (useCache && this.completionCache && (now - this.completionCache.timestamp < this.CACHE_TTL_MS)) {
      if (!prefix) {
        return this.completionCache.items;
      }
      return this.completionCache.items.filter(item => item.path.startsWith(prefix) || item.label.includes(prefix));
    }

    try {
      const res = await this.sendRequest<GetOpCompletionsResponse>({
        action: 'get_op_completions',
        prefix,
      }, 3000);

      if (!prefix) {
        this.completionCache = {
          timestamp: now,
          items: res.items,
        };
      }
      return res.items;
    } catch (e) {
      if (this.completionCache) {
        return this.completionCache.items;
      }
      return [];
    }
  }

  public async getOpParams(path: string, useCache = true): Promise<{ params: OpParamInfo[]; customMethods: string[]; customMembers: string[] }> {
    const now = Date.now();
    if (useCache && this.paramsCache.has(path)) {
      const entry = this.paramsCache.get(path)!;
      if (now - entry.timestamp < this.CACHE_TTL_MS) {
        return {
          params: entry.params,
          customMethods: entry.customMethods,
          customMembers: entry.customMembers,
        };
      }
    }

    const res = await this.sendRequest<GetOpParamsResponse>({
      action: 'get_op_params',
      path,
    }, 3000);

    this.paramsCache.set(path, {
      timestamp: now,
      params: res.params,
      customMethods: res.customMethods,
      customMembers: res.customMembers,
    });

    return {
      params: res.params,
      customMethods: res.customMethods,
      customMembers: res.customMembers,
    };
  }

  public async getOpDetails(path: string): Promise<OpDetails | undefined> {
    const res = await this.sendRequest<GetOpDetailsResponse>({
      action: 'get_op_details',
      path,
    });
    return res.details;
  }

  public async syncDat(path: string, content: string): Promise<SyncDatResponse> {
    return this.sendRequest<SyncDatResponse>({
      action: 'sync_dat',
      path,
      content,
    });
  }

  public async fetchDat(path: string): Promise<{ content: string; isTable: boolean }> {
    const res = await this.sendRequest<FetchDatResponse>({
      action: 'fetch_dat',
      path,
    });
    return {
      content: res.content,
      isTable: res.isTable,
    };
  }

  public async cookOp(path: string, force = true): Promise<boolean> {
    const res = await this.sendRequest<CookOpResponse>({
      action: 'cook_op',
      path,
      force,
    });
    return res.success;
  }

  public async setOpParam(path: string, param: string, val: any): Promise<boolean> {
    const res = await this.sendRequest<SetOpParamResponse>({
      action: 'set_op_param',
      path,
      param,
      val,
    });
    this.paramsCache.delete(path);
    return res.success;
  }

  public async pulseOpParam(path: string, param: string): Promise<boolean> {
    const res = await this.sendRequest<PulseOpParamResponse>({
      action: 'pulse_op_param',
      path,
      param,
    });
    return res.success;
  }

  public async batchFetchDats(rootPath = '/'): Promise<BatchDatItem[]> {
    const res = await this.sendRequest<BatchFetchDatsResponse>({
      action: 'batch_fetch_dats',
      rootPath,
    }, 15000);
    return res.items || [];
  }

  public async applyParamSnapshot(path: string, snapshot: Record<string, any>): Promise<number> {
    const res = await this.sendRequest<ApplyParamSnapshotResponse>({
      action: 'apply_param_snapshot',
      path,
      snapshot,
    });
    this.paramsCache.delete(path);
    return res.appliedCount || 0;
  }

  public clearCache() {
    this.completionCache = null;
    this.paramsCache.clear();
  }
}

// Global singleton instance for the extension
export const tdClient = new TDClient();
