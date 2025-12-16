// Simple TradingView webhook relay:
// - Runs on your droplet under pm2
// - Receives POST /webhook from TradingView (or Cloudflare)
// - Forwards the same JSON body to your main FSM /webhook

const express = require('express');
const fetch = require('node-fetch');

const app = express();
// TradingView (or intermediaries) may send `text/plain` even when the content is JSON.
// Capture the raw body for /webhook and parse it ourselves so we never forward `{}` by accident.
app.use('/webhook', express.text({ type: '*/*' }));

const TARGET_URL =
  process.env.TARGET_URL || 'http://localhost:3000/webhook';
const PORT = process.env.PORT || 4000;

// tiny logger with timestamp + tag
function log(...args) {
  const ts = new Date().toISOString();
  console.log('[tv-relay]', ts, ...args);
}
function logError(...args) {
  const ts = new Date().toISOString();
  console.error('[tv-relay]', ts, ...args);
}

// request logging middleware (logs every hit)
let reqCounter = 0;
app.use((req, res, next) => {
  const id = ++reqCounter;
  const { method, url, headers, body } = req;

  log(`#${id} IN`, method, url);
  log(`#${id} headers`, JSON.stringify(headers));
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed) log(`#${id} bodyText`, trimmed.slice(0, 500));
  } else if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    log(`#${id} bodyJson`, JSON.stringify(body).slice(0, 500));
  } else if (body != null) {
    log(`#${id} bodyType`, typeof body);
  }

  res.on('finish', () => {
    log(`#${id} OUT`, method, url, 'status=', res.statusCode);
  });

  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, target: TARGET_URL });
});

app.post('/webhook', async (req, res) => {
  const id = reqCounter; // current request id from middleware
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const trimmed = rawBody.trim();

  let forwardContentType = 'text/plain; charset=utf-8';
  let forwardBody = rawBody;

  // If it looks like JSON and parses, forward as JSON to preserve structure.
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try {
      JSON.parse(trimmed);
      forwardContentType = 'application/json';
      forwardBody = trimmed;
    } catch {
      // Keep as text/plain
    }
  }

  log(`#${id} forwarding to FSM`, TARGET_URL);

  try {
    const resp = await fetch(TARGET_URL, {
      method: 'POST',
      headers: { 'Content-Type': forwardContentType },
      body: forwardBody,
    });

    const text = await resp.text();
    log(
      `#${id} FSM response`,
      'status=',
      resp.status,
      'bodySample=',
      text.slice(0, 300),
    );

    res.status(200).json({
      ok: true,
      forwardStatus: resp.status,
    });
  } catch (err) {
    logError(`#${id} Error forwarding to FSM`, String(err));
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.listen(PORT, () => {
  log(
    `TV relay listening on http://localhost:${PORT} → forwarding to ${TARGET_URL}`,
  );
});
