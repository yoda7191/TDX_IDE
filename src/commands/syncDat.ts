import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { tdClient } from '../bridge/tdClient';
import { textport } from '../bridge/textportStream';
import { CompileDiagnostic } from '../bridge/protocol';

export class DatSyncManager {
  // Map of file URI string -> TouchDesigner OP path
  private syncedFiles: Map<string, string> = new Map();
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor(private context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('touchdesigner-glsl');
    context.subscriptions.push(this.diagnosticCollection);

    // Listen for file save events to auto-sync back to TouchDesigner
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        await this.handleFileSaved(document);
      })
    );
  }

  public registerSyncedFile(fileUri: vscode.Uri, opPath: string) {
    this.syncedFiles.set(fileUri.toString(), opPath);
  }

  /**
   * Ensures a DAT from TouchDesigner is synced to disk and returns its file Uri
   */
  public async ensureDatFile(opPath: string): Promise<vscode.Uri | null> {
    if (!tdClient.isConnected) {
      return null;
    }

    try {
      const { content, isTable } = await tdClient.fetchDat(opPath);

      let ext = '.py';
      if (isTable) {
        ext = '.tsv';
      } else if (opPath.endsWith('_vert') || opPath.includes('vert')) {
        ext = '.vert';
      } else if (opPath.endsWith('_frag') || opPath.includes('pixel') || opPath.includes('frag')) {
        ext = '.frag';
      } else if (opPath.endsWith('.glsl')) {
        ext = '.glsl';
      } else if (opPath.endsWith('.json')) {
        ext = '.json';
      } else if (opPath.endsWith('.xml')) {
        ext = '.xml';
      }

      const safeName = opPath.replace(/^\//, '').replace(/\//g, '_');
      const filename = `${safeName}${ext}`;

      let targetDir: string;
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        targetDir = path.join(workspaceFolder.uri.fsPath, '.td_sync');
      } else {
        targetDir = path.join(this.context.globalStorageUri.fsPath, 'dats');
      }

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const filePath = path.join(targetDir, filename);

      let fileContent = content;
      if (ext === '.py' && !fileContent.startsWith('# td:')) {
        fileContent = `# td: ${opPath}\n# Auto-synced with TouchDesigner\n\n${fileContent}`;
      } else if ((ext === '.frag' || ext === '.vert' || ext === '.glsl') && !fileContent.startsWith('// td:')) {
        fileContent = `// td: ${opPath}\n// Auto-synced with TouchDesigner\n\n${fileContent}`;
      }

      fs.writeFileSync(filePath, fileContent, 'utf-8');

      const fileUri = vscode.Uri.file(filePath);
      this.syncedFiles.set(fileUri.toString(), opPath);
      return fileUri;
    } catch {
      return null;
    }
  }

  /**
   * Opens a DAT from TouchDesigner in the editor
   */
  public async openDatInEditor(opPath: string) {
    if (!tdClient.isConnected) {
      vscode.window.showWarningMessage('Please connect to TouchDesigner first.');
      return;
    }

    try {
      const fileUri = await this.ensureDatFile(opPath);
      if (!fileUri) {
        throw new Error(`Unable to fetch DAT content for ${opPath}`);
      }

      // Open in editor
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });

      vscode.window.setStatusBarMessage(`Opened ${opPath} from TouchDesigner`, 3000);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open DAT '${opPath}': ${err.message}`);
    }
  }

  /**
   * Triggered when a document is saved
   */
  private async handleFileSaved(document: vscode.TextDocument) {
    if (!tdClient.isConnected) {
      return;
    }

    const uriStr = document.uri.toString();
    let opPath = this.syncedFiles.get(uriStr);

    // If not in map, inspect file header for `# td: /path` or `// td: /path`
    if (!opPath && document.lineCount > 0) {
      const firstLine = document.lineAt(0).text;
      const match = firstLine.match(/^(?:#|\/\/)\s*td:\s*([/\w_]+)/i);
      if (match) {
        opPath = match[1];
        this.syncedFiles.set(uriStr, opPath);
      }
    }

    if (!opPath) {
      return;
    }

    // Strip auto-generated header lines before sending back to TD DAT
    let text = document.getText();
    const lines = text.split('\n');
    let cleanLines = [...lines];

    if (cleanLines.length > 0 && cleanLines[0].match(/^(?:#|\/\/)\s*td:/i)) {
      cleanLines.shift(); // remove header
      if (cleanLines.length > 0 && cleanLines[0].match(/^(?:#|\/\/)\s*Auto-synced/i)) {
        cleanLines.shift(); // remove sub-header
      }
      if (cleanLines.length > 0 && cleanLines[0].trim() === '') {
        cleanLines.shift(); // remove blank line
      }
      text = cleanLines.join('\n');
    }

    try {
      const res = await tdClient.syncDat(opPath, text);
      if (res.success) {
        if (res.reloadedOps && res.reloadedOps.length > 0) {
          const opsStr = res.reloadedOps.join(', ');
          vscode.window.setStatusBarMessage(`Synced & reloaded shader on: ${opsStr}`, 3500);
          textport.log(`Auto-reloaded shader on: ${opsStr}`, 'GLSL');
        } else {
          vscode.window.setStatusBarMessage(`Synced to TouchDesigner: ${opPath}`, 2500);
          textport.log(`Synced changes to TouchDesigner DAT: ${opPath}`, 'SYNC');
        }

        // Update GLSL compile diagnostics (error squigglies)
        this.updateDiagnostics(document, res.compileErrors);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to sync to TouchDesigner DAT '${opPath}': ${err.message}`);
    }
  }

  /**
   * Parses TouchDesigner compiler error messages and updates VS Code editor diagnostics
   */
  private updateDiagnostics(document: vscode.TextDocument, errors?: CompileDiagnostic[]) {
    if (!errors || errors.length === 0) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    // Calculate header line offset if file had auto-generated header
    let headerOffset = 0;
    if (document.lineCount > 0) {
      const firstLine = document.lineAt(0).text;
      if (firstLine.match(/^(?:#|\/\/)\s*td:/i)) {
        headerOffset++;
        if (document.lineCount > 1 && document.lineAt(1).text.match(/^(?:#|\/\/)\s*Auto-synced/i)) {
          headerOffset++;
        }
        if (document.lineCount > headerOffset && document.lineAt(headerOffset).text.trim() === '') {
          headerOffset++;
        }
      }
    }

    for (const item of errors) {
      const errorMsg = item.error || item.warning || '';
      if (!errorMsg.trim()) {
        continue;
      }

      // Log error to Textport output
      textport.log(`Compile Error on ${item.path}:\n${errorMsg}`, 'GLSL ERROR');

      // Split multi-line error logs into individual errors
      const errorLines = errorMsg.split('\n');
      for (const rawLine of errorLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        // Matches GLSL compiler error formats: 0(15) : error or ERROR: 0:15: or (15) : error
        const lineMatch = trimmed.match(/(?:0\((\d+)\)|0:(\d+):|\((\d+)\)\s*:)/);
        let targetLine = 0;
        if (lineMatch) {
          const rawLineNum = parseInt(lineMatch[1] || lineMatch[2] || lineMatch[3], 10);
          targetLine = Math.max(0, rawLineNum - 1 + headerOffset);
        }

        const clampedLine = Math.min(targetLine, Math.max(0, document.lineCount - 1));
        const lineRange = document.lineAt(clampedLine).range;

        const isError = /error/i.test(trimmed);
        const diagnostic = new vscode.Diagnostic(
          lineRange,
          `[${item.path}] ${trimmed}`,
          isError ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'TouchDesigner GLSL';
        diagnostics.push(diagnostic);
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}
