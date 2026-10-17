/* Kasboek – service worker: laat de app zonder internet werken en haalt updates op.
   Een nieuwe versie wordt pas actief als je in de app op "Bijwerken" tikt. */
"use strict";
const VERSION = "2026.10.17-1";
const CACHE = "kasboek-" + VERSION;
const FILES = [
  "./", "./index.html", "./runtime.js", "./manifest.webmanifest", "./fonts.css",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
  "./jspdf.umd.min.js", "./pdf.min.mjs", "./pdf.worker.min.mjs", "./read-excel-file.min.js",
  "./bricolage-grotesque-latin-500-normal.woff2", "./bricolage-grotesque-latin-700-normal.woff2",
  "./ibm-plex-sans-latin-400-normal.woff2", "./ibm-plex-sans-latin-500-normal.woff2", "./ibm-plex-sans-latin-600-normal.woff2",
  "./ibm-plex-mono-latin-400-normal.woff2", "./ibm-plex-mono-latin-500-normal.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache:"reload"})))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("kasboek-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); if (e.data === "version") e.source?.postMessage({version:VERSION}); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;   // alleen eigen bestanden; niets van buiten
  e.respondWith(caches.open(CACHE).then(async c => {
    const key = e.request.mode === "navigate" ? "./index.html" : e.request;
    const hit = await c.match(key, {ignoreSearch:true});
    if (hit) return hit;
    try{ return await fetch(e.request); }catch(err){ return (await c.match("./index.html")) || Response.error(); }
  }));
});
