"use client";

import React from "react";
import { Info } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface FunnelStepData {
  count: number;
  pctPrev?: number;
  pctTotal?: number;
  dropOff?: number;
  cost?: number | null;
}

interface ConversionFunnelProps {
  data?: {
    clicks: FunnelStepData;
    pageViews: FunnelStepData;
    ics: FunnelStepData;
    vendasIniciadas: FunnelStepData;
    vendasAprovadas: FunnelStepData;
  };
  loading?: boolean;
}

export function ConversionFunnel({ data, loading = false }: ConversionFunnelProps) {
  if (loading) {
    return (
      <div className="w-full h-64 bg-slate-50 dark:bg-[#081A33] animate-pulse rounded-2xl border border-slate-200 dark:border-[#142C52]" />
    );
  }

  const countClicks = Number(data?.clicks?.count || 0);
  const countPageViews = Number(data?.pageViews?.count || 0);
  const countICs = Number(data?.ics?.count || 0);
  const countVendasInic = Number(data?.vendasIniciadas?.count || 0);
  const countVendasApr = Number(data?.vendasAprovadas?.count || 0);

  const pctClicks = 100;
  const pctPageViews = countClicks > 0 ? Math.round((countPageViews / countClicks) * 100) : 0;
  const pctICs = countPageViews > 0 ? Math.round((countICs / countPageViews) * 100) : (countClicks > 0 ? Math.round((countICs / countClicks) * 100) : 0);
  const pctVendasInic = countICs > 0 ? Math.round((countVendasInic / countICs) * 100) : (countClicks > 0 ? Math.round((countVendasInic / countClicks) * 100) : 0);
  const pctVendasApr = countVendasInic > 0 ? Math.round((countVendasApr / countVendasInic) * 100) : (countClicks > 0 ? Math.round((countVendasApr / countClicks) * 100) : 0);

  const steps = [
    { title: "Cliques", count: countClicks, pct: `${pctClicks}%`, isFirst: true },
    { title: "Vis. Página", count: countPageViews, pct: `${pctPageViews}%`, isFirst: false },
    { title: "ICs", count: countICs, pct: `${pctICs}%`, isFirst: false },
    { title: "Vendas Inic.", count: countVendasInic, pct: `${pctVendasInic}%`, isFirst: false },
    { title: "Vendas Apr.", count: countVendasApr, pct: `${pctVendasApr}%`, isFirst: false },
  ];

  return (
    <div className="bg-white dark:bg-[#081A33] rounded-2xl border border-slate-200/90 dark:border-[#142C52] p-6 shadow-sm">
      {/* Header com título e ícone de informação */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Funil de Conversão (Meta Ads)
          </h3>
        </div>
        <div className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" title="Fluxo contínuo desde o anúncio até o pagamento aprovado">
          <Info className="w-4 h-4 cursor-pointer" />
        </div>
      </div>

      {/* Container do Funil */}
      <div className="relative w-full overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Grid de 5 colunas com divisões verticais */}
          <div className="grid grid-cols-5 relative">
            {steps.map((step, idx) => (
              <div
                key={step.title}
                className={`relative flex flex-col justify-between py-2 ${
                  idx < steps.length - 1 ? "border-r border-slate-200 dark:border-slate-800" : ""
                }`}
              >
                {/* Título da etapa */}
                <div className="text-center pb-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {step.title}
                  </span>
                </div>

                {/* Área Central com o fluxo visual */}
                <div className="relative h-44 flex items-center justify-center">
                  {step.isFirst ? (
                    /* Primeira etapa: Forma fluida azul começando larga à esquerda e afinando ao centro */
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg
                        className="w-full h-full"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                      >
                        <defs>
                          <linearGradient id="funnelGradientSummary" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#0066FF" />
                            <stop offset="100%" stopColor="#0052CC" />
                          </linearGradient>
                        </defs>
                        <path
                          d="M 0,5 Q 10,5 30,25 T 100,50 L 100,50 Q 80,50 30,75 T 0,95 Z"
                          fill="url(#funnelGradientSummary)"
                        />
                      </svg>
                      {/* Percentual 100% no centro da forma azul */}
                      <span className="absolute z-10 text-white font-extrabold text-base tracking-wide drop-shadow-sm">
                        {step.pct}
                      </span>
                    </div>
                  ) : (
                    /* Etapas seguintes: Linha central conectada atravessando com o percentual no meio */
                    <div className="relative w-full flex items-center justify-center">
                      <div className="absolute left-0 right-0 h-[1.5px] bg-slate-300 dark:bg-slate-700 z-0" />
                      <span className="relative z-10 px-2 py-0.5 bg-white dark:bg-[#081A33] text-slate-400 dark:text-slate-400 font-semibold text-xs tracking-wider">
                        {step.pct}
                      </span>
                    </div>
                  )}
                </div>

                {/* Quantidade na base */}
                <div className="text-center pt-3">
                  <span className="text-base font-bold text-slate-900 dark:text-white font-mono">
                    {formatNumber(step.count)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
