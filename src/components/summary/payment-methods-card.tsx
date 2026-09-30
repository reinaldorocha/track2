"use client";

import React from "react";
import { CreditCard, QrCode, FileText, HelpCircle } from "lucide-react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

interface PaymentItem {
  name: string;
  count: number;
  approved: number;
  gross: number;
  rate: number;
}

interface PaymentMethodsCardProps {
  data?: PaymentItem[];
  loading?: boolean;
}

export function PaymentMethodsCard({ data = [], loading = false }: PaymentMethodsCardProps) {
  const getIcon = (name: string) => {
    switch (name.toLowerCase()) {
      case "pix":
        return <QrCode className="w-4 h-4 text-emerald-500" />;
      case "cartão":
        return <CreditCard className="w-4 h-4 text-blue-500" />;
      case "boleto":
        return <FileText className="w-4 h-4 text-amber-500" />;
      default:
        return <HelpCircle className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="bg-white dark:bg-[#081A33] border border-slate-200/90 dark:border-[#142C52] rounded-xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          Vendas por Método de Pagamento & Taxa de Aprovação
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Conversão real entre Pix, Cartão de Crédito e Boleto
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {data.map((item) => (
            <div
              key={item.name}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-[#142C52] bg-slate-50/70 dark:bg-[#061224] flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800 dark:text-slate-200">
                  {getIcon(item.name)}
                  <span>{item.name}</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold">
                  {formatPercent(item.rate)} aprov.
                </span>
              </div>

              <div className="my-2">
                <p className="text-base font-extrabold font-mono text-slate-900 dark:text-white">
                  {formatCurrency(item.gross)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {formatNumber(item.approved)}/{formatNumber(item.count)} pedidos
                </p>
              </div>

              {/* Barra visual de taxa de aprovação */}
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    item.rate >= 70
                      ? "bg-emerald-500"
                      : item.rate >= 40
                      ? "bg-amber-500"
                      : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.min(item.rate, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
