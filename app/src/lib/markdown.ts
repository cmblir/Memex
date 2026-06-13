// Markdown renderer. Adds a custom inline rule for [[wikilinks]] that emits
// `<a data-link="target">display</a>` so the renderer can hand off click
// resolution to the application layer.

import MarkdownIt from "markdown-it";
import { escapeHtml } from "./wikilinks";

interface InlineState {
  src: string;
  pos: number;
  push(type: string, tag: string, nesting: number): InlineToken;
}

interface InlineToken {
  content: string;
  attrSet(name: string, value: string): void;
}

const WIKILINK_OPEN = "[[";
const WIKILINK_CLOSE = "]]";

function wikilinkRule(state: InlineState, silent: boolean): boolean {
  if (state.src.slice(state.pos, state.pos + 2) !== WIKILINK_OPEN) {
    return false;
  }
  const closeIndex = state.src.indexOf(WIKILINK_CLOSE, state.pos + 2);
  if (closeIndex === -1) return false;

  const inner = state.src.slice(state.pos + 2, closeIndex);
  if (!inner || inner.includes("\n")) return false;

  const pipeIndex = inner.indexOf("|");
  const target = (pipeIndex === -1 ? inner : inner.slice(0, pipeIndex)).trim();
  const display = (
    pipeIndex === -1 ? inner : inner.slice(pipeIndex + 1)
  ).trim();
  if (!target) return false;

  if (!silent) {
    const token = state.push("wikilink", "a", 0);
    token.attrSet("data-link", target);
    token.attrSet("class", "memex-wikilink");
    token.content = display || target;
  }

  state.pos = closeIndex + 2;
  return true;
}

export function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
  });

  md.inline.ruler.before("link", "wikilink", wikilinkRule);
  md.renderer.rules.wikilink = (tokens, idx) => {
    const token = tokens[idx];
    const target = token.attrGet("data-link") ?? "";
    const display = token.content;
    return `<a data-link="${escapeHtml(target)}" class="memex-wikilink" href="#">${escapeHtml(display)}</a>`;
  };

  // Mark external links (incl. linkified bare URLs) so the Viewer can open them
  // in the OS browser via ipc.openExternal instead of navigating the Tauri
  // webview away from the single-page app.
  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    const href = token.attrGet("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      token.attrSet("data-external", href);
      token.attrSet("rel", "noopener noreferrer");
      token.attrSet("target", "_blank");
    }
    return self.renderToken(tokens, idx, options);
  };

  return md;
}

export const markdownRenderer = createRenderer();
