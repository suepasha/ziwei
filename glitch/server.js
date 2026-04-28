const express = require('express');
const https = require('https');
const { astro } = require('iztro');
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

// ── Calculate ZWDS chart using iztro ──
app.get('/chart', (req, res) => {
  try {
    const { year, month, day, hour, gender } = req.query;
    if (!year || !month || !day || !hour || !gender) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // iztro hour index: 0=子 1=丑 2=寅 3=卯 4=辰 5=巳 6=午 7=未 8=申 9=酉 10=戌 11=亥
    const hourIndex = parseInt(hour);
    const iztroGender = gender === 'male' ? '男' : '女';
    const dateStr = year + '-' + month + '-' + day;

    const chart = astro.bySolar(dateStr, hourIndex, iztroGender, true, 'zh-TW');

    const palaces = chart.palaces.map(p => ({
      stem: p.heavenlyStem,
      branch: p.earthlyBranch,
      name: p.name,
      isLifePalace: p.name === '命宮',
      isBodyPalace: p.isBodyPalace,
      decadeRange: p.decadal ? p.decadal.range : '',
      majorStars: p.majorStars.map(s => s.name + (s.mutagen || '')),
      minorStars: p.minorStars.map(s => s.name + (s.mutagen || ''))
    }));

    res.json({
      lunarDate: chart.lunarDate,
      chinesePillars: chart.chineseDate,
      fiveElements: chart.fiveElementsClass,
      lifeMaster: chart.soul,
      bodyMaster: chart.body,
      yearTransforms: chart.yearlyDecChanges || '',
      palaces: palaces
    });

  } catch(e) {
    console.error('Chart error:', e.message);
    res.status(500).json({ error: e.message });
  }
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
      res.status(proxyRes.statusCode).set('Content-Type', 'application/json').send(Buffer.concat(chunks).toString('utf8'));
    });
  });

  proxyReq.on('error', (err) => res.status(500).json({ error: { message: err.message } }));
  proxyReq.write(body);
  proxyReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Zi Wei proxy running on port ' + PORT));
