/** intervals.icu works in the athlete's *local* dates — no timezone suffixes anywhere. */

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(): string {
  return isoDate(new Date());
}

export function daysFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts `2026-08-20` or `2026-08-20T18:30:00` and returns a local ISO datetime. */
export function toLocalDateTime(value: string): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return `${trimmed}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 19);
  throw new Error(`Invalid date "${value}". Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS (local time, no timezone).`);
}

/** The calendar date part, used to look an event back up in a date range. */
export function datePart(localDateTime: string): string {
  return localDateTime.slice(0, 10);
}
