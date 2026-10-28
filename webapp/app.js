import { charger, predire, versSignal } from "./reconnaissance.js";

const etat = document.getElementById("etat");
const resultat = document.getElementById("resultat");
const chargement = document.getElementById("chargement");
const micro = document.getElementById("micro");
const choixPays = document.getElementById("pays");
let modele = null;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

const pret = charger((t) => { chargement.textContent = t; }).then((m) => {
  modele = m;
  chargement.textContent = `Prêt : ${m.n} espèces. Fonctionne aussi hors ligne.`;
  micro.disabled = false;
  // Pays les plus enregistrés d'abord ; France par défaut, choix mémorisé
  const total = (p) => Object.values(m.frequences.pays[p]).reduce((a, b) => a + b, 0);
  const liste = Object.keys(m.frequences.pays).sort((a, b) => total(b) - total(a));
  for (const p of liste) choixPays.add(new Option(p, p));
  let memo = "France";
  try { memo = localStorage.getItem("pays") ?? "France"; } catch (e) { /* stockage indisponible */ }
  choixPays.value = memo === "" || liste.includes(memo) ? memo : "";
  return m;
}).catch((e) => { chargement.textContent = "Impossible de charger le modèle : " + e.message; });

choixPays.addEventListener("change", () => {
  try { localStorage.setItem("pays", choixPays.value); } catch (e) { /* stockage indisponible */ }
});

async function analyser(tampon) {
  resultat.innerHTML = "";
  etat.textContent = "J'écoute…";
  try {
    await pret;
    const signal = await versSignal(tampon);
    const d = await predire(modele, signal, {
      pays: choixPays.value || null,
      mois: document.getElementById("saison").checked ? new Date().getMonth() + 1 : null,
      progression: (t) => { etat.textContent = t; },
    });
    afficher(d);
  } catch (e) {
    etat.textContent = "Impossible d'analyser ce son : " + e.message;
  }
}

function afficher(d) {
  const c = d.chant;
  const type = c > 0.65 ? "plutôt un chant" : c < 0.35 ? "plutôt un cri" : "chant ou cri, difficile à dire";
  etat.textContent = `${d.duree} s analysées`;
  let avis = "";
  if (!d.oiseau_entendu) avis = `<p class="avertissement">Je n'entends pas d'oiseau clairement : rapproche-toi ou enregistre plus longtemps. Voici quand même mes meilleures pistes.</p>`;
  else if (d.incertain) avis = `<p class="avertissement">Je ne suis pas sûr : plusieurs espèces se ressemblent ici.</p>`;
  resultat.innerHTML = `${avis}<p class="type">Type de son : <strong>${type}</strong></p><div class="resultat"></div>`;
  const liste = resultat.querySelector(".resultat");
  for (const e of d.especes) {
    const div = document.createElement("div");
    div.className = "espece";
    const pct = Math.round(e.proba * 100);
    div.innerHTML = `<div class="vide"></div><div><div class="nom"></div><div class="sci"></div>
      <div class="jauge"><div style="width:${pct}%"></div></div><div class="pct">${pct} %</div></div>`;
    div.querySelector(".nom").textContent = e.fr;
    div.querySelector(".sci").textContent = e.famille ? `${e.sci} · ${e.famille}` : e.sci;
    liste.appendChild(div);
    photo(e, div.querySelector(".vide"));
  }
  // Frise : les moments où un oiseau est entendu, regroupés par espèce, avec sa photo
  const moments = [];
  for (const t of d.frise) {
    if (!t.oiseau) continue;
    const dernier = moments[moments.length - 1];
    if (dernier && dernier.espece.sci === t.espece.sci && dernier.fin === t.debut) dernier.fin = t.debut + 3;
    else moments.push({ debut: t.debut, fin: t.debut + 3, espece: t.espece });
  }
  if (moments.length) {
    const titre = document.createElement("h2");
    titre.textContent = "Ce que j'entends, moment par moment";
    const f = document.createElement("div");
    f.className = "frise";
    for (const m of moments) {
      const puce = document.createElement("div");
      puce.className = "moment";
      const place = document.createElement("div");
      place.className = "vide";
      const texte = document.createElement("span");
      texte.textContent = `${m.debut}–${m.fin} s · ${m.espece.fr}`;
      puce.append(place, texte);
      f.appendChild(puce);
      photo(m.espece, place);
    }
    resultat.append(titre, f);
  }
}

function photo(e, place) {
  if (!e.photo) return;
  const img = document.createElement("img");
  img.src = "photos/" + e.photo; img.alt = e.fr; img.loading = "lazy";
  img.title = "Photo : " + (e.credit || "Wikimedia Commons");
  if (e.source) {
    const a = document.createElement("a");
    a.href = e.source; a.target = "_blank"; a.rel = "noopener"; a.className = "lien-photo";
    a.appendChild(img); place.replaceWith(a);
  } else place.replaceWith(img);
}

document.getElementById("fichier").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (f) analyser(await f.arrayBuffer());
});

let enregistreur = null;
micro.addEventListener("click", async () => {
  if (enregistreur) { enregistreur.stop(); return; }
  try {
    const flux = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const morceaux = [];
    enregistreur = new MediaRecorder(flux);
    enregistreur.ondataavailable = (e) => morceaux.push(e.data);
    enregistreur.onstop = async () => {
      flux.getTracks().forEach((t) => t.stop());
      enregistreur = null;
      micro.textContent = "🎙️ Enregistrer"; micro.className = "principal";
      analyser(await new Blob(morceaux).arrayBuffer());
    };
    enregistreur.start();
    micro.textContent = "⏹️ Arrêter et analyser"; micro.className = "enregistre";
    etat.textContent = "Enregistrement… approche-toi de l'oiseau, 5 à 30 s suffisent.";
  } catch (e) {
    etat.textContent = "Micro inaccessible : " + e.message;
  }
});
