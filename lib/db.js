'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    const url     = process.env.SUPABASE_URL;
    const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !svcKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    }
    _client = createClient(url, svcKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertNoError({ error }) {
  if (error) throw error;
}

// ── Competitors ───────────────────────────────────────────────────────────────

async function getCompetitors(userId) {
  const sb = getClient();
  const { data, error } = await sb
    .from('competitors')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  assertNoError({ error });
  return data;
}

async function getAllActiveCompetitors() {
  const sb = getClient();
  const { data, error } = await sb
    .from('competitors')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true });
  assertNoError({ error });
  return data;
}

async function addCompetitor(obj) {
  const sb = getClient();
  const { data, error } = await sb
    .from('competitors')
    .insert(obj)
    .select()
    .single();
  assertNoError({ error });
  return data;
}

async function updateCompetitor(id, userId, patch) {
  const sb = getClient();
  const { data, error } = await sb
    .from('competitors')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  assertNoError({ error });
  return data;
}

async function deleteCompetitor(id, userId) {
  const sb = getClient();
  const { error } = await sb
    .from('competitors')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError({ error });
}

// ── Products ──────────────────────────────────────────────────────────────────

async function getProducts(userId) {
  const sb = getClient();
  const { data, error } = await sb
    .from('products')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  assertNoError({ error });
  return data;
}

async function addProduct(obj) {
  const sb = getClient();
  const { data, error } = await sb
    .from('products')
    .insert(obj)
    .select()
    .single();
  assertNoError({ error });
  return data;
}

async function updateProduct(id, userId, patch) {
  const sb = getClient();
  const { data, error } = await sb
    .from('products')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  assertNoError({ error });
  return data;
}

async function deleteProduct(id, userId) {
  const sb = getClient();
  const { error } = await sb
    .from('products')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError({ error });
}

// ── Price Snapshots ───────────────────────────────────────────────────────────

async function savePriceSnapshot(competitorId, snapshotData) {
  const sb = getClient();
  const { data, error } = await sb
    .from('price_snapshots')
    .insert({ competitor_id: competitorId, results: snapshotData })
    .select()
    .single();
  assertNoError({ error });
  return data;
}

async function getPriceHistory(competitorId, limit = 90) {
  const sb = getClient();
  const { data, error } = await sb
    .from('price_snapshots')
    .select('*')
    .eq('competitor_id', competitorId)
    .order('scraped_at', { ascending: false })
    .limit(limit);
  assertNoError({ error });
  return data;
}

/**
 * Return the snapshot closest to N days ago for a given competitor.
 * Queries the DB for a snapshot with scraped_at <= (now - daysAgo*86400s),
 * ordered by scraped_at desc, taking the first row.
 */
async function getSnapshotAtDaysAgo(competitorId, daysAgo) {
  const sb = getClient();
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('price_snapshots')
    .select('*')
    .eq('competitor_id', competitorId)
    .lte('scraped_at', cutoff)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError({ error });
  return data; // null if none found
}

// ── Analysis Results ──────────────────────────────────────────────────────────

async function saveAnalysisResult(resultObj) {
  const sb = getClient();
  const row = {
    competitor_id:   resultObj.competitor_id,
    competitor_name: resultObj.competitor_name,
    analysis:        resultObj.analysis,
    current_prices:  resultObj.current_prices || null,
  };
  const { data, error } = await sb
    .from('analysis_results')
    .insert(row)
    .select()
    .single();
  assertNoError({ error });
  return data;
}

/**
 * Return the most recent analysis result per competitor for this user.
 * Joins through competitors to enforce user scoping.
 */
async function getLatestAnalysisPerCompetitor(userId) {
  const sb = getClient();
  // First get the user's competitor ids
  const { data: comps, error: compErr } = await sb
    .from('competitors')
    .select('id')
    .eq('user_id', userId);
  assertNoError({ error: compErr });

  if (!comps || comps.length === 0) return [];

  const compIds = comps.map(c => c.id);

  const { data, error } = await sb
    .from('analysis_results')
    .select('*')
    .in('competitor_id', compIds)
    .order('created_at', { ascending: false });
  assertNoError({ error });

  // Keep only the first (latest) result per competitor
  const seen = new Set();
  const results = [];
  for (const row of (data || [])) {
    if (!seen.has(row.competitor_id)) {
      seen.add(row.competitor_id);
      // Normalize shape to match what the frontend expects
      results.push({
        id:              row.id,
        competitor_id:   row.competitor_id,
        competitor_name: row.competitor_name,
        timestamp:       row.created_at,
        current_prices:  row.current_prices,
        analysis:        row.analysis,
      });
    }
  }
  return results;
}

async function getAnalysisResults(userId, limit = 50) {
  const sb = getClient();
  const { data: comps, error: compErr } = await sb
    .from('competitors')
    .select('id')
    .eq('user_id', userId);
  assertNoError({ error: compErr });

  if (!comps || comps.length === 0) return [];

  const compIds = comps.map(c => c.id);

  const { data, error } = await sb
    .from('analysis_results')
    .select('*')
    .in('competitor_id', compIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  assertNoError({ error });

  return (data || []).map(row => ({
    id:              row.id,
    competitor_id:   row.competitor_id,
    competitor_name: row.competitor_name,
    timestamp:       row.created_at,
    current_prices:  row.current_prices,
    analysis:        row.analysis,
  }));
}

module.exports = {
  getCompetitors,
  getAllActiveCompetitors,
  addCompetitor,
  updateCompetitor,
  deleteCompetitor,
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  savePriceSnapshot,
  getPriceHistory,
  getSnapshotAtDaysAgo,
  saveAnalysisResult,
  getLatestAnalysisPerCompetitor,
  getAnalysisResults,
};
