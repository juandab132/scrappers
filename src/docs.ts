import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG } from './config.js'
import { openSession, apiFetch, sleep, downloadFile, ensureDir } from './shared.js'
import type { Page } from 'playwright'

/* Documentos + firmas de los jobs de recent-list.json.
   API: /api/v4/job-documents/{jobId}/job-document-folders → carpetas con Files[].
   Para packets de firma: /api/v4/job-documents/{packetId}/job-packet-data.
   Guarda out/docs-index.jsonl (mismo formato → tu seed-documents.ts lo lee). */

function safeName(s: string): string {
  return String(s ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'file'
}
function signatureStatus(file: any) {
  const pi = file.SmartInformation?.PacketInformation
  const st = pi?.Status
  const map: any = { 0: 'no-firma', 1: 'en-proceso', 3: 'firmado-completo', 4: 'enviado-pendiente' }
  return {
    isSignaturePacket: !!pi?.PacketId,
    status: map[st] ?? 'no-firma',
    completedSigners: pi?.CompletedSigners ?? 0,
    totalSigners: pi?.TotalSigners ?? 0,
    signedFileId: pi?.SignedFileId ?? null,
    sentBy: pi?.SentByCompanyUser ?? null,
    sentDate: pi?.SentDate ?? null,
  }
}
async function fetchPacketData(page: Page, packetId: string): Promise<any | null> {
  const data = await apiFetch<any>(page, `/api/v4/job-documents/${packetId}/job-packet-data`)
  if (!data?.PacketDetails) return null
  const d = data.PacketDetails
  return {
    packetId: d.PacketId ?? packetId, name: d.Name ?? null,
    status: d.PacketStatus ?? null, statusEnum: d.PacketStatusEnum ?? null,
    sentBy: d.SentByDisplayName ?? null, sentDate: d.SentDateFormatted ?? null,
    completedDate: d.LatestStatusDateFormatted ?? null, viewDocumentUrl: d.ViewDocumentUrl ?? null,
    signers: Array.isArray(d.Signers) ? d.Signers.map((s: any) => ({
      id: s.Id, name: s.Name, email: s.Email, status: s.Status,
      signedDate: s.StatusDateFormatted ?? null, role: s.Label ?? null, timeline: s.Timeline ?? [],
    })) : [],
    files: Array.isArray(d.Files) ? d.Files.map((f: any) => ({ id: f.Id, name: f.Name, url: f.Url })) : [],
  }
}

async function scrapeJobDocs(page: Page, jobId: string, label: string): Promise<number> {
  const folders = await apiFetch<any[]>(page, `/api/v4/job-documents/${jobId}/job-document-folders`)
  if (!Array.isArray(folders)) return 0
  let n = 0
  for (const folder of folders) {
    const files = Array.isArray(folder.Files) ? folder.Files : []
    for (const file of files) {
      const url = file.Url || file.Href
      if (!url) continue
      const fullUrl = url.startsWith('http') ? url : `${CONFIG.baseUrl}${url}`
      const folderDir = join(CONFIG.docsDir, jobId, safeName(folder.Name))
      mkdirSync(folderDir, { recursive: true })
      const dest = join(folderDir, `${String(n + 1).padStart(2, '0')}_${safeName(file.Name)}.${(file.Extension || 'pdf').toLowerCase()}`)
      const ok = await downloadFile(page, fullUrl, dest)
      const sig = signatureStatus(file)

      let packet: any = null
      const packetId = file.SmartInformation?.PacketInformation?.PacketId
      if (packetId) {
        try {
          packet = await fetchPacketData(page, packetId)
          if (packet && packet.files.length > 0) {
            const packetDir = join(folderDir, `${safeName(file.Name)}_firmado`)
            mkdirSync(packetDir, { recursive: true })
            let fIdx = 0
            for (const pf of packet.files) {
              fIdx++
              if (!pf.url) continue
              const pfUrl = pf.url.startsWith('http') ? pf.url : `${CONFIG.baseUrl}${pf.url}`
              const pfDest = join(packetDir, `${String(fIdx).padStart(2, '0')}_${safeName(pf.name || 'firma')}.pdf`)
              await downloadFile(page, pfUrl, pfDest)
              await sleep(CONFIG.pauseBetweenFilesMs)
            }
          }
        } catch (e) {
          if ((e as Error).message.startsWith('AUTH')) throw e
          packet = null
        }
      }

      appendFileSync(CONFIG.docsIndex, JSON.stringify({
        jobId, jobLabel: label,
        folder: { id: folder.Id, name: folder.Name, type: folder.FolderType, description: folder.Description ?? null },
        file: {
          id: file.Id, name: file.Name, extension: file.Extension, mimeType: file.MIMEType,
          size: file.Size ?? null, url: fullUrl,
          createdBy: file.CreatedByDisplayName ?? null, createdById: file.CreatedBy ?? null,
          createdDate: file.CreatedDate ?? null, modifiedDateUtc: file.ModifiedDateUTC ?? null,
          docType: file.JobDocumentFileType ?? null,
        },
        signature: sig, packet, localPath: dest, downloaded: ok,
        scrapedAt: new Date().toISOString(),
      }) + '\n')
      if (ok) n++
      await sleep(CONFIG.pauseBetweenFilesMs)
    }
  }
  return n
}

async function main() {
  ensureDir(CONFIG.outDir)
  const list: any[] = JSON.parse(readFileSync(CONFIG.listFile, 'utf8'))
  const done: Set<string> = existsSync(CONFIG.doneDocsFile)
    ? new Set(JSON.parse(readFileSync(CONFIG.doneDocsFile, 'utf8'))) : new Set()

  const { browser, page } = await openSession()
  console.log(`\n📄 Documentos de ${list.length} jobs (${done.size} ya hechos)…`)

  let total = 0, fails = 0
  for (let i = 0; i < list.length; i++) {
    const it = list[i]; const jobId = it.Id
    if (done.has(jobId)) continue
    const label = (it.PrimaryContact?.Name ?? it.Name ?? jobId)
    process.stdout.write(`[${i + 1}/${list.length}] ${label} … `)
    try {
      const n = await scrapeJobDocs(page, jobId, String(label))
      console.log(`${n} docs`); total += n
      done.add(jobId); writeFileSync(CONFIG.doneDocsFile, JSON.stringify([...done])); fails = 0
    } catch (e) {
      if ((e as Error).message.startsWith('AUTH')) {
        console.log('\n🛑 Sesión caída. Corre "npm run login" y reanuda "npm run docs".')
        await browser.close(); process.exit(1)
      }
      console.log('error'); fails++
      if (fails >= 3) { console.log('🛑 3 fallos seguidos. Paro.'); break }
    }
    await sleep(CONFIG.pauseBetweenJobsMs)
  }

  console.log(`\n✅ Documentos: ${total}. Índice → ${CONFIG.docsIndex}`)
  console.log(`   Ahora corre:  npm run comms`)
  await browser.close()
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1) })
