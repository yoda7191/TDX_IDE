import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { tdClient } from '../bridge/tdClient';
import { textport } from '../bridge/textportStream';

export class ParamSnapshotManager {
  private static readonly PRESETS_DIR = '.td_presets';

  public static async saveSnapshot(opPath?: string) {
    if (!tdClient.isConnected) {
      vscode.window.showWarningMessage('Please connect to TouchDesigner first.');
      return;
    }

    let targetPath = opPath;
    if (!targetPath) {
      targetPath = await vscode.window.showInputBox({
        prompt: 'Enter operator path to save parameter snapshot from',
        placeHolder: '/project1/geo1',
      });
      if (!targetPath) return;
    }

    try {
      const res = await tdClient.getOpParams(targetPath, false);
      if (!res.params || res.params.length === 0) {
        vscode.window.showWarningMessage(`No parameters found on operator '${targetPath}'.`);
        return;
      }

      const paramValues: Record<string, any> = {};
      for (const p of res.params) {
        if (!p.readOnly && !p.type?.toLowerCase().includes('pulse')) {
          paramValues[p.name] = p.val;
        }
      }

      const defaultName = targetPath.split('/').filter(Boolean).pop() || 'preset';
      const presetName = await vscode.window.showInputBox({
        prompt: 'Enter a name for this parameter snapshot',
        value: `${defaultName}_preset`,
      });
      if (!presetName) return;

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const baseDir = workspaceFolder
        ? path.join(workspaceFolder.uri.fsPath, this.PRESETS_DIR)
        : path.join(process.cwd(), this.PRESETS_DIR);

      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }

      const fileName = `${presetName.endsWith('.json') ? presetName : presetName + '.json'}`;
      const filePath = path.join(baseDir, fileName);

      const payload = {
        opPath: targetPath,
        savedAt: new Date().toISOString(),
        paramCount: Object.keys(paramValues).length,
        params: paramValues,
      };

      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');

      vscode.window.showInformationMessage(
        `Saved snapshot with ${payload.paramCount} parameters to ${path.relative(workspaceFolder?.uri.fsPath || '', filePath)}`
      );
      textport.log(`Saved parameter snapshot for ${targetPath} -> ${filePath}`, 'PRESET');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to save parameter snapshot: ${err.message}`);
    }
  }

  public static async loadSnapshot(opPath?: string) {
    if (!tdClient.isConnected) {
      vscode.window.showWarningMessage('Please connect to TouchDesigner first.');
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const baseDir = workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, this.PRESETS_DIR)
      : path.join(process.cwd(), this.PRESETS_DIR);

    if (!fs.existsSync(baseDir)) {
      vscode.window.showInformationMessage('No presets directory found in workspace.');
      return;
    }

    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      vscode.window.showInformationMessage('No parameter preset files found in .td_presets.');
      return;
    }

    const selectedFile = await vscode.window.showQuickPick(files, {
      placeHolder: 'Select a parameter preset to restore',
    });
    if (!selectedFile) return;

    const filePath = path.join(baseDir, selectedFile);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const targetPath = opPath || data.opPath;
      if (!targetPath) {
        vscode.window.showErrorMessage('No target operator path found in preset file.');
        return;
      }

      const paramsToApply = data.params || {};
      const appliedCount = await tdClient.applyParamSnapshot(targetPath, paramsToApply);

      vscode.window.showInformationMessage(
        `Restored ${appliedCount} parameters on '${targetPath}' from ${selectedFile}`
      );
      textport.log(`Applied parameter preset ${selectedFile} to ${targetPath} (${appliedCount} params updated)`, 'PRESET');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load parameter preset: ${err.message}`);
    }
  }
}

