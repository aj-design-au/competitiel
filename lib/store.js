'use strict';

const fs   = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  competitors:      path.join(DATA_DIR, 'competitors.json'),
  products:         path.join(DATA_DIR, 'products.json'),
  price_history:    path.join(DATA_DIR, 'price_history.json'),
  analysis_results: path.join(DATA_DIR, 'analysis_results.json'),
};

async function ensureDataDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
  for (const [key, file] of Object.entries(FILES)) {
    try {
      await fs.access(file);
    } catch {
      const initial = (key === 'price_history') ? '{}' : '[]';
      await fs.writeFile(file, initial, 'utf8');
    }
  }
}

async function read(key) {
  const raw = await fs.readFile(FILES[key], 'utf8');
  return JSON.parse(raw);
}

async function write(key, data) {
  await fs.writeFile(FILES[key], JSON.stringify(data, null, 2), 'utf8');
}

// ── Competitors ──────────────────────────────────────────────────────────────

async function getCompetitors() {
  return read('competitors');
}

async function addCompetitor(competitor) {
  const list = await getCompetitors();
  list.push(competitor);
  await write('competitors', list);
  return competitor;
}

async function updateCompetitor(id, patch) {
  const list = await getCompetitors();
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  await write('competitors', list);
  return list[idx];
}

async function deleteCompetitor(id) {
  const list = await getCompetitors();
  const next = list.filter(c => c.id !== id);
  await write('competitors', next);
}

// ── Products ─────────────────────────────────────────────────────────────────

async function getProducts() {
  return read('products');
}

async function addProduct(product) {
  const list = await getProducts();
  list.push(product);
  await write('products', list);
  return product;
}

async function updateProduct(id, patch) {
  const list = await getProducts();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  await write('products', list);
  return list[idx];
}

async function deleteProduct(id) {
  const list = await getProducts();
  await write('products', list.filter(p => p.id !== id));
}

// ── Price History ─────────────────────────────────────────────────────────────

async function getPriceHistory(competitorId) {
  const all = await read('price_history');
  return all[competitorId] || [];
}

async function savePriceSnapshot(competitorId, snapshot) {
  const all = await read('price_history');
  if (!all[competitorId]) all[competitorId] = [];
  all[competitorId].unshift(snapshot); // newest first
  // Keep last 90 snapshots per competitor
  if (all[competitorId].length > 90) all[competitorId] = all[competitorId].slice(0, 90);
  await write('price_history', all);
}

function getSnapshotAt(history, daysAgo) {
  const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  // find the snapshot closest to (but before) the cutoff
  return history.find(s => new Date(s.timestamp).getTime() <= cutoff) || null;
}

// ── Analysis Results ──────────────────────────────────────────────────────────

async function getAnalysisResults() {
  return read('analysis_results');
}

async function saveAnalysisResult(result) {
  const list = await getAnalysisResults();
  list.unshift(result); // newest first
  if (list.length > 200) list.splice(200);
  await write('analysis_results', list);
  return result;
}

async function getLatestAnalysisPerCompetitor() {
  const list = await getAnalysisResults();
  const seen = new Set();
  return list.filter(r => {
    if (seen.has(r.competitor_id)) return false;
    seen.add(r.competitor_id);
    return true;
  });
}

module.exports = {
  ensureDataDir,
  getCompetitors, addCompetitor, updateCompetitor, deleteCompetitor,
  getProducts, addProduct, updateProduct, deleteProduct,
  getPriceHistory, savePriceSnapshot, getSnapshotAt,
  getAnalysisResults, saveAnalysisResult, getLatestAnalysisPerCompetitor,
};
