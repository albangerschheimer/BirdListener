// Dessins de la huppe : le logo (crête en éventail) et l'oiseau en vol (ouverture).
export const COULEURS = { olive: "#26301C", profond: "#1A2113", alu: "#C9CCC6", rubalise: "#FF5A1F", lichen: "#A7B07E" };
const { profond: P, alu: A, rubalise: O } = COULEURS;

// Plumes de la crête : angle (degrés) et longueur, dans l'ordre d'arrière en avant
export const CRETE = [[-168, 50], [-146, 64], [-124, 74], [-102, 80], [-80, 76], [-58, 64], [-36, 50]];

function plume(angle, longueur, cx, cy) {
  const L = longueur;
  return `<g class="plume" data-angle="${angle}" transform="translate(${cx} ${cy}) rotate(${angle + 90})">
    <path d="M-3.2 0 L-4.2 ${-L + 5} A4.2 4.2 0 0 1 4.2 ${-L + 5} L3.2 0 Z" fill="${O}"/>
    <rect x="-4.1" y="${-L + 13}" width="8.2" height="5" fill="${P}"/>
    <path d="M-4.2 ${-L + 13} L-4.2 ${-L + 5} A4.2 4.2 0 0 1 4.2 ${-L + 5} L4.2 ${-L + 13} Z" fill="${A}"/></g>`;
}

// Logo : tête de huppe de profil, crête déployée. angles : pour animer l'ouverture de la crête.
export function logo(taille = 40, angles = CRETE.map(([a]) => a)) {
  const X = 78, Y = 118;
  return `<svg width="${taille}" height="${taille}" viewBox="0 0 200 200" aria-hidden="true">
    <g class="crete">${CRETE.map(([, L], i) => plume(angles[i], L, X, Y)).join("")}</g>
    <circle cx="${X + 10}" cy="${Y + 14}" r="22" fill="${O}"/>
    <path d="M${X + 28} ${Y + 8} C${X + 58} ${Y + 12} ${X + 84} ${Y + 26} ${X + 106} ${Y + 48} C${X + 80} ${Y + 32} ${X + 56} ${Y + 24} ${X + 29} ${Y + 23} Z" fill="${A}"/>
    <circle cx="${X + 19}" cy="${Y + 9}" r="3.6" fill="${P}"/></svg>`;
}

// Huppe en vol, de profil, tournée vers la droite (repère 200 x 130, épaule en y = 64).
// L'aile est un groupe #aile que l'on écrase verticalement pour le battement.
export function huppeEnVol() {
  const raies = [0, 1, 2, 3, 4].map((k) => `<rect x="${86 + k * 12}" y="-10" width="6" height="90" fill="${A}" transform="rotate(16 ${89 + k * 12} 36)"/>`).join("");
  // en vol, la crête est rabattue vers l'arrière : une seule mèche, extrémité claire
  const crete = `<path d="M136 52 C124 44 110 40 96 40 C94 40 93 43 95 44 C108 47 120 52 131 60 Z" fill="${O}"/>
    <path d="M104 40.6 C101 40.3 98 40.1 96 40 C94 40 93 43 95 44 C98 44.7 101 45.4 104 46.3 Z" fill="${A}"/>
    <path d="M108 41.4 L104 40.6 L104 46.3 L108 47.4 Z" fill="${P}"/>`;
  return `<defs><clipPath id="forme-aile"><path d="M84 66 C74 28 96 2 130 6 C150 9 152 26 140 40 C128 54 114 62 106 68 Z"/></clipPath></defs>
    <path d="M72 61 L28 52 L26 75 L72 72 Z" fill="${P}"/>
    <path d="M44 56 L52 57.6 L52 73.4 L44 73.7 Z" fill="${A}"/>
    ${crete}
    <ellipse cx="100" cy="66" rx="34" ry="13" fill="${O}"/>
    <path d="M146 62 C160 64 172 70 186 82 C170 74 158 70 146 68 Z" fill="${A}"/>
    <circle cx="138" cy="60" r="11" fill="${O}"/><circle cx="142" cy="57" r="2.2" fill="${P}"/>
    <g id="aile"><g clip-path="url(#forme-aile)"><rect x="60" y="0" width="100" height="80" fill="${P}"/>${raies}</g></g>`;
}
