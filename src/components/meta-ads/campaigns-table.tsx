"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  formatCurrency,
  formatNumber,
  formatMetric,
  formatPercent,
} from "@/lib/utils";
import {
  ArrowUpDown,
  Download,
  Search,
  Filter,
  Columns,
  CheckSquare,
  Square,
  RefreshCw,
} from "lucide-react";

export type MetaTableLevel = "campaign" | "adset" | "ad";

export interface MetaTableItem {
  id: string;
  externalId?: string;
  name: string;
  parentName?: string;
  campaignName?: string;
  adAccountName?: string;
  previewUrl?: string | null;
  status: string;
  budget?: number | null;
  spend: number;
  sales: number;
  cpa: number | null;
  revenue: number;
  profit: number;
  roas: number | null;
  roi: number | null;
  impressions: number;
  margin: number | null;
  cpm: number | null;
  clicks: number;
  cpc: number | null;
  ctr: number | null;
  ic: number;
  cpi: number | null;
}

interface CampaignsTableProps {
  level?: MetaTableLevel;
  adAccountId?: string;
  periodFrom?: string;
  periodTo?: string;
}

export function CampaignsTable({
  level = "campaign",
  adAccountId = "all",
  periodFrom,
  periodTo,
}: CampaignsTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState<keyof MetaTableItem>("spend");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);

  // Colunas configuráveis
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    status: true,
    name: true,
    budget: true,
    spend: true,
    sales: true,
    cpa: true,
    revenue: true,
    profit: true,
    roas: true,
    roi: true,
    impressions: true,
    margin: true,
    cpm: true,
    clicks: true,
    cpc: true,
    ctr: true,
    ic: true,
    cpi: true,
  });

  const { data, isLoading, refetch, isFetching } = useQuery<{ data: MetaTableItem[] }>({
    queryKey: ["meta-insights-table", level, adAccountId, statusFilter, searchTerm, periodFrom, periodTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        level,
        ...(adAccountId !== "all" ? { adAccountId } : {}),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(searchTerm ? { search: searchTerm } : {}),
        ...(periodFrom ? { from: periodFrom } : {}),
        ...(periodTo ? { to: periodTo } : {}),
      });
      const res = await fetch(`/api/meta/insights?${params.toString()}`);
      if (!res.ok) throw new Error("Erro ao buscar dados da tabela");
      return res.json();
    },
  });

  const items = data?.data || [];

  const handleSort = (field: keyof MetaTableItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortedItems = [...items].sort((a, b) => {
    const valA = a[sortField] ?? -Infinity;
    const valB = b[sortField] ?? -Infinity;
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  const toggleSelectAll = () => {
    if (selectedRowIds.length === items.length) {
      setSelectedRowIds([]);
    } else {
      setSelectedRowIds(items.map((i) => i.id));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedRowIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Linha de Totalização
  const totals = sortedItems.reduce(
    (acc, curr) => {
      acc.spend += curr.spend || 0;
      acc.sales += curr.sales || 0;
      acc.revenue += curr.revenue || 0;
      acc.profit += curr.profit || 0;
      acc.impressions += curr.impressions || 0;
      acc.clicks += curr.clicks || 0;
      acc.ic += curr.ic || 0;
      return acc;
    },
    { spend: 0, sales: 0, revenue: 0, profit: 0, impressions: 0, clicks: 0, ic: 0 }
  );

  const totalCpa = totals.sales > 0 ? totals.spend / totals.sales : null;
  const totalRoas = totals.spend > 0 ? totals.revenue / totals.spend : null;
  const totalRoi = totals.spend > 0 ? (totals.profit / totals.spend) * 100 : null;
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : null;
  const totalCpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null;
  const totalCpc = totals.clicks > 0 ? totals.spend / totals.clicks : null;
  const totalCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null;
  const totalCpi = totals.ic > 0 ? totals.spend / totals.ic : null;

  const exportCSV = () => {
    const headers = [
      "Nome",
      "Status",
      "Gasto (R$)",
      "Vendas",
      "CPA (R$)",
      "Faturamento (R$)",
      "Lucro (R$)",
      "ROAS",
      "ROI (%)",
      "Impressões",
      "Margem (%)",
      "CPM (R$)",
      "Cliques",
      "CPC (R$)",
      "CTR (%)",
      "ICs",
      "CPI (R$)",
    ];
    const lines = [headers.join(";")];
    for (const item of sortedItems) {
      lines.push(
        [
          `"${item.name.replace(/"/g, '""')}"`,
          item.status,
          item.spend.toFixed(2),
          item.sales,
          item.cpa !== null ? item.cpa.toFixed(2) : "",
          item.revenue.toFixed(2),
          item.profit.toFixed(2),
          item.roas !== null ? item.roas.toFixed(2) : "",
          item.roi !== null ? item.roi.toFixed(2) : "",
          item.impressions,
          item.margin !== null ? item.margin.toFixed(2) : "",
          item.cpm !== null ? item.cpm.toFixed(2) : "",
          item.clicks,
          item.cpc !== null ? item.cpc.toFixed(2) : "",
          item.ctr !== null ? item.ctr.toFixed(2) : "",
          item.ic,
          item.cpi !== null ? item.cpi.toFixed(2) : "",
        ].join(";")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meta-${level}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    if (s === "ACTIVE") {
      return (
        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 text-[10px] rounded-full font-bold">
          Ativo
        </span>
      );
    }
    if (s === "PAUSED") {
      return (
        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 text-[10px] rounded-full font-bold">
          Pausado
        </span>
      );
    }
    if (s === "ARCHIVED" || s === "DELETED") {
      return (
        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[10px] rounded-full font-bold">
          {s === "ARCHIVED" ? "Arquivado" : "Excluído"}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[10px] rounded-full font-bold">
        {status}
      </span>
    );
  };

  const levelTitle =
    level === "campaign"
      ? "Campanhas"
      : level === "adset"
      ? "Conjuntos de Anúncios"
      : "Anúncios";

  return (
    <div className="bg-white dark:bg-[#081A33] border border-slate-200/90 dark:border-[#142C52] rounded-xl shadow-sm overflow-hidden flex flex-col">
      {/* Barra de Filtros e Ações da Tabela */}
      <div className="p-4 border-b border-slate-200 dark:border-[#142C52] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={`Buscar ${levelTitle.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-xs w-48 sm:w-60 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-400 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg font-medium text-slate-700 dark:text-slate-300"
            >
              <option value="all">Todos os Status</option>
              <option value="ACTIVE">Ativo</option>
              <option value="PAUSED">Pausado</option>
              <option value="ARCHIVED">Arquivado</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Seletor de Colunas */}
          <div className="relative">
            <button
              onClick={() => setIsColumnPickerOpen(!isColumnPickerOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142C52]/60 font-semibold"
            >
              <Columns className="w-3.5 h-3.5" /> Colunas
            </button>
            {isColumnPickerOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-40 w-48 p-2.5 bg-white dark:bg-[#081A33] border border-slate-200 dark:border-[#142C52] rounded-xl shadow-xl space-y-1.5 animate-in fade-in">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Exibir Colunas
                </p>
                {Object.keys(visibleColumns).map((col) => (
                  <label
                    key={col}
                    className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer capitalize"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns[col]}
                      onChange={(e) =>
                        setVisibleColumns({ ...visibleColumns, [col]: e.target.checked })
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {col}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Exportar CSV */}
          <button
            onClick={exportCSV}
            disabled={sortedItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142C52]/60 font-semibold disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 bg-slate-50 dark:bg-[#061224] border border-slate-200 dark:border-[#142C52] rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100"
            title="Atualizar tabela"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin text-blue-600" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabela de Dados */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-[#061224] border-b border-slate-200 dark:border-[#142C52] text-[11px] font-bold text-slate-500 dark:text-slate-400 tracking-tight select-none">
              {/* Checkbox Select All */}
              <th className="p-3 w-8 text-center">
                <button onClick={toggleSelectAll} className="p-0.5 text-slate-400 hover:text-slate-600">
                  {selectedRowIds.length === sortedItems.length && sortedItems.length > 0 ? (
                    <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              </th>

              {visibleColumns.status && <th className="p-3 w-20">Status</th>}

              {visibleColumns.name && (
                <th
                  onClick={() => handleSort("name")}
                  className="p-3 cursor-pointer hover:text-blue-600 min-w-[200px]"
                >
                  <div className="flex items-center gap-1">
                    <span>{levelTitle}</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.budget && (
                <th onClick={() => handleSort("budget")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Orçamento</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.spend && (
                <th onClick={() => handleSort("spend")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Gastos</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.sales && (
                <th onClick={() => handleSort("sales")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Vendas</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.cpa && (
                <th onClick={() => handleSort("cpa")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>CPA</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.revenue && (
                <th onClick={() => handleSort("revenue")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Faturamento</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.profit && (
                <th onClick={() => handleSort("profit")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Lucro</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.roas && (
                <th onClick={() => handleSort("roas")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>ROAS</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.roi && (
                <th onClick={() => handleSort("roi")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>ROI</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.impressions && (
                <th onClick={() => handleSort("impressions")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Impressões</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.margin && (
                <th onClick={() => handleSort("margin")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Margem</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.cpm && (
                <th onClick={() => handleSort("cpm")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>CPM</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.clicks && (
                <th onClick={() => handleSort("clicks")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>Cliques</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.cpc && (
                <th onClick={() => handleSort("cpc")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>CPC</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.ctr && (
                <th onClick={() => handleSort("ctr")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>CTR</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.ic && (
                <th onClick={() => handleSort("ic")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>IC</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}

              {visibleColumns.cpi && (
                <th onClick={() => handleSort("cpi")} className="p-3 text-right cursor-pointer hover:text-blue-600">
                  <div className="flex items-center justify-end gap-1">
                    <span>CPI</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-[#142C52]/60">
            {isLoading ? (
              <tr>
                <td colSpan={20} className="p-8 text-center text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Carregando métricas da Meta Marketing API...</span>
                  </div>
                </td>
              </tr>
            ) : sortedItems.length === 0 ? (
              <tr>
                <td colSpan={20} className="p-8 text-center text-slate-400">
                  Nenhum dado encontrado para os filtros selecionados. Sincronize suas contas para importar campanhas.
                </td>
              </tr>
            ) : (
              sortedItems.map((item) => {
                const isSelected = selectedRowIds.includes(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-[#061224]/70 transition-colors ${
                      isSelected ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="p-3 text-center">
                      <button onClick={() => toggleRow(item.id)} className="p-0.5 text-slate-400 hover:text-slate-600">
                        {isSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>

                    {visibleColumns.status && <td className="p-3">{getStatusBadge(item.status)}</td>}

                    {visibleColumns.name && (
                      <td className="p-3 font-semibold text-slate-900 dark:text-slate-100 max-w-xs truncate">
                        <div title={item.name}>{item.name}</div>
                        {item.parentName && (
                          <div className="text-[10px] text-slate-400 truncate">
                            {item.parentName}
                          </div>
                        )}
                      </td>
                    )}

                    {visibleColumns.budget && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {item.budget ? formatCurrency(item.budget) : "—"}
                      </td>
                    )}

                    {visibleColumns.spend && (
                      <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {formatCurrency(item.spend)}
                      </td>
                    )}

                    {visibleColumns.sales && (
                      <td className="p-3 text-right font-mono text-slate-700 dark:text-slate-200">
                        {formatNumber(item.sales)}
                      </td>
                    )}

                    {visibleColumns.cpa && (
                      <td className="p-3 text-right font-mono text-slate-700 dark:text-slate-200">
                        {item.cpa ? formatCurrency(item.cpa) : "—"}
                      </td>
                    )}

                    {visibleColumns.revenue && (
                      <td className="p-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                        {formatCurrency(item.revenue)}
                      </td>
                    )}

                    {visibleColumns.profit && (
                      <td
                        className={`p-3 text-right font-mono font-bold ${
                          item.profit >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {formatCurrency(item.profit)}
                      </td>
                    )}

                    {visibleColumns.roas && (
                      <td className="p-3 text-right font-mono text-purple-600 dark:text-purple-400 font-bold">
                        {formatMetric(item.roas, "ratio")}
                      </td>
                    )}

                    {visibleColumns.roi && (
                      <td
                        className={`p-3 text-right font-mono font-semibold ${
                          (item.roi || 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"
                        }`}
                      >
                        {formatPercent(item.roi || 0)}
                      </td>
                    )}

                    {visibleColumns.impressions && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatNumber(item.impressions)}
                      </td>
                    )}

                    {visibleColumns.margin && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatPercent(item.margin || 0)}
                      </td>
                    )}

                    {visibleColumns.cpm && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {item.cpm ? formatCurrency(item.cpm) : "—"}
                      </td>
                    )}

                    {visibleColumns.clicks && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatNumber(item.clicks)}
                      </td>
                    )}

                    {visibleColumns.cpc && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {item.cpc ? formatCurrency(item.cpc) : "—"}
                      </td>
                    )}

                    {visibleColumns.ctr && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatPercent(item.ctr || 0)}
                      </td>
                    )}

                    {visibleColumns.ic && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatNumber(item.ic)}
                      </td>
                    )}

                    {visibleColumns.cpi && (
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {item.cpi ? formatCurrency(item.cpi) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Footer de Totalização */}
          {sortedItems.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100/90 dark:bg-[#061224] border-t-2 border-slate-300 dark:border-[#142C52] font-bold text-slate-900 dark:text-white">
                <td className="p-3 text-center font-mono">Σ</td>
                {visibleColumns.status && <td className="p-3">—</td>}
                {visibleColumns.name && <td className="p-3">Total ({sortedItems.length})</td>}
                {visibleColumns.budget && <td className="p-3 text-right font-mono">—</td>}
                {visibleColumns.spend && <td className="p-3 text-right font-mono">{formatCurrency(totals.spend)}</td>}
                {visibleColumns.sales && <td className="p-3 text-right font-mono">{formatNumber(totals.sales)}</td>}
                {visibleColumns.cpa && <td className="p-3 text-right font-mono">{totalCpa ? formatCurrency(totalCpa) : "—"}</td>}
                {visibleColumns.revenue && <td className="p-3 text-right font-mono text-blue-600 dark:text-blue-400">{formatCurrency(totals.revenue)}</td>}
                {visibleColumns.profit && (
                  <td
                    className={`p-3 text-right font-mono ${
                      totals.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"
                    }`}
                  >
                    {formatCurrency(totals.profit)}
                  </td>
                )}
                {visibleColumns.roas && <td className="p-3 text-right font-mono text-purple-600 dark:text-purple-400">{formatMetric(totalRoas, "ratio")}</td>}
                {visibleColumns.roi && <td className="p-3 text-right font-mono">{formatPercent(totalRoi || 0)}</td>}
                {visibleColumns.impressions && <td className="p-3 text-right font-mono">{formatNumber(totals.impressions)}</td>}
                {visibleColumns.margin && <td className="p-3 text-right font-mono">{formatPercent(totalMargin || 0)}</td>}
                {visibleColumns.cpm && <td className="p-3 text-right font-mono">{totalCpm ? formatCurrency(totalCpm) : "—"}</td>}
                {visibleColumns.clicks && <td className="p-3 text-right font-mono">{formatNumber(totals.clicks)}</td>}
                {visibleColumns.cpc && <td className="p-3 text-right font-mono">{totalCpc ? formatCurrency(totalCpc) : "—"}</td>}
                {visibleColumns.ctr && <td className="p-3 text-right font-mono">{formatPercent(totalCtr || 0)}</td>}
                {visibleColumns.ic && <td className="p-3 text-right font-mono">{formatNumber(totals.ic)}</td>}
                {visibleColumns.cpi && <td className="p-3 text-right font-mono">{totalCpi ? formatCurrency(totalCpi) : "—"}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
