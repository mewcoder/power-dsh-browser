# Recoverable Desktop network bridge installer

## 一键安装（推荐）

```sh
npm run bridge:status    # 只读诊断：原始 / 已安装 / 未知
npm run bridge           # 安装或修复；自动等待 DSH 关闭，装完自动重开
npm run bridge:restore   # 还原到原始归档
```

`npm run bridge` 会先自愈检测当前归档状态：

| 状态 | 行为 |
| --- | --- |
| `original` | 生成并安装补丁，然后重开 DSH |
| `installed` | 已是最新，直接重开（或提示无需操作） |
| `unknown` | **拒绝覆盖**，提示先 restore 或重装 DSH |
| `missing` | 报错退出 |

它**不会杀进程**：需要关闭时会等待（最多 5 分钟），超时则不做任何修改。每次替换都有哈希校验，原始归档始终保留。

## 底层命令（需要精确控制时）

This installer supports only DSH Desktop **0.2.2-rc.1**, build `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`, with the exact original main/preload SHA256 allowlist in [the patch helper](../scripts/desktop-bridge-patch.mjs). It requires Node.js 22 or newer and macOS metadata tools. It uses the host's existing authenticated IPC and owned guest leases. No TCP service or browser-control port is added.

Run [the CLI](../scripts/desktop-bridge.mjs) from this project:

```sh
node scripts/desktop-bridge.mjs --check
node scripts/desktop-bridge.mjs --prepare
```

The default action is `--check`, which reads bundle identity, archive version/build/source hashes, Info.plist's declared ASAR header hash, the actual Electron framework fuse wire, and executable process metadata. It never writes files. Unknown identity, source hashes, fuse wire, integrity declarations, enabled embedded ASAR integrity, or enabled ASAR-only loading produce a concrete unsupported error.

`--prepare` can run while Desktop is open. It reads the four current modules from `native/`, hashes their actual bytes, produces a patched archive, and runs Node's **syntax-only** check on both transformed host files and all four payload files. No target code is evaluated and no Electron instance is launched. All preparation writes remain outside the application. The output names an absolute manifest path, original archive backup, and patched archive under `artifacts/desktop-bridge/<app-path-hash>/prepared-<unique>/`. An optional `--state-dir /absolute/directory` changes the parent state directory; an optional `--app /absolute/DeepSeek\ Harness.app` selects an explicitly identified app bundle. Symlinks in the app, payload, state, manifest, backup or destination paths are refused.

Review the manifest and transformed entries before installing. It records the version/build, bundle identity, original and patched full-archive/header SHA256 hashes, six changed file hashes, four source module hashes, original mode/ownership, fuse states, plist/framework hashes and unpacked companion inventory. Each preparation gets a new directory; an existing original backup is never overwritten. The whole original archive is backed up before any application change.

**Close Desktop yourself before either mutation.** The installer never stops, closes, launches or restarts the application. Electron caches ASAR headers, so replacement while any executable inside this bundle is running is refused. With the reviewed absolute manifest path:

```sh
node scripts/desktop-bridge.mjs --apply --manifest /absolute/path/to/manifest.json
node scripts/desktop-bridge.mjs --restore --manifest /absolute/path/to/manifest.json
```

Use the same `--app` option used for preparation when targeting a nondefault bundle. After installation, `--check --manifest /absolute/path/to/manifest.json` verifies the owned patched archive and reports `state: "installed"` without writing; it also recognizes the original archive after restore. Checking a patched archive requires its manifest because the original plist declaration remains unchanged. Apply and restore validate the immutable backup and staged archive, current identity/metadata/fuses/unpacked files, permissions and process metadata before writing. They write a unique regular temporary file beside the target archive, preserve its original mode/ownership, sync it, recheck the target and backup hashes and running processes, and atomically replace only the archive. The app directory is never renamed. A successful mutation adds a unique receipt beside the manifest. A failed pre-replacement operation may leave its uniquely named temporary archive for inspection; the installer does not recursively delete staging directories.

Restore is deliberately narrow: the current archive must equal this manifest's **owned patched full SHA256**. An updater, external patch, manual edit, already-restored archive or other unexpected current bytes cause refusal. Keep the manifest and original backup together. Do not edit their paths or hashes to force a restore. A new Desktop build requires a separately reviewed allowlist and preparation. A preparation directory containing `SUPERSEDED.json` is refused; retain obsolete archives for review and use the replacement manifest.

The archive transform preserves the complete old payload and all original entries, links, empty directories, unpacked markers and untouched metadata. It appends replacements for only `lib/main.js` and `lib/preload-app.cjs`, plus the four modules under `lib/dsh-browser-bridge/`. Packed offsets remain relative to the re-encoded ASAR header; unpacked companions remain in place and must still match their preparation hashes. Static ESM import and closure-local installation use exact, unique host anchors. The existing product window uses `sandbox: true`: its preload cannot load relative CJS modules. The installer therefore statically inlines the exact trusted CJS factory inside a lexical CommonJS wrapper before the existing browser factory, and adds `network: __dshBrowserNetworkFactory(electron.ipcRenderer)` to the returned bridge. It uses no dynamic evaluation or local-module require. The original CJS module is also copied to the archive for review, and the manifest records `preloadStrategy: "inline-cjs-factory-v1"`. Installation failure is logged while host startup continues; the bridge payload supplies its own installation cleanup.

The installer never changes a profile, updater path, CLI path, Electron fuse, Info.plist or code signature. This supported build declares ASAR hashes in Info.plist while runtime integrity enforcement is disabled. The original declaration is checked before apply and retained; apply/restore recheck it against the recorded original header. Preparation and syntax checks do not establish macOS code-signing acceptance, successful host loading, debugger integration or live page behavior. These require separate Desktop validation after a user-controlled close/install/start cycle.

Scoped installer verification uses temporary fake bundles and archives, never the installed app:

```sh
node --test test/desktop-bridge-patch.test.mjs
```
