/* Kasboek – lokale opslag en hulpfuncties op het toestel.
   Vervangt de claude.ai-functies (database, bijlagen, downloads, bonnen uitlezen)
   door versies die alleen op dit toestel werken. Er gaat niets naar een server,
   behalve als je zelf een API-sleutel invult voor het uitlezen van bonnen. */
"use strict";
(function(){
  const DB_NAME = "kasboek", DB_VER = 1;
  let dbp = null;
  function openDB(){
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs");      // sleutel: "collectie/id"
        if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets");  // sleutel: asset-id
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");      // instellingen van dit toestel
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(Object.assign(new Error("blocked"), {code:"unavailable"}));
    });
    return dbp;
  }
  function tx(store, mode, fn){
    return openDB().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store); let out;
      Promise.resolve(fn(s)).then(v => out = v);
      t.oncomplete = () => res(out);
      t.onerror = () => rej(mapErr(t.error));
      t.onabort = () => rej(mapErr(t.error));
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function mapErr(e){ const n = e?.name || ""; return Object.assign(e instanceof Error ? e : new Error(String(n || e)), {code: n === "QuotaExceededError" ? "quota_exceeded" : "unavailable"}); }
  const rid = () => { const a = new Uint8Array(10); crypto.getRandomValues(a); return [...a].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); };
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));

  /* ---------- database (zelfde vorm als de claude.ai-database) ---------- */
  const cache = new Map();          // collectie -> Map(id -> data)
  const listeners = new Map();      // collectie -> Set(callback)
  const docListeners = new Map();   // "col/id" -> Set(callback)
  let loaded = null;
  function loadAll(){
    if (loaded) return loaded;
    loaded = tx("docs", "readonly", s => Promise.all([req(s.getAllKeys()), req(s.getAll())])).then(([keys, vals]) => {
      keys.forEach((k, i) => { const p = String(k).indexOf("/"); const col = k.slice(0, p), id = k.slice(p + 1); if (!cache.has(col)) cache.set(col, new Map()); cache.get(col).set(id, vals[i]); });
    });
    return loaded;
  }
  const colMap = c => { if (!cache.has(c)) cache.set(c, new Map()); return cache.get(c); };
  const pending = new Set(); let flushQ = false;
  function notify(col, id){
    pending.add(col + "\u0000" + id);
    if (flushQ) return; flushQ = true;
    queueMicrotask(() => { flushQ = false; const items = [...pending]; pending.clear(); const cols = new Set();
      for (const it of items){ const [c, i] = it.split("\u0000"); cols.add(c); const dl = docListeners.get(c + "/" + i); if (dl) for (const cb of dl) emitDoc(c, i, cb); }
      for (const c of cols){ const ls = listeners.get(c); if (ls) for (const cb of ls) emitCol(c, cb); } });
  }
  function emitCol(col, cb){ const m = colMap(col); const docs = [...m.entries()].map(([id, d]) => ({id, data: () => clone(d), exists:true})); try{ cb({docs, size:docs.length, empty:!docs.length}); }catch(e){ console.error(e); } }
  function emitDoc(col, id, cb){ const d = colMap(col).get(id); try{ cb({id, exists: d !== undefined, data: () => clone(d)}); }catch(e){ console.error(e); } }
  async function write(col, id, data){ await loadAll(); await tx("docs", "readwrite", s => s.put(data, col + "/" + id)); colMap(col).set(id, data); notify(col, id); }
  async function remove(col, id){ await loadAll(); await tx("docs", "readwrite", s => s.delete(col + "/" + id)); colMap(col).delete(id); notify(col, id); }
  function docRef(col, id){
    return {
      id,
      async set(data){ await write(col, id, clone(data)); },
      async update(data){ await loadAll(); const cur = colMap(col).get(id); if (cur === undefined) throw Object.assign(new Error("not found"), {code:"not_found"}); await write(col, id, {...cur, ...clone(data)}); },
      async delete(){ await remove(col, id); },
      async get(){ await loadAll(); const d = colMap(col).get(id); return {id, exists: d !== undefined, data: () => clone(d)}; },
      onSnapshot(cb, err){ const k = col + "/" + id; if (!docListeners.has(k)) docListeners.set(k, new Set()); docListeners.get(k).add(cb); loadAll().then(() => emitDoc(col, id, cb), e => err && err(e)); return () => docListeners.get(k).delete(cb); }
    };
  }
  const db = {
    collection(col){ return {
      doc(id){ return docRef(col, id || rid()); },
      onSnapshot(cb, err){ if (!listeners.has(col)) listeners.set(col, new Set()); listeners.get(col).add(cb); loadAll().then(() => emitCol(col, cb), e => err && err(e)); return () => listeners.get(col).delete(cb); },
      async get(){ await loadAll(); const m = colMap(col); return {docs:[...m.entries()].map(([id, d]) => ({id, data: () => clone(d)}))}; }
    }; },
    doc(path){ const [col, id] = String(path).split("/"); return docRef(col, id); }
  };

  /* ---------- bijlagen (foto's van bonnen, pdf's) ---------- */
  const urls = new Map();
  async function shrinkImage(file){
    // grote foto's verkleinen tot max. 2000 px (leesbaar, maar veel kleiner op je telefoon en in back-ups)
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 700 * 1024) return file;
    try{
      const bmp = await createImageBitmap(file, {imageOrientation:"from-image"});
      const sc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      if (sc === 1 && file.size < 1.5 * 1024 * 1024) return file;
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const b = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
      return b && b.size < file.size ? b : file;
    }catch(e){ return file; }
  }
  const assets = {
    async upload(file){
      const blob = await shrinkImage(file);
      const id = rid() + rid();
      const type = blob.type || file.type || "application/octet-stream";
      await tx("assets", "readwrite", s => s.put({blob, type, name:file.name || "", size:blob.size, added:new Date().toISOString()}, id));
      urls.set(id, URL.createObjectURL(blob));
      return {id, contentType:type, size:blob.size};
    },
    async delete(id){ await tx("assets", "readwrite", s => s.delete(id)); const u = urls.get(id); if (u){ URL.revokeObjectURL(u); urls.delete(id); } },
    async get(id){ return tx("assets", "readonly", s => req(s.get(id))); },
    async all(){ return tx("assets", "readonly", s => Promise.all([req(s.getAllKeys()), req(s.getAll())])).then(([k, v]) => k.map((id, i) => ({id, ...v[i]}))); },
    async put(id, rec){ await tx("assets", "readwrite", s => s.put(rec, id)); const u = urls.get(id); if (u) URL.revokeObjectURL(u); urls.set(id, URL.createObjectURL(rec.blob)); },
    url(id){ return urls.get(id) || ""; },
    async loadUrls(){ const all = await assets.all(); for (const a of all) if (!urls.has(a.id) && a.blob) urls.set(a.id, URL.createObjectURL(a.blob)); return all.length; }
  };

  /* ---------- toestelinstellingen (niet in de back-up) ---------- */
  const meta = {
    get(k){ return tx("meta", "readonly", s => req(s.get(k))); },
    set(k, v){ return tx("meta", "readwrite", s => s.put(v, k)); }
  };

  /* ---------- opslaan of delen ---------- */
  const SHAREABLE = /\.(pdf|csv|txt|png|jpe?g)$/i;
  function chooser(filename, canShare){
    return new Promise((res) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="sheet-bg" style="z-index:85"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dlT"><div class="sh"><h2 id="dlT">Bestand klaar</h2><button class="x" data-c aria-label="Sluiten">✕</button></div><div class="sb"><span class="muted" style="overflow-wrap:anywhere"></span></div><div class="sf"><button class="btn" data-d>Downloaden</button>${canShare ? `<button class="btn primary" data-s>Delen of in Drive zetten</button>` : ""}</div></div></div>`;
      wrap.querySelector(".muted").textContent = filename;
      const done = v => { wrap.remove(); res(v); };
      wrap.querySelector("[data-c]").onclick = () => done("cancel");
      wrap.querySelector(".sheet-bg").addEventListener("mousedown", e => { if (e.target.classList.contains("sheet-bg")) done("cancel"); });
      wrap.querySelector("[data-d]").onclick = () => done("download");
      const s = wrap.querySelector("[data-s]"); if (s) s.onclick = () => done("share");
      document.body.append(wrap);
    });
  }
  function typeFor(name){ const e = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase(); return {pdf:"application/pdf", csv:"text/csv", txt:"text/plain", json:"application/json", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg"}[e] || "application/octet-stream"; }
  function download(blob, filename){
    const u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = filename; a.rel = "noopener"; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  async function share(blob, filename, title){
    const f = new File([blob], filename, {type: blob.type || typeFor(filename)});
    try{ await navigator.share({files:[f], title: title || filename}); return true; }
    catch(e){ if (e?.name === "AbortError") throw Object.assign(new Error("cancelled"), {code:"cancelled"}); throw e; }
  }
  function canShareFile(filename){
    if (!navigator.canShare || !SHAREABLE.test(filename)) return false;
    try{ return navigator.canShare({files:[new File(["x"], filename, {type:typeFor(filename)})]}); }catch(e){ return false; }
  }
  const downloads = {
    async save({filename, data, mode}){
      const blob = data instanceof Blob ? data : new Blob([data], {type:typeFor(filename)});
      const can = canShareFile(filename);
      const how = mode || (can ? await chooser(filename, true) : "download");
      if (how === "cancel") throw Object.assign(new Error("cancelled"), {code:"cancelled"});
      if (how === "share" && can){ try{ return await share(blob, filename); }catch(e){ if (e.code === "cancelled") throw e; } }
      download(blob, filename); return true;
    },
    canShareFile, share, download
  };

  /* ---------- bonnen en uren uitlezen met je eigen API-sleutel (optioneel) ---------- */
  const API = "https://api.anthropic.com/v1/messages";
  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  function parseJSON(text){
    let t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try{ return JSON.parse(t); }catch(e){}
    const a = t.indexOf("["), o = t.indexOf("{");
    const start = a >= 0 && (o < 0 || a < o) ? a : o, end = start === a ? t.lastIndexOf("]") : t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw Object.assign(new Error("no json"), {code:"unreadable"});
  }
  const sample = {
    async key(){ return (await meta.get("apiKey")) || ""; },
    async model(){ return (await meta.get("apiModel")) || "claude-haiku-5-5"; },
    async limits(){ return {images: !!(await sample.key())}; },
    async json(prompt, opts = {}){
      const key = await sample.key(); if (!key) throw Object.assign(new Error("no key"), {code:"not_granted"});
      const content = [];
      for (const img of opts.images || []){ const b = img instanceof Blob ? img : new Blob([img]); content.push({type:"image", source:{type:"base64", media_type: /^image\/(png|gif|webp)$/.test(b.type) ? b.type : "image/jpeg", data: await toB64(b)}}); }
      content.push({type:"text", text:prompt});
      let r;
      try{
        r = await fetch(API, {method:"POST", signal:opts.signal, headers:{"content-type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true"},
          body: JSON.stringify({model: await sample.model(), max_tokens:4096, messages:[{role:"user", content}]})});
      }catch(e){ if (e?.name === "AbortError") throw Object.assign(new Error("cancelled"), {code:"cancelled"}); throw Object.assign(new Error("offline"), {code:"offline"}); }
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error("key"), {code:"bad_key"});
      if (r.status === 429 || r.status === 529) throw Object.assign(new Error("busy"), {code:"rate_limited"});
      if (!r.ok) throw Object.assign(new Error("http " + r.status), {code:"failed"});
      const j = await r.json();
      return parseJSON((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
    }
  };

  /* ---------- opslag vastzetten (Android wist anders mogelijk data bij weinig ruimte) ---------- */
  async function persist(){ try{ if (navigator.storage?.persisted && await navigator.storage.persisted()) return true; return !!(await navigator.storage?.persist?.()); }catch(e){ return false; } }
  async function usage(){ try{ return await navigator.storage.estimate(); }catch(e){ return null; } }

  const api = {db, assets, downloads, sample, meta};
  window.claude = {use: async name => { if (name === "db" || name === "assets") await loadAll(); if (name === "assets") await assets.loadUrls(); return api[name] || null; }};
  window.KB = {assets, downloads, sample, meta, persist, usage, openDB, loadAll, _cache:cache};
})();
