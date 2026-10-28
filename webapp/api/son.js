// Chant de référence d'une espèce : relaie l'enregistrement xeno-canto depuis notre adresse.
// Les navigateurs refusent de lire directement le fichier de xeno-canto (Chrome : protection
// ORB ; Safari : pas de lecture par morceaux). Seuls les enregistrements choisis pour l'app
// (modele/meta.json) sont relayés, et le CDN les garde en cache.
import meta from "../modele/meta.json" with { type: "json" };

const AUTORISES = new Set(meta.especes.filter((e) => e.son).map((e) => e.son[0]));

export async function GET(requete) {
  const id = new URL(requete.url).searchParams.get("id");
  if (!AUTORISES.has(id)) return new Response("enregistrement inconnu", { status: 404 });
  const r = await fetch(`https://xeno-canto.org/${id}/download`, {
    headers: { "user-agent": "BirdListener (https://birdlistener.vercel.app)" },
  });
  if (!r.ok) return new Response("xeno-canto indisponible", { status: 502 });
  return new Response(r.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "public, max-age=604800, s-maxage=31536000, immutable",
    },
  });
}
