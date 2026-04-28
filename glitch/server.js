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

// ── Fetch Windada chart ──
app.get('/windada', (req, res) => {
  const { sex, year, month, day, hour } = req.query;
  if (!sex || !year || !month || !day || !hour) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const path = '/cgi-bin/fate?Sex=' + encodeURIComponent(sex) +
    '&Year=' + year + '&Month=' + month + '&Day=' + day +
    '&Hour=' + hour + '&Calendar=S';

  console.log('Fetching Windada:', path);

  const options = {
    hostname: 'fate.windada.com',
    port: 80,
    path: path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      'Referer': 'http://fate.windada.com/',
      'Connection': 'keep-alive'
    }
  };

  function fetchUrl(opts, callback) {
    const chunks = [];
    const req2 = http.request(opts, (resp) => {
      console.log('Windada status:', resp.statusCode, 'Content-Type:', resp.headers['content-type']);

      // Handle redirect
      if ((resp.statusCode === 301 || resp.statusCode === 302) && resp.headers.location) {
        const loc = resp.headers.location;
        console.log('Redirect to:', loc);
        const newPath = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
        return fetchUrl({ ...opts, path: newPath }, callback);
      }

      resp.on('data', chunk => chunks.push(chunk));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Decode Big5 (Windada uses Big5/CNS encoding)
        let html = '';
        try {
          const decoder = new TextDecoder('big5');
          html = decoder.decode(buf);
        } catch(e) {
          try {
            const decoder2 = new TextDecoder('gbk');
            html = decoder2.decode(buf);
          } catch(e2) {
            html = buf.toString('utf8');
          }
        }
        console.log('Response length:', html.length, '| Has palace marker:', html.includes('【'));
        callback(null, html, resp.statusCode);
      });
    });
    req2.on('error', (err) => callback(err));
    req2.setTimeout(10000, () => { req2.abort(); callback(new Error('Timeout')); });
    req2.end();
  }

  fetchUrl(options, (err, html, statusCode) => {
    if (err) {
      console.error('Windada fetch error:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ html, status: statusCode, hasPalaces: html.includes('【') });
  });
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
