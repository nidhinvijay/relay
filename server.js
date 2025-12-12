// Simple TradingView webhook relay:
// - Runs on your droplet under pm2
// - Receives POST /webhook from TradingView (or Cloudflare)
// - Forwards the same JSON body to your main FSM /webhook

const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

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
  if (body && Object.keys(body).length > 0) {
    log(`#${id} body`, JSON.stringify(body));
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
  const body = req.body;

  log(`#${id} forwarding to FSM`, TARGET_URL);

  try {
    const resp = await fetch(TARGET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
