# Prospector Google Maps (Scraping)

Aplicação web para prospecção ativa no Google Maps sem API.

## O que faz

- Recebe **segmento, cidade e estado** no formulário.
- Entra no Google Maps, executa a busca e identifica os cards de resultados.
- Faz scroll automático até parar de carregar novos resultados.
- Clica nos cards e coleta: **nome, telefone, endereço, site, avaliação e link do Google Maps**.
- Exibe tudo em tempo real no site com logs do processo (SSE).

## Execução rápida (sem npm install)

Você já pode abrir o site para validar interface e fluxo básico:

```bash
node server.js
```

Depois acesse `http://localhost:3000` e marque **Modo teste (sem abrir Google Maps real)**.

## Execução completa (scraping real)

```bash
npm install
npx playwright install chromium
npm start
```

## Como testar agora (passo a passo)

1. **Teste de servidor:**
   - Rode `node server.js`
   - Valide saúde com `curl http://localhost:3000/health`
2. **Teste do fluxo do app sem scraping real (recomendado primeiro):**
   - Abra `http://localhost:3000`
   - Preencha segmento/cidade/estado
   - Marque **Modo teste**
   - Clique em **Iniciar captura**
   - Você verá logs e leads de exemplo em tempo real
3. **Teste real no Google Maps:**
   - Desmarque **Modo teste**
   - Inicie a captura
   - Acompanhe logs de entrada no Maps, scroll e contagem de cards

## Erro de npm 403 (se aparecer)

Se ocorrer `403 Forbidden` no `npm install`, normalmente é bloqueio de rede/proxy do ambiente.

Verificações úteis:

```bash
npm config get registry
npm config list -l | grep -E "proxy|registry"
```

Ajustes comuns (quando você tiver acesso a internet sem proxy corporativo):

```bash
npm config delete proxy
npm config delete https-proxy
npm config set registry https://registry.npmjs.org/
```

## Observações importantes

- O Google Maps altera seletores com frequência. Ajustes pontuais podem ser necessários.
- Scraping pode acionar bloqueios/captcha em volumes altos.
- Use com responsabilidade e respeite termos legais e regulatórios do seu contexto.
