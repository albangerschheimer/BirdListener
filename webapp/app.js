import { mesPartages, ouvrirCarte } from "./carte.js";
import { charger, predire, predireTranche, versSignal, FREQUENCE } from "./reconnaissance.js";

const $ = (id) => document.getElementById(id);
const resultat = $("resultat"), micro = $("micro"), choixPays = $("pays"), lecteur = $("lecteur");
const panneau = $("panneau"), fichePanneau = $("fiche-panneau");
const calme = matchMedia("(prefers-reduced-motion: reduce)").matches;
let modele = null, minuteur = null, veille = null;

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
    carte: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4" fill="var(--creme)"/>',
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
  else if (espece?.fr) { r.classList.add("initiale"); r.textContent = espece.fr[0]; }   // photo pas encore trouvée
  return r;
}

// Chant de référence (xeno-canto) : téléchargé en entier puis lu depuis la mémoire, ce qui marche aussi sur Safari
async function jouerSon(id, bouton) {
  if (lecteur.dataset.id === id) {                         // même son : pause / reprise
    if (lecteur.paused) lecteur.play().catch(() => {}); else lecteur.pause();
    return;
  }
  bouton.classList.add("charge");
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
    bouton.classList.remove("charge");
  }
}

function boutonSon(espece) {
  if (!espece.son) return null;
  const [id, auteur, licence] = espece.son;
  const b = el("button", "action");
  b.append(icone("lecture"), el("span", "", "Son"));
  b.addEventListener("click", () => { vibrer(); jouerSon(id, b); });
  b.dataset.son = id;
  b.title = `${auteur}, xeno-canto (${licence})`;
  return b;
}

// petit bouton rond de lecture, pour les listes
function miniSon(espece) {
  if (!espece.son) return null;
  const b = el("button", "mini-son");
  b.append(icone("lecture"));
  b.dataset.son = espece.son[0];
  b.setAttribute("aria-label", `Écouter : ${espece.fr}`);
  b.addEventListener("click", (ev) => { ev.stopPropagation(); vibrer(); jouerSon(espece.son[0], b); });
  return b;
}

// une seule écoute des événements du lecteur pour mettre à jour tous les boutons « Son »
function majBoutonsSon() {
  for (const b of document.querySelectorAll("[data-son]")) {
    const joue = lecteur.dataset.id === b.dataset.son && !lecteur.paused;
    b.replaceChild(icone(joue ? "pause" : "lecture"), b.firstChild);
    b.classList.toggle("joue", joue);
  }
}
for (const ev of ["play", "pause", "ended"]) lecteur.addEventListener(ev, majBoutonsSon);

function boutonPartager(espece, proba, chant) {
  if (!navigator.share) return null;
  const b = el("button", "action");
  b.append(icone("partage"), el("span", "", "Partager"));
  b.addEventListener("click", async () => {
    vibrer();
    const texte = proba ? `${espece.fr} (${pourcent(proba)} %) entendu avec BirdListener` : `${espece.fr}, avec BirdListener`;
    b.classList.add("charge");
    let fichier = null;
    try { fichier = new File([await imagePartage(espece, proba, chant)], `${espece.fr}.png`, { type: "image/png" }); } catch (err) { fichier = null; }
    b.classList.remove("charge");
    const avecImage = fichier && navigator.canShare?.({ files: [fichier] });
    navigator.share(avecImage ? { files: [fichier], title: espece.fr, text: texte } : { title: espece.fr, text: texte, url: location.origin }).catch(() => {});
  });
  return b;
}

// Image à partager (1080 × 1350) : photo, nom, certitude, date, aux couleurs de l'app
async function imagePartage(e, proba, chant) {
  const L = 1080, H = 1350, toile = document.createElement("canvas");
  toile.width = L; toile.height = H;
  const c = toile.getContext("2d");
  await document.fonts.load('900 100px "Big Shoulders"').catch(() => {});
  const charger = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  const [photo, logo] = await Promise.all([e.photo ? charger("photos/" + encodeURI(e.photo)) : null, charger("icone-192.png")]);
  c.fillStyle = "#172D23"; c.fillRect(0, 0, L, H);
  const hautPhoto = 640;
  if (photo) {
    const r = Math.max(L / photo.width, hautPhoto / photo.height), w = photo.width * r, h = photo.height * r;
    c.save(); c.beginPath(); c.rect(0, 0, L, hautPhoto); c.clip();
    c.drawImage(photo, (L - w) / 2, (hautPhoto - h) / 2, w, h);
    c.restore();
    const fondu = c.createLinearGradient(0, hautPhoto - 260, 0, hautPhoto);
    fondu.addColorStop(0, "rgba(23,45,35,0)"); fondu.addColorStop(1, "#172D23");
    c.fillStyle = fondu; c.fillRect(0, hautPhoto - 260, L, 260);
  }
  // nom : la plus grande taille qui tient en trois lignes
  const marge = 72, largeur = L - 2 * marge, nom = e.fr.toUpperCase();
  let taille = 140, lignes;
  for (; taille > 60; taille -= 6) {
    c.font = `900 ${taille}px "Big Shoulders", sans-serif`;
    lignes = [];
    let ligne = "";
    for (const mot of nom.split(" ")) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (c.measureText(essai).width <= largeur || !ligne) ligne = essai; else { lignes.push(ligne); ligne = mot; }
    }
    lignes.push(ligne);
    if (lignes.length <= 3 && lignes.every((l) => c.measureText(l).width <= largeur)) break;
  }
  let y = photo ? hautPhoto - 40 : 300;
  c.fillStyle = "#F4EEDC"; c.textBaseline = "alphabetic";
  for (const l of lignes) { y += taille * 0.92; c.fillText(l, marge, y); }
  c.font = 'italic 500 40px "Big Shoulders", sans-serif'; c.fillStyle = "#9DB477";
  y += 64; c.fillText(e.sci, marge, y);
  if (proba) {
    y += 130;
    c.font = '900 120px "Big Shoulders", sans-serif'; c.fillStyle = "#F8B946";
    const pct = `${pourcent(proba)} %`, largeurPct = c.measureText(pct).width;
    c.fillText(pct, marge, y);
    if (chant !== undefined) {
      c.font = '800 44px "Big Shoulders", sans-serif';
      c.fillText((chant > 0.65 ? "Chant" : chant < 0.35 ? "Cri" : "Chant ou cri").toUpperCase(), marge + largeurPct + 28, y);
    }
  }
  // pied : logo, nom de l'app, date
  if (logo) c.drawImage(logo, marge, H - 72 - 84, 84, 84);
  c.fillStyle = "#F4EEDC"; c.font = '900 46px "Big Shoulders", sans-serif';
  c.fillText("BIRDLISTENER", marge + 108, H - 72 - 30);
  c.textAlign = "right"; c.fillStyle = "#9DB477"; c.font = '600 36px "Big Shoulders", sans-serif';
  c.fillText(new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), L - marge, H - 72 - 30);
  return new Promise((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error("image"))), "image/png"));
}

// Bouton « Carte » : montre où l'espèce a été entendue par les autres
function boutonCarte(espece) {
  const b = el("button", "action");
  b.append(icone("carte"), el("span", "", "Carte"));
  b.addEventListener("click", () => { vibrer(); allerA("vue-carte", espece.fr); });
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
  const cible = d ? resultat : fichePanneau;   // une écoute s'affiche dans la page, le reste dans le panneau
  cible.replaceChildren();
  const titre = el("div", e.photo ? "heros" : "heros sans-photo");
  if (e.photo) {
    const img = el("img", "fiche-photo");
    img.src = "photos/" + e.photo;
    img.alt = e.fr;
    titre.append(img);
  }
  const noms = el("div", "heros-texte");
  noms.append(el("h2", "nom", e.fr), el("p", "latin", e.sci));
  if (e.famille) noms.append(el("p", "famille", e.famille));
  titre.append(noms);
  cible.append(titre);

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
    cible.append(verdict, jauge);
    if (!d.oiseau_entendu) cible.append(el("p", "avis", "Son faible"));
    else if (d.incertain) cible.append(el("p", "avis", "Incertain"));
  }

  const actions = el("div", "actions");
  for (const b of [boutonSon(e), boutonCarte(e), boutonPartager(e, d && e.proba, d?.chant)]) if (b) actions.append(b);
  if (actions.children.length) cible.append(actions);

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
      cible.append(el("h3", "", "Aussi possible"), ul);
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
      cible.append(el("h3", "", "Moments"), ul);
    }
  }

  const graphe = saison(e.i);
  if (graphe) cible.append(el("h3", "", "Saison"), graphe);

  if (e.photo || e.son) {
    const credit = el("p", "credit");
    if (e.photo) {
      const lien = el("a", "", "Photo Wikimedia Commons");
      if (e.source) { lien.href = e.source; lien.target = "_blank"; lien.rel = "noopener"; }
      credit.append(lien);
    }
    if (e.son) credit.append(el("span", "", `Son ${e.son[1]}, xeno-canto (${e.son[2]})`));
    cible.append(credit);
  }
  if (d) {
    const encore = el("button", "encore", "Écouter encore");
    encore.addEventListener("click", () => { vibrer(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    cible.append(encore);
  }

  // apparition échelonnée des éléments de la fiche
  [...cible.children].forEach((c, i) => c.style.setProperty("--i", i));
  cible.classList.remove("apparait");
  cible.hidden = false;
  void cible.offsetWidth;
  cible.classList.add("apparait");
  if (d) resultat.scrollIntoView({ behavior: calme ? "auto" : "smooth", block: "start" });
  else ouvrirPanneau();
}

// ---------- Panneau des fiches (glisse du bas, se ferme par ×, Échap ou en tirant vers le bas) ----------
function ouvrirPanneau() {
  panneau.scrollTop = 0;
  if (!panneau.hidden) return;
  panneau.hidden = false;
  panneau.classList.remove("ferme");
  panneau.classList.add("ouvert");
  document.body.classList.add("bloque");
}
function fermerPanneau() {
  if (panneau.hidden) return;
  if (jeu) { lecteur.pause(); jeu = null; }
  panneau.classList.replace("ouvert", "ferme");
  document.body.classList.remove("bloque");
  setTimeout(() => { panneau.hidden = true; panneau.classList.remove("ferme"); }, calme ? 0 : 230);
}
$("fermer-panneau").addEventListener("click", () => { vibrer(); fermerPanneau(); });
addEventListener("keydown", (ev) => { if (ev.key === "Escape") fermerPanneau(); });
{
  let depart = null;
  panneau.addEventListener("touchstart", (ev) => { depart = panneau.scrollTop <= 0 ? ev.touches[0].clientY : null; }, { passive: true });
  panneau.addEventListener("touchend", (ev) => {
    if (depart !== null && ev.changedTouches[0].clientY - depart > 110) fermerPanneau();
    depart = null;
  });
}


function afficher(d) { construireFiche(d.especes[0], d); }

// ---------- Carnet des dernières écoutes (gardé sur le téléphone) ----------
function noter(d) {
  if (d.oiseau_entendu && noterEspece(d.especes[0])) toast("Nouvelle espèce");
}

// ajoute au carnet et à la collection ; vrai si l'espèce est nouvelle
function noterEspece(e) {
  const nouvelle = collectionner(e);           // avant le carnet, dont la collection peut partir
  memoriser("carnet", [{ sci: e.sci, fr: e.fr, photo: e.photo, proba: e.proba, date: new Date().toISOString() }, ...memoire("carnet", [])].slice(0, 30));
  montrerCarnet();
  montrerCollection(nouvelle && e.sci);
  return nouvelle;
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

// ---------- Mes espèces : toutes celles déjà entendues, la plus récente en premier ----------
function collection() {
  const col = memoire("collection", null);
  if (col) return col;
  const depuisCarnet = {};                           // première ouverture : on part du carnet
  for (const x of [...memoire("carnet", [])].reverse()) {
    depuisCarnet[x.sci] ??= { fr: x.fr, photo: x.photo, premiere: x.date, fois: 0 };
    depuisCarnet[x.sci].fois += 1;
  }
  return depuisCarnet;
}

function collectionner(e) {
  const col = collection();
  const nouvelle = !col[e.sci];
  col[e.sci] = { ...(col[e.sci] || { premiere: new Date().toISOString(), fois: 0 }), fr: e.fr, photo: e.photo };
  col[e.sci].fois += 1;
  memoriser("collection", col);
  return nouvelle;
}

function montrerCollection(nouvelle) {
  const col = Object.entries(collection()).sort((a, b) => b[1].premiere.localeCompare(a[1].premiere));
  $("collection").hidden = col.length === 0;
  $("nb-especes").textContent = String(col.length);
  $("mes-especes").replaceChildren(...col.map(([sci, x]) => {
    const li = el("li", sci === nouvelle ? "nouvelle" : "");
    li.append(rond(x), el("span", "", x.fr));
    li.addEventListener("click", async () => {
      vibrer();
      await pret;
      const i = indice(sci);
      if (i >= 0) construireFiche({ ...modele.meta.especes[i], i }, null);
    });
    return li;
  }));
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
montrerCollection();

// ---------- Fichier audio ----------
$("fichier").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (f) analyser(await f.arrayBuffer());
  ev.target.value = "";
});

// ---------- Micro ----------
const DUREE_MAX = 60;                 // une écoute simple
const DUREE_MAX_CONTINU = 2 * 3600;   // une balade en écoute continue
const SEUIL_DIRECT = 0.55;            // certitude minimale d'une espèce sur une tranche de 3 s

let continu = memoire("continu", false);
const boutonContinu = $("continu");
function montrerMode() {
  for (const [b, actif] of [[boutonContinu, continu], [$("simple"), !continu]]) {
    b.classList.toggle("actif", actif);
    b.setAttribute("aria-pressed", String(actif));
  }
}
montrerMode();
for (const [b, valeur] of [[boutonContinu, true], [$("simple"), false]]) {
  b.addEventListener("click", () => { vibrer(); continu = valeur; memoriser("continu", continu); montrerMode(); });
}

// Barres de niveau (9 bandes de 1 à 9 kHz) et spectrogramme défilant, tirés du vrai son du micro
const barres = Array.from({ length: 9 }, () => document.createElement("i"));
$("niveaux").append(...barres);
const toile = $("spectre"), pinceau = toile.getContext("2d");
const COULEURS = (() => {
  const reperes = [[0, 0x10, 0x23, 0x1b], [0.35, 0x31, 0x41, 0x45], [0.62, 0x9d, 0xb4, 0x77], [0.85, 0xf8, 0xb9, 0x46], [1, 0xf4, 0xee, 0xdc]];
  const c = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const x = v / 255;
    let k = 0;
    while (k < reperes.length - 2 && x > reperes[k + 1][0]) k++;
    const [x0, ...a] = reperes[k], [x1, ...b] = reperes[k + 1];
    const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    for (let j = 0; j < 3; j++) c[v * 3 + j] = a[j] + (b[j] - a[j]) * t;
  }
  return c;
})();

function creerContexte() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  try { return new Ctx({ sampleRate: FREQUENCE }); } catch (e) { return new Ctx(); }
}

function suivreSon(ctx, source) {
  const analyse = ctx.createAnalyser();
  analyse.fftSize = 1024;
  analyse.smoothingTimeConstant = 0.2;
  source.connect(analyse);
  const db = new Float32Array(analyse.frequencyBinCount), hz = ctx.sampleRate / analyse.fftSize;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  toile.width = Math.round(toile.clientWidth * dpr) || 600; toile.height = Math.round(88 * dpr);
  const L = toile.width, H = toile.height, pas = Math.max(1, Math.round(dpr));
  pinceau.fillStyle = "#10231B"; pinceau.fillRect(0, 0, L, H);
  const colonne = pinceau.createImageData(pas, H);
  // de 400 Hz à 11 kHz sur une échelle logarithmique : les chants occupent la hauteur, le grondement est coupé
  const F_MIN = 400, F_MAX = 11000, ECART = 48, BAS = Math.round(F_MIN / hz), HAUT = Math.round(F_MAX / hz);
  const lignes = Array.from({ length: H }, (_, y) => Math.min(db.length - 1, Math.round(F_MIN * (F_MAX / F_MIN) ** (1 - y / H) / hz)));
  // gain automatique : l'échelle suit le son le plus fort entendu récemment, pour voir aussi les chants lointains
  let plafond = -60;
  const niveau = (v) => Math.min(1, Math.max(0, (v - plafond + ECART) / ECART));
  let actif = true;
  (function tracer() {
    if (!actif) return;
    analyse.getFloatFrequencyData(db);
    let fort = -Infinity;
    for (let i = BAS; i < HAUT; i++) if (db[i] > fort) fort = db[i];
    plafond = Math.max(fort, plafond - 0.12, -80);
    barres.forEach((b, k) => {
      const de = Math.round((1000 + k * 900) / hz), a = Math.round((1900 + k * 900) / hz);
      let max = -Infinity;
      for (let i = de; i < a; i++) max = Math.max(max, db[i]);
      b.style.height = `${8 + Math.round(niveau(max) ** 1.5 * 36)}px`;
    });
    // le spectrogramme glisse vers la gauche ; la nouvelle colonne s'ajoute à droite (aigus en haut)
    pinceau.drawImage(toile, -pas, 0);
    for (let y = 0; y < H; y++) {
      const v = Math.round(255 * niveau(db[lignes[y]]) ** 1.6) * 3;
      for (let x = 0; x < pas; x++) {
        const o = (y * pas + x) * 4;
        colonne.data[o] = COULEURS[v]; colonne.data[o + 1] = COULEURS[v + 1]; colonne.data[o + 2] = COULEURS[v + 2]; colonne.data[o + 3] = 255;
      }
    }
    pinceau.putImageData(colonne, L - pas, 0);
    requestAnimationFrame(tracer);
  })();
  return () => { actif = false; barres.forEach((b) => { b.style.height = "8px"; }); };
}

// ---------- Écoute continue : chaque tranche de 3 s est analysée pendant que l'on marche ----------
function reechantillonner(x, de) {
  if (de === FREQUENCE) return x;
  const n = Math.round(x.length * FREQUENCE / de), y = new Float32Array(n), r = de / FREQUENCE;
  for (let i = 0; i < n; i++) {
    const t = i * r, k = Math.floor(t), f = t - k;
    y[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f;
  }
  return y;
}

async function capter(ctx, source, surTranche) {
  const taille = Math.round(3 * ctx.sampleRate);
  let tranche = new Float32Array(taille), n = 0;
  const recevoir = (paquet) => {
    let i = 0;
    while (i < paquet.length) {
      const k = Math.min(paquet.length - i, taille - n);
      tranche.set(paquet.subarray(i, i + k), n);
      n += k; i += k;
      if (n === taille) { surTranche(reechantillonner(tranche, ctx.sampleRate)); tranche = new Float32Array(taille); n = 0; }
    }
  };
  let noeud;
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    await ctx.audioWorklet.addModule("capteur.js");
    noeud = new AudioWorkletNode(ctx, "capteur");
    noeud.port.onmessage = (e) => recevoir(e.data);
  } else {
    noeud = ctx.createScriptProcessor(4096, 1, 1);
    noeud.onaudioprocess = (e) => recevoir(new Float32Array(e.inputBuffer.getChannelData(0)));
  }
  // relié à une sortie muette : certains navigateurs n'activent un nœud que s'il mène aux haut-parleurs
  const muet = ctx.createGain();
  muet.gain.value = 0;
  source.connect(noeud); noeud.connect(muet); muet.connect(ctx.destination);
}

const direct = $("direct"), listeDirect = $("direct-liste");
let vus = new Map();

function entendu(e) {
  let x = vus.get(e.sci);
  if (!x) {
    x = { espece: e, fois: 0, li: el("li", "nouveau"), heure: el("span"), compte: el("b") };
    vus.set(e.sci, x);
    const texte = el("div");
    texte.append(el("strong", "", e.fr), x.heure);
    x.li.append(rond(e), texte, x.compte);
    x.li.addEventListener("click", () => { vibrer(); construireFiche(x.espece, null); });
    listeDirect.prepend(x.li);
    direct.hidden = false;
    navigator.vibrate?.([20, 60, 20]);
  } else {
    x.li.classList.remove("revu"); void x.li.offsetWidth; x.li.classList.add("revu");
    listeDirect.prepend(x.li);
  }
  x.fois += 1;
  if (e.proba > x.espece.proba) x.espece = e;
  x.heure.textContent = quand(new Date().toISOString());
  x.compte.textContent = String(x.fois);
}

function ecouteContinue(ctx, source) {
  vus = new Map();
  listeDirect.replaceChildren();
  direct.hidden = true;
  resultat.hidden = true;
  const file = [];
  let occupe = false, fini = false;
  async function suivante() {
    if (occupe || !file.length) return;
    occupe = true;
    const t = file.shift();
    try {
      await pret;
      const r = await predireTranche(modele, t, {
        pays: choixPays.value || null,
        mois: $("saison").checked ? new Date().getMonth() + 1 : null,
      });
      if (!fini && r.oiseau && r.espece.proba >= SEUIL_DIRECT) entendu(r.espece);
    } catch (err) { /* tranche illisible : on passe à la suivante */ }
    occupe = false;
    suivante();
  }
  capter(ctx, source, (t) => {
    file.push(t);
    if (file.length > 2) file.shift();       // téléphone lent : on garde le direct
    suivante();
  }).catch(() => toast("Écoute continue indisponible"));
  return () => { fini = true; };
}

async function terminerContinue() {
  const especes = [...vus.values()].map((x) => x.espece);
  if (!especes.length) { toast("Aucun oiseau"); return; }
  let nouvelles = 0;
  for (const e of especes.reverse()) if (noterEspece(e)) nouvelles += 1;
  if (nouvelles) toast(nouvelles === 1 ? "Nouvelle espèce" : `${nouvelles} nouvelles espèces`);
  for (const e of especes) await partagerEspece(e, { silencieux: true });
}

// ---------- Une écoute (simple ou continue) ----------
let fermerEcoute = null;
function arreter() { fermerEcoute?.(); }

micro.addEventListener("click", async () => {
  vibrer();
  if (micro.classList.contains("analyse")) return;
  if (fermerEcoute) { arreter(); return; }
  const ctx = creerContexte();               // créé pendant le toucher : exigé par Safari
  ctx.resume?.().catch(() => {});
  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    ctx.close();
    toast("Micro inaccessible");
    return;
  }
  const source = ctx.createMediaStreamSource(flux);
  const enContinu = continu;
  let enregistreur = null, finContinue = null;
  const morceaux = [];
  if (enContinu) finContinue = ecouteContinue(ctx, source);
  else {
    enregistreur = new MediaRecorder(flux);
    enregistreur.ondataavailable = (e) => morceaux.push(e.data);
    enregistreur.onstop = async () => analyser(await new Blob(morceaux).arrayBuffer());
    enregistreur.start();
  }
  lecteur.pause();
  let arretSon = null;
  try { arretSon = suivreSon(ctx, source); } catch (err) { arretSon = null; }
  try { veille = await navigator.wakeLock?.request("screen"); } catch (err) { veille = null; }   // écran allumé
  const debut = Date.now();
  etatBouton("ecoute");
  $("zone-ecoute").classList.add("en-cours");
  const limite = enContinu ? DUREE_MAX_CONTINU : DUREE_MAX;
  minuteur = setInterval(() => {
    const s = Math.floor((Date.now() - debut) / 1000);
    $("chrono").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s >= limite) arreter();
  }, 250);
  fermerEcoute = () => {
    fermerEcoute = null;
    clearInterval(minuteur);
    arretSon?.();
    veille?.release().catch(() => {}); veille = null;
    $("zone-ecoute").classList.remove("en-cours");
    if (enregistreur && enregistreur.state !== "inactive") enregistreur.stop();
    flux.getTracks().forEach((t) => t.stop());
    setTimeout(() => ctx.close().catch(() => {}), 300);
    if (enContinu) { finContinue(); etatBouton("repos"); terminerContinue(); }
  };
});

// ---------- Onglets Écouter / Carte ----------
async function allerA(vue, espece) {
  fermerPanneau();
  for (const b of document.querySelectorAll(".onglet")) b.classList.toggle("actif", b.dataset.vue === vue);
  for (const v of document.querySelectorAll(".vue")) v.hidden = v.id !== vue;
  window.scrollTo({ top: 0 });
  if (vue === "vue-carte") {
    await pret;
    ouvrirCarte(nomFr, toast, espece).catch(() => toast("Carte indisponible"));
  }
  if (vue === "vue-especes") {
    await pret;
    if (!$("liste-especes").children.length || paysListe !== choixPays.value) montrerEspeces();
  }
}

// ---------- Espèces : le guide, des plus probables ici ce mois-ci, ou de A à Z ----------
let tri = memoire("tri_especes", "mois"), ordre = [], affichees = 0, paysListe = null;
const sansAccents = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function ordreEspeces() {
  const especes = modele.meta.especes;
  const q = sansAccents($("cherche").value.trim());
  let idx = [...especes.keys()];
  if (q) idx = idx.filter((i) => sansAccents(especes[i].fr).includes(q) || especes[i].sci.toLowerCase().includes(q) || sansAccents(especes[i].en || "").includes(q));
  // une recherche fait passer devant les noms qui commencent par le texte tapé
  const devant = (liste) => (q ? liste.sort((a, b) => sansAccents(especes[b].fr).startsWith(q) - sansAccents(especes[a].fr).startsWith(q)) : liste);
  if (tri === "az") return devant(idx.sort((a, b) => especes[a].fr.localeCompare(especes[b].fr, "fr")));
  const rang = new Map(idx.map((i) => [i, presenceCeMois(i)]));
  return devant(idx.sort((a, b) => rang.get(b) - rang.get(a)));
}

// fréquence dans le pays choisi, réduite pour les espèces rarement enregistrées ce mois-ci
// (présence plutôt que pic : un migrant de passage ne doit pas passer devant le merle)
function presenceCeMois(i) {
  const c = modele.frequences.pays[choixPays.value], prof = modele.frequences.mois[i] || [];
  const total = prof.reduce((a, b) => a + b, 0);
  return (c ? c[i] || 0 : 1) * Math.min(1, 24 * ((prof[new Date().getMonth()] || 0) + 1) / (total + 12));
}

// ---------- Jeu : quel est ce chant ? ----------
// Safari ne laisse jouer un son sans toucher qu'après un premier son joué au toucher : on le débloque une fois.
const SILENCE = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
function debloquerSon() {
  removeEventListener("touchend", debloquerSon, true);
  removeEventListener("click", debloquerSon, true);
  if (lecteur.src) return;
  lecteur.src = SILENCE;
  lecteur.play().then(() => lecteur.pause()).catch(() => {});
}
addEventListener("touchend", debloquerSon, true);
addEventListener("click", debloquerSon, true);

let jeu = null;
const melanger = (t) => { for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; } return t; };

function poserQuestion() {
  const especes = modele.meta.especes;
  // les 60 espèces les plus présentes en ce moment, qui ont un chant de référence
  const tas = [...especes.keys()].filter((i) => especes[i].son).sort((a, b) => presenceCeMois(b) - presenceCeMois(a)).slice(0, 60);
  const libres = tas.filter((i) => !jeu.recentes.includes(i));
  const bonne = libres[Math.floor(Math.random() * libres.length)];
  jeu.recentes = [bonne, ...jeu.recentes].slice(0, 15);
  const choix = [bonne];
  const cousines = melanger(tas.filter((i) => i !== bonne && especes[i].famille === especes[bonne].famille));
  if (cousines.length) choix.push(cousines[0]);             // une espèce de la même famille : plus difficile
  for (const i of melanger(tas.slice())) if (choix.length < 4 && !choix.includes(i)) choix.push(i);
  jeu.question = { bonne, choix: melanger(choix), repondu: false };
  dessinerJeu();
  const id = especes[bonne].son[0];
  jouerSon(id, fichePanneau.querySelector(".ecoute-jeu"));
  // le chant de la question suivante se prépare pendant que l'on réfléchit
  const suivante = libres.filter((i) => i !== bonne)[Math.floor(Math.random() * (libres.length - 1))];
  if (suivante !== undefined) jeu.prochaine = suivante;
}

function dessinerJeu() {
  const especes = modele.meta.especes, q = jeu.question;
  fichePanneau.replaceChildren();
  const titre = el("h2", "nom titre-jeu", "Quel est ce chant ?");
  const score = el("div", "score-jeu");
  const serie = el("p"), record = el("p");
  serie.append(el("b", "", String(jeu.serie)), el("span", "", "Série"));
  record.append(el("b", "", String(jeu.record)), el("span", "", "Record"));
  score.append(serie, record);
  const ecoute = el("button", "ecoute-jeu");
  ecoute.dataset.son = especes[q.bonne].son[0];
  ecoute.append(icone("lecture"));
  ecoute.setAttribute("aria-label", "Réécouter");
  ecoute.addEventListener("click", () => { vibrer(); jouerSon(especes[q.bonne].son[0], ecoute); });
  const ul = el("ul", "choix-jeu");
  for (const i of q.choix) {
    const li = el("li"), b = el("button");
    b.append(rond(especes[i]), el("span", "", especes[i].fr));
    b.addEventListener("click", () => repondre(i, b, ul));
    li.append(b);
    ul.append(li);
  }
  fichePanneau.append(titre, score, ecoute, ul);
  [...fichePanneau.children].forEach((c, i) => c.style.setProperty("--i", i));
  fichePanneau.classList.remove("apparait"); void fichePanneau.offsetWidth; fichePanneau.classList.add("apparait");
  majBoutonsSon();
}

function repondre(i, bouton, ul) {
  const q = jeu.question, especes = modele.meta.especes;
  if (q.repondu) return;
  q.repondu = true;
  const juste = i === q.bonne;
  bouton.classList.add(juste ? "juste" : "faux");
  if (!juste) ul.children[q.choix.indexOf(q.bonne)].firstChild.classList.add("juste");
  ul.classList.add("repondu");
  navigator.vibrate?.(juste ? [15, 50, 15] : 60);
  jeu.serie = juste ? jeu.serie + 1 : 0;
  jeu.record = Math.max(jeu.record, jeu.serie);
  memoriser("record_jeu", jeu.record);
  fichePanneau.querySelector(".score-jeu p b").textContent = String(jeu.serie);
  fichePanneau.querySelector(".score-jeu p:last-child b").textContent = String(jeu.record);
  const actions = el("div", "suite-jeu");
  const fiche = el("button", "action", "Fiche");
  fiche.addEventListener("click", () => { vibrer(); lecteur.pause(); jeu = null; construireFiche({ ...especes[q.bonne], i: q.bonne }, null); });
  const suivant = el("button", "encore", "Suivant");
  suivant.addEventListener("click", () => { vibrer(); poserQuestion(); });
  actions.append(fiche, suivant);
  fichePanneau.append(actions);
  actions.scrollIntoView({ behavior: calme ? "auto" : "smooth", block: "nearest" });
  if (jeu.prochaine !== undefined) fetch(`api/son?id=${especes[jeu.prochaine].son[0]}`).catch(() => {});
}

$("jeu").addEventListener("click", async () => {
  vibrer();
  await pret;
  jeu = { serie: 0, record: memoire("record_jeu", 0), recentes: [] };
  ouvrirPanneau();
  poserQuestion();
});

function ligneEspece(i, dejaEntendues) {
  const e = { ...modele.meta.especes[i], i };
  const li = el("li", dejaEntendues[e.sci] ? "vue" : ""), texte = el("div");
  texte.append(el("strong", "", e.fr), el("span", "", e.sci));
  li.append(rond(e), texte);
  const b = miniSon(e);
  if (b) li.append(b);
  li.addEventListener("click", () => { vibrer(); construireFiche(e, null); });
  return li;
}

function plusEspeces() {
  const dejaEntendues = collection();
  $("liste-especes").append(...ordre.slice(affichees, affichees + 40).map((i) => ligneEspece(i, dejaEntendues)));
  affichees = Math.min(ordre.length, affichees + 40);
  majBoutonsSon();
}

function montrerEspeces() {
  paysListe = choixPays.value;
  ordre = ordreEspeces();
  affichees = 0;
  $("liste-especes").replaceChildren();
  plusEspeces();
}

// la liste s'allonge quand on approche du bas
new IntersectionObserver((vus) => {
  if (vus.some((x) => x.isIntersecting) && modele && affichees < ordre.length) plusEspeces();
}, { rootMargin: "800px" }).observe($("fin-especes"));

let attenteRecherche = null;
$("cherche").addEventListener("input", () => { clearTimeout(attenteRecherche); attenteRecherche = setTimeout(() => modele && montrerEspeces(), 120); });
for (const p of document.querySelectorAll(".puce[data-tri]")) {
  p.classList.toggle("actif", p.dataset.tri === tri);
  p.addEventListener("click", () => {
    vibrer();
    tri = p.dataset.tri;
    memoriser("tri_especes", tri);
    for (const q of document.querySelectorAll(".puce[data-tri]")) q.classList.toggle("actif", q === p);
    if (modele) montrerEspeces();
  });
}
for (const bouton of document.querySelectorAll(".onglet")) {
  bouton.addEventListener("click", () => { vibrer(); allerA(bouton.dataset.vue); });
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
  if (d.oiseau_entendu) await partagerEspece(d.especes[0]);
}

async function partagerEspece(e, { silencieux = false } = {}) {
  if (!casePartage.checked || e.proba < 0.5) return;
  let pos;
  try { pos = await position(); } catch (err) { if (!silencieux) toast("Position indisponible"); return; }
  // arrondi à 0,01° (environ 1 km) avant tout envoi
  const o = { sci: e.sci, certitude: Math.round(e.proba * 100) / 100,
              lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
  const heure = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  memoriser("mes_partages", [{ ...o, heure }, ...mesPartages()].slice(0, 200));
  try { await envoyer(o); if (!silencieux) toast("Ajouté à la carte"); }
  catch (err) { memoriser("a_envoyer", [...memoire("a_envoyer", []), o]); if (!silencieux) toast("Envoi en attente"); }
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
