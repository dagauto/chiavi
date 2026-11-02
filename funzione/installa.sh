#!/bin/bash
# Aggiorna la funzione "notifiche" di Dag Auto Vetture (push ed email ogni 5 minuti).
# Uso in Cloud Shell:  bash <(curl -s https://raw.githubusercontent.com/dagauto/chiavi/main/funzione/installa.sh)
set -e
gcloud config set project chiavi-dag-auto >/dev/null 2>&1
mkdir -p ~/notifiche && cd ~/notifiche
B=${BASE:-https://raw.githubusercontent.com/dagauto/chiavi/main}
for f in index.js package.json; do curl -sf -o $f "$B/funzione/$f"; done
grep -q productexpert index.js || { echo "index.js non aggiornato"; exit 1; }
gcloud functions deploy notifiche --gen2 --region=europe-west8 --runtime=nodejs22 --source=. \
  --entry-point=elabora --trigger-topic=notifiche-chiavi --memory=256Mi --timeout=120s --max-instances=1 \
  --update-env-vars=SMTP_USER=notifiche@dagauto.eu,SMTP_HOST=smtps.aruba.it \
  --set-secrets=SMTP_PASSWORD=SMTP_PASSWORD:latest --quiet 2>&1 | grep -E '^state|ERROR' || true
echo FINE
