// Carte des observations partagées : regroupées en cercles (plus il y a d'écoutes, plus le
// cercle est grand), filtrables par espèce, avec les espèces les plus entendues à l'écran.
const $ = (id) => document.getElementById(id);
let carte = null, couche = null, observations = [], nomFr = (sci) => sci;

function chargerLeaflet() {
  if (window.L) return Promise.resolve();
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css";
  document.head.append(css);
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "vendor/leaflet/leaflet.js"; s.onload = ok; s.onerror = ko;
    document.head.append(s);
  });
}

// Mes partages gardés sur le téléphone (visibles tout de suite, avant la mise à jour du serveur)
export function mesPartages() {
  try { return JSON.parse(localStorage.getItem("mes_partages") || "[]"); } catch (e) { return []; }
}

async function chargerObservations() {
  let serveur = [];
  try {
    const r = await fetch("api/observations");
    if (r.ok) serveur = (await r.json()).observations;
  } catch (e) { /* hors ligne : on montre au moins les miennes */ }
  const cle = (o) => `${o[0]}|${o[1].toFixed(2)}|${o[2].toFixed(2)}|${o[3]}`;
  const connues = new Set(serveur.map(cle));
  const miennes = mesPartages().map((o) => [o.sci, o.lat, o.lon, o.heure, o.certitude]).filter((o) => !connues.has(cle(o)));
  return serveur.concat(miennes);
}

function filtre() {
  const choix = $("filtre-espece").value.trim().toLowerCase();
  if (!choix) return observations;
  return observations.filter((o) => nomFr(o[0]).toLowerCase() === choix || o[0].toLowerCase() === choix);
}

function dessiner() {
  if (!carte) return;
  couche.clearLayers();
  const obs = filtre();
  // regroupement par cases de 56 px à l'écran : se recalcule à chaque zoom
  const cases = new Map();
  for (const o of obs) {
    const p = carte.project([o[1], o[2]], carte.getZoom());
    const k = `${Math.floor(p.x / 56)}|${Math.floor(p.y / 56)}`;
    if (!cases.has(k)) cases.set(k, []);
    cases.get(k).push(o);
  }
  for (const groupe of cases.values()) {
    const lat = groupe.reduce((s, o) => s + o[1], 0) / groupe.length;
    const lon = groupe.reduce((s, o) => s + o[2], 0) / groupe.length;
    const parEspece = {};
    for (const o of groupe) parEspece[o[0]] = (parEspece[o[0]] || 0) + 1;
    const classement = Object.entries(parEspece).sort((a, b) => b[1] - a[1]);
    const texte = classement.slice(0, 3).map(([sci, n]) => `${nomFr(sci)} : ${n}`).join("<br>")
      + (classement.length > 3 ? `<br>et ${classement.length - 3} autres espèces` : "");
    L.circleMarker([lat, lon], {
      radius: 7 + 4.5 * Math.sqrt(groupe.length), color: "#F4EEDC", weight: 1.5,
      fillColor: "#F8B946", fillOpacity: 0.78, className: "point-carte",
    }).bindPopup(`<strong>${groupe.length} écoute${groupe.length > 1 ? "s" : ""}</strong><br>${texte}`).addTo(couche);
  }
  classerVisibles(obs);
}

// Les espèces les plus entendues dans la zone affichée
function classerVisibles(obs) {
  const zone = carte.getBounds(), comptes = {};
  for (const o of obs) if (zone.contains([o[1], o[2]])) comptes[o[0]] = (comptes[o[0]] || 0) + 1;
  const ol = $("classement");
  ol.replaceChildren();
  const tri = Object.entries(comptes).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("classement-titre").hidden = tri.length === 0;
  tri.forEach(([sci, n], i) => {
    const li = document.createElement("li");
    li.style.setProperty("--i", i);
    const nom = document.createElement("span"); nom.textContent = nomFr(sci);
    const nb = document.createElement("span"); nb.textContent = `${n} écoute${n > 1 ? "s" : ""}`;
    li.append(nom, nb);
    li.addEventListener("click", () => { $("filtre-espece").value = nomFr(sci); dessiner(); });
    ol.append(li);
  });
  $("carte-vide").hidden = observations.length > 0;
}

export async function ouvrirCarte(traduire) {
  nomFr = traduire;
  await chargerLeaflet();
  if (!carte) {
    carte = L.map("carte", { zoomControl: false, attributionControl: true }).setView([46.6, 2.4], 5);
    L.control.zoom({ position: "bottomright" }).addTo(carte);
    // fond OpenStreetMap, teinté aux couleurs de l'app par un filtre CSS (voir style.css)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">les contributeurs d\'OpenStreetMap</a>',
    }).addTo(carte);
    couche = L.layerGroup().addTo(carte);
    carte.on("zoomend", dessiner);
    carte.on("moveend", () => classerVisibles(filtre()));
    $("filtre-espece").addEventListener("input", dessiner);
  }
  setTimeout(() => carte.invalidateSize(), 50);
  observations = await chargerObservations();
  const liste = $("especes-carte");
  liste.replaceChildren(...[...new Set(observations.map((o) => nomFr(o[0])))].sort().map((n) => new Option(n)));
  dessiner();
}
