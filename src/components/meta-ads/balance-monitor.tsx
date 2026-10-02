"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Clock,
  TrendingDown,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";

interface AccountBalanceItem {
  id: string;
  name: string;
  externalId: string;
  currency: string;
  timezone: string;
  accountStatus: number;
  accountStatusLabel: string;
  badgeColor: "emerald" | "amber" | "rose" | "slate";
  disableReason: string | null;
  isPrepayAccount: boolean;
  balance: number;
  amountSpent: number;
  spendCap: number | null;
  availableBalance: number;
  remainingLimit: number | null;
  percentUsed: number | null;
  averageDailySpend: number;
  estimatedDaysRemaining: number | null;
  alertLevel: "critical" | "warning" | "ok";
  alertReason: string;
  fundingSource: string;
  billingUrl: string;
  lastCheckedAt: string;
}

interface BalanceApiResponse {
  summary: {
    totalAccounts: number;
    activeAccounts: number;
    totalPrepaidBalance: number;
    totalLifetimeSpend: number;
    totalDailySpend: number;
    criticalAlertsCount: number;
    warningAlertsCount: number;
    healthyAccountsCount: number;
  };
  accounts: AccountBalanceItem[];
}

export function BalanceMonitor({ selectedAdAccountId }: { selectedAdAccountId?: string }) {
  const [customThreshold, setCustomThreshold] = useState<number>(100);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<BalanceApiResponse>({
    queryKey: ["meta-balance", selectedAdAccountId],
    queryFn: async () => {
      const url = selectedAdAccountId && selectedAdAccountId !== "all"
        ? `/api/meta/balance?accountId=${encodeURIComponent(selectedAdAccountId)}`
        : "/api/meta/balance";
      const res = await fetch(url);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Erro ao consultar saldos da Meta");
      }
      return res.json();
    },
    refetchInterval: 60000, // Atualiza a cada 1 minuto
  });

  const summary = data?.summary;
  const accounts = data?.accounts || [];

  const formatCurrency = (val: number, currency = "BRL") => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    }).format(val || 0);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header com Descrição e Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#081A33] p-5 rounded-2xl border border-slate-200/80 dark:border-[#142C52] shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Monitor de Saldo & Limite de Gastos (Meta Ads)
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-300/60 dark:border-emerald-800">
                  Ao Vivo
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Prevenção de pausas de anúncios: monitore saldo disponível em contas pré-pagas (Pix/Boleto), limites de faturamento e duração estimada.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#0d2244] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#142C52]">
            <span className="text-[11px] font-medium text-slate-400">Gatilho de alerta:</span>
            <select
              value={customThreshold}
              onChange={(e) => setCustomThreshold(Number(e.target.value))}
              className="bg-transparent font-bold text-blue-600 dark:text-blue-400 focus:outline-hidden cursor-pointer"
            >
              <option value={50}>Menor que R$ 50</option>
              <option value={100}>Menor que R$ 100</option>
              <option value={200}>Menor que R$ 200</option>
              <option value={500}>Menor que R$ 500</option>
            </select>
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Consultando Meta..." : "Atualizar Saldo"}
          </button>
        </div>
      </div>

      {/* Erro global na chamada */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center gap-3 text-xs text-rose-800 dark:text-rose-200">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>Erro ao consultar dados de saldo da Meta: {error.message}</span>
        </div>
      )}

      {/* 4 Cards de Resumo de Topo */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-100 dark:bg-[#081A33] rounded-2xl border border-slate-200 dark:border-[#142C52]" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Saldo Pré-Pago Disponível */}
          <div className="bg-white dark:bg-[#081A33] p-5 rounded-2xl border border-slate-200/90 dark:border-[#142C52] shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Saldo Pré-Pago em Caixa
              </span>
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 rounded-xl">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {formatCurrency(summary.totalPrepaidBalance)}
              </span>
            </div>
            <div className="mt-1 flex items-center text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              <span>Fundos disponíveis para veiculação</span>
            </div>
          </div>

          {/* Card 2: Contas em Risco / Alertas */}
          <div className={`p-5 rounded-2xl border shadow-xs relative overflow-hidden ${
            summary.criticalAlertsCount > 0
              ? "bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900"
              : summary.warningAlertsCount > 0
              ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900"
              : "bg-white dark:bg-[#081A33] border-slate-200/90 dark:border-[#142C52]"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Contas em Alerta / Risco
              </span>
              <div className={`p-2 rounded-xl ${
                summary.criticalAlertsCount > 0
                  ? "bg-rose-100 dark:bg-rose-900/50 text-rose-600"
                  : summary.warningAlertsCount > 0
                  ? "bg-amber-100 dark:bg-amber-900/50 text-amber-600"
                  : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600"
              }`}>
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {summary.criticalAlertsCount + summary.warningAlertsCount}
              </span>
              <span className="text-xs text-slate-400">
                de {summary.totalAccounts} conta(s)
              </span>
            </div>
            <div className="mt-1 text-[11px] font-medium">
              {summary.criticalAlertsCount > 0 ? (
                <span className="text-rose-600 dark:text-rose-400">
                  ⚠️ {summary.criticalAlertsCount} conta(s) com risco iminente de parada
                </span>
              ) : summary.warningAlertsCount > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {summary.warningAlertsCount} conta(s) com saldo em nível de atenção
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Todas as contas com saldo saudável
                </span>
              )}
            </div>
          </div>

          {/* Card 3: Queima Diária (Média 7 dias) */}
          <div className="bg-white dark:bg-[#081A33] p-5 rounded-2xl border border-slate-200/90 dark:border-[#142C52] shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Gasto Médio Diário
              </span>
              <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {formatCurrency(summary.totalDailySpend)}
              </span>
              <span className="text-xs text-slate-400">/dia</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Média baseada no histórico dos últimos 7 dias
            </div>
          </div>

          {/* Card 4: Saúde Geral das Contas */}
          <div className="bg-white dark:bg-[#081A33] p-5 rounded-2xl border border-slate-200/90 dark:border-[#142C52] shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Contas Ativas na Meta
              </span>
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 rounded-xl">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {summary.activeAccounts}
              </span>
              <span className="text-xs text-slate-400">
                / {summary.totalAccounts} ativas
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Total investido histórico: {formatCurrency(summary.totalLifetimeSpend)}
            </div>
          </div>
        </div>
      ) : null}

      {/* Grid de Cards Detalhados por Conta de Anúncios */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            Contas Conectadas & Detalhes de Saldo
            <span className="text-xs font-normal text-slate-400">({accounts.length})</span>
          </h3>
        </div>

        {accounts.length === 0 && !isLoading ? (
          <div className="bg-white dark:bg-[#081A33] border border-slate-200/90 dark:border-[#142C52] rounded-2xl p-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 flex items-center justify-center mx-auto">
              <Wallet className="w-6 h-6" />
            </div>
            <div className="max-w-md mx-auto">
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Nenhuma conta selecionada ou conectada
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Conecte ou selecione uma conta de anúncios na aba &quot;Contas&quot; para visualizar saldos ao vivo e previsão de dias de anúncio.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {accounts.map((acc) => {
              const isPrepaid = acc.isPrepayAccount;
              const isBelowCustomThreshold = isPrepaid
                ? acc.availableBalance <= customThreshold
                : acc.remainingLimit !== null
                ? acc.remainingLimit <= customThreshold
                : false;

              const isCritical = acc.alertLevel === "critical" || isBelowCustomThreshold;
              const isWarning = !isCritical && (acc.alertLevel === "warning" || (acc.estimatedDaysRemaining !== null && acc.estimatedDaysRemaining <= 3));

              return (
                <div
                  key={acc.id}
                  className={`bg-white dark:bg-[#081A33] rounded-2xl border transition-all shadow-xs p-6 flex flex-col justify-between ${
                    isCritical
                      ? "border-rose-300 dark:border-rose-900 shadow-rose-500/5 ring-1 ring-rose-200 dark:ring-rose-950"
                      : isWarning
                      ? "border-amber-300 dark:border-amber-900 ring-1 ring-amber-200 dark:ring-amber-950"
                      : "border-slate-200/90 dark:border-[#142C52] hover:border-slate-300"
                  }`}
                >
                  {/* Topo do Card da Conta */}
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-bold text-slate-900 dark:text-white truncate max-w-[280px]" title={acc.name}>
                            {acc.name}
                          </h4>
                          <span className="font-mono text-[10px] text-slate-400 bg-slate-100 dark:bg-[#0d2244] px-1.5 py-0.5 rounded">
                            {acc.externalId}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <span>{acc.currency}</span>
                          <span>•</span>
                          <span>{acc.timezone}</span>
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {/* Status da Conta na Meta */}
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                            acc.badgeColor === "emerald"
                              ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                              : acc.badgeColor === "amber"
                              ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                              : "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                          }`}
                        >
                          {acc.accountStatusLabel}
                        </span>

                        {/* Tipo de Conta: Pré ou Pós */}
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          {isPrepaid ? (
                            <>
                              <Wallet className="w-3 h-3 text-emerald-500" /> Pré-Paga (Pix/Boleto)
                            </>
                          ) : (
                            <>
                              <CreditCard className="w-3 h-3 text-blue-500" /> Pós-Paga (Fatura/Cartão)
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Alerta Destacado se Houver */}
                    {(isCritical || isWarning) && (
                      <div
                        className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                          isCritical
                            ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200"
                            : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200"
                        }`}
                      >
                        <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${isCritical ? "text-rose-600" : "text-amber-600"}`} />
                        <div className="space-y-0.5">
                          <p className="font-bold">
                            {isCritical ? "Atenção Crítica de Saldo:" : "Alerta de Monitoramento:"}
                          </p>
                          <p className="text-[11px] leading-relaxed opacity-90">{acc.alertReason}</p>
                        </div>
                      </div>
                    )}

                    {/* Bloco Central de Saldo / Limite */}
                    <div className="p-4 bg-slate-50 dark:bg-[#0c2242]/70 rounded-xl border border-slate-200/80 dark:border-[#142C52] space-y-3">
                      {isPrepaid ? (
                        /* Conta Pré-Paga: Saldo Disponível */
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Saldo Disponível para Anúncios
                            </span>
                            <div className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">
                              {formatCurrency(acc.availableBalance, acc.currency)}
                            </div>
                          </div>
                          <div className={`p-3 rounded-xl ${
                            acc.availableBalance <= 50
                              ? "bg-rose-100 dark:bg-rose-900/40 text-rose-600"
                              : acc.availableBalance <= 150
                              ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600"
                              : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600"
                          }`}>
                            <Wallet className="w-6 h-6" />
                          </div>
                        </div>
                      ) : acc.spendCap && acc.spendCap > 0 ? (
                        /* Conta Pós-Paga com Limite (Spend Cap) */
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">
                              Limite de Gastos da Conta (Spend Cap)
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white">
                              {formatCurrency(acc.amountSpent, acc.currency)} / {formatCurrency(acc.spendCap, acc.currency)}
                            </span>
                          </div>

                          {/* Barra de Progresso do Limite */}
                          <div className="w-full bg-slate-200 dark:bg-[#142C52] rounded-full h-3 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                (acc.percentUsed || 0) >= 95
                                  ? "bg-rose-600"
                                  : (acc.percentUsed || 0) >= 80
                                  ? "bg-amber-500"
                                  : "bg-blue-600"
                              }`}
                              style={{ width: `${Math.min(100, acc.percentUsed || 0)}%` }}
                            />
                          </div>

                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 dark:text-slate-400">
                              Consumido: <strong className="text-slate-700 dark:text-slate-200">{acc.percentUsed}%</strong>
                            </span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              Resta: {formatCurrency(acc.remainingLimit || 0, acc.currency)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        /* Conta Pós-Paga sem Limite Configurado */
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Faturamento Automático no Cartão
                            </span>
                            <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                              Sem teto fixo configurado
                            </div>
                            <span className="text-[11px] text-slate-400">
                              Total gasto acumulado: {formatCurrency(acc.amountSpent, acc.currency)}
                            </span>
                          </div>
                          <div className="p-3 bg-blue-50 dark:bg-blue-900/40 text-blue-600 rounded-xl">
                            <CreditCard className="w-6 h-6" />
                          </div>
                        </div>
                      )}

                      {/* Métricas de Ritmo de Queima e Duração Estimada */}
                      <div className="pt-2 border-t border-slate-200/60 dark:border-[#142C52] grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-400 block">Ritmo Diário (7d):</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {formatCurrency(acc.averageDailySpend, acc.currency)}/dia
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block">Duração Estimada:</span>
                          {acc.estimatedDaysRemaining !== null ? (
                            <span
                              className={`font-black flex items-center gap-1 ${
                                acc.estimatedDaysRemaining <= 1
                                  ? "text-rose-600 dark:text-rose-400"
                                  : acc.estimatedDaysRemaining <= 3
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }`}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              {acc.estimatedDaysRemaining <= 0
                                ? "Esgotado"
                                : `~${acc.estimatedDaysRemaining} dias`}
                            </span>
                          ) : (
                            <span className="text-slate-400">Contínua / Ilimitada</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Rodapé do Card: Forma de Pagamento e Botão de Ação */}
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-[#142C52] flex items-center justify-between gap-3 text-xs">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={acc.fundingSource}>
                      Forma: <span className="font-medium text-slate-700 dark:text-slate-300">{acc.fundingSource}</span>
                    </div>

                    <a
                      href={acc.billingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#102a52] dark:hover:bg-[#163666] text-slate-700 dark:text-slate-200 font-semibold rounded-lg text-xs transition-colors shrink-0"
                    >
                      <span>Gerenciar na Meta</span>
                      <ExternalLink className="w-3 h-3 text-blue-500" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dicas e Recomendações Práticas */}
      <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900 rounded-2xl flex items-start gap-3 text-xs text-blue-900 dark:text-blue-200">
        <HelpCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Como funciona o Monitor de Saldo & Limite?</p>
          <p className="text-[11px] leading-relaxed opacity-90">
            • <strong>Contas Pré-Pagas (Boleto/Pix)</strong>: A Meta interrompe a entrega das campanhas imediatamente quando o saldo zera. Nosso monitor calcula o consumo médio dos últimos 7 dias para estimar quantos dias de tráfego restam antes da pausa.
          </p>
          <p className="text-[11px] leading-relaxed opacity-90">
            • <strong>Contas Pós-Pagas com Limite (Spend Cap)</strong>: Se você configurou um limite de gastos no Gerenciador de Anúncios, as campanhas serão pausadas assim que o valor for atingido. Acompanhe a barra de progresso para não ser pego de surpresa.
          </p>
        </div>
      </div>
    </div>
  );
}
