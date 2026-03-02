/**
 * markdownRenderer.ts
 *
 * Extends `marked` with:
 *  - Callout blocks  (GitHub-style alerts: > [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT], > [!CAUTION])
 *  - Toggle blocks   (> [!TOGGLE] Title  →  <details><summary>Title</summary>…)
 *  - KaTeX math      ($$…$$ block, $…$ inline)
 *  - Wiki-links      ([[Page Title]] → clickable span with data-wikilink)
 */

import { marked, type Renderer } from 'marked';
import katex from 'katex';

// ── KaTeX helpers ────────────────────────────────────────────────────────────

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return `<code class="katex-error">${tex}</code>`;
  }
}

/**
 * Pre-process the markdown source to protect KaTeX from marked's own parsing.
 * We encode $…$ and $$…$$ into placeholder tokens, then restore them after
 * marked has processed everything.
 */
const MATH_PLACEHOLDER_PREFIX = '\x00MATH';
const mathStore: string[] = [];

function extractMath(src: string): string {
  mathStore.length = 0;

  // Block math: $$…$$
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex) => {
    const idx = mathStore.length;
    mathStore.push(renderKatex(tex.trim(), true));
    return `${MATH_PLACEHOLDER_PREFIX}BLOCK${idx}\x00`;
  });

  // Inline math: $…$  (not preceded by $)
  src = src.replace(/(?<!\$)\$([^$\n]+?)\$/g, (_match, tex) => {
    const idx = mathStore.length;
    mathStore.push(renderKatex(tex.trim(), false));
    return `${MATH_PLACEHOLDER_PREFIX}INLINE${idx}\x00`;
  });

  return src;
}

function restoreMath(html: string): string {
  return html.replace(
    new RegExp(`${MATH_PLACEHOLDER_PREFIX}(?:BLOCK|INLINE)(\\d+)\x00`, 'g'),
    (_match, idx) => mathStore[Number(idx)] ?? '',
  );
}

// ── Callout / Toggle config ──────────────────────────────────────────────────

const CALLOUT_TYPES: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  NOTE:      { icon: 'ℹ️', color: '#2383e2', bg: '#ebf3fd', border: '#c0d9f7' },
  TIP:       { icon: '💡', color: '#0a7a4c', bg: '#e4f5ed', border: '#a8dfc5' },
  WARNING:   { icon: '⚠️', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
  IMPORTANT: { icon: '📌', color: '#7c3aed', bg: '#f0ebfe', border: '#c4b5fd' },
  CAUTION:   { icon: '🔥', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
};

// ── Custom blockquote renderer ───────────────────────────────────────────────

function buildRenderer(): Partial<Renderer> {
  return {
    blockquote(quote: string) {
      const inner = quote;

      // Detect alert tag on first line: [!TYPE] or [!TOGGLE] Title
      const tagMatch = inner.match(/^<p>\[!([\w]+)\]([^\n<]*)/i);
      if (!tagMatch) return `<blockquote>${inner}</blockquote>`;

      const type = tagMatch[1].toUpperCase();
      const titleRest = tagMatch[2].trim();

      // Strip the first-line tag from body
      const body = inner.replace(/^<p>\[![\w]+\][^\n<]*(<br\s*\/?>)?/, '<p>').replace(/^<p><\/p>/, '');

      // Toggle (details/summary)
      if (type === 'TOGGLE') {
        const title = titleRest || '詳細內容';
        return `
<details class="editor-toggle">
  <summary class="editor-toggle__summary">${title}</summary>
  <div class="editor-toggle__body">${body}</div>
</details>`;
      }

      // Callout
      const cfg = CALLOUT_TYPES[type];
      if (!cfg) return `<blockquote>${inner}</blockquote>`;

      const label = type.charAt(0) + type.slice(1).toLowerCase();
      return `
<div class="editor-callout" style="--callout-color:${cfg.color};--callout-bg:${cfg.bg};--callout-border:${cfg.border}">
  <div class="editor-callout__title">
    <span class="editor-callout__icon">${cfg.icon}</span>
    <span class="editor-callout__label">${label}</span>
  </div>
  <div class="editor-callout__body">${body}</div>
</div>`;
    },
  };
}

// ── Wiki-links ([[Page Title]]) ──────────────────────────────────────────────

/**
 * Replace [[Title]] with a clickable span.
 * The consumer attaches a click handler via event delegation on `data-wikilink`.
 */
function processWikiLinks(html: string): string {
  return html.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, title) =>
      `<span class="wikilink" data-wikilink="${encodeURIComponent(title.trim())}" title="跳至：${title.trim()}">${title.trim()}</span>`,
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Render markdown → HTML with Callout, Toggle, KaTeX, and Wiki-link support. */
export function renderMarkdown(source: string): string {
  const preprocessed = extractMath(source);
  const renderer = buildRenderer();
  const rawHtml = marked(preprocessed, { renderer: renderer as Renderer, breaks: true, gfm: true }) as string;
  const withMath = restoreMath(rawHtml);
  return processWikiLinks(withMath);
}
