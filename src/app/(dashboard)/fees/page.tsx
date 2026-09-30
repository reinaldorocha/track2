"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Percent, Edit, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type Fee = {
  id: string;
  name: string;
  type: string;
  percentage: number;
  fixedAmount: number;
  platform?: string;
  isActive: boolean;
};

const FEE_TYPES = [
  { value: "gateway", label: "Gateway de Pagamento" },
  { value: "checkout", label: "Checkout" },
  { value: "platform", label: "Plataforma" },
  { value: "other", label: "Outros" },
];

const PLATFORMS = [
  { value: "", label: "Todas" },
  { value: "hotmart", label: "Hotmart" },
  { value: "yampi", label: "Yampi" },
  { value: "shopify", label: "Shopify" },
  { value: "cacto", label: "Cacto" },
];

function FeeModal({ fee, onClose, onSave }: { fee?: Fee | null; onClose: () => void; onSave: (d: Partial<Fee>) => void }) {
  const [form, setForm] = useState({
    name: fee?.name || "",
    type: fee?.type || "gateway",
    percentage: fee?.percentage?.toString() || "0",
    fixedAmount: fee?.fixedAmount?.toString() || "0",
    platform: fee?.platform || "",
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">{fee ? "Editar Taxa" : "Nova Taxa"}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              placeholder="Ex: Taxa Hotmart" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                {FEE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plataforma</label>
              <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">% Percentual</label>
              <div className="relative">
                <input type="number" step="0.01" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })}
                  className="w-full pl-3 pr-8 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Fixo (R$)</label>
              <input type="number" step="0.01" value={form.fixedAmount} onChange={(e) => setForm({ ...form, fixedAmount: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">A taxa será aplicada como: (valor × percentual/100) + valor fixo</p>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button onClick={() => onSave({ ...form, percentage: parseFloat(form.percentage) || 0, fixedAmount: parseFloat(form.fixedAmount) || 0 })}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Salvar</button>
        </div>
      </div>
    </div>
  );
}

export default function FeesPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingFee, setEditingFee] = useState<Fee | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ fees: Fee[] }>({
    queryKey: ["fees"],
    queryFn: () => fetch("/api/fees").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: Partial<Fee>) =>
      fetch("/api/fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["fees"] }); setShowModal(false); },
  });

  const fees = data?.fees || [];

  const calcFeeOnSale = (fee: Fee, saleValue: number) =>
    (saleValue * fee.percentage) / 100 + fee.fixedAmount;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Taxas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure as taxas de gateway e plataforma para cálculo preciso do lucro</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="h-4 w-4" />Nova Taxa
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Plataforma</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">% Percentual</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Valor Fixo</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Exemplo R$100</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : fees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Percent className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-gray-500 dark:text-gray-400">Nenhuma taxa cadastrada</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Adicione taxas para calcular o lucro líquido com precisão</p>
                  </td>
                </tr>
              ) : (
                fees.map((fee) => (
                  <tr key={fee.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{fee.name}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {FEE_TYPES.find((t) => t.value === fee.type)?.label || fee.type}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {PLATFORMS.find((p) => p.value === fee.platform)?.label || "Todas"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{fee.percentage}%</td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrency(fee.fixedAmount)}</td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatCurrency(calcFeeOnSale(fee, 100))}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditingFee(fee)} className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
                          <Edit className="h-4 w-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && <FeeModal onClose={() => setShowModal(false)} onSave={(d) => createMutation.mutate(d)} />}
      {editingFee && <FeeModal fee={editingFee} onClose={() => setEditingFee(null)} onSave={(d) => { console.log("update", d); setEditingFee(null); }} />}
    </div>
  );
}
