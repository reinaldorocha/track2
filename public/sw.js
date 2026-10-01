// UTM-Track Service Worker para PWA e Push Notifications (Android / iOS / Web)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: "UTM-Track",
        body: event.data.text(),
      };
    }
  } else {
    data = {
      title: "UTM-Track",
      body: "Você recebeu uma nova atualização no UTM-Track.",
    };
  }

  const title = data.title || "UTM-Track";
  const deepLink =
    data.deepLink ||
    (data.saleId ? `/sales/${data.saleId}` : "/notifications");

  const options = {
    body: data.body || "Nova notificação de vendas",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/brand/notifications/notification-badge-96.png",
    vibrate: [200, 100, 200, 100, 200],
    tag: data.notificationId || `utm-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: deepLink,
      sound: data.sound || "som_venda_aprovada",
      saleId: data.saleId,
      amount: data.amount,
      currency: data.currency || "BRL",
      product: data.product,
    },
    actions: [
      {
        action: "open",
        title: "Ver Venda",
      },
    ],
  };

  const showPromise = self.registration.showNotification(title, options);

  const broadcastPromise = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({
          type: "PUSH_RECEIVED",
          sound: data.sound || "som_venda_aprovada",
          payload: data,
        });
      });
    });

  event.waitUntil(Promise.all([showPromise, broadcastPromise]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/notifications";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) {
              return client.navigate(targetUrl);
            }
            return client;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});