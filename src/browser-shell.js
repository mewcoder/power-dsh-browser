import React from 'react';
import { httpUrl } from './protocol.js';
const h = React.createElement;
export function addressUrl(value) {
  const text = value.trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return httpUrl(text);
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:\/|$)/i.test(text)) return httpUrl(`http://${text}`);
  if (/^[\w-]+(?:\.[\w-]+)+(?:\:\d+)?(?:\/|$)/i.test(text)) return httpUrl(`https://${text}`);
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return httpUrl(text);
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
export function Icon({ name, size = 16, ...props }) {
  const paths = {
    back: 'm14 5-7 7 7 7', forward: 'm10 5 7 7-7 7', reload: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6M20 7l-2-2',
    close: 'm7 7 10 10M17 7 7 17', plus: 'M12 5v14M5 12h14', external: 'M7 17 17 7M7 7h10v10',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3', arrow: 'M5 12h14m-6-6 6 6-6 6',
    stop: 'M6 6h12v12H6z', info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props }, h('path', { d: paths[name] || paths.globe }));
}
// Visual language aligned with the DSH built-in sidebar browser (token-level
// reference only: public --dsw-alias variables, no copied stylesheet). Earlier
// rules were adapted from Nono-neko/dsh-browser's Apache-2.0 panel.module.css;
// the tab/toolbar rules below were rewritten for this alignment. All selectors
// belong to this panel; no shell takeover.
export const shellCss = `
[data-power-dsh-browser]{--ab-bg:var(--dsw-alias-bg-base,#fff);--ab-layer:var(--dsw-alias-bg-layer-1,#f7f8fa);--ab-quiet:var(--dsw-alias-bg-layer-2,#eef0f4);--ab-text:var(--dsw-alias-label-primary,#1f2329);--ab-muted:var(--dsw-alias-label-secondary,#68717d);--ab-border:var(--dsw-alias-border-l3,#e8eaee);--ab-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--ab-hover:var(--dsw-alias-interactive-bg-hover,rgba(110,120,140,.1));display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;background:var(--ab-bg);color:var(--ab-text);font:13px var(--dsw-font-family,system-ui,sans-serif);isolation:isolate;overflow:hidden}
[data-power-dsh-browser] *{box-sizing:border-box}
[data-power-dsh-browser] button,[data-power-dsh-browser] input{font:inherit}
[data-power-dsh-browser] button{color:inherit;cursor:pointer}
[data-power-dsh-browser] button:disabled{opacity:.35;cursor:default}
[data-power-dsh-browser] button:focus-visible,[data-power-dsh-browser] input:focus-visible{outline:2px solid var(--ab-accent);outline-offset:2px}
[data-power-dsh-browser] .ab-tabs{display:flex;align-items:center;gap:4px;flex:none;padding:6px 8px;background:var(--ab-bg);min-height:42px}
[data-power-dsh-browser] .ab-tabscroll{display:flex;align-items:center;gap:3px;min-width:0;overflow-x:auto;scrollbar-width:thin;flex:1}
[data-power-dsh-browser] .ab-tab{display:flex;align-items:center;gap:7px;min-width:80px;max-width:180px;flex:0 1 160px;height:30px;padding:0 6px 0 10px;border-radius:10px;background:transparent;color:var(--ab-muted);border:1px solid transparent;position:relative}
[data-power-dsh-browser] .ab-tab:hover{background:var(--ab-hover);color:var(--ab-text)}
[data-power-dsh-browser] .ab-tab[data-active=true]{background:var(--ab-quiet);color:var(--ab-text);font-weight:500}
[data-power-dsh-browser] .ab-tab-label{border:0;background:none;padding:0;display:flex;align-items:center;gap:7px;min-width:0;flex:1;height:100%;text-align:left}
[data-power-dsh-browser] .ab-tab-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
[data-power-dsh-browser] .ab-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--ab-muted);flex:none}
[data-power-dsh-browser] .ab-close:hover{background:var(--ab-hover);color:var(--ab-text)}
[data-power-dsh-browser] .ab-icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--ab-muted);flex:none}
[data-power-dsh-browser] .ab-icon:hover:not(:disabled){background:var(--ab-hover);color:var(--ab-text)}
[data-power-dsh-browser] .ab-toolbar{display:flex;align-items:center;gap:4px;padding:6px 10px;flex:none;position:relative;border-bottom:1px solid var(--ab-border);min-width:0}
[data-power-dsh-browser] .ab-address{display:flex;align-items:center;gap:8px;flex:1;min-width:50px;height:34px;margin:0 4px;padding:0 8px 0 12px;border:1px solid transparent;border-radius:999px;background:var(--ab-quiet);color:var(--ab-muted)}
[data-power-dsh-browser] .ab-address:focus-within{background:var(--ab-bg);border-color:var(--ab-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ab-accent) 12%,transparent)}
[data-power-dsh-browser] .ab-address input{width:100%;min-width:0;flex:1;padding:0;background:transparent;border:0;outline:none;color:var(--ab-text);font-size:13px;height:30px}
[data-power-dsh-browser] .ab-address input:focus-visible{outline:0}
[data-power-dsh-browser] .ab-address .ab-go{display:none;width:22px;height:22px}
[data-power-dsh-browser] .ab-address:focus-within .ab-go{display:inline-flex}
[data-power-dsh-browser] .ab-progress{position:absolute;height:2px;background:var(--ab-accent);left:0;bottom:-1px;width:30%;animation:ab-loading 1.4s ease-in-out infinite}
[data-power-dsh-browser] .ab-viewport{position:relative;flex:1;min-height:160px;min-width:0;overflow:hidden;background:var(--ab-bg)}
[data-power-dsh-browser] .ab-page{position:absolute;inset:0;display:flex;min-height:0;min-width:0}
[data-power-dsh-browser] .ab-start{position:absolute;inset:0;z-index:2;background:var(--ab-bg);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
[data-power-dsh-browser] .ab-start-inner{max-width:440px;width:100%;text-align:center}
[data-power-dsh-browser] .ab-start-hint{margin:0 0 20px;color:var(--ab-muted);font-size:13px;line-height:1.6}
[data-power-dsh-browser] .ab-shortcuts{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
[data-power-dsh-browser] .ab-shortcut{border:1px solid var(--ab-border);background:var(--ab-layer);display:flex;align-items:center;gap:8px;padding:6px 12px 6px 8px;border-radius:999px;font-size:12px;color:var(--ab-text)}
[data-power-dsh-browser] .ab-shortcut:hover{background:var(--ab-hover)}
[data-power-dsh-browser] .ab-shortcut b{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:var(--ab-quiet);font-size:11px;color:var(--ab-muted)}
[data-power-dsh-browser] .ab-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;padding:4px 10px;border-top:1px solid var(--ab-border);font-size:11px;color:var(--ab-muted);flex:none}
[data-power-dsh-browser] .ab-status{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-power-dsh-browser] .ab-dot{width:6px;height:6px;border-radius:50%;background:#63a585;flex:none}
[data-power-dsh-browser] .ab-agent{display:inline-flex;align-items:center;gap:6px;color:var(--ab-accent)}
[data-power-dsh-browser] .ab-stop{border:0;background:color-mix(in srgb,var(--ab-accent) 9%,transparent);color:var(--ab-accent);border-radius:6px;font-size:11px;display:flex;align-items:center;gap:4px;padding:3px 6px}
[data-power-dsh-browser] .ab-session{border:0;background:none;color:var(--ab-muted);padding:2px;display:flex;align-items:center;gap:5px;font-size:11px}
[data-power-dsh-browser] .ab-error{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--ab-border);color:var(--dsw-alias-state-error-primary,#b34646);background:var(--ab-layer);font-size:12px}
[data-power-dsh-browser] .ab-error span{flex:1;min-width:0;overflow-wrap:anywhere}
[data-power-dsh-browser] .ab-info{background:var(--ab-layer);padding:10px 12px;font-size:11px;line-height:1.7;border-top:1px solid var(--ab-border);overflow-wrap:anywhere;color:var(--ab-muted)}
[data-power-dsh-browser] .ab-agent-badge{position:absolute;right:12px;top:52px;z-index:2147483001;pointer-events:none;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ab-accent) 14%,var(--ab-bg));color:var(--ab-accent);border:1px solid color-mix(in srgb,var(--ab-accent) 40%,transparent);font-size:12px;font-weight:600}
[data-power-dsh-browser] .ab-agent-cursor{position:absolute;z-index:2147483000;pointer-events:none;width:30px;height:31px;margin:-4px 0 0 -5px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35)) drop-shadow(0 0 5px color-mix(in srgb,var(--ab-accent) 55%,transparent));transition:left .12s ease-out,top .12s ease-out;will-change:left,top}
[data-power-dsh-browser] .ab-click-marker{position:absolute;z-index:10;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border:2px solid var(--ab-accent);border-radius:50%;background:color-mix(in srgb,var(--ab-accent) 12%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--ab-accent) 8%,transparent);animation:ab-click .8s ease-out forwards}
[data-power-dsh-browser] .ab-spinner{animation:ab-spin 1s linear infinite}
@keyframes ab-spin{to{transform:rotate(360deg)}}
@keyframes ab-loading{0%{left:0;width:0}50%{left:30%;width:40%}100%{left:100%;width:0}}
@keyframes ab-click{from{transform:scale(.7);opacity:1}to{transform:scale(1.5);opacity:0}}
@media(prefers-reduced-motion:reduce){[data-power-dsh-browser] .ab-spinner,[data-power-dsh-browser] .ab-progress{animation:none}[data-power-dsh-browser] .ab-click-marker{animation:none;opacity:.6}}
`;
