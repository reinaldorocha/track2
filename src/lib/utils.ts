import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
export { formatMetric } from "./metrics";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type DateRange = {
  from: Date;
  to: Date;
  label: string;
};

/**
 * Resolves accurate DateRange for all standard analytics presets.
 * Supports both pt-BR strings and camelCase identifiers.
 */
export function getDateRange(preset: string): DateRange {
  const now = new Date();
  const normalized = (preset || "").trim().toLowerCase();

  // 0. Personalizado / Custom
  if (normalized.startsWith("personalizado") || normalized.startsWith("custom")) {
    const isoMatches = normalized.match(/\d{4}-\d{2}-\d{2}/g);
    if (isoMatches && isoMatches.length >= 2) {
      const d1 = new Date(isoMatches[0] + "T00:00:00");
      const d2 = new Date(isoMatches[1] + "T23:59:59.999");
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        return { from: d1 <= d2 ? d1 : d2, to: d1 <= d2 ? d2 : d1, label: preset };
      }
    }
    const brMatches = normalized.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g);
    if (brMatches && brMatches.length >= 2) {
      const parseBr = (s: string) => {
        const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        return m ? new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00`) : null;
      };
      const d1 = parseBr(brMatches[0]);
      const d2 = parseBr(brMatches[1]);
      if (d1 && d2 && !isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        d2.setHours(23, 59, 59, 999);
        return { from: d1 <= d2 ? d1 : d2, to: d1 <= d2 ? d2 : d1, label: preset };
      }
    }
    return { from: startOfDay(now), to: endOfDay(now), label: preset || "Personalizado" };
  }

  // 1. Hoje
  if (normalized === "hoje" || normalized === "today") {
    return { from: startOfDay(now), to: endOfDay(now), label: "Hoje" };
  }

  // 2. Ontem
  if (normalized === "ontem" || normalized === "yesterday") {
    const yesterday = subDays(now, 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday), label: "Ontem" };
  }

  // 3. Últimos 7 dias
  if (normalized === "últimos 7 dias" || normalized === "ultimos 7 dias" || normalized === "last 7 days" || normalized === "last7days" || normalized === "7d" || normalized === "7 dias") {
    return { from: startOfDay(subDays(now, 6)), to: endOfDay(now), label: "Últimos 7 dias" };
  }

  // 4. Últimos 15 dias
  if (normalized === "últimos 15 dias" || normalized === "ultimos 15 dias" || normalized === "last 15 days" || normalized === "last15days" || normalized === "15d" || normalized === "15 dias") {
    return { from: startOfDay(subDays(now, 14)), to: endOfDay(now), label: "Últimos 15 dias" };
  }

  // 5. Últimos 30 dias
  if (normalized === "últimos 30 dias" || normalized === "ultimos 30 dias" || normalized === "last 30 days" || normalized === "last30days" || normalized === "30d" || normalized === "30 dias") {
    return { from: startOfDay(subDays(now, 29)), to: endOfDay(now), label: "Últimos 30 dias" };
  }

  // 6. Últimos 60 dias
  if (normalized === "últimos 60 dias" || normalized === "ultimos 60 dias" || normalized === "last 60 days" || normalized === "last60days" || normalized === "60d" || normalized === "60 dias") {
    return { from: startOfDay(subDays(now, 59)), to: endOfDay(now), label: "Últimos 60 dias" };
  }

  // 7. Últimos 90 dias
  if (normalized === "últimos 90 dias" || normalized === "ultimos 90 dias" || normalized === "last 90 days" || normalized === "last90days" || normalized === "90d" || normalized === "90 dias") {
    return { from: startOfDay(subDays(now, 89)), to: endOfDay(now), label: "Últimos 90 dias" };
  }

  // 8. Este mês
  if (normalized.includes("este m") || normalized === "thismonth") {
    return { from: startOfMonth(now), to: endOfMonth(now), label: "Este mês" };
  }

  // 9. Mês anterior
  if (normalized.includes("anterior") || normalized === "lastmonth") {
    const lastMonth = subMonths(now, 1);
    return {
      from: startOfMonth(lastMonth),
      to: endOfMonth(lastMonth),
      label: "Mês anterior",
    };
  }

  // 10. Todo o período
  if (normalized.includes("todo") || normalized === "all" || normalized === "todas") {
    return { from: new Date("2020-01-01T00:00:00Z"), to: endOfDay(now), label: "Todo o período" };
  }

  // Fallback padrão: Últimos 30 dias
  return { from: startOfDay(subDays(now, 29)), to: endOfDay(now), label: "Últimos 30 dias" };
}

export function formatDate(date: Date | string, pattern = "dd/MM/yyyy"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, pattern, { locale: ptBR });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

export function formatCurrency(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateId(prefix = ""): string {
  const random = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/** Truncate a string for display */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/** Parse a JSON string safely, returning null on failure */
export function safeParseJSON<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Convert a value to cents (integer) */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Convert cents to decimal currency value */
export function fromCents(cents: number): number {
  return cents / 100;
}
