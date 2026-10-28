// Écoute continue : transmet le son brut du micro par paquets de 4096 échantillons.
class Capteur extends AudioWorkletProcessor {
  constructor() {
    super();
    this.paquet = new Float32Array(4096);
    this.n = 0;
  }

  process(entrees) {
    const canal = entrees[0]?.[0];
    if (canal) {
      for (let i = 0; i < canal.length; i++) {
        this.paquet[this.n++] = canal[i];
        if (this.n === this.paquet.length) {
          this.port.postMessage(this.paquet, [this.paquet.buffer]);
          this.paquet = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("capteur", Capteur);
