import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  categories,
  PRUNED_TOOL_IDS,
  PRUNED_TOOL_ID_SET,
} from '../js/config/tools';
import {
  acceptForToolId,
  TOOL_INPUT_ACCEPT,
} from '../js/logic/tool-input-accept';

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
  it('matches each canonical Tool Surface primary file input and covers every Catalog Entry without pruned IDs', () => {
    const mismatches: string[] = [];

    for (const name of readdirSync(pagesDir)) {
      if (!name.endsWith('.html')) continue;
      const surfaceId = name.replace(/\.html$/, '');
      if (PRUNED_TOOL_ID_SET.has(surfaceId)) continue;
      const html = readFileSync(resolve(pagesDir, name), 'utf8');
      const accept = primaryAccept(html);
      if (accept === null) continue;
      const mapped = acceptForToolId(surfaceId);
      if (mapped !== accept) {
        mismatches.push(
          `${surfaceId}: map=${JSON.stringify(mapped)} page=${JSON.stringify(accept)}`
        );
      }
    }

    expect(mismatches).toEqual([]);

    const expectedCatalogEntryIds = new Set<string>(['view-pdf']);
    for (const category of categories) {
      for (const tool of category.tools) {
        if (tool.id === 'pdf-converter') continue;
        expectedCatalogEntryIds.add(tool.id);
      }
    }

    const mappedIds = new Set(Object.keys(TOOL_INPUT_ACCEPT));
    const missingFromAcceptMap = [...expectedCatalogEntryIds].filter(
      (id) => !mappedIds.has(id)
    );
    const extraInAcceptMap = [...mappedIds].filter(
      (id) => !expectedCatalogEntryIds.has(id)
    );

    expect(missingFromAcceptMap).toEqual([]);
    expect(extraInAcceptMap).toEqual([]);

    for (const prunedId of PRUNED_TOOL_IDS) {
      expect(TOOL_INPUT_ACCEPT).not.toHaveProperty(prunedId);
    }
  });
});
