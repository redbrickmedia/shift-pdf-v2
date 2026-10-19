export interface AppConfig {
  disabledTools?: string[];
  editorDisabledCategories?: string[];
}

export type ToolCardinality = 'single' | 'dual' | 'batch';

export interface CatalogEntry {
  id: string;
  surface: string;
  href: string;
  cardinality: ToolCardinality;
  name: string;
  icon: string;
  subtitle: string;
}

export interface ToolCategory {
  name: string;
  tools: CatalogEntry[];
}

export interface LaunchContext {
  surfaceId: string;
  entryId: string;
  entry: CatalogEntry | null;
  canonicalEntry: CatalogEntry | null;
  isConsolidatedEntry: boolean;
  name: string;
  subtitle: string;
  icon: string;
  accept: string;
  cardinality: ToolCardinality;
  multiple: boolean;
}

export interface FavoriteRailPin {
  name: string;
  href: string;
  icon: string;
}
