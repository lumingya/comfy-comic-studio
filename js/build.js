#!/usr/bin/env node
'use strict';

/*
 * Development commands (Node 18+):
 *   npm install --no-save --package-lock=false acorn@8.15.0
 *   node js/build.js extract
 *   node js/build.js check
 *   node js/build.js bundle
 *   node js/build.js dev
 *
 * `extract` losslessly distributes the existing standalone application's
 * declarations by responsibility. Runtime initialization retains its original
 * order in app.js, so aliases and compatibility adapters are not reordered.
 * `bundle` produces a complete standalone index.html. `dev` writes the same
 * shell with /styles.css and /js/*.js for the Python static allowlist.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const moduleOrder = ['state', 'sync', 'engine', 'creation', 'ui', 'app'];
const runtimePattern = /<script\s+id="studio-runtime"[^>]*>([\s\S]*?)<\/script>/;
const stylePattern = /<style\s+id="studio-styles"[^>]*>([\s\S]*?)<\/style>/;

function parser() {
  try { return require('acorn'); }
  catch (error) { throw new Error('Install the build-only parser first: npm install --no-save --package-lock=false acorn@8.15.0'); }
}

function destination(name) {
  if (/^(?:resolveCharacterNames|curatedAdventureSpec|upgradeCuratedCharacterIdentity)/.test(name)) return 'state';
  if (/^(?:planCollectionRemoval|trimUntouchedDemoBook|ensureCollectionDisplay|originalDemoPage)/.test(name)) return 'state';
  if (/^(?:installCollectionDisplay|displayRegressionChecks)/.test(name)) return 'app';
  if (/^(?:createFreePromptPolicy|definedPromptNames|ensureArtSettings|createCuratedDemo|scenicDemoFrame)/.test(name)) return 'state';
  if (name === 'installFreePromptEngine') return 'engine';
  if (/^(?:installArtStudio|artPromptDiagnostics)/.test(name)) return 'app';
  if (/^(?:installNativeState|createStudioState|seed|ensureStudio|ensureCreation|ensureWorkspace|ensureRelease|validateState|backupObject|normalize|typedVariable|variableEntry|checkVariable|scopeText|missingScope|hash$|rng$|svgArt|safeFolder|frame|isFallback|missingIndices|score$|assetCount|activeVersion|captionFor|currentChat|project|bookBy|rowBy|templateBy|currentTemplate)/.test(name)) return 'state';
  if (/^(?:installNativeSync|createConfigConverters|createNativeConfigSync|convertApi|convertStudio|readPython|savePython|connectPython|migrateAndLoad|backend|responseAt|persistBackend|rememberedBackend|applyPython|discoverBackend|openDB|dbRead|dbWrite|loadState|save$|persist$|openDirectory|rememberDirectory|recalledDirectory|findLegacy|disk|readDisk|writeDisk|maybeDisk|contentDigest|buildDisk|loadDisk|readFolder|installLoaded|commitDisk|queueDisk|saveToDirectory|flushDisk|attachWorkspace|chooseWorkspace|reconnectWorkspace|reloadWorkspace|acceptDisk|zipDirectory|crc|restoreImported|importDirectory|loadDiskFirst|syncRemote|restoreObject)/.test(name)) return 'sync';
  if (/^(?:installNativeEngine|createTextNodeContract|detectTextField|inferText|initialWorkflow|isWorkflow|inputPath|inputAt|writeInput|guessValue|workflowInput|nodeInput|bindingRow|castBound|interpolateBound|buildMapped|addInputBinding|readComfy|mappedExecution|executeMapped|generateMapped|autoBind|autoIdentify|addRenderBinding|validateBindings|validateWorkflow|testEngine|connectWS|resetWS|randomSeeds|realFrame|generateFrame|fitSVG|request$|blobData|imageData|rasterJPEG)/.test(name)) return 'engine';
  if (/^(?:installNativeCreation|ensureFrameCapacity|effectivePlan|planFrame|createBookPlan|newVariableSet|planRuntime|variableOwner|renameScoped|enqueue|runQueue|runFlexible|runStories|generateStory|generateOutline|generateXML|parseTemplateXML|interpolate$|validatePrompt|executeTool|assistantToolDraft|applyScoped|mockTool|scopedMock|sendChat|sendScopedChat|extractDocx|addAttachments|delay$|flushEditor|flushCreation|saveStoryInputs|ensureManual|deleteBooks|generateChosen|redraw|createGuidePractice|importTemplateObject|importWorkflowIntoMapper|removeVariable|updateColumn|validateColumn)/.test(name)) return 'creation';
  if (/^(?:installNativeApplication|boot$|releaseDiagnostics|v3Diagnostics|diagnostics|diskFormatDiagnostics)/.test(name)) return 'app';
  return 'ui';
}

function syntaxCheck(source, filename) {
  new vm.Script(source, { filename });
  return parser().parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
}

function extract() {
  const htmlPath = path.join(root, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const runtime = html.match(runtimePattern);
  const styles = html.match(stylePattern);
  if (!runtime || !styles) throw new Error('Extraction requires the complete standalone index.html with studio-runtime and studio-styles markers.');
  const source = runtime[1];
  const ast = syntaxCheck(source, 'index.html#studio-runtime');
  const shellPath = path.join(root, 'js', 'shell.js');
  if (fs.existsSync(shellPath) && !process.argv.includes('--force')) {
    throw new Error('Development sources already exist. Use bundle/dev, or explicitly pass extract --force after backing up your edits.');
  }
  const chunks = Object.fromEntries(moduleOrder.map(name => [name, []]));
  let cursor = 0;
  for (const node of ast.body) {
    const text = source.slice(cursor, node.end);
    const group = node.type === 'FunctionDeclaration' ? destination(node.id.name) : 'app';
    chunks[group].push(text);
    cursor = node.end;
  }
  chunks.app.push(source.slice(cursor));
  const outputs = moduleOrder.map(name => ({ name, text: '/* ComfyComic development module: ' + name + '. */\n\'use strict\';\n' + chunks[name].join('\n\n') + '\n' }));
  outputs.forEach(file => syntaxCheck(file.text, 'js/' + file.name + '.js'));
  syntaxCheck(outputs.map(file => file.text).join('\n'), 'assembled-modules.js');
  if (ast.body.map(node => source.slice(node.start, node.end)).join('').length === 0) throw new Error('Refusing to replace sources from an empty bundle.');
  const shell = html.replace(stylePattern, '<!-- COMFY_STYLES -->').replace(runtimePattern, '<!-- COMFY_SCRIPTS -->');
  fs.mkdirSync(path.join(root, 'js'), { recursive: true });
  fs.writeFileSync(path.join(root, 'js', 'shell.js'), "'use strict';\nmodule.exports = " + JSON.stringify(shell, null, 2) + ';\n');
  fs.writeFileSync(path.join(root, 'styles.css'), styles[1].trim() + '\n');
  for (const file of outputs) fs.writeFileSync(path.join(root, 'js', file.name + '.js'), file.text);
  const checksum = crypto.createHash('sha256').update(source).digest('hex');
  fs.writeFileSync(path.join(root, 'js', 'source-manifest.js'), "'use strict';\nmodule.exports = " + JSON.stringify({ sourceSHA256: checksum, order: moduleOrder, functionCount: ast.body.filter(node => node.type === 'FunctionDeclaration').length, statementCount: ast.body.length }, null, 2) + ';\n');
  console.log('Extracted styles.css and six development modules. No original statements were dropped.');
}

function readSources() {
  if (!fs.existsSync(path.join(root, 'js', 'shell.js'))) throw new Error('Run node js/build.js extract first.');
  const shellPath = path.join(root, 'js', 'shell.js');
  delete require.cache[require.resolve(shellPath)];
  return { shell: require(shellPath), css: fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), scripts: moduleOrder.map(name => ({ name, source: fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') })) };
}

function check() {
  const sources = readSources();
  for (const item of sources.scripts) syntaxCheck(item.source, 'js/' + item.name + '.js');
  syntaxCheck(sources.scripts.map(item => item.source).join('\n'), 'standalone-runtime.js');
  console.log('All development modules and assembled script passed JavaScript syntax checks.');
  return sources;
}

function build(mode) {
  const { shell, css, scripts } = check();
  let styles, runtime;
  if (mode === 'dev') {
    styles = '<link rel="stylesheet" href="/styles.css">';
    runtime = scripts.map(item => '<script src="/js/' + item.name + '.js"></script>').join('\n');
  } else {
    styles = '<style id="studio-styles" data-source="/styles.css">\n' + css + '\n</style>';
    const code = scripts.map(item => '// Source: /js/' + item.name + '.js\n' + item.source).join('\n');
    if (/<\/script\s*>/i.test(code)) throw new Error('A literal closing script tag would terminate the inline bundle. Escape it in the source.');
    runtime = '<script id="studio-runtime">\n' + code + '\n</script>';
  }
  const output = shell.replace('<!-- COMFY_STYLES -->', () => styles).replace('<!-- COMFY_SCRIPTS -->', () => runtime);
  if (!output.startsWith('<!DOCTYPE html>')) throw new Error('Missing HTML document skeleton.');
  fs.writeFileSync(path.join(root, 'index.html'), output);
  console.log('Wrote ' + mode + ' index.html. Static resources use only /styles.css and /js/*.js.');
}

async function main() {
  const command = process.argv[2] || 'bundle';
  if (command === 'extract') extract();
  else if (command === 'check') check();
  else if (command === 'dev' || command === 'bundle') {
    if (!fs.existsSync(path.join(root, 'js', 'shell.js'))) extract();
    build(command);
  }
  else throw new Error('Usage: node js/build.js extract [--force]|check|bundle|dev');
}

if (isMain || (typeof require !== 'undefined' && require.main === module)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { destination, extract, check, build };