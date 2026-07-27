// public/share-sw.js
// Service worker minimal : son SEUL rôle est de récupérer la vidéo partagée
// depuis la galerie Android (POST vers /share-target) et de la transmettre
// à l'application. Il ne touche à rien d'autre.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // On n'intercepte QUE le partage entrant
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShare(event.request));
  }
  // Tout le reste : comportement normal du navigateur (on ne fait rien)
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('video');

    if (file && file.size > 0) {
      // On stocke la vidéo dans un cache temporaire, l'appli ira la chercher
      const cache = await caches.open('shared-media');
      await cache.put(
        '/shared-video',
        new Response(file, {
          headers: { 'Content-Type': file.type || 'video/mp4' },
        })
      );
    }
    // On redirige vers l'appli avec un drapeau
    return Response.redirect('/?shared=video', 303);
  } catch (e) {
    return Response.redirect('/?shared=error', 303);
  }
}
