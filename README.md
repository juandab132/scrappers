# AccuLynx Update — scraper del último mes (TODO)

Saca de AccuLynx, de los últimos 6 meses (daysBack: 180), las 4 cosas:
jobs/leads + fotos + documentos + comunicaciones. Reusa el MISMO formato que
tus seeders del CRM, así solo corres los seeders y entra todo.

## Instalar
```bash
npm install
npx playwright install chromium
```

## Uso (en orden)
```bash
npm run login    # inicia sesión (una vez) + ENTER
npm run list     # lista jobs/leads del último mes → out/recent-list.json
npm run jobs     # detalle en formato Rec          → out/records.json
npm run photos   # fotos                            → out/photos-index.jsonl + out/photos/
npm run docs     # documentos + firmas             → out/docs-index.jsonl   + out/docs/
npm run comms    # comunicaciones                  → out/communications.jsonl
```
O todo de una:
```bash
npm run all
```

## Ventana de tiempo
En `src/config.ts`: `daysBack: 30` (mes) o `14` (2 semanas).
Filtra por LastTouched (actividad reciente), porque el joblist no trae fecha de creación.

## Salidas (out/)
- `records.json`          → jobs/leads en formato Rec (para tu loadMilestone)
- `photos-index.jsonl`    → lo lee tu seed-photos.ts
- `docs-index.jsonl`      → lo lee tu seed-documents.ts
- `communications.jsonl`  → lo lee tu seed-communications.ts

## PENDIENTE (Camino B — datos completos de jobs)
`records.json` trae los datos BÁSICOS (nombre, dirección, milestone, contacto,
categoría, trade). Los MONTOS, seguro, adjuster y claim NO están en el joblist.
Para completarlos hay que cazar el endpoint de DETALLE de un job y llenarlo en
`enrichWithDetail()` dentro de src/jobs.ts (marcado con TODO). Cuando lo caces,
se agrega ahí.

## Estructura
```
acculynx-update/
  package.json, tsconfig.json, README.md, .gitignore   (raíz)
  src/
    config.ts   login.ts   shared.ts
    list.ts     jobs.ts    photos.ts   docs.ts   comms.ts
```
