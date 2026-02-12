const form = document.getElementById('scrapeForm');
const logsEl = document.getElementById('logs');
const statusEl = document.getElementById('status');
const rowsEl = document.getElementById('leadRows');

let eventSource = null;

function appendLog(message) {
  logsEl.textContent += `[${new Date().toLocaleTimeString()}] ${message}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function addRow(lead, index) {
  const row = document.createElement('tr');
  const website = lead.website ? `<a href="${lead.website}" target="_blank">Site</a>` : '-';
  const maps = lead.mapsLink ? `<a href="${lead.mapsLink}" target="_blank">Abrir</a>` : '-';

  row.innerHTML = `
    <td>${index + 1}</td>
    <td>${lead.name ?? '-'}</td>
    <td>${lead.phone ?? '-'}</td>
    <td>${lead.address ?? '-'}</td>
    <td>${website}</td>
    <td>${lead.rating ?? '-'}</td>
    <td>${maps}</td>
  `;
  rowsEl.appendChild(row);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  if (eventSource) {
    eventSource.close();
  }

  logsEl.textContent = '';
  rowsEl.innerHTML = '';

  const params = new URLSearchParams(new FormData(form));
  statusEl.textContent = 'Iniciando scraping...';
  appendLog('Entrando no Google Maps...');

  eventSource = new EventSource(`/api/scrape/stream?${params.toString()}`);

  eventSource.onmessage = (message) => {
    const payload = JSON.parse(message.data);

    if (payload.type === 'log') {
      appendLog(payload.message);
      statusEl.textContent = payload.message;
      return;
    }

    if (payload.type === 'lead') {
      addRow(payload.lead, payload.captured - 1);
      appendLog(payload.message);
      statusEl.textContent = `${payload.message} | Total capturado: ${payload.captured}`;
      return;
    }

    if (payload.type === 'done') {
      appendLog(payload.message);
      statusEl.textContent = payload.message;
      eventSource.close();
      eventSource = null;
      return;
    }

    if (payload.type === 'error') {
      appendLog(payload.message);
      statusEl.textContent = 'Erro durante a captura';
      eventSource.close();
      eventSource = null;
    }
  };

  eventSource.onerror = () => {
    appendLog('Conexão SSE encerrada.');
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
});
