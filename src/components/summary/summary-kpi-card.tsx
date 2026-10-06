"use client";

import React from "react";
import { Info } from "lucide-react";

interface SummaryKpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  tooltip?: string;
  icon?: React.ReactNode;
  variant?: "default" | "positive" | "negative" | "neutral" | "warning";
  loading?: boolean;
}

export function SummaryKpiCard({
  title,
  value,
  subtitle,
  tooltip,
  icon,
  variant = "default",
  loading = false,
}: SummaryKpiCardProps) {
  let valueColor = "text-slate-900 dark:text-white";
  if (variant === "positive") {
    valueColor = "text-emerald-600 dark:text-emerald-400";
  } else if (variant === "negative") {
    valueColor = "text-rose-600 dark:text-rose-400";
  } else if (variant === "warning") {
    valueColor = "text-amber-600 dark:text-amber-400";
  }

  const valueStr = String(value ?? "");
  const valueFontSize =
    valueStr.length > 14
      ? "text-sm sm:text-base lg:text-lg"
      : valueStr.length > 10
      ? "text-base sm:text-lg lg:text-xl"
      : "text-lg sm:text-xl lg:text-2xl";

  return (
    <div className="bg-white dark:bg-[#081A33] border border-slate-200/90 dark:border-[#142C52] rounded-xl p-3 sm:p-4 shadow-sm hover:shadow transition-all relative group flex flex-col justify-between min-h-[96px] sm:min-h-[110px] min-w-0 overflow-hidden">
      <div className="flex items-start justify-between gap-1.5 mb-1.5 sm:mb-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span
            className="text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-tight leading-tight line-clamp-2 min-w-0"
            title={title}
          >
            {title}
          </span>
          {tooltip && (
            <div className="relative inline-flex items-center shrink-0">
              <Info className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-help transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-30 w-48 p-2 text-[11px] leading-tight text-white bg-slate-900 dark:bg-black rounded-lg shadow-xl pointer-events-none text-center">
                {tooltip}
              </div>
            </div>
          )}
        </div>
        {icon && (
          <div className="p-1 sm:p-1.5 rounded-lg bg-slate-50 dark:bg-[#040A14] text-slate-500 dark:text-slate-400 shrink-0">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-auto min-w-0">
        {loading ? (
          <div className="h-6 sm:h-7 w-20 sm:w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
        ) : (
          <div
            className={`font-bold tracking-tight truncate ${valueFontSize} ${valueColor}`}
            title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}
          >
            {value}
          </div>
        )}

        {subtitle && (
          <p
            className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 truncate"
            title={subtitle}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
