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

function fetchWindada(urlStr, callback) {
  const isHttps = urlStr.startsWith('https');
  const lib = isHttps ? https : http;
  const url = new URL(urlStr);

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      'Referer': 'https://fate.windada.com/',
      'Connection': 'keep-alive'
    }
  };

  const chunks = [];
  const req2 = lib.request(options, (resp) => {
    console.log('Status:', resp.statusCode, '| Content-Type:', resp.headers['content-type']);
    if ((resp.statusCode === 301 || resp.statusCode === 302) && resp.headers.location) {
      const loc = resp.headers.location.startsWith('http')
        ? resp.headers.location
        : 'https://fate.windada.com' + resp.headers.location;
      resp.resume();
      return fetchWindada(loc, callback);
    }
    resp.on('data', chunk => chunks.push(chunk));
    resp.on('end', () => {
      const buf = Buffer.concat(chunks);
      // Try all encodings, pick the one that has palace markers
      const encodings = ['big5', 'cp950', 'gbk', 'utf-8'];
      let html = '';
      let usedEnc = 'none';
      for (const enc of encodings) {
        try {
          const decoded = new TextDecoder(enc).decode(buf);
          if (decoded.includes('\u3010') || decoded.includes('命宮') || decoded.includes('命宫') || decoded.includes('\u5927\u9650')) {
            html = decoded;
            usedEnc = enc;
            break;
          }
          if (!html) html = decoded; // keep first successful decode as fallback
        } catch(e) {}
      }
      console.log('Encoding used:', usedEnc, '| Length:', html.length);
      console.log('Has 【:', html.includes('\u3010'), '| Has 命宮:', html.includes('命宮') || html.includes('命宫'));
      console.log('Snippet:', html.slice(0, 300).replace(/\s+/g, ' '));
      callback(null, html, buf);
    });
  });
  req2.on('error', (err) => callback(err));
  req2.setTimeout(20000, () => { req2.destroy(); callback(new Error('Timeout')); });
  req2.end();
}

// Debug endpoint — returns raw info
app.get('/debug', (req, res) => {
  const url = 'https://fate.windada.com/cgi-bin/fate?Sex=%E5%A5%B3&Year=1967&Month=7&Day=1&Hour=9&Calendar=S';
  fetchWindada(url, (err, html, buf) => {
    if (err) return res.json({ error: err.message });
    res.json({
      length: html.length,
      hasPalaceMarker: html.includes('\u3010'),
      hasCommandPalace: html.includes('命宮') || html.includes('命宫'),
      first500: html.slice(0, 500),
      hexStart: buf ? buf.slice(0, 40).toString('hex') : ''
    });
  });
});

app.get('/windada', (req, res) => {
  const { sex, year, month, day, hour } = req.query;
  if (!sex || !year || !month || !day || !hour) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  const url = 'https://fate.windada.com/cgi-bin/fate?Sex=' + encodeURIComponent(sex) +
    '&Year=' + year + '&Month=' + month + '&Day=' + day +
    '&Hour=' + hour + '&Calendar=S';

  fetchWindada(url, (err, html) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ html, hasPalaces: html.includes('\u3010') || html.includes('命宮') || html.includes('命宫') });
  });
});

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
      res.status(proxyRes.statusCode).set('Content-Type', 'application/json').send(Buffer.concat(chunks).toString('utf8'));
    });
  });
  proxyReq.on('error', (err) => res.status(500).json({ error: { message: err.message } }));
  proxyReq.write(body);
  proxyReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Zi Wei proxy running on port ' + PORT));
