// BirdListener dans le navigateur : BirdNET (LiteRT.js, WebAssembly) + classifieur BirdListener.
// Même calcul que src/predicteur.py, sans serveur.
import { loadLiteRt, loadAndCompile, Tensor } from "./vendor/litert.mjs";

const FREQ = 48000;
const TRANCHE = 3 * FREQ;

// ---------- Chargement ----------

function float16VersFloat32(octets) {
  const h = new Uint16Array(octets);
  const f = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const s = (h[i] & 0x8000) ? -1 : 1, e = (h[i] >> 10) & 0x1f, m = h[i] & 0x3ff;
    f[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return f;
}

export async function charger(progression = () => {}) {
  progression("Chargement de la liste des espèces…");
  const meta = await (await fetch("modele/meta.json")).json();
  const frequences = await (await fetch("modele/frequences.json")).json();
  const tous = float16VersFloat32(await (await fetch("modele/classifieur.bin")).arrayBuffer());
  const poids = {};
  for (const [cle, p] of Object.entries(meta.poids)) poids[cle] = tous.subarray(p.debut, p.debut + p.taille);
  progression("Chargement de l'oreille BirdNET (50 Mo la première fois)…");
  await loadLiteRt("vendor/litert/");
  const birdnet = await loadAndCompile("modele/birdnet.tflite", { accelerator: "wasm" });
  return { meta, frequences, poids, birdnet, n: meta.especes.length };
}

// ---------- Audio ----------

// Décode n'importe quel son lisible par le navigateur, en mono 48 kHz
export async function versSignal(tampon) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const audio = await new Promise((ok, ko) => ctx.decodeAudioData(tampon, ok, ko));
  ctx.close();
  const hors = new OfflineAudioContext(1, Math.ceil(audio.duration * FREQ), FREQ);
  const src = hors.createBufferSource();
  src.buffer = audio; src.connect(hors.destination); src.start();
  return (await hors.startRendering()).getChannelData(0);
}

function tranches(signal) {
  // Comme Oreille.tranches : tranches complètes de 3 s (une seule, complétée de silence, si le son est court)
  const n = signal.length < TRANCHE ? 1 : Math.floor((signal.length - TRANCHE) / TRANCHE) + 1;
  const res = [];
  for (let k = 0; k < n; k++) {
    const t = new Float32Array(TRANCHE);
    t.set(signal.subarray(k * TRANCHE, Math.min(signal.length, (k + 1) * TRANCHE)));
    res.push(t);
  }
  return res;
}

// ---------- Classifieur (LayerNorm → Linéaire → GELU → têtes espèces et chant) ----------

function erf(x) {   // approximation d'Abramowitz et Stegun, erreur < 1,5e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

function lineaire(x, W, b, nSortie, nEntree) {
  const y = new Float32Array(nSortie);
  for (let i = 0; i < nSortie; i++) {
    let s = b[i];
    const ligne = i * nEntree;
    for (let j = 0; j < nEntree; j++) s += W[ligne + j] * x[j];
    y[i] = s;
  }
  return y;
}

function classifieur(m, emb) {
  const P = m.poids, D = 1024;
  let moy = 0, v = 0;
  for (let j = 0; j < D; j++) moy += emb[j];
  moy /= D;
  for (let j = 0; j < D; j++) v += (emb[j] - moy) ** 2;
  const et = Math.sqrt(v / D + 1e-5);
  const x = new Float32Array(D);
  for (let j = 0; j < D; j++) x[j] = (emb[j] - moy) / et * P["tronc.0.weight"][j] + P["tronc.0.bias"][j];
  const h = lineaire(x, P["tronc.1.weight"], P["tronc.1.bias"], D, D);
  for (let j = 0; j < D; j++) h[j] = 0.5 * h[j] * (1 + erf(h[j] / Math.SQRT2));
  return {
    especes: lineaire(h, P["especes.weight"], P["especes.bias"], m.n, D),
    chant: lineaire(h, P["chant.weight"], P["chant.bias"], 1, D)[0],
  };
}

function softmax(s) {
  let max = -Infinity;
  for (const v of s) max = Math.max(max, v);
  const p = new Float32Array(s.length);
  let somme = 0;
  for (let i = 0; i < s.length; i++) { p[i] = Math.exp(s[i] - max); somme += p[i]; }
  for (let i = 0; i < s.length; i++) p[i] /= somme;
  return p;
}

// ---------- Filtre « où et quand » (comme src/contexte.py) ----------

function aPriori(m, pays, mois, fond = 0.002) {
  const n = m.n;
  let p = new Float32Array(n).fill(1);
  const c = m.frequences.pays[pays];
  if (c) {
    let total = 0;
    for (const v of Object.values(c)) total += v;
    for (let i = 0; i < n; i++) p[i] = (1 - fond) * (c[i] || 0) / total + fond / n;
  }
  if (mois >= 1 && mois <= 12) {
    for (let i = 0; i < n; i++) {
      const prof = m.frequences.mois[i];
      const total = prof.reduce((a, b) => a + b, 0);
      p[i] *= 0.3 + 12 * (prof[mois - 1] + 1) / (total + 12);
    }
  }
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((v) => v / s);
}

// ---------- Prédiction ----------

export async function predire(m, signal, { pays = null, mois = null, top = 5, progression = () => {} } = {}) {
  const T = tranches(signal);
  const scoresTranches = [], birdnet = [];
  let chant = 0;
  for (let k = 0; k < T.length; k++) {
    progression(`J'écoute… ${Math.round(100 * k / T.length)} %`);
    // Sorties : 0 = scores BirdNET (6522), 1 = empreinte (1024)
    const entree = new Tensor(T[k], [1, TRANCHE]);
    const sorties = await m.birdnet.run(entree);
    const lues = [];
    for (const t of sorties) {
      const l = await t.moveTo("wasm");
      lues.push(l.toTypedArray().slice());
      l.delete();
    }
    entree.delete();
    const [bn, emb] = lues;
    const c = classifieur(m, emb);
    scoresTranches.push(c.especes);
    chant += c.chant;
    birdnet.push(bn.map((v) => 1 / (1 + Math.exp(-v))));
    await new Promise((r) => setTimeout(r));   // laisse respirer l'affichage
  }
  const n = m.n, nT = T.length, col = m.meta.colonne_birdnet;

  // Score de l'enregistrement : log-sum-exp des tranches, moins log(nombre de tranches)
  const enr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (const s of scoresTranches) max = Math.max(max, s[i]);
    let somme = 0;
    for (const s of scoresTranches) somme += Math.exp(s[i] - max);
    enr[i] = max + Math.log(somme) - Math.log(nT);
  }
  const pBl = softmax(enr);

  // Avis de BirdNET sur les mêmes espèces (meilleure tranche), et présence d'un oiseau
  const pBn = new Float32Array(n);
  const oiseaux = new Float32Array(nT);
  for (let k = 0; k < nT; k++) {
    for (let j = 0; j < col.length; j++) {
      if (col[j] < 0) continue;
      const v = birdnet[k][j];
      if (v > pBn[col[j]]) pBn[col[j]] = v;
      if (v > oiseaux[k]) oiseaux[k] = v;
    }
  }
  const sBn = pBn.reduce((a, b) => a + b, 0);
  const w = sBn > 0 ? m.meta.poids_birdnet : 0;
  let p = pBl.map((v, i) => (1 - w) * v + (sBn > 0 ? w * pBn[i] / sBn : 0));
  if (pays || mois) {
    const a = aPriori(m, pays, mois);
    p = p.map((v, i) => v * a[i] ** m.meta.beta_contexte);
    const s = p.reduce((x, y) => x + y, 0);
    p = p.map((v) => v / s);
  }

  const ordre = Array.from(p.keys()).sort((a, b) => p[b] - p[a]).slice(0, top);
  const fiche = (i, proba) => ({ ...m.meta.especes[i], i, proba });
  const frise = scoresTranches.map((s, k) => {
    const q = softmax(s);
    let best = 0;
    for (let i = 1; i < n; i++) if (q[i] > q[best]) best = i;
    return { debut: 3 * k, espece: fiche(best, q[best]), oiseau: oiseaux[k] >= m.meta.seuil_oiseau };
  });
  return {
    especes: ordre.map((i) => fiche(i, p[i])),
    oiseau_entendu: Math.max(...oiseaux) >= m.meta.seuil_oiseau,
    incertain: p[ordre[0]] < m.meta.seuil_incertain,
    chant: 1 / (1 + Math.exp(-chant / nT)),
    duree: Math.round(signal.length / FREQ * 10) / 10,
    frise,
  };
}
