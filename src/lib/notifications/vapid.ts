import webpush from "web-push";

const DEFAULT_VAPID_PUBLIC_KEY =
  "BN2h0bCB5b-qFtRnkOGxOpYzMfmqqZebEc3sFPaABSisu10kthJh1w0RBlbauu1BWUgss_8fy7EAGYpXgTfUNr0";
const DEFAULT_VAPID_PRIVATE_KEY =
  "oNLzGaCjHvAxylRONvFCTsSRhCtdA3Y2GHkp5dhwNsc";
const DEFAULT_VAPID_SUBJECT = "mailto:suporte@utmtrack.com";

let vapidInitialized = false;

export function getVapidPublicKey(): string {
  return (
    process.env.VAPID_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    DEFAULT_VAPID_PUBLIC_KEY
  );
}

export function getVapidPrivateKey(): string {
  return process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY;
}

export function getVapidSubject(): string {
  return process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT;
}

export function initVapid(): void {
  if (vapidInitialized) return;

  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();
  const subject = getVapidSubject();

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidInitialized = true;
  } catch (error) {
    console.error("[VAPID] Erro ao inicializar chaves VAPID:", error);
  }
}

export { webpush };