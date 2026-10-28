import { mesPartages, ouvrirCarte } from "./carte.js";
import { charger, predire, versSignal } from "./reconnaissance.js";

const $ = (id) => document.getElementById(id);
const resultat = $("resultat"), micro = $("micro"), choixPays = $("pays"), lecteur = $("lecteur");
const calme = matchMedia("(prefers-reduced-motion: reduce)").matches;
let modele = null, enregistreur = null, minuteur = null, mesure = null, veille = null;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// Crée un élément avec une classe et un texte (jamais de HTML injecté)
function el(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}
function icone(nom) {
  const traces = {
    lecture: '<path d="M8 5.5v13l11-6.5z"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    partage: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.classList.add("icone");
  s.innerHTML = traces[nom];
  return s;
}
const vibrer = () => navigator.vibrate?.(12);
function memoire(cle, defaut) { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch (e) { return defaut; } }
function memoriser(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ } }

// Petit message en bas de l'écran
let minuteurToast = null;
function toast(texte) {
  const t = $("toast");
  t.textContent = texte;
  t.classList.add("visible");
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => t.classList.remove("visible"), 2600);
}

// ---------- Chargement du modèle (l'enregistrement peut commencer avant) ----------
const finOuverture = new Promise((ok) => {
  if (!document.getElementById("ouverture")) return ok();
  addEventListener("ouverture-finie", ok, { once: true });
  setTimeout(ok, 4000);
});
const pret = finOuverture.then(() => charger(() => {})).then((m) => {
  modele = m;
  const total = (p) => Object.values(m.frequences.pays[p]).reduce((a, b) => a + b, 0);
  const liste = Object.keys(m.frequences.pays).sort((a, b) => total(b) - total(a));
  for (const p of liste) choixPays.add(new Option(p, p));
  const memo = memoire("pays", "France");
  choixPays.value = memo === "" || liste.includes(memo) ? memo : "";
  return m;
}).catch(() => toast("Modèle indisponible"));

choixPays.addEventListener("change", () => memoriser("pays", choixPays.value));
const indice = (sci) => modele?.meta.especes.findIndex((x) => x.sci === sci) ?? -1;
const nomFr = (sci) => modele?.meta.especes[indice(sci)]?.fr || sci;

// ---------- États du bouton ----------
const progression = $("micro").querySelector(".progression circle");
const TOUR = 2 * Math.PI * 92;
progression.style.strokeDasharray = TOUR;
function etatBouton(nom, avance = 0) {
  micro.classList.toggle("en-cours", nom === "ecoute");
  micro.classList.toggle("analyse", nom === "analyse");
  $("micro-texte").textContent = nom === "ecoute" ? "Arrêter" : nom === "analyse" ? `${Math.round(avance * 100)} %` : "Écouter";
  progression.style.strokeDashoffset = TOUR * (1 - avance);
  if (nom !== "ecoute") $("chrono").textContent = "";
}

// ---------- Analyse ----------
async function analyser(tampon) {
  etatBouton("analyse", 0);
  try {
    const signal = await versSignal(tampon);
    await pret;
    const d = await predire(modele, signal, {
      pays: choixPays.value || null,
      mois: $("saison").checked ? new Date().getMonth() + 1 : null,
      progression: (a) => etatBouton("analyse", a),
    });
    etatBouton("repos");
    afficher(d);
    noter(d);
    partager(d);
  } catch (e) {
    etatBouton("repos");
    toast("Son illisible");
  }
}

function pourcent(p) { return Math.max(1, Math.round(p * 100)); }

function compter(noeud, cible) {
  if (calme) { noeud.textContent = `${cible} %`; return; }
  const debut = performance.now();
  (function pas(t) {
    const u = Math.min(1, (t - debut) / 700);
    noeud.textContent = `${Math.round(cible * (1 - (1 - u) ** 3))} %`;
    if (u < 1) requestAnimationFrame(pas);
  })(debut);
}

function rond(espece) {
  const r = el("span", "rond");
  if (espece?.photo) r.style.backgroundImage = `url("photos/${encodeURI(espece.photo)}")`;
  return r;
}

// Bouton « Son de référence » : lit un enregistrement xeno-canto de l'espèce
function boutonSon(espece) {
  if (!espece.son) return null;
  const [id, auteur, licence] = espece.son;
  const b = el("button", "action");
  const libelle = el("span", "", "Son");
  b.append(icone("lecture"), libelle);
  b.addEventListener("click", async () => {
    vibrer();
    if (lecteur.dataset.id === id) {                         // même son : pause / reprise
      if (lecteur.paused) lecteur.play().catch(() => {}); else lecteur.pause();
      return;
    }
    // téléchargé en entier puis lu depuis la mémoire : fonctionne aussi sur Safari
    b.classList.add("charge");
    try {
      const r = await fetch(`api/son?id=${id}`);
      if (!r.ok) throw new Error(r.status);
      const url = URL.createObjectURL(await r.blob());
      if (lecteur.src.startsWith("blob:")) URL.revokeObjectURL(lecteur.src);
      lecteur.src = url; lecteur.dataset.id = id;
      await lecteur.play();
    } catch (err) {
      toast("Son indisponible");
    } finally {
      b.classList.remove("charge");
    }
  });
  b.dataset.son = id;
  b.title = `${auteur}, xeno-canto (${licence})`;
  return b;
}

// une seule écoute des événements du lecteur pour mettre à jour tous les boutons « Son »
function majBoutonsSon() {
  for (const b of document.querySelectorAll(".action[data-son]")) {
    const joue = lecteur.dataset.id === b.dataset.son && !lecteur.paused;
    b.replaceChild(icone(joue ? "pause" : "lecture"), b.firstChild);
    b.classList.toggle("joue", joue);
  }
}
for (const ev of ["play", "pause", "ended"]) lecteur.addEventListener(ev, majBoutonsSon);

function boutonPartager(espece, proba) {
  if (!navigator.share) return null;
  const b = el("button", "action");
  b.append(icone("partage"), el("span", "", "Partager"));
  b.addEventListener("click", () => {
    vibrer();
    const texte = proba ? `${espece.fr} (${pourcent(proba)} %) entendu avec BirdListener` : `${espece.fr}, avec BirdListener`;
    navigator.share({ title: espece.fr, text: texte, url: location.origin }).catch(() => {});
  });
  return b;
}

function saison(i) {
  const mois = modele.frequences.mois[i] || [];
  const max = Math.max(...mois);
  if (!(max > 0)) return null;
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
  return grille;
}

// Fiche d'une espèce : après une écoute (d) ou depuis le carnet (sans d)
function construireFiche(e, d) {
  resultat.replaceChildren();
  if (e.photo) {
    const img = el("img", "fiche-photo");
    img.src = "photos/" + e.photo;
    img.alt = e.fr;
    resultat.append(img);
  }
  resultat.append(el("h2", "nom", e.fr), el("p", "latin", e.sci));

  if (d) {
    const verdict = el("p", "verdict");
    const chiffre = el("strong", "", "0 %");
    const type = d.chant > 0.65 ? "Chant" : d.chant < 0.35 ? "Cri" : "Chant ou cri";
    verdict.append(chiffre, el("span", "type", type));
    compter(chiffre, pourcent(e.proba));
    const jauge = el("div", "jauge"), rempli = el("div");
    rempli.style.width = "0%";
    requestAnimationFrame(() => requestAnimationFrame(() => { rempli.style.width = `${pourcent(e.proba)}%`; }));
    jauge.append(rempli);
    resultat.append(verdict, jauge);
    if (!d.oiseau_entendu) resultat.append(el("p", "avis", "Son faible"));
    else if (d.incertain) resultat.append(el("p", "avis", "Incertain"));
  }

  const actions = el("div", "actions");
  for (const b of [boutonSon(e), boutonPartager(e, d && e.proba)]) if (b) actions.append(b);
  if (actions.children.length) resultat.append(actions);

  if (d) {
    const autres = d.especes.slice(1).filter((x) => x.proba >= 0.01);
    if (autres.length) {
      const ul = el("ul", "autres");
      for (const x of autres) {
        const li = el("li");
        li.append(el("span", "", x.fr), el("span", "", `${pourcent(x.proba)} %`));
        li.addEventListener("click", () => { vibrer(); construireFiche({ ...x }, null); });
        ul.append(li);
      }
      resultat.append(el("h3", "", "Aussi possible"), ul);
    }
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
        li.append(rond(m.espece), el("strong", "", m.espece.fr), el("span", "", `${m.debut}–${m.fin} s`));
        ul.append(li);
      }
      resultat.append(el("h3", "", "Moments"), ul);
    }
  }

  const graphe = saison(e.i);
  if (graphe) resultat.append(el("h3", "", "Saison"), graphe);

  if (e.photo || e.son) {
    const credit = el("p", "credit");
    if (e.photo) {
      const lien = el("a", "", "Photo Wikimedia Commons");
      if (e.source) { lien.href = e.source; lien.target = "_blank"; lien.rel = "noopener"; }
      credit.append(lien);
    }
    if (e.son) credit.append(el("span", "", `Son ${e.son[1]}, xeno-canto (${e.son[2]})`));
    resultat.append(credit);
  }
  const encore = el("button", "encore", "Écouter encore");
  encore.addEventListener("click", () => { vibrer(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  resultat.append(encore);

  // apparition échelonnée des éléments de la fiche
  [...resultat.children].forEach((c, i) => c.style.setProperty("--i", i));
  resultat.classList.remove("apparait");
  resultat.hidden = false;
  void resultat.offsetWidth;
  resultat.classList.add("apparait");
  resultat.scrollIntoView({ behavior: calme ? "auto" : "smooth", block: "start" });
}

function afficher(d) { construireFiche(d.especes[0], d); }

// ---------- Carnet des dernières écoutes (gardé sur le téléphone) ----------
function noter(d) {
  if (!d.oiseau_entendu) return;
  const e = d.especes[0];
  memoriser("carnet", [{ sci: e.sci, fr: e.fr, photo: e.photo, proba: e.proba, date: new Date().toISOString() }, ...memoire("carnet", [])].slice(0, 30));
  montrerCarnet();
}

function quand(iso) {
  const d = new Date(iso), maintenant = new Date();
  const heure = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(maintenant) - jour(d)) / 86400000);
  if (ecart === 0) return heure;
  if (ecart === 1) return `hier, ${heure}`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function montrerCarnet() {
  const carnet = memoire("carnet", []);
  $("carnet").hidden = carnet.length === 0;
  const ol = $("historique");
  ol.replaceChildren();
  for (const x of carnet.slice(0, 8)) {
    const li = el("li"), texte = el("div");
    texte.append(el("strong", "", x.fr), el("span", "", quand(x.date)));
    li.append(rond(x), texte, el("b", "", `${pourcent(x.proba)} %`));
    li.addEventListener("click", async () => {
      vibrer();
      await pret;
      const i = indice(x.sci);
      if (i >= 0) construireFiche({ ...modele.meta.especes[i], i }, null);
    });
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
  vibrer();
  if (micro.classList.contains("analyse")) return;
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
      veille?.release().catch(() => {}); veille = null;
      flux.getTracks().forEach((t) => t.stop());
      enregistreur = null;
      analyser(await new Blob(morceaux).arrayBuffer());
    };
    enregistreur.start();
    lecteur.pause();
    try { mesure = suivreNiveaux(flux); } catch (err) { mesure = null; }
    try { veille = await navigator.wakeLock?.request("screen"); } catch (err) { veille = null; }   // écran allumé
    const debut = Date.now();
    etatBouton("ecoute");
    minuteur = setInterval(() => {
      const s = Math.floor((Date.now() - debut) / 1000);
      $("chrono").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= DUREE_MAX) arreter();
    }, 250);
  } catch (e) {
    toast("Micro inaccessible");
  }
});

// ---------- Onglets Écouter / Carte ----------
for (const bouton of document.querySelectorAll(".onglet")) {
  bouton.addEventListener("click", async () => {
    vibrer();
    for (const b of document.querySelectorAll(".onglet")) b.classList.toggle("actif", b === bouton);
    for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== bouton.dataset.vue;
    window.scrollTo({ top: 0 });
    if (bouton.dataset.vue === "vue-carte") {
      await pret;
      ouvrirCarte(nomFr, toast).catch(() => toast("Carte indisponible"));
    }
  });
}

// ---------- Partage des observations sur la carte commune ----------
const casePartage = $("partage");
casePartage.checked = memoire("partage", false) === true;
casePartage.addEventListener("change", () => {
  memoriser("partage", casePartage.checked);
  if (casePartage.checked) navigator.geolocation?.getCurrentPosition(() => {}, () => toast("Position refusée"));
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

async function partager(d) {
  const e = d.especes[0];
  if (!casePartage.checked || !d.oiseau_entendu || e.proba < 0.5) return;
  let pos;
  try { pos = await position(); } catch (err) { toast("Position indisponible"); return; }
  // arrondi à 0,01° (environ 1 km) avant tout envoi
  const o = { sci: e.sci, certitude: Math.round(e.proba * 100) / 100,
              lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
  const heure = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  memoriser("mes_partages", [{ ...o, heure }, ...mesPartages()].slice(0, 200));
  try { await envoyer(o); toast("Ajouté à la carte"); }
  catch (err) { memoriser("a_envoyer", [...memoire("a_envoyer", []), o]); toast("Envoi en attente"); }
}

// renvoie ce qui n'a pas pu partir (hors ligne)
async function viderAttente() {
  const liste = memoire("a_envoyer", []);
  if (!liste.length || !navigator.onLine) return;
  const restants = [];
  for (const o of liste) { try { await envoyer(o); } catch (err) { restants.push(o); } }
  memoriser("a_envoyer", restants);
}
window.addEventListener("online", viderAttente);
viderAttente();
