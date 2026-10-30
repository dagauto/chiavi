// Funzione "notifiche" del registro chiavi Dag Auto.
// Parte ogni 5 minuti (Cloud Scheduler -> Pub/Sub):
// 1) cerca le consegne entro 24 ore non pronte e mette in coda l'avviso;
// 2) invia notifiche push ed email per tutto ciò che è in coda (collezione notifiche_coda).
const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();
const SITO = "https://dagauto.github.io/chiavi/";

// Stesso elenco della pagina: chi riceve ogni evento se non ha cambiato le sue preferenze.
const EVENTI = {
  consegna_nuova: ["preparatore", "backoffice"],
  consegna_fissata: ["preparatore", "backoffice"],
  consegna_24h: ["preparatore", "backoffice", "admin"],
  consegna_pronta: ["venditore", "backoffice"],
  usato_presa: ["usato", "admin"],
  usato_attesa: ["ripristini", "officina"],
  usato_pronta: ["foto"],
};
const ACC_STD = ["chiavi", "giubotto", "prontosoccorso", "gonfiaggio", "portachiavi", "libretto"];
const PREP = ["targata", "lavaggio"];

// Pronta solo con il flag «Preconsegna fatta» messo da preparatore/officina.
function pronta(c) {
  return !!c.pronta;
}

// Data e ora della consegna intese all'ora di Roma.
function quandoRoma(data, ora) {
  const guess = new Date(`${data}T${ora || "09:00"}:00Z`);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" })
    .formatToParts(guess).find((p) => p.type === "timeZoneName").value; // es. GMT+1
  const m = off.match(/GMT([+-]\d+)(?::(\d+))?/);
  const min = m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0) : 60;
  return new Date(guess.getTime() - min * 60000);
}

// Ore lavorative tra due istanti: sabato e domenica (ora di Roma) non contano.
const giornoRoma = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", weekday: "short" }).format(new Date(t));
function oreLavorative(from, to) {
  if (to <= from) return (to - from) / 36e5;
  let ms = 0;
  for (let t = from; t < to; t += 15 * 60000) {
    const g = giornoRoma(t);
    if (g !== "Sat" && g !== "Sun") ms += Math.min(15 * 60000, to - t);
  }
  return ms / 36e5;
}

let transport = null;
function mailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtps.aruba.it",
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transport;
}

async function destinatari(evento) {
  const ruoli = EVENTI[evento] || [];
  const [us, pr] = await Promise.all([db.collection("utenti").get(), db.collection("notifiche_utenti").get()]);
  const pm = new Map(pr.docs.map((d) => [d.id, d.data()]));
  const out = [];
  for (const u of us.docs) {
    const p = pm.get(u.id) || {};
    const scelta = (p.prefs || {})[evento] || {};
    const base = ruoli.includes(u.get("ruolo"));
    const push = scelta.push !== undefined ? scelta.push : base;
    const mail = scelta.email !== undefined ? scelta.email : base;
    if (push || mail) out.push({ email: u.id, push, mail, tokens: p.tokens || [] });
  }
  return out;
}

async function invia(n) {
  const link = SITO + (n.link || "");
  let ds;
  if (n.evento === "test") {
    const p = (await db.doc(`notifiche_utenti/${n.updatedBy}`).get()).data() || {};
    ds = [{ email: n.updatedBy, push: true, mail: true, tokens: p.tokens || [] }];
  } else ds = await destinatari(n.evento);
  let push = 0, mail = 0;
  for (const d of ds) {
    if (d.push && d.tokens.length) {
      const r = await admin.messaging().sendEachForMulticast({
        tokens: d.tokens,
        data: { title: n.titolo || "Dag Auto Vetture", body: n.testo || "", link, tag: n.evento },
        webpush: { headers: { Urgency: "high", TTL: "86400" }, fcmOptions: { link } },
      });
      push += r.successCount;
      const bad = [];
      r.responses.forEach((x, i) => {
        const code = (x.error && x.error.code) || "";
        if (!x.success && /not-registered|invalid-registration|invalid-argument/.test(code)) bad.push(d.tokens[i]);
      });
      if (bad.length) await db.doc(`notifiche_utenti/${d.email}`).update({ tokens: admin.firestore.FieldValue.arrayRemove(...bad) });
    }
    const m = d.mail && mailer();
    if (m) {
      await m.sendMail({
        from: `"Dag Auto Vetture" <${process.env.SMTP_USER}>`,
        to: d.email,
        subject: n.titolo || "Dag Auto Vetture",
        text: `${n.testo || ""}\n\nApri il registro: ${link}\n\nPer cambiare quali avvisi ricevere: Altro → Notifiche nel registro.`,
      });
      mail++;
    }
  }
  return { push, mail };
}

async function controllo24h() {
  const now = Date.now();
  const snap = await db.collection("consegne").where("stato", "in", ["fissata", "richiesta"]).get();
  for (const doc of snap.docs) {
    const c = doc.data();
    if (!c.data || c.avviso24h || pronta(c)) continue;
    const fine = quandoRoma(c.data, c.ora).getTime();
    if (fine - now > 7 * 864e5) continue;
    const h = oreLavorative(now, fine);
    if (h < 24 && h > -3) {
      const sigla = `${{ BLU: "N", ROSSO: "U", VERDE: "V" }[c.colore] || "?"}.${c.numero}`;
      await db.collection("notifiche_coda").add({
        evento: "consegna_24h",
        titolo: `Consegna ${sigla}: meno di 24 ore lavorative, non pronta`,
        testo: `${c.cliente || "Cliente"} · ${c.modello || ""} · ${c.data.split("-").reverse().join("/")} ore ${c.ora || "--:--"}. Completa la preparazione.`,
        link: "#consegne",
        inviata: false,
        ts: now,
      });
      await doc.ref.update({ avviso24h: true });
    }
  }
}

functions.cloudEvent("elabora", async () => {
  await controllo24h();
  const q = await db.collection("notifiche_coda").where("inviata", "==", false).limit(50).get();
  for (const d of q.docs) {
    try {
      const r = await invia(d.data());
      await d.ref.update({ inviata: true, inviataIl: Date.now(), ...r });
    } catch (e) {
      console.error("Invio non riuscito", d.id, e);
      await d.ref.update({ inviata: true, inviataIl: Date.now(), errore: String(e && e.message || e) });
    }
  }
});
