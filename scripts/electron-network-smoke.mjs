// Optional controlled stock-Electron integration. Requires ELECTRON_PATH; never
// installs packages, reads product profiles, patches an app or starts DSH.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const project = fileURLToPath(new URL('../', import.meta.url));
const executable = process.env.ELECTRON_PATH;
if (!executable || !path.isAbsolute(executable)) throw Error('Set ELECTRON_PATH to an absolute path to an existing stock Electron executable.');
await access(executable, constants.X_OK);
const temporaryParent = await realpath(tmpdir());
const temporary = await mkdtemp(path.join(temporaryParent, 'dsh-browser-electron-network-'));
const output = path.join(project, 'artifacts', 'electron-network');
await mkdir(output, { recursive: true });
const reportFile = path.join(output, 'report.json');
const report = { runtime: 'Controlled stock Electron integration, not installed DSH acceptance', checks: [], failures: [], cleanup: {} };
let child, exitPromise, deadline, stdout = '', stderr = '', timedOut = false;
const scrub = text => String(text).replaceAll(temporary, '<temporary-app>').replaceAll(project, '<project>').replaceAll(executable, '<electron>');
const exited = () => child && (child.exitCode !== null || child.signalCode !== null);
const boundedWait = (promise, ms) => new Promise(resolve => {
  const timer = setTimeout(() => resolve(false), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(false); });
});
async function stopOwnChild() {
  if (!child || exited()) return;
  child.kill('SIGTERM');
  if (await boundedWait(exitPromise.then(() => true), 3000)) return;
  child.kill('SIGKILL');
  await boundedWait(exitPromise.then(() => true), 3000);
}
const interrupt = () => { timedOut = true; void stopOwnChild(); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  const fixtureMain = path.join(project, 'test/fixtures/electron-network-app.mjs');
  const fixtureRenderer = path.join(project, 'test/fixtures/electron-network-renderer.js');
  const template = await readFile(path.join(project, 'test/fixtures/electron-network-preload.cjs'), 'utf8');
  const factory = await readFile(path.join(project, 'native/preload-network.cjs'), 'utf8');
  const marker = '/* DSH_NETWORK_FACTORY_SOURCE */';
  if (template.split(marker).length !== 2) throw Error('Expected one preload source insertion marker');
  const preload = path.join(temporary, 'preload.cjs');
  // Insert literal reviewed source at build time. No eval, Function constructor,
  // relative preload require, Electron dependency install or product app entry.
  await writeFile(preload, template.replace(marker, () => factory));
  const bundled = await build({ entryPoints: [fixtureRenderer], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', write: false, logLevel: 'silent' });
  const renderer = path.join(temporary, 'renderer.js');
  await writeFile(renderer, bundled.outputFiles[0].contents);
  const appDirectory = path.join(temporary, 'app'); await mkdir(appDirectory);
  await writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({ name: 'dsh-browser-controlled-electron-network', version: '1.0.0', type: 'module', main: 'main.mjs' }));
  await writeFile(path.join(appDirectory, 'main.mjs'), `import ${JSON.stringify(pathToFileURL(fixtureMain).href)};\n`);
  const configFile = path.join(temporary, 'config.json');
  const childReport = path.join(temporary, 'app-report.json');
  await writeFile(configFile, JSON.stringify({ kind: 'dsh-browser-electron-network-smoke-v1', renderer, preload, report: childReport,
    userData: path.join(temporary, 'user-data'), sessionData: path.join(temporary, 'session-data') }));
  const sourceFiles = ['native/desktop-browser-bridge.js', 'native/preload-network.cjs', 'native/preload-cap.cjs', 'native/lease-network-service.js', 'native/network-recorder.js',
    'src/network-client.js', 'src/protocol.js', 'test/fixtures/electron-network-app.mjs', 'test/fixtures/electron-network-preload.cjs', 'test/fixtures/electron-network-renderer.js'];
  report.sources = await Promise.all(sourceFiles.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(path.join(project, name))).digest('hex') })));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE; delete environment.NODE_OPTIONS; delete environment.NODE_PATH;
  child = spawn(executable, [`--user-data-dir=${path.join(temporary, 'user-data')}`, appDirectory, `--fixture-config=${configFile}`], { cwd: temporary, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-12000); });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-12000); });
  exitPromise = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  deadline = setTimeout(() => { timedOut = true; void stopOwnChild(); }, 90000);
  const result = await exitPromise;
  clearTimeout(deadline);
  let nativeReport;
  try { nativeReport = JSON.parse(await readFile(childReport, 'utf8')); }
  catch { throw Error(`Electron exited before producing a report (code ${result.code}, signal ${result.signal || 'none'})`); }
  Object.assign(report, nativeReport, { sources: report.sources });
  report.process = { exitCode: result.code, signal: result.signal, timedOut };
  if (result.code !== 0 && !report.failures?.length) report.failures = [{ name: 'Electron process', error: `Exit code ${result.code}, signal ${result.signal || 'none'}` }];
  if (timedOut) report.failures.push({ name: 'driver deadline', error: 'Controlled Electron process exceeded its deadline or was interrupted' });
  if (report.server?.posts !== 1 || report.server?.postExact !== true || report.server?.requestHeaderExact !== true) report.failures.push({ name: 'server-side independent evidence', error: 'Controlled POST body/header did not match the received HTTP request' });
} catch (error) {
  report.failures.push({ name: 'controlled Electron infrastructure', error: scrub(error.message) });
} finally {
  clearTimeout(deadline); await stopOwnChild();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  report.cleanup ||= {};
  report.cleanup.childExited = !child || exited();
  // Verify the exact absolute temp target before recursive deletion. Never remove
  // a user-supplied path, a profile outside this run, or a running process's data.
  const resolved = path.resolve(temporary);
  if (report.cleanup.childExited && path.dirname(resolved) === temporaryParent && path.basename(resolved).startsWith('dsh-browser-electron-network-')) {
    await rm(resolved, { recursive: true, force: true }); report.cleanup.temporaryAppRemoved = true;
  } else report.cleanup.temporaryAppRemoved = false;
  if (report.failures.length) report.diagnostics = { stdout: scrub(stdout), stderr: scrub(stderr) };
  await writeFile(reportFile, scrub(JSON.stringify(report, null, 2)));
}
console.log(scrub(JSON.stringify(report, null, 2)));
console.log(`Controlled Electron report: ${path.relative(project, reportFile)}`);
if (report.failures.length || !report.cleanup.childExited || !report.cleanup.temporaryAppRemoved) process.exitCode = 1;
