import { readFileSync, writeFileSync } from 'node:fs'
import { CONFIG } from './config.js'
import { openSession, apiFetch, sleep } from './shared.js'

/* Convierte cada job/lead de recent-list.json al formato "Rec" que espera tu
   loadMilestone(). Guarda out/records.json.

   ── ESTADO ACTUAL (Camino A / básico) ──
   Saca de cada job/lead: nombre, dirección, ciudad, estado, zip, vendedor,
   milestone→status, categoría, trade, workType, contacto (tel/email), hasJob.

   ── PENDIENTE (Camino B / completo) ──
   Montos (contractAmount), seguro (insurance), adjuster, claim y worksheet/estimate
   NO están en el joblist. Cuando caces el endpoint de DETALLE de un job, se
   completa en enrichWithDetail() abajo (marcado con TODO).
*/

// Milestone de AccuLynx → status de tu enum (LeadStatus/JobStatus)
function milestoneToStatus(ms: string): string {
  const m = (ms ?? '').toLowerCase()
  if (m.includes('lead')) return 'ASSIGNED'
  if (m.includes('prospect')) return 'PROSPECT'
  if (m.includes('approv')) return 'APPROVED'
  if (m.includes('complet')) return 'COMPLETED'
  if (m.includes('invoic')) return 'INVOICED'
  if (m.includes('close')) return 'CLOSED'
  if (m.includes('cancel')) return 'CANCELED'
  return 'ASSIGNED'
}

// Parte "Nombre Apellido" en first/last.
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = String(full ?? '').trim().split(/\s+/)
  if (parts.length === 0) return { firstName: 'Unknown', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Parte "calle, ciudad, ST zip" en sus partes.
function splitAddress(full: string): { addr: string; city: string; state: string; zip: string } {
  // Ej: "349 Creekwood Dr, Lancaster, TX 75146"
  const s = String(full ?? '').trim()
  const parts = s.split(',').map((x) => x.trim())
  let addr = parts[0] ?? '', city = parts[1] ?? '', state = '', zip = ''
  const last = parts[2] ?? ''
  const m = last.match(/([A-Za-z]{2})\s*(\d{5})?/)
  if (m) { state = m[1] ?? ''; zip = m[2] ?? '' }
  return { addr, city, state, zip }
}

// ── PENDIENTE Camino B: enriquecer con el detalle del job ──
// Cuando caces el endpoint de detalle (ej. /api/v4/jobs/{id}/... o similar),
// aquí llamas apiFetch y llenas montos/seguro/adjuster/claim.
async function enrichWithDetail(_page: any, _jobId: string, rec: any): Promise<void> {
  // TODO(camino B): const d = await apiFetch(_page, `/api/v4/jobs/${_jobId}/detail`)
  //   rec.contractAmount = d?.ContractAmount
  //   rec.insuranceCompany = d?.Insurance?.CompanyName
  //   rec.claimNumber = d?.Insurance?.ClaimNumber
  //   rec.adjusterName = d?.Insurance?.AdjusterName
  //   ... etc.
  return
}

async function main() {
  const list: any[] = JSON.parse(readFileSync(CONFIG.listFile, 'utf8'))
  const { browser, page } = await openSession()

  console.log(`\n🧩 Armando records (formato Rec) de ${list.length} jobs/leads…`)
  const records: any[] = []

  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const pc = it.PrimaryContact ?? {}
    const name = pc.Name ?? pc.FullName ?? it.Name ?? ''
    const { firstName, lastName } = splitName(name)
    const { addr, city, state, zip } = splitAddress(it.FullAddress ?? '')
    const milestone = it.CurrentMilestone ?? ''
    const isLead = milestone.toLowerCase().includes('lead')

    const rec: any = {
      status: milestoneToStatus(milestone),
      firstName, lastName,
      email: pc.Email ?? undefined,
      phone: pc.Phone ?? pc.PhoneNumber ?? pc.PrimaryPhone ?? undefined,
      assignedEmail: undefined, // el joblist da SalesPerson (nombre), no email → lo resolvemos en el seed por nombre si quieres
      source: undefined,
      category: (it.JobCategories?.[0]?.Name ?? it.JobCategories?.[0]) ?? undefined,
      workType: (it.WorkTypes?.[0]?.Name ?? it.WorkTypes?.[0]) ?? undefined,
      trade: (it.Trades?.[0]?.Name ?? it.Trades?.[0]) ?? undefined,
      priority: 'Normal',
      addressLine1: addr, city, state, zip,
      hasJob: !isLead,           // si NO es lead, tiene job
      // ── campos del Camino B (por ahora vacíos) ──
      contractAmount: undefined,
      // guardamos el UUID de AccuLynx y el vendedor por si sirven al importar
      _acculynxId: it.Id,
      _salesPerson: it.SalesPerson ?? null,
      _milestone: milestone,
    }

    await enrichWithDetail(page, it.Id, rec)  // no-op hasta cazar el detalle
    records.push(rec)
    if ((i + 1) % 25 === 0) console.log(`   ...${i + 1}/${list.length}`)
    await sleep(CONFIG.pauseBetweenJobsMs)
  }

  writeFileSync(CONFIG.recordsFile, JSON.stringify(records, null, 2))
  const leads = records.filter((r) => !r.hasJob).length
  const jobs = records.length - leads
  console.log(`\n✅ ${records.length} records → ${CONFIG.recordsFile}`)
  console.log(`   (${jobs} con job, ${leads} solo lead)`)
  console.log(`\n   Ahora corre:  npm run photos`)
  await browser.close()
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1) })
