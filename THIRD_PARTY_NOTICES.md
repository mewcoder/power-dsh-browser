# PowerDSH Browser — Third-party notices

These notices record third-party sources referenced or adapted by PowerDSH Browser (`power-dsh-browser`). Source repository names, URLs, revisions and license attributions remain the original identifiers; the PowerDSH brand rename does not rename upstream projects or change their licenses.

## Nono-neko/dsh-browser

- Source: https://github.com/Nono-neko/dsh-browser
- Reference revision: `3b30aa740ece9cc2057cb9c81bf1e5df5f1bef3e`
- License: Apache License 2.0; full text in [licenses/Nono-neko-Apache-2.0.txt](licenses/Nono-neko-Apache-2.0.txt).
- Adapted material: scoped browser tab strip, toolbar and address-field styling from `src/client/panel/panel.module.css`, with browser panel and start-page UI used as structural reference.
- Modifications: adapted for DSH's registered right-sidebar surface, plugin-owned Electron guests, local icon controls and theme tokens. The upstream center-column takeover, global layout rules, Puppeteer proxy, file editor and update infrastructure are not incorporated.
- Modified source files carry an adaptation notice. These notices do not imply affiliation with or endorsement by the upstream authors.

## zhxnix/dsh-sidebar-annotations

- Source: https://github.com/zhxnix/dsh-sidebar-annotations
- Reference revision: `c6d04864ee386010359ac73a7e94b67a4a0e1706`
- Copyright (c) 2026 zhxnix.
- License: MIT; full text in [licenses/zhxnix-MIT.txt](licenses/zhxnix-MIT.txt).
- Adapted material: element picking with a transparent capture layer, event suppression, hover feedback and locking the selection until comment editing finishes, originally in `lib/picker.js`.
- Modifications: bounded selection output, per-controller state and cancellation tokens, owned-page lifecycle cleanup, RPC-compatible polling and insertion into the current conversation draft. Upstream profile installers, desktop patching, global conversation DOM hooks and automatic message-send hooks are not incorporated.

## Additional research references

`wqty123/dsh-browser` at `5c5eedcaa2e119b7997088de64ff4b27c16998f2` (MIT) was inspected for action feedback and native-browser behavior. The plugin draws feedback on its own viewport overlay; its desktop bridge and CDP host are not included. Further reference details and actual reuse boundaries are documented in [docs/provenance.md](docs/provenance.md).
