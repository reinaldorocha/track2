"use client";

import { useState, useEffect } from "react";
import { X, DollarSign, CreditCard, Tag, User, Save, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { UtmTrackSymbol } from "@/components/brand/symbol";

export type EditableSaleData = {
  id: string;
  externalId: string;
  externalRef?: string | null;
  platform: string;
  status: "approved" | "pending" | "refunded" | "chargeback" | "cancelled" | string;
  grossAmount: number;
  netAmount: number;
  currency?: string;
  paymentMethod?: string | null;
  installments?: number | null;
  customerEmail?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
};

interface EditSaleModalProps {
  sale: EditableSaleData | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (updatedSale: any) => void;
}

export function EditSaleModal({ sale, isOpen, onClose, onSuccess }: EditSaleModalProps) {
  const [grossAmount, setGrossAmount] = useState<string>("");
  const [netAmount, setNetAmount] = useState<string>("");
  const [status, setStatus] = useState<string>("approved");
  const [paymentMethod, setPaymentMethod] = useState<string>("pix");
  const [installments, setInstallments] = useState<number>(1);
  const [customerEmail, setCustomerEmail] = useState<string>("");
  const [externalId, setExternalId] = useState<string>("");
  const [utmCampaign, setUtmCampaign] = useState<string>("");
  const [utmSource, setUtmSource] = useState<string>("");
  const [utmMedium, setUtmMedium] = useState<string>("");
  const [utmContent, setUtmContent] = useState<string>("");
  const [utmTerm, setUtmTerm] = useState<string>("");
  const [recalculateNet, setRecalculateNet] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (sale) {
      setGrossAmount(sale.grossAmount?.toFixed(2) ?? "0.00");
      setNetAmount(sale.netAmount?.toFixed(2) ?? "0.00");
      setStatus(sale.status || "approved");
      setPaymentMethod(sale.paymentMethod || "pix");
      setInstallments(sale.installments || 1);
      setCustomerEmail(sale.customerEmail || "");
      setExternalId(sale.externalId || "");
      setUtmCampaign(sale.utmCampaign || "");
      setUtmSource(sale.utmSource || "");
      setUtmMedium(sale.utmMedium || "");
      setUtmContent(sale.utmContent || "");
      setUtmTerm(sale.utmTerm || "");
      setRecalculateNet(false);
      setError(null);
      setSuccess(false);
    }
  }, [sale]);

  if (!isOpen || !sale) return null;

  const handleGrossChange = (val: string) => {
    setGrossAmount(val);
    if (recalculateNet) {
      // Deixar recálculo para a API
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const parsedGross = parseFloat(grossAmount.replace(",", "."));
    const parsedNet = parseFloat(netAmount.replace(",", "."));

    if (isNaN(parsedGross) || parsedGross < 0) {
      setError("Valor bruto inválido. Digite um número positivo.");
      setIsLoading(false);
      return;
    }

    try {
      const payload: any = {
        grossAmount: parsedGross,
        status,
        paymentMethod: paymentMethod || null,
        installments: Number(installments) || 1,
        externalId: externalId.trim(),
        customerEmail: customerEmail.trim() || null,
        utmCampaign: utmCampaign.trim() || null,
        utmSource: utmSource.trim() || null,
        utmMedium: utmMedium.trim() || null,
        utmContent: utmContent.trim() || null,
        utmTerm: utmTerm.trim() || null,
        recalculateNet,
      };

      if (!recalculateNet) {
        if (!isNaN(parsedNet) && parsedNet >= 0) {
          payload.netAmount = parsedNet;
        }
      }

      const res = await fetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar alterações da venda");
      }

      setSuccess(true);
      if (onSuccess) {
        onSuccess(data.sale);
      }
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || "Falha ao atualizar venda");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <UtmTrackSymbol size={26} />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Editar Dados da Venda</h2>
              <span className="uppercase text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/50">
                {sale.platform}
              </span>
            </div>
            <p className="text-xs text-gray-500 font-mono">
              ID Interno: {sale.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Venda atualizada com sucesso!</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          {/* Seção Financeira */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              Valores Financeiros
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Valor Bruto (R$) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-gray-400 font-bold">R$</span>
                  <input
                    type="text"
                    required
                    value={grossAmount}
                    onChange={(e) => handleGrossChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-9 pr-3 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Valor Líquido (R$) *
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                    <input
                      type="checkbox"
                      checked={recalculateNet}
                      onChange={(e) => setRecalculateNet(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Auto (pelas taxas)</span>
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-gray-400 font-bold">R$</span>
                  <input
                    type="text"
                    disabled={recalculateNet}
                    value={recalculateNet ? "Calculado ao salvar..." : netAmount}
                    onChange={(e) => setNetAmount(e.target.value)}
                    placeholder="0.00"
                    className={`w-full pl-9 pr-3 py-2 text-sm font-semibold rounded-lg border ${
                      recalculateNet
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed border-dashed"
                        : "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 border-gray-300 dark:border-gray-700"
                    } focus:ring-2 focus:ring-blue-500 focus:outline-none`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Status e Forma de Pagamento */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <CreditCard className="w-4 h-4 text-blue-500" />
              Status e Pagamento
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="approved">Aprovada</option>
                  <option value="pending">Pendente / Pix</option>
                  <option value="refunded">Reembolsada</option>
                  <option value="chargeback">Chargeback</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Forma de Pagamento
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="pix">Pix</option>
                  <option value="card">Cartão de Crédito</option>
                  <option value="boleto">Boleto Bancário</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Parcelas
                </label>
                <select
                  disabled={paymentMethod !== "card"}
                  value={paymentMethod === "card" ? installments : 1}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}x {n === 1 ? "(À vista)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Dados do Pedido e Cliente */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <User className="w-4 h-4 text-purple-500" />
              Identificação &amp; Cliente
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ID Externo / Transação
                </label>
                <input
                  type="text"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder="Ex: 362 ou ch_123456"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  E-mail do Cliente
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="cliente@exemplo.com"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Marketing & UTMs */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-sky-500" />
              Parâmetros de Campanha &amp; UTMs
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-100 dark:border-gray-800">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  UTM Campaign
                </label>
                <input
                  type="text"
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="Ex: campanha_natal"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-[#0066FF] dark:text-[#00D4FF] focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  UTM Source
                </label>
                <input
                  type="text"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  placeholder="Ex: meta, facebook, google"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  UTM Medium
                </label>
                <input
                  type="text"
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                  placeholder="Ex: cpc, stories, feed"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  UTM Content
                </label>
                <input
                  type="text"
                  value={utmContent}
                  onChange={(e) => setUtmContent(e.target.value)}
                  placeholder="Ex: video01, banner_azul"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  UTM Term
                </label>
                <input
                  type="text"
                  value={utmTerm}
                  onChange={(e) => setUtmTerm(e.target.value)}
                  placeholder="Ex: publico_lookalike"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || success}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-sm transition"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Salvar Alterações</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
