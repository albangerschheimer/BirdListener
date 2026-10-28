// Ouverture : une huppe traverse l'écran en battant des ailes, se pose, ouvre sa crête,
// puis le nom apparaît et l'écran s'efface. Un toucher passe l'ouverture.
import { CRETE, huppeEnVol, logo } from "./dessins.js";

const ecran = document.getElementById("ouverture");
if (ecran) {
  ecran.innerHTML = `<svg viewBox="0 0 393 852" preserveAspectRatio="xMidYMid slice">
    <g id="oiseau">${huppeEnVol()}</g>
    <g id="pose" opacity="0"></g>
    <text id="nom" x="196.5" y="462" text-anchor="middle" opacity="0">BIRDLISTENER</text>
  </svg>`;
  const oiseau = ecran.querySelector("#oiseau");
  const aile = ecran.querySelector("#aile");
  const pose = ecran.querySelector("#pose");
  const nom = ecran.querySelector("#nom");

  const P = [[-80, 760], [20, 600], [90, 410], [150, 372]];
  const B = (t) => [0, 1].map((i) => (1 - t) ** 3 * P[0][i] + 3 * (1 - t) ** 2 * t * P[1][i] + 3 * (1 - t) * t * t * P[2][i] + t ** 3 * P[3][i]);
  const D = (t) => [0, 1].map((i) => 3 * (1 - t) ** 2 * (P[1][i] - P[0][i]) + 6 * (1 - t) * t * (P[2][i] - P[1][i]) + 3 * t * t * (P[3][i] - P[2][i]));
  const lisse = (u) => u * u * (3 - 2 * u);
  const borne = (u) => Math.max(0, Math.min(1, u));

  // Logo posé au point d'arrivée ; crête repliée vers l'arrière (o = 0) ou ouverte (o = 1), plume par plume
  function poser(o) {
    const angles = CRETE.map(([a], i) => -172 + (a + 172) * lisse(borne(o * 1.6 - i * 0.1)));
    pose.innerHTML = `<g transform="translate(116 262)">${logo(160, angles)}</g>`;
  }

  let finie = false;
  function finir(delai) {
    setTimeout(() => {
      if (finie) return;
      finie = true;
      ecran.classList.add("fini");
      setTimeout(() => ecran.remove(), 600);
    }, delai);
  }
  ecran.addEventListener("click", () => finir(0));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    oiseau.setAttribute("opacity", 0);
    poser(1);
    pose.setAttribute("opacity", 1);
    nom.setAttribute("opacity", 1);
    finir(1000);
  } else {
    const VOL = 1300;
    let debut = null;
    const image = (maintenant) => {
      debut ??= maintenant;
      const e = maintenant - debut;
      const u = Math.min(1, e / VOL);
      const t = lisse(u);
      const [x, y] = B(t), [dx, dy] = D(Math.min(t, 0.97));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      // vol de huppe : battements lents et amples, qui s'amortissent à l'arrivée
      const battement = Math.cos(e / 380 * 2 * Math.PI) * (1 - 0.6 * u);
      aile.setAttribute("transform", `translate(0 64) scale(1 ${battement.toFixed(3)}) translate(0 -64)`);
      oiseau.setAttribute("transform", `translate(${x} ${y}) rotate(${angle * 0.6}) scale(${1.05 - 0.25 * u}) translate(-100 -64)`);
      oiseau.setAttribute("opacity", 1 - borne((e - VOL + 120) / 240));   // fondu vers le logo posé
      const o = borne((e - VOL) / 700);
      poser(o);
      pose.setAttribute("opacity", borne((e - VOL + 120) / 240));
      nom.setAttribute("opacity", borne((e - VOL - 450) / 400));
      if (e < VOL + 900) requestAnimationFrame(image);
      else finir(800);
    };
    requestAnimationFrame(image);
  }
}
