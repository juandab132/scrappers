import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG } from './config.js'
import { openSession, sleep, downloadFile, ensureDir } from './shared.js'
import type { Page } from 'playwright'

/* Baja las fotos de los jobs de recent-list.json.
   OPTIMIZADO: scroll más rápido + descargas EN PARALELO (pool).
   Reanudable (done-photos.json). Guarda out/photos-index.jsonl. */

const DL_CONCURRENCY = 6   // descargas simultáneas por job

function withSize(url: string): string {
  return url.replace(/w_\d+-h_\d+[^/]*/, 'w_1900-h_1900-t_fit-n-s_prod')
}
function isJobPhoto(url: string): boolean {
  return url.includes('images.acculynx.com') && url.includes('/attachments/') &&
    /\.(jpg|jpeg|png)(\?|$)/i.test(url)
}
function fileNameFromUrl(url: string): string {
  const clean = url.split('?')[0]
  return clean.split('/').pop() || `img_${Date.now()}.jpg`
}

// pool de concurrencia simple
async function pool<T>(items: T[], size: number, worker: (item: T, i: number) => Promise<void>) {
  let idx = 0
  const runners = Array.from({ length: Math.min(size, items.length || 1) }, async () => {
    while (idx < items.length) { const i = idx++; await worker(items[i], i) }
  })
  await Promise.all(runners)
}

async function scrapeJobPhotos(page: Page, jobId: string, label: string): Promise<number> {
  const collected = new Set<string>()
  const onResp = (resp: any) => {
    const u = resp.url()
    if (isJobPhoto(u)) collected.add(u.split('?')[0])
  }
  page.on('response', onResp)
  try {
    await page.goto(`${CONFIG.baseUrl}/jobs/${jobId}/jobphotos`, { waitUntil: 'domcontentloaded' })
    await sleep(600)
    if (/signin|login/i.test(page.url())) throw new Error('AUTH')
    // scroll INTELIGENTE: para cuando 2 scrolls seguidos no traen fotos nuevas.
    let stagnant = 0
    let last = collected.size
    for (let i = 0; i < 20 && stagnant < 2; i++) {
      await page.mouse.wheel(0, 8000)
      await sleep(250)
      if (collected.size === last) stagnant++
      else { stagnant = 0; last = collected.size }
    }
  } finally {
    page.off('response', onResp)
  }

  const urls = [...collected]
  if (urls.length === 0) return 0
  ensureDir(join(CONFIG.photosDir, jobId))

  // Descargar EN PARALELO (pool). Cada resultado se anexa al índice.
  let n = 0
  await pool(urls, DL_CONCURRENCY, async (rawUrl, i) => {
    const url = withSize(rawUrl)
    const fname = `${String(i + 1).padStart(3, '0')}_${fileNameFromUrl(url)}`
    const dest = join(CONFIG.photosDir, jobId, fname)
    const ok = await downloadFile(page, url, dest)
    appendFileSync(CONFIG.photosIndex, JSON.stringify({
      jobId, jobLabel: label, url,
      file: `out/photos/${jobId}/${fname}`,
      downloaded: ok, scrapedAt: new Date().toISOString(),
    }) + '\n')
    if (ok) n++
  })
  return n
}

async function main() {
  ensureDir(CONFIG.outDir)
  const list: any[] = JSON.parse(readFileSync(CONFIG.listFile, 'utf8'))
  const done: Set<string> = existsSync(CONFIG.donePhotosFile)
    ? new Set(JSON.parse(readFileSync(CONFIG.donePhotosFile, 'utf8'))) : new Set()

  const { browser, page } = await openSession()
  console.log(`\n📸 Fotos de ${list.length} jobs (${done.size} ya hechos se saltan)…`)

  let total = 0, fails = 0
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const jobId = it.Id
    if (done.has(jobId)) continue
    const label = (it.PrimaryContact?.Name ?? it.Name ?? jobId)
    process.stdout.write(`[${i + 1}/${list.length}] ${label} … `)
    try {
      const n = await scrapeJobPhotos(page, jobId, String(label))
      console.log(`${n} fotos`)
      total += n
      done.add(jobId)
      writeFileSync(CONFIG.donePhotosFile, JSON.stringify([...done]))
      fails = 0
    } catch (e) {
      if ((e as Error).message === 'AUTH') {
        console.log('\n🛑 Sesión caída. Corre "npm run login" y reanuda "npm run photos".')
        await browser.close(); process.exit(1)
      }
      console.log('error'); fails++
      if (fails >= 3) { console.log('🛑 3 fallos seguidos. Paro.'); break }
    }
    await sleep(50)
  }

  console.log(`\n✅ Fotos descargadas: ${total}. Índice → ${CONFIG.photosIndex}`)
  await browser.close()
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1) })
