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
    console.log('Windada status:', resp.statusCode, '| URL:', urlStr.slice(0, 80));

    if ((resp.statusCode === 301 || resp.statusCode === 302) && resp.headers.location) {
      const loc = resp.headers.location.startsWith('http')
        ? resp.headers.location
        : 'https://fate.windada.com' + resp.headers.location;
      console.log('Redirect to:', loc);
      resp.resume();
      return fetchWindada(loc, callback);
    }

    resp.on('data', chunk => chunks.push(chunk));
    resp.on('end', () => {
      const buf = Buffer.concat(chunks);
      let html = '';
      try { html = new TextDecoder('big5').decode(buf); } catch(e) {
        try { html = new TextDecoder('gbk').decode(buf); } catch(e2) {
          html = buf.toString('utf8');
        }
      }
      console.log('Length:', html.length, '| Has palaces:', html.includes('【'));
      callback(null, html);
    });
  });

  req2.on('error', (err) => { console.error('Fetch error:', err.message); callback(err); });
  req2.setTimeout(15000, () => { req2.destroy(); callback(new Error('Timeout fetching Windada')); });
  req2.end();
}

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
    res.json({ html, hasPalaces: html.includes('【') });
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
