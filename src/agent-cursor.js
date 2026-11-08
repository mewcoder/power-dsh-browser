import React from 'react';
import { AGENT_CURSOR } from './cursor-asset.js';

const h = React.createElement;

/**
 * Pointer overlay shown while the Agent drives the page. It is drawn in the
 * plugin's own viewport, never inside the guest document, so no page script or
 * style is injected to render it.
 */
export function AgentCursor({ point, visible }) {
  if (!visible || !point) return null;
  return h('div', {
    className: 'ab-agent-cursor',
    style: { left: point.x, top: point.y },
    'aria-hidden': true,
  }, h('img', { src: AGENT_CURSOR, width: 30, height: 31, alt: '', draggable: false }));
}

/** Ripple shown at the exact point of a click/fill so the action is legible. */
export function ClickMarker({ marker }) {
  if (!marker) return null;
  return h('div', {
    key: marker.key,
    className: 'ab-click-marker',
    style: { left: marker.x, top: marker.y },
    'aria-hidden': true,
  });
}
