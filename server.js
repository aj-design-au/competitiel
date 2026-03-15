'use strict';

require('dotenv').config();

const express   = require('express');
const path      = require('path');

const db        = require('./lib/db');
const scheduler = require('./lib/scheduler');
const { requireAuth } = require('./lib/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── SSE broadcast (real-time dashboard updates, per user) ─────────────────────
// Map<userId, Set<res>>
const sseClients = new Map();

scheduler.setEventBroadcast((event) => {
  const msg    = `data: ${JSON.stringify(event)}\n\n`;
  const userId = event.data && event.data.user_id;

  if (userId && sseClients.has(userId)) {
    // Send only to the owning user's connections
    for (const res of sseClients.get(userId)) {
      try { res.write(msg); } catch {}
    }
  } else {
    // Fallback: broadcast to all (e.g. connected event)
    for (const clients of sseClients.values()) {
      for (const res of clients) {
        try { res.write(msg); } catch {}
      }
    }
  }
});

// ── Public routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/config
 * Returns public Supabase config so the frontend can init the JS client.
 */
app.get('/api/config', (req, res) => {
  res.json({
    supabase_url:      process.env.SUPABASE_URL      || null,
    supabase_anon_key: process.env.SUPABASE_ANON_KEY || null,
  });
});

// ── Protected SSE endpoint ────────────────────────────────────────────────────
app.get('/api/events', requireAuth, (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection:      'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const userId = req.user.id;
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  req.on('close', () => {
    const set = sseClients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(userId);
    }
  });
});

// ── Competitors ───────────────────────────────────────────────────────────────
app.get('/api/competitors', requireAuth, async (req, res) => {
  try {
    res.json(await db.getCompetitors(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/competitors', requireAuth, async (req, res) => {
  const { name, website_url, product_url, platform, check_frequency } = req.body;
  if (!name || !website_url) return res.status(400).json({ error: 'name and website_url required' });

  try {
    const competitor = await db.addCompetitor({
      user_id:         req.user.id,
      name,
      website_url,
      product_url:     product_url     || '',
      platform:        platform        || 'Other',
      check_frequency: check_frequency || 'Daily',
      active:          true,
    });
    scheduler.schedule(competitor);
    res.status(201).json(competitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/competitors/:id', requireAuth, async (req, res) => {
  try {
    const updated = await db.updateCompetitor(req.params.id, req.user.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    scheduler.schedule(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/competitors/:id', requireAuth, async (req, res) => {
  try {
    scheduler.unschedule(req.params.id);
    await db.deleteCompetitor(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Products ──────────────────────────────────────────────────────────────────
app.get('/api/products', requireAuth, async (req, res) => {
  try {
    res.json(await db.getProducts(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', requireAuth, async (req, res) => {
  const { name, price, target_margin } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const product = await db.addProduct({
      user_id:       req.user.id,
      name,
      price:         price         || null,
      target_margin: target_margin || null,
      competitor_links: [],
    });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const updated = await db.updateProduct(req.params.id, req.user.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteProduct(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Price History ─────────────────────────────────────────────────────────────
app.get('/api/price-history/:competitorId', requireAuth, async (req, res) => {
  try {
    const history = await db.getPriceHistory(req.params.competitorId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analysis ──────────────────────────────────────────────────────────────────
app.get('/api/analysis', requireAuth, async (req, res) => {
  try {
    const results = await db.getLatestAnalysisPerCompetitor(req.user.id);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analysis/all', requireAuth, async (req, res) => {
  try {
    const results = await db.getAnalysisResults(req.user.id, 50);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/analyze
 * Trigger an immediate scrape + analysis cycle.
 * Body: { competitor_id?: string }  — omit to run all.
 */
app.post('/api/analyze', requireAuth, async (req, res) => {
  const { competitor_id } = req.body || {};
  try {
    let competitors = await db.getCompetitors(req.user.id);
    if (competitor_id) competitors = competitors.filter(c => c.id === competitor_id);
    if (!competitors.length) return res.status(404).json({ error: 'No competitors found' });

    // Respond immediately; run cycles in background
    res.json({ ok: true, running: competitors.map(c => c.id) });

    for (const c of competitors) {
      scheduler.runCycle(c).catch(err =>
        console.error('[api/analyze] Error:', err.message)
      );
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const [competitors, products, analysis] = await Promise.all([
      db.getCompetitors(req.user.id),
      db.getProducts(req.user.id),
      db.getLatestAnalysisPerCompetitor(req.user.id),
    ]);
    res.json({
      competitors:       competitors.length,
      products:          products.length,
      analyses:          analysis.length,
      gemini_configured: !!process.env.GEMINI_API_KEY,
      uptime_s:          process.uptime() | 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────

// Init scheduler (non-blocking; no-ops gracefully when DB not configured)
scheduler.initAll().catch(err => console.error('[scheduler] init error:', err.message));

// Export app for Vercel serverless
module.exports = app;

// Start listening when run directly (local dev)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✓ Competitel running at http://localhost:${PORT}`);
    console.log(`  Supabase URL:   ${process.env.SUPABASE_URL        ? process.env.SUPABASE_URL + ' ✓' : 'NOT SET — add to .env'}`);
    console.log(`  Gemini API key: ${process.env.GEMINI_API_KEY       ? 'configured ✓'                  : 'NOT SET — add to .env'}`);
  });
}
