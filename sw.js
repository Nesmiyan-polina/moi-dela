const CACHE='my-deals-shell-v4';
const SHELL=[
  './','./index.html','./style.css','./app.js','./firebase-config.js',
  './manifest.webmanifest','./favicon.svg','./icons/icon-180.png',
  './icons/icon-192.png','./icons/icon-512.png',
  './vendor/firebase-app.js','./vendor/firebase-auth.js','./vendor/firebase-firestore.js'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode==='navigate') {
    event.respondWith(fetch(request).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached || fetch(request)));
});
