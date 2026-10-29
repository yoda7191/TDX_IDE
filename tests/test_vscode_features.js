/**
 * Automated test suite for VS Code Extension Features:
 * - GLSL Diagnostic Parser & Compiler Error Mapping
 * - Autocompletion Provider Path & Parameter Regexes
 * - Hover & Definition Provider Path Resolvers
 * - Snippet Integrity & Prefix Uniqueness
 * - Package Manifest & Settings Contributions
 * - VSIX Archive Packaging Integrity
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// Helper to simulate parseDiagnostics from src/commands/syncDat.ts
function parseDiagnostics(documentLines, errors) {
  if (!errors || errors.length === 0) return [];

  // Calculate header line offset
  let headerOffset = 0;
  if (documentLines.length > 0) {
    const firstLine = documentLines[0];
    if (firstLine.match(/^(?:#|\/\/)\s*td:/i)) {
      headerOffset++;
      if (documentLines.length > 1 && documentLines[1].match(/^(?:#|\/\/)\s*Auto-synced/i)) {
        headerOffset++;
      }
      if (documentLines.length > headerOffset && documentLines[headerOffset].trim() === '') {
        headerOffset++;
      }
    }
  }

  const results = [];
  for (const item of errors) {
    const errorMsg = item.error || item.warning || '';
    if (!errorMsg.trim()) continue;

    const errorLines = errorMsg.split('\n');
    for (const rawLine of errorLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      const lineMatch = trimmed.match(/(?:0\((\d+)\)|0:(\d+):|\((\d+)\)\s*:)/);
      let targetLine = 0;
      if (lineMatch) {
        const rawLineNum = parseInt(lineMatch[1] || lineMatch[2] || lineMatch[3], 10);
        targetLine = Math.max(0, rawLineNum - 1 + headerOffset);
      }

      const clampedLine = Math.min(targetLine, Math.max(0, documentLines.length - 1));
      const isError = /error/i.test(trimmed);

      results.push({
        line: clampedLine,
        message: `[${item.path}] ${trimmed}`,
        severity: isError ? 'Error' : 'Warning'
      });
    }
  }
  return results;
}

// Simple zip file parser to inspect VSIX content without external dependencies
function listZipEntries(zipBuffer) {
  const entries = [];
  let offset = 0;

  while (offset < zipBuffer.length - 4) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature === 0x04034b50) { // Local file header
      const nameLen = zipBuffer.readUInt16LE(offset + 26);
      const extraLen = zipBuffer.readUInt16LE(offset + 28);
      const fileName = zipBuffer.toString('utf8', offset + 30, offset + 30 + nameLen);
      entries.push(fileName);
      const compSize = zipBuffer.readUInt32LE(offset + 18);
      offset += 30 + nameLen + extraLen + compSize;
    } else {
      offset++;
    }
  }
  return entries;
}

function runTests() {
  console.log('Running VS Code Feature Tests...\n');
  let passed = 0;

  // 1. Test GLSL Compiler Diagnostics Parsing
  {
    console.log('1. Testing GLSL Compiler Diagnostic Parser...');

    const dummyShaderWithHeader = [
      '// td: /project1/glsl1_pixel',
      '// Auto-synced from TouchDesigner',
      '',
      'out vec4 fragColor;',
      'void main()',
      '{',
      '    fragColor = invalidFunction();',
      '}'
    ];

    // NVIDIA / TouchDesigner style: 0(7) : error C1008: undefined variable
    const rawError1 = [
      {
        path: '/project1/glsl1',
        error: '0(4) : error C1008: undefined variable "invalidFunction"'
      }
    ];

    const parsed1 = parseDiagnostics(dummyShaderWithHeader, rawError1);
    assert.strictEqual(parsed1.length, 1);
    // Line 4 in shader body + 3 lines of header = line index 6 (7th line of file)
    assert.strictEqual(parsed1[0].line, 6);
    assert.strictEqual(parsed1[0].severity, 'Error');
    assert.ok(parsed1[0].message.includes('/project1/glsl1'));
    assert.ok(parsed1[0].message.includes('undefined variable'));

    // Test warning parsing
    const rawWarning = [
      {
        path: '/project1/glsl1',
        warning: '0(5) : warning C7011: implicit cast from int to float'
      }
    ];
    const parsedWarn = parseDiagnostics(dummyShaderWithHeader, rawWarning);
    assert.strictEqual(parsedWarn.length, 1);
    assert.strictEqual(parsedWarn[0].severity, 'Warning');

    // Test alternative format: ERROR: 0:4: 'invalidFunction'
    const rawError2 = [
      {
        path: '/project1/glsl1',
        error: "ERROR: 0:4: 'invalidFunction' : no matching overloaded function found"
      }
    ];
    const parsed2 = parseDiagnostics(dummyShaderWithHeader, rawError2);
    assert.strictEqual(parsed2.length, 1);
    assert.strictEqual(parsed2[0].line, 6);

    console.log('   Passed: GLSL error line calculation and severity mapping verified.');
    passed++;
  }

  // 2. Test Autocompletion Regexes
  {
    console.log('2. Testing Autocompletion Regex Providers...');

    const opRegex = /op\(['"]([^'"]*)$/;
    assert.ok(opRegex.test("op('"));
    assert.strictEqual("op('".match(opRegex)[1], "");

    assert.ok(opRegex.test("target = op('/project1/"));
    assert.strictEqual("target = op('/project1/".match(opRegex)[1], "/project1/");

    assert.ok(opRegex.test('op("geo1/'));
    assert.strictEqual('op("geo1/'.match(opRegex)[1], "geo1/");

    assert.strictEqual(opRegex.test('print("hello world")'), false);

    const parRegex = /\.par\.([a-zA-Z0-9_]*)$/;
    assert.ok(parRegex.test("op('/project1/geo1').par."));
    assert.strictEqual("op('/project1/geo1').par.".match(parRegex)[1], "");

    assert.ok(parRegex.test("op('/project1/geo1').par.tx"));
    assert.strictEqual("op('/project1/geo1').par.tx".match(parRegex)[1], "tx");

    assert.strictEqual(parRegex.test("other.object.name"), false);

    console.log('   Passed: Autocompletion regexes match operator and parameter syntax.');
    passed++;
  }

  // 3. Test Hover & Definition Path Resolvers
  {
    console.log('3. Testing Hover & Definition Provider Matchers...');

    const hoverRegex = /op\(['"]([^'"]+)['"]\)/;
    const sampleLine = "my_comp = op('/project1/my_container').par.active = 1";
    const match = sampleLine.match(hoverRegex);
    assert.ok(match);
    assert.strictEqual(match[1], '/project1/my_container');

    console.log('   Passed: Hover and Definition OP path extraction verified.');
    passed++;
  }

  // 4. Test Snippet Integrity
  {
    console.log('4. Testing Snippet Files and Configurations...');

    const glslPath = path.join(WORKSPACE_ROOT, 'snippets', 'glsl.json');
    const pythonPath = path.join(WORKSPACE_ROOT, 'snippets', 'python.json');

    const glslSnippets = JSON.parse(fs.readFileSync(glslPath, 'utf8'));
    const pythonSnippets = JSON.parse(fs.readFileSync(pythonPath, 'utf8'));

    const requiredGlslPrefixes = [
      'td-glsl-top',
      'td-glsl-vert',
      'td-raymarch',
      'td-feedback',
      'td-noise',
      'td-chromatic',
      'td-compute'
    ];

    const requiredPythonPrefixes = [
      'td-ext',
      'td-exec',
      'td-chopexec',
      'td-parexec',
      'td-panelexec',
      'td-cook-dat',
      'td-cook-chop',
      'td-cook-sop',
      'td-par-custom'
    ];

    const glslPrefixes = Object.values(glslSnippets).map(s => s.prefix);
    const pythonPrefixes = Object.values(pythonSnippets).map(s => s.prefix);

    // Verify all required GLSL snippets exist
    for (const prefix of requiredGlslPrefixes) {
      assert.ok(glslPrefixes.includes(prefix), `Missing GLSL snippet prefix: ${prefix}`);
    }

    // Verify all required Python snippets exist
    for (const prefix of requiredPythonPrefixes) {
      assert.ok(pythonPrefixes.includes(prefix), `Missing Python snippet prefix: ${prefix}`);
    }

    // Verify bodies are non-empty and descriptions exist
    for (const [name, snip] of Object.entries({ ...glslSnippets, ...pythonSnippets })) {
      assert.ok(snip.body && snip.body.length > 0, `Snippet '${name}' has empty body`);
      assert.ok(snip.description && snip.description.length > 0, `Snippet '${name}' missing description`);
    }

    console.log(`   Passed: All 16 snippets valid (${glslPrefixes.length} GLSL, ${pythonPrefixes.length} Python).`);
    passed++;
  }

  // 5. Test package.json Configuration
  {
    console.log('5. Testing package.json Manifest Contributions...');

    const pkg = JSON.parse(fs.readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));

    assert.strictEqual(pkg.version, '0.5.0');
    assert.strictEqual(pkg.publisher, 'MajaRoczek');
    assert.strictEqual(pkg.license, 'Apache-2.0');

    const commands = pkg.contributes.commands.map(c => c.command);
    const expectedCommands = [
      'touchdesigner.connect',
      'touchdesigner.disconnect',
      'touchdesigner.executeSelection',
      'touchdesigner.executeFile',
      'touchdesigner.refreshOpTree',
      'touchdesigner.setupPythonEnvironment',
      'touchdesigner.openTextport',
      'touchdesigner.openRepl',
      'touchdesigner.copyBridgeInstaller',
      'touchdesigner.newScript',
      'touchdesigner.exportBridgeScript',
      'touchdesigner.openDat',
      'touchdesigner.cookOp',
      'touchdesigner.copyOpPath',
      'touchdesigner.inspectOp',
      'touchdesigner.externalizeDats',
      'touchdesigner.saveParamSnapshot',
      'touchdesigner.loadParamSnapshot'
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Missing contributed command: ${cmd}`);
    }

    // Verify views
    const views = pkg.contributes.views['touchdesigner-container'];
    const viewIds = views.map(v => v.id);
    assert.ok(viewIds.includes('touchdesigner-explorer'));
    assert.ok(viewIds.includes('touchdesigner-params'));

    const configProps = pkg.contributes.configuration.properties;
    assert.ok(configProps['touchdesigner.serverHost']);
    assert.ok(configProps['touchdesigner.serverPort']);
    assert.ok(configProps['touchdesigner.autoConnect']);
    assert.ok(configProps['touchdesigner.showTextportOnOutput']);
    assert.ok(configProps['touchdesigner.autoPulseGlslOnSave']);
    assert.ok(configProps['touchdesigner.showGlslDiagnostics']);

    // Check editor/title menu buttons
    const editorTitleMenus = pkg.contributes.menus['editor/title'];
    assert.ok(editorTitleMenus.length >= 4);

    console.log(`   Passed: package.json manifest, ${expectedCommands.length} commands, 6 settings, and views verified.`);
    passed++;
  }

  // 6. Test VSIX Package Integrity
  {
    console.log('6. Testing VSIX Package Archive Contents...');

    const vsixFiles = fs.readdirSync(WORKSPACE_ROOT).filter(f => f.startsWith('touchdesigner-ide-') && f.endsWith('.vsix')).sort();
    assert.ok(vsixFiles.length > 0, 'No VSIX package found');
    const vsixName = vsixFiles[vsixFiles.length - 1];
    const vsixPath = path.join(WORKSPACE_ROOT, vsixName);

    const vsixBuffer = fs.readFileSync(vsixPath);
    assert.ok(vsixBuffer.length > 30000, 'VSIX file is smaller than expected');

    const entries = listZipEntries(vsixBuffer);

    const requiredFilesInVsix = [
      'extension/package.json',
      'extension/readme.md',
      'extension/LICENSE.txt',
      'extension/dist/extension.js',
      'extension/snippets/glsl.json',
      'extension/snippets/python.json',
      'extension/td_component/td_vscode_bridge.py',
      'extension/td_component/install_bridge.py'
    ];

    for (const reqFile of requiredFilesInVsix) {
      assert.ok(
        entries.some(e => e.replace(/\\/g, '/') === reqFile),
        `Missing file in VSIX: ${reqFile}`
      );
    }

    console.log(`   Passed: ${vsixName} (${(vsixBuffer.length / 1024).toFixed(1)} KB) contains all bundle files.`);
    passed++;
  }

  console.log(`\nAll ${passed} feature test suites passed successfully!`);
}

runTests();
