// Observations partagées : POST en ajoute une, GET les renvoie toutes pour la carte.
//
// Stockage : Vercel Blob. Chaque observation est un petit fichier dont le nom contient déjà
// tout ce qu'il faut (espèce, position arrondie, heure, certitude) : la carte se construit
// en listant les noms, sans ouvrir les fichiers.
//   obs/<Genre_espece>/<lat>_<lon>_<AAAAMMJJHH>_<certitude %>-<suffixe>.json
//
// Vie privée : aucune donnée personnelle, position arrondie au centième de degré (~1 km),
// heure arrondie à l'heure. L'arrondi est refait ici, quoi qu'envoie le téléphone.
import { list, put } from "@vercel/blob";

const NOM_LATIN = /^[A-Z][a-z]+ [a-z-]+$/;
const json = (donnees, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(donnees), { status: statut, headers: { "content-type": "application/json", ...entetes } });

export async function POST(requete) {
  let o;
  try { o = await requete.json(); } catch { return json({ erreur: "JSON illisible" }, 400); }
  const lat = Number(o.lat), lon = Number(o.lon), certitude = Number(o.certitude);
  if (typeof o.sci !== "string" || !NOM_LATIN.test(o.sci)) return json({ erreur: "espèce invalide" }, 400);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return json({ erreur: "position invalide" }, 400);
  if (!(certitude >= 0.5 && certitude <= 1)) return json({ erreur: "certitude trop faible" }, 400);

  const heure = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  const chemin = `obs/${o.sci.replace(" ", "_")}/${lat.toFixed(2)}_${lon.toFixed(2)}_${heure}_${Math.round(certitude * 100)}.json`;
  await put(chemin, "{}", { access: "public", addRandomSuffix: true, contentType: "application/json" });
  return json({ ok: true }, 201);
}

export async function GET() {
  const observations = [];
  let cursor;
  for (let page = 0; page < 30; page++) {              // au plus 30 000 observations
    const r = await list({ prefix: "obs/", limit: 1000, cursor });
    for (const b of r.blobs) {
      const m = b.pathname.match(/^obs\/([A-Za-z]+_[a-z-]+)\/(-?\d+\.\d+)_(-?\d+\.\d+)_(\d{10})_(\d+)/);
      if (m) observations.push([m[1].replace("_", " "), Number(m[2]), Number(m[3]), m[4], Number(m[5])]);
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  // mis en cache 30 min par le CDN : chaque lecture du stockage compte dans le quota gratuit
  return json({ observations }, 200, { "cache-control": "public, s-maxage=1800, stale-while-revalidate=86400" });
}
