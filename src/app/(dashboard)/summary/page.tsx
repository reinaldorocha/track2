"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  Percent,
  RefreshCw,
  Clock,
  RotateCcw,
  ShieldAlert,
  MessageSquare,
  Users,
  Target,
  FileSpreadsheet,
  Filter,
  Layers,
  Link2,
} from "lucide-react";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { getDateRange, formatCurrency, formatMetric, formatPercent, formatNumber } from "@/lib/utils";
import { SummaryKpiCard } from "@/components/summary/summary-kpi-card";
import { ConversionFunnel } from "@/components/summary/conversion-funnel";
import { HourlyRevenueChart } from "@/components/summary/hourly-revenue-chart";
import { HourlyProfitChart } from "@/components/summary/hourly-profit-chart";
import { SalesByCountry } from "@/components/summary/sales-by-country";
import { PaymentMethodsCard } from "@/components/summary/payment-methods-card";
import { SourceDistributionCard } from "@/components/summary/source-distribution-card";

export default function SummaryPage() {
  const [period, setPeriod] = useState({
    preset: "Últimos 30 dias",
    ...getDateRange("last30days"),
  });

  // Filtros Globais do Topo
  const [selectedAdAccount, setSelectedAdAccount] = useState("all");
  const [selectedPlatform, setSelectedPlatform] = useState("all");
  const [selectedTrafficSource, setSelectedTrafficSource] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState("all");
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: [
      "summary-consolidated",
      period.from.toISOString(),
      period.to.toISOString(),
      selectedAdAccount,
      selectedPlatform,
      selectedTrafficSource,
      selectedProduct,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        adAccountId: selectedAdAccount,
        platform: selectedPlatform,
        utmSource: selectedTrafficSource,
        productId: selectedProduct,
      });
      const res = await fetch(`/api/summary?${params.toString()}`);
      if (!res.ok) throw new Error("Erro ao carregar dados do resumo");
      return res.json();
    },
  });

  const adAccounts = data?.adAccounts || [];

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Header com Título e Filtros do Topo */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Resumo</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Consolidação analítica de tráfego, anúncios, checkouts, vendas e rentabilidade
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <PeriodSelector
              value={period.preset}
              onChange={(preset, from, to) => setPeriod({ preset, from, to, label: preset })}
            />

            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-[#081A33] border border-slate-200 dark:border-[#142C52] text-xs font-semibold text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-[#142C52] shadow-sm transition-colors disabled:opacity-50"
              title="Atualizar dados"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin text-blue-600" : "text-slate-500"}`} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {/* Barra de Filtros Operacionais */}
        <div className="flex flex-wrap items-center gap-2 p-3 bg-white dark:bg-[#081A33] border border-slate-200/90 dark:border-[#142C52] rounded-xl shadow-sm text-xs">
          {/* Filtro: Conta de Anúncios */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Conta:</span>
            <select
              value={selectedAdAccount}
              onChange={(e) => setSelectedAdAccount(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Todas as Contas</option>
              {adAccounts.map((acc: any) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.externalId})
                </option>
              ))}
            </select>
          </div>

          {/* Filtro: Plataforma */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Plataforma:</span>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Todas as Plataformas</option>
              <option value="hotmart">Hotmart</option>
              <option value="yampi">Yampi</option>
              <option value="shopify">Shopify</option>
              <option value="cakto">Cakto</option>
              <option value="generic">Genérico</option>
            </select>
          </div>

          {/* Filtro: Fonte de Tráfego */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Fonte:</span>
            <select
              value={selectedTrafficSource}
              onChange={(e) => setSelectedTrafficSource(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Todas as Fontes</option>
              <option value="facebook">Facebook / Meta Ads</option>
              <option value="instagram">Instagram</option>
              <option value="google">Google Ads</option>
              <option value="tiktok">TikTok</option>
              <option value="organico">Orgânico</option>
            </select>
          </div>

          {/* Botão Mais Filtros */}
          <button
            onClick={() => setIsMoreFiltersOpen(!isMoreFiltersOpen)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-[#142C52]/60 transition-colors ml-auto"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Mais Filtros</span>
          </button>
        </div>

        {isMoreFiltersOpen && (
          <div className="p-4 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-xl text-xs flex flex-wrap items-center gap-4 animate-in fade-in">
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">Filtrar por Produto:</label>
              <input
                type="text"
                placeholder="Nome ou SKU do Produto..."
                value={selectedProduct === "all" ? "" : selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value || "all")}
                className="px-3 py-1.5 bg-white dark:bg-[#081A33] border border-slate-200 dark:border-[#142C52] rounded-lg text-xs w-64"
              />
            </div>
            <button
              onClick={() => {
                setSelectedAdAccount("all");
                setSelectedPlatform("all");
                setSelectedTrafficSource("all");
                setSelectedProduct("all");
              }}
              className="px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 mt-4"
            >
              Limpar Filtros
            </button>
          </div>
        )}
      </div>

      {/* 2. Grade de Indicadores (Cards de Resumo - 18 Métricas Completas) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
        {/* 1. Faturamento Bruto */}
        <SummaryKpiCard
          title="Faturamento Bruto"
          value={formatCurrency(data?.grossRevenue || 0)}
          subtitle={`${data?.approvedSalesCount || 0} vendas aprovadas`}
          tooltip="Total arrecadado em pedidos aprovados antes da dedução de taxas e despesas"
          icon={<DollarSign className="w-4 h-4 text-blue-500" />}
          loading={isLoading}
        />

        {/* 2. Gastos com Anúncios */}
        <SummaryKpiCard
          title="Gastos com Anúncios"
          value={formatCurrency(data?.totalSpend || 0)}
          subtitle={`${formatNumber(data?.totalClicks || 0)} cliques Meta`}
          tooltip="Investimento total consumido em campanhas de anúncios sincronizadas"
          icon={<TrendingUp className="w-4 h-4 text-orange-500" />}
          loading={isLoading}
        />

        {/* 3. Lucro Real */}
        <SummaryKpiCard
          title="Lucro Real"
          value={formatCurrency(data?.profit || 0)}
          subtitle={`Margem: ${formatPercent(data?.margin || 0)}`}
          tooltip="Faturamento líquido menos investimento em anúncios, despesas operacionais e impostos"
          variant={data?.profit >= 0 ? "positive" : "negative"}
          icon={data?.profit >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-rose-500" />}
          loading={isLoading}
        />

        {/* 4. Faturamento Líquido */}
        <SummaryKpiCard
          title="Faturamento Líquido"
          value={formatCurrency(data?.netRevenue || 0)}
          subtitle="Após taxas de gateway"
          tooltip="Receita disponível após o desconto das taxas da plataforma de pagamento"
          icon={<DollarSign className="w-4 h-4 text-indigo-500" />}
          loading={isLoading}
        />

        {/* 5. Vendas Pendentes */}
        <SummaryKpiCard
          title="Vendas Pendentes"
          value={formatCurrency(data?.pendingAmount || 0)}
          subtitle={`${data?.pendingCount || 0} pedidos aguardando`}
          tooltip="Pedidos com Pix gerado ou boleto emitido ainda não confirmados"
          variant="warning"
          icon={<Clock className="w-4 h-4 text-amber-500" />}
          loading={isLoading}
        />

        {/* 6. ROI */}
        <SummaryKpiCard
          title="ROI"
          value={formatPercent(data?.roi || 0)}
          subtitle="Retorno sobre investimento"
          tooltip="Percentual de retorno sobre o capital total investido (anúncios + despesas)"
          variant={(data?.roi || 0) >= 0 ? "positive" : "negative"}
          icon={<Percent className="w-4 h-4 text-blue-500" />}
          loading={isLoading}
        />

        {/* 7. ROAS */}
        <SummaryKpiCard
          title="ROAS"
          value={formatMetric(data?.roas, "ratio")}
          subtitle="Faturamento / Gasto"
          tooltip="Múltiplo de faturamento bruto gerado para cada R$ 1 investido em anúncios"
          variant={(data?.roas || 0) >= 2 ? "positive" : "neutral"}
          icon={<Target className="w-4 h-4 text-purple-500" />}
          loading={isLoading}
        />

        {/* 8. CPA */}
        <SummaryKpiCard
          title="CPA"
          value={data?.cpa ? formatCurrency(data.cpa) : "—"}
          subtitle="Custo por Aquisição"
          tooltip="Custo médio gasto em anúncios para realizar cada venda aprovada"
          icon={<ShoppingBag className="w-4 h-4 text-cyan-500" />}
          loading={isLoading}
        />

        {/* 9. Margem */}
        <SummaryKpiCard
          title="Margem"
          value={formatPercent(data?.margin || 0)}
          subtitle="Lucro / Faturamento"
          tooltip="Percentual de rentabilidade líquida retido sobre o faturamento bruto"
          variant={(data?.margin || 0) >= 20 ? "positive" : "neutral"}
          icon={<Percent className="w-4 h-4 text-emerald-500" />}
          loading={isLoading}
        />

        {/* 10. Imposto Total */}
        <SummaryKpiCard
          title="Imposto Total"
          value={formatCurrency(data?.impostoTotal || 0)}
          subtitle="Impostos configurados"
          tooltip="Valor estimado de tributação sobre as vendas conforme alíquotas cadastradas"
          icon={<FileSpreadsheet className="w-4 h-4 text-slate-500" />}
          loading={isLoading}
        />

        {/* 11. Imposto sobre Vendas */}
        <SummaryKpiCard
          title="Imposto s/ Vendas"
          value={formatCurrency(data?.impostoVendas || 0)}
          subtitle="Alíquota aplicada"
          tooltip="Imposto calculado sobre o faturamento de produtos"
          icon={<FileSpreadsheet className="w-4 h-4 text-slate-500" />}
          loading={isLoading}
        />

        {/* 12. Vendas Reembolsadas */}
        <SummaryKpiCard
          title="Vendas Reembolsadas"
          value={data?.refundCount || 0}
          subtitle={formatCurrency(data?.refundAmount || 0)}
          tooltip="Quantidade de pedidos devolvidos aos compradores"
          variant={data?.refundCount > 0 ? "negative" : "neutral"}
          icon={<RotateCcw className="w-4 h-4 text-rose-500" />}
          loading={isLoading}
        />

        {/* 13. Reembolso (R$) */}
        <SummaryKpiCard
          title="Reembolso"
          value={formatCurrency(data?.refundAmount || 0)}
          subtitle={`${data?.refundCount || 0} devoluções`}
          tooltip="Valor total estornado por solicitações de reembolso"
          variant={data?.refundAmount > 0 ? "negative" : "neutral"}
          icon={<RotateCcw className="w-4 h-4 text-rose-500" />}
          loading={isLoading}
        />

        {/* 14. Vendas Chargeback */}
        <SummaryKpiCard
          title="Vendas Chargeback"
          value={data?.chargebackCount || 0}
          subtitle={formatCurrency(data?.chargebackAmount || 0)}
          tooltip="Contestações de compra abertas junto às operadoras de cartão"
          variant={data?.chargebackCount > 0 ? "negative" : "neutral"}
          icon={<ShieldAlert className="w-4 h-4 text-rose-600" />}
          loading={isLoading}
        />

        {/* 15. Chargeback (R$) */}
        <SummaryKpiCard
          title="Chargeback"
          value={formatCurrency(data?.chargebackAmount || 0)}
          subtitle={`${data?.chargebackCount || 0} contestações`}
          tooltip="Valor financeiro contestado e bloqueado por operadoras"
          variant={data?.chargebackAmount > 0 ? "negative" : "neutral"}
          icon={<ShieldAlert className="w-4 h-4 text-rose-600" />}
          loading={isLoading}
        />

        {/* 16. Leads */}
        <SummaryKpiCard
          title="Leads"
          value={formatNumber(data?.leadsCount || 0)}
          subtitle={data?.custoPorLead ? `CPL: ${formatCurrency(data.custoPorLead)}` : "Sem custo calculado"}
          tooltip="Total de cadastros e contatos capturados pelos pixels e eventos"
          icon={<Users className="w-4 h-4 text-blue-500" />}
          loading={isLoading}
        />

        {/* 17. Conversas */}
        <SummaryKpiCard
          title="Conversas"
          value={formatNumber(data?.conversasCount || 0)}
          subtitle={data?.custoPorConversa ? `Custo: ${formatCurrency(data.custoPorConversa)}` : "—"}
          tooltip="Inícios de conversa e contatos via botões ou links rastreados"
          icon={<MessageSquare className="w-4 h-4 text-emerald-500" />}
          loading={isLoading}
        />

        {/* 18. Custo por Lead */}
        <SummaryKpiCard
          title="Custo por Lead"
          value={data?.custoPorLead ? formatCurrency(data.custoPorLead) : "—"}
          subtitle="Gasto / Leads"
          tooltip="Custo médio em anúncios para aquisição de cada lead cadastrado"
          icon={<Users className="w-4 h-4 text-blue-400" />}
          loading={isLoading}
        />
      </div>

      {/* 3. Funil de Conversão (Meta Ads) */}
      <ConversionFunnel data={data?.funnel} loading={isLoading} />

      {/* 4. Gráficos Temporais: Faturamento x Investimento x Lucro & Lucro por Horário */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HourlyRevenueChart data={data?.hourlyData} loading={isLoading} />
        <HourlyProfitChart data={data?.hourlyData} loading={isLoading} />
      </div>

      {/* 5. Vendas por Pagamento & Taxas de Aprovação */}
      <PaymentMethodsCard data={data?.paymentDistribution} loading={isLoading} />

      {/* 6. Vendas por País & Distribuição por Origem / Plataforma */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1">
          <SalesByCountry data={data?.countryDistribution} loading={isLoading} />
        </div>
        <div className="lg:col-span-2">
          <SourceDistributionCard
            sources={data?.sourceDistribution}
            platforms={data?.platformDistribution}
            loading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
