# Dag Auto Vetture — guida per Claude Code

Web app interna di Dag Auto (concessionaria Mercedes-Benz, Manocalzati AV) per gestire **registro chiavi, usato, consegne (preconsegne), agenda e notifiche**.
La titolare è Teresa D'Agostino: scrive in italiano, dàlle del **tu**, rispondi in italiano semplice (non è una sviluppatrice). Prima di toccare dati veri chiedi conferma; prima di pubblicare prova in modalità demo.

## Dove sta cosa
- **Sito**: GitHub Pages del repo `dagauto/chiavi` → https://dagauto.github.io/chiavi/ (pubblica da `main`, 1–2 minuti dopo il push).
- **index.html**: tutta l'app (HTML+CSS+JS in un file, ~220 kB). Nessun build.
- **config.js**: configurazione Firebase (pubblica, non segreta).
- **firebase-messaging-sw.js, manifest.webmanifest, icon-*.png**: PWA.
- **funzione/**: Cloud Function **notifiche** (Node, gen2 su Cloud Run, `europe-west8`, 512 MiB). `installa.sh` la ridistribuisce.
- **leggifoto/**: Cloud Function **leggifoto** (lettura AI di libretto, perizia/verbale, DDT con Gemini `gemini-3.5-flash` in `europe-west3`, thinkingLevel LOW, timeout 180 s, max 10 istanze). `installa.sh` la ridistribuisce.
- **strumenti/controllo.py**: controllo di coerenza dei dati (solo lettura).
- **firestore.rules** nel repo: copia di riferimento. **Fa fede la versione pubblicata** in Firebase (progetto `chiavi-dag-auto`, Firestore `europe-west8`). Prima di modificarle scarica quella pubblicata e confrontala.

## Progetto Google
- Progetto: `chiavi-dag-auto`. Firestore `(default)` in `europe-west8`.
- Backup automatico giornaliero del database, conservazione 30 giorni (`gcloud firestore backups list`).
- Scheduler `notifiche-5min` → ogni minuto (`* * * * *`) chiama la funzione notifiche.
- Ridistribuire le funzioni dalla cartella del repo: `BASE=<raw url del commit> bash funzione/installa.sh` (idem `leggifoto/installa.sh`). In locale basta eseguire lo script dalla cartella.

## Collezioni Firestore
- `chiavi` — un documento per posto chiave, id `COLORE-NNN` (es. `ROSSO-024`). Campi: colore, numero, telaio, targa, modello, prima/seconda ("Sì"/"No"), dovePrima, motivo (chiave singola), ripristino/ripristinoTipo/ripristinoDove/ripristinoDal, esposizione, venduta/cliente, noleggioDal, allestimentoDal, note, controllatoDa, dataControllo, updatedAt/updatedBy.
- `usato` — schede vetture usate, id = targa normalizzata. stato, priorita, marca, modello, targa, telaio, chiave (numero rossa), km, immatricolazione, venditore (in acquisto; "Dag Auto" al posto di Giovanni Carbone), exProprietario, note, voci (lavori: descrizione, stimato, effettivo, fatto), date{stato:data}, prezzoVendita, margine, ivaEsposta, ripTipo, wip.
- `usato_riservato` — valoreContratto (carico fiscale), ivaEsposta. Lo vede solo la gestione.
- `consegne` — preconsegne. stato (richiesta/fissata/…/consegnata/annullata), tipo, colore, numero, targa, telaio, modello, cliente, consegnatario, venditore (solo informativo), **consegnaDa** (chi consegna: default Domenico Sperandeo nuovo, Nicola Bussolotto usato), data, ora, pag{chiave:{sel,fatto,var,testo}}, omaggi, omaggioPE, permuta, ordine* (ricambi magazzino), prep, wip, note.
- `impegni` (agenda), `movimenti` (log azioni), `storico` (vetture uscite), `notifiche_coda` (email in uscita, scritte dalla pagina con `ruoli`), `utenti`, `notifiche_utenti`.

## Ruoli
`admin`, `backoffice`, `usato` (= GEST, gestione) · `officina`, `ripristini`, `preparatore` (ex movimentatore), `magazzino`, `productexpert` (Domenico Sperandeo), `venditore`, `operatore`.
Helper in index.html: `GEST`, `ha(...)`, `canMontato`, `canAttiva`, `canMagazzino`, `canWip` (GEST+officina), `canRip` (GEST+officina+ripristini), `canFiscale` (GEST). Le stesse restrizioni vanno replicate nelle regole Firestore.

## Regole di dominio importanti
- Chiavi: **BLU** = nuove (seconda chiave = numero+100 nel retro), **ROSSO** = usato (codice U.n), **VERDE** = noleggio ("Fuori a noleggio"). Posti: Salone, Officina, Garage, Cimitero, Bel Sito, Fuori a noleggio, Fuori in allestimento, Carrozzeria, Sanificazione.
- Usato: stati attesa → ripristino → pronta → foto → pubblicata, oppure commerciante. In ripristino la prima chiave segue Carrozzeria/Sanificazione e con «Rientro in officina» o a fine ripristino torna in Officina (`FINE_RIP`).
- Rossa messa «In ripristino» dalle chiavi senza scheda usato → la scheda nasce da sola «In attesa di ripristino».
- Cambio del numero chiave su una scheda usato esistente → la chiave si sposta nel registro solo se il nuovo numero è libero, altrimenti errore e niente salvataggio.
- Vetture in conto esposizione: nascoste dalla tab Usato finché restano in esposizione.
- Consegne: accessori a pagamento con durate (Service Care 2/3/4, Advance 12/24/36/48, Defence 12–48 «montato», Certified, Mawdy, Pieno carburante, Altro con testo). Ricambi: magazzino «ordinati con data» o «non disponibili»; BO/PE «si consegna dopo».
- Notifiche: evento → ruoli (`EVENTI` nella pagina e in funzione/index.js; per eventi nuovi la funzione usa i `ruoli` scritti dalla pagina, quindi non serve ridistribuirla).

## Come lavorare
1. Modifica `index.html` in locale.
2. Prova in **modalità demo**: servi la cartella (`python -m http.server 8771`) e apri con `localStorage.demoRuolo = "<ruolo>"` per vedere l'app come quel ruolo (dati finti, regole non applicate).
3. Se cambi permessi, aggiorna **anche** le regole Firestore e pubblicale.
4. Commit e push su `main` → online in 1–2 minuti. Chiedi agli utenti di ricaricare l'app.
5. Modifiche massive ai dati veri: prima una prova che non scrive niente, poi conferma della titolare, poi l'esecuzione; il backup giornaliero c'è.
6. Non inserire mai password o chiavi segrete nel repo (è pubblico).
