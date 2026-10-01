"use client";

import { useEffect, useState } from "react";
import { initializeNativePush, isNativePlatform } from "@/lib/mobile/native-bridge";
import {
  isWebPushSupported,
  getNotificationPermission,
  registerServiceWorker,
  subscribePwaPush,
  setupPushMessageListener,
} from "@/lib/mobile/pwa-push";
import { playNotificationSound } from "@/lib/sound";
import { Bell, CheckCircle2, Sparkles, X, AlertCircle } from "lucide-react";

export function MobileClientInit() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // 1. Se estiver rodando dentro do Capacitor Nativo (APK Android / iOS)
    if (isNativePlatform()) {
      initializeNativePush();
      return;
    }

    // 2. Se for PWA / Navegador (Android Chrome, Desktop, iOS 16.4+)
    if (isWebPushSupported()) {
      registerServiceWorker();
      setupPushMessageListener();

      const perm = getNotificationPermission();

      // Se já possui permissão concedida anteriormente, renova/garante o token no backend silenciosamente
      if (perm === "granted") {
        subscribePwaPush().catch((err) => {
          console.debug("[PWA] Erro ao sincronizar token existente:", err);
        });
      } else if (perm === "default") {
        // Verifica se o usuário não dispensou o aviso nesta sessão
        const dismissed = sessionStorage.getItem("utmtrack_pwa_notif_dismissed");
        if (!dismissed) {
          // Exibe o banner após 1.5s para não conflitar com o carregamento inicial
          const timer = setTimeout(() => {
            setShowPrompt(true);
          }, 1500);
          return () => clearTimeout(timer);
        }
      }
    }
  }, []);

  const handleActivate = async () => {
    setIsActivating(true);
    setErrorMessage(null);

    try {
      const result = await subscribePwaPush();

      if (result.success) {
        setIsSuccess(true);
        // Toca o som de validação
        playNotificationSound("som_venda_aprovada");

        // Dispara uma notificação de teste real pelo servidor para confirmar o push no Android
        try {
          await fetch("/api/notifications/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "sale_approved",
              title: "💰 Notificações Ativadas!",
              message: "Seu celular Android agora receberá alertas de vendas e Pix em tempo real.",
            }),
          });
        } catch (e) {
          console.debug("[PWA] Teste disparado:", e);
        }

        setTimeout(() => {
          setShowPrompt(false);
        }, 3000);
      } else {
        if (result.permission === "denied") {
          setErrorMessage(
            "Permissão bloqueada no navegador. Toque no ícone de cadeado/configurações ao lado da URL para permitir notificações."
          );
        } else {
          setErrorMessage(result.error || "Não foi possível ativar as notificações.");
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Erro inesperado.");
    } finally {
      setIsActivating(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    sessionStorage.setItem("utmtrack_pwa_notif_dismissed", "true");
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-6 sm:w-96 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="bg-slate-900/95 dark:bg-slate-900/95 border border-sky-500/40 text-white rounded-2xl p-4 shadow-2xl backdrop-blur-md relative overflow-hidden">
        {/* Glow de destaque */}
        <div className="absolute -top-10 -right-10 w-28 h-28 bg-sky-500/20 rounded-full blur-2xl pointer-events-none" />

        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-slate-400 hover:text-white p-1 rounded-lg transition"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {isSuccess ? (
          <div className="flex items-center gap-3 py-1">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm font-bold text-emerald-300">Notificações Ativadas!</div>
              <div className="text-xs text-slate-300">
                Seu aparelho agora receberá alertas sonoros instantâneos de cada venda.
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0 mt-0.5">
                <Bell className="w-5 h-5 animate-bounce" />
              </div>
              <div className="pr-4">
                <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 uppercase tracking-wider mb-0.5">
                  <Sparkles className="w-3 h-3" /> Alertas no Celular Android
                </div>
                <h4 className="text-sm font-bold text-white leading-tight">
                  Ativar Notificações de Vendas?
                </h4>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Receba o som de venda aprovada (Cha-ching) e alertas de Pix em tempo real, mesmo com o app fechado.
                </p>
              </div>
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-950/50 border border-red-800/60 text-red-200 text-xs">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleActivate}
                disabled={isActivating}
                className="flex-1 py-2 px-3 bg-sky-500 hover:bg-sky-400 disabled:bg-sky-600 text-slate-950 font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
              >
                {isActivating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    Ativando...
                  </>
                ) : (
                  <>
                    <Bell className="w-3.5 h-3.5" />
                    Ativar Notificações
                  </>
                )}
              </button>
              <button
                onClick={handleDismiss}
                className="py-2 px-3 text-xs font-medium text-slate-300 hover:text-white rounded-xl hover:bg-white/5 transition"
              >
                Depois
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
