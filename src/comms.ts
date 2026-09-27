import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { CONFIG } from './config.js'
import { openSession, apiFetch, sleep, ensureDir } from './shared.js'
import type { Page } from 'playwright'

/* Comunicaciones de los jobs de recent-list.json.
   Endpoints (POST):
     /api/v4/jobs/{jobId}/communications/previews          → lista de threads
     /api/v4/jobs/{jobId}/communications/thread/{ThreadId} → detalle (mensajes)
     /api/v4/jobs/{jobId}/communications/thread/{ThreadId}/meta → participantes
   Guarda out/communications.jsonl (mismo formato → tu seed-communications.ts lo lee). */

function previewsBody(pageNum: number) {
  return {
    Page: pageNum,
    Filters: [
      { Name: 'Search', Type: 3, Properties: [
        { Name: 'subject', Nested: false }, { Name: 'plainTextContent', Nested: false },
        { Name: 'attachments.name', Nested: false } ], OptionsLabel: '', LabelPrefix: '', Options: [], SelectedOptions: [] },
      { Name: 'Tags', Type: 2, Properties: [{ Name: 'tags.name.keyword', Nested: false }], OptionsLabel: 'Tags', LabelPrefix: '', Options: [], SelectedOptions: [] },
      { Name: 'Has Attachments', Type: 1, Properties: [{ Name: 'attachments', Nested: true }], OptionsLabel: '', LabelPrefix: '', Options: [], SelectedOptions: [] },
      { Name: 'Date Range', Type: 4, Properties: [{ Name: 'createdDate', Nested: false }], OptionsLabel: '', LabelPrefix: '', Options: [], SelectedOptions: [] },
    ],
  }
}

async function fetchPreviews(page: Page, jobId: string): Promise<any[]> {
  const all: any[] = []
  let p = 1
  while (true) {
    const data = await apiFetch<{ Previews: any[]; Paging: { HasMoreRecords: boolean } }>(
      page, `/api/v4/jobs/${jobId}/communications/previews`, { method: 'POST', body: previewsBody(p) })
    const previews = data?.Previews ?? []
    all.push(...previews)
    if (!data?.Paging?.HasMoreRecords) break
    p++
    await sleep(150)
  }
  return all
}

async function fetchThread(page: Page, jobId: string, prev: any) {
  const body = { CommunicationType: { Name: prev.Type?.Name, Value: prev.Type?.Value }, SearchTerm: '' }
  const detail = await apiFetch<unknown>(page, `/api/v4/jobs/${jobId}/communications/thread/${prev.ThreadId}`, { method: 'POST', body })
  let meta: unknown = null
  try {
    meta = await apiFetch<unknown>(page, `/api/v4/jobs/${jobId}/communications/thread/${prev.ThreadId}/meta`, { method: 'POST', body: { SearchTerm: '' } })
  } catch { meta = null }
  return { detail, meta }
}

async function main() {
  ensureDir(CONFIG.outDir)
  const list: any[] = JSON.parse(readFileSync(CONFIG.listFile, 'utf8'))
  const done: Set<string> = existsSync(CONFIG.doneCommsFile)
    ? new Set(JSON.parse(readFileSync(CONFIG.doneCommsFile, 'utf8'))) : new Set()

  const { browser, page } = await openSession()
  console.log(`\n💬 Comunicaciones de ${list.length} jobs (${done.size} ya hechos)…`)

  let totalThreads = 0, fails = 0
  for (let i = 0; i < list.length; i++) {
    const job = list[i]; const jobId = job.Id
    if (done.has(jobId)) continue
    const label = (job.PrimaryContact?.Name ?? job.Name ?? jobId)
    process.stdout.write(`[${i + 1}/${list.length}] ${label} … `)
    try {
      const previews = await fetchPreviews(page, jobId)
      for (const prev of previews) {
        const { detail, meta } = await fetchThread(page, jobId, prev)
        appendFileSync(CONFIG.commsFile, JSON.stringify({
          job: { id: jobId, type: job.Type, name: label, label, address: job.FullAddress ?? null },
          preview: prev, detail, meta, scrapedAt: new Date().toISOString(),
        }) + '\n')
        totalThreads++
        await sleep(120)
      }
      console.log(`${previews.length} threads`)
      done.add(jobId); writeFileSync(CONFIG.doneCommsFile, JSON.stringify([...done])); fails = 0
    } catch (e) {
      if ((e as Error).message.startsWith('AUTH')) {
        console.log('\n🛑 Sesión caída. Corre "npm run login" y reanuda "npm run comms".')
        await browser.close(); process.exit(1)
      }
      console.log('error'); fails++
      if (fails >= 3) { console.log('🛑 3 fallos seguidos. Paro.'); break }
    }
    await sleep(CONFIG.pauseBetweenJobsMs)
  }

  console.log(`\n✅ Threads: ${totalThreads}. Índice → ${CONFIG.commsFile}`)
  console.log(`\n🎉 Listo. Ya tienes en out/: records.json, photos-index.jsonl, docs-index.jsonl, communications.jsonl`)
  await browser.close()
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1) })
