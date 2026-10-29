# TouchDesigner IDE — Project Roadmap

This document outlines the planned development and milestones for the TouchDesigner IDE Visual Studio Code extension.

---

## Current Status (Version 0.5.0) — Completed

The core communication bridge, editing tools, automated release pipeline, GLSL live tools, and visual parameter inspection are fully functional:

- **Live Communication Bridge**: Two-way WebSocket connection between VS Code and TouchDesigner.
- **Node & Parameter Autocompletion**: Live suggestions for `op('...')` and `.par.` matching active nodes in TouchDesigner.
- **Remote Code Execution**: Run selected code or single lines in TouchDesigner using visual Play buttons or shortcuts (`Cmd + Enter` / `Ctrl + Enter`).
- **Integrated Textport**: Real-time streaming of TouchDesigner `print()` statements and error tracebacks directly into VS Code.
- **Operator Tree Sidebar**: Hierarchical view of the TouchDesigner network with one-click DAT editing and live connection status badges.
- **Interactive Python Console (REPL)**: Integrated terminal session with command history for testing code live.
- **Code Templates (Snippets)**: Quick boilerplates for Execute DATs, Script OPs, Component Extensions, and GLSL shaders.
- **Go to Definition**: Jump directly to DATs and extension methods using `F12` or `Cmd + Click`.
- **Universal Bridge Installer**: One-click command in VS Code to copy the bridge setup code directly to the clipboard, with automatic `.tox` export.
- **Automated GitHub Releases**: GitHub Actions pipeline that packages the `.vsix` installer and creates GitHub releases automatically upon version tagging.
- **Real-Time GLSL Live Reload**: Automatically reloads and recompiles dependent GLSL TOPs, GLSL Multi TOPs, and GLSL MATs when saving shader files in VS Code.
- **Shader Compile Error Highlighting**: Displays TouchDesigner GLSL compilation errors with red underline markers directly on the offending line in VS Code.
- **Creative Shader Presets**: Built-in templates for raymarching SDFs, feedback trails, procedural FBM noise, chromatic aberration, and compute shaders.
- **Visual Parameter Inspector**: Sidebar panel with live interactive sliders, toggles, pulse buttons, and dropdown menus for tweaking TouchDesigner nodes directly in VS Code.
- **Batch DAT Externalizer**: One-click utility to extract all scripts, shaders, and tables from any component into your local workspace with live two-way sync.
- **Parameter Snapshot & Presets**: Capture and restore operator parameter states to JSON presets with one click.
- **Official Licensing & Links**: Apache 2.0 license and repository links configured for publisher `MajaRoczek`.

---

## Phase 5: Visual Previews & Advanced Features (Version 1.0.0) — Next Up

- **Live TOP Previews on Hover**: Hovering over any TOP operator in code shows a small live thumbnail image preview of its current texture buffer directly in the tooltip.
- **CHOP Channel Inspection**: Quick graph visualizer in the sidebar showing real-time waveform data for monitored CHOP channels.
- **TouchDesigner Documentation Links**: Quick-open links to the official Derivative wiki for any built-in operator or Python class.

