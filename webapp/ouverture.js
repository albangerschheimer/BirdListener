// Ouverture : le rouge-gorge, perché au-dessus du nom, prend son envol (animation dans style.css).
const ecran = document.getElementById("ouverture");

if (ecran) {
  const oiseau = document.createElement("span"), nom = document.createElement("b");
  oiseau.className = "oiseau";
  nom.textContent = "BIRDLISTENER";
  ecran.append(oiseau, nom);
  let finie = false;
  function terminer(instantane) {
    if (finie) return;
    finie = true;
    dispatchEvent(new Event("ouverture-finie"));
    if (instantane) { ecran.remove(); return; }
    ecran.classList.add("fini");
    setTimeout(() => ecran.remove(), 260);
  }
  ecran.addEventListener("pointerdown", () => terminer(true));   // un toucher fait disparaître l'ouverture
  setTimeout(() => terminer(false), matchMedia("(prefers-reduced-motion: reduce)").matches ? 600 : 1900);
}
