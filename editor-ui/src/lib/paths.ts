export const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
export const bookOf = (p: string) => p.split("/")[0];
export const IMG = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "untitled";

/** Relative path from a directory to a content file, for Markdown links. */
export function relFrom(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  return "../".repeat(a.length) + b.join("/");
}

export const mdLink = (target: string, label: string, image: boolean) => `${image ? "!" : ""}[${label}](${encodeURI(target)})`;

export const yamlTitle = (t: string) => (/[:#'"{}[\],&*!|>%@`]/.test(t) ? JSON.stringify(t) : t);

export const pageSkeleton = (title: string, index: boolean) =>
  index ? `---\ntitle: ${yamlTitle(title)}\n---\n` : `---\ntitle: ${yamlTitle(title)}\naliases: []\n---\n\n## Overview\n\n- \n`;
