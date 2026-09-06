/** "3m ago" / "2h ago" / "5d ago" — used anywhere a timestamp is shown as
 * a glance-able age rather than a clock time (version history, project
 * switcher, chat message hover). Falls back to a real date past 30 days,
 * since "42d ago" stops being a useful unit at that point. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
