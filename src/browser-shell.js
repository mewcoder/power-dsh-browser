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
    close: 'm7 7 10 10M17 7 7 17', plus: 'M12 5v14M5 12h14', home: 'm3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3', arrow: 'M5 12h14m-6-6 6 6-6 6',
    search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    stop: 'M6 6h12v12H6z', cursor: 'm5 3 15 9-7 2-3 7-5-18Z', more: 'M5 12h.01M12 12h.01M19 12h.01',
    check: 'm5 12 4 4L19 6', info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    comment: 'M21 11a9 9 0 0 1-9 9H5l-3 2V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    edit: 'm14 4 6 6M4 20l5-1L21 7l-6-6L3 13l1 7Z',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props }, h('path', { d: paths[name] || paths.globe }));
}
// Tab/toolbar/address rules adapted from Nono-neko/dsh-browser's Apache-2.0
// panel.module.css. All selectors below belong to this panel; no shell takeover.
export const shellCss = `
[data-dsh-agent-browser]{--ab-bg:var(--dsw-alias-bg-base,#fff);--ab-layer:var(--dsw-alias-bg-layer-1,#f7f8fa);--ab-quiet:var(--dsw-alias-bg-layer-2,#eef0f4);--ab-text:var(--dsw-alias-label-primary,#1f2329);--ab-muted:var(--dsw-alias-label-secondary,#68717d);--ab-border:var(--dsw-alias-border-l3,#e8eaee);--ab-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--ab-hover:var(--dsw-alias-interactive-bg-hover,rgba(110,120,140,.1));display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;background:var(--ab-bg);color:var(--ab-text);font:13px var(--dsw-font-family,system-ui,sans-serif);isolation:isolate;overflow:hidden}
[data-dsh-agent-browser] *{box-sizing:border-box}
[data-dsh-agent-browser] button,[data-dsh-agent-browser] input{font:inherit}
[data-dsh-agent-browser] button{color:inherit;cursor:pointer}
[data-dsh-agent-browser] button:disabled{opacity:.35;cursor:default}
[data-dsh-agent-browser] button:focus-visible,[data-dsh-agent-browser] input:focus-visible{outline:2px solid var(--ab-accent);outline-offset:2px}
[data-dsh-agent-browser] .ab-tabs{display:flex;align-items:center;gap:4px;flex:none;padding:6px 8px 0;background:var(--ab-layer);border-bottom:1px solid var(--ab-border);min-height:40px}
[data-dsh-agent-browser] .ab-tabscroll{display:flex;align-items:center;gap:3px;min-width:0;overflow-x:auto;scrollbar-width:thin;flex:1}
[data-dsh-agent-browser] .ab-tab{display:flex;align-items:center;gap:7px;min-width:90px;max-width:180px;flex:1 1 130px;height:32px;padding:0 7px 0 10px;border-radius:9px 9px 0 0;background:transparent;color:var(--ab-muted);border:1px solid transparent;border-bottom:0;position:relative}
[data-dsh-agent-browser] .ab-tab:hover{background:var(--ab-hover);color:var(--ab-text)}
[data-dsh-agent-browser] .ab-tab[data-active=true]{background:var(--ab-bg);color:var(--ab-text);border-color:var(--ab-border);font-weight:500}
[data-dsh-agent-browser] .ab-tab-label{border:0;background:none;padding:0;display:flex;align-items:center;gap:7px;min-width:0;flex:1;height:100%;text-align:left}
[data-dsh-agent-browser] .ab-tab-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
[data-dsh-agent-browser] .ab-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--ab-muted);flex:none}
[data-dsh-agent-browser] .ab-close:hover{background:var(--ab-hover);color:var(--ab-text)}
[data-dsh-agent-browser] .ab-icon{display:inline-flex;align-items:center;justify-content:center;width:29px;height:29px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--ab-muted);flex:none}
[data-dsh-agent-browser] .ab-icon:hover:not(:disabled){background:var(--ab-hover);color:var(--ab-text)}
[data-dsh-agent-browser] .ab-toolbar{display:flex;align-items:center;gap:2px;padding:8px;flex:none;position:relative;border-bottom:1px solid var(--ab-border);min-width:0}
[data-dsh-agent-browser] .ab-address{display:flex;align-items:center;gap:6px;flex:1;min-width:50px;height:32px;margin:0 4px;padding:0 8px 0 10px;border:1px solid transparent;border-radius:18px;background:var(--ab-quiet);color:var(--ab-muted)}
[data-dsh-agent-browser] .ab-address:focus-within{background:var(--ab-bg);border-color:var(--ab-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ab-accent) 12%,transparent)}
[data-dsh-agent-browser] .ab-address input{width:100%;min-width:0;flex:1;padding:0;background:transparent;border:0;outline:none;color:var(--ab-text);font-size:12px;height:28px}
[data-dsh-agent-browser] .ab-address input:focus-visible{outline:0}
[data-dsh-agent-browser] .ab-address .ab-go{display:none;width:22px;height:22px}
[data-dsh-agent-browser] .ab-address:focus-within .ab-go{display:inline-flex}
[data-dsh-agent-browser] .ab-progress{position:absolute;height:2px;background:var(--ab-accent);left:0;bottom:-1px;width:30%;animation:ab-loading 1.4s ease-in-out infinite}
[data-dsh-agent-browser] .ab-viewport{position:relative;flex:1;min-height:160px;min-width:0;overflow:hidden;background:var(--ab-bg)}
[data-dsh-agent-browser] .ab-page{position:absolute;inset:0;display:flex;min-height:0;min-width:0}
[data-dsh-agent-browser] .ab-start{position:absolute;inset:0;z-index:2;background:var(--ab-bg);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
[data-dsh-agent-browser] .ab-start-inner{max-width:440px;width:100%;text-align:center;padding-bottom:8vh}
[data-dsh-agent-browser] .ab-start-mark{width:64px;height:64px;display:flex;align-items:center;justify-content:center;border:1px solid var(--ab-border);border-radius:20px;background:var(--ab-layer);color:var(--ab-accent);margin:0 auto 22px;box-shadow:0 6px 20px rgba(20,30,60,.035)}
[data-dsh-agent-browser] .ab-start h2{margin:0 0 8px;font-size:23px;font-weight:560;letter-spacing:-.6px}
[data-dsh-agent-browser] .ab-start p{margin:0 auto 24px;color:var(--ab-muted);font-size:13px;line-height:1.6;max-width:330px}
[data-dsh-agent-browser] .ab-start-search{height:44px;padding:0 8px 0 14px;margin-bottom:22px;background:var(--ab-layer);border:1px solid var(--ab-border);border-radius:14px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 6px rgba(20,30,60,.025)}
[data-dsh-agent-browser] .ab-start-search:focus-within{border-color:var(--ab-accent)}
[data-dsh-agent-browser] .ab-start-search input{flex:1;min-width:0;background:none;border:0;color:var(--ab-text);outline:0;height:40px;font-size:13px}
[data-dsh-agent-browser] .ab-shortcuts{display:flex;justify-content:center;gap:12px}
[data-dsh-agent-browser] .ab-shortcut{border:0;background:transparent;display:flex;align-items:center;flex-direction:column;gap:8px;min-width:72px;padding:8px;border-radius:12px;font-size:11px;color:var(--ab-muted)}
[data-dsh-agent-browser] .ab-shortcut:hover{background:var(--ab-hover)}
[data-dsh-agent-browser] .ab-shortcut b{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid var(--ab-border);border-radius:13px;background:var(--ab-layer);font-size:16px;color:var(--ab-text)}
[data-dsh-agent-browser] .ab-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;padding:4px 10px;border-top:1px solid var(--ab-border);font-size:11px;color:var(--ab-muted);flex:none}
[data-dsh-agent-browser] .ab-status{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-dsh-agent-browser] .ab-dot{width:6px;height:6px;border-radius:50%;background:#63a585;flex:none}
[data-dsh-agent-browser] .ab-agent{display:inline-flex;align-items:center;gap:6px;color:var(--ab-accent)}
[data-dsh-agent-browser] .ab-stop{border:0;background:color-mix(in srgb,var(--ab-accent) 9%,transparent);color:var(--ab-accent);border-radius:6px;font-size:11px;display:flex;align-items:center;gap:4px;padding:3px 6px}
[data-dsh-agent-browser] .ab-session{border:0;background:none;color:var(--ab-muted);padding:2px;display:flex;align-items:center;gap:5px;font-size:11px}
[data-dsh-agent-browser] .ab-error{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--ab-border);color:var(--dsw-alias-state-error-primary,#b34646);background:var(--ab-layer);font-size:12px}
[data-dsh-agent-browser] .ab-error span{flex:1;min-width:0;overflow-wrap:anywhere}
[data-dsh-agent-browser] .ab-info{background:var(--ab-layer);padding:10px 12px;font-size:11px;line-height:1.7;border-top:1px solid var(--ab-border);overflow-wrap:anywhere;color:var(--ab-muted)}
[data-dsh-agent-browser] .ab-agent-badge{position:absolute;right:12px;top:52px;z-index:2147483001;pointer-events:none;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--ab-accent) 14%,var(--ab-bg));color:var(--ab-accent);border:1px solid color-mix(in srgb,var(--ab-accent) 40%,transparent);font-size:12px;font-weight:600}
[data-dsh-agent-browser] .ab-agent-cursor{position:absolute;z-index:2147483000;pointer-events:none;width:30px;height:31px;margin:-4px 0 0 -5px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35)) drop-shadow(0 0 5px color-mix(in srgb,var(--ab-accent) 55%,transparent));transition:left .12s ease-out,top .12s ease-out;will-change:left,top}
[data-dsh-agent-browser] .ab-click-marker{position:absolute;z-index:10;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border:2px solid var(--ab-accent);border-radius:50%;background:color-mix(in srgb,var(--ab-accent) 12%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--ab-accent) 8%,transparent);animation:ab-click .8s ease-out forwards}
[data-dsh-agent-browser] .ab-spinner{animation:ab-spin 1s linear infinite}
@keyframes ab-spin{to{transform:rotate(360deg)}}
@keyframes ab-loading{0%{left:0;width:0}50%{left:30%;width:40%}100%{left:100%;width:0}}
@keyframes ab-click{from{transform:scale(.7);opacity:1}to{transform:scale(1.5);opacity:0}}
@media(prefers-reduced-motion:reduce){[data-dsh-agent-browser] .ab-spinner,[data-dsh-agent-browser] .ab-progress{animation:none}[data-dsh-agent-browser] .ab-click-marker{animation:none;opacity:.6}}
`;

const annotationCopy = {
  zh: { title: '正在批注', review: '查看全部批注', pick: '继续选择元素', pause: '暂停选择', hide: '隐藏标记', show: '显示标记', clear: '清空批注', exit: '退出批注', add: '加入会话', adding: '正在加入…', empty: '选择网页元素，写下意见并保存。可连续添加多条，再一起加入会话。', comment: '你的意见', placeholder: '希望这里如何调整？', save: '保存并继续', cancel: '取消', edit: '编辑批注', remove: '删除批注', close: '关闭编辑', copy: '复制汇总', saved: '条已保存', source: '捕获自', pending: '请先保存或取消当前意见。', published: '已发布给当前会话，Agent 可读取这一批次。', inserted: '已加入当前会话引用，请审核后发送。', textFallback: '已加入简短批注引用文字；当前环境未提供引用片接口。', failed: '操作未完成，批注已保留，可以重试。', limit: '已达到批注数量或内容预算，请删除部分内容后重试。', required: '请写下意见后保存。', copied: '批注汇总已复制。', copyFailed: '无法访问剪贴板。可逐条查看并手动复制意见。' },
  en: { title: 'Annotating', review: 'Review annotations', pick: 'Select another element', pause: 'Pause selection', hide: 'Hide markers', show: 'Show markers', clear: 'Clear annotations', exit: 'Exit annotations', add: 'Add to conversation', adding: 'Adding…', empty: 'Select a page element, write your feedback and save. Collect several annotations before adding them to the conversation.', comment: 'Your feedback', placeholder: 'What would you like to change?', save: 'Save and continue', cancel: 'Cancel', edit: 'Edit annotation', remove: 'Delete annotation', close: 'Close editor', copy: 'Copy summary', saved: 'saved', source: 'Captured from', pending: 'Save or cancel the current edit first.', published: 'Published to this conversation. The Agent can read this batch.', inserted: 'Added as a conversation reference. Review it before sending.', textFallback: 'Added a short annotation reference. The chip interface is unavailable.', failed: 'Could not complete the action. Your annotations are retained for retry.', limit: 'Annotation count or content budget reached. Remove some content and retry.', required: 'Write your feedback before saving.', copied: 'Annotation summary copied.', copyFailed: 'Clipboard unavailable. Review each comment and copy it manually.' },
};
/** Review/edit is a compact viewport popover, without resizing the guest. */
