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

async function tokenGoogle() {
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}

const pulisciTelaio = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1").replace(/Q/g, "0");
const pulisciTarga = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

functions.http("leggifoto", async (req, res) => {
  const o = req.get("origin") || "";
  if (ORIGINI.includes(o)) res.set("Access-Control-Allow-Origin", o);
  res.set("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
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

    const { immagine, mime } = req.body || {};
    if (!immagine || typeof immagine !== "string" || immagine.length > 8e6) return res.status(400).json({ errore: "Foto mancante o troppo grande" });

    const url = `https://aiplatform.googleapis.com/v1/projects/${PROGETTO}/locations/${LUOGO}/publishers/google/models/${MODELLO}:generateContent`;
    const corpo = {
      contents: [{ role: "user", parts: [{ text: ISTRUZIONI }, { inlineData: { mimeType: mime || "image/jpeg", data: immagine } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
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
