// ─────────────────────────────────────────────────────────────────────────────
//  Scraper UNIFICADO — saca TODO de AccuLynx del último mes (o N días):
//    jobs/leads (formato Rec) + fotos + documentos + comunicaciones.
//
//  Flujo:
//    npm run login     → inicia sesión (una vez)
//    npm run list      → lista los jobs/leads del último mes (base para todo)
//    npm run jobs      → detalle de cada job/lead → out/records.json (formato Rec)
//    npm run photos    → fotos de esos jobs        → out/photos-index.jsonl
//    npm run docs      → documentos + firmas       → out/docs-index.jsonl
//    npm run comms     → comunicaciones            → out/communications.jsonl
//  o:
//    npm run all       → corre list→jobs→photos→docs→comms en orden
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  baseUrl: 'https://my.acculynx.com',
  companyId: '6ef98e1b-63d5-4c59-b003-b8494f0c7c51',
  storageStatePath: './session/storageState.json',

  // ── Ventana de tiempo ───────────────────────────────────────────────────────
  daysBack: 180,          // 30 = último mes. 14 = 2 semanas.
  // El joblist NO trae fecha de creación, solo LastTouched (última actividad).
  // Filtramos por eso: jobs/leads que se movieron en la ventana.

  deviceTimeZone: 'America/Bogota',
  maxRetries: 3,
  pauseBetweenJobsMs: 250,
  pauseBetweenFilesMs: 120,

  // ── Salidas ────────────────────────────────────────────────────────────────
  outDir: './out',
  listFile:  './out/recent-list.json',        // jobs/leads crudos del joblist
  recordsFile: './out/records.json',          // formato Rec (para loadMilestone)
  photosIndex: './out/photos-index.jsonl',
  docsIndex:   './out/docs-index.jsonl',
  commsFile:   './out/communications.jsonl',
  financialsIndex: './out/financials-index.jsonl',
  photosDir:   './out/photos',
  docsDir:     './out/docs',

  // checkpoints (reanudable)
  donePhotosFile: './out/done-photos.json',
  doneDocsFile:   './out/done-docs.json',
  doneCommsFile:  './out/done-comms.json',
  doneFinancialsFile: './out/done-financials.json',
}
