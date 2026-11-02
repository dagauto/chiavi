// Funzione "leggifoto" di Dag Auto Vetture.
// Riceve la foto di una bolla, di un libretto o di un'etichetta e la fa leggere a Gemini (Vertex AI),
// restituendo telaio, modello, targa e colore di ogni vettura. La usano solo gli utenti autorizzati.
const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const PROGETTO = process.env.GOOGLE_CLOUD_PROJECT || "chiavi-dag-auto";
const MODELLO = process.env.MODELLO || "gemini-2.5-flash";
const LUOGO = process.env.LUOGO || "global";
const ORIGINI = ["https://dagauto.github.io"];

const ISTRUZIONI = `Sei l'addetto all'accettazione vetture di una concessionaria Mercedes-Benz italiana.
Ti mando la foto di un documento: bolla di consegna / DDT del trasportatore, documento Mercedes-Benz di consegna,
carta di circolazione (libretto), certificato di conformità oppure l'etichetta con il numero di telaio.
Estrai TUTTE le vetture presenti. Per ognuna:
- telaio: il numero di telaio (VIN) di 17 caratteri, in maiuscolo, senza spazi. Nei VIN non esistono le lettere I, O, Q:
  se le vedi sono 1 o 0. I telai Mercedes iniziano di solito con WDD, WDB, WDC, WDF, W1K, W1N, W1V, W1T, W1W, W1Y.
  Sul libretto il telaio è al campo E.
- modello: denominazione commerciale breve (es. "GLC 220 d 4MATIC", "Classe A 180", "Sprinter 317 CDI"); sul libretto campo D.3 / D.2.
- targa: targa italiana se presente (es. GH123AB, campo A del libretto), altrimenti stringa vuota.
- colore: colore carrozzeria se indicato, altrimenti stringa vuota.
- sicuro: true se il telaio si legge chiaramente, false se hai dovuto indovinare qualche carattere.
Non inventare vetture o caratteri: se un dato non c'è lascia la stringa vuota.
In "tipo_documento" scrivi cosa hai riconosciuto (bolla, libretto, etichetta, altro).`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    tipo_documento: { type: "STRING" },
    vetture: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          telaio: { type: "STRING" },
          modello: { type: "STRING" },
          targa: { type: "STRING" },
          colore: { type: "STRING" },
          sicuro: { type: "BOOLEAN" },
        },
        required: ["telaio", "modello", "targa", "colore", "sicuro"],
      },
    },
  },
  required: ["tipo_documento", "vetture"],
};

// Presa in carico usato: libretto (carta di circolazione) e scheda stato d'uso / perizia.
const ISTRUZIONI_USATO = `Sei l'addetto alla presa in carico delle vetture usate di una concessionaria Mercedes-Benz italiana.
Ti mando la foto di un documento di una vettura usata: può essere la carta di circolazione (libretto) oppure la scheda
"stato d'uso" / perizia compilata a mano o stampata (con km, danni, accessori, note). Estrai solo quello che c'è scritto:
- targa: targa italiana (libretto campo A), maiuscolo senza spazi.
- telaio: VIN di 17 caratteri (libretto campo E), maiuscolo senza spazi; nei VIN non esistono I, O, Q (sono 1 o 0).
- modello: marca e modello brevi (libretto D.1 + D.3, es. "Mercedes GLC 220 d 4MATIC"; ometti "Mercedes-Benz" se è Mercedes).
- immatricolazione: data di prima immatricolazione (libretto campo B) nel formato GG/MM/AAAA.
- exProprietario: intestatario (libretto campi C.2.1 / C.2.2, cognome e nome o ragione sociale).
- km: chilometri indicati nella scheda stato d'uso, solo cifre.
- danni: elenco breve dei danni di carrozzeria/interni segnati nella scheda stato d'uso, separati da virgola.
- accessori: accessori e documenti presenti (es. "doppia chiave", "libretto service", "ruota di scorta"), uno per voce.
- note: altre annotazioni utili scritte sulla scheda (es. "Rientro", numero pratica, chiavi consegnate).
- voci: i costi di ripristino, RAGGRUPPATI PER SEZIONE: al massimo UNA voce per ogni sezione, mai una voce per ogni pezzo.
  Il documento può essere il nuovo "VERBALE DI PERIZIA" Dag Auto (tabelle Carrozzeria A–O, Interni 1–8, Altri esterni,
  Dotazioni, Pneumatici, Stato meccanica, eventuale retro "Perizia aggiuntiva al rientro") oppure la vecchia scheda con la colonna PERIZIA.
  Considera solo le righe segnate con R (riparare) o S (sostituire) oppure con un importo; ignora quelle con N (normale usura) senza importo e quelle vuote o con "/".
  Sezioni (usa esattamente questi nomi):
  carrozzeria = tabella Carrozzeria (A–O) + calotte retrovisori; interni = tabella Interni (1–8);
  cristalli = parabrezza, lunotto, vetri laterali; illuminazione = fari e fanali;
  pneumatici = tabella Pneumatici e dischi ruota/cerchi; meccanica = Stato meccanica, motore, batterie (modulo batterie con KO o anomalie);
  manutenzione = tagliando, manutenzione; freni = freni, pastiglie, dischi freno;
  altro = Dotazioni mancanti o da sostituire (es. 2ª chiave, kit riparazione) e quello che non rientra altrove.
  Per ogni sezione: descrizione = elenco breve e compatto dei pezzi, separati da virgola, con R o S tra parentesi
  (es. "Porta ant. dx (R), paraurti post. (S), parafango post. sx (R)"; per i pneumatici es. "Ant. sx e ant. dx da sostituire, 2 mm");
  stimato = il subtotale della sezione se è scritto, altrimenti la somma degli importi della sezione (0 se non ci sono importi).
  Se c'è anche il retro "Perizia aggiuntiva al rientro", aggiungi quei danni nelle stesse sezioni scrivendo "al rientro" accanto al pezzo.
- Nel verbale: "km" è il campo KM in alto; "accessori" sono le Dotazioni presenti (non segnate R o S); in "note" metti
  esterno/interno pulito SI/NO, numero verbale, tipo pneumatici e le note di stato meccanica se brevi.
- sicuro: true se targa e telaio si leggono chiaramente, false se hai dovuto indovinare.
Se un dato non c'è lascia la stringa vuota (o la lista vuota). Non inventare nulla.
In "tipo_documento" scrivi libretto, stato d'uso o altro.`;
const SCHEMA_USATO = {
  type: "OBJECT",
  properties: {
    tipo_documento: { type: "STRING" }, targa: { type: "STRING" }, telaio: { type: "STRING" }, modello: { type: "STRING" },
    immatricolazione: { type: "STRING" }, exProprietario: { type: "STRING" }, km: { type: "STRING" }, danni: { type: "STRING" },
    accessori: { type: "ARRAY", items: { type: "STRING" } }, note: { type: "STRING" }, sicuro: { type: "BOOLEAN" },
    voci: { type: "ARRAY", items: { type: "OBJECT", properties: { sezione: { type: "STRING", enum: ["carrozzeria", "manutenzione", "freni", "pneumatici", "meccanica", "cristalli", "illuminazione", "interni", "altro"] }, descrizione: { type: "STRING" }, stimato: { type: "NUMBER" } }, required: ["sezione", "descrizione", "stimato"] } },
  },
  required: ["tipo_documento", "targa", "telaio", "modello", "immatricolazione", "exProprietario", "km", "danni", "accessori", "note", "sicuro", "voci"],
};

async function tokenGoogle() {
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}

const pulisciTelaio = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1").replace(/Q/g, "0");
// Una sola voce per sezione: unisce descrizioni e somma gli importi.
function raggruppa(voci) {
  const g = new Map();
  for (const v of voci || []) {
    if (!v || !v.sezione || !(v.descrizione || v.stimato)) continue;
    const x = g.get(v.sezione) || { sezione: v.sezione, parti: [], stimato: 0 };
    const d = String(v.descrizione || "").trim();
    if (d && !x.parti.some((p) => p.toLowerCase() === d.toLowerCase())) x.parti.push(d);
    x.stimato += Number(v.stimato) || 0;
    g.set(v.sezione, x);
  }
  return [...g.values()].map((x) => ({ sezione: x.sezione, descrizione: x.parti.join(", ").slice(0, 300), stimato: Math.round(x.stimato) }));
}
const pulisciTarga = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

functions.http("leggifoto", async (req, res) => {
  const o = req.get("origin") || "";
  if (ORIGINI.includes(o)) res.set("Access-Control-Allow-Origin", o);
  res.set("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Firebase-AppCheck");
    res.set("Access-Control-Max-Age", "3600");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ errore: "Metodo non ammesso" });
  try {
    // Solo utenti autorizzati del registro.
    const m = (req.get("authorization") || "").match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ errore: "Accesso richiesto" });
    const u = await admin.auth().verifyIdToken(m[1]);
    const email = String(u.email || "").toLowerCase();
    if (!u.email_verified || !(await db.doc(`utenti/${email}`).get()).exists) return res.status(403).json({ errore: "Utente non autorizzato" });
    // App Check: accetta solo richieste che arrivano dall'app Dag Auto Vetture.
    const ac = req.get("x-firebase-appcheck") || "";
    try { if (!ac) throw new Error("manca"); await admin.appCheck().verifyToken(ac); }
    catch (e) { console.warn("App Check rifiutato", email, String(e.message || e)); return res.status(401).json({ errore: "App non riconosciuta" }); }

    const { immagine, mime } = req.body || {};
    const usato = (req.body || {}).modo === "usato";
    if (!immagine || typeof immagine !== "string" || immagine.length > 8e6) return res.status(400).json({ errore: "Foto mancante o troppo grande" });

    const url = `https://aiplatform.googleapis.com/v1/projects/${PROGETTO}/locations/${LUOGO}/publishers/google/models/${MODELLO}:generateContent`;
    const corpo = {
      contents: [{ role: "user", parts: [{ text: usato ? ISTRUZIONI_USATO : ISTRUZIONI }, { inlineData: { mimeType: mime || "image/jpeg", data: immagine } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: usato ? SCHEMA_USATO : SCHEMA },
    };
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${await tokenGoogle()}`, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json();
    if (!r.ok) {
      console.error("Gemini", r.status, JSON.stringify(j).slice(0, 500));
      return res.status(502).json({ errore: "Lettura non riuscita" });
    }
    const testo = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "{}";
    let dati;
    try { dati = JSON.parse(testo); } catch (e) { dati = { tipo_documento: "", vetture: [] }; }
    if (usato) {
      const out = {
        tipo: dati.tipo_documento || "", targa: pulisciTarga(dati.targa), telaio: pulisciTelaio(dati.telaio),
        modello: String(dati.modello || "").trim(), immatricolazione: String(dati.immatricolazione || "").trim(),
        exProprietario: String(dati.exProprietario || "").trim(), km: String(dati.km || "").replace(/\D/g, ""),
        danni: String(dati.danni || "").trim(), accessori: (dati.accessori || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
        note: String(dati.note || "").trim(), sicuro: dati.sicuro !== false,
        voci: raggruppa(dati.voci),
      };
      console.log("letta foto usato", email, out.tipo);
      return res.json(out);
    }
    const vetture = (dati.vetture || [])
      .map((v) => ({ telaio: pulisciTelaio(v.telaio), modello: String(v.modello || "").trim(), targa: pulisciTarga(v.targa), colore: String(v.colore || "").trim(), sicuro: v.sicuro !== false }))
      .filter((v) => v.telaio.length >= 11);
    console.log("letta foto", email, dati.tipo_documento, vetture.length);
    return res.json({ tipo: dati.tipo_documento || "", vetture });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ errore: "Errore interno" });
  }
});
