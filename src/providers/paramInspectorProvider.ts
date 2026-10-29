import * as vscode from 'vscode';
import { tdClient } from '../bridge/tdClient';
import { OpParamInfo, OpDetails } from '../bridge/protocol';
import { textport } from '../bridge/textportStream';

export class ParamInspectorProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'touchdesigner-params';
  private _view?: vscode.WebviewView;
  private currentOpPath: string = '';
  private currentParams: OpParamInfo[] = [];
  private currentDetails?: OpDetails;

  constructor(private readonly extensionUri: vscode.Uri) {
    tdClient.on('connected', () => {
      if (this.currentOpPath) {
        this.inspectOp(this.currentOpPath);
      } else {
        this.updateWebviewContent();
      }
    });

    tdClient.on('disconnected', () => {
      this.updateWebviewContent();
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'set_param': {
          if (!this.currentOpPath) return;
          try {
            await tdClient.setOpParam(this.currentOpPath, data.param, data.val);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to set parameter ${data.param}: ${err.message}`);
          }
          break;
        }

        case 'pulse_param': {
          if (!this.currentOpPath) return;
          try {
            await tdClient.pulseOpParam(this.currentOpPath, data.param);
            vscode.window.setStatusBarMessage(`Pulsed ${this.currentOpPath}.par.${data.param}`, 2000);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to pulse parameter ${data.param}: ${err.message}`);
          }
          break;
        }

        case 'refresh': {
          if (this.currentOpPath) {
            await this.inspectOp(this.currentOpPath);
          }
          break;
        }

        case 'cook': {
          if (this.currentOpPath) {
            await tdClient.cookOp(this.currentOpPath, true);
            vscode.window.setStatusBarMessage(`Cooked ${this.currentOpPath}`, 2000);
          }
          break;
        }

        case 'save_snapshot': {
          if (this.currentOpPath) {
            await vscode.commands.executeCommand('touchdesigner.saveParamSnapshot', this.currentOpPath);
          }
          break;
        }

        case 'load_snapshot': {
          if (this.currentOpPath) {
            await vscode.commands.executeCommand('touchdesigner.loadParamSnapshot', this.currentOpPath);
          }
          break;
        }
      }
    });

    this.updateWebviewContent();
  }

  public async inspectOp(opPath: string) {
    this.currentOpPath = opPath;
    if (this._view) {
      this._view.show?.(true);
    }

    if (!tdClient.isConnected) {
      this.currentParams = [];
      this.currentDetails = undefined;
      this.updateWebviewContent();
      return;
    }

    try {
      const [paramRes, details] = await Promise.all([
        tdClient.getOpParams(opPath, false),
        tdClient.getOpDetails(opPath).catch(() => undefined),
      ]);
      this.currentParams = paramRes.params;
      this.currentDetails = details;
    } catch (err: any) {
      this.currentParams = [];
      textport.log(`Error inspecting parameters for ${opPath}: ${err.message}`, 'PARAMS');
    }

    this.updateWebviewContent();
  }

  private updateWebviewContent() {
    if (!this._view) return;
    this._view.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview(): string {
    const isConnected = tdClient.isConnected;
    const opPath = this.currentOpPath;
    const paramsJson = JSON.stringify(this.currentParams);
    const detailsJson = JSON.stringify(this.currentDetails || {});

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TouchDesigner Parameter Inspector</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --sidebar-bg: var(--vscode-sideBar-background);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --border: var(--vscode-panel-border, #333);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #fff);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 12px;
      color: var(--fg);
      background-color: var(--bg);
      padding: 8px;
      user-select: none;
    }

    .header {
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }

    .op-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 6px;
    }

    .op-path {
      font-weight: 600;
      font-size: 13px;
      word-break: break-all;
      color: var(--vscode-textLink-foreground, #3794ff);
    }

    .op-badge {
      font-size: 10px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
      white-space: nowrap;
    }

    .toolbar {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-top: 6px;
    }

    button {
      background: var(--btn-sec-bg);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 3px 8px;
      font-size: 11px;
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    button:hover {
      background: var(--btn-hover);
      color: var(--btn-fg);
    }

    .search-box {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 11px;
      margin-bottom: 8px;
      outline: none;
    }

    .search-box:focus {
      border-color: var(--vscode-focusBorder);
    }

    .page-tabs {
      display: flex;
      gap: 2px;
      overflow-x: auto;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
      padding-bottom: 4px;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--fg);
      opacity: 0.7;
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 3px;
      cursor: pointer;
      white-space: nowrap;
    }

    .tab-btn.active {
      opacity: 1;
      font-weight: bold;
      background: var(--btn-sec-bg);
      border-bottom: 2px solid var(--vscode-focusBorder, #007acc);
    }

    .params-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .param-row {
      display: grid;
      grid-template-columns: 90px 1fr;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      border-bottom: 1px solid rgba(128, 128, 128, 0.1);
    }

    .param-label {
      font-size: 11px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .param-label small {
      display: block;
      opacity: 0.5;
      font-size: 9px;
    }

    .param-control {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
    }

    .slider-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
    }

    input[type="range"] {
      flex: 1;
      height: 4px;
      accent-color: var(--vscode-focusBorder, #007acc);
      cursor: pointer;
    }

    input[type="number"], input[type="text"] {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 2px 4px;
      border-radius: 2px;
      font-size: 11px;
      outline: none;
    }

    input[type="number"] {
      width: 60px;
      text-align: right;
    }

    input[type="text"] {
      width: 100%;
    }

    select {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 3px 6px;
      border-radius: 2px;
      font-size: 11px;
      outline: none;
    }

    .pulse-btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 3px 12px;
      font-size: 11px;
      border-radius: 3px;
      cursor: pointer;
      width: 100%;
      text-align: center;
    }

    .pulse-btn:active {
      opacity: 0.8;
      transform: scale(0.98);
    }

    .toggle-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .toggle-checkbox {
      cursor: pointer;
      width: 16px;
      height: 16px;
      accent-color: var(--vscode-focusBorder, #007acc);
    }

    .empty-state {
      padding: 24px 12px;
      text-align: center;
      color: var(--fg);
      opacity: 0.7;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  ${
    !isConnected
      ? `<div class="empty-state">
           <p><strong>TouchDesigner is Disconnected</strong></p>
           <p style="margin-top: 6px;">Connect VS Code to TouchDesigner to inspect live operator parameters.</p>
         </div>`
      : !opPath
      ? `<div class="empty-state">
           <p><strong>No Operator Selected</strong></p>
           <p style="margin-top: 6px;">Click an operator in the Operator Tree sidebar or right-click and select "Inspect Parameters".</p>
         </div>`
      : `
        <div class="header">
          <div class="op-title">
            <span class="op-path" title="${opPath}">${opPath}</span>
            <span class="op-badge" id="opFamilyBadge">OP</span>
          </div>
          <div class="toolbar">
            <button onclick="refresh()">Refresh</button>
            <button onclick="cook()">Cook</button>
            <button onclick="saveSnapshot()">Save Preset</button>
            <button onclick="loadSnapshot()">Load Preset</button>
          </div>
        </div>

        <input type="text" class="search-box" id="searchBox" placeholder="Filter parameters..." oninput="onSearch(this.value)">

        <div class="page-tabs" id="pageTabs"></div>
        <div class="params-container" id="paramsContainer"></div>
      `
  }

  <script>
    const vscode = acquireVsCodeApi();
    const params = ${paramsJson};
    const details = ${detailsJson};
    let activePage = 'All';
    let searchQuery = '';

    if (details && details.family) {
      const badge = document.getElementById('opFamilyBadge');
      if (badge) {
        badge.textContent = details.family + ' : ' + details.type;
      }
    }

    function init() {
      if (!params || params.length === 0) return;

      // Extract unique pages
      const pages = ['All'];
      params.forEach(p => {
        const pageName = p.page || 'Default';
        if (!pages.includes(pageName)) {
          pages.push(pageName);
        }
      });

      // Render Tabs
      const tabsContainer = document.getElementById('pageTabs');
      if (tabsContainer) {
        tabsContainer.innerHTML = pages.map(page => 
          \`<button class="tab-btn \${page === activePage ? 'active' : ''}" onclick="selectPage('\${page}')">\${page}</button>\`
        ).join('');
      }

      renderParams();
    }

    function selectPage(page) {
      activePage = page;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === page);
      });
      renderParams();
    }

    function onSearch(query) {
      searchQuery = query.toLowerCase().trim();
      renderParams();
    }

    function renderParams() {
      const container = document.getElementById('paramsContainer');
      if (!container) return;

      const filtered = params.filter(p => {
        const matchesPage = activePage === 'All' || (p.page || 'Default') === activePage;
        const matchesSearch = !searchQuery || 
          p.name.toLowerCase().includes(searchQuery) || 
          p.label.toLowerCase().includes(searchQuery);
        return matchesPage && matchesSearch;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div style="opacity: 0.6; padding: 12px; text-align: center;">No matching parameters found.</div>';
        return;
      }

      container.innerHTML = filtered.map(p => {
        return \`
          <div class="param-row">
            <div class="param-label" title="\${p.label} (\${p.name})">
              \${p.label}
              <small>\${p.name}\${p.isCustom ? ' (Custom)' : ''}</small>
            </div>
            <div class="param-control">
              \${renderControl(p)}
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderControl(p) {
      const type = (p.type || '').toLowerCase();
      const val = p.val !== undefined && p.val !== null ? p.val : '';

      // Pulse button
      if (type.includes('pulse')) {
        return \`<button class="pulse-btn" onclick="pulseParam('\${p.name}')">Pulse</button>\`;
      }

      // Toggle switch / checkbox
      if (type.includes('toggle') || typeof val === 'boolean') {
        const checked = val === true || val === 1 || val === '1' || val === 'True';
        return \`
          <label class="toggle-wrap">
            <input type="checkbox" class="toggle-checkbox" \${checked ? 'checked' : ''} onchange="setParam('\${p.name}', this.checked ? 1 : 0)">
            <span>\${checked ? 'On' : 'Off'}</span>
          </label>
        \`;
      }

      // Menu dropdown
      if (p.menuNames && p.menuNames.length > 0) {
        const options = p.menuNames.map((name, idx) => {
          const label = (p.menuLabels && p.menuLabels[idx]) || name;
          const selected = String(name) === String(val) || String(label) === String(val);
          return \`<option value="\${name}" \${selected ? 'selected' : ''}>\${label}</option>\`;
        }).join('');
        return \`<select onchange="setParam('\${p.name}', this.value)">\${options}</select>\`;
      }

      // Numeric Float / Int slider + number input
      if (typeof val === 'number' || (!isNaN(Number(val)) && val !== '' && typeof val !== 'boolean')) {
        const numVal = Number(val);
        const isInt = type.includes('int');
        const step = isInt ? 1 : 0.01;
        const min = p.normMin !== undefined ? p.normMin : (p.min !== undefined ? p.min : (numVal < 0 ? -10 : 0));
        const max = p.normMax !== undefined ? p.normMax : (p.max !== undefined ? p.max : (numVal > 10 ? numVal * 2 : 10));

        return \`
          <div class="slider-wrap">
            <input type="range" min="\${min}" max="\${max}" step="\${step}" value="\${numVal}"
                   oninput="onSliderInput('\${p.name}', this.value)"
                   onchange="setParam('\${p.name}', \${isInt ? 'parseInt(this.value, 10)' : 'parseFloat(this.value)'})">
            <input type="number" id="num_\${p.name}" value="\${numVal}" step="\${step}"
                   onchange="setParam('\${p.name}', \${isInt ? 'parseInt(this.value, 10)' : 'parseFloat(this.value)'})">
          </div>
        \`;
      }

      // Generic string / text field
      return \`<input type="text" value="\${escapeHtml(String(val))}" onchange="setParam('\${p.name}', this.value)">\`;
    }

    function onSliderInput(paramName, value) {
      const numInput = document.getElementById('num_' + paramName);
      if (numInput) {
        numInput.value = value;
      }
      setParamDebounced(paramName, parseFloat(value));
    }

    let debounceTimer = null;
    function setParamDebounced(param, val) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        setParam(param, val);
      }, 50);
    }

    function setParam(param, val) {
      vscode.postMessage({ type: 'set_param', param, val });
    }

    function pulseParam(param) {
      vscode.postMessage({ type: 'pulse_param', param });
    }

    function refresh() {
      vscode.postMessage({ type: 'refresh' });
    }

    function cook() {
      vscode.postMessage({ type: 'cook' });
    }

    function saveSnapshot() {
      vscode.postMessage({ type: 'save_snapshot' });
    }

    function loadSnapshot() {
      vscode.postMessage({ type: 'load_snapshot' });
    }

    function escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
  }
}

