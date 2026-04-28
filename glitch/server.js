const express = require('express');
const https = require('https');
const http = require('http');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Fetch & parse Windada chart ──
app.get('/windada', (req, res) => {
  const { sex, year, month, day, hour } = req.query;
  if (!sex || !year || !month || !day || !hour) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const path = '/cgi-bin/fate?Sex=' + encodeURIComponent(sex) +
    '&Year=' + year + '&Month=' + month + '&Day=' + day +
    '&Hour=' + hour + '&Calendar=S';

  const options = {
    hostname: 'fate.windada.com',
    path: path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Accept': '*/*'
    }
  };

  const chunks = [];
  const proxyReq = http.request(options, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      // follow redirect
      const loc = proxyRes.headers.location;
      const redirOptions = {
        hostname: 'fate.windada.com',
        path: loc,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': '*/*' }
      };
      const redirChunks = [];
      const redirReq = http.request(redirOptions, (rRes) => {
        rRes.on('data', c => redirChunks.push(c));
        rRes.on('end', () => {
          const html = Buffer.concat(redirChunks).toString('binary');
          res.json({ html, status: rRes.statusCode });
        });
      });
      redirReq.on('error', e => res.status(500).json({ error: e.message }));
      redirReq.end();
      return;
    }
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      const html = Buffer.concat(chunks).toString('binary');
      res.json({ html, status: proxyRes.statusCode });
    });
  });

  proxyReq.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
  proxyReq.end();
});

// ── Proxy Anthropic API ──
app.post('/proxy', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: { message: 'No API key provided' } });

  const body = JSON.stringify(req.body);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf8');
      res.status(proxyRes.statusCode).set('Content-Type', 'application/json').send(data);
    });
  });

  proxyReq.on('error', (err) => {
    res.status(500).json({ error: { message: err.message } });
  });

  proxyReq.write(body);
  proxyReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Zi Wei proxy running on port ' + PORT));
