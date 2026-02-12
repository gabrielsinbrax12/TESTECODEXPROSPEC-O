import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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

async function scrapeGoogleMaps({ segment, city, state, maxLeads, onEvent }) {
  const query = `${segment} em ${city}, ${state}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();

  const leads = [];
  const seenNames = new Set();

  try {
    onEvent({ type: 'log', message: `Abrindo Google Maps para: ${query}` });
    await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 60000 });

    const searchInput = page.locator('#searchboxinput');
    await searchInput.fill(query);
    onEvent({ type: 'log', message: 'Pesquisa preenchida, iniciando busca...' });
    await searchInput.press('Enter');

    const feed = page.locator('div[role="feed"]');
    await feed.waitFor({ timeout: 30000 });
    onEvent({ type: 'log', message: 'Lista de cards encontrada.' });

    let processed = 0;
    let stagnantCycles = 0;

    while (leads.length < maxLeads && stagnantCycles < 6) {
      const cards = page.locator('div[role="feed"] div[role="article"]');
      const totalVisible = await cards.count();

      onEvent({
        type: 'log',
        message: `Cards visíveis no momento: ${totalVisible}. Processados até agora: ${processed}.`,
      });

      if (processed >= totalVisible) {
        onEvent({ type: 'log', message: 'Realizando scroll para carregar mais cards...' });
        await feed.evaluate((node) => {
          node.scrollBy(0, node.clientHeight * 0.9);
        });
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
          await card.click({ timeout: 5000 });
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

app.get('/api/scrape/stream', async (req, res) => {
  const { segment, city, state, maxLeads = '100' } = req.query;

  if (!segment || !city || !state) {
    return res.status(400).json({ error: 'segment, city e state são obrigatórios.' });
  }

  const max = Math.max(1, Math.min(500, Number(maxLeads) || 100));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    await scrapeGoogleMaps({
      segment,
      city,
      state,
      maxLeads: max,
      onEvent: (payload) => {
        if (!closed) sseSend(res, payload);
      },
    });
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
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
