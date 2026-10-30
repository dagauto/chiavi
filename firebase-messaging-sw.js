// Service worker delle notifiche push del registro chiavi Dag Auto.
self.window = self;
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("./config.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((p) => {
  const d = p.data || {};
  return self.registration.showNotification(d.title || "Chiavi Dag Auto", {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || undefined,
    data: { link: d.link || "./" },
  });
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
      for (const w of ws) if (w.url.startsWith(self.registration.scope)) { w.focus(); return w.navigate(link); }
      return clients.openWindow(link);
    })
  );
});
