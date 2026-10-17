/* Kasboek – app-code. */
"use strict";
/* ---------- basis ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r2 = n => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
const EUR = new Intl.NumberFormat("nl-NL", {style:"currency", currency:"EUR"});
const eur = n => EUR.format(r2(n));
const nf = (n, d = 2) => new Intl.NumberFormat("nl-NL", {minimumFractionDigits:0, maximumFractionDigits:d}).format(Number(n) || 0);
const parseNum = v => { if (typeof v === "number") return v; const s = String(v ?? "").trim().replace(/[\s€\u00a0]/g, ""); if (!s) return 0; const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s; const n = parseFloat(t); return isFinite(n) ? n : 0; };
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); };
const dNL = iso => iso ? iso.slice(8,10) + "-" + iso.slice(5,7) + "-" + iso.slice(0,4) : "";
const addDays = (iso, n) => { const [y,m,d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m-1, d + n)); return dt.toISOString().slice(0,10); };
const yearOf = iso => iso ? Number(iso.slice(0,4)) : 0;
const monthOf = iso => iso ? Number(iso.slice(5,7)) : 0;
const qOf = iso => Math.ceil(monthOf(iso) / 3);
const MAANDEN = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
const INVEST = "Investering (zie Activa)";

const DEFAULTS = {
  company:{name:"", address:"", postcode:"", country:"Nederland", kvk:"", btwid:"", phone:"", email:"", iban:"", ibanName:"", naam:""},
  mail:{onderwerp:"Factuur {nr} van {bedrijf}", tekst:"Geachte {contact},\n\nIn de bijlage vindt u factuur {nr} ({onderwerp}) van {bedrag} incl. btw.\n\nGraag ontvang ik de betaling uiterlijk {vervaldatum} op rekeningnummer {iban} t.n.v. {tnv}, onder vermelding van het factuurnummer.\n\nMet vriendelijke groet,\n\n{naam}\n{bedrijf}\n{telefoon}"},
  herinnering:{onderwerp:"Herinnering: factuur {nr}", tekst:"Geachte {contact},\n\nVolgens mijn administratie is factuur {nr} ({onderwerp}) van {bedrag}, met vervaldatum {vervaldatum}, nog niet betaald. Wellicht is dit aan uw aandacht ontsnapt.\n\nWilt u het bedrag binnen 7 dagen overmaken op rekeningnummer {iban} t.n.v. {tnv}, onder vermelding van het factuurnummer? Heeft u inmiddels betaald, dan kunt u deze herinnering als niet verzonden beschouwen.\n\nMet vriendelijke groet,\n\n{naam}\n{bedrijf}\n{telefoon}"},
  belasting:{za:true, sa:false, zaBedrag:1200, saBedrag:2123, mkb:0.127, s1:38883, s2:78426, t1:0.3575, t2:0.3756, t3:0.495, ahkMax:3115, ahkStart:29736, ahkPct:0.06398, akMax:5685, zvwPct:0.0485, zvwMax:3851, jaar:2026},
  rapport:{urencriterium:true},
  termijn:14, jaar:new Date().getFullYear(), urennorm:1225, kmTarief:0.25, uurtarief:55,
  tarieven:[{naam:"21%", pct:0.21, rubriek:"1a"},{naam:"9%", pct:0.09, rubriek:"1b"},{naam:"0%", pct:0, rubriek:"1e"},{naam:"verlegd", pct:0, rubriek:"1e"}],
  categorieen:["Inkoop / materialen","Software & abonnementen","Telefoon & internet","Kantoorbenodigdheden","Vervoer & reiskosten","Auto (zakelijk)","Opleiding & vakliteratuur","Verzekeringen","Marketing & website","Representatie","Bankkosten","Huisvesting / werkplek","Advies & boekhouding","Overige kosten",INVEST]
};
const COLS = ["clients","invoices","costs","hours","rides","activa","bank","recurring"];
const S = { db:null, assets:null, sample:null, downloads:null, settings:structuredClone(DEFAULTS), hasSettings:false,
  clients:{}, invoices:{}, costs:{}, hours:{}, rides:{}, activa:{}, bank:{}, recurring:{}, loaded:new Set(), view:"overzicht", param:null, jaar:null, edit:null, canScan:false, failed:false };

function ls(k, v){ try{ if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }catch(e){ return null; } }

/* ---------- berekeningen ---------- */
const tarief = naam => S.settings.tarieven.find(t => t.naam === naam) || {naam, pct:0, rubriek:"1e"};
function invCalc(inv){
  const lines = (inv.lines || []).map(l => ({...l, excl: l.exclVast != null ? Number(l.exclVast) : r2(parseNum(l.aantal) * parseNum(l.prijs))}));
  const per = {};
  for (const l of lines){ if (!l.excl) continue; per[l.btw] = r2((per[l.btw] || 0) + l.excl); }
  const btw = {}; let btwTot = 0;
  for (const k in per){ btw[k] = r2(per[k] * tarief(k).pct); btwTot = r2(btwTot + btw[k]); }
  const excl = r2(lines.reduce((a, l) => a + l.excl, 0));
  return {lines, per, btw, excl, btwTot, incl: r2(excl + btwTot), verlegd: !!per["verlegd"]};
}
function invStatus(inv){
  if (inv.status !== "geboekt") return {k:"concept", t:"Concept", c:""};
  if (inv.betaaldOp) return {k:"betaald", t:"Betaald", c:"ok"};
  if (inv.verval && today() > inv.verval) return {k:"laat", t: inv.herinneringen?.length ? `Te laat · ${inv.herinneringen.length}e herinnering` : "Te laat", c:"bad"};
  return {k:"open", t:"Open", c:"warn"};
}
function costCalc(c){
  const t = tarief(c.btw); const incl = parseNum(c.bedragIncl);
  const btw = r2(incl * t.pct / (1 + t.pct)); const excl = r2(incl - btw);
  const z = c.zakelijk == null || c.zakelijk === "" ? 1 : Number(c.zakelijk);
  const na = c.btwAftrekbaar === false;   // bijv. horeca of buitenlandse btw: btw hoort bij de kosten
  const auto = c.ibAftrekbaar === false;  // privéauto: kosten vallen onder de kilometervergoeding, alleen btw (zakelijk deel) aftrekbaar
  return {incl, btw, excl, aftrek: na ? 0 : r2(btw * z), kosten: auto ? 0 : na ? r2(incl * z) : r2(excl * z), z, na, auto};
}
function activaCalc(a, jaar){
  const d = a.datum, bedrag = parseNum(a.bedrag), rest = parseNum(a.rest), jaren = parseNum(a.jaren);
  if (!d || !jaren) return {perJaar:0, dit:0, boekwaarde:bedrag};
  const life = jaren * 12, y = yearOf(d), m = monthOf(d);
  const voor = Math.min(life, Math.max(0, (jaar - y) * 12 - (m - 1)));
  const ditM = Math.max(0, Math.min(y === jaar ? 13 - m : (y < jaar ? 12 : 0), life - voor));
  const pm = (bedrag - rest) / life;
  return {perJaar: r2((bedrag - rest) / jaren), dit: r2(pm * ditM), boekwaarde: y > jaar ? null : r2(bedrag - pm * (voor + ditM))};
}
const list = col => Object.values(S[col]);
const booked = () => list("invoices").filter(i => i.status === "geboekt");
function nextNr(){
  const y = S.settings.jaar; let max = 0, w = 0;
  for (const i of list("invoices")){ const m = String(i.nr || "").match(/^(\d{4})-(\d+)/); if (m && Number(m[1]) === y && Number(m[2]) >= max){ max = Number(m[2]); w = m[2].length; } }
  return y + "-" + String(max + 1).padStart(w, "0");
}
/* weeknummers */
function isoWeek(iso){ const [y,m,d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m-1, d)); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3); const fy = dt.getUTCFullYear(); const j4 = new Date(Date.UTC(fy, 0, 4)); return {jaar:fy, week:1 + Math.round(((dt - j4) / 864e5 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7)}; }
function weekStart(year, w){ const j4 = new Date(Date.UTC(year, 0, 4)); const mon = new Date(j4); mon.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() + 6) % 7) + (w - 1) * 7); return mon.toISOString().slice(0,10); }
const weekFromText = t => { const m = String(t || "").match(/week\s*(\d{1,2})/i); return m ? Number(m[1]) : null; };
function workDate(inv){ const w = weekFromText(inv.onderwerp); if (!w || !inv.datum) return inv.datum; const y = yearOf(inv.datum); let d = addDays(weekStart(y, w), 4); if (d > inv.datum) d = addDays(weekStart(y - 1, w), 4); return d; }
function yearTotals(jaar){
  const res = {omzet:0, kosten:0, afschr:0, km:0, kmTot:0, uren:0, maand:Array.from({length:12}, () => ({omzet:0, kosten:0, uren:0})), cat:{}};
  for (const i of booked()){ if (yearOf(i.datum) !== jaar) continue; const c = invCalc(i); res.omzet = r2(res.omzet + c.excl); res.maand[monthOf(i.datum)-1].omzet += c.excl; }
  for (const k of list("costs")){ if (yearOf(k.datum) !== jaar) continue; const c = costCalc(k); res.cat[k.categorie || "Overige kosten"] = r2((res.cat[k.categorie || "Overige kosten"] || 0) + c.kosten); if (k.categorie === INVEST) continue; res.kosten = r2(res.kosten + c.kosten); res.maand[monthOf(k.datum)-1].kosten += c.kosten; }
  for (const a of list("activa")) res.afschr = r2(res.afschr + activaCalc(a, jaar).dit);
  for (const r of list("rides")){ if (yearOf(r.datum) !== jaar) continue; res.kmTot += parseNum(r.km); res.km = r2(res.km + parseNum(r.km) * S.settings.kmTarief); }
  for (const h of list("hours")){ if (yearOf(h.datum) !== jaar) continue; res.uren += parseNum(h.uren); res.maand[monthOf(h.datum)-1].uren += parseNum(h.uren); }
  res.winst = r2(res.omzet - res.kosten - res.afschr - res.km);
  return res;
}
/* indicatie inkomstenbelasting (tarieven 2026, aanpasbaar in Instellingen) */
function arbeidskorting(x){ const m = S.settings.belasting.akMax; if (x <= 0) return 0; let k;
  if (x <= 11965) k = x * 0.08324; else if (x <= 25845) k = 995.97 + (x - 11965) * 0.31009; else if (x <= 45592) k = 5300.02 + (x - 25845) * 0.0195; else k = m - (x - 45592) * 0.0651;
  return r2(Math.max(0, Math.min(k, m))); }
function boxTax(inc, arb){
  const b = S.settings.belasting, x = Math.max(0, inc);
  const s1 = Math.min(x, b.s1), s2 = Math.min(Math.max(0, x - b.s1), b.s2 - b.s1), s3 = Math.max(0, x - b.s2);
  const tax = r2(s1 * b.t1 + s2 * b.t2 + s3 * b.t3);
  const ahk = r2(Math.max(0, b.ahkMax - Math.max(0, x - b.ahkStart) * b.ahkPct)), ak = arbeidskorting(arb);
  return {tax, ahk, ak, net:r2(Math.max(0, tax - ahk - ak))};
}
function ibCalc(winst){
  const b = S.settings.belasting, w = Math.max(0, winst), L = Math.max(0, parseNum(b.loon));
  const za = b.za ? Math.min(b.zaBedrag, w) : 0, sa = b.sa ? Math.min(b.saBedrag, Math.max(0, w - za)) : 0;
  const naOa = Math.max(0, w - za - sa), mkb = r2(naOa * b.mkb), bel = r2(naOa - mkb);
  // met loon in dienstverband: de onderneming komt bovenop het loon (hogere schijf, minder heffingskortingen)
  const tot = boxTax(L + bel, L + bel), base = boxTax(L, L);
  const ib = r2(Math.max(0, tot.net - base.net));
  const zvwRuimte = Math.max(0, b.zvwMax / b.zvwPct - L);   // over loon betaalt de werkgever al de Zvw-heffing
  const zvw = r2(Math.min(bel, zvwRuimte) * b.zvwPct);
  return {winst:r2(winst), za, sa, mkb, bel, loon:L, tax:tot.tax, ahk:tot.ahk, ak:tot.ak, totNet:tot.net, loonNet:base.net, ib, zvw, totaal:r2(ib + zvw)};
}
function prognose(jaar){
  const t = yearTotals(jaar), now = new Date(), cur = now.getFullYear();
  const f = jaar < cur ? 1 : jaar > cur ? 0 : (now - new Date(cur, 0, 1)) / (new Date(cur + 1, 0, 1) - new Date(cur, 0, 1));
  const factor = f ? 1 / f : 1;
  return {t, factor, winstJaar:r2(t.winst * factor), urenJaar:r2(t.uren * factor), omzetJaar:r2(t.omzet * factor)};
}
function btwKwartaal(jaar, q){
  const o = {"1a":{g:0,b:0}, "1b":{g:0,b:0}, "1e":{g:0,b:0}, vb:0};
  for (const i of booked()){ if (yearOf(i.datum) !== jaar || qOf(i.datum) !== q) continue; const c = invCalc(i); for (const k in c.per){ const rb = tarief(k).rubriek || "1e"; o[rb] = o[rb] || {g:0,b:0}; o[rb].g = r2(o[rb].g + c.per[k]); o[rb].b = r2(o[rb].b + (c.btw[k] || 0)); } }
  for (const k of list("costs")){ if (yearOf(k.datum) !== jaar || qOf(k.datum) !== q) continue; o.vb = r2(o.vb + costCalc(k).aftrek); }
  o.verschuldigd = r2(o["1a"].b + o["1b"].b); o.saldo = r2(o.verschuldigd - o.vb);
  const end = new Date(Date.UTC(jaar, q*3 + 1, 0)); o.deadline = end.toISOString().slice(0,10);
  return o;
}

/* ---------- opslag ---------- */
async function save(col, id, data){
  try{
    const ref = id ? S.db.collection(col).doc(id) : S.db.collection(col).doc();
    await ref.set(stripUndef(data)); return ref.id;
  }catch(e){ dbError(e); throw e; }
}
async function patch(col, id, data){ try{ await S.db.collection(col).doc(id).update(stripUndef(data)); }catch(e){ dbError(e); throw e; } }
async function del(col, id){ try{ await S.db.collection(col).doc(id).delete(); }catch(e){ dbError(e); throw e; } }
function stripUndef(o){ return JSON.parse(JSON.stringify(o, (k, v) => v === undefined ? null : v)); }
function dbError(e){
  const m = {quota_exceeded:"De opslag is vol. Verwijder oude regels of maak een back-up en ruim op.", resource_exhausted:"Even te veel tegelijk. Probeer het over een paar seconden opnieuw.", invalid_argument:"Opslaan lukte niet: je hebt geen schrijfrechten op deze administratie.", unavailable:"Geen verbinding met de opslag. Probeer het zo opnieuw.", revoked:"De toegang tot de opslag is ingetrokken."};
  toast(m[e?.code] || "Opslaan lukte niet. Probeer het opnieuw.");
}
function clean(obj){ const o = {...obj}; delete o.id; return o; }

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg){ let t = $("#toast"); if (!t){ t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role","status"); document.body.append(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600); }
function openSheet({title, body, foot, wide}){
  const m = $("#modal");
  m.innerHTML = `<div class="sheet-bg" id="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetT" style="${wide ? "max-width:860px" : ""}"><div class="sh"><h2 id="sheetT">${esc(title)}</h2><button class="x" data-close aria-label="Sluiten">✕</button></div><div class="sb">${body}</div>${foot ? `<div class="sf">${foot}</div>` : ""}</div></div>`;
  m.querySelectorAll("[data-close]").forEach(b => b.onclick = closeSheet);
  $("#sheetBg").addEventListener("mousedown", e => { if (e.target.id === "sheetBg") closeSheet(); });
  setTimeout(() => m.querySelector("input,select,textarea")?.focus(), 30);
  return m;
}
function closeSheet(){ $("#modal").innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#sheetBg")) closeSheet(); });
function ask(title, text, okLabel = "Verwijderen", danger = true){
  return new Promise(res => {
    const m = openSheet({title, body:`<p style="margin:0">${esc(text)}</p>`, foot:`<button class="btn" data-no>Annuleren</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(okLabel)}</button>`});
    m.querySelector("[data-yes]").onclick = () => { closeSheet(); res(true); };
    m.querySelector("[data-no]").onclick = () => { closeSheet(); res(false); };
    m.querySelector("[data-close]").onclick = () => { closeSheet(); res(false); };
  });
}
const fld = (label, inner, cls = "") => `<label class="fld ${cls}"><span>${esc(label)}</span>${inner}</label>`;
const inp = (id, val, attrs = "") => `<input id="${id}" value="${esc(val)}" ${attrs}>`;
const sel = (id, opts, val, attrs = "") => `<select id="${id}" ${attrs}>${opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(t)}</option>`; }).join("")}</select>`;
const v = id => $("#" + id)?.value ?? "";

/* ---------- navigatie ---------- */
const ICON = {
  overzicht:'<path d="M4 20V10m6 10V4m6 16v-7m4 7H2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  facturen:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  kosten:'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  uren:'<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  meer:'<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>'
};
const NAV = [["overzicht","Overzicht"],["facturen","Facturen"],["kosten","Kosten & bonnen"],["uren","Uren"],["ritten","Ritten"],["activa","Activa"],["btw","Btw-aangifte"],["potje","Belastingpotje"],["bank","Bank"],["#","Beheer"],["klanten","Klanten"],["instellingen","Instellingen"],["export","Export & back-up"]];
function renderNav(){
  const open = booked().filter(i => invStatus(i).k !== "betaald").length;
  $("#nav").innerHTML = NAV.map(([k, t]) => k === "#" ? `<div class="grp label">${t}</div>` : `<button data-go="${k}" ${curNav() === k ? 'aria-current="page"' : ""}><span>${t}</span>${k === "facturen" && open ? `<span class="chip warn">${open}</span>` : ""}</button>`).join("");
  const tabs = [["overzicht","Overzicht"],["facturen","Facturen"],["kosten","Kosten"],["uren","Uren"],["meer","Meer"]];
  const cur = ["overzicht","facturen","kosten","uren"].includes(curNav()) ? curNav() : "meer";
  $("#tabbar").innerHTML = tabs.map(([k, t]) => `<button data-go="${k}" ${cur === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${t}</button>`).join("");
  $("#brandName").textContent = S.settings.company.name || "Boekhouding zzp";
}
const curNav = () => S.view.startsWith("factuur") ? "facturen" : S.view;
document.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b){ go(b.dataset.go); } });
function go(view, param = null){
  if (S.edit && view !== "factuur-edit"){ S.edit = null; }
  S.view = view; S.param = param; render(true); window.scrollTo(0, 0);
}

/* ---------- render ---------- */
let rq = false;
function scheduleRender(){ if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; render(false); }); }
function render(force){
  renderNav();
  const V = $("#view");
  if (S.failed){ V.innerHTML = `<div class="panel"><div class="empty"><h2>Opslag niet beschikbaar</h2><p>Deze browser staat het opslaan van gegevens niet toe. Open de app in Chrome (niet in een incognitovenster) en probeer het opnieuw.</p></div></div>`; return; }
  if (S.loaded.size < COLS.length + 1){ V.innerHTML = `<div class="empty"><span class="spin"></span>Administratie laden…</div>`; return; }
  if (S.view === "factuur-edit"){ if (force && S.edit) renderEditor(); return; }   // typen niet onderbreken
  const fn = VIEWS[S.view] || VIEWS.overzicht;
  V.innerHTML = fn();
  (BIND[S.view] || (() => {}))();
}
const jaarSel = () => {
  const yrs = new Set([S.settings.jaar, S.jaar]); for (const c of ["invoices","costs","hours","rides"]) for (const x of list(c)) if (x.datum) yrs.add(yearOf(x.datum));
  return `<label class="row small muted">Boekjaar ${sel("jaarSel", [...yrs].filter(Boolean).sort(), S.jaar, 'style="width:auto"')}</label>`;
};
function bindJaar(){ const j = $("#jaarSel"); if (j) j.onchange = () => { S.jaar = Number(j.value); ls("kb_jaar", String(S.jaar)); render(true); }; }

const VIEWS = {}, BIND = {}, ACTS = {};

/* ---- Overzicht ---- */
VIEWS.overzicht = () => {
  const j = S.jaar, t = yearTotals(j), c = S.settings.company;
  const open = booked().filter(i => !i.betaaldOp); const openSum = r2(open.reduce((a, i) => a + invCalc(i).incl, 0));
  const laat = open.filter(i => invStatus(i).k === "laat"); const laatSum = r2(laat.reduce((a, i) => a + invCalc(i).incl, 0));
  const q = j === new Date().getFullYear() ? Math.ceil((new Date().getMonth() + 1) / 3) : 4; const bq = btwKwartaal(j, q);
  const pct = Math.min(100, Math.round(t.uren / (S.settings.urennorm || 1) * 100));
  const cats = Object.entries(t.cat).filter(([k]) => k !== INVEST).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(x => x[1]));
  const setup = !c.name || !c.iban;
  return `
  <div class="head"><div class="t"><span class="label">${esc(c.name || "Jouw bedrijf")}</span><h1>Overzicht ${j}</h1></div><div class="row">${jaarSel()}<button class="btn primary" data-act="weekInv">Weekfactuur</button><button class="btn" data-act="newInv">Nieuwe factuur</button><button class="btn" data-act="report">Jaarrapport</button>${S.assets ? `<label class="btn"><input type="file" class="sr fileIn" accept="image/*,application/pdf" multiple>Bon toevoegen</label>` : ""}</div></div>
  ${backupDue() ? `<div class="notice warn row" style="justify-content:space-between"><span>${backupStatus()} Zet een back-up in Google Drive, zodat je niets kwijtraakt als je telefoon kapotgaat.</span><button class="btn sm primary" data-act="backup">Back-up maken</button></div>` : ""}
  ${setup ? `<div class="notice warn">Vul je bedrijfsgegevens en IBAN in bij <a href="#" data-go="instellingen">Instellingen</a>, dan staan ze op je facturen.</div>` : ""}
  ${!c.btwid && !setup ? `<div class="notice warn">Je btw-identificatienummer ontbreekt nog. Dat is verplicht op een factuur. <a href="#" data-go="instellingen">Invullen</a></div>` : ""}
  <div class="kpis">
    <div class="kpi lead"><span class="label">Winst (indicatief)</span><span class="v">${eur(t.winst)}</span><span class="small">vóór ondernemersaftrek en belasting</span></div>
    <div class="kpi"><span class="label">Omzet excl. btw</span><span class="v">${eur(t.omzet)}</span><span class="small muted">${booked().filter(i => yearOf(i.datum) === j).length} facturen</span></div>
    <div class="kpi"><span class="label">Kosten excl. btw</span><span class="v">${eur(t.kosten + t.afschr + t.km)}</span><span class="small muted">incl. ${eur(t.afschr)} afschrijving, ${eur(t.km)} km</span></div>
    <div class="kpi"><span class="label">Openstaand</span><span class="v">${eur(openSum)}</span><span class="small ${laat.length ? "" : "muted"}" style="${laat.length ? "color:var(--bad);font-weight:600" : ""}">${laat.length ? `${laat.length} te laat: ${eur(laatSum)}` : `${open.length} open facturen`}</span></div>
  </div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h2>Omzet en kosten per maand</h2><div class="legend"><span><i style="background:var(--accent)"></i>Omzet</span><span><i style="background:var(--muted)"></i>Kosten</span></div></div><div class="pb">${chart(t.maand)}</div></div>
    <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
      <div class="panel"><div class="ph"><h2>Btw Q${q} ${j}</h2><button class="btn sm ghost" data-go="btw">Details</button></div><div class="pb" style="display:flex;flex-direction:column;gap:6px">
        <div class="row" style="justify-content:space-between"><span class="muted">Verschuldigd</span><span class="num">${eur(bq.verschuldigd)}</span></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Voorbelasting</span><span class="num">− ${eur(bq.vb)}</span></div>
        <div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:6px"><b>${bq.saldo >= 0 ? "Te betalen" : "Terug te vragen"}</b><b class="num">${eur(Math.abs(bq.saldo))}</b></div>
        <span class="small muted">Aangifte uiterlijk ${dNL(bq.deadline)}</span></div></div>
      ${(() => { const pg = prognose(j), ib = ibCalc(pg.winstJaar); const pct = pg.t.omzet ? ib.totaal / pg.omzetJaar : 0; return `<div class="panel"><div class="ph"><h2>Belastingpotje</h2><button class="btn sm ghost" data-go="potje">Details</button></div><div class="pb" style="display:flex;flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><span class="muted">Inkomstenbelasting + Zvw ${j} (prognose)</span><b class="num">${eur(ib.totaal)}</b></div><div class="row" style="justify-content:space-between"><span class="muted">Per maand opzij zetten</span><b class="num">${eur(ib.totaal / 12)}</b></div><span class="small muted">Plus de btw. Zet van elke factuur ${Math.round(pct * 100)}% van het bedrag excl. btw apart.</span></div></div>`; })()}
      <div class="panel"><div class="ph"><h2>Urencriterium</h2><span class="num">${nf(t.uren,1)} / ${nf(S.settings.urennorm,0)} uur</span></div><div class="pb" style="display:flex;flex-direction:column;gap:8px"><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><span class="small muted">${pct >= 100 ? "Gehaald." : `Nog ${nf(Math.max(0, S.settings.urennorm - t.uren),1)} uur te gaan dit jaar.`}</span></div></div>
    </div>
  </div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h2>Openstaande facturen</h2><button class="btn sm ghost" data-go="facturen">Alle facturen</button></div>${open.length ? invTable(open.sort((a, b) => (a.verval || "").localeCompare(b.verval || ""))) : `<div class="empty">Geen openstaande facturen.</div>`}</div>
    <div class="panel"><div class="ph"><h2>Kosten per categorie</h2></div><div class="pb" style="display:flex;flex-direction:column;gap:12px">${cats.length ? cats.map(([k, val]) => `<div class="catrow"><span>${esc(k)}</span><span class="num">${eur(val)}</span><div class="bar" style="grid-column:1/-1"><i style="width:${Math.round(val / maxCat * 100)}%;background:var(--muted)"></i></div></div>`).join("") : `<div class="empty" style="padding:8px">Nog geen kosten in ${j}. Upload een bon of voeg kosten toe.</div>`}</div></div>
  </div>`;
};
BIND.overzicht = () => { bindJaar(); bindActs(); bindRows(); };
ACTS.report = () => yearReportPDF(S.jaar);
function chart(maand){
  const W = 640, H = 230, L = 52, B = 24, T = 10, R = 8;
  const max = Math.max(...maand.map(m => Math.max(m.omzet, m.kosten)), 0);
  const step = niceStep(max / 4 || 250); const top = Math.max(step * 4, step * Math.ceil(max / step));
  const y = val => T + (H - T - B) * (1 - val / top);
  const bw = (W - L - R) / 12;
  let g = "";
  for (let v0 = 0; v0 <= top + 0.001; v0 += step){ g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v0)}" y2="${y(v0)}"/><text x="${L - 6}" y="${y(v0) + 3}" text-anchor="end">${v0 >= 1000 ? nf(v0 / 1000, 1) + "k" : nf(v0, 0)}</text>`; }
  maand.forEach((m, i) => {
    const x = L + i * bw + bw * 0.14, w = bw * 0.34;
    if (m.omzet) g += `<rect x="${x}" y="${y(m.omzet)}" width="${w}" height="${y(0) - y(m.omzet)}" rx="2" fill="var(--accent)"><title>${MAANDEN[i]}: omzet ${eur(m.omzet)}</title></rect>`;
    if (m.kosten) g += `<rect x="${x + w + 2}" y="${y(m.kosten)}" width="${w}" height="${y(0) - y(m.kosten)}" rx="2" fill="var(--muted)"><title>${MAANDEN[i]}: kosten ${eur(m.kosten)}</title></rect>`;
    g += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${MAANDEN[i]}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Staafdiagram omzet en kosten per maand">${g}</svg>`;
}
function niceStep(x){ const p = Math.pow(10, Math.floor(Math.log10(x))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

/* ---- Facturen ---- */
function invTable(rows){
  const tr = rows.map(i => { const c = invCalc(i), s = invStatus(i); return `<tr class="click" data-inv="${i.id}"><td class="mono">${esc(i.nr)}</td><td>${esc(i.klant?.naam || clientName(i.klantId))}<div class="small muted">${esc(i.onderwerp || "")}</div></td><td class="num">${dNL(i.datum)}</td><td class="num hide-m">${dNL(i.verval)}</td><td class="r num">${eur(c.incl)}</td><td><span class="chip ${s.c}">${s.t}</span></td></tr>`; }).join("");
  const mc = rows.map(i => { const c = invCalc(i), s = invStatus(i); return `<div class="mc" data-inv="${i.id}"><div><b class="mono">${esc(i.nr)}</b><span class="small muted">${esc(i.klant?.naam || clientName(i.klantId))} · ${dNL(i.datum)}</span></div><div><span class="num">${eur(c.incl)}</span><span class="chip ${s.c}">${s.t}</span></div></div>`; }).join("");
  return `<div class="tbl-wrap has-m"><table><thead><tr><th>Nummer</th><th>Klant</th><th>Datum</th><th class="hide-m">Vervalt</th><th class="r">Totaal incl.</th><th>Status</th></tr></thead><tbody>${tr}</tbody></table></div><div class="mcards">${mc}</div>`;
}
const clientName = id => S.clients[id]?.naam || "—";
VIEWS.facturen = () => {
  const f = S.param?.f || ls("kb_ff") || "alle";
  const all = list("invoices").sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || String(b.nr).localeCompare(String(a.nr), "nl", {numeric:true}));
  const rows = all.filter(i => f === "alle" || invStatus(i).k === f || (f === "open" && invStatus(i).k === "laat"));
  const cnt = k => all.filter(i => k === "alle" || invStatus(i).k === k || (k === "open" && invStatus(i).k === "laat")).length;
  const tabs = [["alle","Alle"],["concept","Concept"],["open","Open"],["laat","Te laat"],["betaald","Betaald"]];
  return `<div class="head"><div class="t"><span class="label">Verkoop</span><h1>Facturen</h1></div><div class="row"><button class="btn" data-act="billHours">Open uren factureren</button><button class="btn" data-act="newInv">Nieuwe factuur</button><button class="btn primary" data-act="weekInv">Weekfactuur</button></div></div>
  <div class="row" role="tablist">${tabs.map(([k, t]) => `<button class="btn sm ${f === k ? "primary" : ""}" data-ff="${k}" role="tab" aria-selected="${f === k}">${t} <span class="num">${cnt(k)}</span></button>`).join("")}</div>
  <div class="panel">${rows.length ? invTable(rows) : `<div class="empty"><h3>Nog geen facturen${f !== "alle" ? " in deze lijst" : ""}</h3><span>Maak een factuur. Uren op de factuur komen bij het boeken vanzelf in je urenregistratie.</span><button class="btn primary" data-act="newInv">Nieuwe factuur</button></div>`}</div>`;
};
BIND.facturen = () => { bindActs(); bindRows(); document.querySelectorAll("[data-ff]").forEach(b => b.onclick = () => { ls("kb_ff", b.dataset.ff); go("facturen", {f:b.dataset.ff}); }); };
function bindRows(){ document.querySelectorAll("[data-inv]").forEach(r => r.onclick = () => { const i = S.invoices[r.dataset.inv]; if (!i) return; i.status === "geboekt" ? go("factuur", i.id) : editInvoice(i.id); }); }

Object.assign(ACTS, {
  newInv: () => editInvoice(null),
  upload: () => $("#fileIn").click(),
  billHours: () => billHoursDialog(),
});
function bindActs(){ document.querySelectorAll("[data-act]").forEach(b => { if (ACTS[b.dataset.act]) b.onclick = e => { e.preventDefault(); ACTS[b.dataset.act](b); }; }); }

/* ---- Factuur bewerken ---- */
function editInvoice(id, preset){
  const base = id ? structuredClone(S.invoices[id]) : {nr:nextNr(), datum:today(), klantId:"", onderwerp:"", lines:[{omschrijving:"", aantal:"", eenheid:"uur", prijs:S.settings.uurtarief, btw:S.settings.tarieven[0]?.naam || "21%"}], status:"concept"};
  if (preset) Object.assign(base, preset);
  S.edit = {id, data:base};
  S.view = "factuur-edit"; renderEditor(); window.scrollTo(0, 0); renderNav();
}
function renderEditor(){
  const d = S.edit.data, cl = list("clients").sort((a, b) => a.naam.localeCompare(b.naam));
  const tar = S.settings.tarieven.map(t => t.naam);
  $("#view").innerHTML = `
  <div class="head"><div class="t"><span class="label">${S.edit.id ? "Concept bewerken" : "Nieuwe factuur"}</span><h1>Factuur ${esc(d.nr)}</h1></div><div class="row"><button class="btn ghost" data-go="facturen">Annuleren</button>${S.edit.id ? `<button class="btn danger" id="eDel">Verwijderen</button>` : ""}<button class="btn" id="eSave">Opslaan als concept</button><button class="btn primary" id="eBook">Boeken</button></div></div>
  <div class="panel"><div class="pb"><div class="form">
    ${fld("Factuurnummer", inp("eNr", d.nr, 'class="mono"'))}
    ${fld("Factuurdatum", inp("eDatum", d.datum, 'type="date"'))}
    ${fld("Klant", sel("eKlant", [["", "Kies een klant…"], ...cl.map(c => [c.id, c.naam]), ["__new", "+ Nieuwe klant"]], d.klantId))}
    ${fld("Onderwerp", inp("eOnd", d.onderwerp, 'placeholder="Bijv. Factuur week 34"'))}
  </div></div></div>
  <div class="panel"><div class="ph"><h2>Regels</h2><div class="row"><button class="btn sm" id="eHours">Open uren toevoegen</button><button class="btn sm" id="eAdd">Regel toevoegen</button></div></div><div class="pb">
    <div class="lines" id="eLines">
      <div class="line headl"><span>Omschrijving</span><span>Aantal</span><span>Eenheid</span><span>Prijs</span><span>Btw</span><span style="text-align:right">Totaal excl.</span><span></span></div>
      ${d.lines.map((l, i) => `<div class="line" data-i="${i}">
        <input class="desc" data-k="omschrijving" value="${esc(l.omschrijving)}" placeholder="Omschrijving" aria-label="Omschrijving regel ${i + 1}">
        <input data-k="aantal" value="${esc(l.aantal)}" inputmode="decimal" placeholder="Aantal" aria-label="Aantal">
        ${sel("", [["uur","uur"],["dag","dag"],["stuk","stuk"],["km","km"],["","—"]], l.eenheid, 'data-k="eenheid" aria-label="Eenheid"')}
        <input data-k="prijs" value="${esc(l.prijs)}" inputmode="decimal" placeholder="Prijs" aria-label="Prijs">
        ${sel("", tar, l.btw, 'data-k="btw" aria-label="Btw-tarief"')}
        <span class="tot" data-tot="${i}"></span>
        <button class="x" data-rm="${i}" aria-label="Regel verwijderen">✕</button>
        ${l.hourIds?.length ? `<span class="small muted" style="grid-column:1/-1">Gekoppeld aan ${l.hourIds.length} urenregel(s)</span>` : ""}
      </div>`).join("")}
    </div>
    <div style="margin-top:16px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <span class="small muted" style="max-width:46ch">Regels met eenheid “uur” komen bij het boeken automatisch in je urenregistratie.</span>
      <div class="totals" id="eTot"></div>
    </div>
  </div></div>`;
  const L = $("#eLines");
  L.addEventListener("input", e => { const row = e.target.closest("[data-i]"); if (!row || !e.target.dataset.k) return; d.lines[row.dataset.i][e.target.dataset.k] = e.target.value; updTot(); });
  L.addEventListener("change", e => { const row = e.target.closest("[data-i]"); if (!row || !e.target.dataset.k) return; d.lines[row.dataset.i][e.target.dataset.k] = e.target.value; updTot(); });
  L.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { d.lines.splice(Number(b.dataset.rm), 1); if (!d.lines.length) d.lines.push(blankLine()); renderEditor(); });
  $("#eAdd").onclick = () => { d.lines.push(blankLine()); renderEditor(); L.querySelector(`[data-i="${d.lines.length - 1}"] input`)?.focus(); };
  $("#eNr").oninput = e => d.nr = e.target.value.trim();
  $("#eDatum").onchange = e => d.datum = e.target.value;
  $("#eOnd").oninput = e => d.onderwerp = e.target.value;
  $("#eKlant").onchange = e => { if (e.target.value === "__new"){ e.target.value = d.klantId || ""; clientDialog(null, newId => { d.klantId = newId; renderEditor(); }); } else d.klantId = e.target.value; };
  $("#eHours").onclick = () => pickHours(d);
  $("#eSave").onclick = () => saveInvoice(false);
  $("#eBook").onclick = () => saveInvoice(true);
  if ($("#eDel")) $("#eDel").onclick = async () => { if (await ask("Concept verwijderen", `Factuur ${d.nr} wordt verwijderd.`)){ await del("invoices", S.edit.id); S.edit = null; go("facturen"); toast("Concept verwijderd"); } };
  updTot();
}
const blankLine = () => ({omschrijving:"", aantal:"", eenheid:"uur", prijs:S.settings.uurtarief, btw:S.settings.tarieven[0]?.naam || "21%"});
function updTot(){
  const c = invCalc(S.edit.data);
  c.lines.forEach((l, i) => { const el = document.querySelector(`[data-tot="${i}"]`); if (el) el.textContent = l.excl ? eur(l.excl) : ""; });
  let h = `<span class="muted">Subtotaal</span><span>${eur(c.excl)}</span>`;
  for (const k in c.btw) if (c.btw[k]) h += `<span class="muted">Btw ${esc(k)}</span><span>${eur(c.btw[k])}</span>`;
  if (c.verlegd) h += `<span class="muted">Btw verlegd</span><span>—</span>`;
  h += `<span class="big">Totaal</span><span class="big">${eur(c.incl)}</span>`;
  $("#eTot").innerHTML = h;
}
function pickHours(d){
  const used = new Set(d.lines.flatMap(l => l.hourIds || []));
  const klant = S.clients[d.klantId]?.naam;
  const hs = list("hours").filter(h => !h.invoiceId && h.soort === "Declarabel" && !used.has(h.id) && (!klant || (h.klant || "") === klant)).sort((a, b) => a.datum.localeCompare(b.datum));
  if (!hs.length){ toast(klant ? `Geen open declarabele uren voor ${klant}.` : "Geen open declarabele uren."); return; }
  const m = openSheet({title:"Open uren toevoegen", body:`<span class="small muted">${klant ? `Declarabele uren van ${esc(klant)} die nog niet gefactureerd zijn.` : "Kies eerst een klant om alleen diens uren te zien."}</span><div class="tbl-wrap"><table><thead><tr><th></th><th>Datum</th><th>Omschrijving</th><th class="r">Uren</th></tr></thead><tbody>${hs.map(h => `<tr><td><input type="checkbox" data-h="${h.id}" checked aria-label="Selecteer"></td><td class="num">${dNL(h.datum)}</td><td>${esc(h.omschrijving)}<div class="small muted">${esc(h.klant || "")}</div></td><td class="r num">${nf(h.uren)}</td></tr>`).join("")}</tbody></table></div>
    <label class="row"><input type="checkbox" id="phGroup" style="width:auto"> Samenvoegen tot één regel</label>`, foot:`<button class="btn" data-close>Annuleren</button><button class="btn primary" id="phOk">Toevoegen</button>`});
  m.querySelector("#phOk").onclick = () => {
    const ids = [...m.querySelectorAll("[data-h]:checked")].map(x => x.dataset.h); if (!ids.length) return closeSheet();
    const sel_ = ids.map(i => S.hours[i]); const tar = S.settings.tarieven[0]?.naam || "21%";
    d.lines = d.lines.filter(l => l.omschrijving || parseNum(l.aantal));
    if ($("#phGroup").checked){ d.lines.push({omschrijving: d.onderwerp || "Gewerkte uren " + dNL(sel_[0].datum) + " t/m " + dNL(sel_[sel_.length - 1].datum), aantal: r2(sel_.reduce((a, h) => a + parseNum(h.uren), 0)), eenheid:"uur", prijs:S.settings.uurtarief, btw:tar, hourIds:ids}); }
    else for (const h of sel_) d.lines.push({omschrijving: dNL(h.datum) + " " + (h.omschrijving || ""), aantal: parseNum(h.uren), eenheid:"uur", prijs:S.settings.uurtarief, btw:tar, hourIds:[h.id]});
    closeSheet(); renderEditor();
  };
}
async function saveInvoice(book){
  const d = S.edit.data;
  d.lines = d.lines.filter(l => String(l.omschrijving).trim() || parseNum(l.aantal));
  if (!d.nr){ toast("Vul een factuurnummer in."); return; }
  if (list("invoices").some(i => i.nr === d.nr && i.id !== S.edit.id)){ toast(`Factuurnummer ${d.nr} bestaat al.`); return; }
  if (book){
    if (!d.datum) return toast("Vul een factuurdatum in.");
    if (!S.clients[d.klantId]) return toast("Kies een klant.");
    if (!invCalc(d).excl) return toast("Voeg minstens één regel met aantal en prijs toe.");
  }
  const lines = d.lines.map(l => ({omschrijving:String(l.omschrijving).trim(), aantal:parseNum(l.aantal), eenheid:l.eenheid || "", prijs:parseNum(l.prijs), btw:l.btw, hourIds:l.hourIds || []}));
  const doc = {nr:d.nr, datum:d.datum, klantId:d.klantId || "", onderwerp:d.onderwerp || "", lines, status: book ? "geboekt" : "concept", betaaldOp: d.betaaldOp || null};
  if (book){ const k = S.clients[d.klantId]; doc.klant = clean(k); doc.verval = addDays(d.datum, Number(S.settings.termijn) || 14); doc.geboektOp = today(); }
  const btn = $(book ? "#eBook" : "#eSave"); if (btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Bezig'; }
  try{
    const id = await save("invoices", S.edit.id, doc);
    let hrs = 0;
    if (book) hrs = await syncHours(id, doc);
    S.edit = null;
    toast(book ? `Factuur ${doc.nr} geboekt${hrs ? ` · ${nf(hrs)} uur in urenregistratie` : ""}` : "Concept opgeslagen");
    book ? go("factuur", id) : go("facturen");
  }catch(e){ if (btn){ btn.disabled = false; btn.textContent = book ? "Boeken" : "Opslaan als concept"; } }
}
async function syncHours(invId, inv){
  for (const h of list("hours")) if (h.invoiceId === invId && h.bron === "factuur") await del("hours", h.id);
  for (const h of list("hours")) if (h.invoiceId === invId && h.bron !== "factuur") await patch("hours", h.id, {invoiceId:null});
  let tot = 0; const klant = inv.klant?.naam || clientName(inv.klantId);
  for (const l of inv.lines){
    if (l.hourIds?.length){ for (const hid of l.hourIds) if (S.hours[hid]) await patch("hours", hid, {invoiceId:invId, invoiceNr:inv.nr}); continue; }
    if (l.eenheid === "uur" && parseNum(l.aantal) > 0){ await save("hours", null, {datum:workDate(inv), klant, omschrijving:l.omschrijving, uren:parseNum(l.aantal), soort:"Declarabel", bron:"factuur", invoiceId:invId, invoiceNr:inv.nr}); tot += parseNum(l.aantal); }
  }
  return tot;
}

/* ---- Factuur bekijken ---- */
VIEWS.factuur = () => {
  const i = S.invoices[S.param]; if (!i) return `<div class="empty">Factuur niet gevonden. <button class="btn" data-go="facturen">Terug</button></div>`;
  const s = invStatus(i);
  return `<div class="head"><div class="t"><button class="btn sm ghost" data-go="facturen" style="align-self:flex-start;padding-left:0">← Facturen</button><h1>Factuur ${esc(i.nr)} <span class="chip ${s.c}" style="vertical-align:4px">${s.t}</span></h1></div>
  <div class="row">${s.k === "laat" ? `<button class="btn primary" id="fRem">Herinnering sturen</button><button class="btn" id="fSend">Versturen</button>` : `<button class="btn primary" id="fSend">Versturen</button>`}<button class="btn" id="fPdf">PDF</button>${i.betaaldOp ? `<button class="btn" id="fUnpaid">Betaling terugdraaien</button>` : `<button class="btn" id="fPaid">Markeer betaald</button>`}<button class="btn" id="fEdit">Wijzigen</button><button class="btn" id="fCopy">Kopiëren</button><button class="btn danger" id="fDel">Verwijderen</button></div></div>
  ${i.verstuurdOp || i.herinneringen?.length ? `<span class="small muted">${i.verstuurdOp ? `Verstuurd op ${dNL(i.verstuurdOp)}${i.verstuurdAan ? " naar " + esc(i.verstuurdAan) : ""}. ` : ""}${(i.herinneringen || []).map((d, n) => `${n + 1}e herinnering ${dNL(d)}`).join(", ")}</span>` : ""}
  ${i.betaaldOp ? `<div class="notice">Betaald op ${dNL(i.betaaldOp)}${i.betaaldVia && S.bank[i.betaaldVia] ? ` (bank: ${esc(S.bank[i.betaaldVia].naam || "")})` : ""}.</div>` : s.k === "laat" ? `<div class="notice warn">Deze factuur is sinds ${dNL(i.verval)} over de vervaldatum.</div>` : ""}
  ${paperHTML(i)}`;
};
BIND.factuur = () => {
  const i = S.invoices[S.param]; if (!i) return;
  $("#fPdf").onclick = () => invoicePDF(i);
  $("#fSend").onclick = () => sendDialog(i);
  if ($("#fRem")) $("#fRem").onclick = () => sendDialog(i, "herinnering");
  if (S.param2 === "send"){ S.param2 = null; sendDialog(i); }
  if ($("#fPaid")) $("#fPaid").onclick = () => { const m = openSheet({title:"Betaling registreren", body:fld("Betaald op", inp("pDat", today(), 'type="date"')), foot:`<button class="btn" data-close>Annuleren</button><button class="btn primary" id="pOk">Opslaan</button>`}); m.querySelector("#pOk").onclick = async () => { await patch("invoices", i.id, {betaaldOp:v("pDat") || today()}); closeSheet(); toast("Betaling geregistreerd"); }; };
  if ($("#fUnpaid")) $("#fUnpaid").onclick = async () => { await patch("invoices", i.id, {betaaldOp:null}); toast("Weer open"); };
  $("#fEdit").onclick = async () => { if (!await ask("Factuur wijzigen", "De factuur gaat terug naar concept. Uren die uit deze factuur kwamen worden weggehaald en bij opnieuw boeken weer aangemaakt.", "Wijzigen", false)) return; await patch("invoices", i.id, {status:"concept"}); for (const h of list("hours")) if (h.invoiceId === i.id && h.bron === "factuur") await del("hours", h.id); editInvoice(i.id); };
  $("#fCopy").onclick = () => editInvoice(null, {klantId:i.klantId, onderwerp:i.onderwerp, lines:structuredClone(i.lines).map(l => ({...l, hourIds:[]}))});
  $("#fDel").onclick = async () => { if (!await ask("Factuur verwijderen", `Factuur ${i.nr} en de uren die eruit kwamen worden verwijderd. Gekoppelde handmatige uren worden weer ‘nog te factureren’.`)) return; for (const h of list("hours")) if (h.invoiceId === i.id){ h.bron === "factuur" ? await del("hours", h.id) : await patch("hours", h.id, {invoiceId:null, invoiceNr:null}); } await del("invoices", i.id); go("facturen"); toast("Factuur verwijderd"); };
};
function companyLines(){ const c = S.settings.company; return [c.address, c.postcode, c.country].filter(Boolean); }
function paperHTML(i){
  const c = S.settings.company, k = i.klant || S.clients[i.klantId] || {}, x = invCalc(i);
  const qty = l => nf(l.aantal) + (l.eenheid && l.eenheid !== "stuk" ? " " + l.eenheid : "");
  return `<div class="tbl-wrap"><div class="paper" style="min-width:560px">
    <div class="top"><div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:15px">${esc(c.name || "Jouw bedrijfsnaam")}</b>${companyLines().map(l => `<span>${esc(l)}</span>`).join("")}${c.kvk ? `<span class="muted" style="margin-top:8px">KvK: ${esc(c.kvk)}</span>` : ""}${c.btwid ? `<span class="muted">Btw-id: ${esc(c.btwid)}</span>` : ""}${c.phone ? `<span>${esc(c.phone)}</span>` : ""}${c.email ? `<span>${esc(c.email)}</span>` : ""}</div>
      <div><h4>Factuur</h4><div class="meta"><b>Factuurnummer</b><span>${esc(i.nr)}</span><b>Factuurdatum</b><span>${dNL(i.datum)}</span><b>Vervaldatum</b><span>${dNL(i.verval)}</span><b>Onderwerp</b><span>${esc(i.onderwerp)}</span><b style="margin-top:14px">Gefactureerd aan</b><span style="margin-top:14px;display:flex;flex-direction:column"><b>${esc(k.naam)}</b>${k.contact ? `<span>T.a.v. ${esc(k.contact)}</span>` : ""}${[k.adres, k.postcode, k.land].filter(Boolean).map(l => `<span>${esc(l)}</span>`).join("")}${k.btwnr ? `<span class="muted">Btw-nr: ${esc(k.btwnr)}</span>` : ""}</span></div></div></div>
    <table><thead><tr><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Prijs</th><th class="r">Totaal excl.</th><th class="r">Btw</th><th class="r">Totaal incl.</th></tr></thead><tbody>
      ${x.lines.map(l => `<tr><td><b>${esc(l.omschrijving)}</b></td><td class="r">${qty(l)}</td><td class="r">${eur(l.prijs)}</td><td class="r">${eur(l.excl)}</td><td class="r">${esc(l.btw)}</td><td class="r">${eur(l.excl * (1 + tarief(l.btw).pct))}</td></tr>`).join("")}
    </tbody></table>
    <div class="pt"><b>Subtotaal</b><b style="text-align:right">${eur(x.excl)}</b>${Object.entries(x.btw).filter(([, b]) => b).map(([t, b]) => `<b>Btw ${esc(t)}</b><b style="text-align:right">${eur(b)}</b>`).join("")}${x.verlegd ? `<b>Btw verlegd</b><span></span>` : ""}<span class="big">Totaal</span><span class="big">${eur(x.incl)}</span></div>
    <div style="margin-top:22px;max-width:60ch"><b style="font-size:14px">Betaling</b><p style="margin:4px 0 0">${payText(i, x)}</p>${x.verlegd ? `<p class="muted" style="margin:6px 0 0">Btw verlegd naar de afnemer.</p>` : ""}</div>
  </div></div>`;
}
function payText(i, x){ const c = S.settings.company; return `Gelieve het bedrag van ${eur(x.incl)} uiterlijk op ${dNL(i.verval)} over te maken naar rekeningnummer ${esc(c.iban || "…")}${c.ibanName ? " t.n.v. " + esc(c.ibanName) : ""}, met vermelding van het factuurnummer ${esc(i.nr)}.`; }

async function invoicePDF(i){
  if (!S.downloads){ toast("Downloaden is in deze weergave niet beschikbaar."); return; }
  if (!window.jspdf){ toast("De PDF-module is niet geladen. Herlaad de pagina."); return; }
  const {jsPDF} = window.jspdf; const pdf = new jsPDF({unit:"mm", format:"a4"});
  const c = S.settings.company, k = i.klant || S.clients[i.klantId] || {}, x = invCalc(i);
  const E = n => eur(n).replace(/ /g, " ");
  const ink = [34,34,34], mut = [102,102,102];
  let y = 22;
  pdf.setTextColor(...ink); pdf.setFont("helvetica","bold"); pdf.setFontSize(11); pdf.text(c.name || "", 20, y);
  pdf.setFont("helvetica","normal"); pdf.setFontSize(10);
  let ly = y + 6; for (const l of companyLines()){ pdf.text(l, 20, ly); ly += 5; }
  ly += 2; pdf.setFontSize(8.5); pdf.setTextColor(...mut);
  if (c.kvk){ pdf.text("KvK: " + c.kvk, 20, ly); ly += 4.5; }
  if (c.btwid){ pdf.text("Btw-id: " + c.btwid, 20, ly); ly += 4.5; }
  pdf.setTextColor(...ink); pdf.setFontSize(10);
  if (c.phone){ pdf.text(c.phone, 20, ly); ly += 5; }
  if (c.email){ pdf.text(c.email, 20, ly); ly += 5; }
  pdf.setFont("helvetica","bold"); pdf.setFontSize(22); pdf.text("Factuur", 190, y + 2, {align:"right"});
  let my = y + 16; pdf.setFontSize(8.5);
  for (const [a, b] of [["Factuurnummer", i.nr], ["Factuurdatum", dNL(i.datum)], ["Vervaldatum", dNL(i.verval)], ["Onderwerp", i.onderwerp || ""]]){ pdf.setFont("helvetica","bold"); pdf.text(a, 112, my); pdf.setFont("helvetica","normal"); pdf.text(String(b), 190, my, {align:"right"}); my += 6.5; }
  my += 3; pdf.setFont("helvetica","bold"); pdf.setFontSize(10); pdf.text("Gefactureerd aan", 112, my); pdf.text(k.naam || "", 190, my, {align:"right"}); pdf.setFont("helvetica","normal");
  for (const l of [k.contact ? "T.a.v. " + k.contact : "", k.adres, k.postcode, k.land].filter(Boolean)){ my += 5.5; pdf.text(l, 190, my, {align:"right"}); }
  if (k.btwnr){ my += 5; pdf.setFontSize(8.5); pdf.setTextColor(...mut); pdf.text("Btw-nr: " + k.btwnr, 190, my, {align:"right"}); pdf.setTextColor(...ink); }
  y = Math.max(ly, my) + 12;
  const header = () => { pdf.setFillColor(43,43,43); pdf.rect(20, y - 5.5, 170, 9, "F"); pdf.setTextColor(255,255,255); pdf.setFont("helvetica","bold"); pdf.setFontSize(8.5);
    pdf.text("Omschrijving", 24, y); pdf.text("Aantal", 108, y, {align:"right"}); pdf.text("Prijs", 128, y, {align:"right"}); pdf.text("Totaal excl.", 150, y, {align:"right"}); pdf.text("Btw", 162, y, {align:"center"}); pdf.text("Totaal incl.", 187, y, {align:"right"}); pdf.setTextColor(...ink); y += 10; };
  header();
  for (const l of x.lines){
    pdf.setFont("helvetica","bold"); pdf.setFontSize(9.5); const wrap = pdf.splitTextToSize(l.omschrijving || "", 72);
    if (y + wrap.length * 4.6 > 262){ pdf.addPage(); y = 25; header(); }
    pdf.text(wrap, 24, y); pdf.setFont("helvetica","normal"); pdf.setFontSize(8.5);
    pdf.text(nf(l.aantal) + (l.eenheid && l.eenheid !== "stuk" ? " " + l.eenheid : ""), 108, y, {align:"right"}); pdf.text(E(l.prijs), 128, y, {align:"right"}); pdf.text(E(l.excl), 150, y, {align:"right"}); pdf.text(String(l.btw), 162, y, {align:"center"}); pdf.text(E(l.excl * (1 + tarief(l.btw).pct)), 187, y, {align:"right"});
    y += wrap.length * 4.6 + 3; pdf.setDrawColor(230,230,230); pdf.line(20, y - 2, 190, y - 2); y += 2;
  }
  if (y > 230){ pdf.addPage(); y = 25; }
  y += 2; pdf.setFontSize(8.5); pdf.setFont("helvetica","bold");
  const tl = (a, b) => { pdf.text(a, 158, y, {align:"right"}); pdf.text(b, 187, y, {align:"right"}); y += 6; };
  tl("Subtotaal", E(x.excl)); for (const [t, b] of Object.entries(x.btw)) if (b) tl("Btw " + t, E(b)); if (x.verlegd) tl("Btw verlegd", "");
  pdf.setDrawColor(200,200,200); pdf.line(130, y - 3, 190, y - 3); y += 4; pdf.setFontSize(15); pdf.text("Totaal", 158, y, {align:"right"}); pdf.text(E(x.incl), 187, y, {align:"right"});
  y += 14; pdf.setFontSize(11); pdf.text("Betaling", 20, y); y += 6; pdf.setFont("helvetica","normal"); pdf.setFontSize(9.5);
  const txt = `Gelieve het bedrag van ${E(x.incl)} uiterlijk op ${dNL(i.verval)} over te maken naar rekeningnummer ${c.iban || ""}${c.ibanName ? " t.n.v. " + c.ibanName : ""}, met vermelding van het factuurnummer ${i.nr}.`;
  pdf.text(pdf.splitTextToSize(txt, 120), 20, y);
  if (x.verlegd){ y += 14; pdf.setTextColor(...mut); pdf.text("Btw verlegd naar de afnemer.", 20, y); }
  const n = pdf.getNumberOfPages(); for (let p = 1; p <= n; p++){ pdf.setPage(p); pdf.setFontSize(9); pdf.setTextColor(...ink); pdf.text(`Pagina ${p} van ${n}`, 190, 284, {align:"right"}); pdf.setDrawColor(220,220,220); pdf.line(20, 287, 190, 287); }
  const name = pdfName(i);
  try{ await S.downloads.save({filename:name, data:pdf.output("blob")}); }catch(e){ if (e?.code !== "cancelled" && e?.code !== "declined") toast("De PDF kon niet worden opgeslagen."); }
}

function billHoursDialog(){
  const open = list("hours").filter(h => !h.invoiceId && h.soort === "Declarabel");
  if (!open.length){ toast("Er zijn geen open declarabele uren."); return; }
  const per = {}; for (const h of open){ const k = h.klant || "(geen klant)"; per[k] = (per[k] || 0) + parseNum(h.uren); }
  const m = openSheet({title:"Open uren factureren", body:`<span class="muted">Kies voor welke klant je de open uren wilt factureren.</span><div style="display:flex;flex-direction:column;gap:8px">${Object.entries(per).map(([k, u]) => `<button class="btn" style="justify-content:space-between" data-k="${esc(k)}"><span>${esc(k)}</span><span class="num">${nf(u)} uur</span></button>`).join("")}</div>`});
  m.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { const cl = list("clients").find(c => c.naam === b.dataset.k); closeSheet(); editInvoice(null, {klantId:cl?.id || "", lines:[]}); setTimeout(() => pickHours(S.edit.data), 50); });
}

/* ---- Kosten ---- */
VIEWS.kosten = () => {
  const j = S.jaar; const rows = list("costs").filter(c => yearOf(c.datum) === j).sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const tot = rows.reduce((a, k) => { const c = costCalc(k); a.incl += c.incl; a.btw += c.aftrek; a.k += c.kosten; return a; }, {incl:0, btw:0, k:0});
  return `<div class="head"><div class="t"><span class="label">Inkoop</span><h1>Kosten & bonnen</h1></div><div class="row">${jaarSel()}<button class="btn" data-act="newCost">Kosten invoeren</button></div></div>
  ${S.assets ? `<div class="drop" id="drop"><b>Foto van een bon of een PDF-inkoopfactuur?</b><span class="small muted">Maak een foto, kies een of meer bestanden of sleep ze hierheen. ${S.canScan ? "Claude leest leverancier, datum, bedrag en btw uit; jij controleert en slaat op." : "Daarna vul je de bedragen in."}</span><div class="row" style="justify-content:center"><label class="btn primary"><input type="file" class="sr fileIn" accept="image/*" capture="environment">Foto maken</label><label class="btn"><input type="file" class="sr fileIn" accept="image/*,application/pdf" multiple>Bestand kiezen</label></div></div>` : ""}
  <div class="panel">${rows.length ? `<div class="tbl-wrap has-m"><table><thead><tr><th></th><th>Datum</th><th>Leverancier</th><th>Categorie</th><th class="r">Incl. btw</th><th class="r">Btw</th><th class="r">Aftrekbare btw</th><th class="r">Kosten excl.</th><th>Bank</th></tr></thead><tbody>
    ${rows.map(k => { const c = costCalc(k); return `<tr class="click" data-cost="${k.id}"><td>${thumb(k)}</td><td class="num">${dNL(k.datum)}</td><td>${esc(k.leverancier)}<div class="small muted">${esc(k.omschrijving)}</div></td><td>${esc(k.categorie)}</td><td class="r num">${eur(c.incl)}</td><td class="r num">${esc(k.btw)}</td><td class="r num">${c.na ? `<span class="chip" title="Btw niet aftrekbaar">n.v.t.</span>` : eur(c.aftrek)}</td><td class="r num">${c.auto ? `<span class="chip" title="Privéauto: valt onder de kilometervergoeding">km-vergoeding</span>` : eur(c.kosten)}${c.z < 1 ? `<div class="small muted">${Math.round(c.z * 100)}% zakelijk</div>` : ""}</td><td>${bankChip(k)}</td></tr>`; }).join("")}
    </tbody><tfoot><tr><td colspan="4">Totaal ${j}</td><td class="r num">${eur(tot.incl)}</td><td></td><td class="r num">${eur(tot.btw)}</td><td class="r num">${eur(tot.k)}</td><td></td></tr></tfoot></table></div>
    <div class="mcards">${rows.map(k => { const c = costCalc(k); return `<div class="mc" data-cost="${k.id}"><div><b>${esc(k.leverancier || "—")}</b><span class="small muted">${dNL(k.datum)} · ${esc(k.categorie)}</span></div><div><span class="num">${eur(c.incl)}</span><span class="small muted">btw ${eur(c.aftrek)}</span>${bankChip(k)}</div></div>`; }).join("")}</div>`
    : `<div class="empty"><h3>Nog geen kosten in ${j}</h3><span>Upload een bon of inkoopfactuur, of voer kosten met de hand in.</span></div>`}</div>
  <div class="panel"><div class="ph"><h2>Vaste kosten</h2><button class="btn sm" data-act="newRec">Vaste kosten toevoegen</button></div>${list("recurring").length ? `<div class="tbl-wrap"><table><thead><tr><th>Leverancier</th><th>Categorie</th><th>Elke</th><th class="r">Bedrag incl.</th><th>Laatst geboekt</th></tr></thead><tbody>${list("recurring").sort((a, b) => a.leverancier.localeCompare(b.leverancier)).map(r => `<tr class="click" data-rec="${r.id}"><td><b>${esc(r.leverancier)}</b><div class="small muted">${esc(r.omschrijving)}</div></td><td>${esc(r.categorie)}</td><td>${{maand:"maand", kwartaal:"kwartaal", jaar:"jaar"}[r.interval] || "maand"} op dag ${esc(r.dag)}</td><td class="r num">${eur(r.bedragIncl)}</td><td class="num">${r.laatste ? esc(r.laatste) : "—"}${r.eind && r.eind < monthKey(today()) ? ` <span class="chip">gestopt</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Abonnementen, verzekeringen en andere vaste lasten worden hier elke periode vanzelf als kosten geboekt.</div>`}</div>`;
};
BIND.kosten = () => {
  bindJaar(); bindActs(); document.querySelectorAll("[data-cost]").forEach(r => r.onclick = () => costDialog(r.dataset.cost));
  document.querySelectorAll("[data-rec]").forEach(r => r.onclick = () => recDialog(r.dataset.rec));
  const dr = $("#drop"); if (dr){ dr.ondragover = e => { e.preventDefault(); dr.style.borderColor = "var(--accent)"; }; dr.ondragleave = () => dr.style.borderColor = ""; dr.ondrop = e => { e.preventDefault(); dr.style.borderColor = ""; takeFiles(e.dataTransfer.files); }; }
};
ACTS.newCost = () => costDialog(null);
const isImg = t => /^image\//.test(t || "");
const blobUrl = id => (window.KB && KB.assets.url(id)) || "";
function thumb(k){ if (!k.assetId) return `<span class="thumb" title="${k.geenBon ? "Geen bon: geboekt op basis van de afschrijving" : "Geen bijlage"}">${k.geenBon ? "geen bon" : "—"}</span>`; if (!blobUrl(k.assetId)) return `<span class="thumb" title="Bijlage ontbreekt op dit toestel">?</span>`; return isImg(k.assetType) ? `<img class="thumb" src="${esc(blobUrl(k.assetId))}" alt="Bon" loading="lazy">` : `<span class="thumb">PDF</span>`; }
function costDialog(id, preset){
  const k = id ? {...S.costs[id]} : {datum:today(), leverancier:"", omschrijving:"", categorie:"", bedragIncl:"", btw:S.settings.tarieven[0]?.naam || "21%", zakelijk:1, betaalwijze:"Bank", ...preset};
  const tar = S.settings.tarieven.map(t => t.naam);
  const m = openSheet({title: id ? "Kosten bewerken" : "Kosten invoeren", body:`
    <div id="cScan"></div>
    ${k.assetId ? (blobUrl(k.assetId) ? `<div class="row">${isImg(k.assetType) ? `<img src="${esc(blobUrl(k.assetId))}" alt="Bon" style="max-height:180px;border-radius:8px;border:1px solid var(--line)">` : `<span class="thumb">PDF</span>`}<button type="button" class="btn sm" id="cOpen">Bijlage openen</button></div>` : `<div class="notice warn">De bijlage van deze kostenpost staat niet op dit toestel. Zet een back-up met bijlagen terug of voeg de bon opnieuw toe.</div>`) : ""}
    <div class="form">
      ${fld("Datum", inp("cDat", k.datum, 'type="date"'))}
      ${fld("Leverancier", inp("cLev", k.leverancier, 'autocomplete="off"'))}
      ${fld("Omschrijving", inp("cOms", k.omschrijving), "full")}
      ${fld("Categorie", sel("cCat", [["", "Kies…"], ...S.settings.categorieen], k.categorie))}
      ${fld("Betaald via", sel("cPay", ["Bank","Contant","Creditcard","Privé betaald"], k.betaalwijze))}
      ${fld("Bedrag incl. btw", inp("cBed", k.bedragIncl === "" ? "" : nf(k.bedragIncl), 'inputmode="decimal" class="mono"'))}
      ${fld("Btw-tarief", sel("cBtw", tar, k.btw))}
      ${fld("Zakelijk deel", sel("cZak", [...new Set([1,0.9,0.8,0.75,0.7,0.6,0.5,0.4,0.3,0.25,0.2,0.1,0, Number(k.zakelijk ?? 1)])].sort((a, b) => b - a).map(x => [x, x === 0 ? "0% (privé)" : Math.round(x * 100) + "%"]), k.zakelijk ?? 1))}
      <label class="row full small" style="align-items:flex-start;gap:8px"><input type="checkbox" id="cNa" style="width:auto;margin-top:3px" ${k.btwAftrekbaar === false ? "checked" : ""}><span><b>Btw niet aftrekbaar</b><br><span class="muted">Bijvoorbeeld eten en drinken in de horeca, of buitenlandse btw die ten onrechte is berekend. Het hele bedrag telt dan als kosten.</span></span></label>
      <label class="row full small" style="align-items:flex-start;gap:8px"><input type="checkbox" id="cAuto" style="width:auto;margin-top:3px" ${k.ibAftrekbaar === false ? "checked" : ""}><span><b>Privéauto: valt onder de kilometervergoeding</b><br><span class="muted">Geen kosten voor de inkomstenbelasting (dat dekt de vergoeding per zakelijke km). De btw is wel aftrekbaar voor het zakelijke deel: zet "Zakelijk deel" op je percentage zakelijke kilometers.</span></span></label>
      <div class="calc full" id="cCalc" aria-live="polite"></div>
    </div>`, foot:`${id ? `<button class="btn danger left" id="cDel">Verwijderen</button>` : ""}<button class="btn" data-close>Annuleren</button><button class="btn primary" id="cOk">Opslaan</button>`});
  m.querySelector("#cOpen")?.addEventListener("click", () => openAsset(k.assetId, k.assetName, k.assetType));
  const upd = () => { const c = costCalc({bedragIncl:parseNum(v("cBed")), btw:v("cBtw"), zakelijk:v("cZak"), btwAftrekbaar:!$("#cNa").checked, ibAftrekbaar:!$("#cAuto").checked}); $("#cCalc").innerHTML = `<span>Excl. btw <b class="num">${eur(c.excl)}</b></span><span>Btw <b class="num">${eur(c.btw)}</b></span><span>Aftrekbaar <b class="num">${eur(c.aftrek)}</b></span>${v("cCat") === INVEST ? `<span class="small">Zet de investering ook bij Activa voor de afschrijving.</span>` : ""}`; };
  m.querySelectorAll("input,select").forEach(x => { x.addEventListener("input", upd); x.addEventListener("change", upd); }); upd();
  m.querySelector("#cOk").onclick = async () => {
    if (!parseNum(v("cBed"))){ toast("Vul het bedrag incl. btw in."); return; }
    if (!v("cCat")){ toast("Kies een categorie."); return; }
    const doc = {datum:v("cDat"), leverancier:v("cLev").trim(), omschrijving:v("cOms").trim(), categorie:v("cCat"), betaalwijze:v("cPay"), bedragIncl:r2(parseNum(v("cBed"))), btw:v("cBtw"), zakelijk:Number(v("cZak")), btwAftrekbaar:!$("#cNa").checked, ibAftrekbaar:!$("#cAuto").checked, assetId:k.assetId || null, assetType:k.assetType || null, assetName:k.assetName || null, bankId:k.bankId || null, betaaldOp:k.betaaldOp || null};
    await save("costs", id, doc); closeSheet(); toast("Kosten opgeslagen"); afterCost();
    if (doc.categorie === INVEST && !id) setTimeout(() => activaDialog(null, {datum:doc.datum, omschrijving:doc.omschrijving || doc.leverancier, bedrag:costCalc(doc).excl}), 300);
  };
  if (id) m.querySelector("#cDel").onclick = async () => { closeSheet(); if (await ask("Kosten verwijderen", `${k.leverancier || "Deze regel"} van ${dNL(k.datum)} wordt verwijderd.`)){ await del("costs", id); if (k.bankId && S.bank[k.bankId]) await patch("bank", k.bankId, {status:"open", costId:null}); if (k.assetId && S.assets) S.assets.delete(k.assetId).catch(() => {}); toast("Verwijderd"); } };
  return m;
}
document.addEventListener("change", e => { if (!e.target.classList?.contains("fileIn")) return; const fs = [...e.target.files]; e.target.value = ""; takeFiles(fs); });
async function handleFile(file){
  if (!S.assets){ toast("Uploaden kan alleen als eigenaar van deze administratie."); return; }
  if (file.size > 20 * 1024 * 1024){ toast("Dit bestand is groter dan 20 MB."); return; }
  if (S.view !== "kosten") go("kosten");
  const m = costDialog(null, {assetName:file.name, assetType:file.type});
  const scan = $("#cScan"), ok = $("#cOk");
  scan.innerHTML = `<div class="notice"><span class="spin"></span> Bestand uploaden…</div>`; ok.disabled = true;
  let asset;
  try{ asset = await S.assets.upload(file); }catch(e){ scan.innerHTML = `<div class="notice warn">Uploaden lukte niet${e?.code === "quota_exceeded" ? ": de opslag voor bijlagen is vol" : ""}. Je kunt de kosten wel zonder bijlage opslaan.</div>`; ok.disabled = false; return; }
  ok.disabled = false;
  // bijlage koppelen aan het formulier
  ok.onclick = async () => {
    if (!parseNum(v("cBed"))){ toast("Vul het bedrag incl. btw in."); return; }
    if (!v("cCat")){ toast("Kies een categorie."); return; }
    const doc = {datum:v("cDat"), leverancier:v("cLev").trim(), omschrijving:v("cOms").trim(), categorie:v("cCat"), betaalwijze:v("cPay"), bedragIncl:r2(parseNum(v("cBed"))), btw:v("cBtw"), zakelijk:Number(v("cZak")), btwAftrekbaar:!$("#cNa").checked, ibAftrekbaar:!$("#cAuto").checked, assetId:asset.id, assetType:asset.contentType || file.type, assetName:file.name};
    await save("costs", null, doc); closeSheet(); toast("Kosten met bijlage opgeslagen"); afterCost();
    if (doc.categorie === INVEST) setTimeout(() => activaDialog(null, {datum:doc.datum, omschrijving:doc.omschrijving || doc.leverancier, bedrag:costCalc(doc).excl}), 300);
  };
  m.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { closeSheet(); S.assets.delete(asset.id).catch(() => {}); });
  if (!S.canScan){ scan.innerHTML = `<div class="notice">Bijlage geüpload. Vul de gegevens in en sla op.</div>`; return; }
  scan.innerHTML = `<div class="notice"><span class="spin"></span> Claude leest de bon uit… <button class="btn sm ghost" id="scStop">Stoppen</button></div>`;
  const ctl = new AbortController(); $("#scStop").onclick = () => ctl.abort();
  try{
    const res = await readReceipt(file, ctl.signal);
    if (!$("#cDat")) return;
    const setIf = (id, val) => { const el = $("#" + id); if (el && val != null && val !== "") el.value = val; };
    setIf("cDat", /^\d{4}-\d{2}-\d{2}$/.test(res.datum || "") ? res.datum : null);
    setIf("cLev", res.leverancier); setIf("cOms", res.omschrijving);
    if (res.bedragIncl != null) setIf("cBed", nf(parseNum(res.bedragIncl)));
    if (S.settings.tarieven.some(t => t.naam === res.btwTarief)) setIf("cBtw", res.btwTarief);
    if (S.settings.categorieen.includes(res.categorie)) setIf("cCat", res.categorie);
    if (res.nietAftrekbaar === true && $("#cNa")) $("#cNa").checked = true;
    $("#cBed").dispatchEvent(new Event("input"));
    scan.innerHTML = `<div class="notice">Uitgelezen door Claude. Controleer de velden${res.opmerking ? `: ${esc(res.opmerking)}` : ""}.</div>`;
  }catch(e){
    if (!$("#cScan")) return;
    const msg = {bad_key:"De API-sleutel wordt geweigerd. Controleer hem bij Instellingen.", offline:"Geen internet: vul de gegevens zelf in.", not_granted:"Uitlezen staat uit. Vul de gegevens zelf in.", cancelled:"Uitlezen gestopt. Vul de gegevens zelf in.", rate_limited:"Even te druk om uit te lezen. Vul de gegevens zelf in of probeer het later."}[e?.code] || "Uitlezen lukte niet. Vul de gegevens zelf in.";
    $("#cScan").innerHTML = `<div class="notice warn">${msg}</div>`;
  }
}
async function readReceipt(file, signal){
  const instr = `Je leest een Nederlandse bon of inkoopfactuur voor de boekhouding van een zzp'er. Geef ALLEEN een JSON-object terug met deze velden:
{"leverancier": string, "datum": "YYYY-MM-DD" of null, "omschrijving": korte omschrijving (max 8 woorden), "bedragIncl": totaalbedrag inclusief btw als getal met punt als decimaalteken, "btwTarief": een van ${JSON.stringify(S.settings.tarieven.map(t => t.naam))}, "categorie": een van ${JSON.stringify(S.settings.categorieen)}, "nietAftrekbaar": true als het eten/drinken in een restaurant of café betreft, of als een leverancier van buiten Nederland/de EU Nederlandse btw rekent (bijv. Anthropic, Apple, Google), anders false, "opmerking": korte opmerking als iets onduidelijk is, anders ""}.
Kies het btw-tarief dat het grootste deel van het bedrag betreft. Gebruik "verlegd" als op de factuur btw verlegd staat.`;
  if (file.type === "application/pdf"){
    const {text, image} = await pdfToInput(file);
    if (text && text.replace(/\s/g, "").length > 60) return S.sample.json(instr + "\n\nTekst van de factuur:\n" + text.slice(0, 12000), {signal});
    if (image) return S.sample.json(instr + "\n\nDe afbeelding is de eerste pagina van de factuur.", {signal, images:[image]});
    throw {code:"unreadable"};
  }
  const img = await shrink(file);
  return S.sample.json(instr + "\n\nDe afbeelding is een foto van de bon.", {signal, images:[img]});
}
async function shrink(file){
  try{
    const bmp = await createImageBitmap(file); const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc); cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise(r => cv.toBlob(b => r(b || file), "image/jpeg", 0.85));
  }catch(e){ return file; }
}
function loadScript(src){ return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); }
async function pdfToInput(file){
  const lib = await import("./pdf.min.mjs"); lib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.mjs";
  const doc = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported:false, enableXfa:false}).promise;
  let text = ""; for (let p = 1; p <= Math.min(doc.numPages, 3); p++){ const tc = await (await doc.getPage(p)).getTextContent(); text += tc.items.map(i => i.str).join(" ") + "\n"; }
  let image = null;
  if (text.replace(/\s/g, "").length <= 60){ const page = await doc.getPage(1); const vp = page.getViewport({scale:2}); const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height; await page.render({canvasContext:cv.getContext("2d"), viewport:vp}).promise; image = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85)); }
  return {text, image};
}

/* ---- Meerdere bonnen tegelijk ---- */
function takeFiles(list){ const files = [...(list || [])]; if (!files.length) return; if (files.length === 1) handleFile(files[0]); else handleBatch(files); }
async function handleBatch(files){
  if (!S.assets){ toast("Uploaden kan alleen als eigenaar van deze administratie."); return; }
  if (S.view !== "kosten") go("kosten");
  const tar = S.settings.tarieven.map(t => t.naam), cats = S.settings.categorieen;
  const rows = files.map((f, n) => ({n, file:f, st:"wacht", asset:null, saved:false, err:f.size > 20 * 1024 * 1024 ? "Groter dan 20 MB" : null}));
  const card = r => `<div class="panel" data-b="${r.n}" style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">
    <div class="row" style="justify-content:space-between"><span class="row" style="min-width:0"><label class="row small"><input type="checkbox" data-bchk="${r.n}" style="width:auto" ${r.err ? "disabled" : "checked"} aria-label="Opslaan"></label>${/^image\//.test(r.file.type) ? `<img class="thumb" src="${URL.createObjectURL(r.file)}" alt="">` : `<span class="thumb">PDF</span>`}<b style="overflow-wrap:anywhere">${esc(r.file.name)}</b></span><span data-bst="${r.n}">${r.err ? `<span class="chip bad">${esc(r.err)}</span>` : `<span class="chip">In de wachtrij</span>`}</span></div>
    <div class="form">${fld("Datum", `<input type="date" data-bfield="datum" value="${today()}">`)}${fld("Leverancier", `<input data-bfield="leverancier">`)}${fld("Bedrag incl. btw", `<input data-bfield="bedragIncl" inputmode="decimal" class="mono">`)}${fld("Btw-tarief", `<select data-bfield="btw">${tar.map(t => `<option>${esc(t)}</option>`).join("")}</select>`)}${fld("Categorie", `<select data-bfield="categorie"><option value="">Kies…</option>${cats.map(t => `<option>${esc(t)}</option>`).join("")}</select>`)}${fld("Omschrijving", `<input data-bfield="omschrijving">`)}<label class="row small full"><input type="checkbox" data-bfield="na" style="width:auto"> Btw niet aftrekbaar (horeca, buitenlandse btw)</label></div></div>`;
  const m = openSheet({title:`${files.length} bonnen verwerken`, wide:true, body:`<div class="notice" id="bSum"><span class="spin"></span> Bestanden uploaden${S.canScan ? " en uitlezen" : ""}…</div><div style="display:flex;flex-direction:column;gap:12px">${rows.map(card).join("")}</div>`,
    foot:`<button class="btn left" id="bCancel">Annuleren</button><button class="btn primary" id="bSave" disabled>Opslaan</button>`});
  const el = (n, sel) => m.querySelector(`[data-b="${n}"] ${sel}`);
  const setSt = (r, html) => { const x = m.querySelector(`[data-bst="${r.n}"]`); if (x) x.innerHTML = html; };
  let cancelled = false;
  const cleanup = () => { cancelled = true; for (const r of rows) if (r.asset && !r.saved) S.assets.delete(r.asset.id).catch(() => {}); };
  m.querySelector("#bCancel").onclick = () => { cleanup(); closeSheet(); };
  m.querySelectorAll("[data-close]").forEach(b => b.onclick = () => { cleanup(); closeSheet(); });
  const dupOf = (datum, bedrag) => list("costs").some(c => c.datum === datum && Math.abs(parseNum(c.bedragIncl) - bedrag) < 0.005);
  const work = async r => {
    if (r.err || cancelled) return;
    setSt(r, `<span class="chip"><span class="spin"></span> Uploaden</span>`);
    try{ r.asset = await S.assets.upload(r.file); }catch(e){ r.err = "Upload mislukt"; setSt(r, `<span class="chip bad">Upload mislukt</span>`); el(r.n, "[data-bchk]").checked = false; el(r.n, "[data-bchk]").disabled = true; return; }
    if (cancelled || !$("#bSum")) return;
    if (!S.canScan){ r.st = "klaar"; setSt(r, `<span class="chip warn">Zelf invullen</span>`); return; }
    setSt(r, `<span class="chip"><span class="spin"></span> Claude leest</span>`);
    try{
      const res = await readReceipt(r.file);
      if (!$("#bSum")) return;
      const put = (k, val) => { const x = el(r.n, `[data-bfield="${k}"]`); if (x && val != null && val !== "" && !x.dataset.touched) x.value = val; };
      if (/^\d{4}-\d{2}-\d{2}$/.test(res.datum || "")) put("datum", res.datum);
      put("leverancier", res.leverancier); put("omschrijving", res.omschrijving);
      if (res.bedragIncl != null) put("bedragIncl", nf(parseNum(res.bedragIncl)));
      if (tar.includes(res.btwTarief)) put("btw", res.btwTarief);
      if (cats.includes(res.categorie)) put("categorie", res.categorie);
      if (res.nietAftrekbaar === true){ const x = el(r.n, '[data-bfield="na"]'); if (x && !x.dataset.touched) x.checked = true; }
      const dup = dupOf(el(r.n, '[data-bfield="datum"]').value, parseNum(el(r.n, '[data-bfield="bedragIncl"]').value));
      if (dup) el(r.n, "[data-bchk]").checked = false;
      setSt(r, dup ? `<span class="chip warn">Mogelijk dubbel</span>` : `<span class="chip ok">Uitgelezen</span>`);
    }catch(e){ setSt(r, `<span class="chip warn">Zelf invullen</span>`); }
    r.st = "klaar";
  };
  m.querySelectorAll("[data-bfield]").forEach(x => x.addEventListener("input", () => x.dataset.touched = "1"));
  const queue = rows.filter(r => !r.err); let idx = 0;
  await Promise.all([0, 1].map(async () => { while (idx < queue.length && !cancelled){ await work(queue[idx++]); } }));
  if (cancelled || !$("#bSum")) return;
  rows.forEach(r => { if (!r.err) r.st = "klaar"; });
  $("#bSum").className = "notice"; $("#bSum").textContent = "Controleer de gegevens en sla op. Uitgevinkte bonnen worden niet opgeslagen.";
  const btn = $("#bSave"); btn.disabled = false; const upd = () => btn.textContent = `Opslaan (${m.querySelectorAll("[data-bchk]:checked").length})`; upd();
  m.querySelectorAll("[data-bchk]").forEach(x => x.onchange = upd);
  btn.onclick = async () => {
    const pick = rows.filter(r => !r.err && el(r.n, "[data-bchk]").checked);
    for (const r of pick){ const bed = parseNum(el(r.n, '[data-bfield="bedragIncl"]').value), cat = el(r.n, '[data-bfield="categorie"]').value;
      if (!bed || !cat){ toast(`Vul bedrag en categorie in bij ${r.file.name}`); el(r.n, !bed ? '[data-bfield="bedragIncl"]' : '[data-bfield="categorie"]').focus(); return; } }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Opslaan';
    let n = 0, inv = 0;
    for (const r of pick){
      const g = k => el(r.n, `[data-bfield="${k}"]`).value;
      const doc = {datum:g("datum") || today(), leverancier:g("leverancier").trim(), omschrijving:g("omschrijving").trim(), categorie:g("categorie"), betaalwijze:"Bank", bedragIncl:r2(parseNum(g("bedragIncl"))), btw:g("btw"), zakelijk:1, btwAftrekbaar:!el(r.n, '[data-bfield="na"]').checked, assetId:r.asset?.id || null, assetType:r.asset?.contentType || r.file.type || null, assetName:r.file.name};
      try{ await save("costs", null, doc); r.saved = true; n++; if (doc.categorie === INVEST) inv++; }catch(e){ break; }
    }
    for (const r of rows) if (r.asset && !r.saved) S.assets.delete(r.asset.id).catch(() => {});
    closeSheet(); toast(`${n} bonnen opgeslagen${inv ? ` · zet ${inv} investering(en) ook bij Activa` : ""}`); afterCost();
  };
}

/* ---- Uren ---- */
VIEWS.uren = () => {
  const j = S.jaar; const rows = list("hours").filter(h => yearOf(h.datum) === j).sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const tot = rows.reduce((a, h) => a + parseNum(h.uren), 0); const pct = Math.min(100, Math.round(tot / S.settings.urennorm * 100));
  const openH = list("hours").filter(h => !h.invoiceId && h.soort === "Declarabel"); const openT = openH.reduce((a, h) => a + parseNum(h.uren), 0);
  const tag = h => h.invoiceId ? `<span class="chip ok">Gefactureerd ${esc(h.invoiceNr || S.invoices[h.invoiceId]?.nr || "")}</span>` : h.soort === "Declarabel" ? `<span class="chip warn">Nog te factureren</span>` : `<span class="chip">${esc(h.soort)}</span>`;
  return `<div class="head"><div class="t"><span class="label">Urenregistratie</span><h1>Uren</h1></div><div class="row">${jaarSel()}${openH.length ? `<button class="btn" data-act="billHours">Factureer ${nf(openT)} open uur</button>` : ""}<button class="btn" data-act="importHours">Uren importeren</button><button class="btn primary" data-act="newHour">Uren invoeren</button></div></div>
  <div class="kpis"><div class="kpi"><span class="label">Uren ${j}</span><span class="v">${nf(tot, 1)}</span></div><div class="kpi"><span class="label">Urencriterium</span><span class="v">${pct}%</span><div class="bar"><i style="width:${pct}%"></i></div></div><div class="kpi"><span class="label">Nog te factureren</span><span class="v">${nf(openT, 1)}</span></div><div class="kpi"><span class="label">Uit facturen</span><span class="v">${nf(rows.filter(h => h.bron === "factuur").reduce((a, h) => a + parseNum(h.uren), 0), 1)}</span></div></div>
  <div class="notice">Uren op een factuur (eenheid “uur”) komen bij het boeken vanzelf hier. Andersom kun je hier uren schrijven en ze later in één keer factureren.</div>
  <div class="panel">${rows.length ? `<div class="tbl-wrap has-m"><table><thead><tr><th>Datum</th><th>Klant</th><th>Omschrijving</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>${rows.map(h => `<tr class="click" data-hour="${h.id}"><td class="num">${dNL(h.datum)}</td><td>${esc(h.klant)}</td><td>${esc(h.omschrijving)}${h.bron === "factuur" ? `<div class="small muted">uit factuur</div>` : ""}</td><td class="r num">${nf(h.uren)}</td><td>${tag(h)}</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="3">Totaal ${j}</td><td class="r num">${nf(tot)}</td><td></td></tr></tfoot></table></div>
  <div class="mcards">${rows.map(h => `<div class="mc" data-hour="${h.id}"><div><b>${esc(h.omschrijving || "—")}</b><span class="small muted">${dNL(h.datum)} · ${esc(h.klant)}</span></div><div><span class="num">${nf(h.uren)} uur</span>${tag(h)}</div></div>`).join("")}</div>`
  : `<div class="empty"><h3>Nog geen uren in ${j}</h3><span>Boek een factuur met uren, of voer uren in.</span></div>`}</div>`;
};
BIND.uren = () => { bindJaar(); bindActs(); document.querySelectorAll("[data-hour]").forEach(r => r.onclick = () => hourDialog(r.dataset.hour)); };
ACTS.newHour = () => hourDialog(null);
function hourDialog(id){
  const h = id ? S.hours[id] : {datum:today(), klant:"", omschrijving:"", uren:"", soort:"Declarabel"};
  const fromInv = h.bron === "factuur";
  const m = openSheet({title: id ? "Uren bewerken" : "Uren invoeren", body:`${fromInv ? `<div class="notice">Deze uren komen uit factuur ${esc(h.invoiceNr || "")}. Aantal en klant pas je aan op de factuur; de datum kun je hier op de werkdatum zetten.</div>` : ""}<div class="form">
    ${fld("Datum", inp("hDat", h.datum, 'type="date"'))}
    ${fld("Uren", inp("hUur", h.uren === "" ? "" : nf(h.uren), `inputmode="decimal" class="mono" ${fromInv ? "disabled" : ""}`))}
    ${fld("Klant / project", `<input id="hKl" list="klList" value="${esc(h.klant)}" ${fromInv ? "disabled" : ""}><datalist id="klList">${list("clients").map(c => `<option value="${esc(c.naam)}">`).join("")}</datalist>`)}
    ${fld("Soort werk", sel("hSrt", ["Declarabel","Acquisitie","Administratie","Opleiding","Overig"], h.soort, fromInv ? "disabled" : ""))}
    ${fld("Omschrijving", inp("hOms", h.omschrijving), "full")}</div>`, foot:`${id && !fromInv ? `<button class="btn danger left" id="hDel">Verwijderen</button>` : ""}<button class="btn" data-close>Annuleren</button><button class="btn primary" id="hOk">Opslaan</button>`});
  m.querySelector("#hOk").onclick = async () => {
    if (fromInv){ await patch("hours", id, {datum:v("hDat"), omschrijving:v("hOms")}); closeSheet(); return toast("Opgeslagen"); }
    if (!parseNum(v("hUur"))) return toast("Vul het aantal uren in.");
    await save("hours", id, {...(id ? clean(h) : {}), datum:v("hDat"), uren:parseNum(v("hUur")), klant:v("hKl").trim(), soort:v("hSrt"), omschrijving:v("hOms").trim(), bron:h.bron || "handmatig", invoiceId:h.invoiceId || null, invoiceNr:h.invoiceNr || null});
    closeSheet(); toast("Uren opgeslagen");
  };
  if (m.querySelector("#hDel")) m.querySelector("#hDel").onclick = async () => { await del("hours", id); closeSheet(); toast("Verwijderd"); };
}

/* ---- Ritten ---- */
VIEWS.ritten = () => {
  const j = S.jaar; const rows = list("rides").filter(r => yearOf(r.datum) === j).sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const km = rows.reduce((a, r) => a + parseNum(r.km), 0);
  return `<div class="head"><div class="t"><span class="label">Kilometerregistratie</span><h1>Ritten</h1></div><div class="row">${jaarSel()}<button class="btn primary" data-act="newRide">Rit toevoegen</button></div></div>
  <div class="kpis"><div class="kpi"><span class="label">Kilometers ${j}</span><span class="v">${nf(km, 0)}</span></div><div class="kpi"><span class="label">Vergoeding</span><span class="v">${eur(km * S.settings.kmTarief)}</span><span class="small muted">${eur(S.settings.kmTarief)} per km</span></div></div>
  <div class="panel">${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Datum</th><th>Van → naar</th><th>Doel</th><th class="r">Km</th><th class="r">Vergoeding</th></tr></thead><tbody>${rows.map(r => `<tr class="click" data-ride="${r.id}"><td class="num">${dNL(r.datum)}</td><td>${esc(r.van)} → ${esc(r.naar)}</td><td>${esc(r.doel)}</td><td class="r num">${nf(r.km, 0)}</td><td class="r num">${eur(parseNum(r.km) * S.settings.kmTarief)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><h3>Nog geen ritten in ${j}</h3><span>Alleen zakelijke ritten met je privéauto.</span></div>`}</div>`;
};
BIND.ritten = () => { bindJaar(); bindActs(); document.querySelectorAll("[data-ride]").forEach(r => r.onclick = () => rideDialog(r.dataset.ride)); };
ACTS.newRide = () => rideDialog(null);
function rideDialog(id){
  const r = id ? S.rides[id] : {datum:today(), van:S.settings.company.address ? `${S.settings.company.address}, ${S.settings.company.postcode}` : "", naar:"", doel:"", km:"", retour:false};
  const m = openSheet({title: id ? "Rit bewerken" : "Rit toevoegen", body:`<div class="form">${fld("Datum", inp("rDat", r.datum, 'type="date"'))}${fld("Kilometers", inp("rKm", r.km, 'inputmode="decimal" class="mono"'))}${fld("Van", inp("rVan", r.van))}${fld("Naar", `<input id="rNaar" list="adrList" value="${esc(r.naar)}"><datalist id="adrList">${list("clients").map(c => `<option value="${esc([c.adres, c.postcode].filter(Boolean).join(", "))}">`).join("")}</datalist>`)}${fld("Doel / klant", inp("rDoel", r.doel), "full")}${id ? "" : `<label class="row full"><input type="checkbox" id="rRet" style="width:auto"> Heen en terug (kilometers × 2)</label>`}</div>`, foot:`${id ? `<button class="btn danger left" id="rDel">Verwijderen</button>` : ""}<button class="btn" data-close>Annuleren</button><button class="btn primary" id="rOk">Opslaan</button>`});
  m.querySelector("#rOk").onclick = async () => { const km = parseNum(v("rKm")) * ($("#rRet")?.checked ? 2 : 1); if (!km) return toast("Vul de kilometers in."); await save("rides", id, {datum:v("rDat"), van:v("rVan"), naar:v("rNaar"), doel:v("rDoel"), km}); closeSheet(); toast("Rit opgeslagen"); };
  if (id) m.querySelector("#rDel").onclick = async () => { await del("rides", id); closeSheet(); toast("Verwijderd"); };
}

/* ---- Activa ---- */
VIEWS.activa = () => {
  const j = S.jaar; const rows = list("activa").sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const tot = rows.reduce((a, x) => a + activaCalc(x, j).dit, 0);
  return `<div class="head"><div class="t"><span class="label">Investeringen</span><h1>Activa en afschrijving</h1></div><div class="row">${jaarSel()}<button class="btn primary" data-act="newAct">Investering toevoegen</button></div></div>
  <div class="notice">Bedrijfsmiddelen vanaf ongeveer € 450 excl. btw schrijf je af over de levensduur, vanaf de maand van aankoop. De btw op de aankoop krijg je terug via Kosten (categorie ‘${INVEST}’).</div>
  <div class="panel">${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Aanschaf</th><th>Omschrijving</th><th class="r">Bedrag excl.</th><th class="r">Jaren</th><th class="r">Per jaar</th><th class="r">Afschrijving ${j}</th><th class="r">Boekwaarde eind ${j}</th></tr></thead><tbody>${rows.map(a => { const c = activaCalc(a, j); return `<tr class="click" data-act-id="${a.id}"><td class="num">${dNL(a.datum)}</td><td>${esc(a.omschrijving)}</td><td class="r num">${eur(a.bedrag)}</td><td class="r num">${nf(a.jaren)}</td><td class="r num">${eur(c.perJaar)}</td><td class="r num">${eur(c.dit)}</td><td class="r num">${c.boekwaarde == null ? "—" : eur(c.boekwaarde)}</td></tr>`; }).join("")}</tbody><tfoot><tr><td colspan="5">Totaal ${j}</td><td class="r num">${eur(tot)}</td><td></td></tr></tfoot></table></div>` : `<div class="empty"><h3>Nog geen investeringen</h3><span>Een laptop, gereedschap of bureau van meer dan ongeveer € 450 komt hier.</span></div>`}</div>`;
};
BIND.activa = () => { bindJaar(); bindActs(); document.querySelectorAll("[data-act-id]").forEach(r => r.onclick = () => activaDialog(r.dataset.actId)); };
ACTS.newAct = () => activaDialog(null);
function activaDialog(id, preset){
  const a = id ? S.activa[id] : {datum:today(), omschrijving:"", bedrag:"", rest:0, jaren:5, ...preset};
  const m = openSheet({title: id ? "Investering bewerken" : "Investering toevoegen", body:`<div class="form">${fld("Aanschafdatum", inp("aDat", a.datum, 'type="date"'))}${fld("Omschrijving", inp("aOms", a.omschrijving))}${fld("Aanschafbedrag excl. btw", inp("aBed", a.bedrag === "" ? "" : nf(a.bedrag), 'inputmode="decimal" class="mono"'))}${fld("Restwaarde", inp("aRest", nf(a.rest), 'inputmode="decimal" class="mono"'))}${fld("Levensduur (jaren)", inp("aJr", a.jaren, 'inputmode="numeric" class="mono"'))}<div class="calc" id="aCalc"></div></div>`, foot:`${id ? `<button class="btn danger left" id="aDel">Verwijderen</button>` : ""}<button class="btn" data-close>Annuleren</button><button class="btn primary" id="aOk">Opslaan</button>`});
  const upd = () => { const c = activaCalc({datum:v("aDat"), bedrag:parseNum(v("aBed")), rest:parseNum(v("aRest")), jaren:parseNum(v("aJr"))}, S.jaar); $("#aCalc").innerHTML = `<span>Per jaar <b class="num">${eur(c.perJaar)}</b></span><span>In ${S.jaar} <b class="num">${eur(c.dit)}</b></span>`; };
  m.querySelectorAll("input").forEach(x => x.addEventListener("input", upd)); upd();
  m.querySelector("#aOk").onclick = async () => { if (!parseNum(v("aBed")) || !parseNum(v("aJr"))) return toast("Vul bedrag en levensduur in."); await save("activa", id, {datum:v("aDat"), omschrijving:v("aOms"), bedrag:parseNum(v("aBed")), rest:parseNum(v("aRest")), jaren:parseNum(v("aJr"))}); closeSheet(); toast("Investering opgeslagen"); };
  if (id) m.querySelector("#aDel").onclick = async () => { await del("activa", id); closeSheet(); toast("Verwijderd"); };
}

/* ---- Btw ---- */
VIEWS.btw = () => {
  const j = S.jaar; const qs = [1,2,3,4].map(q => btwKwartaal(j, q));
  const sum = (f) => r2(qs.reduce((a, q) => a + f(q), 0));
  const rows = [["1a", "Leveringen/diensten belast met hoog tarief", q => q["1a"]], ["1b", "Leveringen/diensten belast met laag tarief", q => q["1b"]], ["1e", "Belast met 0% of niet bij u belast (incl. verlegd)", q => q["1e"]]];
  const cell = (val, strong) => `<td class="r num" ${strong ? 'style="font-weight:600"' : ""}>${eur(val)}</td>`;
  const curQ = j === new Date().getFullYear() ? Math.ceil((new Date().getMonth() + 1) / 3) : 0;
  return `<div class="head"><div class="t"><span class="label">Omzetbelasting</span><h1>Btw-aangifte ${j}</h1></div><div class="row">${jaarSel()}</div></div>
  <div class="panel"><div class="tbl-wrap"><table><thead><tr><th>Rubriek</th>${[1,2,3,4].map(q => `<th class="r">Q${q}${q === curQ ? " (nu)" : ""}</th>`).join("")}<th class="r">Jaar</th></tr></thead><tbody>
    ${rows.map(([k, t, f]) => `<tr><td><b class="mono">${k}</b> ${t}<div class="small muted">omzet</div></td>${qs.map(q => cell(f(q).g)).join("")}${cell(sum(q => f(q).g))}</tr>${k !== "1e" ? `<tr><td><b class="mono">${k}</b> <span class="muted">omzetbelasting</span></td>${qs.map(q => cell(f(q).b)).join("")}${cell(sum(q => f(q).b))}</tr>` : ""}`).join("")}
    <tr><td><b>Verschuldigde btw</b></td>${qs.map(q => cell(q.verschuldigd, 1)).join("")}${cell(sum(q => q.verschuldigd), 1)}</tr>
    <tr><td><b class="mono">5b</b> Voorbelasting</td>${qs.map(q => cell(q.vb)).join("")}${cell(sum(q => q.vb))}</tr>
    <tr style="background:var(--accent-soft)"><td><b>Te betalen (+) / terug (−)</b></td>${qs.map(q => cell(q.saldo, 1)).join("")}${cell(sum(q => q.saldo), 1)}</tr>
    <tr><td class="muted">Uiterste aangiftedatum</td>${qs.map(q => `<td class="r num muted">${dNL(q.deadline)}</td>`).join("")}<td></td></tr>
  </tbody></table></div></div>
  <p class="small muted" style="max-width:70ch;margin:0">De Belastingdienst rondt af op hele euro’s (omzet naar beneden). Diensten aan klanten in andere EU-landen horen in rubriek 3b en worden hier niet apart gesplitst. Controleer je aangifte altijd zelf.</p>`;
};
BIND.btw = () => bindJaar();

/* ---- Klanten ---- */
VIEWS.klanten = () => {
  const rows = list("clients").sort((a, b) => a.naam.localeCompare(b.naam));
  const omzet = id => r2(booked().filter(i => i.klantId === id).reduce((a, i) => a + invCalc(i).excl, 0));
  return `<div class="head"><div class="t"><span class="label">Debiteuren</span><h1>Klanten</h1></div><button class="btn primary" data-act="newClient">Klant toevoegen</button></div>
  <div class="panel">${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Naam</th><th>Adres</th><th class="hide-m">Btw-nummer</th><th class="r">Omzet totaal</th></tr></thead><tbody>${rows.map(c => `<tr class="click" data-cl="${c.id}"><td><b>${esc(c.naam)}</b>${c.email ? `<div class="small muted">${esc(c.email)}</div>` : ""}</td><td>${esc([c.adres, c.postcode].filter(Boolean).join(", "))}</td><td class="mono hide-m">${esc(c.btwnr || "—")}</td><td class="r num">${eur(omzet(c.id))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><h3>Nog geen klanten</h3><button class="btn primary" data-act="newClient">Klant toevoegen</button></div>`}</div>`;
};
BIND.klanten = () => { bindActs(); document.querySelectorAll("[data-cl]").forEach(r => r.onclick = () => clientDialog(r.dataset.cl)); };
ACTS.newClient = () => clientDialog(null);
function clientDialog(id, after){
  const c = id ? S.clients[id] : {naam:"", adres:"", postcode:"", land:"Nederland", btwnr:"", kvk:"", email:"", contact:""};
  const m = openSheet({title: id ? "Klant bewerken" : "Klant toevoegen", body:`<div class="form">${fld("Naam", inp("kNaam", c.naam), "full")}${fld("Adres", inp("kAdr", c.adres))}${fld("Postcode en plaats", inp("kPc", c.postcode))}${fld("Land", inp("kLand", c.land))}${fld("Btw-nummer", inp("kBtw", c.btwnr, 'class="mono"'))}${fld("KvK-nummer", inp("kKvk", c.kvk, 'class="mono"'))}${fld("E-mail", inp("kMail", c.email, 'type="email"'))}${fld("Contactpersoon / t.a.v.", inp("kCon", c.contact))}${fld("Uurtarief", inp("kUur", c.uurtarief == null || c.uurtarief === "" ? "" : nf(c.uurtarief), 'inputmode="decimal" class="mono" placeholder="standaard"'))}</div>`, foot:`${id ? `<button class="btn danger left" id="kDel">Verwijderen</button>` : ""}<button class="btn" data-close>Annuleren</button><button class="btn primary" id="kOk">Opslaan</button>`});
  m.querySelector("#kOk").onclick = async () => { if (!v("kNaam").trim()) return toast("Vul een naam in."); const nid = await save("clients", id, {naam:v("kNaam").trim(), adres:v("kAdr").trim(), postcode:v("kPc").trim(), land:v("kLand").trim(), btwnr:v("kBtw").trim(), kvk:v("kKvk").trim(), email:v("kMail").trim(), contact:v("kCon").trim(), uurtarief: v("kUur").trim() ? parseNum(v("kUur")) : null}); closeSheet(); toast("Klant opgeslagen"); if (after){ S.clients[nid] = {id:nid, naam:v("kNaam")}; after(nid); } };
  if (id) m.querySelector("#kDel").onclick = async () => { if (list("invoices").some(i => i.klantId === id)){ toast("Deze klant heeft facturen en kan niet weg."); return; } await del("clients", id); closeSheet(); toast("Verwijderd"); };
}

/* ---- Instellingen ---- */
VIEWS.instellingen = () => {
  const s = S.settings, c = s.company;
  return `<div class="head"><div class="t"><span class="label">Beheer</span><h1>Instellingen</h1></div><button class="btn primary" id="sOk">Opslaan</button></div>
  <div class="panel"><div class="ph"><h2>Bedrijfsgegevens</h2><span class="small muted">Komen op elke nieuwe factuur</span></div><div class="pb"><div class="form">
    ${fld("Bedrijfsnaam", inp("sNaam", c.name))}${fld("KvK-nummer", inp("sKvk", c.kvk, 'class="mono"'))}
    ${fld("Adres", inp("sAdr", c.address))}${fld("Postcode en plaats", inp("sPc", c.postcode))}
    ${fld("Land", inp("sLand", c.country))}${fld("Btw-identificatienummer", inp("sBtw", c.btwid, 'class="mono" placeholder="NL000000000B01"'))}
    ${fld("Telefoon", inp("sTel", c.phone))}${fld("E-mail", inp("sMail", c.email, 'type="email"'))}
    ${fld("IBAN", inp("sIban", c.iban, 'class="mono"'))}${fld("Ten name van", inp("sTnv", c.ibanName))}
    ${fld("Je naam (onder je mails)", inp("sMyName", c.naam))}
  </div></div></div>
  <div class="panel"><div class="ph"><h2>Mail bij een factuur</h2><span class="ph-hint">{nr} {klant} {contact} {onderwerp} {bedrag} {vervaldatum} {iban} {tnv} {naam} {bedrijf} {telefoon}</span></div><div class="pb"><div class="form">
    ${fld("Onderwerp", inp("sMailOnd", s.mail.onderwerp), "full")}
    ${fld("Tekst", `<textarea id="sMailTxt" rows="11">${esc(s.mail.tekst)}</textarea>`, "full")}
  </div></div></div>
  <div class="panel"><div class="ph"><h2>Herinnering bij een te late factuur</h2><span class="ph-hint">ook {dagen} = dagen te laat</span></div><div class="pb"><div class="form">
    ${fld("Onderwerp", inp("sHerOnd", s.herinnering.onderwerp), "full")}
    ${fld("Tekst", `<textarea id="sHerTxt" rows="11">${esc(s.herinnering.tekst)}</textarea>`, "full")}
  </div></div></div>
  <div class="panel"><div class="ph"><h2>Belasting en aftrekposten</h2><span class="small muted">Voor het belastingpotje en het jaarrapport</span></div><div class="pb">
    <div class="form" style="margin-bottom:6px">${fld("Fiscaal jaarloon uit dienstverband", inp("bLoon", s.belasting.loon ? nf(s.belasting.loon) : "", 'inputmode="decimal" class="mono" placeholder="0"'), "full")}<span class="small muted full">Bruto jaarloon inclusief vakantiegeld en eindejaarsuitkering, min je eigen pensioenpremie. Staat op je jaaropgave of loonstrook.</span></div>
    <div class="sw"><div class="txt"><b>Zelfstandigenaftrek</b><span class="small muted">Alleen als je minstens ${nf(s.urennorm,0)} uur aan je onderneming besteedt én, naast een baan, meer dan de helft van je werktijd. In 2026 € 1.200, in 2027 € 900.</span></div><label class="toggle"><input type="checkbox" id="sZa" ${s.belasting.za ? "checked" : ""} aria-label="Zelfstandigenaftrek"><span></span></label></div>
    <div class="sw"><div class="txt"><b>Startersaftrek</b><span class="small muted">Alleen in de eerste 5 jaar als ondernemer, maximaal 3 keer. Na meer dan 3 jaar zzp meestal niet meer van toepassing.</span></div><label class="toggle"><input type="checkbox" id="sSa" ${s.belasting.sa ? "checked" : ""} aria-label="Startersaftrek"><span></span></label></div>
    <div class="sw"><div class="txt"><b>Mkb-winstvrijstelling</b><span class="small muted">Altijd van toepassing, ook zonder urencriterium.</span></div><span class="num">${nf(s.belasting.mkb * 100, 1)}%</span></div>
    <div class="sw"><div class="txt"><b>Urencontrole in jaarrapport</b><span class="small muted">Toon de controle op het urencriterium (zelfstandigenaftrek) en de uren per maand in het jaarrapport. Zet uit om het rapport zonder urencontrole te printen. De berekening zelf verandert hierdoor niet.</span></div><label class="toggle"><input type="checkbox" id="sRepUren" ${s.rapport.urencriterium ? "checked" : ""} aria-label="Urencontrole in jaarrapport"><span></span></label></div>
    <details style="margin-top:10px"><summary class="small" style="cursor:pointer">Tarieven ${esc(s.belasting.jaar)} aanpassen</summary><div class="form" style="margin-top:12px">
      ${[["bZa","Zelfstandigenaftrek (€)","zaBedrag",1],["bSa","Startersaftrek (€)","saBedrag",1],["bMkb","Mkb-winstvrijstelling (%)","mkb",100],["bS1","Eerste schijf tot (€)","s1",1],["bT1","Tarief schijf 1 (%)","t1",100],["bS2","Tweede schijf tot (€)","s2",1],["bT2","Tarief schijf 2 (%)","t2",100],["bT3","Tarief schijf 3 (%)","t3",100],["bAhk","Algemene heffingskorting max (€)","ahkMax",1],["bAk","Arbeidskorting max (€)","akMax",1],["bZvw","Zvw-bijdrage (%)","zvwPct",100],["bZvwM","Zvw maximum (€)","zvwMax",1]].map(([id, l, k, f]) => fld(l, inp(id, nf(s.belasting[k] * f, 3), 'inputmode="decimal" class="mono" data-bk="' + k + '" data-bf="' + f + '"'))).join("")}
    </div></details>
  </div></div>
  <div class="panel"><div class="ph"><h2>Normen en standaarden</h2></div><div class="pb"><div class="form">
    ${fld("Betaaltermijn (dagen)", inp("sTerm", s.termijn, 'inputmode="numeric" class="mono"'))}${fld("Standaard boekjaar", inp("sJaar", s.jaar, 'inputmode="numeric" class="mono"'))}
    ${fld("Uurtarief (standaard op factuur)", inp("sUur", nf(s.uurtarief), 'inputmode="decimal" class="mono"'))}${fld("Urencriterium per jaar", inp("sNorm", s.urennorm, 'inputmode="numeric" class="mono"'))}
    ${fld("Kilometervergoeding per km", inp("sKm", nf(s.kmTarief), 'inputmode="decimal" class="mono"'))}
  </div><p class="small muted">Controleer elk jaar de kilometervergoeding en het urencriterium.</p></div></div>
  <div class="panel"><div class="ph"><h2>Btw-tarieven</h2></div><div class="pb"><div class="form">${s.tarieven.map((t, i) => fld(`${t.naam} (rubriek ${t.rubriek})`, inp("sT" + i, nf(t.pct * 100), 'inputmode="decimal" class="mono"'))).join("")}</div></div></div>
  <div class="panel"><div class="ph"><h2>Kostencategorieën</h2><span class="small muted">Eén per regel</span></div><div class="pb">${fld("Categorieën", `<textarea id="sCat" rows="10">${esc(s.categorieen.join("\n"))}</textarea>`)}</div></div>
  ${deviceSettingsHTML()}`;
};
BIND.instellingen = () => { bindDeviceSettings(); $("#sOk").onclick = async () => {
  const s = structuredClone(S.settings);
  s.company = {name:v("sNaam").trim(), kvk:v("sKvk").trim(), address:v("sAdr").trim(), postcode:v("sPc").trim(), country:v("sLand").trim(), btwid:v("sBtw").trim(), phone:v("sTel").trim(), email:v("sMail").trim(), iban:v("sIban").replace(/\s/g, "").toUpperCase(), ibanName:v("sTnv").trim(), naam:v("sMyName").trim()};
  s.mail = {onderwerp:v("sMailOnd"), tekst:v("sMailTxt")};
  s.herinnering = {onderwerp:v("sHerOnd"), tekst:v("sHerTxt")};
  s.belasting = {...s.belasting, za:$("#sZa").checked, sa:$("#sSa").checked, loon:r2(parseNum(v("bLoon")))};
  s.rapport = {...s.rapport, urencriterium:$("#sRepUren").checked};
  document.querySelectorAll("[data-bk]").forEach(x => { s.belasting[x.dataset.bk] = parseNum(x.value) / Number(x.dataset.bf); });
  s.termijn = parseNum(v("sTerm")) || 14; s.jaar = parseNum(v("sJaar")) || s.jaar; s.uurtarief = parseNum(v("sUur")); s.urennorm = parseNum(v("sNorm")) || 1225; s.kmTarief = parseNum(v("sKm"));
  s.tarieven = s.tarieven.map((t, i) => ({...t, pct: r2(parseNum(v("sT" + i))) / 100}));
  const cats = v("sCat").split("\n").map(x => x.trim()).filter(Boolean); if (!cats.includes(INVEST)) cats.push(INVEST); s.categorieen = cats;
  try{ await S.db.doc("settings/main").set(stripUndef(s)); toast("Instellingen opgeslagen"); }catch(e){ dbError(e); }
}; };

/* ---- Export ---- */
VIEWS.export = () => `<div class="head"><div class="t"><span class="label">Beheer</span><h1>Export & back-up</h1></div></div>
  ${S.downloads ? "" : `<div class="notice warn">Downloaden is in deze weergave niet beschikbaar.</div>`}
  <div class="panel"><div class="ph"><h2>Exporteren voor Excel of je boekhouder</h2>${jaarSel()}</div><div class="pb" style="display:flex;flex-direction:column;gap:10px">
    <span class="small muted">CSV-bestanden met puntkomma’s en komma-decimalen; ze openen direct goed in Nederlandse Excel.</span>
    <div class="row"><button class="btn" data-exp="verkoop">Verkoop</button><button class="btn" data-exp="kosten">Kosten</button><button class="btn" data-exp="uren">Uren</button><button class="btn" data-exp="ritten">Ritten</button><button class="btn" data-exp="btw">Btw per kwartaal</button></div>
  </div></div>
  <div class="panel"><div class="ph"><h2>Back-up</h2></div><div class="pb" style="display:flex;flex-direction:column;gap:10px">
    <span class="small muted">Een volledige kopie van je administratie in één bestand${S.backupMet === false ? "" : ", inclusief de foto’s en pdf’s van je bonnen"}. Kies <b>Delen of in Drive zetten</b> en dan <b>Drive</b> om hem in Google Drive te bewaren. Je gegevens staan alleen op dit toestel: zonder back-up ben je ze kwijt als je telefoon kapotgaat of zoekraakt.</span>
    <span class="small">${backupStatus()}</span>
    <label class="row small"><input type="checkbox" id="xMet" style="width:auto" ${S.backupMet === false ? "" : "checked"}> Foto’s en pdf’s van bonnen meenemen</label>
    <div class="row"><button class="btn primary" id="xBackup">Back-up maken</button><button class="btn" id="xImport">Back-up terugzetten</button></div>
  </div></div>`;
BIND.export = () => {
  bindJaar();
  document.querySelectorAll("[data-exp]").forEach(b => b.onclick = () => exportCSV(b.dataset.exp));
  $("#xMet").onchange = e => { S.backupMet = e.target.checked; };
  $("#xBackup").onclick = () => backupNow($("#xBackup"));
  $("#xImport").onclick = () => $("#importIn").click();
};
$("#importIn").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  let data; try{ data = JSON.parse(await f.text()); }catch(x){ return toast("Dit is geen geldig back-upbestand."); }
  const na = Object.keys(data.assets || {}).length;
  if (data.app !== "kasboek") return toast("Dit is geen Kasboek-back-up.");
  const n = COLS.reduce((a, c) => a + Object.keys(data[c] || {}).length, 0);
  if (!await ask("Back-up terugzetten", `${n} regels${na ? ` en ${na} bijlagen` : ""} uit de back-up van ${dNL(String(data.gemaakt || "").slice(0,10))} worden toegevoegd of overschreven. Bestaande regels met dezelfde sleutel worden vervangen.`, "Terugzetten", false)) return;
  toast("Bezig met terugzetten…");
  try{
    let k = 0; for (const [id, a] of Object.entries(data.assets || {})){ if (a && a.data){ await KB.assets.put(id, {blob:b64ToBlob(a.data, a.type), type:a.type, name:a.name || "", size:a.size || 0, added:a.added || ""}); } if (++k % 10 === 0) toast(`Bijlagen terugzetten… ${k} van ${na}`); }
    if (data.settings) await S.db.doc("settings/main").set(stripUndef(data.settings));
    for (const c of COLS) for (const [id, d] of Object.entries(data[c] || {})) await S.db.collection(c).doc(id).set(stripUndef(clean(d)));
    toast(`Back-up teruggezet${na ? ` · ${na} bijlagen` : ""}`); scheduleRender();
  }catch(x){ dbError(x); }
});
async function dl(filename, data){ if (!S.downloads) return toast("Downloaden is in deze weergave niet beschikbaar."); try{ await S.downloads.save({filename, data}); }catch(e){ if (e?.code !== "cancelled" && e?.code !== "declined") toast("Opslaan lukte niet."); } }
function exportCSV(kind){
  const j = S.jaar, n = x => typeof x === "number" ? String(r2(x)).replace(".", ",") : x;
  const q = x => { const s = String(x ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  let rows = [];
  if (kind === "verkoop"){ rows.push(["Factuurdatum","Factuurnummer","Klant","Omschrijving","Bedrag excl.","Btw-tarief","Btw","Totaal incl.","Vervaldatum","Betaald op","Status"]);
    for (const i of booked().filter(i => yearOf(i.datum) === j).sort((a, b) => a.datum.localeCompare(b.datum))){ const c = invCalc(i); for (const t in c.per) rows.push([dNL(i.datum), i.nr, i.klant?.naam || "", i.onderwerp, n(c.per[t]), t, n(c.btw[t] || 0), n(c.per[t] + (c.btw[t] || 0)), dNL(i.verval), dNL(i.betaaldOp), invStatus(i).t]); } }
  if (kind === "kosten"){ rows.push(["Datum","Leverancier","Omschrijving","Categorie","Incl. btw","Btw-tarief","Btw","Excl. btw","Zakelijk %","Aftrekbare btw","Zakelijke kosten","Betaald via","Bijlage"]);
    for (const k of list("costs").filter(k => yearOf(k.datum) === j).sort((a, b) => a.datum.localeCompare(b.datum))){ const c = costCalc(k); rows.push([dNL(k.datum), k.leverancier, k.omschrijving, k.categorie, n(c.incl), k.btw, n(c.btw), n(c.excl), Math.round(c.z * 100), n(c.aftrek), n(c.kosten), k.betaalwijze, k.assetId ? "ja" : "nee"]); } }
  if (kind === "uren"){ rows.push(["Datum","Klant","Omschrijving","Uren","Soort","Factuur"]); for (const h of list("hours").filter(h => yearOf(h.datum) === j).sort((a, b) => a.datum.localeCompare(b.datum))) rows.push([dNL(h.datum), h.klant, h.omschrijving, n(parseNum(h.uren)), h.soort, h.invoiceNr || ""]); }
  if (kind === "ritten"){ rows.push(["Datum","Van","Naar","Doel","Km","Vergoeding"]); for (const r of list("rides").filter(r => yearOf(r.datum) === j).sort((a, b) => a.datum.localeCompare(b.datum))) rows.push([dNL(r.datum), r.van, r.naar, r.doel, n(parseNum(r.km)), n(parseNum(r.km) * S.settings.kmTarief)]); }
  if (kind === "btw"){ rows.push(["Kwartaal","1a omzet","1a btw","1b omzet","1b btw","1e omzet","Verschuldigd","5b voorbelasting","Saldo","Uiterste datum"]); for (const k of [1,2,3,4]){ const b = btwKwartaal(j, k); rows.push(["Q" + k, n(b["1a"].g), n(b["1a"].b), n(b["1b"].g), n(b["1b"].b), n(b["1e"].g), n(b.verschuldigd), n(b.vb), n(b.saldo), dNL(b.deadline)]); } }
  dl(`${kind} ${j}.csv`, "﻿" + rows.map(r => r.map(q).join(";")).join("\r\n"));
}

/* ---- Factuur versturen ---- */
function pdfName(i){ const k = i.klant || S.clients[i.klantId] || {}; return `Factuur ${i.nr} ${(k.naam || "").replace(/[\\/:*?"<>|]/g, "-")}.pdf`.trim(); }
function fillTpl(tpl, i){
  const c = S.settings.company, k = i.klant || S.clients[i.klantId] || {}, x = invCalc(i);
  const dagen = i.verval ? Math.max(0, Math.round((new Date(today()) - new Date(i.verval)) / 864e5)) : 0;
  const vals = {dagen, nr:i.nr, klant:k.naam || "", contact:k.contact || "heer, mevrouw", onderwerp:i.onderwerp || "", bedrag:eur(x.incl), vervaldatum:dNL(i.verval), iban:c.iban || "", tnv:c.ibanName || c.name || "", naam:c.naam || "", bedrijf:c.name || "", telefoon:c.phone || ""};
  return String(tpl || "").replace(/\{(\w+)\}/g, (m, key) => key in vals ? vals[key] : m).replace(/\n{3,}/g, "\n\n").trim();
}
function sendDialog(i, kind = "factuur"){
  const k = S.clients[i.klantId] || i.klant || {}, tpl = kind === "herinnering" ? S.settings.herinnering : S.settings.mail;
  const to = k.email || "", subj = fillTpl(tpl.onderwerp, i), body = fillTpl(tpl.tekst, i);
  const m = openSheet({title: kind === "herinnering" ? `Herinnering factuur ${i.nr}` : `Factuur ${i.nr} versturen`, body:`
    <div class="form">${fld("Aan", inp("mTo", to, 'type="email" placeholder="e-mailadres van de klant"'), "full")}${fld("Onderwerp", inp("mSub", subj), "full")}${fld("Tekst", `<textarea id="mBody" rows="12">${esc(body)}</textarea>`, "full")}</div>
    <div class="notice">Zo verstuur je hem: 1. download de PDF, 2. open je mailprogramma (of kopieer de tekst), 3. voeg de PDF als bijlage toe en verstuur. De tekst stel je in bij Instellingen.</div>`,
    foot:`<button class="btn left" id="mSent">Markeer als verstuurd</button><button class="btn" id="mPdf">1. PDF downloaden</button><a class="btn" id="mMail" href="#" target="_blank" rel="noopener">2. Open mailprogramma</a><button class="btn primary" id="mCopy">Tekst kopiëren</button>`});
  const link = () => `mailto:${encodeURIComponent(v("mTo"))}?subject=${encodeURIComponent(v("mSub"))}&body=${encodeURIComponent(v("mBody"))}`;
  const a = m.querySelector("#mMail"); a.href = link(); m.querySelectorAll("input,textarea").forEach(x => x.addEventListener("input", () => a.href = link()));
  m.querySelector("#mPdf").onclick = () => invoicePDF(i);
  m.querySelector("#mCopy").onclick = async () => { const txt = `Aan: ${v("mTo")}\nOnderwerp: ${v("mSub")}\n\n${v("mBody")}`; try{ await navigator.clipboard.writeText(txt); toast("Tekst gekopieerd"); }catch(e){ const t = $("#mBody"); t.focus(); t.select(); toast("Selecteer en kopieer de tekst handmatig"); } };
  m.querySelector("#mSent").onclick = async () => { if (kind === "herinnering"){ await patch("invoices", i.id, {herinneringen:[...(i.herinneringen || []), today()]}); closeSheet(); return toast("Herinnering geregistreerd"); } await patch("invoices", i.id, {verstuurdOp:today(), verstuurdAan:v("mTo")}); if (v("mTo") && S.clients[i.klantId] && !S.clients[i.klantId].email) await patch("clients", i.klantId, {email:v("mTo")}); closeSheet(); toast("Gemarkeerd als verstuurd"); };
}

/* ---- Weekfactuur ---- */
ACTS.weekInv = () => weekDialog();
function weekDialog(){
  const cl = list("clients").sort((a, b) => a.naam.localeCompare(b.naam)); if (!cl.length){ toast("Voeg eerst een klant toe."); return go("klanten"); }
  const last = booked().sort((a, b) => (b.datum || "").localeCompare(a.datum || ""))[0];
  const lastLine = last?.lines?.find(l => l.eenheid === "uur");
  const nu = isoWeek(addDays(today(), -7));
  const st = {klantId:last?.klantId && S.clients[last.klantId] ? last.klantId : cl[0].id, jaar:nu.jaar, week:nu.week};
  const m = openSheet({title:"Weekfactuur", body:`
    <span class="muted">Geef de uren door; de factuur, de urenregistratie en de mail worden voor je klaargezet.</span>
    <div class="form">
      ${fld("Klant", sel("wKl", cl.map(c => [c.id, c.naam]), st.klantId))}
      <div class="row" style="gap:8px">${fld("Week", inp("wWeek", st.week, 'inputmode="numeric" class="mono"'))}${fld("Jaar", inp("wJaar", st.jaar, 'inputmode="numeric" class="mono"'))}</div>
      ${fld("Werkzaamheden", inp("wOms", lastLine?.omschrijving || "Uitwerken schaderapporten"), "full")}
      ${fld("Uren", inp("wUren", "", 'inputmode="decimal" class="mono"'))}
      ${fld("Uurtarief", inp("wTarief", "", 'inputmode="decimal" class="mono"'))}
      ${fld("Extra regel (optioneel)", inp("wExtra", "", 'placeholder="Bijv. Deelteamoverleg"'))}
      ${fld("Uren extra regel", inp("wExtraU", "", 'inputmode="decimal" class="mono"'))}
      <div class="calc full" id="wCalc"></div>
    </div>`, foot:`<button class="btn" data-close>Annuleren</button><button class="btn" id="wDraft">Concept maken</button><button class="btn primary" id="wBook">Boeken en versturen</button>`});
  let linked = [];
  const fillWeek = () => {
    const c = S.clients[v("wKl")]; $("#wTarief").value = nf(c?.uurtarief ?? S.settings.uurtarief);
    const ws = weekStart(Number(v("wJaar")), Number(v("wWeek"))), we = addDays(ws, 6);
    const open = list("hours").filter(h => !h.invoiceId && h.soort === "Declarabel" && (h.klant || "") === (c?.naam || "") && h.datum >= ws && h.datum <= we);
    linked = open.map(h => h.id);
    if (open.length) $("#wUren").value = nf(open.reduce((a, h) => a + parseNum(h.uren), 0));
    upd(open.length ? `${open.length} open urenregel(s) uit week ${v("wWeek")} gevonden en ingevuld.` : "");
  };
  const upd = (note) => { const t = parseNum(v("wTarief")), ex = r2((parseNum(v("wUren")) + parseNum(v("wExtraU"))) * t); const inc = r2(ex * (1 + (S.settings.tarieven[0]?.pct ?? 0.21))); const ws = weekStart(Number(v("wJaar")) || 2026, Number(v("wWeek")) || 1); $("#wCalc").innerHTML = `<span>Week ${esc(v("wWeek"))}: ${dNL(ws)} t/m ${dNL(addDays(ws, 6))}</span><span>Excl. <b class="num">${eur(ex)}</b></span><span>Incl. btw <b class="num">${eur(inc)}</b></span>${typeof note === "string" && note ? `<span class="small">${esc(note)}</span>` : ""}`; };
  ["wKl","wWeek","wJaar"].forEach(id => $("#" + id).addEventListener("change", fillWeek));
  m.querySelectorAll("input").forEach(x => x.addEventListener("input", upd));
  fillWeek();
  const make = async (book) => {
    const uren = parseNum(v("wUren")), w = Number(v("wWeek")), j = Number(v("wJaar"));
    if (!uren) return toast("Vul het aantal uren in."); if (!(w >= 1 && w <= 53)) return toast("Vul een geldig weeknummer in.");
    const tar = S.settings.tarieven[0]?.naam || "21%", prijs = parseNum(v("wTarief"));
    const lines = [{omschrijving:v("wOms").trim() || "Werkzaamheden", aantal:uren, eenheid:"uur", prijs, btw:tar, hourIds:linked}];
    if (v("wExtra").trim() && parseNum(v("wExtraU"))) lines.push({omschrijving:v("wExtra").trim(), aantal:parseNum(v("wExtraU")), eenheid:"uur", prijs, btw:tar, hourIds:[]});
    const k = S.clients[v("wKl")];
    const doc = {nr:nrForWeek(w), datum:today(), klantId:k.id, onderwerp:`Factuur week ${w} ${j}`, lines, status: book ? "geboekt" : "concept", betaaldOp:null};
    if (book){ doc.klant = clean(k); doc.verval = addDays(doc.datum, Number(S.settings.termijn) || 14); doc.geboektOp = today(); }
    if (linked.length && Math.abs(linked.reduce((a, id) => a + parseNum(S.hours[id]?.uren), 0) - uren) > 0.001) lines[0].hourIds = [];  // uren aangepast: niet koppelen
    const b = $(book ? "#wBook" : "#wDraft"); b.disabled = true; b.innerHTML = '<span class="spin"></span> Bezig';
    try{
      const id = await save("invoices", null, doc);
      if (book){ await syncHours(id, doc); closeSheet(); toast(`Factuur ${doc.nr} geboekt`); S.param2 = "send"; go("factuur", id); }
      else { closeSheet(); editInvoice(id); }
    }catch(e){ b.disabled = false; b.textContent = book ? "Boeken en versturen" : "Concept maken"; }
  };
  m.querySelector("#wDraft").onclick = () => make(false);
  m.querySelector("#wBook").onclick = () => make(true);
}

/* ---- Uren importeren (Clockwise e.d.) ---- */
ACTS.importHours = () => importHoursDialog();
function importHoursDialog(){
  const cl = list("clients").sort((a, b) => a.naam.localeCompare(b.naam));
  const m = openSheet({title:"Uren importeren", wide:true, body:`
    <span class="muted">Exporteer je uren uit Clockwise (Excel of CSV), maak een schermafbeelding van je weekoverzicht, of plak de uren hieronder. ${S.canScan ? "Claude haalt de datums en uren eruit." : "Datums en uren worden op je telefoon uit CSV, Excel (.xlsx) of geplakte tekst gehaald. Schermafbeeldingen uitlezen kan alleen met een API-sleutel (Instellingen)."}</span>
    <div class="row"><label class="btn primary"><input type="file" class="sr" id="ihFile" accept=".csv,.txt,.xlsx,.xls,image/*,application/pdf" multiple>Bestanden of schermafbeeldingen kiezen</label><span class="small muted" id="ihName"></span></div>
    ${fld("Of plak de uren", `<textarea id="ihText" rows="5" placeholder="Bijv. ma 6 okt 8 uur schaderapporten&#10;di 7 okt 7,5 uur ..."></textarea>`)}
    <div class="form">${fld("Klant", sel("ihKl", cl.map(c => [c.naam, c.naam]), cl[0]?.naam || ""))}${fld("Soort werk", sel("ihSrt", ["Declarabel","Acquisitie","Administratie","Opleiding","Overig"], "Declarabel"))}</div>
    <div id="ihRes"></div>`, foot:`<button class="btn" data-close>Annuleren</button><button class="btn" id="ihRead">Uitlezen</button><button class="btn primary" id="ihOk" disabled>Importeren</button>`});
  let files = [], rows = [];
  m.querySelector("#ihFile").onchange = e => { files = [...e.target.files]; $("#ihName").textContent = files.length > 1 ? `${files.length} bestanden` : files[0]?.name || ""; };
  m.querySelector("#ihRead").onclick = async () => {
    
    const res = $("#ihRes"); res.innerHTML = `<div class="notice"><span class="spin"></span> Uren uitlezen…</div>`;
    const instr = `Haal uit deze urenregistratie alle gewerkte uren per dag. Geef ALLEEN een JSON-array terug met objecten {"datum":"YYYY-MM-DD","uren":getal,"omschrijving":korte tekst,"project":tekst of ""}. Neem geen totaalregels op. Het jaar is ${S.jaar} tenzij anders vermeld. Uren als 7:30 worden 7.5.`;
    try{
      const readOne = async file => {
        if (file && /^image\//.test(file.type) && !S.canScan) throw {code:"need_ai"};
        if (file && /^image\//.test(file.type)) return S.sample.json(instr + "\n\nDe afbeelding is een schermafbeelding van de urenregistratie.", {images:[await shrink(file)]});
        let text = file ? "" : v("ihText");
        if (file){ if (/\.xls$/i.test(file.name)) throw {code:"xls"};
          if (/\.xlsx$/i.test(file.name)){ await loadScript("read-excel-file.min.js"); const res = await window.readXlsxFile(file); const sheets = Array.isArray(res) && res.length && res[0] && Array.isArray(res[0].data) ? res.map(x => x.data) : [res]; text = sheets.map(rows => rows.map(r => r.map(c => c instanceof Date ? c.toISOString().slice(0, 10) : (c ?? "")).join(";")).join("\n")).join("\n"); }
          else if (file.type === "application/pdf") text = (await pdfToInput(file)).text; else text = await file.text(); }
        if (!text.trim()) return [];
        return S.canScan ? S.sample.json(instr + "\n\nUrenregistratie:\n" + text.slice(0, 40000)) : localHours(text, S.jaar);
      };
      const srcs = files.length ? files : [null];
      if (!files.length && !v("ihText").trim()) { res.innerHTML = `<div class="notice warn">Kies een bestand of plak de uren.</div>`; return; }
      let out = [], fails = 0;
      for (let k = 0; k < srcs.length; k++){ if (srcs.length > 1) res.innerHTML = `<div class="notice"><span class="spin"></span> Bestand ${k + 1} van ${srcs.length} uitlezen…</div>`; try{ const o = await readOne(srcs[k]); if (Array.isArray(o)) out.push(...o); }catch(e){ if (e?.code === "not_granted") throw e; if (e?.code === "xls") toast("Oude .xls-bestanden worden niet gelezen. Sla het bestand op als .xlsx of CSV."); else if (e?.code === "need_ai") toast("Een schermafbeelding uitlezen kan alleen met een API-sleutel (Instellingen)."); fails++; } }
      const seenR = new Set(); out = out.filter(r => { const key = (r?.datum || "") + "|" + r?.uren + "|" + (r?.omschrijving || ""); if (seenR.has(key)) return false; seenR.add(key); return true; });
      if (fails) toast(`${fails} bestand(en) konden niet worden uitgelezen`);
      rows = (Array.isArray(out) ? out : []).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r?.datum || "") && parseNum(r.uren) > 0).map(r => ({datum:r.datum, uren:r2(parseNum(r.uren)), omschrijving:String(r.omschrijving || r.project || "").slice(0, 120)}));
      if (!rows.length){ res.innerHTML = `<div class="notice warn">Er zijn geen uren gevonden. Probeer een ander bestand of plak de uren.</div>`; return; }
      const kl = v("ihKl");
      rows.forEach(r => { const w = isoWeek(r.datum); r.week = w.week; r.wjaar = w.jaar; r.inv = weekInvoiced(kl, w.jaar, w.week); r.dup = list("hours").some(h => h.datum === r.datum && Math.abs(parseNum(h.uren) - r.uren) < 0.001); });
      const weeks = {}; rows.forEach(r => { const k = r.wjaar + "-" + r.week; (weeks[k] = weeks[k] || {jaar:r.wjaar, week:r.week, uren:0, inv:r.inv}).uren += r.uren; });
      const defOms = booked().sort((a, b) => (b.datum || "").localeCompare(a.datum || ""))[0]?.lines?.[0]?.omschrijving || "Werkzaamheden";
      res.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th></th><th>Datum</th><th>Week</th><th>Omschrijving</th><th class="r">Uren</th></tr></thead><tbody>${rows.map((r, n) => `<tr><td><input type="checkbox" data-r="${n}" ${r.dup || r.inv ? "" : "checked"} aria-label="Importeren"></td><td class="num">${dNL(r.datum)}</td><td class="num">${r.week}</td><td>${esc(r.omschrijving)}${r.inv ? ` <span class="chip ok">week al gefactureerd (${esc(r.inv.nr)})</span>` : r.dup ? ` <span class="chip warn">bestaat al?</span>` : ""}</td><td class="r num">${nf(r.uren)}</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="4">Totaal</td><td class="r num">${nf(rows.reduce((a, r) => a + r.uren, 0))}</td></tr></tfoot></table></div>
      <div class="panel" style="margin-top:12px"><div class="ph"><h3>Facturen per week</h3><label class="row small"><input type="checkbox" id="ihAuto" style="width:auto" checked> Automatisch maken en boeken</label></div><div class="pb" style="display:flex;flex-direction:column;gap:10px">${Object.values(weeks).sort((a, b) => a.jaar - b.jaar || a.week - b.week).map(w => `<div class="row" style="justify-content:space-between"><span><b>Week ${w.week} ${w.jaar}</b> · <span class="num">${nf(w.uren)} uur</span></span>${w.inv ? `<span class="chip ok">al gefactureerd: ${esc(w.inv.nr)}</span>` : `<span class="small muted">wordt factuur ${esc(nrForWeek(w.week))}</span>`}</div>`).join("")}
        ${fld("Omschrijving op de factuur", inp("ihOms", defOms))}<span class="small muted">Uurtarief van de klant: ${eur(list("clients").find(c => c.naam === kl)?.uurtarief ?? S.settings.uurtarief)}. De facturen krijgen de datum van vandaag; daarna kun je ze vanuit Facturen versturen.</span></div></div>`;
      $("#ihOk").disabled = false;
    }catch(e){ res.innerHTML = `<div class="notice warn">${e?.code === "not_granted" ? "Uitlezen met Claude staat uit. Vul bij Instellingen een API-sleutel in, of gebruik CSV/Excel of geplakte tekst." : "Uitlezen lukte niet. Probeer een ander bestand of plak de uren."}</div>`; }
  };
  m.querySelector("#ihOk").onclick = async () => {
    const pick = [...document.querySelectorAll("#ihRes [data-r]:checked")].map(x => rows[x.dataset.r]); if (!pick.length) return closeSheet();
    $("#ihOk").disabled = true; $("#ihOk").innerHTML = '<span class="spin"></span> Bezig';
    const auto = $("#ihAuto")?.checked && v("ihSrt") === "Declarabel", oms = v("ihOms") || "Werkzaamheden", kl = list("clients").find(c => c.naam === v("ihKl"));
    const groups = {};
    for (const r of pick){ const id = await save("hours", null, {datum:r.datum, uren:r.uren, omschrijving:r.omschrijving, klant:v("ihKl"), soort:v("ihSrt"), bron:"import", invoiceId:null, invoiceNr:null}); S.hours[id] = {id, datum:r.datum, uren:r.uren, omschrijving:r.omschrijving, klant:v("ihKl"), soort:v("ihSrt"), bron:"import"}; const k = r.wjaar + "-" + r.week; (groups[k] = groups[k] || {jaar:r.wjaar, week:r.week, uren:0, ids:[], inv:r.inv}).uren += r.uren; groups[k].ids.push(id); }
    const made = [];
    if (auto && kl) for (const g of Object.values(groups).sort((a, b) => a.jaar - b.jaar || a.week - b.week)){ if (g.inv) continue; made.push(await createWeekInvoice({klant:kl, jaar:g.jaar, week:g.week, uren:g.uren, omschrijving:oms, prijs:kl.uurtarief ?? S.settings.uurtarief, hourIds:g.ids})); }
    closeSheet(); toast(`${pick.length} urenregels geïmporteerd${made.length ? ` · ${made.length} factu${made.length > 1 ? "ren" : "ur"} gemaakt: ${made.map(i => i.nr).join(", ")}` : ""}`);
    if (made.length === 1){ S.param2 = "send"; go("factuur", made[0].id); } else if (made.length) go("facturen", {f:"open"});
  };
}

/* ---- Afstemmen kosten ↔ bank ---- */
function afterCost(){ setTimeout(async () => { const n = await reconcileCosts(); if (n) toast(n === 1 ? "Gevonden in de bank: afschrijving gekoppeld" : `${n} kostenposten gekoppeld aan de bank`); }, 600); }
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const NOBANK = ["Contant", "Privé betaald"];
function bankRange(){ const d = list("bank").map(t => t.datum).filter(Boolean).sort(); return d.length ? [d[0], d[d.length - 1]] : null; }
function nameHit(cost, tx){ const words = String(cost.leverancier || "").toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !["the","van","het","een","b.v","bv.","shop","store"].includes(w)); const hay = (String(tx.naam || "") + " " + String(tx.omschrijving || "")).toLowerCase(); return words.some(w => hay.includes(w)); }
function matchCostTx(cost, used, onlyNr){
  const amt = r2(parseNum(cost.bedragIncl)); if (!amt || !cost.datum) return null;
  const cn = new Set(String((cost.assetName || "") + " " + (cost.omschrijving || "")).match(/\d{6,}/g) || []);
  const cands = list("bank").filter(t => t.bedrag < 0 && t.status === "open" && !used.has(t.id) && Math.abs(Math.abs(t.bedrag) - amt) < 0.005)
    .map(t => ({t, d:dayDiff(t.datum, cost.datum), nm:nameHit(cost, t), nr:(String(t.omschrijving).match(/\d{6,}/g) || []).some(x => cn.has(x))}))
    .filter(x => x.nr || (x.d >= -10 && x.d <= 60));
  if (!cands.length) return null;
  const byNr = cands.filter(x => x.nr); if (byNr.length === 1) return byNr[0].t;           // factuurnummer in de omschrijving: zeker
  if (onlyNr) return null;
  const named = cands.filter(x => x.nm), pool = named.length ? named : cands;
  // betaling meestal kort na de factuurdatum: kies de eerste afschrijving vanaf 3 dagen ervoor t/m 35 dagen erna
  const after = pool.filter(x => x.d >= -3 && x.d <= 35).sort((a, b) => a.d - b.d);
  if (after.length === 1 || (after.length > 1 && after[1].d - after[0].d > 3)) return (named.length || pool.length === 1 || after.length === 1) ? after[0].t : null;
  return null;
}
let reconRunning = false;
async function reconcileCosts(){
  if (reconRunning || !list("bank").length) return 0; reconRunning = true; let n = 0;
  try{
    const used = new Set(list("costs").map(c => c.bankId).filter(Boolean));   // een afschrijving hoort maar bij één kostenpost
    const costs = list("costs").filter(c => !c.bankId && !NOBANK.includes(c.betaalwijze)).sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
    const linked = new Set();
    for (const pass of [true, false]) for (const c of costs){   // eerst op factuurnummer, daarna op bedrag en datum
      if (linked.has(c.id)) continue;
      const tx = matchCostTx(c, used, pass); if (!tx) continue; used.add(tx.id); linked.add(c.id);
      await patch("bank", tx.id, {status:"kosten", costId:c.id}); S.bank[tx.id] = {...S.bank[tx.id], status:"kosten", costId:c.id};
      await patch("costs", c.id, {bankId:tx.id, betaaldOp:tx.datum}); S.costs[c.id] = {...S.costs[c.id], bankId:tx.id, betaaldOp:tx.datum};
      n++;
    }
  }catch(e){} finally{ reconRunning = false; }
  if (n) scheduleRender();
  return n;
}
function bankChip(k){
  if (k.bankId && S.bank[k.bankId]) return `<span class="chip ok" title="Afgeschreven op ${dNL(S.bank[k.bankId].datum)}">Bank ✓</span>`;
  if (NOBANK.includes(k.betaalwijze)) return `<span class="chip">${esc(k.betaalwijze === "Contant" ? "Contant" : "Privé")}</span>`;
  const rg = bankRange(); if (!rg) return "";
  if (k.datum && k.datum >= addDays(rg[0], -10) && addDays(k.datum, 10) <= rg[1]) return `<span class="chip warn" title="Geen afschrijving met dit bedrag gevonden">Niet in bank</span>`;
  return `<span class="chip" title="Valt buiten de ingelezen afschriften">Bank ?</span>`;
}

/* ---- Bank ---- */
function hashStr(s){ let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
function parseDateAny(s){ s = String(s || "").trim(); let m;
  if ((m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return ""; }
function parseMT940(t){
  const out = []; let cur = null, in86 = false;
  for (const raw of t.replace(/\r/g, "").split("\n")){
    if (raw.startsWith(":61:")){ if (cur) out.push(cur); in86 = false;
      const m = raw.slice(4).match(/^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])[A-Z]?([\d,]+)/); if (!m){ cur = null; continue; }
      const sign = m[5] === "C" || m[5] === "RD" ? 1 : -1;
      cur = {datum:`20${m[1]}-${m[2]}-${m[3]}`, bedrag:r2(sign * parseFloat(m[6].replace(",", "."))), naam:"", tegenrekening:"", omschrijving:"", r86:""};
    } else if (raw.startsWith(":86:")){ if (cur){ cur.r86 = raw.slice(4); in86 = true; } }
    else if (raw.startsWith(":") || raw.startsWith("-}")) in86 = false;
    else if (in86 && cur) cur.r86 += raw;
  }
  if (cur) out.push(cur);
  for (const c of out){ const r = c.r86;
    if (/\/(CNTP|REMI|NAME|IBAN)\//.test(r)){
      const cn = r.match(/\/CNTP\/([^/]*)\/([^/]*)\/([^/]*)\//); if (cn){ c.tegenrekening = cn[1]; c.naam = cn[3]; }
      if (!c.naam){ const n = r.match(/\/NAME\/([^/]*)/); if (n) c.naam = n[1]; }
      if (!c.tegenrekening){ const ib = r.match(/\/IBAN\/([^/]*)/); if (ib) c.tegenrekening = ib[1]; }
      const re = r.match(/\/REMI\/(?:USTD\/\/|STRD\/CUR\/\/)?(.*?)(?:\/(?:EREF|ORDP|BENM|CSID|MARF|IREF|PURP|ULTD|ULTC|SVCL|CNTP)\/|$)/); c.omschrijving = (re ? re[1] : r).replace(/\/+$/, "");
    } else { c.omschrijving = r; const ib = r.match(/\b([A-Z]{2}\d{2}[A-Z]{4}\d{6,10})\b/); if (ib) c.tegenrekening = ib[1]; }
    delete c.r86; }
  return out;
}
function parseCAMT(t){
  const doc = new DOMParser().parseFromString(t, "application/xml"); const q = (el, n) => el.getElementsByTagNameNS("*", n);
  return [...q(doc, "Ntry")].map(e => {
    const cd = q(e, "CdtDbtInd")[0]?.textContent, amt = parseFloat(q(e, "Amt")[0]?.textContent || "0");
    const party = cd === "CRDT" ? q(e, "Dbtr")[0] : q(e, "Cdtr")[0]; const acct = cd === "CRDT" ? q(e, "DbtrAcct")[0] : q(e, "CdtrAcct")[0];
    return {datum:(q(q(e, "BookgDt")[0] || e, "Dt")[0]?.textContent || q(e, "DtTm")[0]?.textContent || "").slice(0, 10), bedrag:r2(cd === "CRDT" ? amt : -amt), naam:party ? (q(party, "Nm")[0]?.textContent || "") : "", tegenrekening:acct ? (q(acct, "IBAN")[0]?.textContent || "") : "", omschrijving:[...q(e, "Ustrd")].map(x => x.textContent).join(" ") || q(e, "AddtlNtryInf")[0]?.textContent || ""};
  });
}
function splitCSV(line, d){ const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++){ const ch = line[i]; if (q){ if (ch === '"' && line[i+1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === d){ out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); }
function parseBankCSV(t){
  const lines = t.replace(/\r/g, "").split("\n").filter(l => l.trim()); if (!lines.length) return [];
  const d = (lines.slice(0, 5).join("").match(/;/g) || []).length >= (lines.slice(0, 5).join("").match(/,/g) || []).length ? ";" : ",";
  let hi = lines.findIndex(l => /datum|date/i.test(l) && /bedrag|amount/i.test(l)); if (hi < 0) return [];
  const H = splitCSV(lines[hi], d).map(h => h.toLowerCase());
  const col = (...res) => { for (const re of res){ const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const cDat = col(/^transactiedatum/, /^boekdatum/, /^datum/, /date/), cBed = col(/^bedrag/, /amount/), cSign = col(/credit.?debet|^af.?bij|debet.?credit|^cd$|^d\/c/), cOms = col(/omschrijving|mededeling|description/), cNaam = col(/tegenrekeninghouder|naam tegen|tegenpartij|^naam|name/), cIban = col(/^tegenrekening$|tegenrekeningnummer|tegenrekening iban|counterparty/);
  return lines.slice(hi + 1).map(l => { const r = splitCSV(l, d); let b = parseNum(r[cBed]); const s = cSign >= 0 ? String(r[cSign]).toUpperCase() : "";
    if (/^(D|DEBET|AF|DEBIT)/.test(s)) b = -Math.abs(b); else if (/^(C|CREDIT|BIJ)/.test(s)) b = Math.abs(b);
    return {datum:parseDateAny(r[cDat]), bedrag:r2(b), naam:cNaam >= 0 ? r[cNaam] : "", tegenrekening:cIban >= 0 ? r[cIban] : "", omschrijving:cOms >= 0 ? r[cOms] : ""}; }).filter(x => x.datum && x.bedrag);
}
function parseBank(text){ if (/:61:/.test(text)) return parseMT940(text); if (/<Ntry>/.test(text) || /<Ntry\s/.test(text)) return parseCAMT(text); return parseBankCSV(text); }
const canon = nr => { const m = String(nr || "").match(/(\d{4})\s*-?\s*0*(\d{1,4})/); return m ? m[1] + "-" + Number(m[2]) : ""; };
function invRefs(text){ const set = new Set(); const re = /(20\d{2})\s*[-\/ ]?\s*0*(\d{1,4})(?!\d)/g; let m; while ((m = re.exec(String(text || "")))) set.add(m[1] + "-" + Number(m[2])); return set; }
function matchTx(tx){
  if (tx.bedrag <= 0) return null;
  const open = booked().filter(i => !i.betaaldOp), refs = invRefs(tx.omschrijving);
  const byRef = open.filter(i => refs.has(canon(i.nr)));
  const amt = r2(tx.bedrag), inc = i => invCalc(i).incl;
  if (byRef.length){
    const sum = r2(byRef.reduce((a, i) => a + inc(i), 0));
    if (Math.abs(sum - amt) < 0.01) return {ids:byRef.map(i => i.id), zeker:true};
    const one = byRef.filter(i => Math.abs(inc(i) - amt) < 0.01);
    if (one.length === 1) return {ids:[one[0].id], zeker:true};
    return {ids:byRef.map(i => i.id), zeker:false, reden:"factuurnummer gevonden, bedrag wijkt af"};
  }
  const wk = [...String(tx.omschrijving || "").matchAll(/week\s*(\d{1,2})/gi)].map(m => Number(m[1]));
  if (wk.length){ const byWeek = open.filter(i => wk.includes(weekFromText(i.onderwerp)));
    const sumW = r2(byWeek.reduce((a, i) => a + inc(i), 0)); if (byWeek.length && Math.abs(sumW - amt) < 0.01) return {ids:byWeek.map(i => i.id), zeker:true};
    const oneW = byWeek.filter(i => Math.abs(inc(i) - amt) < 0.01); if (oneW.length === 1) return {ids:[oneW[0].id], zeker:true}; }
  const same = open.filter(i => Math.abs(inc(i) - amt) < 0.01);
  if (same.length){
    const nm = String(tx.naam || "").toLowerCase(); const fromClient = same.filter(i => { const k = (i.klant?.naam || clientName(i.klantId)).toLowerCase().split(/\s+/)[0]; return k && nm.includes(k); });
    const pool = fromClient.length ? fromClient : same; pool.sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
    return {ids:[pool[0].id], zeker:false, reden: same.length > 1 ? `${same.length} facturen met dit bedrag; oudste voorgesteld` : "zelfde bedrag"};
  }
  return null;
}
async function linkTx(txId, ids){
  const tx = S.bank[txId] || {}; for (const id of ids) await patch("invoices", id, {betaaldOp:tx.datum || today(), betaaldVia:txId});
  await patch("bank", txId, {status:"gekoppeld", invoiceIds:ids, voorstel:null});
}
VIEWS.bank = () => {
  const all = list("bank").sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const openIn = all.filter(t => t.status === "open" && t.bedrag > 0), openOut = all.filter(t => t.status === "open" && t.bedrag < 0), done = all.filter(t => t.status !== "open");
  const nr = id => S.invoices[id]?.nr || "?";
  const row = t => `<div class="txrow"><span class="num small muted">${dNL(t.datum)}</span><div style="min-width:0"><b>${esc(t.naam || "—")}</b><div class="small muted" style="overflow-wrap:anywhere">${esc(t.omschrijving)}</div></div><span class="amt ${t.bedrag > 0 ? "plus" : ""}">${t.bedrag > 0 ? "+" : "−"} ${eur(Math.abs(t.bedrag))}</span>
    <div class="acts">${t.status === "open" && t.bedrag > 0 ? `${t.voorstel?.ids?.length ? `<button class="btn sm primary" data-tx-link="${t.id}">Koppel aan ${t.voorstel.ids.map(nr).join(", ")}</button><span class="small muted">${esc(t.voorstel.reden || "")}</span>` : ""}<button class="btn sm" data-tx-pick="${t.id}">Kies factuur</button><button class="btn sm ghost" data-tx-ign="${t.id}">Negeren</button>` : ""}
    ${t.status === "open" && t.bedrag < 0 ? `<button class="btn sm primary" data-tx-cost="${t.id}">Als kosten boeken</button><button class="btn sm ghost" data-tx-ign="${t.id}">Privé / negeren</button>` : ""}
    ${t.status === "gekoppeld" ? `<span class="chip ok">Betaling van ${t.invoiceIds?.map(nr).join(", ")}</span><button class="btn sm ghost" data-tx-undo="${t.id}">Ontkoppelen</button>` : ""}
    ${t.status === "kosten" ? `<span class="chip ok">Kosten: ${esc(S.costs[t.costId]?.leverancier || "geboekt")}</span><button class="btn sm ghost" data-tx-uncost="${t.id}">Ontkoppelen</button>` : ""}${t.status === "genegeerd" ? `<span class="chip">Genegeerd</span><button class="btn sm ghost" data-tx-undo="${t.id}">Terugzetten</button>` : ""}</div></div>`;
  return `<div class="head"><div class="t"><span class="label">Knab</span><h1>Bank</h1></div><div class="row"><label class="btn primary"><input type="file" class="sr" id="bankFile" accept=".sta,.940,.mt940,.txt,.csv,.xml,.STA" multiple>Afschriften inlezen</label>${all.length ? `<button class="btn" id="bankRecon">Afstemmen met kosten</button>` : ""}</div></div>
  <div class="notice">Download in Knab Online bij <b>Betalen › Bij- en afschrijvingen › Boekhoudexport</b> een MT940-bestand (CSV of CAMT.053 werkt ook) en lees het hier in. Ontvangsten met het factuurnummer in de omschrijving worden automatisch als betaald gemarkeerd; uitgaven kun je met één tik als kosten boeken.</div>
  ${all.length ? `<div class="kpis"><div class="kpi"><span class="label">Te koppelen ontvangsten</span><span class="v">${openIn.length}</span></div><div class="kpi"><span class="label">Nog te boeken uitgaven</span><span class="v">${openOut.length}</span></div><div class="kpi"><span class="label">Verwerkt</span><span class="v">${done.length}</span></div><div class="kpi"><span class="label">Laatste transactie</span><span class="v" style="font-size:1rem">${dNL(all[0].datum)}</span></div></div>` : ""}
  ${openIn.length ? `<div class="panel"><div class="ph"><h2>Ontvangsten om te koppelen</h2></div>${openIn.map(row).join("")}</div>` : ""}
  ${openOut.length ? `<div class="panel"><div class="ph"><h2>Uitgaven om te boeken</h2><span class="small muted">Heb je al een bon geüpload? Kies dan ‘Privé / negeren’ om dubbel boeken te voorkomen.</span></div>${openOut.map(row).join("")}</div>` : ""}
  <div class="panel"><div class="ph"><h2>Verwerkt</h2></div>${done.length ? done.slice(0, 200).map(row).join("") : `<div class="empty">${all.length ? "Nog niets verwerkt." : "Nog geen afschrift ingelezen."}</div>`}</div>`;
};
BIND.bank = () => {
  $("#bankFile").onchange = async e => { const fs = [...e.target.files]; e.target.value = ""; for (const f of fs) await importBank(f); const n = await reconcileCosts(); if (n) toast(`${n} afschrijving(en) gekoppeld aan geboekte kosten en bonnen`); };
  if ($("#bankRecon")) $("#bankRecon").onclick = async () => { const n = await reconcileCosts(); const open = list("costs").filter(c => !c.bankId && !NOBANK.includes(c.betaalwijze)).length; toast(n ? `${n} kostenpost(en) gekoppeld aan de bank` : `Geen nieuwe koppelingen gevonden${open ? ` (${open} kostenposten zonder afschrijving)` : ""}`); };
  document.querySelectorAll("[data-tx-uncost]").forEach(b => b.onclick = async () => { const t = S.bank[b.dataset.txUncost]; if (t.costId && S.costs[t.costId]) await patch("costs", t.costId, {bankId:null, betaaldOp:null}); await patch("bank", t.id, {status:"open", costId:null}); toast("Ontkoppeld"); });
  document.querySelectorAll("[data-tx-link]").forEach(b => b.onclick = async () => { const t = S.bank[b.dataset.txLink]; await linkTx(t.id, t.voorstel.ids); toast("Gekoppeld en als betaald gemarkeerd"); });
  document.querySelectorAll("[data-tx-ign]").forEach(b => b.onclick = async () => { await patch("bank", b.dataset.txIgn, {status:"genegeerd"}); });
  document.querySelectorAll("[data-tx-undo]").forEach(b => b.onclick = async () => { const t = S.bank[b.dataset.txUndo]; for (const id of t.invoiceIds || []) if (S.invoices[id]?.betaaldVia === t.id) await patch("invoices", id, {betaaldOp:null, betaaldVia:null}); await patch("bank", t.id, {status:"open", invoiceIds:[]}); });
  document.querySelectorAll("[data-tx-cost]").forEach(b => b.onclick = () => { const t = S.bank[b.dataset.txCost]; const m = costDialog(null, {datum:t.datum, leverancier:t.naam, omschrijving:t.omschrijving.slice(0, 80), bedragIncl:Math.abs(t.bedrag), betaalwijze:"Bank"}); const ok = m.querySelector("#cOk"), orig = ok.onclick; ok.onclick = async () => { const before = new Set(Object.keys(S.costs)); await orig(); const nid = Object.keys(S.costs).find(k => !before.has(k)); if (!$("#sheetBg")){ await patch("bank", t.id, {status:"kosten", costId:nid || null}); if (nid) await patch("costs", nid, {bankId:t.id, betaaldOp:t.datum}); } }; });
  document.querySelectorAll("[data-tx-pick]").forEach(b => b.onclick = () => { const t = S.bank[b.dataset.txPick]; const open = booked().filter(i => !i.betaaldOp).sort((a, c) => (a.datum || "").localeCompare(c.datum || ""));
    const m = openSheet({title:`Ontvangst ${eur(t.bedrag)} koppelen`, body:`<span class="small muted">${esc(t.naam)} · ${esc(t.omschrijving)}</span><div class="tbl-wrap"><table><thead><tr><th></th><th>Factuur</th><th>Datum</th><th class="r">Bedrag</th></tr></thead><tbody>${open.map(i => `<tr><td><input type="checkbox" data-pi="${i.id}" aria-label="Kies"></td><td class="mono">${esc(i.nr)}</td><td class="num">${dNL(i.datum)}</td><td class="r num">${eur(invCalc(i).incl)}</td></tr>`).join("")}</tbody></table></div><div class="calc" id="piSum"></div>`, foot:`<button class="btn" data-close>Annuleren</button><button class="btn primary" id="piOk">Koppelen</button>`});
    const upd = () => { const s = r2([...m.querySelectorAll("[data-pi]:checked")].reduce((a, x) => a + invCalc(S.invoices[x.dataset.pi]).incl, 0)); $("#piSum").innerHTML = `<span>Gekozen <b class="num">${eur(s)}</b></span><span>Ontvangen <b class="num">${eur(t.bedrag)}</b></span>${Math.abs(s - t.bedrag) >= 0.01 && s ? `<span style="color:var(--warn)">Verschil ${eur(t.bedrag - s)}</span>` : ""}`; };
    m.querySelectorAll("[data-pi]").forEach(x => x.onchange = upd); upd();
    m.querySelector("#piOk").onclick = async () => { const ids = [...m.querySelectorAll("[data-pi]:checked")].map(x => x.dataset.pi); if (!ids.length) return; closeSheet(); await linkTx(t.id, ids); toast("Gekoppeld en als betaald gemarkeerd"); };
  });
};
async function importBank(file){
  let txs; try{ txs = parseBank(await file.text()); }catch(e){ txs = []; }
  if (!txs.length){ toast("In dit bestand zijn geen transacties gevonden. Gebruik een MT940-, CSV- of CAMT.053-export."); return; }
  const seen = {}; let nieuw = 0, auto = 0;
  toast(`${txs.length} transacties gevonden, verwerken…`);
  for (const t of txs){
    const key = `${t.datum}|${t.bedrag}|${t.naam}|${t.omschrijving}`; seen[key] = (seen[key] || 0) + 1;
    const id = "t" + hashStr(key + "|" + seen[key]); if (S.bank[id]) continue;
    const doc = {...t, status:"open", invoiceIds:[], voorstel:null, bron:file.name, ingelezen:today()};
    const m = matchTx(t);
    try{
      if (m?.zeker){ await save("bank", id, {...doc, status:"gekoppeld", invoiceIds:m.ids}); S.bank[id] = {id, ...doc}; for (const iid of m.ids){ await patch("invoices", iid, {betaaldOp:t.datum, betaaldVia:id}); S.invoices[iid] = {...S.invoices[iid], betaaldOp:t.datum}; } auto++; }
      else { if (m) doc.voorstel = {ids:m.ids, reden:m.reden}; await save("bank", id, doc); S.bank[id] = {id, ...doc}; }
      nieuw++;
    }catch(e){ break; }
  }
  toast(nieuw ? `${nieuw} nieuwe transacties ingelezen, ${auto} facturen automatisch als betaald gemarkeerd` : "Alle transacties uit dit bestand waren al ingelezen");
}

/* ---- Vaste kosten ---- */
const monthKey = iso => iso.slice(0, 7);
const addMonths = (key, n) => { const [y, m] = key.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
ACTS.newRec = () => recDialog(null);
function recDialog(id){
  const r = id ? S.recurring[id] : {leverancier:"", omschrijving:"", categorie:"Software & abonnementen", bedragIncl:"", btw:S.settings.tarieven[0]?.naam || "21%", zakelijk:1, interval:"maand", dag:1, start:monthKey(today()), eind:"", betaalwijze:"Bank"};
  const m = openSheet({title: id ? "Vaste kosten bewerken" : "Vaste kosten toevoegen", body:`<div class="form">
    ${fld("Leverancier", inp("rcLev", r.leverancier))}${fld("Omschrijving", inp("rcOms", r.omschrijving))}
    ${fld("Categorie", sel("rcCat", S.settings.categorieen, r.categorie))}${fld("Bedrag incl. btw", inp("rcBed", r.bedragIncl === "" ? "" : nf(r.bedragIncl), 'inputmode="decimal" class="mono"'))}
    ${fld("Btw-tarief", sel("rcBtw", S.settings.tarieven.map(t => t.naam), r.btw))}${fld("Zakelijk deel", sel("rcZak", [[1,"100%"],[0.75,"75%"],[0.5,"50%"],[0.25,"25%"]], r.zakelijk ?? 1))}
    ${fld("Elke", sel("rcInt", [["maand","maand"],["kwartaal","kwartaal"],["jaar","jaar"]], r.interval))}${fld("Op dag van de maand", inp("rcDag", r.dag, 'inputmode="numeric" class="mono"'))}
    ${fld("Eerste maand", inp("rcStart", r.start, 'type="month"'))}${fld("Laatste maand (optioneel)", inp("rcEind", r.eind || "", 'type="month"'))}
  </div><span class="small muted">Elke periode wordt deze uitgave vanzelf bij Kosten geboekt zodra je de app opent. Je kunt een geboekte regel daarna nog aanpassen, bijvoorbeeld om de factuur als bijlage toe te voegen.</span>`,
    foot:`${id ? `<button class="btn danger left" id="rcDel">Verwijderen</button>` : ""}<button class="btn" data-close>Annuleren</button><button class="btn primary" id="rcOk">Opslaan</button>`});
  m.querySelector("#rcOk").onclick = async () => {
    if (!v("rcLev").trim() || !parseNum(v("rcBed")) || !/^\d{4}-\d{2}$/.test(v("rcStart"))) return toast("Vul leverancier, bedrag en eerste maand in.");
    const doc = {leverancier:v("rcLev").trim(), omschrijving:v("rcOms").trim(), categorie:v("rcCat"), bedragIncl:r2(parseNum(v("rcBed"))), btw:v("rcBtw"), zakelijk:Number(v("rcZak")), interval:v("rcInt"), dag:Math.min(28, Math.max(1, parseNum(v("rcDag")) || 1)), start:v("rcStart"), eind:v("rcEind") || "", betaalwijze:"Bank", laatste: id ? (r.laatste || "") : ""};
    const nid = await save("recurring", id, doc); closeSheet(); S.recurring[nid] = {id:nid, ...doc}; const n = await runRecurring(true); toast(n ? `Opgeslagen · ${n} periode(s) geboekt` : "Vaste kosten opgeslagen"); if (n) afterCost();
  };
  if (id) m.querySelector("#rcDel").onclick = async () => { closeSheet(); if (await ask("Vaste kosten verwijderen", "Er worden geen nieuwe periodes meer geboekt. Al geboekte kosten blijven staan.")) { await del("recurring", id); toast("Verwijderd"); } };
}
let recRunning = false;
async function runRecurring(force){
  if (recRunning || (!force && runRecurring.done)) return 0; recRunning = true; runRecurring.done = true; let n = 0;
  try{
    const now = today(), curKey = monthKey(now), day = Number(now.slice(8, 10));
    for (const r of list("recurring")){
      const step = r.interval === "jaar" ? 12 : r.interval === "kwartaal" ? 3 : 1; let key = r.start, last = r.laatste || "", guard = 0;
      while (key <= curKey && guard++ < 60){
        if (r.eind && key > r.eind) break;
        const due = key < curKey || Number(r.dag) <= day;
        if (key > last && due){
          const id = `rc-${r.id}-${key}`;
          if (!S.costs[id]){ await save("costs", id, {datum:`${key}-${String(r.dag).padStart(2, "0")}`, leverancier:r.leverancier, omschrijving:r.omschrijving || `${r.leverancier} ${key}`, categorie:r.categorie, betaalwijze:r.betaalwijze || "Bank", bedragIncl:r.bedragIncl, btw:r.btw, zakelijk:r.zakelijk ?? 1, assetId:null, assetType:null, assetName:null, vasteKostenId:r.id}); n++; }
          last = key;
        }
        key = addMonths(key, step);
      }
      if (last && last !== (r.laatste || "")) await patch("recurring", r.id, {laatste:last});
    }
  }catch(e){} finally{ recRunning = false; }
  return n;
}

/* ---- Belastingpotje ---- */
VIEWS.potje = () => {
  const j = S.jaar, pg = prognose(j), t = pg.t, b = S.settings.belasting, cur = j === new Date().getFullYear();
  const nu = ibCalc(t.winst), jr = ibCalc(pg.winstJaar), eff = pg.winstJaar > 0 ? jr.totaal / pg.winstJaar : 0;
  const urenOk = pg.urenJaar >= S.settings.urennorm;
  const qs = [1,2,3,4].map(q => btwKwartaal(j, q));
  const line = (l, val, cls = "") => `<span class="${cls}">${l}</span><span class="num ${cls}">${val}</span>`;
  const maand = t.maand.map((m, i) => { const w = m.omzet - m.kosten; return {i, omzet:m.omzet, btw:r2(m.omzet * (S.settings.tarieven[0]?.pct ?? 0.21)), ib:r2(Math.max(0, w) * eff)}; });
  return `<div class="head"><div class="t"><span class="label">Reserveren</span><h1>Belastingpotje ${j}</h1></div><div class="row">${jaarSel()}<button class="btn" data-act="report">Jaarrapport (PDF)</button></div></div>
  <div class="kpis">
    <div class="kpi lead"><span class="label">Per maand opzij (IB + Zvw)</span><span class="v">${eur(jr.totaal / 12)}</span><span class="small">plus de btw van die maand</span></div>
    <div class="kpi"><span class="label">IB + Zvw ${cur ? "prognose " : ""}${j}</span><span class="v">${eur(jr.totaal)}</span><span class="small muted">${Math.round(eff * 100)}% van je winst</span></div>
    <div class="kpi"><span class="label">Tot nu toe opzij</span><span class="v">${eur(nu.totaal + qs.reduce((a, q) => a + Math.max(0, q.saldo), 0))}</span><span class="small muted">IB/Zvw ${eur(nu.totaal)} + btw ${eur(qs.reduce((a, q) => a + Math.max(0, q.saldo), 0))}</span></div>
    <div class="kpi"><span class="label">Per factuur apart zetten</span><span class="v">${pg.omzetJaar ? Math.round(jr.totaal / pg.omzetJaar * 100) : 0}% + btw</span><span class="small muted">van het bedrag excl. btw</span></div>
  </div>
  ${b.za && !urenOk ? `<div class="notice warn">Met ${nf(pg.urenJaar, 0)} uur ${cur ? "(prognose)" : ""} haal je het urencriterium van ${nf(S.settings.urennorm, 0)} uur niet. Dan krijg je geen zelfstandigenaftrek; de berekening hieronder rekent hem nog wel mee. Zet hem uit bij Instellingen als je zeker weet dat je het niet haalt.</div>` : ""}
  <div class="grid2">
    <div class="panel"><div class="ph"><h2>Inkomstenbelasting ${cur ? "prognose " : ""}${j}</h2><span class="small muted">${cur ? `winst t/m vandaag × ${nf(pg.factor, 2)}` : "heel jaar"}</span></div><div class="pb"><div class="calcrow">
      ${line("Winst uit onderneming", eur(jr.winst))}
      ${line(`Zelfstandigenaftrek ${b.za ? "" : "(uit)"}`, "− " + eur(jr.za))}
      ${line(`Startersaftrek ${b.sa ? "" : "(uit)"}`, "− " + eur(jr.sa))}
      ${line(`Mkb-winstvrijstelling ${nf(b.mkb * 100, 1)}%`, "− " + eur(jr.mkb))}
      ${line("Belastbare winst", eur(jr.bel), "tot")}
      ${jr.loon ? line("Loon uit dienstverband", "+ " + eur(jr.loon)) + line("Belastbaar inkomen box 1", eur(jr.loon + jr.bel), "tot") : ""}
      ${line("Inkomstenbelasting box 1", eur(jr.tax))}
      ${line("Algemene heffingskorting", "− " + eur(Math.min(jr.ahk, jr.tax)))}
      ${line("Arbeidskorting", "− " + eur(Math.min(jr.ak, Math.max(0, jr.tax - jr.ahk))))}
      ${jr.loon ? line("Inkomstenbelasting totaal", eur(jr.totNet), "tot") + line("Al ingehouden via loonheffing (schatting)", "− " + eur(jr.loonNet)) : ""}
      ${line(jr.loon ? "Extra inkomstenbelasting door je onderneming" : "Te betalen inkomstenbelasting", eur(jr.ib), "tot")}
      ${line(`Bijdrage Zvw ${nf(b.zvwPct * 100, 2)}%`, eur(jr.zvw))}
      ${line("Totaal te reserveren", eur(jr.totaal), "tot")}
    </div><p class="small muted" style="margin:12px 0 0">Indicatie op basis van je winst${b.loon ? " en je loon" : ""} en de tarieven van ${esc(b.jaar)} (onder AOW-leeftijd).${b.loon ? " De loonheffing is geschat als de belasting over je loon alleen; je werkelijke jaaropgave kan afwijken." : " Loon uit dienstverband is niet ingevuld (Instellingen)."} Hypotheekrente, toeslagen en een voorlopige aanslag zijn niet meegenomen. Betaal je al een voorlopige aanslag, dan gaat dat bedrag van je potje af.</p></div></div>
    <div class="panel"><div class="ph"><h2>Btw per kwartaal</h2></div><div class="pb"><div class="calcrow">${qs.map((q, i) => line(`Q${i + 1} · uiterlijk ${dNL(q.deadline)}`, eur(q.saldo))).join("")}${line("Totaal", eur(qs.reduce((a, q) => a + q.saldo, 0)), "tot")}</div></div></div>
  </div>
  <div class="panel"><div class="ph"><h2>Per maand opzij zetten</h2><span class="small muted">btw over je omzet + ${Math.round(eff * 100)}% van de maandwinst</span></div><div class="tbl-wrap"><table><thead><tr><th>Maand</th><th class="r">Omzet excl.</th><th class="r">Btw</th><th class="r">IB + Zvw</th><th class="r">Totaal opzij</th></tr></thead><tbody>${maand.filter(m => m.omzet).map(m => `<tr><td>${MAANDEN[m.i]}</td><td class="r num">${eur(m.omzet)}</td><td class="r num">${eur(m.btw)}</td><td class="r num">${eur(m.ib)}</td><td class="r num"><b>${eur(m.btw + m.ib)}</b></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nog geen omzet in ${j}.</td></tr>`}</tbody></table></div></div>`;
};
BIND.potje = () => { bindJaar(); bindActs(); };

/* ---- Jaarrapport (PDF) ---- */
async function yearReportPDF(jaar){
  if (!S.downloads){ toast("Downloaden is in deze weergave niet beschikbaar."); return; }
  if (!window.jspdf){ toast("De PDF-module is niet geladen. Herlaad de pagina."); return; }
  const {jsPDF} = window.jspdf, pdf = new jsPDF({unit:"mm", format:"a4"}), E = n => eur(n).replace(/ /g, " ");
  const c = S.settings.company, t = yearTotals(jaar), ib = ibCalc(t.winst), b = S.settings.belasting;
  let y = 22;
  const need = h => { if (y + h > 278){ pdf.addPage(); y = 22; } };
  const h1 = txt => { need(16); y += 4; pdf.setFont("helvetica","bold"); pdf.setFontSize(12.5); pdf.setTextColor(14,107,87); pdf.text(txt, 20, y); pdf.setTextColor(34,34,34); y += 3; pdf.setDrawColor(14,107,87); pdf.line(20, y, 190, y); y += 6; };
  const row = (l, val, bold, ind = 0) => { need(6); pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(9.5); pdf.text(String(l), 20 + ind, y); if (val !== undefined) pdf.text(String(val), 190, y, {align:"right"}); y += 5.6; };
  const cols = (vals, xs, bold) => { need(6); pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(8.8); vals.forEach((v0, i) => pdf.text(String(v0), xs[i][0], y, xs[i][1] ? {align:xs[i][1]} : undefined)); y += 5.2; };
  pdf.setFont("helvetica","bold"); pdf.setFontSize(20); pdf.text(`Jaarrapport ${jaar}`, 20, y); y += 8;
  pdf.setFont("helvetica","normal"); pdf.setFontSize(10); [c.name, [c.address, c.postcode].filter(Boolean).join(", "), c.kvk ? "KvK " + c.kvk : "", c.btwid ? "Btw-id " + c.btwid : ""].filter(Boolean).forEach(l => { pdf.text(l, 20, y); y += 5; });
  pdf.setFontSize(8.5); pdf.setTextColor(102,102,102); pdf.text(`Gemaakt op ${dNL(today())} met Kasboek. Indicatief overzicht; controleer je aangifte.`, 20, y); pdf.setTextColor(34,34,34); y += 4;
  h1("Winst-en-verliesrekening");
  row("Omzet (excl. btw)", E(t.omzet), true);
  row("Kosten", undefined, true);
  Object.entries(t.cat).filter(([k]) => k !== INVEST).sort((a, b2) => b2[1] - a[1]).forEach(([k, val]) => row(k, E(val), false, 4));
  row("Afschrijvingen", E(t.afschr), false, 4); row(`Kilometervergoeding (${nf(t.kmTot, 0)} km)`, E(t.km), false, 4);
  row("Totaal kosten", E(t.kosten + t.afschr + t.km), true);
  row("Winst uit onderneming", E(t.winst), true);
  h1("Fiscale berekening (indicatie)");
  row(`Zelfstandigenaftrek${b.za ? "" : " (niet toegepast)"}`, "- " + E(ib.za)); row(`Startersaftrek${b.sa ? "" : " (niet toegepast)"}`, "- " + E(ib.sa)); row(`Mkb-winstvrijstelling ${nf(b.mkb * 100, 1)}%`, "- " + E(ib.mkb));
  row("Belastbare winst", E(ib.bel), true); if (ib.loon){ row("Loon uit dienstverband", E(ib.loon)); row("Inkomstenbelasting totaal (loon + winst)", E(ib.totNet)); row("Af: al ingehouden via loonheffing (schatting)", "- " + E(ib.loonNet)); } row(ib.loon ? "Extra inkomstenbelasting door onderneming" : "Inkomstenbelasting na heffingskortingen", E(ib.ib)); row("Bijdrage Zvw", E(ib.zvw)); row("Indicatie te betalen", E(ib.totaal), true);
  const metUren = S.settings.rapport?.urencriterium !== false;
  if (metUren) row(`Urencriterium: ${nf(t.uren, 1)} van ${nf(S.settings.urennorm, 0)} uur ${t.uren >= S.settings.urennorm ? "(gehaald)" : "(niet gehaald)"}`);
  h1("Btw per kwartaal");
  const X = [[20],[70,"right"],[95,"right"],[120,"right"],[145,"right"],[168,"right"],[190,"right"]];
  cols(["Kwartaal","Omzet 1a","Btw 1a","Omzet 1b/1e","Btw 1b","Voorbel. 5b","Saldo"], X, true);
  let sm = [0,0,0,0,0,0]; [1,2,3,4].forEach(q => { const k = btwKwartaal(jaar, q); const vals = [k["1a"].g, k["1a"].b, k["1b"].g + k["1e"].g, k["1b"].b, k.vb, k.saldo]; vals.forEach((x, i) => sm[i] += x); cols(["Q" + q, ...vals.map(E)], X); });
  cols(["Totaal", ...sm.map(E)], X, true);
  h1("Omzet per klant");
  const pk = {}; for (const i of booked()) if (yearOf(i.datum) === jaar){ const n = i.klant?.naam || clientName(i.klantId); pk[n] = (pk[n] || 0) + invCalc(i).excl; }
  Object.entries(pk).sort((a, b2) => b2[1] - a[1]).forEach(([k, val]) => row(k, E(val)));
  h1(`Openstaande facturen per 31-12-${jaar}`);
  const open = booked().filter(i => i.datum <= `${jaar}-12-31` && (!i.betaaldOp || i.betaaldOp > `${jaar}-12-31`));
  if (open.length){ open.sort((a, b2) => a.datum.localeCompare(b2.datum)).forEach(i => row(`${i.nr}  ${dNL(i.datum)}  ${i.onderwerp || ""}`, E(invCalc(i).incl))); row("Totaal debiteuren", E(open.reduce((a, i) => a + invCalc(i).incl, 0)), true); } else row("Geen openstaande facturen.");
  h1("Activa");
  const act = list("activa"); if (act.length){ const XA = [[20],[110,"right"],[135,"right"],[160,"right"],[190,"right"]]; cols(["Omschrijving","Aanschaf","Bedrag","Afschr. " + jaar,"Boekwaarde"], XA, true); act.forEach(a => { const k = activaCalc(a, jaar); cols([String(a.omschrijving).slice(0, 48), dNL(a.datum), E(a.bedrag), E(k.dit), k.boekwaarde == null ? "-" : E(k.boekwaarde)], XA); }); } else row("Geen investeringen.");
  if (metUren){ h1("Uren per maand");
  t.maand.forEach((m, i) => { if (m.uren) row(MAANDEN[i], nf(m.uren, 2) + " uur"); }); row("Totaal", nf(t.uren, 2) + " uur", true); }
  const n = pdf.getNumberOfPages(); for (let p = 1; p <= n; p++){ pdf.setPage(p); pdf.setFontSize(8.5); pdf.setTextColor(102,102,102); pdf.text(`${c.name || ""} · Jaarrapport ${jaar}`, 20, 287); pdf.text(`Pagina ${p} van ${n}`, 190, 287, {align:"right"}); }
  try{ await S.downloads.save({filename:`Jaarrapport ${jaar} ${(c.name || "").replace(/[\\/:*?"<>|]/g, "-")}.pdf`, data:pdf.output("blob")}); }catch(e){ if (e?.code !== "cancelled" && e?.code !== "declined") toast("Het rapport kon niet worden opgeslagen."); }
}

/* ---- Weekfacturen automatisch ---- */
function nrForWeek(week){ const base = nextNr(); const last = list("invoices").map(i => String(i.nr)).filter(x => /^\d{4}-\d+/.test(x)).sort((a, b) => Number(b.match(/^\d{4}-(\d+)/)[1]) - Number(a.match(/^\d{4}-(\d+)/)[1]))[0]; return last && /WK\d+$/i.test(last) ? base + "WK" + String(week).padStart(2, "0") : base; }
function weekInvoiced(klantNaam, jaar, week){ return list("invoices").find(i => (i.klant?.naam || clientName(i.klantId)) === klantNaam && weekFromText(i.onderwerp) === week && yearOf(workDate(i)) === jaar); }
async function createWeekInvoice({klant, jaar, week, uren, omschrijving, prijs, hourIds}){
  const tar = S.settings.tarieven[0]?.naam || "21%";
  const doc = {nr:nrForWeek(week), datum:today(), klantId:klant.id, onderwerp:`Factuur week ${week} ${jaar}`, lines:[{omschrijving, aantal:r2(uren), eenheid:"uur", prijs, btw:tar, hourIds}], status:"geboekt", betaaldOp:null, klant:clean(klant), verval:addDays(today(), Number(S.settings.termijn) || 14), geboektOp:today()};
  const id = await save("invoices", null, doc); S.invoices[id] = {id, ...doc};
  await syncHours(id, doc); return S.invoices[id];
}

/* ---- Meer (telefoon) ---- */
VIEWS.meer = () => `<div class="head"><div class="t"><h1>Meer</h1></div></div><div class="panel">${[["ritten","Ritten","Zakelijke kilometers"],["activa","Activa","Investeringen en afschrijving"],["btw","Btw-aangifte","Bedragen per kwartaal"],["potje","Belastingpotje","Hoeveel je opzij zet voor btw en inkomstenbelasting"],["bank","Bank","Knab-afschrift inlezen, betalingen koppelen"],["klanten","Klanten","Adressen en btw-nummers"],["instellingen","Instellingen","Bedrijfsgegevens, tarieven, categorieën"],["export","Export & back-up","CSV voor Excel en je boekhouder"]].map(([k, t, s]) => `<button data-go="${k}" class="btn ghost" style="width:100%;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);border-radius:0"><span style="display:flex;flex-direction:column;align-items:flex-start"><b>${t}</b><span class="small muted">${s}</span></span><span aria-hidden="true">›</span></button>`).join("")}</div>`;


/* ================= toevoegingen voor de telefoon-app ================= */
ACTS.backup = b => backupNow(b);
function backupDue(){
  const any = COLS.some(c => Object.keys(S[c] || {}).length);
  if (!any) return false;
  const last = ls("kb_lastBackup");
  return !last || dayDiff(today(), last) >= 7;
}
function backupStatus(){
  const last = ls("kb_lastBackup");
  if (!last) return "Je hebt op dit toestel nog geen back-up gemaakt.";
  const d = dayDiff(today(), last);
  return d <= 0 ? "Laatste back-up: vandaag." : d === 1 ? "Laatste back-up: gisteren." : `Laatste back-up: ${d} dagen geleden (${dNL(last)}).`;
}
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
function b64ToBlob(b64, type){ const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type: type || "application/octet-stream"}); }
async function buildBackup(withAssets){
  const data = {app:"kasboek", versie:2, gemaakt:new Date().toISOString(), settings:S.settings};
  for (const c of COLS) data[c] = S[c];
  data.assets = {};
  if (withAssets){
    const used = new Set(list("costs").map(c => c.assetId).filter(Boolean));
    for (const a of await KB.assets.all()){ if (!used.has(a.id) || !a.blob) continue; data.assets[a.id] = {type:a.type, name:a.name, size:a.size, added:a.added, data: await blobToB64(a.blob)}; }
  }
  return data;
}
let backupBusy = false;
async function backupNow(btn){
  if (backupBusy) return; backupBusy = true;
  const label = btn ? btn.textContent : ""; if (btn){ btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Back-up maken'; }
  try{
    const data = await buildBackup(S.backupMet !== false);
    const na = Object.keys(data.assets).length;
    const name = `Kasboek back-up ${today()}.txt`;   // .txt: Android kan dit type delen naar Google Drive
    await S.downloads.save({filename:name, data:new Blob([JSON.stringify(data)], {type:"text/plain"})});
    ls("kb_lastBackup", today());
    toast(`Back-up gemaakt${na ? ` met ${na} bijlagen` : ""}`); render(true);
  }catch(e){ if (e?.code !== "cancelled") toast("De back-up kon niet worden gemaakt."); }
  finally{ backupBusy = false; if (btn && btn.isConnected){ btn.disabled = false; btn.textContent = label; } }
}
async function openAsset(id, name, type){
  const rec = await KB.assets.get(id); if (!rec?.blob){ toast("De bijlage staat niet op dit toestel."); return; }
  const fname = name || ("bijlage." + (/pdf/.test(rec.type) ? "pdf" : "jpg"));
  if (!/^image\//.test(rec.type || type || "")){ try{ await S.downloads.save({filename:/\.pdf$/i.test(fname) ? fname : fname + ".pdf", data:rec.blob}); }catch(e){} return; }
  const w = document.createElement("div");
  w.innerHTML = `<div class="sheet-bg" style="z-index:70"><div class="sheet" style="max-width:900px"><div class="sh"><h2>Bijlage</h2><button class="x" data-c aria-label="Sluiten">✕</button></div><div class="sb"><img alt="Bon" style="width:100%;height:auto;border-radius:8px"></div><div class="sf"><button class="btn" data-s>Delen of opslaan</button><button class="btn primary" data-c>Sluiten</button></div></div></div>`;
  w.querySelector("img").src = KB.assets.url(id);
  w.querySelectorAll("[data-c]").forEach(b => b.onclick = () => w.remove());
  w.querySelector("[data-s]").onclick = async () => { try{ await S.downloads.save({filename:/\.(jpe?g|png)$/i.test(fname) ? fname : fname + ".jpg", data:rec.blob}); }catch(e){} };
  document.body.append(w);
}
/* uren uit tekst halen zonder internet */
const MND = {jan:1,feb:2,mrt:3,maa:3,mar:3,apr:4,mei:5,may:5,jun:6,jul:7,aug:8,sep:9,okt:10,oct:10,nov:11,dec:12};
function localHours(text, jaar){
  const out = [];
  for (let line of String(text || "").split(/\r?\n/)){
    line = line.trim(); if (!line) continue;
    if (/^(totaal|total|som|week\s*totaal)\b/i.test(line)) continue;
    let datum = null, rest = line, m;
    if ((m = rest.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) datum = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    else if ((m = rest.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/))) datum = `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    else if ((m = rest.match(/\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/i)) && MND[m[2].toLowerCase()]) datum = `${m[3] || jaar}-${String(MND[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    else if ((m = rest.match(/\b(\d{1,2})[-\/](\d{1,2})\b/))) datum = `${jaar}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (!datum || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(datum)) continue;
    rest = rest.replace(m[0], " ");
    let uren = 0, um;
    if ((um = rest.match(/\b(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})\b/))){ uren = (Number(um[3]) * 60 + Number(um[4]) - Number(um[1]) * 60 - Number(um[2])) / 60; if (uren < 0) uren += 24; rest = rest.replace(um[0], " "); }
    else if ((um = rest.match(/(\d+(?:[.,]\d+)?)\s*(?:uur|uren|u|h|hrs?)\b/i))){ uren = parseNum(um[1]); rest = rest.replace(um[0], " "); }
    else if ((um = rest.match(/\b(\d{1,2}):(\d{2})\b/))){ uren = Number(um[1]) + Number(um[2]) / 60; rest = rest.replace(um[0], " "); }
    else { const nums = [...rest.matchAll(/(?:^|[\s;,\t])(\d{1,2}(?:[.,]\d{1,2})?)(?=$|[\s;,\t])/g)].map(x => parseNum(x[1])).filter(x => x > 0 && x <= 24); if (nums.length){ uren = nums[nums.length - 1]; rest = rest.replace(new RegExp("(^|[\\s;,\\t])" + String(nums[nums.length - 1]).replace(".", "[.,]") + "(?=$|[\\s;,\\t])"), " "); } }
    if (!(uren > 0 && uren <= 24)) continue;
    const oms = rest.replace(/^(ma|di|wo|do|vr|za|zo|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b\.?/i, "").replace(/[;\t]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s,–-]+|[\s,–-]+$/g, "");
    out.push({datum, uren:r2(uren), omschrijving:oms.slice(0, 120)});
  }
  return out;
}
/* instellingen van dit toestel */
function deviceSettingsHTML(){
  return `<div class="panel"><div class="ph"><h2>Bonnen uitlezen met Claude</h2><span class="small muted">Optioneel · alleen op dit toestel</span></div><div class="pb" style="display:flex;flex-direction:column;gap:12px">
    <span class="small muted">Met een eigen API-sleutel van Anthropic leest de app bonnen, pdf-facturen en schermafbeeldingen van uren uit. Je betaalt per bon een paar cent bij Anthropic. Zonder sleutel vul je de bedragen zelf in; de rest van de app werkt gewoon. De sleutel staat alleen op deze telefoon en gaat niet mee in back-ups. Een sleutel maak je op console.anthropic.com.</span>
    <div class="form">${fld("API-sleutel", `<input id="dKey" type="password" autocomplete="off" placeholder="${S.canScan ? "•••••••• (ingesteld)" : "sk-ant-…"}">`)}${fld("Model", sel("dModel", [["claude-haiku-5-5","Haiku (snel, goedkoopst)"],["claude-sonnet-5-5","Sonnet (nauwkeuriger)"]], S.apiModel || "claude-haiku-5-5"))}</div>
    <div class="row"><button class="btn primary" id="dKeySave">Sleutel opslaan</button>${S.canScan ? `<button class="btn" id="dKeyTest">Testen</button><button class="btn danger" id="dKeyDel">Sleutel verwijderen</button>` : ""}<span class="small" id="dKeyMsg">${S.canScan ? "Uitlezen staat aan." : "Uitlezen staat uit."}</span></div>
  </div></div>
  <div class="panel"><div class="ph"><h2>Opslag op dit toestel</h2></div><div class="pb" style="display:flex;flex-direction:column;gap:8px">
    <span id="dStore" class="small muted">Gegevens worden geladen…</span>
    <span class="small muted">Je administratie staat alleen in de app op deze telefoon. Verwijder je de app of wis je de sitegegevens van Chrome, dan is alles weg. Maak daarom regelmatig een back-up.</span>
    <div class="row"><button class="btn" data-go="export">Naar back-up</button>${S.persisted ? "" : `<button class="btn" id="dPersist">Opslag beschermen</button>`}</div>
  </div></div>
  <div class="panel"><div class="ph"><h2>App-versie</h2></div><div class="pb" style="display:flex;flex-direction:column;gap:8px">
    <span class="small muted" id="dVer">Versie ${esc(S.swVersion || "onbekend")}.</span>
    <div class="row"><button class="btn" id="dUpd">Controleren op updates</button></div>
  </div></div>`;
}
async function bindDeviceSettings(){
  const msg = t => { const x = $("#dKeyMsg"); if (x) x.textContent = t; };
  $("#dKeySave").onclick = async () => {
    const k = v("dKey").trim();
    if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) return msg("Dit lijkt geen geldige sleutel (begint met sk-ant-).");
    if (k) await KB.meta.set("apiKey", k);
    await KB.meta.set("apiModel", v("dModel")); S.apiModel = v("dModel");
    S.canScan = !!(await KB.sample.key()); toast(k ? "Sleutel opgeslagen" : "Model opgeslagen"); render(true);
  };
  if ($("#dKeyDel")) $("#dKeyDel").onclick = async () => { await KB.meta.set("apiKey", ""); S.canScan = false; toast("Sleutel verwijderd"); render(true); };
  if ($("#dKeyTest")) $("#dKeyTest").onclick = async () => { msg("Bezig met testen…"); try{ const r = await KB.sample.json('Antwoord alleen met dit JSON-object: {"ok": true}'); msg(r?.ok ? "De sleutel werkt." : "Antwoord ontvangen, maar onverwacht."); }catch(e){ msg({bad_key:"De sleutel wordt geweigerd.", offline:"Geen internetverbinding.", rate_limited:"Even te druk, probeer het later."}[e?.code] || "Testen lukte niet."); } };
  if ($("#dPersist")) $("#dPersist").onclick = async () => { S.persisted = await KB.persist(); toast(S.persisted ? "Opslag is beschermd" : "Chrome staat dit nu niet toe. Installeer de app op je beginscherm en probeer het opnieuw."); render(true); };
  $("#dUpd").onclick = async () => { const r = await navigator.serviceWorker?.getRegistration(); if (!r){ toast("Updates werken pas als de app via internet is geopend."); return; } toast("Controleren…"); try{ await r.update(); }catch(e){} setTimeout(() => { if (!r.waiting && !r.installing) toast("Je hebt de nieuwste versie."); }, 2500); };
  const est = await KB.usage(); const n = (await KB.assets.all()).length;
  const el = $("#dStore"); if (el) el.textContent = `${n} bijlagen · ${est ? `${nf((est.usage || 0) / 1048576, 1)} MB in gebruik` : "gebruik onbekend"} · opslag ${S.persisted ? "beschermd" : "niet beschermd (Android kan gegevens wissen als de telefoon vol is)"}.`;
}
/* updates: nieuwe versie pas na jouw akkoord */
function setupUpdates(){
  if (!("serviceWorker" in navigator)) return;
  KB.meta.get("apiModel").then(m => { if (m) S.apiModel = m; });
  navigator.serviceWorker.register("sw.js").then(reg => {
    const ask = w => showUpdate(w);
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener("updatefound", () => { const n = reg.installing; n?.addEventListener("statechange", () => { if (n.state === "installed" && navigator.serviceWorker.controller) ask(n); }); });
    setInterval(() => reg.update().catch(() => {}), 6 * 3600 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", e => { if (e.data?.version){ S.swVersion = e.data.version; const d = $("#dVer"); if (d) d.textContent = `Versie ${e.data.version}.`; } });
  navigator.serviceWorker.ready.then(r => r.active?.postMessage("version")).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded || !S.updating) return; reloaded = true; location.reload(); });
}
function showUpdate(worker){
  if ($("#updBar")) return;
  const b = document.createElement("div"); b.id = "updBar"; b.setAttribute("role", "status");
  b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(12px + env(safe-area-inset-top,0px));z-index:90;background:var(--accent);color:var(--accent-ink);padding:10px 12px 10px 16px;border-radius:10px;display:flex;gap:12px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:calc(100% - 24px)";
  b.innerHTML = `<span>Er is een nieuwe versie van Kasboek.</span><button class="btn sm" id="updLater" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.5)">Later</button><button class="btn sm" id="updNow">Bijwerken</button>`;
  document.body.append(b);
  $("#updLater").onclick = () => b.remove();
  $("#updNow").onclick = () => { $("#updNow").disabled = true; S.updating = true; worker.postMessage("skipWaiting"); };
}

/* ---------- start ---------- */
(async function init(){
  renderNav();
  const [db, assets, sample, downloads] = await Promise.all(["db","assets","sample","downloads"].map(n => window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null)));
  S.db = db; S.assets = assets; S.sample = sample; S.downloads = downloads;
  if (sample){ try{ const lim = await sample.limits(); S.canScan = !!lim?.images; }catch(e){ S.canScan = false; } }
  KB.persist().then(p => { S.persisted = p; });
  setupUpdates();
  if (!db){ S.failed = true; render(true); return; }
  db.doc("settings/main").onSnapshot(s => {
    S.hasSettings = s.exists; const d = s.exists ? s.data() : {};
    S.settings = {...structuredClone(DEFAULTS), ...d, company:{...DEFAULTS.company, ...(d.company || {})}, mail:{...DEFAULTS.mail, ...(d.mail || {})}, herinnering:{...DEFAULTS.herinnering, ...(d.herinnering || {})}, belasting:{...DEFAULTS.belasting, ...(d.belasting || {})}, rapport:{...DEFAULTS.rapport, ...(d.rapport || {})}};
    if (!S.jaar){ const saved = Number(ls("kb_jaar")); S.jaar = saved || S.settings.jaar; }
    S.loaded.add("settings"); scheduleRender();
  }, e => { S.failed = true; render(true); });
  for (const c of COLS) db.collection(c).onSnapshot(snap => {
    const o = {}; for (const d of snap.docs) o[d.id] = {id:d.id, ...d.data()}; S[c] = o; S.loaded.add(c); scheduleRender();
    if (S.loaded.size >= COLS.length + 1 && !runRecurring.done) setTimeout(() => runRecurring().then(async n => { const m = await reconcileCosts(); const msg = [n ? `${n} vaste kosten automatisch geboekt` : "", m ? `${m} kostenpost(en) gekoppeld aan de bank` : ""].filter(Boolean).join(" · "); if (msg) toast(msg); }), 800);
  }, e => { S.failed = true; render(true); });
})();
