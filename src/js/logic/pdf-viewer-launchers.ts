export const PDF_VIEWER_PAGE_ID = 'view-pdf';

export type ViewerTool = {
  id: string;
  name: string;
  href: string;
  icon: string;
};

type CatalogTool = {
  id?: string;
  name: string;
  href: string;
  icon: string;
};

type CatalogCategory = {
  tools: readonly CatalogTool[];
};

function toolIdFromHref(href: string): string {
  const match = href.match(/\/([^/]+)\.html$/);
  return match?.[1] ?? href;
}

/**
 * Unique catalog tools in first-seen order, excluding the viewer itself and
 * any disabled tools. Favorites pin from this set; everything else goes in
 * the More tools menu.
 */
export function listCatalogTools(
  categories: readonly CatalogCategory[],
  options: {
    excludeIds?: readonly string[];
    isDisabled?: (toolId: string) => boolean;
  } = {}
): ViewerTool[] {
  const exclude = new Set(options.excludeIds ?? [PDF_VIEWER_PAGE_ID]);
  const isDisabled = options.isDisabled ?? (() => false);
  const tools: ViewerTool[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    for (const tool of category.tools) {
      const id = tool.id ?? toolIdFromHref(tool.href);
      if (!id || seen.has(id) || exclude.has(id) || isDisabled(id)) continue;
      seen.add(id);
      tools.push({
        id,
        name: tool.name,
        href: tool.href,
        icon: tool.icon,
      });
    }
  }

  return tools;
}

export function partitionPinnedTools(
  tools: readonly ViewerTool[],
  favoriteIds: readonly string[]
): { pinned: ViewerTool[]; more: ViewerTool[] } {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const pinned: ViewerTool[] = [];
  const pinnedIds = new Set<string>();

  for (const favoriteId of favoriteIds) {
    const tool = byId.get(favoriteId);
    if (!tool || pinnedIds.has(tool.id)) continue;
    pinned.push(tool);
    pinnedIds.add(tool.id);
  }

  return {
    pinned,
    more: tools.filter((tool) => !pinnedIds.has(tool.id)),
  };
}
