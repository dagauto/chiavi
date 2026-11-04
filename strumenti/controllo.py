# Controllo di coerenza dei dati di Dag Auto Vetture (sola lettura).
# Uso in Cloud Shell, dopo aver scaricato le raccolte in una cartella:
#   python3 controllo.py ~/ck
import json, sys, os, datetime
D = sys.argv[1] if len(sys.argv) > 1 else "."

def carica(nome):
    p = os.path.join(D, nome + ".json")
    if not os.path.exists(p): return {}
    docs = json.load(open(p)).get("documents", [])
    def val(x):
        if "stringValue" in x: return x["stringValue"]
        if "integerValue" in x: return int(x["integerValue"])
        if "doubleValue" in x: return x["doubleValue"]
        if "booleanValue" in x: return x["booleanValue"]
        if "mapValue" in x: return {k: val(v) for k, v in x["mapValue"].get("fields", {}).items()}
        if "arrayValue" in x: return [val(v) for v in x["arrayValue"].get("values", [])]
        return None
    return {d["name"].split("/")[-1]: {k: val(v) for k, v in d.get("fields", {}).items()} for d in docs}

K, U, C, UT = carica("chiavi"), carica("usato"), carica("consegne"), carica("utenti")
norm = lambda s: "".join(ch for ch in str(s or "").upper() if ch.isalnum())
occ = lambda s: bool(s.get("telaio") or s.get("targa") or s.get("modello"))
oggi = datetime.date.today().isoformat()
out = []
def p(t): out.append(t)

p(f"Totali: chiavi {len(K)} (occupate {sum(1 for s in K.values() if occ(s))}), usato {len(U)}, consegne {len(C)}, utenti {len(UT)}")

# 1. Chiavi da censire
dc = [(i, s.get("targa", ""), s.get("prima", ""), s.get("seconda", "")) for i, s in K.items() if occ(s) and (s.get("prima") not in ("Sì", "No") or s.get("seconda") not in ("Sì", "No"))]
p(f"\n1) Vetture «Da censire» (prima o seconda chiave senza Sì/No): {len(dc)}")
for x in dc[:40]: p(f"   {x[0]} {x[1]} prima={x[2] or '—'} seconda={x[3] or '—'}")

# 2. Telai e targhe doppi nel registro
for campo in ("telaio", "targa"):
    m = {}
    for i, s in K.items():
        v = norm(s.get(campo))
        if v: m.setdefault(v, []).append(i)
    d = {v: ids for v, ids in m.items() if len(ids) > 1}
    p(f"\n2) {campo.capitalize()} presenti su più numeri: {len(d)}")
    for v, ids in list(d.items())[:20]: p(f"   {v}: {', '.join(ids)}")

# 3. Prima chiave «Sì» senza posto
sp = [i for i, s in K.items() if occ(s) and s.get("prima") == "Sì" and not s.get("dovePrima")]
p(f"\n3) Prima chiave presente ma senza posto indicato: {len(sp)} {', '.join(sp[:30])}")

# 4. Usato
p("\n4) Usato per stato: " + ", ".join(f"{k}={sum(1 for u in U.values() if u.get('stato')==k and not u.get('deleted'))}" for k in sorted({u.get('stato') for u in U.values()})))
for i, u in U.items():
    if u.get("deleted"): continue
    pr = []
    ch = u.get("chiave")
    if not ch: pr.append("senza n° chiave rossa")
    else:
        s = K.get(f"ROSSO-{int(ch):03d}") if str(ch).isdigit() else None
        if not s or not occ(s): pr.append(f"chiave R.{ch} vuota nel registro")
        elif norm(s.get("targa")) != norm(u.get("targa")) and norm(s.get("telaio")) != norm(u.get("telaio")): pr.append(f"chiave R.{ch} è di un'altra vettura ({s.get('targa') or s.get('telaio')})")
    if not u.get("telaio"): pr.append("senza telaio")
    if not u.get("immatricolazione"): pr.append("senza immatricolazione")
    if u.get("stato") == "presa": pr.append("ancora nello stato vecchio «presa»")
    if u.get("stato") in ("pronta", "foto", "pubblicata") and not u.get("prezzoVendita"): pr.append("pronta ma senza prezzo di vendita")
    if pr: p(f"   {i} {u.get('marca','')} {u.get('modello','')}: " + "; ".join(pr))

# 5. Consegne aperte
p("\n5) Consegne aperte:")
for i, c in C.items():
    if c.get("stato") in ("consegnata", "annullata"): continue
    pr = []
    kid = f"{c.get('colore')}-{int(c.get('numero') or 0):03d}"
    s = K.get(kid)
    if not s or not occ(s): pr.append(f"la chiave {kid} è vuota nel registro")
    elif c.get("telaio") and norm(s.get("telaio")) != norm(c.get("telaio")): pr.append(f"la chiave {kid} ha un altro telaio")
    if c.get("data") and c["data"] < oggi and not c.get("pronta"): pr.append(f"data {c['data']} già passata e non pronta")
    elif c.get("data") and c["data"] < oggi: pr.append(f"data {c['data']} passata ma non segnata consegnata")
    if not c.get("cliente"): pr.append("senza cliente")
    if c.get("ordineDa") and not c.get("ordineArrivati"): pr.append("accessori da ordinare in attesa")
    p(f"   {i} {c.get('cliente','')[:25]} data={c.get('data') or 'da fissare'}" + (": " + "; ".join(pr) if pr else ": ok"))

# 6. Utenti per ruolo
r = {}
for e, u in UT.items(): r.setdefault(u.get("ruolo"), []).append(u.get("nome") or e)
p("\n6) Utenti per ruolo:")
for k, v in sorted(r.items(), key=lambda x: str(x[0])): p(f"   {k}: {len(v)} ({', '.join(v)})")
print("\n".join(out))
