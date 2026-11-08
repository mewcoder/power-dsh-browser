import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir('lib', { recursive: true });
await build({ entryPoints: ['src/index.js'], outfile: 'lib/index.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', sourcemap: false });
const result = await build({ entryPoints: ['src/client.js'], bundle: true, platform: 'browser', format: 'cjs', packages: 'external', target: 'chrome132', write: false });
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory(require){const module={exports:{}};const exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`);
