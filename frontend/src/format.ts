/** Display dates only (no time) across the app. */
export function formatDate(value?: string | null) {
  if (!value) return "—";
  const raw = String(value).trim();
  if (!raw) return "—";
  const dateOnly = raw.length <= 10 ? new Date(`${raw.slice(0, 10)}T00:00:00`) : new Date(raw);
  if (Number.isNaN(dateOnly.getTime())) return "—";
  return dateOnly.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
