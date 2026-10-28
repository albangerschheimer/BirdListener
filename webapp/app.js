import { mesPartages, ouvrirCarte } from "./carte.js";
import { charger, predire, versSignal } from "./reconnaissance.js";

const $ = (id) => document.getElementById(id);
const etat = $("etat"), resultat = $("resultat"), micro = $("micro"), choixPays = $("pays");
let modele = null, enregistreur = null, minuteur = null, mesure = null;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Petit utilitaire : crée un élément avec une classe et un texte (jamais de HTML injecté)
function el(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

// ---------- Chargement du modèle (l'enregistrement peut commencer avant) ----------
const pret = charger((t) => { if (!enregistreur) etat.textContent = t; }).then((m) => {
  modele = m;
  if (!enregistreur) etat.textContent = `Prête : ${m.n} espèces, même sans réseau.`;
  const total = (p) => Object.values(m.frequences.pays[p]).reduce((a, b) => a + b, 0);
  const liste = Object.keys(m.frequences.pays).sort((a, b) => total(b) - total(a));
  for (const p of liste) choixPays.add(new Option(p, p));
  let memo = "France";
  try { memo = localStorage.getItem("pays") ?? "France"; } catch (e) { /* stockage indisponible */ }
  choixPays.value = memo === "" || liste.includes(memo) ? memo : "";
  return m;
}).catch((e) => { etat.textContent = "Impossible de charger l'oreille : " + e.message; });
micro.disabled = false;

choixPays.addEventListener("change", () => {
  try { localStorage.setItem("pays", choixPays.value); } catch (e) { /* stockage indisponible */ }
});

// ---------- Analyse ----------
async function analyser(tampon) {
  resultat.hidden = true;
  etat.textContent = "J'écoute…";
  try {
    const signal = await versSignal(tampon);
    await pret;
    const d = await predire(modele, signal, {
      pays: choixPays.value || null,
      mois: $("saison").checked ? new Date().getMonth() + 1 : null,
      progression: (t) => { etat.textContent = t; },
    });
    etat.textContent = "";
    afficher(d);
    noter(d);
    partager(d);
  } catch (e) {
    etat.textContent = "Je n'arrive pas à lire ce son : " + e.message;
  }
}

function pourcent(p) { return Math.max(1, Math.round(p * 100)); }

const calme = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fait défiler un nombre de 0 à sa valeur
function compter(noeud, cible) {
  if (calme) { noeud.textContent = `${cible} %`; return; }
  const debut = performance.now();
  (function pas(t) {
    const u = Math.min(1, (t - debut) / 700);
    noeud.textContent = `${Math.round(cible * (1 - (1 - u) ** 3))} %`;
    if (u < 1) requestAnimationFrame(pas);
  })(debut);
}

// Petit message en bas de l'écran
let minuteurToast = null;
function toast(texte) {
  const t = $("toast");
  t.textContent = texte;
  t.classList.add("visible");
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => t.classList.remove("visible"), 3200);
}

function rond(espece) {
  const r = el("span", "rond");
  if (espece.photo) r.style.backgroundImage = `url("photos/${encodeURI(espece.photo)}")`;
  return r;
}

function afficher(d) {
  const e = d.especes[0];
  resultat.replaceChildren();
  if (e.photo) {
    const img = el("img", "fiche-photo");
    img.src = "photos/" + e.photo;
    img.alt = e.fr;
    resultat.append(img);
  }
  resultat.append(el("h2", "nom", e.fr), el("p", "latin", e.sci));

  const verdict = el("p", "verdict");
  const type = d.chant > 0.65 ? "C'est plutôt un chant." : d.chant < 0.35 ? "C'est plutôt un cri." : "Chant ou cri, difficile à dire.";
  const chiffre = el("strong", "", "0 %");
  verdict.append(chiffre, `de certitude. ${type}`);
  compter(chiffre, pourcent(e.proba));
  const jauge = el("div", "jauge"), rempli = el("div");
  rempli.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => { rempli.style.width = `${pourcent(e.proba)}%`; }));
  jauge.append(rempli);
  resultat.append(verdict, jauge);

  if (!d.oiseau_entendu) resultat.append(el("p", "avis", "Je n'entends pas bien d'oiseau. Rapproche-toi ou enregistre un peu plus longtemps."));
  else if (d.incertain) resultat.append(el("p", "avis", "Je ne suis pas sûr : plusieurs espèces se ressemblent sur cet enregistrement."));

  const autres = d.especes.slice(1).filter((x) => x.proba >= 0.01);
  if (autres.length) {
    const ul = el("ul", "autres");
    for (const x of autres) {
      const li = el("li");
      li.append(el("span", "", x.fr), el("span", "", `${pourcent(x.proba)} %`));
      ul.append(li);
    }
    resultat.append(el("h3", "", "Ça pourrait aussi être"), ul);
  }

  // Les moments où un oiseau est entendu, regroupés par espèce
  const moments = [];
  for (const t of d.frise) {
    if (!t.oiseau) continue;
    const dernier = moments[moments.length - 1];
    if (dernier && dernier.espece.sci === t.espece.sci && dernier.fin === t.debut) dernier.fin = t.debut + 3;
    else moments.push({ debut: t.debut, fin: t.debut + 3, espece: t.espece });
  }
  if (moments.length > 1) {
    const ul = el("ul", "moments");
    for (const m of moments) {
      const li = el("li");
      li.append(rond(m.espece), `De ${m.debut} à ${m.fin} s : ${m.espece.fr}`);
      ul.append(li);
    }
    resultat.append(el("h3", "", "Au fil de l'enregistrement"), ul);
  }

  // Quand l'entendre : nombre d'enregistrements xeno-canto par mois
  const mois = modele.frequences.mois[e.i] || [];
  const max = Math.max(...mois);
  if (max > 0) {
    const grille = el("div", "saison");
    const actuel = new Date().getMonth();
    "JFMAMJJASOND".split("").forEach((lettre, k) => {
      const col = el("div", k === actuel ? "maintenant" : "");
      const barre = el("i");
      barre.style.setProperty("--h", `${Math.round(mois[k] / max * 70)}px`);
      barre.style.setProperty("--k", k);
      col.append(barre, lettre);
      grille.append(col);
    });
    resultat.append(el("h3", "", "Quand l'entendre"), grille);
  }

  if (e.photo) {
    const credit = el("p", "credit", "Photo : ");
    const lien = el("a", "", e.credit || "Wikimedia Commons");
    if (e.source) { lien.href = e.source; lien.target = "_blank"; lien.rel = "noopener"; }
    credit.append(lien);
    resultat.append(credit);
  }
  const encore = el("button", "encore", "Écouter encore");
  encore.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  resultat.append(encore);

  // apparition échelonnée des éléments de la fiche
  [...resultat.children].forEach((c, i) => c.style.setProperty("--i", i));
  resultat.classList.remove("apparait");
  resultat.hidden = false;
  void resultat.offsetWidth;
  resultat.classList.add("apparait");
  resultat.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Carnet des dernières écoutes (gardé sur le téléphone) ----------
function lireCarnet() {
  try { return JSON.parse(localStorage.getItem("carnet") || "[]"); } catch (e) { return []; }
}

function noter(d) {
  if (!d.oiseau_entendu) return;
  const e = d.especes[0];
  const carnet = [{ sci: e.sci, fr: e.fr, photo: e.photo, proba: e.proba, date: new Date().toISOString() }, ...lireCarnet()].slice(0, 30);
  try { localStorage.setItem("carnet", JSON.stringify(carnet)); } catch (err) { /* stockage indisponible */ }
  montrerCarnet();
}

function quand(iso) {
  const d = new Date(iso), maintenant = new Date();
  const heure = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86400000);
  if (ecart === 0) return `aujourd'hui à ${heure}`;
  if (ecart === 1) return `hier à ${heure}`;
  return `le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${heure}`;
}

function montrerCarnet() {
  const carnet = lireCarnet();
  $("carnet").hidden = carnet.length === 0;
  const ol = $("historique");
  ol.replaceChildren();
  for (const x of carnet.slice(0, 8)) {
    const li = el("li"), texte = el("div");
    texte.append(el("strong", "", x.fr), el("span", "", `${quand(x.date)}, sûr à ${pourcent(x.proba)} %`));
    li.append(rond(x), texte);
    ol.append(li);
  }
}
montrerCarnet();

// ---------- Fichier audio ----------
$("fichier").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (f) analyser(await f.arrayBuffer());
  ev.target.value = "";
});

// ---------- Micro ----------
const DUREE_MAX = 60;

// Barres de niveau pendant l'écoute : l'énergie réelle du micro dans 9 bandes, de 1 à 9 kHz
const barres = Array.from({ length: 9 }, () => document.createElement("i"));
$("niveaux").append(...barres);
function suivreNiveaux(flux) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyse = ctx.createAnalyser();
  analyse.fftSize = 1024;
  ctx.createMediaStreamSource(flux).connect(analyse);
  const spectre = new Uint8Array(analyse.frequencyBinCount), hz = ctx.sampleRate / analyse.fftSize;
  let actif = true;
  (function tracer() {
    if (!actif) return;
    analyse.getByteFrequencyData(spectre);
    barres.forEach((b, k) => {
      const de = Math.round((1000 + k * 900) / hz), a = Math.round((1900 + k * 900) / hz);
      let max = 0;
      for (let i = de; i < a; i++) max = Math.max(max, spectre[i]);
      b.style.height = `${8 + Math.round(max / 255 * 56)}px`;
    });
    requestAnimationFrame(tracer);
  })();
  return () => { actif = false; ctx.close(); barres.forEach((b) => { b.style.height = "8px"; }); };
}

function arreter() { if (enregistreur && enregistreur.state !== "inactive") enregistreur.stop(); }

micro.addEventListener("click", async () => {
  if (enregistreur) { arreter(); return; }
  try {
    const flux = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const morceaux = [];
    enregistreur = new MediaRecorder(flux);
    enregistreur.ondataavailable = (e) => morceaux.push(e.data);
    enregistreur.onstop = async () => {
      clearInterval(minuteur);
      if (mesure) { mesure(); mesure = null; }
      flux.getTracks().forEach((t) => t.stop());
      enregistreur = null;
      micro.classList.remove("en-cours");
      $("micro-texte").textContent = "Écouter";
      $("chrono").textContent = "";
      analyser(await new Blob(morceaux).arrayBuffer());
    };
    enregistreur.start();
    try { mesure = suivreNiveaux(flux); } catch (err) { mesure = null; }
    const debut = Date.now();
    micro.classList.add("en-cours");
    $("micro-texte").textContent = "Arrêter";
    etat.textContent = "Tends le téléphone vers le chant. Quelques secondes suffisent.";
    minuteur = setInterval(() => {
      const s = Math.floor((Date.now() - debut) / 1000);
      $("chrono").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= DUREE_MAX) arreter();
    }, 250);
  } catch (e) {
    etat.textContent = "Je n'ai pas accès au micro : " + e.message;
  }
});

// ---------- Onglets Écouter / Carte ----------
const nomFr = (sci) => modele?.meta.especes.find((x) => x.sci === sci)?.fr || sci;
for (const bouton of document.querySelectorAll(".onglet")) {
  bouton.addEventListener("click", async () => {
    for (const b of document.querySelectorAll(".onglet")) b.classList.toggle("actif", b === bouton);
    for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== bouton.dataset.vue;
    window.scrollTo({ top: 0 });
    if (bouton.dataset.vue === "vue-carte") {
      await pret;
      ouvrirCarte(nomFr).catch(() => toast("La carte n'a pas pu se charger."));
    }
  });
}

// ---------- Partage des observations sur la carte commune ----------
const casePartage = $("partage");
try { casePartage.checked = localStorage.getItem("partage") === "1"; } catch (e) { /* stockage indisponible */ }
casePartage.addEventListener("change", () => {
  try { localStorage.setItem("partage", casePartage.checked ? "1" : "0"); } catch (e) { /* stockage indisponible */ }
  if (casePartage.checked) navigator.geolocation?.getCurrentPosition(() => {}, () => toast("Sans accès à ta position, rien ne sera partagé."));
});

function position() {
  return new Promise((ok, ko) => {
    if (!navigator.geolocation) return ko(new Error("pas de géolocalisation"));
    navigator.geolocation.getCurrentPosition(ok, ko, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  });
}

async function envoyer(o) {
  const r = await fetch("api/observations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
  if (!r.ok) throw new Error(`serveur ${r.status}`);
}

function enAttente() { try { return JSON.parse(localStorage.getItem("a_envoyer") || "[]"); } catch (e) { return []; } }
function memoriser(cle, liste) { try { localStorage.setItem(cle, JSON.stringify(liste)); } catch (e) { /* stockage indisponible */ } }

async function partager(d) {
  const e = d.especes[0];
  if (!casePartage.checked || !d.oiseau_entendu || e.proba < 0.5) return;
  let pos;
  try { pos = await position(); } catch (err) { toast("Position indisponible : gardé seulement dans ton carnet."); return; }
  // arrondi à 0,01° (environ 1 km) avant tout envoi
  const o = { sci: e.sci, certitude: Math.round(e.proba * 100) / 100,
              lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
  const heure = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  memoriser("mes_partages", [{ ...o, heure }, ...mesPartages()].slice(0, 200));
  try { await envoyer(o); toast(`${e.fr} ajouté à la carte.`); }
  catch (err) { memoriser("a_envoyer", [...enAttente(), o]); toast("Hors ligne : ce sera envoyé plus tard."); }
}

// renvoie ce qui n'a pas pu partir (hors ligne)
async function viderAttente() {
  const liste = enAttente();
  if (!liste.length || !navigator.onLine) return;
  const restants = [];
  for (const o of liste) { try { await envoyer(o); } catch (err) { restants.push(o); } }
  memoriser("a_envoyer", restants);
}
window.addEventListener("online", viderAttente);
viderAttente();
