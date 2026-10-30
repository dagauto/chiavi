#!/bin/bash
# Installa la funzione "leggifoto" di Dag Auto Vetture (lettura foto con Gemini).
# Uso in Cloud Shell:  bash <(curl -s https://raw.githubusercontent.com/dagauto/chiavi/main/leggifoto/installa.sh)
set -e
P=chiavi-dag-auto
gcloud config set project $P >/dev/null 2>&1
mkdir -p ~/leggifoto && cd ~/leggifoto
for f in index.js package.json; do curl -sf -o $f "https://raw.githubusercontent.com/dagauto/chiavi/main/leggifoto/$f"; done
T=$(gcloud auth print-access-token)
SCELTO=""; LUOGO=""
for L in global europe-west8 europe-west1; do
  for M in gemini-3.8-flash gemini-3.7-flash gemini-3.6-flash gemini-3.5-flash; do
    H=aiplatform.googleapis.com; [ "$L" != global ] && H=$L-aiplatform.googleapis.com
    R=$(curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
      "https://$H/v1/projects/$P/locations/$L/publishers/google/models/$M:generateContent" \
      -d '{"contents":[{"role":"user","parts":[{"text":"Rispondi solo OK"}]}]}')
    if echo "$R" | grep -q '"text"'; then SCELTO=$M; LUOGO=$L; break 2; fi
    echo "  $L $M non disponibile"
  done
done
[ -z "$SCELTO" ] && { echo "NESSUN MODELLO DISPONIBILE"; exit 1; }
echo "MODELLO SCELTO: $SCELTO ($LUOGO)"
# Se il luogo non e' global, la funzione usa l'host regionale.
if [ "$LUOGO" != global ]; then sed -i "s#https://aiplatform.googleapis.com/v1/projects/\${PROGETTO}/locations/\${LUOGO}#https://\${LUOGO}-aiplatform.googleapis.com/v1/projects/\${PROGETTO}/locations/\${LUOGO}#" index.js; fi
gcloud functions deploy leggifoto --gen2 --region=europe-west8 --runtime=nodejs22 --source=. \
  --entry-point=leggifoto --trigger-http --allow-unauthenticated --memory=512Mi --timeout=120s \
  --max-instances=3 --set-env-vars=MODELLO=$SCELTO,LUOGO=$LUOGO --quiet 2>&1 | grep -E '^state|^url|ERROR|uri:' || true
echo "URL: $(gcloud functions describe leggifoto --region=europe-west8 --format='value(serviceConfig.uri)')"
echo FINE
