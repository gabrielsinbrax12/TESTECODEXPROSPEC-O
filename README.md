# Prospector Google Maps (Scraping)

Aplicação web para prospecção ativa no Google Maps sem API.

## O que faz

- Recebe **segmento, cidade e estado** no formulário.
- Entra no Google Maps, executa a busca e identifica os cards de resultados.
- Faz scroll automático até parar de carregar novos resultados.
- Clica nos cards e coleta: **nome, telefone, endereço, site, avaliação e link do Google Maps**.
- Exibe tudo em tempo real no site com logs do processo (SSE).

## Como executar

```bash
npm install
npx playwright install chromium
npm start
```

Acesse `http://localhost:3000`.

## Observações importantes

- O Google Maps altera seletores com frequência. Ajustes pontuais podem ser necessários.
- Scraping pode acionar bloqueios/captcha em volumes altos.
- Use com responsabilidade e respeite termos legais e regulatórios do seu contexto.
