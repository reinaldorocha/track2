"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function IntegrationsUtmRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/integrations?tab=UTMs");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Redirecionando para a Central Unificada de Integrações...
        </p>
        <p className="text-xs text-slate-400">
          O gerenciamento de UTMs e Tracker agora está centralizado em Integrações.
        </p>
      </div>
    </div>
  );
}
