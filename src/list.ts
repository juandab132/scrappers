import { writeFileSync } from 'node:fs'
import { CONFIG } from './config.js'
import { openSession, apiFetch, ensureDir } from './shared.js'

/* Lista los jobs/leads con actividad (LastTouched) en la ventana (daysBack).
   Guarda out/recent-list.json con los registros crudos del joblist.
   Esta lista es la BASE: photos/docs/comms sólo bajan de estos jobs. */

async function main() {
  ensureDir(CONFIG.outDir)
  const { browser, page } = await openSession()

  console.log(`\n📋 Listando jobs/leads de los últimos ${CONFIG.daysBack} días…`)
  const qs =
    `loadAll=true&onlyBalanceDue=false&onlyWatchList=false` +
    `&page=1&query=&sort=milestoneStart%7Cdesc&type=2`
  const data = await apiFetch<{ TotalRecords: number; results: any[] }>(page, `/api/joblist?${qs}`)

  if (!data || !Array.isArray(data.results)) {
    console.error('❌ No se pudo traer la lista.'); await browser.close(); process.exit(1)
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - CONFIG.daysBack)

  const picked = data.results.filter((it) => {
    const dateStr = it.LastTouchedUTC ?? it.LastTouched
    const d = dateStr ? new Date(dateStr) : null
    return d ? d >= cutoff : false
  })

  writeFileSync(CONFIG.listFile, JSON.stringify(picked, null, 2))
  console.log(`✅ ${picked.length} jobs/leads en la ventana (de ${data.results.length} totales).`)
  console.log(`   → ${CONFIG.listFile}`)
  console.log(`\n   Ahora corre:  npm run jobs   (detalle en formato Rec)`)
  await browser.close()
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1) })
