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

const STEM_MUTAGEN = {
  '甲':['廉貞','破軍','武曲','太陽'], '乙':['天機','天梁','紫微','太陰'],
  '丙':['天同','天機','文昌','廉貞'], '丁':['太陰','天同','天機','巨門'],
  '戊':['貪狼','太陰','右弼','天機'], '己':['武曲','貪狼','天梁','文曲'],
  '庚':['太陽','武曲','太陰','天同'], '辛':['巨門','太陽','文曲','文昌'],
  '壬':['天梁','紫微','左輔','武曲'], '癸':['破軍','巨門','太陰','貪狼']
};

const SANFANG = {
  '子':['辰','申','午'], '丑':['巳','酉','未'], '寅':['午','戌','申'],
  '卯':['未','亥','酉'], '辰':['申','子','戌'], '巳':['酉','丑','亥'],
  '午':['戌','寅','子'], '未':['亥','卯','丑'], '申':['子','辰','寅'],
  '酉':['丑','巳','卯'], '戌':['寅','午','辰'], '亥':['卯','未','巳']
};

app.get('/chart', (req, res) => {
  try {
    const { year, month, day, hour, gender, isNightZi } = req.query;
    if (!year || !month || !day || !hour || !gender) return res.status(400).json({ error: 'Missing parameters' });

    const iztroGender = gender === 'male' ? '男' : '女';
    let dateStr = year + '-' + month + '-' + day;
    let hourIndex = parseInt(hour);
    if (hourIndex === 0 && isNightZi === 'true') {
      const d = new Date(parseInt(year), parseInt(month)-1, parseInt(day)+1);
      dateStr = d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    }

    const chart = astro.bySolar(dateStr, hourIndex, iztroGender, true, 'zh-TW');

    // Branch map for quick lookup
    const branchMap = {};
    chart.palaces.forEach(p => { branchMap[p.earthlyBranch] = p; });

    const lifePalace = chart.palaces.find(p => p.name === '命宮');
    const lb = lifePalace ? lifePalace.earthlyBranch : '';
    const sfBranches = lb ? [lb, ...(SANFANG[lb]||[])] : [];
    const sfStars = sfBranches.flatMap(b => branchMap[b] ? branchMap[b].majorStars.map(s=>s.name) : []);

    // ── 格局 Detection ──
    const patterns = [];
    if (['七殺','破軍','貪狼'].every(s => sfStars.includes(s))) patterns.push('殺破狼格');
    if (sfStars.includes('紫微') && sfStars.includes('天府')) patterns.push('紫府三合格');
    if (sfStars.filter(s => ['廉貞','七殺','破軍','貪狼'].includes(s)).length >= 3) patterns.push('廉殺破狼強勢格');
    if (sfStars.includes('天機') && sfStars.includes('天梁')) patterns.push('機梁格');
    if (sfStars.includes('武曲') && sfStars.includes('天府')) patterns.push('武府格');
    if (sfStars.includes('日月')) patterns.push('日月格');
    // 空宮命宮
    if (lifePalace && lifePalace.majorStars.length === 0) patterns.push('空宮命宮(借星安宮)');

    // ── 宮干四化 (Palace Stem Transformations) ──
    const palaceStemFx = [];
    chart.palaces.forEach(p => {
      const m = STEM_MUTAGEN[p.heavenlyStem];
      if (!m) return;
      palaceStemFx.push({
        palace: p.name,
        stem: p.heavenlyStem,
        lu: m[0], quan: m[1], ke: m[2], ji: m[3]
      });
    });

    // ── 飛化 — Key 宮干化忌 flying into other palaces ──
    const flyingJi = [];
    const flyingLu = [];
    chart.palaces.forEach(p => {
      const m = STEM_MUTAGEN[p.heavenlyStem];
      if (!m) return;
      const jiStar = m[3];
      const luStar = m[0];
      chart.palaces.forEach(p2 => {
        const allStars = [...p2.majorStars, ...p2.minorStars].map(s => s.name);
        if (allStars.includes(jiStar) && p.name !== p2.name) {
          flyingJi.push(p.name+'→'+p2.name+'('+jiStar+'化忌)');
        }
        if (allStars.includes(luStar) && p.name !== p2.name) {
          flyingLu.push(p.name+'→'+p2.name+'('+luStar+'化祿)');
        }
      });
    });

    // ── 生年四化 ──
    const yearMutagen = { lu:'', quan:'', ke:'', ji:'' };
    chart.palaces.forEach(p => {
      [...p.majorStars, ...p.minorStars].forEach(s => {
        if (s.mutagen === '祿') yearMutagen.lu = s.name+'化祿→'+p.name;
        if (s.mutagen === '權') yearMutagen.quan = s.name+'化權→'+p.name;
        if (s.mutagen === '科') yearMutagen.ke = s.name+'化科→'+p.name;
        if (s.mutagen === '忌') yearMutagen.ji = s.name+'化忌→'+p.name;
      });
    });

    // ── Per-palace data with decade 四化 ──
    const palaces = chart.palaces.map(p => {
      let decadeMutagen = [];
      if (p.decadal && p.decadal.range) {
        try {
          const midYear = parseInt(year) + p.decadal.range[0] + 5;
          const h = chart.horoscope(midYear+'-06-01');
          decadeMutagen = h.decadal.mutagen || [];
        } catch(e) {}
      }
      const pStemFx = STEM_MUTAGEN[p.heavenlyStem] || [];
      return {
        stem: p.heavenlyStem,
        branch: p.earthlyBranch,
        name: p.name,
        isLifePalace: p.name === '命宮',
        isBodyPalace: p.isBodyPalace,
        decadeRange: p.decadal ? p.decadal.range.join('-') : '',
        decadeStem: p.decadal ? p.decadal.heavenlyStem : '',
        palaceStemFx: pStemFx, // [化祿,化權,化科,化忌] for this palace's stem
        decadeMutagen: decadeMutagen,
        majorStars: p.majorStars.map(s => ({ name:s.name, brightness:s.brightness||'', mutagen:s.mutagen||'' })),
        minorStars: p.minorStars.map(s => ({ name:s.name, brightness:s.brightness||'', mutagen:s.mutagen||'' }))
      };
    });

    // ── 小限 data for last year, this year, next year ──
    const currentYear = new Date().getFullYear();
    const yearlyData = {};
    [currentYear-1, currentYear, currentYear+1].forEach(yr => {
      try {
        const h = chart.horoscope(yr+'-06-01');
        const age = h.age;
        const yearly = h.yearly;
        const xiaoXianPalace = age.palaceNames ? age.palaceNames[0] : '?';
        yearlyData[yr] = {
          age: age.nominalAge,
          xiaoXianPalace: xiaoXianPalace,
          xiaoXianStem: age.heavenlyStem,
          xiaoXianBranch: age.earthlyBranch,
          xiaoXianMutagen: age.mutagen || [],
          yearlyMutagen: yearly.mutagen || [],
          yearlyStem: yearly.heavenlyStem,
          yearlyBranch: yearly.earthlyBranch
        };
      } catch(e) {}
    });

    res.json({
      lunarDate: chart.lunarDate,
      chinesePillars: chart.chineseDate,
      fiveElements: chart.fiveElementsClass,
      lifeMaster: chart.soul,
      bodyMaster: chart.body,
      yearMutagen,
      patterns,
      flyingJi: flyingJi.slice(0, 8),  // most significant
      flyingLu: flyingLu.slice(0, 6),
      yearlyData,
      palaces
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
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body), 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' }
  };
  const proxyReq = https.request(options, proxyRes => {
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => res.status(proxyRes.statusCode).set('Content-Type','application/json').send(Buffer.concat(chunks).toString('utf8')));
  });
  proxyReq.on('error', err => res.status(500).json({ error: { message: err.message } }));
  proxyReq.write(body); proxyReq.end();
});

// Streaming proxy endpoint
app.post('/stream', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
  if (!apiKey) { res.status(400).end('no key'); return; }

  const streamBody = JSON.stringify({ ...req.body, stream: true });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const options = {
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(streamBody), 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' }
  };
  const proxyReq = https.request(options, proxyRes => {
    proxyRes.on('data', chunk => res.write(chunk));
    proxyRes.on('end', () => res.end());
  });
  proxyReq.on('error', err => { res.write('data: {"error":"'+err.message+'"}\n\n'); res.end(); });
  proxyReq.write(streamBody); proxyReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Zi Wei proxy running on port ' + PORT));
