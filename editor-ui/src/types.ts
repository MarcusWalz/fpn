export interface TreeEntry {
  name: string;
  path: string;
  dir?: boolean;
  title?: string;
  stub?: boolean;
  children?: TreeEntry[];
}

export interface Problem {
  path: string;
  message: string;
  find?: string;
  /** Backlinks: the link that replaces `find` when the item is clicked. */
  replace?: string;
}

export interface PreviewResult {
  html: string;
  url: string;
  warnings: string[] | null;
}

export interface FileEntry {
  path: string;
  title: string;
  /** The page's site URL, e.g. "/endocrinology/diabetes-mellitus/". */
  url: string;
}

export interface CritiqueResult {
  markdown?: string;
  html?: string;
  when?: string;
  cached?: boolean;
}

export interface RefEntry {
  key: string;
  label: string;
}
