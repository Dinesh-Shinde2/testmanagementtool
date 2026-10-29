/** Extract Azure work item id when bug_id looks like a number (plain or trailing digits). */
export function azureWorkItemId(bugId?: string | null): string | null {
  const raw = (bugId || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d{4,})\s*$/);
  return match ? match[1] : null;
}

export function azureWorkItemUrl(template: string | null | undefined, bugId?: string | null): string | null {
  const id = azureWorkItemId(bugId);
  if (!id || !template) return null;
  if (!template.includes("{id}")) return null;
  return template.replaceAll("{id}", id);
}

/** Soft validation hint — empty OK; non-empty should be numeric / Azure id-like. */
export function azureBugIdHint(bugId?: string | null): string | null {
  const raw = (bugId || "").trim();
  if (!raw) return null;
  if (azureWorkItemId(raw)) return null;
  return "Use Azure work item number (digits) to enable Open in Azure.";
}
