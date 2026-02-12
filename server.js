import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 3000);

function sseSend(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function textOrNull(locator) {
  try {
    const text = await locator.first().innerText({ timeout: 2500 });
    return text?.trim() || null;
  } catch {
    return null;
  }
}


async function acceptConsentIfPresent(page, onEvent) {
  const consentButtons = [
    'button:has-text("Aceitar tudo")',
    'button:has-text("Accept all")',
    'button[aria-label="Aceitar tudo"]',
  ];

  for (const selector of consentButtons) {
    const btn = page.locator(selector).first();
    if (await btn.count()) {
      try {
        await btn.click({ timeout: 2500 });
        onEvent({ type: 'log', message: 'Banner de consentimento aceito.' });
        await page.waitForTimeout(1200);
        return;
      } catch {
        // tenta próximo seletor
      }
    }
  }
}

async function getPlaywrightChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    throw new Error(
      'Dependência "playwright" não instalada. Rode: npm install && npx playwright install chromium',
    );
  }
}

async function scrapeGoogleMaps({ segment, city, state, maxLeads, onEvent }) {
  const query = `${segment} em ${city}, ${state}`;
  const chromium = await getPlaywrightChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();

  const leads = [];
  const seenNames = new Set();

  try {
    onEvent({ type: 'log', message: `Abrindo Google Maps para: ${query}` });
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await acceptConsentIfPresent(page, onEvent);

    const feed = page.locator('div[role="feed"]');
    const feedFallback = page.locator('a.hfpxzc');

    try {
      await feed.waitFor({ timeout: 35000 });
      onEvent({ type: 'log', message: 'Lista de cards encontrada.' });
    } catch {
      const fallbackCount = await feedFallback.count();
      if (!fallbackCount) {
        throw new Error('Não foi possível localizar a lista de resultados. O Google pode ter exibido bloqueio/captcha.');
      }
      onEvent({ type: 'log', message: 'Resultados detectados por seletor alternativo.' });
    }

    let processed = 0;
    let stagnantCycles = 0;

    while (leads.length < maxLeads && stagnantCycles < 6) {
      const cards = page.locator('div[role="feed"] div[role="article"], a.hfpxzc');
      const totalVisible = await cards.count();

      onEvent({
        type: 'log',
        message: `Cards visíveis no momento: ${totalVisible}. Processados até agora: ${processed}.`,
      });

      if (processed >= totalVisible) {
        onEvent({ type: 'log', message: 'Realizando scroll para carregar mais cards...' });
        if (await feed.count()) {
          await feed.evaluate((node) => {
            node.scrollBy(0, node.clientHeight * 0.9);
          });
        } else {
          await page.mouse.wheel(0, 1800);
        }
        await page.waitForTimeout(1800);

        const afterScroll = await cards.count();
        if (afterScroll > totalVisible) {
          stagnantCycles = 0;
          onEvent({ type: 'log', message: `Novos cards carregados: ${afterScroll - totalVisible}.` });
        } else {
          stagnantCycles += 1;
          onEvent({
            type: 'log',
            message: `Nenhum card novo após scroll (${stagnantCycles}/6).`,
          });
        }
        continue;
      }

      for (; processed < totalVisible && leads.length < maxLeads; processed += 1) {
        const card = cards.nth(processed);

        try {
          await card.scrollIntoViewIfNeeded();
          await card.click({ timeout: 5000, force: true });
          await page.waitForTimeout(1500);

          const name = await textOrNull(page.locator('h1.DUwDvf'));
          if (!name || seenNames.has(name)) {
            continue;
          }

          const address = await textOrNull(page.locator('button[data-item-id="address"] div.fontBodyMedium'));
          const phone = await textOrNull(page.locator('button[data-item-id^="phone:"] div.fontBodyMedium'));
          const website = await page
            .locator('a[data-item-id="authority"]')
            .first()
            .getAttribute('href')
            .catch(() => null);
          const rating = await page
            .locator('div.F7nice span[aria-hidden="true"]')
            .first()
            .innerText({ timeout: 1500 })
            .then((t) => t.trim())
            .catch(() => null);

          const lead = {
            name,
            address,
            phone,
            website,
            rating,
            mapsLink: page.url(),
          };

          seenNames.add(name);
          leads.push(lead);

          onEvent({
            type: 'lead',
            lead,
            captured: leads.length,
            visible: totalVisible,
            message: `Card capturado: ${leads.length}/${Math.max(totalVisible, leads.length)}`,
          });
        } catch (error) {
          onEvent({
            type: 'log',
            message: `Falha ao processar card ${processed + 1}: ${error.message}`,
          });
        }
      }
    }

    if (stagnantCycles >= 6) {
      onEvent({
        type: 'log',
        message: 'Scroll atingiu limite sem novos resultados. Finalizando coleta.',
      });
    }

    onEvent({
      type: 'done',
      leads,
      message: `Coleta finalizada com ${leads.length} leads únicos.`,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

async function serveFile(filePath, contentType, res) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Arquivo não encontrado' }));
  }
}

function runDryMode({ maxLeads, onEvent }) {
  const total = Math.min(maxLeads, 5);
  onEvent({ type: 'log', message: 'Modo teste ativado (dryRun=true).' });
  onEvent({ type: 'log', message: 'Entrando no Google Maps...' });
  onEvent({ type: 'log', message: 'Localizando cards...' });

  for (let i = 1; i <= total; i += 1) {
    onEvent({ type: 'log', message: 'Realizando scroll para carregar mais cards...' });
    onEvent({
      type: 'lead',
      captured: i,
      visible: total,
      message: `Card capturado: ${i}/${total}`,
      lead: {
        name: `Lead Exemplo ${i}`,
        phone: '(11) 99999-0000',
        address: `Rua Exemplo, ${i} - Centro`,
        website: 'https://example.com',
        rating: '4,8',
        mapsLink: 'https://maps.google.com',
      },
    });
  }

  onEvent({ type: 'done', leads: [], message: `Coleta finalizada com ${total} leads de exemplo.` });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (requestUrl.pathname === '/api/scrape/stream') {
    const segment = requestUrl.searchParams.get('segment');
    const city = requestUrl.searchParams.get('city');
    const state = requestUrl.searchParams.get('state');
    const maxLeads = requestUrl.searchParams.get('maxLeads') ?? '100';
    const dryRun = requestUrl.searchParams.get('dryRun') === 'true';

    if (!segment || !city || !state) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'segment, city e state são obrigatórios.' }));
      return;
    }

    const max = Math.max(1, Math.min(500, Number(maxLeads) || 100));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    try {
      if (dryRun) {
        runDryMode({ maxLeads: max, onEvent: (payload) => !closed && sseSend(res, payload) });
      } else {
        await scrapeGoogleMaps({
          segment,
          city,
          state,
          maxLeads: max,
          onEvent: (payload) => {
            if (!closed) sseSend(res, payload);
          },
        });
      }
    } catch (error) {
      if (!closed) {
        sseSend(res, {
          type: 'error',
          message: `Erro no scraping: ${error.message}`,
        });
      }
    } finally {
      res.end();
    }

    return;
  }

  if (requestUrl.pathname === '/') {
    await serveFile(path.join(publicDir, 'index.html'), 'text/html; charset=utf-8', res);
    return;
  }

  if (requestUrl.pathname === '/app.js') {
    await serveFile(path.join(publicDir, 'app.js'), 'text/javascript; charset=utf-8', res);
    return;
  }

  if (requestUrl.pathname === '/styles.css') {
    await serveFile(path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8', res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Rota não encontrada' }));
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
