// Ouverture : le logo apparaît, s'efface en laissant son oiseau sur la branche, puis l'oiseau
// prend son envol et s'éloigne. Animation dessinée image par image (ouverture/oiseau.webp,
// 20 images), placée pour que l'oiseau parte exactement de sa position dans le logo.
const ecran = document.getElementById("ouverture");

function chargerImage(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}

if (ecran) {
  let finie = false;
  const finir = (delai = 0) => setTimeout(() => {
    if (finie) return;
    finie = true;
    ecran.classList.add("fini");
    setTimeout(() => ecran.remove(), 500);
  }, delai);
  ecran.addEventListener("click", () => finir());
  const secours = setTimeout(() => finir(), 6000);      // si les images n'arrivent pas

  const canvas = document.createElement("canvas");
  ecran.append(canvas);
  const ctx = canvas.getContext("2d");

  Promise.all([
    fetch("ouverture/oiseau.json").then((r) => r.json()),
    chargerImage("ouverture/oiseau.webp"),
    chargerImage("ouverture/logo.webp"),
    document.fonts.load('900 34px "Big Shoulders"').catch(() => {}),
  ]).then(([info, bande, logo]) => {
    clearTimeout(secours);
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingQuality = "high";

    // Logo centré ; k : pixels du logo source -> pixels écran
    const S = Math.min(W * 0.74, 310), cx = W / 2, cy = H * 0.42, k = S / info.cote_logo;
    const gorge0 = [cx - S / 2 + info.gorge_logo[0] * k, cy - S / 2 + info.gorge_logo[1] * k];
    const s0 = info.echelle_logo * k;                       // pixels de l'animation -> écran
    const ref = info.images[0];
    const gorgeCase = [ref.case[0] + ref.gorge[0], ref.case[1] + ref.gorge[1]];

    function dessinerImage(n, gorge, s, alpha = 1) {
      const m = info.images[n];
      ctx.globalAlpha = alpha;
      ctx.drawImage(bande, m.x, 0, m.l, m.h,
        gorge[0] + (m.case[0] - gorgeCase[0]) * s, gorge[1] + (m.case[1] - gorgeCase[1]) * s, m.l * s, m.h * s);
    }
    function dessinerLogo(alpha, echelle) {
      ctx.globalAlpha = alpha;
      const t = S * echelle;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cx - t / 2, cy - t / 2, t, t, t * 0.16);
      ctx.clip();
      ctx.drawImage(logo, cx - t / 2, cy - t / 2, t, t);
      ctx.restore();
    }
    function dessinerNom(alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#F4EEDC";
      ctx.font = '900 34px "Big Shoulders", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("BIRDLISTENER", cx, cy + S / 2 + 56);
    }

    const lisse = (u) => u * u * (3 - 2 * u);
    const borne = (u) => Math.max(0, Math.min(1, u));

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dessinerLogo(1, 1); dessinerNom(1);
      finir(900);
      return;
    }

    // Étapes (ms) : apparition, logo seul, fondu vers l'oiseau, préparation sur la branche, envol
    const APPARITION = 350, FONDU = 950, PREPARATION = 1300, ENVOL = 1700, FIN = 3700;
    let debut = null;
    function image(maintenant) {
      debut ??= maintenant;
      const t = maintenant - debut;
      ctx.clearRect(0, 0, W, H);
      const apparu = lisse(borne(t / APPARITION));
      const fondu = lisse(borne((t - FONDU) / (PREPARATION - FONDU)));
      dessinerNom(apparu * (1 - borne((t - ENVOL) / 300)));
      if (t < PREPARATION) {
        dessinerLogo(apparu * (1 - fondu), 0.97 + 0.03 * apparu);
        if (fondu > 0) dessinerImage(0, gorge0, s0, fondu);
      } else if (t < ENVOL) {
        dessinerImage(Math.min(3, Math.floor((t - PREPARATION) / 100)), gorge0, s0);
      } else {
        // la branche (image 4) s'estompe pendant que l'oiseau s'arrache
        dessinerImage(3, gorge0, s0, 1 - borne((t - ENVOL) / 220));
        // envol progressif : il s'élève en ondulant légèrement et rapetisse en s'éloignant
        const u = borne((t - ENVOL) / (FIN - ENVOL)), e = u ** 1.35;
        const gorge = [gorge0[0] + W * 0.62 * e, gorge0[1] - H * 0.5 * e + Math.sin(u * Math.PI * 3) * 10 * (1 - u)];
        const n = 4 + ((Math.floor((t - ENVOL) / 75)) % 16);
        dessinerImage(n, gorge, s0 * (1 - 0.72 * e));
      }
      if (t >= FIN - 450 && !finie) finir();
      if (ecran.isConnected) requestAnimationFrame(image);      // continue pendant le fondu
    }
    requestAnimationFrame(image);
  }).catch(() => finir());
}
