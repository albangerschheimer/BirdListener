// Ouverture : un martinet traverse l'écran en battant des ailes, se pose au-dessus du nom,
// puis l'écran s'efface. Même dessin et même trajectoire que la maquette Figma.
(function () {
  const ecran = document.getElementById("ouverture");
  if (!ecran) return;
  const oiseau = ecran.querySelector("#martinet");
  const ailes = [ecran.querySelector("#aile-g"), ecran.querySelector("#aile-d")];
  const trace = ecran.querySelector("#trajectoire");

  // Aile gauche ouverte et repliée (même structure : on interpole les nombres) ; l'aile droite est le miroir
  const OUVERTE = [96.5, 43, 86, 36.5, 66, 31, 40, 35, 26, 37.5, 15, 45, 5, 59, 21, 50.5, 42, 49, 66, 52, 80, 53.8, 89, 56, 96, 59.5];
  const REPLIEE = [96.5, 43, 88, 38, 72, 37, 54, 43, 42, 47, 31, 57, 24, 73, 35, 61, 51, 56, 68, 55.5, 81, 55.4, 90, 57, 96, 59.5];
  function aile(m, miroir) {
    const p = OUVERTE.map((v, i) => v + (REPLIEE[i] - v) * m);
    const x = (i) => (miroir ? 200 - p[i] : p[i]).toFixed(2);
    let d = `M${x(0)} ${p[1]}`;
    for (let k = 2; k < p.length; k += 6) d += ` C${x(k)} ${p[k + 1]} ${x(k + 2)} ${p[k + 3]} ${x(k + 4)} ${p[k + 5]}`;
    return d + " Z";
  }

  const P = [[-10, 700], [120, 640], [220, 520], [410, 230]];
  const B = (t) => [0, 1].map((i) => (1 - t) ** 3 * P[0][i] + 3 * (1 - t) ** 2 * t * P[1][i] + 3 * (1 - t) * t * t * P[2][i] + t ** 3 * P[3][i]);
  const D = (t) => [0, 1].map((i) => 3 * (1 - t) ** 2 * (P[1][i] - P[0][i]) + 6 * (1 - t) * t * (P[2][i] - P[1][i]) + 3 * t * t * (P[3][i] - P[2][i]));
  const lisse = (u) => u * u * (3 - 2 * u);
  const POSE = { x: 196.5, y: 330, rot: 0, echelle: 0.75 };

  function placer(x, y, rot, echelle, m) {
    oiseau.setAttribute("transform", `translate(${x} ${y}) rotate(${rot}) scale(${echelle}) translate(-100 -58)`);
    ailes[0].setAttribute("d", aile(m, false));
    ailes[1].setAttribute("d", aile(m, true));
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

  ecran.addEventListener("click", () => finir(0));   // un toucher passe l'ouverture

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    placer(POSE.x, POSE.y, 0, POSE.echelle, 0);
    trace.style.opacity = 0;
    ecran.classList.add("pose");
    finir(900);
    return;
  }

  const VOL = 1100, POSER = 550;
  let debut = null, fin = null;
  function image(maintenant) {
    debut ??= maintenant;
    const e = maintenant - debut;
    const battement = (1 - Math.cos(e / 300 * 2 * Math.PI)) / 2;   // un battement toutes les 0,3 s
    if (e < VOL) {
      const t = 0.05 + 0.7 * (e / VOL);
      const [x, y] = B(t), [dx, dy] = D(t);
      fin = { x, y, rot: Math.atan2(dy, dx) * 180 / Math.PI + 90, echelle: 0.32 + 0.28 * (e / VOL) };
      placer(x, y, fin.rot, fin.echelle, battement);
    } else {
      const u = lisse(Math.min(1, (e - VOL) / POSER));
      const m = battement * (1 - u);                                  // il cesse de battre et plane
      placer(fin.x + (POSE.x - fin.x) * u, fin.y + (POSE.y - fin.y) * u, fin.rot * (1 - u),
             fin.echelle + (POSE.echelle - fin.echelle) * u, m);
      trace.style.opacity = 1 - u;
      if (u >= 1) { ecran.classList.add("pose"); finir(700); return; }
    }
    requestAnimationFrame(image);
  }
  requestAnimationFrame(image);
})();
