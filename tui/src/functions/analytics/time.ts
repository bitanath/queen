export const DAY_MS = 86_400_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type DateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function resolveTimeZone(timeZone?: string | null): string {
  if (!timeZone) return systemTimeZone();
  try {
    formatter(timeZone); //XXX Throws a RangeError on an invalid zone so we somehow default it lol
    return timeZone;
  } catch {
    return systemTimeZone();
  }
}

export function partsIn(ms: number, timeZone: string = systemTimeZone()): DateParts {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute" || part.type === "second") {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values["year"] ?? 1970,
    month: values["month"] ?? 1,
    day: values["day"] ?? 1,
    hour: values["hour"] ?? 0,
    minute: values["minute"] ?? 0,
    second: values["second"] ?? 0,
  };
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = systemTimeZone(),
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i += 1) {
    const p = partsIn(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = asUtc - guess;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

export function dateKey(ms: number, timeZone: string = systemTimeZone()): string {
  const p = partsIn(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localHour(ms: number, timeZone: string = systemTimeZone()): number {
  return partsIn(ms, timeZone).hour;
}

export function startOfDay(ms: number, timeZone: string = systemTimeZone()): number {
  const p = partsIn(ms, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

export function dayLabel(ms: number, timeZone: string = systemTimeZone()): string {
  const p = partsIn(ms, timeZone);
  return `${MONTHS[p.month - 1] ?? "?"} ${String(p.day).padStart(2, "0")}`;
}

export function clockLabel(ms: number, timeZone: string = systemTimeZone()): string {
  const p = partsIn(ms, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
