// Hoja Seeds Web Push service worker (HS-20260819-03).
// Scope: site root (registered as /push-sw.js). Handles only push display
// and notification-click routing — no offline caching, no asset
// interception, so it cannot affect normal page loads or Lighthouse
// scoring for anything else on the site.

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "Hoja Seeds";
  const options = {
    body: data.body || "",
    icon: data.icon || "/assets/logo/hoja-seeds-logo@256.png",
    badge: "/assets/logo/hoja-seeds-favicon-64.png",
    image: data.image || undefined,
    data: { targetUrl: data.targetUrl || "https://www.hojaseeds.pk/", campaignId: data.campaignId || "", visitorId: data.visitorId || "" },
    tag: data.campaignId || undefined
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.targetUrl) || "https://www.hojaseeds.pk/";
  const campaignId = (event.notification.data && event.notification.data.campaignId) || "";
  const visitorId = (event.notification.data && event.notification.data.visitorId) || "";

  event.waitUntil((async () => {
    // Focus an existing Hoja tab if one is open, otherwise open a new one,
    // navigating either way to the campaign's target URL.
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clientsList.find(c => c.url.indexOf("hojaseeds.pk") !== -1);
    if (existing) {
      existing.navigate(targetUrl).catch(() => {});
      existing.focus();
    } else {
      await self.clients.openWindow(targetUrl);
    }
    // Best-effort click telemetry -- never blocks navigation. The service
    // worker has no access to CONFIG.SHEET_WEBHOOK_URL, so a real send
    // implementation must embed it in the push payload as
    // notification.data.webhookUrl for this to actually report clicks.
    try {
      const hookUrl = (event.notification.data && event.notification.data.webhookUrl) || null;
      if (hookUrl && visitorId) {
        await fetch(hookUrl, {
          method: "POST",
          body: JSON.stringify({ type: "pushEvent", visitorId: visitorId, campaignId: campaignId, eventType: "notification_click" })
        }).catch(() => {});
      }
    } catch (e) { /* telemetry is best-effort only */ }
  })());
});
