import { chromium, type Browser, type Page } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { CONFIG } from './config.js'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Abre el navegador con la sesión guardada y navega a /jobs (valida sesión).
export async function openSession(): Promise<{ browser: Browser; page: Page }> {
  if (!existsSync(CONFIG.storageStatePath)) {
    console.error('\n❌ No hay sesión. Corre:  npm run login\n')
    process.exit(1)
  }
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    storageState: CONFIG.storageStatePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: 1360, height: 900 },
  })
  const page = await context.newPage()
  await page.goto(`${CONFIG.baseUrl}/jobs`, { waitUntil: 'domcontentloaded' })
  await sleep(2000)
  if (/login|signin/i.test(page.url())) {
    console.error('\n❌ Sesión caducada. Corre "npm run login".\n')
    await browser.close()
    process.exit(1)
  }
  return { browser, page }
}

// GET/POST autenticado a la API de AccuLynx (fetch DENTRO del navegador logueado).
export async function apiFetch<T>(
  page: Page,
  path: string,
  opts?: { method?: 'GET' | 'POST'; body?: any },
): Promise<T | null> {
  const method = opts?.method ?? 'GET'
  const body = opts?.body ?? null
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const result = await page.evaluate(
        async ({ path, tz, method, body }) => {
          const res = await fetch(path, {
            method,
            headers: {
              accept: 'application/json, text/plain, */*',
              'x-device-time-zone': tz,
              ...(body ? { 'content-type': 'application/json' } : {}),
            },
            credentials: 'include',
            ...(body ? { body: JSON.stringify(body) } : {}),
          })
          const text = await res.text()
          return { ok: res.ok, status: res.status, text }
        },
        { path, tz: CONFIG.deviceTimeZone, method, body },
      )
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) throw new Error(`AUTH ${result.status}`)
        return null
      }
      return result.text ? (JSON.parse(result.text) as T) : (null as any)
    } catch (e) {
      if ((e as Error).message.startsWith('AUTH')) throw e
      await sleep(600 * attempt)
    }
  }
  return null
}

// Descarga un archivo (imagen/pdf) usando la sesión del navegador.
export async function downloadFile(page: Page, url: string, destPath: string): Promise<boolean> {
  try {
    mkdirSync(dirname(destPath), { recursive: true })
    const resp = await page.request.get(url)
    if (!resp.ok()) return false
    const buf = await resp.body()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(destPath, buf)
    return true
  } catch {
    return false
  }
}

export function ensureDir(p: string) { mkdirSync(p, { recursive: true }) }
export function ensureParent(p: string) { mkdirSync(dirname(p), { recursive: true }) }
