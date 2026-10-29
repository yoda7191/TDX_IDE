import * as vscode from 'vscode';
import { tdClient } from '../bridge/tdClient';
import { OpNode } from '../bridge/protocol';

export class OpTreeItem extends vscode.TreeItem {
  constructor(
    public readonly node: OpNode,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(node.name, collapsibleState);

    this.id = node.path;
    this.description = node.type;
    this.tooltip = new vscode.MarkdownString(
      `**${node.path}**\n\nFamily: ${node.family}\nType: ${node.type}${
        node.error ? `\n\nError: ${node.error}` : ''
      }${node.warning ? `\n\nWarning: ${node.warning}` : ''}`
    );

    // Set icon based on OP family and error state
    this.iconPath = this.getIconForNode(node);

    // Context value for menu contributions
    if (node.isDat) {
      this.contextValue = 'touchdesigner.dat';
      this.command = {
        command: 'touchdesigner.openDat',
        title: 'Open DAT in Editor',
        arguments: [node.path],
      };
    } else if (node.family === 'COMP') {
      this.contextValue = 'touchdesigner.comp';
      this.command = {
        command: 'touchdesigner.inspectOp',
        title: 'Inspect Parameters',
        arguments: [node.path],
      };
    } else {
      this.contextValue = 'touchdesigner.op';
      this.command = {
        command: 'touchdesigner.inspectOp',
        title: 'Inspect Parameters',
        arguments: [node.path],
      };
    }
  }

  private getIconForNode(node: OpNode): vscode.ThemeIcon {
    if (node.error) {
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    }
    if (node.warning) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    }

    switch (node.family) {
      case 'COMP':
        return new vscode.ThemeIcon('symbol-folder');
      case 'TOP':
        return new vscode.ThemeIcon('file-media');
      case 'CHOP':
        return new vscode.ThemeIcon('pulse');
      case 'DAT':
        return node.isScript
          ? new vscode.ThemeIcon('file-code')
          : new vscode.ThemeIcon('file-text');
      case 'SOP':
        return new vscode.ThemeIcon('symbol-field');
      case 'MAT':
        return new vscode.ThemeIcon('symbol-color');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class TouchDesignerTreeDataProvider implements vscode.TreeDataProvider<OpTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<OpTreeItem | undefined | void> = new vscode.EventEmitter<OpTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OpTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private filterDatsOnly: boolean = false;

  constructor() {
    tdClient.on('connected', () => this.refresh());
    tdClient.on('disconnected', () => this.refresh());
    tdClient.on('tree_changed', () => this.refresh());
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public toggleFilterDatsOnly(): boolean {
    this.filterDatsOnly = !this.filterDatsOnly;
    this.refresh();
    return this.filterDatsOnly;
  }

  public getTreeItem(element: OpTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: OpTreeItem): Promise<OpTreeItem[]> {
    if (!tdClient.isConnected) {
      if (!element) {
        // Show status item prompting user to connect
        const statusNode: OpNode = {
          name: 'TouchDesigner is Disconnected',
          path: '',
          family: 'custom',
          type: 'Click to Connect',
          hasChildren: false,
        };
        const item = new OpTreeItem(statusNode, vscode.TreeItemCollapsibleState.None);
        item.description = 'Click to connect';
        item.tooltip = 'Click to connect to TouchDesigner (ws://127.0.0.1:9988)';
        item.iconPath = new vscode.ThemeIcon('debug-disconnect');
        item.command = {
          command: 'touchdesigner.connect',
          title: 'Connect to TouchDesigner',
        };
        return [item];
      }
      return [];
    }

    const parentPath = element ? element.node.path : '/';
    try {
      const nodes = await tdClient.getOpTree(parentPath, 1, this.filterDatsOnly);
      return nodes.map((node) => {
        const hasChildren = node.hasChildren;
        const state = hasChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

        return new OpTreeItem(node, state);
      });
    } catch (e) {
      return [];
    }
  }
}
