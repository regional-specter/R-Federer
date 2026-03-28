const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '../../.env') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const REGIONAL_BASE_URLS = {
  "us-central1":     "https://us-central1-aiplatform.googleapis.com",
  "us-east4":        "https://us-east4-aiplatform.googleapis.com",
  "europe-west4":    "https://europe-west4-aiplatform.googleapis.com",
  "asia-southeast1": "https://asia-southeast1-aiplatform.googleapis.com",
};

const ALL_REGIONS = [null, ...Object.keys(REGIONAL_BASE_URLS)];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let activeRegion = process.env.GEMINI_REGION || null;
const SHUFFLED_FALLBACKS = shuffleArray(ALL_REGIONS);

function getRegionQueue() {
  return [activeRegion, ...SHUFFLED_FALLBACKS.filter(r => r !== activeRegion)];
}

function buildGenAIForRegion(region) {
  if (region) {
    const baseUrl = REGIONAL_BASE_URLS[region];
    console.log(`[agent] Routing to regional endpoint: ${baseUrl} (${region})`);
    return new GoogleGenerativeAI(GEMINI_API_KEY, { baseUrl });
  }
  console.log(`[agent] Routing to global endpoint.`);
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

function is503(error) {
  return (
    error?.message?.includes('503') ||
    error?.message?.includes('Service Unavailable') ||
    error?.message?.includes('high demand')
  );
}

async function withRegionFallback(apiFn) {
  const queue = getRegionQueue();

  for (const region of queue) {
    const regionLabel = region ?? 'global';
    try {
      const genAI = buildGenAIForRegion(region);
      const result = await apiFn(genAI);
      if (activeRegion !== region) {
        console.log(`[agent] Region "${regionLabel}" succeeded — pinning for this session.`);
        activeRegion = region;
      }
      return result;
    } catch (error) {
      if (is503(error)) {
        console.warn(`[agent] Region "${regionLabel}" returned 503 — trying next region...`);
        await new Promise(res => setTimeout(res, 600));
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    '[agent] All regions returned 503. Gemini is experiencing widespread issues. Please try again later.'
  );
}

async function generateResponse(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not found. Please ensure it is set in your .env file.");
  }

  return await withRegionFallback(async (genAI) => {
    const model = genAI.getGenerativeModel({
      model: "models/gemini-flash-latest",
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
}

module.exports = {
  generateResponse,
};