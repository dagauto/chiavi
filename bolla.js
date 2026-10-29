// Lettura del testo di una bolla: trova telai (VIN), modello e targa.
// Funzioni pure, nessuna dipendenza: usate dalla pagina e dai test.

// Prefissi di costruttore Mercedes-Benz (auto, SUV, van) più comuni.
const WMI = ["W1K", "W1N", "W1V", "W1T", "W1W", "W1Y", "W1X", "WDD", "WDB", "WDC", "WDF", "WD3", "WD4", "WMX", "VSA", "WME"];
const VIN_CHARS = "A-HJ-NPR-Z0-9";

// Corregge gli errori tipici dell'OCR dentro un telaio: nei VIN non esistono O, Q, I.
function fixVin(s) {
  return s.replace(/[OQ]/g, "0").replace(/I/g, "1");
}

export function trovaTelai(testo) {
  const out = [];
  const seen = new Set();
  const righe = String(testo || "").toUpperCase().split(/\r?\n/);
  const reWmi = new RegExp("(" + WMI.join("|") + ")[" + VIN_CHARS + "]{14}", "g");
  righe.forEach((riga, i) => {
    // 1) riga compattata (l'OCR spesso spezza il telaio con spazi o trattini)
    const compatta = fixVin(riga.replace(/[^A-Z0-9]/g, ""));
    for (const m of compatta.matchAll(reWmi)) add(m[0], i);
    // 2) parole isolate di 17 caratteri validi (altri marchi o prefissi non in elenco)
    for (const tok of riga.split(/[^A-Z0-9]+/)) {
      if (tok.length === 17) {
        const v = fixVin(tok);
        if (new RegExp("^[" + VIN_CHARS + "]{17}$").test(v) && /[A-Z]/.test(v) && /\d{4}/.test(v)) add(v, i);
      }
    }
  });
  function add(v, riga) {
    if (seen.has(v)) return;
    seen.add(v);
    out.push({ telaio: v, riga });
  }
  return out;
}

const RE_MODELLO = [
  /\b(CLASSE|CLASS)\s+([ABCEGSTV])\b(?:\s+(\d{3})\s?(D|E|4MATIC)?)?/,
  /\b(GLA|GLB|GLC|GLE|GLS|CLA|CLE|CLS|EQA|EQB|EQC|EQE|EQS|EQV|EQT|AMG\s?GT|SL)\s?(\d{2,3})?\s?(D|E|4MATIC|COUP[EÉ]|SUV)?\b/,
  /\b(E?SPRINTER|E?VITO|E?CITAN|MARCO\s+POLO)\b(?:\s+(\d{3})\s?(CDI)?)?/,
  /\b([ABCES])\s?(\d{3})\s?(D|E|4MATIC)\b/,
];

function pulisci(s) {
  return s.replace(/\s+/g, " ").trim().toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Gla|Glb|Glc|Gle|Gls|Cla|Cle|Cls|Eqa|Eqb|Eqc|Eqe|Eqs|Eqv|Eqt|Amg|Gt|Sl|Cdi)\b/g, (x) => x.toUpperCase())
    .replace(/\b4matic\b/i, "4MATIC").replace(/ (\d{3}) D\b/, " $1 d").replace(/ (\d{3}) E\b/, " $1 e");
}

export function trovaModello(testo) {
  const t = String(testo || "").toUpperCase();
  for (const re of RE_MODELLO) {
    const m = t.match(re);
    if (m) return pulisci(m[0]);
  }
  return "";
}

export function trovaTarga(testo) {
  const m = String(testo || "").toUpperCase().match(/\b([A-HJ-NPR-TV-Z]{2})\s?(\d{3})\s?([A-HJ-NPR-TV-Z]{2})\b/);
  return m ? m[1] + m[2] + m[3] : "";
}

// Restituisce un elenco di vetture trovate nella bolla.
export function leggiBolla(testo) {
  const righe = String(testo || "").split(/\r?\n/);
  const telai = trovaTelai(testo);
  if (telai.length === 1) {
    return [{ telaio: telai[0].telaio, modello: trovaModello(testo), targa: trovaTarga(testo) }];
  }
  return telai.map(({ telaio, riga }) => {
    const stessa = righe[riga] || "";
    const intorno = righe.slice(Math.max(0, riga - 1), riga + 2).join("\n");
    return { telaio, modello: trovaModello(stessa) || trovaModello(intorno), targa: trovaTarga(stessa) };
  });
}
