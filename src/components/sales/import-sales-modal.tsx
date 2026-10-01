"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  X,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Loader2,
  DollarSign,
  Info
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ImportSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface PreviewRow {
  date: string;
  product: string;
  customerName: string;
  customerEmail: string;
  status: string;
  paymentMethod: string;
  currency: string;
  netAmount: number;
  grossAmount: number;
}

interface ImportResultData {
  success: boolean;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  skippedCount: number;
  stats: {
    totalGross: number;
    totalNet: number;
    countApproved: number;
    countPending: number;
    countRefunded: number;
    countCancelled: number;
    countChargeback: number;
    minDate: string | null;
    maxDate: string | null;
    uniqueProducts: string[];
  };
  errors?: string[];
}

export function ImportSalesModal({ isOpen, onClose, onSuccess }: ImportSalesModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [previewData, setPreviewData] = useState<{ totalRows: number; sample: PreviewRow[] } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Opções
  const [triggerCapi, setTriggerCapi] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(true);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage("Por favor, selecione um arquivo no formato CSV (.csv).");
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);
    setIsPreviewLoading(true);
    setPreviewData(null);
    setImportResult(null);

    try {
      const text = await file.text();
      setCsvText(text);

      // Chamar endpoint de preview
      const res = await fetch("/api/sales/import-csv?action=preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: text, action: "preview" }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Não foi possível interpretar o CSV. Verifique as colunas.");
      }

      setPreviewData({
        totalRows: data.totalRows,
        sample: data.sample || [],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar pré-visualização do arquivo.";
      setErrorMessage(msg);
      setSelectedFile(null);
      setPreviewData(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!csvText) throw new Error("Nenhum arquivo CSV carregado");

      const res = await fetch("/api/sales/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          triggerCapi,
          updateExisting,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Falha na importação do CSV.");
      }
      return data as ImportResultData;
    },
    onSuccess: (data) => {
      setImportResult(data);
      // Invalida dados da aplicação para atualizar na hora
      queryClient.invalidateQueries({ queryKey: ["sales-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
      queryClient.invalidateQueries({ queryKey: ["hourly-sales"] });
      if (onSuccess) onSuccess();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Erro ao importar vendas.";
      setErrorMessage(msg);
    },
  });

  const resetModal = () => {
    setSelectedFile(null);
    setCsvText("");
    setPreviewData(null);
    setImportResult(null);
    setErrorMessage(null);
    setIsPreviewLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                Importar Vendas da Getfy via CSV
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                  Getfy
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Envie o arquivo .csv gerado na Getfy para conciliar faturamento, clientes e produtos.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Erro no processamento</p>
                <p className="text-[11px] mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Resultado de Sucesso */}
          {importResult ? (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-center space-y-1.5">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-bold">Importação Concluída com Sucesso!</h3>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {importResult.createdCount + importResult.updatedCount} vendas processadas no seu workspace.
                </p>
              </div>

              {/* Grid de Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800">
                  <span className="text-gray-500 text-[11px]">Novas Vendas:</span>
                  <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
                    {importResult.createdCount}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800">
                  <span className="text-gray-500 text-[11px]">Atualizadas:</span>
                  <p className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
                    {importResult.updatedCount}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800">
                  <span className="text-gray-500 text-[11px]">Faturamento Líquido:</span>
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {formatCurrency(importResult.stats.totalNet)}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800">
                  <span className="text-gray-500 text-[11px]">Aprovadas:</span>
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {importResult.stats.countApproved}
                  </p>
                </div>
              </div>

              {/* Métricas por Status */}
              <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-2">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Status dos Pedidos Importados:</span>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
                    Aprovadas: {importResult.stats.countApproved}
                  </span>
                  <span className="px-2 py-1 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-medium">
                    Pendentes: {importResult.stats.countPending}
                  </span>
                  <span className="px-2 py-1 rounded-md bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 font-medium">
                    Canceladas/Recusadas: {importResult.stats.countCancelled}
                  </span>
                  {importResult.stats.countRefunded > 0 && (
                    <span className="px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-medium">
                      Reembolsadas: {importResult.stats.countRefunded}
                    </span>
                  )}
                </div>
                {importResult.stats.minDate && (
                  <p className="text-[11px] text-gray-500 pt-1 border-t border-gray-200 dark:border-gray-800">
                    Período coberto: <strong className="text-gray-700 dark:text-gray-300">{importResult.stats.minDate}</strong> até <strong className="text-gray-700 dark:text-gray-300">{importResult.stats.maxDate}</strong>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Dropzone de Arquivo */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  selectedFile
                    ? "border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10"
                    : "border-gray-300 dark:border-gray-700 hover:border-emerald-500 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-full text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">{selectedFile.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {(selectedFile.size / 1024).toFixed(1)} KB — Clique para trocar de arquivo
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500 dark:text-gray-400">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">
                        Clique para escolher o arquivo CSV da Getfy
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Exportado diretamente da plataforma Getfy (delimitador ponto-e-vírgula ou vírgula)
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Loading da Pré-visualização */}
              {isPreviewLoading && (
                <div className="flex items-center justify-center gap-2 p-4 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>Analisando estrutura e colunas do CSV...</span>
                </div>
              )}

              {/* Tabela de Pré-visualização */}
              {previewData && (
                <div className="space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      {previewData.totalRows} vendas identificadas no arquivo
                    </span>
                    <span className="text-[11px] text-gray-500">Prévia das primeiras 5 linhas</span>
                  </div>

                  <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-800/70 border-b border-gray-200 dark:border-gray-800 text-gray-500">
                            <th className="p-2 font-medium">Data</th>
                            <th className="p-2 font-medium">Produto</th>
                            <th className="p-2 font-medium">Cliente</th>
                            <th className="p-2 font-medium">Status</th>
                            <th className="p-2 font-medium">Método</th>
                            <th className="p-2 font-medium text-right">Valor Bruto</th>
                            <th className="p-2 font-medium text-right">Valor Líquido</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                          {previewData.sample.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                              <td className="p-2 whitespace-nowrap font-mono text-gray-600 dark:text-gray-300">
                                {row.date}
                              </td>
                              <td className="p-2 font-medium text-gray-900 dark:text-white max-w-[160px] truncate" title={row.product}>
                                {row.product}
                              </td>
                              <td className="p-2 text-gray-600 dark:text-gray-300 max-w-[120px] truncate" title={row.customerName || row.customerEmail}>
                                {row.customerName || row.customerEmail}
                              </td>
                              <td className="p-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    row.status.toLowerCase().includes("pago") || row.status.toLowerCase().includes("aprovado")
                                      ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                      : row.status.toLowerCase().includes("pendente")
                                      ? "bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300"
                                      : "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"
                                  }`}
                                >
                                  {row.status}
                                </span>
                              </td>
                              <td className="p-2 font-medium text-gray-600 dark:text-gray-300">
                                {row.paymentMethod}
                              </td>
                              <td className="p-2 text-right font-medium text-gray-900 dark:text-white">
                                {formatCurrency(row.grossAmount, row.currency)}
                              </td>
                              <td className="p-2 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(row.netAmount, row.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Opções de Importação */}
                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800 space-y-2.5">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={updateExisting}
                        onChange={(e) => setUpdateExisting(e.target.checked)}
                        className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-gray-200">
                          Atualizar pedidos se já existirem no sistema
                        </p>
                        <p className="text-[11px] text-gray-500">
                          Identifica vendas duplicadas e atualiza o status caso tenha mudado (ex: Pendente para Pago).
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 cursor-pointer pt-2 border-t border-gray-200/60 dark:border-gray-700/60">
                      <input
                        type="checkbox"
                        checked={triggerCapi}
                        onChange={(e) => setTriggerCapi(e.target.checked)}
                        className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                          Disparar para Meta Conversions API (CAPI)
                        </p>
                        <p className="text-[11px] text-gray-500">
                          Mantenha desmarcado para vendas históricas/antigas para não reenviar conversões passadas ao Meta Ads.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
          {importResult ? (
            <button
              onClick={handleClose}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow transition flex items-center justify-center gap-2"
            >
              Concluir e Ver Vendas
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                disabled={importMutation.isPending}
                className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => importMutation.mutate()}
                disabled={!selectedFile || !previewData || importMutation.isPending}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition flex items-center gap-2"
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Importando Vendas...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>
                      {previewData ? `Importar ${previewData.totalRows} Vendas` : "Importar Vendas"}
                    </span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
