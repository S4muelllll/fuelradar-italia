const express = require('express');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;
const MIMIT_API = 'https://carburanti.mise.gov.it/ospzApi';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://tile.openstreetmap.org"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const cache = new Map();
const CACHE_MS = 30 * 1000;

function cacheKey(body) {
  return JSON.stringify(body);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, raw: text }; }
  if (!response.ok) {
    const err = new Error(`MIMIT API ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

app.post('/api/zone', async (req, res) => {
  try {
    const { lat, lng, radius = 10, fuelType = '1-x', priceOrder = 'asc' } = req.body || {};
    const latitude = Number(lat);
    const longitude = Number(lng);
    const r = Math.min(Math.max(Number(radius) || 10, 0.5), 10);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Coordinate non valide.' });
    }

    const body = {
      points: [{ lat: latitude, lng: longitude }],
      fuelType: String(fuelType),
      priceOrder: priceOrder === 'desc' ? 'desc' : 'asc',
      radius: r
    };
    const key = cacheKey(body);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return res.json({ ...hit.data, meta: { source: 'MIMIT Osservaprezzi', cached: true, fetchedAt: new Date(hit.at).toISOString() } });
    }

    const data = await postJson(`${MIMIT_API}/search/zone`, body);
    cache.set(key, { at: Date.now(), data });
    res.json({ ...data, meta: { source: 'MIMIT Osservaprezzi', cached: false, fetchedAt: new Date().toISOString() } });
  } catch (error) {
    res.status(error.status || 502).json({
      error: 'Impossibile raggiungere i dati live del Ministero in questo momento.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/area', async (req, res) => {
  try {
    const { region, province, town, fuelType = '1-x', priceOrder = 'asc' } = req.body || {};
    if (!province || !town) return res.status(400).json({ error: 'Comune e provincia sono richiesti.' });
    const body = {
      region: Number(region) || undefined,
      province: String(province),
      town: String(town),
      fuelType: String(fuelType),
      priceOrder: priceOrder === 'desc' ? 'desc' : 'asc'
    };
    const data = await postJson(`${MIMIT_API}/search/area`, body);
    res.json({ ...data, meta: { source: 'MIMIT Osservaprezzi', cached: false, fetchedAt: new Date().toISOString() } });
  } catch (error) {
    res.status(error.status || 502).json({
      error: 'Impossibile raggiungere i dati live del Ministero in questo momento.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || q.length > 120) return res.status(400).json({ error: 'Inserisci una località valida.' });
    const url = new URL(NOMINATIM);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'it');
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FuelRadarItalia/1.0 (fuel price comparison website)'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Geocoder ${response.status}`);
    const data = await response.json();
    res.json(data.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), label: x.display_name, type: x.type })));
  } catch (error) {
    res.status(502).json({ error: 'Ricerca località non disponibile in questo momento.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`FuelRadar Italia in ascolto su http://localhost:${PORT}`);
});
