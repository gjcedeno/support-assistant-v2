/**
 * app.js — Support Assistant Core Logic
 * =============================================================================
 *
 * Architecture:
 *  - State management: global state object
 *  - API layer: Supabase, OpenAI, Anthropic (Claude)
 *  - RAG pipeline: embed → search → rerank → generate
 *  - UI layer: render functions for each view
 *
 * Flow for generating a response:
 *  1. User pastes ticket → onTicketInput()
 *  2. User clicks "Search references" → searchRefs() → findSimilar()
 *     a. getEmbedding() — OpenAI converts ticket text to vector
 *     b. searchSimilar() — Supabase finds nearest vectors (cosine similarity)
 *     c. rerankReferences() — Claude picks the most relevant from results
 *  3. User clicks "Generate" → generate()
 *     a. buildSystemPrompt() — assembles rules + references + ticket
 *     b. callClaude() — sends prompt to Anthropic API
 *  4. User refines via chat → refine()
 *  5. User saves → saveTicket() → getEmbedding() → insertTicket()
 * =============================================================================
 */
// =============================================================================
// CONFIGURATION
// Read from config.js (gitignored). See config.example.js for setup.
// =============================================================================

const SUPABASE_URL  = CONFIG.SUPABASE_URL;
const SUPABASE_ANON = CONFIG.SUPABASE_ANON;

// Available Claude models shown in Settings
const MODELS = [
  { id: 'claude-sonnet-4-6',        label: 'Sonnet 4.6', desc: 'Recommended · best quality/speed balance' },
  { id: 'claude-opus-4-6',          label: 'Opus 4.6',   desc: 'Most powerful · slower' },
  { id: 'claude-haiku-4-5-20251001',label: 'Haiku 4.5',  desc: 'Fastest · simple tasks' },
];

// Default prompt rules loaded when no saved rules are found in localStorage
const DEFAULT_RULES = `You are a customer support assistant for WP All Import and WP All Export at Soflyy. Your job is to help Gregori write support replies that follow the company's exact tone, structure, and support policy.

Your replies must:
- Be short, simple, and clear. Most replies should be under 5 sentences.
- Use natural, casual English — like you're talking to a friend, not writing an essay.
- Avoid fluff, filler, or formalities (never say "Thanks for contacting us" or use long intros).
- Explain *how*, not *why*, unless the customer specifically asks.
- Always prioritize the most important information first — start with the answer or next step.
- Only address what the user asked — don't introduce unrelated topics.
- End with a clear next step or helpful link documentation, only if necessary.
- Sound like a real Soflyy agent: calm, professional, and direct.

If you're not 100% sure what the customer means, ask them to clarify. Never guess.

Use the official documentation: https://www.wpallimport.com/documentation/
Always link to it when appropriate to save words and provide guidance.

PHP Code:
Only write PHP code for users when:
- The code is very simple and fast to write.
- You know exactly what it needs to do.
- You're sure it won't set a bad precedent or lead to more hand-holding.

When possible, link to or adapt pre-written snippets from:
https://www.wpallimport.com/documentation/code-snippets/

For anything more complex, refer the user to:
https://www.wpallimport.com/developers/

Out of Scope (what you should NOT help with):
- Frontend display issues (that's the theme's job).
- Theme or plugin compatibility that requires investigating their code.
- Server-related problems (refer users to their host and tell them what to ask).
- Writing or debugging complex custom PHP.
- Verifying purchases.
- Selling or upselling. If a feature requires Pro, just say so and give the link.

Troubleshooting Flow:
If the user says WP All Import is broken:
- First, ask them to reproduce the issue on https://www.wpallimport.com/debug/
- Look for: incorrect settings, bad file structure, plugin/theme conflicts, or server limitations.
- Common real causes include:
  - Incorrectly formatted data
  - Orphaned or duplicate content
  - Plugin/theme conflicts
  - Server restrictions or timeouts
  - WordPress/WooCommerce limitations

Helpful Links:
- Documentation: https://www.wpallimport.com/documentation/
- Code snippets: https://www.wpallimport.com/documentation/code-snippets/
- Debug server: https://www.wpallimport.com/debug/
- Plugin/theme conflicts: https://www.wpallimport.com/documentation/plugin-theme-conflicts/
- Try Pro version: http://www.wpallimport.com/try/
- Recommended developers: https://www.wpallimport.com/developers/
- Support policy: https://www.wpallimport.com/support-policy/

Your #1 goal: Help Gregori write replies that are brief, correct, and sound like they came from a Soflyy support agent. Stick to the support policy, use simple language, and always provide the fastest path to solving the problem.

ADDITIONAL STYLE CONSTRAINTS (do not override rules above; apply to the final customer reply):
- Do not use dashes (— or -) as stylistic separators or to start lines.
- Do not write procedural or step-by-step instructions (no "Click here", "Go to…", or arrow/flow formats like "→"). Prefer a natural, conversational, and fluid style.
- When referencing docs or screenshots, weave links naturally into sentences instead of numbered steps.
- NEVER use Markdown formatting. Never use [text](url) format for links. Always write URLs as plain text directly in the sentence. No bold, no italics, no headers, no backticks for links. This is a strict requirement — plain text URLs only, always.
- Use line breaks between each step or instruction. Do not write everything in one block of text.

REFERENCE TICKET EXAMPLE (style/structure guide; do not copy verbatim in future replies):
While our plugins don't offer real-time syncing, you can schedule your export and import to run frequently to keep the data between the two sites up to date. Create an export with your stock on site 1 and automate it as mentioned here: https://www.wpallimport.com/documentation/how-to-schedule-wordpress-exports/.

Then, use the file URL from that export to create an import on site 2 (see https://prnt.sc/ispRlxTxNy45 and https://www.wpallimport.com/documentation/download-a-file-or-use-existing-file/), updating the stock as explained here: https://www.wpallimport.com/documentation/syncing-stock/.

You can also automate the import process using cron jobs (https://www.wpallimport.com/documentation/cron/) or our paid/optional Automatic Scheduling Service (https://www.wpallimport.com/documentation/schedule-wordpress-imports/).

To do this, you would need at least our WooCommerce Pro Package: https://www.wpallimport.com/woocommerce-product-export/#headline-1187-2991438.

REAL RESPONSE EXAMPLES — match this exact style and tone:

Ticket: I purchased the wrong plan, I need a refund so I can buy the right one.
Response: We can refund your current purchase so you can get the package that best fits your needs. Just confirm if you'd like us to issue the refund, and we'll handle it.

Ticket: I need an invoice for my purchase.
Response: You can get your invoice in our Customer Portal here: https://www.wpallimport.com/portal/purchase-history/. Then you would click "View Invoice" next to your purchase: https://d.pr/i/gvc6ok. You can click "Update" below "Invoice To" to fill in your details: https://d.pr/i/PJqE3L and then use "Download PDF". You can also find your license keys in your account here: https://www.wpallimport.com/portal/license-keys/.

Ticket: Has WP All Import been updated to support PHP 8?
Response: Yes, WP All Import and WP All Export support PHP 8.0 and newer. Just make sure you're using the latest versions of the plugins and add-ons.

Ticket: I want to export users but it says I need the User Export Add-On.
Response: The User Export Add-On is a separate plugin. Make sure it's installed and active on your site, and you can download it from your account at https://www.wpallimport.com/portal/downloads/. Let us know how it goes after that.

Ticket: How do I import variable products?
Response: You can follow our guide where we explain how to import variable products step by step: https://www.wpallimport.com/documentation/import-variable-products-woocommerce/. It shows how to set up the parent and child records so the variations import correctly.

Ticket: The automatic scheduler isn't running on my site.
Response: Try updating WP All Import to the latest version first. The scheduler won't run reliably if the plugin isn't fully up to date, so it's the quickest way to rule that out. Once updated, let the next scheduled window pass and see if the "Last Run" time changes in All Import under Scheduling.

Ticket: I purchased the ACF Export Add-On and need a license key to update it.
Response: License keys are only required for our core import/export plugins. All other add-ons can access the latest versions without a license key. You can find the documentation on how to install or update plugins here: https://www.wpallimport.com/documentation/how-to-install-and-update-wp-all-import-plugins/

Ticket: The WooCommerce Add-On tab doesn't appear in my import.
Response: Make sure your WP All Import license is activated and that the WooCommerce Import Add-On Pro plugin is downloaded from your account at https://www.wpallimport.com/portal/downloads/. If the issue persists after that, send us a working WordPress admin link and we'll take another look.`;

// =============================================================================
// STATE
// Single source of truth for all application state.
// =============================================================================

/**
 * cfg — User configuration, persisted in localStorage.
 * @property {string} anthropicKey - Anthropic API key
 * @property {string} openaiKey    - OpenAI API key
 * @property {string} model        - Selected Claude model ID
 * @property {string} rules        - Base prompt rules
 * @property {boolean} dark        - Dark mode enabled
 * @property {boolean} webSearch   - Web search enabled
 */
let cfg = {
  anthropicKey: '',
  openaiKey: '',
  model: 'claude-sonnet-4-6',
  rules: DEFAULT_RULES,
  dark: false,
  webSearch: false,
};

let currentView     = 'new';   // Active view: 'new' | 'history' | 'settings'
let similar         = [];      // Reranked reference tickets from Supabase
let chatHistory     = [];      // Full conversation history sent to Claude API
let chatMessages    = [];      // Rendered messages in the UI
let currentResponse = '';      // Latest Claude response (used for saving)
let webSearchActive = false;   // Whether web search is currently enabled
let expandedId      = null;    // ID of the expanded history item
let allTickets      = [];      // All tickets loaded from Supabase
let isLoading       = false;   // Prevents double-submits during API calls
let attachments     = [];      // Files attached to the chat input
let ticketAttachments = [];    // Files attached to the ticket input

const VIEW_TITLES = { new: 'New Ticket', history: 'History', settings: 'Settings' };

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Bootstraps the app on page load.
 * Loads saved config from localStorage, applies theme, and fetches tickets.
 */
function init() {
  const saved = localStorage.getItem('wp-rag-config');
  if (saved) {
    try { cfg = { ...cfg, ...JSON.parse(saved) }; } catch (e) { /* ignore corrupt data */ }
  }

  // Apply saved API keys from config.js as defaults (only if not already saved)
  if (!cfg.anthropicKey && CONFIG.ANTHROPIC_KEY !== 'YOUR_ANTHROPIC_KEY_HERE') {
    cfg.anthropicKey = CONFIG.ANTHROPIC_KEY;
  }
  if (!cfg.openaiKey && CONFIG.OPENAI_KEY !== 'YOUR_OPENAI_KEY_HERE') {
    cfg.openaiKey = CONFIG.OPENAI_KEY;
  }

  if (cfg.dark) document.body.classList.add('dark');
  webSearchActive = cfg.webSearch || false;

  updateThemeBtn();
  updateWebSearchToggle();
  renderModelOptions();

  document.getElementById('input-anthropic').value = cfg.anthropicKey || '';
  document.getElementById('input-openai').value    = cfg.openaiKey    || '';
  document.getElementById('input-rules').value     = cfg.rules        || DEFAULT_RULES;

  loadTickets();
  updateEmptyState();
}

// =============================================================================
// SETTINGS & CONFIGURATION
// =============================================================================

/** Persists current cfg to localStorage. */
function saveCfg() {
  localStorage.setItem('wp-rag-config', JSON.stringify(cfg));
}

/** Saves settings form values to cfg and navigates back to New Ticket. */
function saveSettings() {
  const ak    = document.getElementById('input-anthropic').value.trim();
  const ok    = document.getElementById('input-openai').value.trim();
  const rules = document.getElementById('input-rules').value.trim();

  if (ak)    cfg.anthropicKey = ak;
  if (ok)    cfg.openaiKey    = ok;
  if (rules) cfg.rules        = rules;
  cfg.webSearch = webSearchActive;

  saveCfg();
  setView('new');
  showToast('Settings saved');
  updateEmptyState();
}

// =============================================================================
// NAVIGATION
// =============================================================================

/**
 * Switches between views (new, history, settings).
 * @param {string} v - View name
 */
function setView(v) {
  currentView = v;
  ['new', 'history', 'settings'].forEach(name => {
    document.getElementById('view-' + name).style.display = name === v ? 'block' : 'none';
    document.getElementById('nav-' + name).classList.toggle('active', name === v);
  });
  document.getElementById('topbar-title').textContent = VIEW_TITLES[v] || v;

  if (v === 'history') renderHistory();
  if (v === 'settings') {
    document.getElementById('input-anthropic').value = cfg.anthropicKey || '';
    document.getElementById('input-openai').value    = cfg.openaiKey    || '';
    document.getElementById('input-rules').value     = cfg.rules        || DEFAULT_RULES;
    renderModelOptions();
    updateWebSearchToggle();
  }
}

// =============================================================================
// THEME
// =============================================================================

function toggleTheme() {
  cfg.dark = !cfg.dark;
  document.body.classList.toggle('dark', cfg.dark);
  saveCfg();
  updateThemeBtn();
}

function updateThemeBtn() {
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (cfg.dark) {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
    label.textContent = 'Light mode';
  } else {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    label.textContent = 'Dark mode';
  }
}

// =============================================================================
// WEB SEARCH TOGGLE
// =============================================================================

function toggleWebSearch() {
  webSearchActive = !webSearchActive;
  cfg.webSearch   = webSearchActive;
  updateWebSearchToggle();
}

function updateWebSearchToggle() {
  const toggle = document.getElementById('web-search-toggle');
  if (toggle) toggle.className = 'toggle' + (webSearchActive ? ' on' : '');
}

// =============================================================================
// MODEL SELECTOR
// =============================================================================

function renderModelOptions() {
  const container = document.getElementById('model-options');
  container.innerHTML = MODELS.map(m => `
    <div class="model-opt${cfg.model === m.id ? ' selected' : ''}" onclick="selectModel('${m.id}')">
      <div class="radio${cfg.model === m.id ? ' on' : ''}">${cfg.model === m.id ? '<div class="radio-dot"></div>' : ''}</div>
      <div>
        <div class="model-name">${m.label}</div>
        <div class="model-desc">${m.desc}</div>
      </div>
    </div>`).join('');
}

function selectModel(id) {
  cfg.model = id;
  renderModelOptions();
  updateHeaderSub();
}

function updateHeaderSub() {
  const label = MODELS.find(m => m.id === cfg.model)?.label || 'Sonnet';
  document.getElementById('header-sub').textContent = `${allTickets.length} tickets · ${label}`;
}

// =============================================================================
// UI UTILITIES
// =============================================================================

/**
 * Shows or hides the status bar in the topbar.
 * @param {string} msg   - Message to display (empty to hide)
 * @param {string} type  - 'info' | 'error'
 */
function setStatus(msg, type = 'info') {
  const bar = document.getElementById('status-bar');
  if (!msg) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.className = 'status-bar' + (type === 'error' ? ' error' : '');
  document.getElementById('status-spinner').style.display = type === 'error' ? 'none' : 'block';
  document.getElementById('status-text').textContent = msg;
}

/**
 * Shows a temporary toast notification.
 * @param {string} msg - Message to display
 */
function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<div class="toast-dot"></div>${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function updateEmptyState() {
  const ready = cfg.anthropicKey && cfg.openaiKey;
  document.getElementById('setup-banner').style.display = ready ? 'none' : 'flex';
  const ticketVal = document.getElementById('ticket-input').value;
  document.getElementById('empty-state').style.display =
    (ready && allTickets.length === 0 && !ticketVal) ? 'block' : 'none';
}

/**
 * Updates the generate buttons based on current state.
 * - Before search: no buttons shown
 * - After search with refs found: "Generate with references" + "Generate from scratch"
 * - After search with no refs: only "Generate from scratch"
 * - After generating: "Regenerate" button
 */
function updateGenerateBtn() {
  const val     = document.getElementById('ticket-input').value.trim();
  const canGen  = val.length > 10 && !isLoading && !!cfg.anthropicKey;
  const btn     = document.getElementById('generate-btn');
  const btnNoRef = document.getElementById('generate-no-refs-btn');
  const hasRefs = similar.length > 0;
  const hasMsgs = chatMessages.length > 0;

  if (hasRefs || hasMsgs) {
    btn.style.display = 'flex';
    btn.disabled = !canGen;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${hasMsgs ? 'Regenerate' : 'Generate with references'}`;
  } else {
    btn.style.display = 'none';
  }

  if (hasRefs) {
    btnNoRef.style.display = 'flex';
    btnNoRef.disabled = !canGen;
  } else {
    btnNoRef.style.display = 'none';
  }
}

// =============================================================================
// SUPABASE API LAYER
// All database operations go through sbFetch() for consistent error handling.
// =============================================================================

/**
 * Makes an authenticated request to the Supabase REST API.
 * @param {string} path  - API path (e.g. '/rest/v1/tickets')
 * @param {Object} opts  - Fetch options (method, body, headers)
 * @returns {Promise<any>} Parsed JSON response
 */
async function sbFetch(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': 'Bearer ' + SUPABASE_ANON,
      ...opts.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.hint || JSON.stringify(data));
  return data;
}

/**
 * Loads all tickets from Supabase with pagination (Supabase max is 1000/request).
 * Updates allTickets state and refreshes UI counters.
 */
async function loadTickets() {
  try {
    let all = [], from = 0;
    while (true) {
      const data = await sbFetch(
        `/rest/v1/tickets?select=id,ticket,conversation,from_pdf,created_at&order=created_at.desc&limit=1000&offset=${from}`
      );
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    allTickets = all || [];

    const badge = document.getElementById('ticket-count');
    badge.textContent = allTickets.length;
    badge.style.display = allTickets.length > 0 ? 'inline' : 'none';

    updateHeaderSub();
    updateEmptyState();
  } catch (e) {
    console.error('Failed to load tickets:', e);
    setStatus('Could not load tickets from database. Check your connection.', 'error');
  }
}

/**
 * Inserts a new ticket into Supabase.
 * @param {string}   ticket      - Customer ticket text
 * @param {string}   conversation - Agent response (or full conversation)
 * @param {number[]} embedding   - OpenAI embedding vector
 * @param {boolean}  fromPDF     - Whether this was imported from a PDF
 */
async function insertTicket(ticket, conversation, embedding, fromPDF = false) {
  return sbFetch('/rest/v1/tickets', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify({ ticket, conversation, embedding, from_pdf: fromPDF }),
  });
}

/**
 * Searches for similar tickets using pgvector cosine similarity.
 * @param {number[]} embedding  - Query vector from OpenAI
 * @param {number}   threshold  - Minimum similarity score (0–1)
 * @param {number}   count      - Maximum results to return
 */
async function searchSimilar(embedding, threshold = 0.35, count = 15) {
  return sbFetch('/rest/v1/rpc/match_tickets', {
    method: 'POST',
    body: JSON.stringify({ query_embedding: embedding, match_threshold: threshold, match_count: count }),
  });
}

/** Deletes a ticket by ID. */
async function deleteTicket(id) {
  await sbFetch(`/rest/v1/tickets?id=eq.${id}`, { method: 'DELETE' });
}

// =============================================================================
// OPENAI API LAYER
// Used only for generating embeddings (text → vector).
// =============================================================================

/**
 * Converts text to a 1536-dimensional embedding vector using OpenAI.
 * This vector is used for semantic similarity search in Supabase.
 * @param {string} text - Text to embed (max 2000 chars used)
 * @returns {Promise<number[]>} Embedding vector
 */
async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.openaiKey,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 2000) }),
  });
  const data = await res.json();
  if (data.error) throw new Error('OpenAI: ' + data.error.message);
  return data.data[0].embedding;
}

// =============================================================================
// ANTHROPIC API LAYER (CLAUDE)
// Used for response generation, reranking, and chat refinement.
// =============================================================================

/**
 * Sends a conversation to Claude and returns the text response.
 * @param {Array}   messages   - Array of {role, content} message objects
 * @param {boolean} useSearch  - Whether to enable web search tool
 * @returns {Promise<string>} Claude's text response
 */
async function callClaude(messages, useSearch = false) {
  const body = { model: cfg.model, max_tokens: 1200, messages };
  if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error('Claude: ' + data.error.message);
  return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
}

// =============================================================================
// RAG PIPELINE
// =============================================================================

/**
 * Uses Claude to rerank candidate references by relevance to the current ticket.
 * This runs as a second pass after the initial vector search to improve quality.
 *
 * @param {string} ticketText  - The customer's ticket
 * @param {Array}  candidates  - Raw results from Supabase vector search
 * @returns {Promise<Array>} Top 10 most relevant references
 */
async function rerankReferences(ticketText, candidates) {
  // Skip reranking if there are too few candidates to be worth it
  if (candidates.length <= 5) return candidates;

  const list = candidates
    .map((t, i) => `[${i+1}] Ticket: ${(t.ticket||'').slice(0,200)}\nResponse: ${(t.conversation||'').slice(0,300)}`)
    .join('\n\n---\n\n');

  const prompt = `You are evaluating support ticket references for relevance.\n\nNew ticket: "${ticketText.slice(0,400)}"\n\nCandidates:\n${list}\n\nSelect the 10 most relevant references. Return ONLY a JSON array of numbers, e.g. [1,2,3,4,5,6,7,8,9,10].`;

  try {
    const result = await callClaude([{ role: 'user', content: prompt }]);
    const arr = JSON.parse(result.replace(/```json|```/g, '').trim());
    if (!Array.isArray(arr)) return candidates.slice(0, 10);
    return arr
      .filter(i => i >= 1 && i <= candidates.length)
      .map(i => candidates[i - 1])
      .slice(0, 10);
  } catch {
    // Fallback: return top 10 by similarity score
    return candidates.slice(0, 10);
  }
}

/**
 * Handles ticket input changes.
 * Resets state and shows the "Search references" button when enough text is present.
 */
function onTicketInput() {
  const val = document.getElementById('ticket-input').value.trim();

  // Reset all derived state when ticket changes
  chatMessages    = [];
  chatHistory     = [];
  currentResponse = '';
  similar         = [];

  document.getElementById('chat-container').style.display   = 'none';
  document.getElementById('save-btn').style.display         = 'none';
  document.getElementById('similar-container').style.display = 'none';

  // Show search button only when there's enough text and OpenAI key is set
  const searchBtn = document.getElementById('search-refs-btn');
  searchBtn.style.display = (val.length > 10 && cfg.openaiKey) ? 'flex' : 'none';

  updateGenerateBtn();
}

/**
 * Triggered by the "Search references" button.
 * Shows a loading state on the button, runs findSimilar(), then hides the button.
 */
async function searchRefs() {
  const val = document.getElementById('ticket-input').value.trim();
  if (!val || val.length < 10 || !cfg.openaiKey) return;

  const btn = document.getElementById('search-refs-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner" style="width:11px;height:11px;border-width:1.5px;flex-shrink:0"></div>Searching…`;

  await findSimilar(val);

  // Hide the search button — user uses generate buttons from here
  btn.style.display = 'none';
  btn.disabled      = false;
  btn.innerHTML     = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>Search references`;
}

/**
 * Runs the full similarity search pipeline:
 * embed → vector search → rerank → render results.
 * @param {string} text - Customer ticket text
 */
async function findSimilar(text) {
  if (allTickets.length === 0) return;
  try {
    const emb     = await getEmbedding(text);
    const results = await searchSimilar(emb);

    if (!results || results.length === 0) {
      similar = [];
      updateGenerateBtn();
      return;
    }

    // Rerank if we have enough candidates to make it worthwhile
    similar = results.length > 5
      ? await rerankReferences(text, results)
      : results;

    if (similar.length > 0) {
      document.getElementById('similar-container').style.display = 'block';
      document.getElementById('similar-label').textContent =
        `${similar.length} reference${similar.length > 1 ? 's' : ''} found`;
      renderSimilar();
    }

    setStatus('');
    updateGenerateBtn();
  } catch (e) {
    setStatus('Error searching references: ' + e.message, 'error');
  }
}

// =============================================================================
// RENDER: REFERENCES PANEL
// =============================================================================

/** Renders the list of similar reference tickets in the right panel. */
function renderSimilar() {
  const list = document.getElementById('similar-list');
  list.innerHTML = similar.map((t, i) => {
    const conv      = t.conversation || '';
    const agentPart = conv.includes('Agent:') ? conv.split('Agent:')[1].trim() : conv;

    return `
      <div class="ref-item">
        <div class="ref-row" onclick="toggleRef(${i})" style="cursor:pointer">
          <div class="ref-text">${(t.ticket||'').slice(0,140)}${(t.ticket||'').length > 140 ? '…' : ''}</div>
          <span class="ref-pct">${Math.round((t.similarity||0)*100)}%</span>
        </div>
        <div id="ref-exp-${i}" style="display:none" class="ref-expanded">
          <div class="ref-exp-label">Full ticket</div>
          <div class="ref-exp-text" style="margin-bottom:10px">${escapeHtml(t.ticket||'')}</div>
          <div class="ref-exp-label">Agent response</div>
          <div class="ref-exp-text" style="margin-bottom:10px">${escapeHtml(agentPart)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-ghost" onclick="event.stopPropagation();copyRefResponse(${i})">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:3px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy response
            </button>
            <button class="btn-secondary" onclick="event.stopPropagation();useRefResponse(${i})" style="font-size:11px;padding:4px 10px">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:3px"><polyline points="9 18 15 12 9 6"/></svg>
              Use this response
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

/** Copies a reference's agent response to clipboard. */
function copyRefResponse(i) {
  const conv      = similar[i]?.conversation || '';
  const agentPart = conv.includes('Agent:') ? conv.split('Agent:')[1].trim() : conv;
  navigator.clipboard.writeText(agentPart);
  showToast('Response copied to clipboard');
}

/**
 * Loads a reference response into the chat as if Claude generated it.
 * The user can then refine it and save it.
 */
function useRefResponse(i) {
  const conv      = similar[i]?.conversation || '';
  const agentPart = conv.includes('Agent:') ? conv.split('Agent:')[1].trim() : conv;
  if (!agentPart) return;

  const firstMsgContent = buildSystemPrompt() + '\n\nWrite a support response for this ticket:\n\n' + document.getElementById('ticket-input').value.trim();
  chatHistory     = [{ role: 'user', content: firstMsgContent }, { role: 'assistant', content: agentPart }];
  chatMessages    = [{ role: 'assistant', text: agentPart }];
  currentResponse = agentPart;

  renderChat();
  document.getElementById('chat-container').style.display = 'block';
  document.getElementById('save-btn').style.display       = 'flex';
  document.getElementById('clear-btn').style.display      = 'flex';
  showToast('Response loaded — you can edit and refine it');
}

/** Toggles expand/collapse of a reference item. */
function toggleRef(i) {
  const el = document.getElementById('ref-exp-' + i);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// =============================================================================
// PROMPT BUILDER
// =============================================================================

/**
 * Assembles the full system prompt for Claude.
 * Includes: base rules + selected references + critical URL instruction.
 * @returns {string} Complete system prompt
 */
function buildSystemPrompt() {
  const rules = `RESPONSE RULES — always follow these:\n${cfg.rules}\n\n`;

  const referencesSection = similar.length > 0
    ? `REFERENCE TICKETS FROM YOUR HISTORY (selected as most relevant):\n\n${
        similar.map((t, i) => {
          const isConv = (t.conversation||'').includes('Customer:') || (t.conversation||'').includes('Agent:');
          return `[Ref ${i+1} — ${Math.round((t.similarity||0)*100)}% match]\nIssue: ${t.ticket}\n${isConv ? 'Full conversation' : 'Response'}:\n${t.conversation}`;
        }).join('\n\n---\n\n')
      }\n\n`
    : '';

  return `${rules}${referencesSection}You are a WordPress plugin support agent. When asked to refine a response, apply changes and return only the updated text — no preamble.

CRITICAL INSTRUCTION FOR REFERENCES: When reference tickets contain specific URLs, screenshot links (like d.pr/i/..., prnt.sc/...), or step-by-step details, you MUST reuse those exact URLs and details in your response — do not replace them with generic links or paraphrase the steps. The reference responses represent the exact approved answers — replicate their structure and links precisely.`;
}

// =============================================================================
// GENERATE RESPONSE
// =============================================================================

/**
 * Generates a support response using Claude.
 * @param {boolean} useRefs - If false, ignores similar references (generate from scratch)
 */
async function generate(useRefs = true) {
  if (isLoading) return;

  const ticketText = document.getElementById('ticket-input').value.trim();
  if (!ticketText) return;

  isLoading = true;
  setStatus('Generating response…');
  document.getElementById('generate-btn').disabled     = true;
  document.getElementById('generate-no-refs-btn').disabled = true;

  // Temporarily clear references if user wants to generate from scratch
  const savedSimilar = similar;
  if (!useRefs) similar = [];
  const systemPrompt = buildSystemPrompt();
  similar = savedSimilar;

  // Build message content (may include file attachments)
  let firstMsgContent;
  if (ticketAttachments.length > 0) {
    firstMsgContent = [];
    for (const a of ticketAttachments) {
      if (a.type === 'image') {
        firstMsgContent.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } });
      } else if (a.type === 'pdf') {
        firstMsgContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } });
      } else {
        firstMsgContent.push({ type: 'text', text: `[Attached file: ${a.name}]\n${atob(a.base64).slice(0, 8000)}` });
      }
    }
    firstMsgContent.push({ type: 'text', text: systemPrompt + '\n\nWrite a support response for this ticket:\n\n' + ticketText });
  } else {
    firstMsgContent = systemPrompt + '\n\nWrite a support response for this ticket:\n\n' + ticketText;
  }

  try {
    const reply = await callClaude([{ role: 'user', content: firstMsgContent }], webSearchActive);

    chatHistory     = [{ role: 'user', content: firstMsgContent }, { role: 'assistant', content: reply }];
    chatMessages    = [{ role: 'assistant', text: reply }];
    currentResponse = reply;

    renderChat();
    document.getElementById('chat-container').style.display = 'block';
    document.getElementById('save-btn').style.display       = 'flex';
    document.getElementById('clear-btn').style.display      = 'flex';
    setStatus('');
  } catch (e) {
    setStatus('Error generating response: ' + e.message, 'error');
  }

  isLoading = false;
  document.getElementById('generate-no-refs-btn').disabled = false;
  updateGenerateBtn();
}

// =============================================================================
// CHAT REFINEMENT
// =============================================================================

/**
 * Sends a follow-up message in the chat to refine the current response.
 * Maintains full conversation history for context.
 */
async function refine() {
  const input = document.getElementById('iter-input');
  const msg   = input.value.trim();

  if ((!msg && attachments.length === 0) || !chatHistory.length || isLoading) return;

  const displayText    = msg || `[${attachments.map(a => a.name).join(', ')}]`;
  const msgContent     = buildMessageContent(msg || 'Analyze the attached files and help me with the ticket.');
  const attachPreviews = [...attachments];

  input.value  = '';
  attachments  = [];
  renderAttachBar();

  isLoading = true;
  setStatus('Processing…');
  document.getElementById('refine-btn').disabled = true;

  chatMessages.push({ role: 'user', text: displayText, attachments: attachPreviews });
  const newHistory = [...chatHistory, { role: 'user', content: msgContent }];
  renderChat(true);

  try {
    const reply = await callClaude(newHistory, webSearchActive);
    chatHistory  = [...newHistory, { role: 'assistant', content: reply }];
    chatMessages.push({ role: 'assistant', text: reply });
    currentResponse = reply;
    setStatus('');
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }

  renderChat();
  isLoading = false;
  document.getElementById('refine-btn').disabled = false;
}

// =============================================================================
// RENDER: CHAT
// =============================================================================

/**
 * Renders the full chat thread.
 * @param {boolean} showTyping - Show a typing indicator at the end
 */
function renderChat(showTyping = false) {
  const thread = document.getElementById('chat-thread');

  thread.innerHTML = chatMessages.map(m => {
    const attachHtml = (m.attachments||[]).map(a =>
      a.previewUrl
        ? `<img src="${a.previewUrl}" class="chat-img" alt="${a.name}">`
        : `<div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text3);background:var(--bg3);padding:3px 8px;border-radius:4px;margin-top:6px">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
             ${a.name}
           </div>`
    ).join('');

    return `
      <div class="chat-msg${m.role === 'user' ? ' user-msg' : ''}">
        <div class="chat-role${m.role === 'assistant' ? ' is-claude' : ''}">${m.role === 'user' ? 'You' : 'Claude'}</div>
        ${attachHtml}
        <div class="chat-text"${m.attachments?.length ? ' style="margin-top:6px"' : ''}>${escapeHtml(m.text)}</div>
        ${m.role === 'assistant' ? `<div class="chat-actions"><button class="btn-ghost" onclick="copyText('${encodeURIComponent(m.text)}')">Copy</button></div>` : ''}
      </div>`;
  }).join('');

  if (showTyping) {
    thread.innerHTML += `
      <div class="chat-msg">
        <div class="chat-role is-claude">Claude</div>
        <div class="chat-typing"><div class="spinner"></div>Writing…</div>
      </div>`;
  }

  thread.scrollTop = thread.scrollHeight;
}

/** Clears all state and resets the UI to the initial empty state. */
function clearChat() {
  document.getElementById('ticket-input').value = '';

  chatMessages    = [];
  chatHistory     = [];
  currentResponse = '';
  similar         = [];
  attachments     = [];
  ticketAttachments = [];

  document.getElementById('similar-container').style.display  = 'none';
  document.getElementById('chat-container').style.display     = 'none';
  document.getElementById('save-btn').style.display           = 'none';
  document.getElementById('clear-btn').style.display          = 'none';
  document.getElementById('iter-input').value                  = '';
  document.getElementById('search-refs-btn').style.display    = 'none';
  document.getElementById('generate-no-refs-btn').style.display = 'none';
  document.getElementById('attach-bar').innerHTML              = '';
  document.getElementById('ticket-attach-bar').innerHTML      = '';

  setStatus('');
  updateGenerateBtn();
  updateEmptyState();
}

// =============================================================================
// SAVE TICKET
// =============================================================================

/**
 * Saves the current ticket + response to Supabase.
 * Generates a fresh embedding from the ticket text for semantic search.
 */
async function saveTicket() {
  const ticketText = document.getElementById('ticket-input').value.trim();
  if (!ticketText || !currentResponse || isLoading) return;

  isLoading = true;
  setStatus('Saving…');

  try {
    const emb = await getEmbedding(ticketText);
    await insertTicket(ticketText, currentResponse, emb, false);
    await loadTickets();

    // Reset UI after successful save
    document.getElementById('ticket-input').value = '';
    chatMessages    = [];
    chatHistory     = [];
    currentResponse = '';
    similar         = [];

    document.getElementById('similar-container').style.display = 'none';
    document.getElementById('chat-container').style.display    = 'none';
    document.getElementById('save-btn').style.display          = 'none';
    document.getElementById('clear-btn').style.display         = 'none';

    setStatus('');
    showToast(`✓ Saved · ${allTickets.length} tickets total`);
    updateEmptyState();
  } catch (e) {
    setStatus('Error saving: ' + e.message, 'error');
  }

  isLoading = false;
  updateGenerateBtn();
}

// =============================================================================
// FILE ATTACHMENTS
// =============================================================================

/**
 * Converts a File object to an attachment object with base64 data.
 * @param {File} file
 * @returns {Promise<Object>} Attachment object
 */
async function fileToAttachment(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const isImage   = file.type.startsWith('image/');
  const previewUrl = isImage ? URL.createObjectURL(file) : null;

  let mediaType = file.type;
  if (!mediaType || mediaType === 'application/octet-stream') {
    if (file.name.endsWith('.csv')) mediaType = 'text/plain';
  }

  return {
    name: file.name,
    type: isImage ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'text',
    base64,
    mediaType,
    previewUrl,
  };
}

async function handleTicketAttachFiles(files) {
  for (const file of Array.from(files)) {
    ticketAttachments.push(await fileToAttachment(file));
  }
  document.getElementById('ticket-attach-input').value = '';
  renderTicketAttachBar();
}

function renderTicketAttachBar() {
  const bar = document.getElementById('ticket-attach-bar');
  bar.innerHTML = ticketAttachments.map((a, i) => `
    <div class="attach-pill">
      ${a.previewUrl ? `<img src="${a.previewUrl}" class="attach-img-preview" alt="">` : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>'}
      <span>${a.name}</span>
      <button class="attach-pill-remove" onclick="removeTicketAttachment(${i})">✕</button>
    </div>`).join('');
}

function removeTicketAttachment(i) {
  ticketAttachments.splice(i, 1);
  renderTicketAttachBar();
}

async function handleAttachFiles(files) {
  for (const file of Array.from(files)) {
    attachments.push(await fileToAttachment(file));
  }
  document.getElementById('attach-input').value = '';
  renderAttachBar();
}

function renderAttachBar() {
  const bar = document.getElementById('attach-bar');
  bar.innerHTML = attachments.map((a, i) => `
    <div class="attach-pill">
      ${a.previewUrl ? `<img src="${a.previewUrl}" class="attach-img-preview" alt="">` : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>'}
      <span>${a.name}</span>
      <button class="attach-pill-remove" onclick="removeAttachment(${i})">✕</button>
    </div>`).join('');
}

function removeAttachment(i) {
  attachments.splice(i, 1);
  renderAttachBar();
}

/**
 * Builds message content for Claude, including any file attachments.
 * @param {string} text - Text portion of the message
 * @returns {string|Array} String if no attachments, array of content blocks otherwise
 */
function buildMessageContent(text) {
  if (attachments.length === 0) return text;

  const content = [];
  for (const a of attachments) {
    if (a.type === 'image') {
      content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } });
    } else if (a.type === 'pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } });
    } else {
      content.push({ type: 'text', text: `[Attached: ${a.name}]\n${atob(a.base64).slice(0, 8000)}` });
    }
  }
  content.push({ type: 'text', text });
  return content;
}

// =============================================================================
// RENDER: HISTORY VIEW
// =============================================================================

/** Renders the history list, filtered by the search input. */
function renderHistory() {
  const query    = (document.getElementById('search-input').value || '').toLowerCase();
  const filtered = allTickets.filter(t =>
    !query ||
    (t.ticket||'').toLowerCase().includes(query) ||
    (t.conversation||'').toLowerCase().includes(query)
  );

  const list = document.getElementById('history-list');

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>${allTickets.length === 0 ? 'No tickets saved yet.' : 'No results found.'}</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(t => {
    const isExpanded = String(expandedId) === String(t.id);
    const agentResponse = (t.conversation||'').includes('Agent:')
      ? (t.conversation||'').split('Agent:')[1].trim()
      : (t.conversation||'');

    return `
      <div class="history-item">
        <div class="history-row" onclick="toggleHistory('${t.id}')">
          <svg class="history-chevron${isExpanded ? ' open' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <div class="history-ticket${isExpanded ? ' expanded' : ''}">${escapeHtml(t.ticket||'')}</div>
          <div class="history-meta">
            ${t.from_pdf ? '<span class="pdf-tag">PDF</span>' : ''}
            <span class="time-badge">${timeAgo(t.created_at)}</span>
            <button class="btn-remove" onclick="event.stopPropagation();removeTicket(${t.id})">✕</button>
          </div>
        </div>
        <div id="hb-${t.id}" style="display:${isExpanded ? 'block' : 'none'}" class="history-body">
          <div class="history-field-label">Response</div>
          <div class="history-field-text mono">${escapeHtml(agentResponse)}</div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn-ghost" onclick="copyConv(${t.id})">Copy response</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function copyConv(id) {
  const ticket = allTickets.find(t => t.id === id);
  if (!ticket) return;
  const agentResponse = (ticket.conversation||'').includes('Agent:')
    ? ticket.conversation.split('Agent:')[1].trim()
    : ticket.conversation || '';
  navigator.clipboard.writeText(agentResponse);
  showToast('Copied');
}

function toggleHistory(id) {
  const sid   = String(id);
  expandedId  = String(expandedId) === sid ? null : sid;
  renderHistory();
}

async function removeTicket(id) {
  try {
    await deleteTicket(id);
    await loadTickets();
    renderHistory();
    showToast('Ticket deleted');
  } catch (e) {
    setStatus('Error deleting: ' + e.message, 'error');
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

/** Escapes HTML special characters to prevent XSS. */
function escapeHtml(t) {
  return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/** Copies encoded text to clipboard and shows a toast. */
function copyText(encoded) {
  navigator.clipboard.writeText(decodeURIComponent(encoded));
  showToast('Copied to clipboard');
}

/**
 * Returns a human-readable time difference string.
 * @param {string} iso - ISO date string
 * @returns {string} e.g. '5m', '2h', '3d'
 */
function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return 'now';
  if (diff < 3600)  return Math.floor(diff / 60)   + 'm';
  if (diff < 86400) return Math.floor(diff / 3600)  + 'h';
  return Math.floor(diff / 86400) + 'd';
}

// Stub kept for backwards compatibility
function updateSettingsBtn() {}

// =============================================================================
// BOOTSTRAP
// =============================================================================

init();
