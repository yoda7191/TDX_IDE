import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { tdClient } from '../bridge/tdClient';
import { textport } from '../bridge/textportStream';
import { DatSyncManager } from './syncDat';

export class ExternalizeDatsManager {
  public static async externalize(
    rootOpPath?: string,
    datSyncManager?: DatSyncManager
  ) {
    if (!tdClient.isConnected) {
      vscode.window.showWarningMessage('Please connect to TouchDesigner first.');
      return;
    }

    let targetRoot = rootOpPath;
    if (!targetRoot) {
      targetRoot = await vscode.window.showInputBox({
        prompt: 'Enter root component path to externalize DATs from',
        value: '/project1',
      });
      if (!targetRoot) return;
    }

    const defaultFolderName = 'td_scripts';
    const folderInput = await vscode.window.showInputBox({
      prompt: 'Enter folder name to save externalized scripts in your workspace',
      value: defaultFolderName,
    });
    if (!folderInput) return;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const baseDir = workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, folderInput)
      : path.join(process.cwd(), folderInput);

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    vscode.window.setStatusBarMessage(`Externalizing DATs from ${targetRoot}...`, 3000);

    try {
      const items = await tdClient.batchFetchDats(targetRoot);
      if (!items || items.length === 0) {
        vscode.window.showInformationMessage(`No script or text DATs found under '${targetRoot}'.`);
        return;
      }

      let count = 0;
      const manifest: Array<{ path: string; file: string; type: string }> = [];

      for (const item of items) {
        let ext = '.py';
        const nameLower = item.name.toLowerCase();
        const pathLower = item.path.toLowerCase();

        if (item.isTable) {
          ext = '.tsv';
        } else if (nameLower.includes('vert') || pathLower.includes('vert')) {
          ext = '.vert';
        } else if (nameLower.includes('pixel') || nameLower.includes('frag') || pathLower.includes('frag')) {
          ext = '.frag';
        } else if (nameLower.endsWith('.glsl') || item.type.includes('glsl')) {
          ext = '.glsl';
        } else if (item.content.includes('def onCook') || item.content.includes('def on') || item.content.includes('import ')) {
          ext = '.py';
        } else if (!item.content.includes('\n') && item.content.length < 50) {
          ext = '.txt';
        }

        // Relative path inside the output directory matching TD OP hierarchy
        const cleanRelPath = item.path.replace(/^\//, '').replace(/\//g, path.sep);
        const targetFilePath = path.join(baseDir, `${cleanRelPath}${ext}`);
        const targetDirName = path.dirname(targetFilePath);

        if (!fs.existsSync(targetDirName)) {
          fs.mkdirSync(targetDirName, { recursive: true });
        }

        // Format file header with td: path marker for auto-sync detection
        const commentPrefix = (ext === '.frag' || ext === '.vert' || ext === '.glsl') ? '//' : '#';
        const header = `${commentPrefix} td: ${item.path}\n${commentPrefix} Auto-synced from TouchDesigner\n\n`;
        const fullContent = `${header}${item.content}`;

        fs.writeFileSync(targetFilePath, fullContent, 'utf-8');

        // Register for two-way live sync
        if (datSyncManager) {
          datSyncManager.registerSyncedFile(vscode.Uri.file(targetFilePath), item.path);
        }

        manifest.push({
          path: item.path,
          file: path.relative(baseDir, targetFilePath),
          type: item.type,
        });

        count++;
      }

      // Write manifest file
      const manifestPath = path.join(baseDir, '.td_manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      vscode.window.showInformationMessage(
        `Externalized ${count} DATs to ${folderInput}/ with live auto-sync enabled.`
      );
      textport.log(`Externalized ${count} DATs from ${targetRoot} into ${baseDir}`, 'EXTERN');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to externalize DATs: ${err.message}`);
    }
  }
}

