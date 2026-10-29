import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { tdClient } from './bridge/tdClient';
import { textport } from './bridge/textportStream';
import { TouchDesignerCompletionProvider } from './providers/completionProvider';
import { TouchDesignerHoverProvider } from './providers/hoverProvider';
import { TouchDesignerDefinitionProvider } from './providers/definitionProvider';
import { TouchDesignerTreeDataProvider, OpTreeItem } from './providers/opTreeDataProvider';
import { ExecuteCodeManager } from './commands/executeCode';
import { DatSyncManager } from './commands/syncDat';
import { SetupPythonManager } from './commands/setupPython';
import { ReplTerminalManager } from './commands/replTerminal';
import { ParamInspectorProvider } from './providers/paramInspectorProvider';
import { ParamSnapshotManager } from './commands/paramSnapshot';
import { ExternalizeDatsManager } from './commands/externalizeDats';

let statusBarItem: vscode.StatusBarItem;
let runStatusBarItem: vscode.StatusBarItem;
let replStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  textport.log('TouchDesigner IDE extension activated.', 'INIT');

  // Initialize managers
  const treeDataProvider = new TouchDesignerTreeDataProvider();
  const datSyncManager = new DatSyncManager(context);
  const completionProvider = new TouchDesignerCompletionProvider();
  const hoverProvider = new TouchDesignerHoverProvider();

  // Register Tree View
  const treeView = vscode.window.createTreeView('touchdesigner-explorer', {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register Parameter Inspector Webview View
  const paramInspectorProvider = new ParamInspectorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ParamInspectorProvider.viewType,
      paramInspectorProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register Language Features (Python and GLSL)
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      ['python', 'glsl'],
      completionProvider,
      "'", '"', '/', '.', '['
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(['python'], hoverProvider)
  );

  // Register Definition Provider (F12 / Cmd+Click jump to DAT & Extension methods)
  const definitionProvider = new TouchDesignerDefinitionProvider(datSyncManager);
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(['python'], definitionProvider)
  );

  // Status Bar Item with explicit ID to prevent duplication
  statusBarItem = vscode.window.createStatusBarItem('touchdesigner.status', vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'touchdesigner.toggleConnection';
  updateStatusBar(false);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Status Bar Run Script Button with explicit ID to prevent duplication
  runStatusBarItem = vscode.window.createStatusBarItem('touchdesigner.run', vscode.StatusBarAlignment.Right, 99);
  runStatusBarItem.text = '$(play) Run in TD';
  runStatusBarItem.tooltip = 'Click to run selected code or current line in TouchDesigner (Cmd+Enter)';
  runStatusBarItem.command = 'touchdesigner.executeSelection';
  runStatusBarItem.show();
  context.subscriptions.push(runStatusBarItem);

  // Status Bar Interactive REPL Button with explicit ID to prevent duplication
  replStatusBarItem = vscode.window.createStatusBarItem('touchdesigner.repl', vscode.StatusBarAlignment.Right, 98);
  replStatusBarItem.text = '$(terminal) TD REPL';
  replStatusBarItem.tooltip = 'Open TouchDesigner Interactive Python REPL Terminal';
  replStatusBarItem.command = 'touchdesigner.openRepl';
  replStatusBarItem.show();
  context.subscriptions.push(replStatusBarItem);

  // Listen to TD connection status changes
  tdClient.on('statusChange', (connected: boolean, info?: any) => {
    updateStatusBar(connected, info);
    treeView.description = connected
      ? `${info?.projectName || 'Project'} (${info?.tdBuild || ''})`
      : 'Disconnected';
    if (connected) {
      vscode.window.setStatusBarMessage(
        `TouchDesigner connected: ${info?.projectName || 'Project'} (${info?.tdBuild || ''})`,
        3000
      );
    }
  });

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.connect', async () => {
      const config = vscode.workspace.getConfiguration('touchdesigner');
      const host = config.get<string>('serverHost', '127.0.0.1');
      const port = config.get<number>('serverPort', 9988);

      vscode.window.setStatusBarMessage(`Connecting to TouchDesigner at ${host}:${port}...`, 2000);
      const ok = await tdClient.connect(host, port);
      if (!ok) {
        vscode.window.showWarningMessage(
          `Could not connect to TouchDesigner at ${host}:${port}. Make sure TouchDesigner is running with the TD Bridge component active.`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.disconnect', () => {
      tdClient.disconnect();
      vscode.window.setStatusBarMessage('TouchDesigner disconnected', 2000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.toggleConnection', async () => {
      if (tdClient.isConnected) {
        const choice = await vscode.window.showQuickPick(
          ['Disconnect', 'Interactive REPL', 'Show Textport', 'Refresh Operator Tree', 'Configure Python / TDI', 'Copy Bridge Installer to Clipboard'],
          { placeHolder: 'TouchDesigner Bridge Actions' }
        );
        if (choice === 'Disconnect') {
          vscode.commands.executeCommand('touchdesigner.disconnect');
        } else if (choice === 'Interactive REPL') {
          vscode.commands.executeCommand('touchdesigner.openRepl');
        } else if (choice === 'Show Textport') {
          vscode.commands.executeCommand('touchdesigner.openTextport');
        } else if (choice === 'Refresh Operator Tree') {
          vscode.commands.executeCommand('touchdesigner.refreshOpTree');
        } else if (choice === 'Configure Python / TDI') {
          vscode.commands.executeCommand('touchdesigner.setupPythonEnvironment');
        } else if (choice === 'Copy Bridge Installer to Clipboard') {
          vscode.commands.executeCommand('touchdesigner.copyBridgeInstaller');
        }
      } else {
        const choice = await vscode.window.showQuickPick(
          ['Connect to TouchDesigner', 'Copy Bridge Installer to Clipboard', 'Save Bridge Script to Project', 'Configure Python / TDI'],
          { placeHolder: 'TouchDesigner is Disconnected' }
        );
        if (choice === 'Connect to TouchDesigner') {
          vscode.commands.executeCommand('touchdesigner.connect');
        } else if (choice === 'Copy Bridge Installer to Clipboard') {
          vscode.commands.executeCommand('touchdesigner.copyBridgeInstaller');
        } else if (choice === 'Save Bridge Script to Project') {
          vscode.commands.executeCommand('touchdesigner.exportBridgeScript');
        } else if (choice === 'Configure Python / TDI') {
          vscode.commands.executeCommand('touchdesigner.setupPythonEnvironment');
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.executeSelection', () => {
      ExecuteCodeManager.executeSelection();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.executeFile', () => {
      ExecuteCodeManager.executeFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.refreshOpTree', () => {
      treeDataProvider.refresh();
      tdClient.clearCache();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.setupPythonEnvironment', () => {
      SetupPythonManager.configureWorkspaceEnvironment();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.openTextport', () => {
      textport.show(false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.openRepl', () => {
      ReplTerminalManager.openRepl();
    })
  );

  // Copy installer script directly to clipboard for effortless installation in TD
  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.copyBridgeInstaller', async () => {
      const installerPath = context.asAbsolutePath(path.join('td_component', 'install_bridge.py'));
      if (!fs.existsSync(installerPath)) {
        vscode.window.showErrorMessage('Installer script not found inside extension assets.');
        return;
      }

      const scriptContent = fs.readFileSync(installerPath, 'utf-8');
      await vscode.env.clipboard.writeText(scriptContent);

      vscode.window.showInformationMessage(
        'TouchDesigner Bridge installer copied to clipboard! Open TouchDesigner, open the Textport (Alt+T / Cmd+T), paste (Ctrl+V / Cmd+V), and press Enter.'
      );
    })
  );

  // Save installer script to current workspace or selected folder
  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.exportBridgeScript', async () => {
      const installerPath = context.asAbsolutePath(path.join('td_component', 'install_bridge.py'));
      if (!fs.existsSync(installerPath)) {
        vscode.window.showErrorMessage('Installer script not found inside extension assets.');
        return;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      let targetPath: string;

      if (workspaceFolder) {
        targetPath = path.join(workspaceFolder.uri.fsPath, 'install_bridge.py');
      } else {
        const selected = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('install_bridge.py'),
          saveLabel: 'Save TouchDesigner Bridge Script',
          filters: { 'Python Files': ['py'] },
        });
        if (!selected) {
          return;
        }
        targetPath = selected.fsPath;
      }

      const scriptContent = fs.readFileSync(installerPath, 'utf-8');
      fs.writeFileSync(targetPath, scriptContent, 'utf-8');

      vscode.window.showInformationMessage(
        `Saved install_bridge.py to: ${targetPath}. You can drag it into TouchDesigner or run it from a Text DAT.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.openDat', (arg: OpTreeItem | string) => {
      const opPath = typeof arg === 'string' ? arg : arg.node.path;
      datSyncManager.openDatInEditor(opPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.cookOp', async (arg: OpTreeItem | string) => {
      const opPath = typeof arg === 'string' ? arg : arg.node.path;
      if (!tdClient.isConnected) {
        return;
      }
      try {
        await tdClient.cookOp(opPath, true);
        vscode.window.setStatusBarMessage(`Cooked: ${opPath}`, 2000);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to cook ${opPath}: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.copyOpPath', (arg: OpTreeItem | string) => {
      const opPath = typeof arg === 'string' ? arg : arg.node.path;
      vscode.env.clipboard.writeText(`op('${opPath}')`);
      vscode.window.setStatusBarMessage(`Copied op('${opPath}') to clipboard`, 2000);
    })
  );

  // Create New TouchDesigner Script DAT template
  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.newScript', async () => {
      const template = `# TouchDesigner Script DAT\n# Press Cmd+Enter (Mac) / Ctrl+Enter (Windows) or click 'Run in TD' to execute\n\ndef onCook(scriptOp):\n\tscriptOp.clear()\n\tprint("Cooked by TouchDesigner IDE")\n`;
      const doc = await vscode.workspace.openTextDocument({
        language: 'python',
        content: template,
      });
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.inspectOp', (arg?: OpTreeItem | string) => {
      const opPath = typeof arg === 'string' ? arg : (arg?.node?.path || '/project1');
      paramInspectorProvider.inspectOp(opPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.externalizeDats', async (arg?: OpTreeItem | string) => {
      const rootPath = typeof arg === 'string' ? arg : (arg?.node?.path || '/project1');
      await ExternalizeDatsManager.externalize(rootPath, datSyncManager);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.saveParamSnapshot', async (arg?: OpTreeItem | string) => {
      const opPath = typeof arg === 'string' ? arg : arg?.node?.path;
      await ParamSnapshotManager.saveSnapshot(opPath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('touchdesigner.loadParamSnapshot', async (arg?: OpTreeItem | string) => {
      const opPath = typeof arg === 'string' ? arg : arg?.node?.path;
      await ParamSnapshotManager.loadSnapshot(opPath);
    })
  );

  // Auto-connect if enabled in configuration
  const config = vscode.workspace.getConfiguration('touchdesigner');
  if (config.get<boolean>('autoConnect', true)) {
    const host = config.get<string>('serverHost', '127.0.0.1');
    const port = config.get<number>('serverPort', 9988);
    tdClient.connect(host, port);
  }
}

function updateStatusBar(connected: boolean, info?: any) {
  if (connected) {
    const buildStr = info?.tdBuild ? ` (${info.tdBuild})` : '';
    statusBarItem.text = `$(plug) TD: Connected${buildStr}`;
    statusBarItem.tooltip = `Connected to TouchDesigner\nProject: ${info?.projectName || 'unknown'}\nHost: 127.0.0.1:9988\nClick to manage connection`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.color = new vscode.ThemeColor('terminal.ansiGreen');
  } else {
    statusBarItem.text = `$(debug-disconnect) TD: Disconnected`;
    statusBarItem.tooltip = `TouchDesigner is not connected.\nClick to connect.`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.color = undefined;
  }
}

export function deactivate() {
  statusBarItem?.dispose();
  runStatusBarItem?.dispose();
  replStatusBarItem?.dispose();
  tdClient.disconnect();
  textport.dispose();
}
