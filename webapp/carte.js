// Carte des observations partagées : regroupées en cercles (plus il y a d'écoutes, plus le
// cercle est grand), filtres par espèce, période et « les miennes », recentrage sur ma
// position et espèces entendues autour de moi.
const $ = (id) => document.getElementById(id);
let carte = null, couche = null, moi = null, maPosition = null, observations = [];
let nomFr = (sci) => sci, toast = () => {}, periode = 0, seulementMiennes = false;
const RAYON_AUTOUR = 10;   // km

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
const cle = (o) => `${o[0]}|${o[1].toFixed(2)}|${o[2].toFixed(2)}|${o[3]}`;

async function chargerObservations() {
  let serveur = [];
  try {
    const r = await fetch("api/observations");
    if (r.ok) serveur = (await r.json()).observations;
  } catch (e) { /* hors ligne : on montre au moins les miennes */ }
  const connues = new Set(serveur.map(cle));
  const miennes = mesPartages().map((o) => [o.sci, o.lat, o.lon, o.heure, o.certitude]).filter((o) => !connues.has(cle(o)));
  return serveur.concat(miennes);
}

// heure « AAAAMMJJHH » -> âge en jours
function age(heure) {
  const d = Date.UTC(+heure.slice(0, 4), +heure.slice(4, 6) - 1, +heure.slice(6, 8), +heure.slice(8, 10));
  return (Date.now() - d) / 86400000;
}

function filtre() {
  const choix = $("filtre-espece").value.trim().toLowerCase();
  const miennes = seulementMiennes ? new Set(mesPartages().map((o) => cle([o.sci, o.lat, o.lon, o.heure]))) : null;
  return observations.filter((o) =>
    (!choix || nomFr(o[0]).toLowerCase() === choix || o[0].toLowerCase() === choix)
    && (!periode || age(o[3]) <= periode)
    && (!miennes || miennes.has(cle(o))));
}

function dessiner() {
  if (!carte) return;
  couche.clearLayers();
  const obs = filtre();
  $("effacer-filtre").hidden = !$("filtre-espece").value;
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
    const lignes = classement.slice(0, 5).map(([sci, n]) => `<a href="#" data-sci="${sci}">${nomFr(sci)}</a> ${n}`).join("<br>")
      + (classement.length > 5 ? `<br>+ ${classement.length - 5}` : "");
    const point = L.circleMarker([lat, lon], {
      radius: 7 + 4.5 * Math.sqrt(groupe.length), color: "#F4EEDC", weight: 1.5,
      fillColor: "#F8B946", fillOpacity: 0.78, className: "point-carte",
    }).bindPopup(`<strong>${groupe.length}</strong><br>${lignes}`);
    // un groupe étalé : on zoome dessus ; un point précis : on ouvre la bulle
    point.on("click", (ev) => {
      const zone = L.latLngBounds(groupe.map((o) => [o[1], o[2]]));
      if (groupe.length > 1 && carte.getZoom() < 13 && zone.getNorthEast().distanceTo(zone.getSouthWest()) > 500) {
        point.closePopup();
        carte.flyToBounds(zone.pad(0.4), { maxZoom: 13, duration: 0.6 });
      }
      L.DomEvent.stopPropagation(ev);
    });
    point.addTo(couche);
  }
  classer($("classement"), $("classement-titre"), obs.filter((o) => carte.getBounds().contains([o[1], o[2]])));
  autourDeMoi(obs);
}

function classer(ol, titre, obs) {
  const comptes = {};
  for (const o of obs) comptes[o[0]] = (comptes[o[0]] || 0) + 1;
  const tri = Object.entries(comptes).sort((a, b) => b[1] - a[1]).slice(0, 8);
  titre.hidden = tri.length === 0;
  ol.replaceChildren();
  tri.forEach(([sci, n], i) => {
    const li = document.createElement("li");
    li.style.setProperty("--i", i);
    const nom = document.createElement("span"); nom.textContent = nomFr(sci);
    const nb = document.createElement("span"); nb.textContent = String(n);
    li.append(nom, nb);
    li.addEventListener("click", () => { $("filtre-espece").value = nomFr(sci); dessiner(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    ol.append(li);
  });
}

function autourDeMoi(obs) {
  if (!maPosition) { $("autour-titre").hidden = true; $("autour").replaceChildren(); return; }
  const ici = L.latLng(maPosition);
  classer($("autour"), $("autour-titre"), obs.filter((o) => ici.distanceTo([o[1], o[2]]) <= RAYON_AUTOUR * 1000));
}

// Me localiser : recentre la carte et affiche ma position
function localiser(silencieux = false) {
  if (!navigator.geolocation) { if (!silencieux) toast("Position indisponible"); return; }
  $("bouton-moi")?.classList.add("cherche");
  navigator.geolocation.getCurrentPosition((p) => {
    $("bouton-moi")?.classList.remove("cherche");
    maPosition = [p.coords.latitude, p.coords.longitude];
    if (!moi) {
      moi = L.marker(maPosition, { icon: L.divIcon({ className: "moi", html: "<i></i>", iconSize: [22, 22] }), interactive: false, zIndexOffset: 1000 }).addTo(carte);
    } else moi.setLatLng(maPosition);
    carte.flyTo(maPosition, Math.max(carte.getZoom(), 12), { duration: silencieux ? 0 : 0.8 });
    dessiner();
  }, () => {
    $("bouton-moi")?.classList.remove("cherche");
    if (!silencieux) toast("Position refusée");
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

function controleMoi() {
  const Ctrl = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create("button", "bouton-moi");
      b.id = "bouton-moi"; b.type = "button"; b.setAttribute("aria-label", "Me localiser");
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => { navigator.vibrate?.(12); localiser(); });
      return b;
    },
  });
  return new Ctrl({ position: "topright" });
}

let filtresPrets = false;
function brancherFiltres() {
  if (filtresPrets) return;
  filtresPrets = true;
  $("filtre-espece").addEventListener("input", dessiner);
  $("effacer-filtre").addEventListener("click", () => { $("filtre-espece").value = ""; dessiner(); });
  for (const p of document.querySelectorAll(".puce[data-periode]")) {
    p.addEventListener("click", () => {
      navigator.vibrate?.(12);
      periode = Number(p.dataset.periode);
      for (const q of document.querySelectorAll(".puce[data-periode]")) q.classList.toggle("actif", q === p);
      dessiner();
    });
  }
  $("miennes").addEventListener("click", () => {
    navigator.vibrate?.(12);
    seulementMiennes = !seulementMiennes;
    $("miennes").classList.toggle("actif", seulementMiennes);
    $("miennes").setAttribute("aria-pressed", String(seulementMiennes));
    dessiner();
  });
  // un nom d'espèce dans une bulle : filtre la carte sur cette espèce
  $("carte").addEventListener("click", (ev) => {
    const a = ev.target.closest("a[data-sci]");
    if (!a) return;
    ev.preventDefault();
    $("filtre-espece").value = nomFr(a.dataset.sci);
    carte.closePopup();
    dessiner();
  });
}

export async function ouvrirCarte(traduire, afficherMessage) {
  nomFr = traduire;
  toast = afficherMessage || toast;
  await chargerLeaflet();
  if (!carte) {
    carte = L.map("carte", { zoomControl: false, attributionControl: true }).setView([46.6, 2.4], 5);
    L.control.zoom({ position: "bottomright" }).addTo(carte);
    controleMoi().addTo(carte);
    // fond OpenStreetMap, teinté aux couleurs de l'app par un filtre CSS (voir style.css)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(carte);
    couche = L.layerGroup().addTo(carte);
    carte.on("zoomend", dessiner);
    carte.on("moveend", () => classer($("classement"), $("classement-titre"), filtre().filter((o) => carte.getBounds().contains([o[1], o[2]]))));
    brancherFiltres();
    // si la position est déjà autorisée, on centre directement sur moi
    navigator.permissions?.query({ name: "geolocation" }).then((p) => { if (p.state === "granted") localiser(true); }).catch(() => {});
  }
  setTimeout(() => carte.invalidateSize(), 50);
  observations = await chargerObservations();
  const liste = $("especes-carte");
  liste.replaceChildren(...[...new Set(observations.map((o) => nomFr(o[0])))].sort().map((n) => new Option(n)));
  dessiner();
}
