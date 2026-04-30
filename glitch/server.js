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

app.get('/chart', (req, res) => {
  try {
    const { year, month, day, hour, gender, isNightZi } = req.query;
    if (!year || !month || !day || !hour || !gender) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    const iztroGender = gender === 'male' ? '男' : '女';
    let dateStr = year + '-' + month + '-' + day;
    let hourIndex = parseInt(hour);

    if (hourIndex === 0 && isNightZi === 'true') {
      const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day) + 1);
      dateStr = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
    }

    const chart = astro.bySolar(dateStr, hourIndex, iztroGender, true, 'zh-TW');

    // ── Build enriched palace data ──
    const palaces = chart.palaces.map(p => {
      // Get decade 四化 for this palace's decade
      let decadeMutagen = [];
      if (p.decadal && p.decadal.range) {
        try {
          const midYear = parseInt(year) + p.decadal.range[0] + 5;
          const h = chart.horoscope(midYear + '-06-01');
          decadeMutagen = h.decadal.mutagen || [];
        } catch(e) {}
      }

      return {
        stem: p.heavenlyStem,
        branch: p.earthlyBranch,
        name: p.name,
        isLifePalace: p.name === '命宮',
        isBodyPalace: p.isBodyPalace,
        decadeRange: p.decadal ? p.decadal.range.join('-') : '',
        decadeStem: p.decadal ? p.decadal.heavenlyStem : '',
        decadeBranch: p.decadal ? p.decadal.earthlyBranch : '',
        // 大限四化: [化祿星, 化權星, 化科星, 化忌星]
        decadeMutagen: decadeMutagen,
        majorStars: p.majorStars.map(s => ({
          name: s.name,
          brightness: s.brightness || '',
          mutagen: s.mutagen || '',
          type: s.type || 'major'
        })),
        minorStars: p.minorStars.map(s => ({
          name: s.name,
          brightness: s.brightness || '',
          mutagen: s.mutagen || '',
          type: s.type || 'minor'
        }))
      };
    });

    // ── Build 生年四化 summary ──
    const yearMutagen = { lu: '', quan: '', ke: '', ji: '' };
    palaces.forEach(p => {
      p.majorStars.concat(p.minorStars).forEach(s => {
        if (s.mutagen === '祿') yearMutagen.lu = s.name + '化祿在' + p.name;
        if (s.mutagen === '權') yearMutagen.quan = s.name + '化權在' + p.name;
        if (s.mutagen === '科') yearMutagen.ke = s.name + '化科在' + p.name;
        if (s.mutagen === '忌') yearMutagen.ji = s.name + '化忌在' + p.name;
      });
    });

    res.json({
      lunarDate: chart.lunarDate,
      chinesePillars: chart.chineseDate,
      fiveElements: chart.fiveElementsClass,
      lifeMaster: chart.soul,
      bodyMaster: chart.body,
      yearMutagen: yearMutagen,
      palaces: palaces
    });

  } catch(e) {
    console.error('Chart error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/proxy', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: { message: 'No API key configured.' } });

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
