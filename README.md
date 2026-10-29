# TouchDesigner IDE for Visual Studio Code

TouchDesigner IDE connects Visual Studio Code directly to your running TouchDesigner project. 

Instead of writing code inside small Text DAT windows in TouchDesigner, you can write your Python scripts and GLSL shaders in a full-featured code editor with live node autocompletion, visual click-to-run buttons, keyboard shortcuts, and real-time error logging.

---

## What It Does

- **Live Node Autocompletion**: When you type `op('`, VS Code inspects your running TouchDesigner project and shows a list of your actual operators (TOPs, CHOPs, DATs, SOPs, COMPs, and MATs).
- **Live Parameter Suggestions**: When you type `.par.` after any operator, VS Code shows that operator's real parameters, including custom parameters you created and their current values.
- **Click-to-Run Buttons**: Click the Play button in the top-right corner of your editor tab or the "Run in TD" button in the bottom status bar to run code instantly in TouchDesigner.
- **Keyboard Shortcuts**: Highlight any piece of code and press `Cmd + Enter` (on Mac) or `Ctrl + Enter` (on Windows) to run it immediately without switching windows.
- **Operator Tree Sidebar**: Browse your TouchDesigner network hierarchy right from the VS Code sidebar. Click any Text DAT to open and edit it directly.
- **Two-Way Sync**: Edit a script in VS Code, hit Save, and the changes update inside your TouchDesigner DAT automatically.
- **TouchDesigner Textport in VS Code**: All `print()` outputs, status messages, and Python error messages stream directly into an output window in VS Code.
- **Interactive Python Console**: Open an interactive TouchDesigner terminal in VS Code with a single click to test code live with command history.
- **Visual Parameter Inspector**: Tweak real-time TouchDesigner operator parameters right from the VS Code sidebar with live sliders, toggle switches, pulse buttons, and dropdown menus.
- **Batch DAT Externalizer**: Extract all scripts, callbacks, and shaders inside any component into organized workspace folders with one click, keeping Git version control simple.
- **Parameter Presets & Snapshots**: Save and restore complete operator parameter states to JSON snapshot files.
- **Real-Time GLSL Shader Reloading**: When editing GLSL shaders, saving the file automatically pulses dependent GLSL TOPs and MATs in TouchDesigner to recompile without manual clicking.
- **Shader Compile Error Highlighting**: If a shader fails to compile, TouchDesigner's exact error message appears as red underline markers directly on the affected lines in VS Code.
- **Ready-to-Use Code Templates**: Type quick abbreviations like `td-exec`, `td-chopexec`, or `td-raymarch` to instantly insert correctly structured callback scripts and shader presets.

---

## Getting Started

You do not need to download or compile any source code. You only need the single ready-made extension file (`.vsix`).

### Step 1: Download and Install the Extension

1. Go to the [Releases page on GitHub](https://github.com/yoda7191/Touchdesigner_IDE/releases/latest) and download the latest `touchdesigner-ide-0.5.0.vsix` file.
2. Open **Visual Studio Code**.
3. Open the Extensions panel by clicking the Extensions icon on the left sidebar (or press `Cmd + Shift + X` on Mac / `Ctrl + Shift + X` on Windows).
4. Click the three dots menu (`...`) in the top right corner of the Extensions panel.
5. Select **Install from VSIX...**
6. Choose the downloaded `touchdesigner-ide-0.5.0.vsix` file.

The extension will install immediately with all features ready to use.

### Step 2: Start the Bridge in TouchDesigner

You do not need to copy any files or type any long file paths:

1. In VS Code, look at the status bar at the bottom right and click **TD: Disconnected** (or press `Cmd + Shift + P` and search for **TouchDesigner: Copy Bridge Installer Script to Clipboard**).
2. Choose **Copy Bridge Installer to Clipboard**.
3. Switch to TouchDesigner and open the Textport by pressing `Alt + T` on Windows, or `Cmd + T` on Mac.
4. Paste (`Ctrl + V` on Windows or `Cmd + V` on Mac) and press Enter.

TouchDesigner will confirm that `td_vscode_bridge` has been created in `/project1` and is listening on port 9988.

### Step 3: Connect VS Code to TouchDesigner

1. In VS Code, click **TD: Disconnected** in the bottom status bar and select **Connect to TouchDesigner** (or press `Cmd + Shift + P` and choose **TouchDesigner: Connect to TouchDesigner**).
2. The status indicator will turn green and display **TD: Connected**, showing your TouchDesigner build version and active project name.

You are now connected and ready to code.

---

## Running Code and Using the Buttons

The extension gives you multiple visual buttons so you never have to remember complex shortcuts:

### 1. Editor Header Buttons (Top Right of Your Code Tab)

Whenever you open a Python (`.py`), GLSL shader (`.frag`, `.vert`, `.glsl`), or table file, action buttons appear in the top-right corner of the editor tab:

- **Play Button**: Runs your selected code in TouchDesigner. If no code is highlighted, it runs the current line and advances your cursor down to the next line.
- **Run-All Button**: Runs the entire active file in TouchDesigner.
- **Terminal Button**: Opens the interactive TouchDesigner Python REPL console.
- **Clipboard Button**: Copies the bridge installer script so you can easily enable the connection in any other TouchDesigner project.

### 2. Status Bar Buttons (Bottom Right of VS Code)

Look at the bottom status bar for quick one-click controls:

- **Run in TD**: Click this button at any time to run the highlighted code or active line in TouchDesigner.
- **TD REPL**: Click this button to toggle the interactive console.
- **TD: Connected / Disconnected**: Shows live connection status. Clicking it opens a menu of connection actions.

### 3. Sidebar Header Buttons (TouchDesigner Operator Tree)

Click the TouchDesigner icon on the left Activity Bar to open the Operator Tree. The header at the top of the sidebar includes buttons to:

- Copy the bridge installer script.
- Open the interactive REPL terminal.
- Refresh the operator tree.
- Connect or disconnect from TouchDesigner.

---

## Editor Features

### Node and Parameter Autocompletion

- Start typing `op('` — a popup list appears showing all operators in your project.
- Type `op('/project1/geo1').par.` — a list of all parameters on that operator appears. Custom parameters you created are clearly marked with `Custom`.
- Hover your mouse over any `op('/...')` in your code to view the operator type, cooking status, parameter count, and any warnings or errors.

### Jumping to a Script (Go to Definition)

- Place your cursor on any operator path like `op('/project1/my_script')` and press `F12` (or hold `Cmd` on Mac / `Ctrl` on Windows and click the path).
- VS Code immediately opens that DAT so you can view and edit its code.

### The Interactive Python Console (REPL)

- Click the **TD REPL** in the extension.
- A terminal window opens with a `td >>>` prompt where you can test code live against your open TouchDesigner project.
- Use the **Up and Down arrow keys** to cycle through your command history.

### GLSL Shader Live Reloading & Error Highlighting

- **Instant Recompile on Save**: When you save any GLSL fragment or vertex shader DAT in VS Code, the extension automatically instructs TouchDesigner to reload and recompile the shader.
- **In-Line Compiler Error Squigglies**: If your shader code has a syntax error or compilation problem, VS Code places a red wavy underline on the exact line that caused the error. Hovering over the underline shows the TouchDesigner error message.
- **Automatic Offset Handling**: The error reporter automatically accounts for comment headers so line numbers match up accurately.

### Visual Parameter Inspector

- Click any operator in the Operator Tree sidebar (or right-click and select **Inspect Parameters**).
- The Parameter Inspector panel renders all pages and parameters for that operator:
  - **Sliders & Numeric Inputs**: Drag float/int sliders or type exact values to see changes live in TouchDesigner.
  - **Toggles**: Switch boolean settings on and off.
  - **Pulse Buttons**: Trigger actions like `reset`, `reload`, or custom pulses.
  - **Dropdown Menus**: Select menu parameters like blending modes, shapes, and formats.
  - **Instant Filter**: Search parameters by name or label.

### Batch DAT Externalizer & Presets

- **Externalize Component DATs**: Right-click any COMP in the Operator Tree and choose **Externalize DATs to Workspace**. The extension extracts all internal Text DATs, Table DATs, and GLSL shaders into a clean folder structure and activates two-way live auto-sync.
- **Save & Load Parameter Snapshots**: Capture an operator's full parameter state to a `.json` snapshot in `.td_presets/` and restore it at any time.

---

## Keyboard Shortcuts

| Shortcut (Mac) | Shortcut (Windows) | Action |
| :--- | :--- | :--- |
| `Cmd + Enter` | `Ctrl + Enter` | Run selected code (or current line) in TouchDesigner |
| `Shift + Cmd + Enter` | `Shift + Ctrl + Enter` | Run the entire file in TouchDesigner |
| `F12` or `Cmd + Click` | `F12` or `Ctrl + Click` | Jump directly to the referenced script or extension method |

---

## Code Templates (Snippets)

TouchDesigner uses specific function names for callback scripts. Instead of looking them up in documentation, type any of these short names in a Python file and press `Tab` or `Enter` to expand a full template:

| Template Name | What It Creates |
| :--- | :--- |
| `td-ext` | A complete TouchDesigner Python Extension class structure |
| `td-exec` | Execute DAT callbacks (`onStart`, `onCreate`, `onFrameStart`, `onFrameEnd`, `onExit`) |
| `td-chopexec` | CHOP Execute DAT callbacks (`onValueChange`, `onOffToOn`, `onWhileOn`, `onOnToOff`) |
| `td-parexec` | Parameter Execute DAT callbacks (`onValueChange`, `onPulse`, `onExpressionChange`) |
| `td-panelexec` | Panel Execute DAT callbacks (`onSelect`, `onHover`, `onPanelValueChange`) |
| `td-cook-dat` | Script DAT `onCook()` table generator |
| `td-cook-chop` | Script CHOP `onCook()` channel generator |
| `td-cook-sop` | Script SOP `onCook()` geometry generator |
| `td-par-custom` | Custom parameter creation helper code |
| `td-glsl-top` | Complete GLSL TOP pixel shader template |
| `td-glsl-vert` | Complete GLSL MAT vertex shader template |
| `td-raymarch` | Raymarching Signed Distance Field (SDF) starter shader with lighting |
| `td-feedback` | Multi-frame feedback loop trail and decay shader |
| `td-noise` | Procedural fractal Brownian motion (FBM) noise shader |
| `td-chromatic` | Chromatic aberration and lens distortion post-processing effect |
| `td-compute` | TouchDesigner GLSL Compute TOP template |

---

## Building from Source (For Developers)

Most users do not need to do this. Simply download the `.vsix` file from the [Releases page](https://github.com/yoda7191/Touchdesigner_IDE/releases/latest) as described in the Getting Started section above.

If you want to contribute to the extension or modify its code yourself, you can build it from source:

1. **Make sure you have Node.js installed**: If you do not have it yet, download and install the LTS version from nodejs.org.
2. **Open your computer terminal**: Navigate into the folder containing these files:

   ```bash
   cd path/to/Touchdesigner_IDE
   ```

3. **Install the dependencies**:

   ```bash
   npm install
   ```

4. **Create the extension installer file**:

   ```bash
   npm run package
   ```

   This compiles the extension and generates `touchdesigner-ide-0.5.0.vsix`.
5. **Install it into VS Code**:
   - Install through the VS Code interface using **Install from VSIX...**, or run:

   ```bash
   code --install-extension touchdesigner-ide-0.5.0.vsix --force
   ```

---

## Configuring Settings

If you run TouchDesigner on a second computer or need to change the network port, open VS Code Settings (`Cmd + ,` on Mac or `Ctrl + ,` on Windows) and search for `TouchDesigner`:

- **Server Host**: The IP address of the computer running TouchDesigner (defaults to `127.0.0.1` for the same computer).
- **Server Port**: The port number used by the bridge component (defaults to `9988`).
- **Auto Connect**: Whether VS Code automatically attempts to connect to TouchDesigner when you open the project (defaults to `true`).
- **Show Textport on Output**: Whether to automatically show the Textport panel when code execution produces an error or output (defaults to `true`).
- **Auto Pulse GLSL on Save**: Automatically reload dependent GLSL TOPs and MATs when saving shader files (defaults to `true`).
- **Show GLSL Diagnostics**: Display TouchDesigner GLSL compiler errors as red underline markers on corresponding lines (defaults to `true`).

---

## Project Roadmap

See the [`ROADMAP.md`](ROADMAP.md) file for planned development milestones, upcoming features (including GLSL live reload, visual parameter inspector panels, and pre-packaged `.tox` components), and future release timeline.

---

## Support

If TouchDesigner IDE saves you time and you would like to support its ongoing development, you can [buy me a coffee](https://buymeacoffee.com/yoda7191). Any support is greatly appreciated!

---

## License

This project is licensed under the Apache License, Version 2.0.

Copyright 2026 Maja Roczek. All rights reserved.

You are free to use, modify, and distribute this software provided that all copyright notices and attribution statements are retained, and any modified files include a notice stating that changes were made. See the [`LICENSE`](LICENSE) file for the full legal text.
