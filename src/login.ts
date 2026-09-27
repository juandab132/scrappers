// ─────────────────────────────────────────────────────────────────────────────
//  PASO 1 — Login manual (una sola vez, o cuando caduque la sesión).
//
//  Abre un Chromium visible, TÚ inicias sesión a mano en AccuLynx (resuelve el
//  Cloudflare si aparece), y cuando estés dentro presionas ENTER en la terminal.
//  Guarda tus cookies en session/storageState.json.
//
//  Uso:  npm run list
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { CONFIG } from './config.js';

function waitForEnter(msg: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(msg, () => {
      rl.close();
      resolve();
    }),
  );
}

async function main() {
  mkdirSync(dirname(CONFIG.storageStatePath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: 1360, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`${CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded' });

  console.log('\n────────────────────────────────────────────────────────');
  console.log('  Inicia sesión EN LA VENTANA que se abrió.');
  console.log('  Resuelve el Cloudflare si aparece y entra a AccuLynx.');
  console.log('  Cuando ya estés DENTRO, vuelve aquí y presiona ENTER.');
  console.log('────────────────────────────────────────────────────────\n');

  await waitForEnter('👉 Presiona ENTER cuando ya estés logueado... ');

  await context.storageState({ path: CONFIG.storageStatePath });
  console.log(`\n✅ Sesión guardada en ${CONFIG.storageStatePath}`);
  console.log('   Ahora corre:  npm run list  (o  npm run all)\n');

  await browser.close();
}

main().catch((e) => {
  console.error('Error en login:', e);
  process.exit(1);
});
