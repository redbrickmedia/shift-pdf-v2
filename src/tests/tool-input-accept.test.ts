import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRUNED_TOOL_IDS, PRUNED_TOOL_ID_SET } from '../js/config/tools';
import { TOOL_INPUT_ACCEPT } from '../js/logic/tool-input-accept';

const pagesDir = resolve(__dirname, '../pages');

function acceptNear(html: string, idAt: number): string | null {
  const start = html.lastIndexOf('<input', idAt);
  const end = html.indexOf('>', idAt);
  if (start < 0 || end < 0) return null;
  const accept = html.slice(start, end + 1).match(/\baccept=["']([^"']*)["']/i);
  return accept ? accept[1] : null;
}

function primaryAccept(html: string): string | null {
  const named = html.search(/\bid=["']file-input["']/i);
  if (named >= 0) return acceptNear(html, named);
  const fileInput = html.search(/<input\b[^>]*type=["']file["']/i);
  if (fileInput < 0) return null;
  const idAt = html.indexOf('accept=', fileInput);
  if (idAt < 0 || idAt > html.indexOf('>', fileInput)) return null;
  return acceptNear(html, idAt);
}

describe('tool input accept map', () => {
  it('matches each active tool page primary file input and excludes pruned tools', () => {
    const mismatches: string[] = [];
    const seen = new Set<string>();

    for (const name of readdirSync(pagesDir)) {
      if (!name.endsWith('.html')) continue;
      const id = name.replace(/\.html$/, '');
      if (PRUNED_TOOL_ID_SET.has(id)) continue;
      const html = readFileSync(resolve(pagesDir, name), 'utf8');
      const accept = primaryAccept(html);
      if (accept === null) continue;
      seen.add(id);
      const mapped = TOOL_INPUT_ACCEPT[id];
      if (mapped !== accept) {
        mismatches.push(
          `${id}: map=${JSON.stringify(mapped)} page=${JSON.stringify(accept)}`
        );
      }
    }

    const extra = Object.keys(TOOL_INPUT_ACCEPT).filter((id) => !seen.has(id));
    expect(mismatches).toEqual([]);
    expect(extra).toEqual([]);
    for (const prunedId of PRUNED_TOOL_IDS) {
      expect(TOOL_INPUT_ACCEPT).not.toHaveProperty(prunedId);
    }
  });
});
