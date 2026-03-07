export const CATEGORIES = ["people", "projects", "tasks", "ideas", "reference"];

export const CATEGORY_LABELS: Record<string, string> = {
  people: "People",
  projects: "Projects",
  tasks: "Tasks",
  ideas: "Ideas",
  reference: "Reference",
};

export const CATEGORY_FIELDS: Record<string, string[]> = {
  people: ["context", "follow_ups"],
  projects: ["status", "next_action", "notes"],
  tasks: ["due_date", "status", "notes"],
  ideas: ["oneliner", "notes"],
  reference: ["notes"],
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}
