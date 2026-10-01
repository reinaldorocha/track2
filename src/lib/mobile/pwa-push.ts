import { playNotificationSound, SoundType } from "@/lib/sound";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    return registration;
  } catch (error) {
    console.error("[PWA] Erro ao registrar Service Worker:", error);
    return null;
  }
}

export async function subscribePwaPush(): Promise<{
  success: boolean;
  permission?: NotificationPermission;
  error?: string;
  subscription?: PushSubscription;
}> {
  if (!isWebPushSupported()) {
    return { success: false, error: "Web Push não suportado neste navegador." };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        success: false,
        permission,
        error: "Permissão de notificações não concedida pelo usuário.",
      };
    }

    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reg = (await registerServiceWorker()) || undefined;
    }
    if (!reg) {
      return { success: false, error: "Falha ao inicializar o Service Worker." };
    }

    await navigator.serviceWorker.ready;

    const keyRes = await fetch("/api/notifications/vapid-public-key");
    if (!keyRes.ok) {
      throw new Error("Não foi possível obter a chave pública VAPID do servidor.");
    }
    const { publicKey } = await keyRes.json();

    if (!publicKey) {
      throw new Error("Chave VAPID não configurada no servidor.");
    }

    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as any,
      });
    }

    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const platformName = isAndroid ? "android" : isIOS ? "ios" : "web";
    const deviceLabel = isAndroid
      ? "Android PWA (Chrome)"
      : isIOS
      ? "iOS PWA (Safari)"
      : "Navegador Web PWA";

    const regResponse = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: JSON.stringify(subscription),
        platform: platformName,
        deviceName: deviceLabel,
      }),
    });

    if (!regResponse.ok) {
      const errData = await regResponse.json().catch(() => ({}));
      console.warn("[PWA] Aviso ao salvar dispositivo:", errData);
    }

    return { success: true, permission, subscription };
  } catch (error: any) {
    console.error("[PWA] Erro ao subscrever para Web Push:", error);
    return {
      success: false,
      error: error.message || "Erro desconhecido ao ativar notificações.",
    };
  }
}

let listenerInitialized = false;

export function setupPushMessageListener() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (listenerInitialized) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "PUSH_RECEIVED") {
      const sound = (event.data.sound || "som_venda_aprovada") as SoundType;
      playNotificationSound(sound);
    }
  });

  listenerInitialized = true;
}