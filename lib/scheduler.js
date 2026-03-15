'use strict';

const cron     = require('node-cron');
const db       = require('./db');
const scraper  = require('./scraper');
const analyzer = require('./analyzer');

// Maps UI frequency label → cron expression
const FREQ_MAP = {
  'Every Hour':    '0 * * * *',
  'Every 6 Hours': '0 */6 * * *',
  'Daily':         '0 9 * * *',
  'Weekly':        '0 9 * * 1',
};

// Active cron tasks keyed by competitor ID
const _tasks = new Map();

// Emitter so server.js can push SSE updates
let _eventBroadcast = null;
function setEventBroadcast(fn) { _eventBroadcast = fn; }

function emit(type, data) {
  if (_eventBroadcast) _eventBroadcast({ type, data });
}

/**
 * Run a full scrape + analysis cycle for one competitor.
 */
async function runCycle(competitor) {
  console.log(`[scheduler] Running cycle for: ${competitor.name}`);
  emit('cycle_start', {
    competitor_id:   competitor.id,
    competitor_name: competitor.name,
    user_id:         competitor.user_id,
  });

  try {
    // 1. Scrape
    const currentScrape = await scraper.scrapeCompetitor(competitor);
    await db.savePriceSnapshot(competitor.id, currentScrape);
    emit('scrape_done', {
      competitor_id: competitor.id,
      prices:        currentScrape,
      user_id:       competitor.user_id,
    });

    // 2. Pull historical snapshots from DB
    const history7d  = await db.getSnapshotAtDaysAgo(competitor.id, 7);
    const history30d = await db.getSnapshotAtDaysAgo(competitor.id, 30);

    // 3. Get user products
    const products = await db.getProducts(competitor.user_id);

    // 4. Analyze (only if API key is set)
    if (process.env.GEMINI_API_KEY) {
      const result = await analyzer.analyzeCompetitor({
        competitor, currentScrape, history7d, history30d, products,
      });
      await db.saveAnalysisResult(result);
      emit('analysis_done', { ...result, user_id: competitor.user_id });
      console.log(`[scheduler] Analysis complete for: ${competitor.name}`);
    } else {
      console.warn('[scheduler] GEMINI_API_KEY not set — skipping AI analysis step');
      emit('analysis_skipped', {
        competitor_id: competitor.id,
        reason:        'No API key',
        user_id:       competitor.user_id,
      });
    }
  } catch (err) {
    console.error(`[scheduler] Cycle error for ${competitor.name}:`, err.message);
    emit('cycle_error', {
      competitor_id: competitor.id,
      error:         err.message,
      user_id:       competitor.user_id,
    });
  }
}

/**
 * Schedule (or re-schedule) a competitor's tracking job.
 */
function schedule(competitor) {
  // Cancel any existing task
  unschedule(competitor.id);

  const expr = FREQ_MAP[competitor.check_frequency];
  if (!expr) {
    console.warn(`[scheduler] Unknown frequency "${competitor.check_frequency}" for ${competitor.name}`);
    return;
  }

  const task = cron.schedule(expr, () => runCycle(competitor), { scheduled: true });
  _tasks.set(competitor.id, task);
  console.log(`[scheduler] Scheduled "${competitor.name}" at "${competitor.check_frequency}" (${expr})`);
}

function unschedule(competitorId) {
  const existing = _tasks.get(competitorId);
  if (existing) {
    existing.stop();
    existing.destroy();
    _tasks.delete(competitorId);
  }
}

/**
 * Re-schedule all active competitors on server start.
 * Wrapped in try/catch so the server can start even if DB is not yet configured.
 */
async function initAll() {
  try {
    const competitors = await db.getAllActiveCompetitors();
    for (const c of competitors) {
      if (c.active !== false) schedule(c);
    }
    console.log(`[scheduler] Initialized ${competitors.length} competitor job(s)`);
  } catch (err) {
    console.warn('[scheduler] initAll skipped — DB not configured yet:', err.message);
  }
}

module.exports = { schedule, unschedule, runCycle, initAll, setEventBroadcast };
