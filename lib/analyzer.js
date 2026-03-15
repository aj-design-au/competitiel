'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not set in .env');
    }
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _client;
}

function formatPrices(scrapeResults) {
  if (!scrapeResults || !scrapeResults.results) return 'No price data available.';
  return scrapeResults.results
    .map(r => {
      if (!r.success) return `  URL: ${r.url} — Failed to scrape (${r.error})`;
      if (!r.prices.length) return `  URL: ${r.url} — No prices found`;
      const priceList = r.prices.slice(0, 10).map(p => p.price).join(', ');
      return `  URL: ${r.url}\n  Prices found: ${priceList}`;
    })
    .join('\n');
}

function formatHistorical(snapshot) {
  if (!snapshot) return 'No historical data available.';
  // snapshot from DB is a price_snapshots row with a .results column
  const results = snapshot.results || snapshot;
  return formatPrices(results);
}

function formatProducts(products) {
  if (!products || !products.length) return 'No products configured yet.';
  return products.map(p =>
    `  - ${p.name}: $${p.price} (target margin: ${p.target_margin || '?'}%)`
  ).join('\n');
}

/**
 * Run Gemini analysis on competitor pricing data.
 *
 * @param {Object} options
 * @param {Object} options.competitor    - Competitor record from DB
 * @param {Object} options.currentScrape - Current scrape result
 * @param {Object} options.history7d     - Snapshot from 7 days ago (or null)
 * @param {Object} options.history30d    - Snapshot from 30 days ago (or null)
 * @param {Array}  options.products      - User's products array
 * @returns {Object} { competitor_id, competitor_name, timestamp, current_prices, analysis }
 */
async function analyzeCompetitor({ competitor, currentScrape, history7d, history30d, products }) {
  const prompt = `You are an expert pricing strategist and competitive intelligence analyst.
Analyze this competitor pricing data and return ONLY valid JSON — no markdown, no prose outside the JSON.

Competitor: ${competitor.name}
Platform: ${competitor.platform}
Website: ${competitor.website_url}

Current prices (scraped now):
${formatPrices(currentScrape)}

Previous prices (7 days ago):
${formatHistorical(history7d)}

Previous prices (30 days ago):
${formatHistorical(history30d)}

User's products and prices:
${formatProducts(products)}

Analyze:
1. What pricing changes happened? (list all changes)
2. Why might they have made these changes? (seasonal, inventory clearance, aggressive competition, testing, etc.)
3. How does this affect the user's competitive position?
4. Should the user adjust their prices? If yes, by how much and why?
5. Are there any patterns? (e.g., they always drop prices on weekends)
6. Any new products launched?

Return a JSON object with exactly these keys:
{
  "changes_detected": [{ "item": string, "from": string, "to": string, "change_pct": number }],
  "change_reasoning": string,
  "competitive_position": string,
  "immediate_action": { "needed": boolean, "action": string },
  "price_adjustments": [{ "product": string, "current_price": string, "recommended_price": string, "reason": string }],
  "patterns_detected": string,
  "new_products": [string],
  "market_insights": string,
  "trend_summary": string
}

Be specific, direct, and actionable. This person needs to make pricing decisions today.`;

  const genai = getClient();
  const model = genai.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      maxOutputTokens: 1500,
    },
  });

  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini API timed out after 30s')), 30000)),
  ]);
  const raw = result.response.text();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw_text: raw, parse_error: true };
  }

  return {
    competitor_id:   competitor.id,
    competitor_name: competitor.name,
    timestamp:       new Date().toISOString(),
    current_prices:  currentScrape,
    analysis:        parsed,
  };
}

module.exports = { analyzeCompetitor };
