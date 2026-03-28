import { GoogleGenerativeAI } from "@google/generative-ai";
import Table from 'cli-table3';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// --- Gemini API Configuration ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Regional Server Configuration ---
// Available regions:
//   us-central1     → Iowa, USA
//   us-east4        → Virginia, USA
//   europe-west4    → Netherlands
//   asia-southeast1 → Singapore
//   (null)          → Global default endpoint (generativelanguage.googleapis.com)

const REGIONAL_BASE_URLS = {
  "us-central1":     "https://us-central1-aiplatform.googleapis.com",
  "us-east4":        "https://us-east4-aiplatform.googleapis.com",
  "europe-west4":    "https://europe-west4-aiplatform.googleapis.com",
  "asia-southeast1": "https://asia-southeast1-aiplatform.googleapis.com",
};

// All regions + null (global). Shuffled at startup to distribute load
// across instances rather than everyone piling onto the same fallback
const ALL_REGIONS = [null, ...Object.keys(REGIONAL_BASE_URLS)];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Session-level active region — starts from .env preference if set, else null (global).
// Updated to whichever region last succeeded, so subsequent calls skip already-failing regions.
let activeRegion = process.env.GEMINI_REGION || null;

// Pre-shuffled fallback order for this process lifetime.
const SHUFFLED_FALLBACKS = shuffleArray(ALL_REGIONS);

/**
 * Returns the ordered list of regions to try for a given call:
 * [activeRegion, ...all others in shuffled order]
 */
function getRegionQueue() {
  return [activeRegion, ...SHUFFLED_FALLBACKS.filter(r => r !== activeRegion)];
}

/**
 * Builds a GoogleGenerativeAI instance pointed at the given region.
 * Pass null to use the global default endpoint.
 */
function buildGenAIForRegion(region) {
  if (region) {
    const baseUrl = REGIONAL_BASE_URLS[region];
    console.log(`[agent] Routing to regional endpoint: ${baseUrl} (${region})`);
    return new GoogleGenerativeAI(GEMINI_API_KEY, { baseUrl });
  }
  console.log(`[agent] Routing to global endpoint.`);
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

/**
 * Returns true if the error is a retryable 503 overload, false for anything
 * else (auth errors, bad requests, etc.) that shouldn't trigger a region switch.
 */
function is503(error) {
  return (
    error?.message?.includes('503') ||
    error?.message?.includes('Service Unavailable') ||
    error?.message?.includes('high demand')
  );
}

/**
 * Wraps a model-using function with automatic region fallback on 503.
 * `apiFn` receives a configured GoogleGenerativeAI instance and should return a promise.
 * On success the winning region is remembered for the session.
 */
async function withRegionFallback(apiFn) {
  const queue = getRegionQueue();

  for (const region of queue) {
    const regionLabel = region ?? 'global';
    try {
      const genAI = buildGenAIForRegion(region);
      const result = await apiFn(genAI);
      // Remember the winner so next call starts here
      if (activeRegion !== region) {
        console.log(`[agent] Region "${regionLabel}" succeeded — pinning for this session.`);
        activeRegion = region;
      }
      return result;
    } catch (error) {
      if (is503(error)) {
        console.warn(`[agent] Region "${regionLabel}" returned 503 — trying next region...`);
        // Small pause before hitting the next endpoint
        await new Promise(res => setTimeout(res, 600));
        continue;
      }
      // Non-retryable error — rethrow immediately
      throw error;
    }
  }

  throw new Error(
    '[agent] All regions returned 503. Gemini is experiencing widespread issues. Please try again later.'
  );
}

/**
 * Analyzes an array of review objects using the @google/generative-ai library.
 * All businesses are sent in a single batched API call.
 *
 * @param {Array<Object>} reviews - An array of review objects, each expected to have 'business_name', 'stars', and 'text'.
 * @returns {Promise<string>} A formatted string containing the LLM-generated analysis of the reviews.
 */
export async function analyzeReviews(reviews) {
  if (!GEMINI_API_KEY) {
    return { formattedAnalysis: "ERROR: GEMINI_API_KEY not found. Please ensure it is set in your .env file.", rawJson: null };
  }
  if (!reviews || reviews.length === 0) {
    return { formattedAnalysis: "No reviews were provided to analyze.", rawJson: null };
  }

  const reviewsByBusiness = reviews.reduce((acc, review) => {
    const businessName = review.business_name || 'Unknown Business';
    if (!acc[businessName]) {
      acc[businessName] = [];
    }
    acc[businessName].push(review);
    return acc;
  }, {});

  const businessNames = Object.keys(reviewsByBusiness);

  const businessesBlock = businessNames.map((businessName) => {
    const reviewTexts = reviewsByBusiness[businessName]
      .map(r => `"${r.text}" (Rating: ${r.stars})`)
      .join('\n    - ');
    return `Business: "${businessName}"\n  Reviews:\n    - ${reviewTexts}`;
  }).join('\n\n');

  const prompt = `You are a highly skilled marketing analyst. Your task is to analyze customer reviews for MULTIPLE businesses in a single pass.

Analyze the following businesses and their reviews:
${businessesBlock}

For each business, provide:
- A concise summary (no more than 10 words)
- Key positive remarks (no more than 10 words)
- Actionable complaints with frustration intensity (low, medium, or high) AND a supporting snippet from a review.
- Any detected buying intent

Return your analysis as a single JSON object with a top-level key "businesses" which is an array of objects, one per business. Your entire response must be only the raw JSON object, with no markdown formatting or other text.

Example JSON structure:
{
  "businesses": [
    {
      "business_name": "Example Business",
      "summary": "Overall summary of the reviews for this business.",
      "positive_remarks": ["Key positive point 1.", "Key positive point 2."],
      "actionable_complaints": [
        {
          "complaint": "Specific complaint that the business can act on.",
          "frustration_intensity": "low",
          "source_quote": "Exact snippet from the review."
        }
      ],
      "buying_intent": {
        "detected": false,
        "explanation": "If true, explain why buying intent was detected."
      }
    }
  ]
}
`;

  let fullAnalysisOutput = "--- AI-Powered Review Analysis ---\n\n";

  try {
    const llmText = await withRegionFallback(async (genAI) => {
      const model = genAI.getGenerativeModel({
        model: "models/gemini-flash-latest",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    });

    let analysisJson;
    try {
      analysisJson = JSON.parse(llmText);
    } catch (parseError) {
      return { 
        formattedAnalysis: fullAnalysisOutput + `\n  AI Analysis: Could not parse LLM's JSON response. Raw LLM text: ${llmText}`, 
        rawJson: null 
      };
    }

    const businesses = analysisJson.businesses || [];

    if (businesses.length === 0) {
      return {
        formattedAnalysis: fullAnalysisOutput + `\n  AI Analysis: The LLM returned no business data. Raw parsed JSON: ${JSON.stringify(analysisJson)}`,
        rawJson: analysisJson
      };
    }

    for (const business of businesses) {
      const businessName = business.business_name || 'Unknown';
      const summary = business.summary || 'N/A';
      const positiveRemarks = business.positive_remarks || [];
      const complaints = business.actionable_complaints || [];
      const buyingIntent = business.buying_intent || {};

      fullAnalysisOutput += `--- Business: ${businessName} ---\n`;
      fullAnalysisOutput += `  Summary: ${summary}\n`;

      if (positiveRemarks.length > 0) {
        fullAnalysisOutput += `  Positive Remarks: ${positiveRemarks.join(', ')}\n`;
      } else {
        fullAnalysisOutput += `  Positive Remarks: N/A\n`;
      }

      if (complaints.length > 0) {
        fullAnalysisOutput += `  Actionable Complaints:\n`;
        complaints.forEach((comp, idx) => {
          fullAnalysisOutput += `    ${idx + 1}. ${comp.complaint} (Frustration: ${comp.frustration_intensity || 'N/A'})\n`;
          fullAnalysisOutput += `    └ [${comp.source_quote || 'N/A'}]\n`;
        });
      } else {
        fullAnalysisOutput += `  Actionable Complaints: None\n`;
      }

      if (buyingIntent.detected) {
        fullAnalysisOutput += `  Buying Intent Detected: Yes - ${buyingIntent.explanation || 'N/A'}\n`;
      } else {
        fullAnalysisOutput += `  Buying Intent Detected: No\n`;
      }

      fullAnalysisOutput += '\n';
    }

    fullAnalysisOutput += "--- Summary Table ---\n\n";

    const terminalWidth = process.stdout.columns || 120;
    const tableWidth = Math.min(terminalWidth, 160) - 4;

    const table = new Table({
      head: ['Business', 'Summary', '# Positives', '# Complaints', 'Top Complaint', 'Buying Intent'],
      colWidths: [
        Math.floor(tableWidth * 0.13),
        Math.floor(tableWidth * 0.25),
        Math.floor(tableWidth * 0.08),
        Math.floor(tableWidth * 0.08),
        Math.floor(tableWidth * 0.30),
        Math.floor(tableWidth * 0.16),
      ],
      wordWrap: true,
      style: { 'padding-left': 1, 'padding-right': 1, head: ['cyan'] },
    });

    for (const business of businesses) {
      const businessName = business.business_name || 'Unknown';
      const summary = business.summary || 'N/A';
      const positiveCount = (business.positive_remarks || []).length.toString();
      const complaintCount = (business.actionable_complaints || []).length.toString();

      const topComplaint = (business.actionable_complaints && business.actionable_complaints.length > 0)
        ? `${business.actionable_complaints[0].complaint} (${business.actionable_complaints[0].frustration_intensity || 'N/A'})`
        : 'None';

      const buyingIntentLabel = (business.buying_intent && business.buying_intent.detected) ? 'Yes' : 'No';

      table.push([businessName, summary, positiveCount, complaintCount, topComplaint, buyingIntentLabel]);
    }

    fullAnalysisOutput += table.toString();

    return { formattedAnalysis: fullAnalysisOutput, rawJson: analysisJson };

  } catch (error) {
    fullAnalysisOutput += `\n  AI Analysis Error: ${error.message}`;
    console.error('Error during batched LLM analysis:', error);
    return { formattedAnalysis: fullAnalysisOutput, rawJson: null };
  }
}

/**
 * Updates market intelligence cache by spawning the memory.py
 * 
 * @param {Object} rawAnalysis - The raw JSON analysis from the LLM.
 * @param {string} searchQuery - The user's original search query.
 * @returns {Promise<void>}
 */
export async function updateMemory(rawAnalysis, searchQuery) {
  if (!rawAnalysis) return;

  // The running file is dist/main.js
  // The python script is core/memory.py
  // So we go up one directory from the current file (dist/), then into core/
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const pythonScriptPath = path.resolve(currentDir, '..', 'core', 'memory.py');

  if (!fs.existsSync(pythonScriptPath)) {
    const errorMsg = `[memory] Error: Python script not found at ${pythonScriptPath}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const payload = JSON.stringify({ analysis: rawAnalysis, query: searchQuery });

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [pythonScriptPath]);

    pythonProcess.stdin.write(payload);
    pythonProcess.stdin.end();

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[memory] Cache updated successfully.`);
        console.log(`[memory] stdout: ${stdoutData.trim()}`);
        resolve();
      } else {
        const errorMsg = `[memory] Error updating cache (exit code ${code}).\nStderr: ${stderrData.trim()}\nStdout: ${stdoutData.trim()}`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
      }
    });
  });
}

export async function classifyIntent(command) {
  if (!GEMINI_API_KEY) {
    return { intent: "error", detail: "GEMINI_API_KEY not found." };
  }

  const prompt = `You are an intent classification AI. Determine the user's goal.
  
  Possible intents:
  1. "extract_reviews": User wants to find general reviews for a niche/area.
  2. "competitor_analysis": User wants a deep dive into ONE specific business/competitor.
  3. "generate_content": User wants to create marketing materials based on research.
  4. "other": General conversation.

  The user's command is: "${command}"

  Your task is to respond with a JSON object:
  {
    "intent": "extract_reviews" | "competitor_analysis" | "generate_content" | "other",
    "searchQuery": "niche/topic for extract_reviews (else null)",
    "competitorName": "exact name of business for competitor_analysis (else null)",
    "location": "city/area for competitor_analysis (else null)",
    "contentRequest": "description for generate_content (else null)"
  }

  Example: "Analyze ABC Plumbing in Austin"
  Response: { "intent": "competitor_analysis", "competitorName": "ABC Plumbing", "location": "Austin", "searchQuery": null, "contentRequest": null }

  Now, process the user's command.
  `;

  try {
    const llmText = await withRegionFallback(async (genAI) => {
      const model = genAI.getGenerativeModel({
        model: "models/gemini-flash-latest",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    });
    return JSON.parse(llmText);
  } catch (error) {
    console.error('Error during intent classification:', error);
    return { intent: "error", detail: "Failed to classify intent." };
  }
}

/**
 * Performs a surgical analysis of a single competitor to find exploitable weaknesses.
 * 
 * @param {Object} competitorData - Data object with business_info and reviews.
 * @returns {Promise<string>} A formatted 'Battle Card' analysis.
 */
export async function analyzeCompetitor(competitorData) {
  const { business_info, reviews } = competitorData;
  if (!GEMINI_API_KEY || !reviews || reviews.length === 0) {
    return "No reviews found for this competitor to analyze.";
  }

  const businessName = business_info.name || "Competitor";
  const reviewTexts = reviews.map(r => `[Rating: ${r.stars}] ${r.text}`).join('\n- ');

  const prompt = `You are a strategic business consultant. Analyze the following reviews for "${businessName}" and create a COMPETITOR BATTLE CARD.

REVIEWS:
${reviewTexts}

Your response must be a single JSON object with the following keys:
{
  "competitor_name": "${businessName}",
  "market_position": "Vulnerable | Dominant | Declining",
  "key_vulnerabilities": [
    {
      "issue": "Specific failure description",
      "source_review": "The exact quote or snippet of the review that proves this."
    }
  ],
  "customer_frustration_level": "High | Medium | Low",
  "conversion_strategy_hook": "A 1-sentence persuasive hook to convince their customers to switch to us.",
  "strategic_recommendations": "Internal notes on how to position against them."
}

Return exactly 3 vulnerabilities. Return ONLY the raw JSON object.
`;

  try {
    const llmText = await withRegionFallback(async (genAI) => {
      const model = genAI.getGenerativeModel({
        model: "models/gemini-flash-latest",
        generationConfig: { responseMimeType: "application/json" },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    });

    const card = JSON.parse(llmText);

    // Format the Analysis Report for terminal display
    let output = `\n### COMPETITOR ANALYSIS REPORT: ${card.competitor_name}\n\n`;
    output += `**Market Position:** ${card.market_position}\n`;
    output += `**Customer Frustration Level:** ${card.customer_frustration_level}\n\n`;
    
    output += `**BUSINESS CONTACT INFORMATION:**\n`;
    output += `- Website: ${business_info.website || 'N/A'}\n`;
    output += `- Phone: ${business_info.phone || 'N/A'}\n`;
    output += `- Address: ${business_info.address || 'N/A'}\n\n`;

    output += `**Key Vulnerabilities:**\n\n`;
    card.key_vulnerabilities.forEach((v, i) => {
      output += `    ${i+1}. ${v.issue}\n`;
      output += `└ [${v.source_review}]\n`;
    });
    output += `\n**Strategic Conversion Hook:**\n> "${card.conversion_strategy_hook}"\n\n`;
    output += `**Strategic Recommendations:**\n${card.strategic_recommendations}\n`;

    return output;

  } catch (error) {
    console.error('Error during competitor analysis:', error);
    return `Error analyzing competitor: ${error.message}`;
  }
}

/**
 * Generates marketing content based on cached market intelligence.
 * 
 * @param {string} request - The user's specific content request.
 * @returns {Promise<string>} The generated content or an error message.
 */
export async function generateMarketingContent(request) {
  if (!GEMINI_API_KEY) return "Error: API key missing.";

  const cachePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'market_info.json');
  
  if (!fs.existsSync(cachePath)) {
    return "No market research found. Please run a review extraction first (e.g., '@search plumbers in Austin') to build the intelligence cache.";
  }

  let cacheData;
  try {
    const rawCache = fs.readFileSync(cachePath, 'utf8');
    if (!rawCache || rawCache.trim() === "") throw new Error("Empty cache");
    cacheData = JSON.parse(rawCache);
  } catch (e) {
    return "The market intelligence cache is empty or corrupted. Please perform fresh research.";
  }

  const prompt = `You are an expert direct-response copywriter. Use the following Market Intelligence Cache to fulfill the user's request.

MARKET INTELLIGENCE CACHE:
${JSON.stringify(cacheData, null, 2)}

USER REQUEST:
"${request}"

Your task:
1. Verify if the cache is relevant to the request. If not, politely explain what niche the cache currently covers.
2. If relevant, generate exactly what the user asked for (e.g., 2 ad copies).
3. Use the "core_pain_points" and "unmet_demands" from the cache to make the copy highly persuasive and targeted.
4. Focus on the "proposed_solutions" from the "opportunity_gaps" section.
5. Extract 2-3 exact frustrations from the negative reviews in the cache. 
   Mirror the customer's own language and emotional tone back in the copy 
   (e.g., if reviews say "waited 45 minutes", the copy should reference speed/wait time 
   directly — not generically say "fast service").
6. Apply the appropriate framework based on copy type:
   - Facebook/Instagram Ads → PAS (Problem → Agitate → Solution)
   - Google Ads → AIDA headline stack (Attention → Interest → Desire → Action)
   - Website Headlines → The "Who + What + Why Now" formula
   - General copies → Before/After/Bridge (BAB)
   Always name which framework you used above each copy.
7. Specificity rules — never write vague claims. Every copy must contain at least one:
   - Specific number, stat, or timeframe (e.g., "in under 20 mins", "rated 4.9★ by 300+ customers")
   - A named pain point pulled directly from the reviews (not paraphrased into abstraction)
   - A concrete differentiator — what THIS business does that the reviewed competitors failed at
8. Tone calibration:
   - Facebook Ads: conversational, slightly provocative, talks like a trusted friend exposing 
     a dirty secret ("Tired of [specific complaint from reviews]?")
   - Google Ads: confident, direct, benefit-first — no fluff
   - Website Headlines: authoritative but warm — position the business as the obvious solution
   - Avoid corporate language, passive voice, and filler phrases like "quality service" or 
     "customer satisfaction"
9. For each copy, write the HOOK as a standalone line first, then build the body around it.
   The hook must do one of: (a) name a specific pain from the reviews, (b) make a bold 
   contrarian claim, or (c) open a curiosity loop. Label it clearly as [HOOK].
10. After each copy, add a 1-sentence [STRATEGIST NOTE] explaining which review insight 
    it exploits and why the chosen angle should resonate with that audience.

Format the output clearly for a terminal display. Use bold headers and bullet points.
`;

  try {
    const content = await withRegionFallback(async (genAI) => {
      const model = genAI.getGenerativeModel({
        model: "models/gemini-flash-latest",
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    });
    return content;
  } catch (error) {
    console.error('Error generating content:', error);
    return `Error generating content: ${error.message}`;
  }
}