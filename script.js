// ==========  CONFIG ==========
const GITHUB_USERNAME = "nabil3962";
const CACHE_KEY = `gh_repos_${GITHUB_USERNAME}`;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
const API_URL = `https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&type=owner&sort=updated`;

// DOM
const el = {
  projects: document.getElementById("projects"),
  meta: document.getElementById("meta"),
  search: document.getElementById("search"),
  languageFilter: document.getElementById("language-filter"),
  sort: document.getElementById("sort"),
  tags: document.getElementById("tags"),
  refresh: document.getElementById("refresh"),
};

// small debounce
function debounce(fn, wait=250){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }
}

// fetch with topics accept header (to include topics in response)
async function fetchRepos() {
  const headers = { Accept: "application/vnd.github.mercy-preview+json" };
  const res = await fetch(API_URL, { headers });
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText}`);
  return res.json();
}

// Cache helpers (simple localStorage stale-while-revalidate)
function readCache(){
  try{ const raw = localStorage.getItem(CACHE_KEY); if(!raw) return null;
    const obj = JSON.parse(raw); return obj;
  } catch(e){ return null; }
}
function writeCache(data){
  const payload = { fetchedAt: Date.now(), data };
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch(e){}
}

// Render helpers (single innerHTML update whenever possible)
function renderProjects(list){
  if(!Array.isArray(list)) list = [];
  const metaText = `${list.length} project${list.length===1?"":"s"} • Showing ${filteredCount} after filters`;
  el.meta.textContent = metaText;

  // build cards
  let html = "";
  for (const r of list){
    const topics = (r.topics && r.topics.length) ? r.topics.slice(0,6) : [];
    html += `
      <article class="project">
        <div class="title">
          <div class="avatar">
            <img src="${r.owner?.avatar_url}" alt="${r.owner?.login} avatar" style="width:100%;height:100%;object-fit:cover" />
          </div>
          <div style="flex:1">
            <h2><a href="${r.html_url}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">${escapeHtml(r.name)}</a></h2>
            <div style="font-size:12px;color:var(--muted)">${escapeHtml(r.language || "—")}</div>
          </div>
        </div>

        <div class="desc">${escapeHtml(r.description || "")}</div>

        <div class="row">
          <div class="kv">★ ${r.stargazers_count}</div>
          <div class="kv">⑂ ${r.forks_count}</div>
          <div class="kv">${new Date(r.updated_at).toLocaleDateString()}</div>
          ${r.homepage ? `<a class="link" href="${r.homepage}" target="_blank">Demo</a>` : ""}
          <a class="link" href="${r.html_url}" target="_blank">Repo</a>
        </div>

        <div style="margin-top:10px" class="topics">
          ${topics.map(t => `<span class="topic">${escapeHtml(t)}</span>`).join("")}
        </div>
      </article>
    `;
  }

  el.projects.innerHTML = html || `<div class="muted">No projects found with current filters.</div>`;
}

// simple HTML escape
function escapeHtml(s){
  return String(s || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

// ==========  FILTER / SEARCH LOGIC ==========
let allRepos = [];
let filteredRepos = [];
let activeTag = "";
let filteredCount = 0;

function buildLanguageOptions(repos){
  const languages = Array.from(new Set(repos.map(r=>r.language).filter(Boolean))).sort();
  el.languageFilter.innerHTML = `<option value="">All languages</option>` + languages.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
}

function buildTags(repos){
  const tset = new Set();
  for(const r of repos){
    if(Array.isArray(r.topics)) r.topics.forEach(t => tset.add(t));
  }
  const tags = Array.from(tset).sort();
  el.tags.innerHTML = tags.length ? tags.map(t => `<button class="tag-btn" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("") : `<div class="muted">No tags found</div>`;
  // attach listeners
  for(const btn of el.tags.querySelectorAll(".tag-btn")){
    btn.addEventListener("click", ()=> {
      const tag = btn.dataset.tag;
      if(activeTag === tag){ activeTag = ""; btn.classList.remove("active"); }
      else {
        activeTag = tag;
        // toggle active classes
        el.tags.querySelectorAll(".tag-btn").forEach(b=>b.classList.toggle("active", b===btn));
      }
      applyFilters();
    });
  }
}

function applyFilters(){
  const q = el.search.value.trim().toLowerCase();
  const lang = el.languageFilter.value;
  const sort = el.sort.value;

  filteredRepos = allRepos.filter(r => {
    if (lang && r.language !== lang) return false;
    if (activeTag && !(Array.isArray(r.topics) && r.topics.includes(activeTag))) return false;
    if (q) {
      const hay = ((r.name||"") + " " + (r.description||"") + " " + (r.topics||[]).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // sort
  if (sort === "stars") filteredRepos.sort((a,b)=>b.stargazers_count - a.stargazers_count);
  else if (sort === "name") filteredRepos.sort((a,b)=>a.name.localeCompare(b.name));
  else filteredRepos.sort((a,b)=> new Date(b.updated_at) - new Date(a.updated_at));

  filteredCount = filteredRepos.length;
  renderProjects(filteredRepos);
}

// ========== BOOTSTRAP & CACHING ==========
async function init(forceRefresh=false){
  el.meta.textContent = "Loading projects…";
  try {
    const cache = readCache();
    if (!forceRefresh && cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
      allRepos = cache.data;
      buildLanguageOptions(allRepos);
      buildTags(allRepos);
      applyFilters();
      el.meta.textContent = `Loaded from cache (updated ${new Date(cache.fetchedAt).toLocaleTimeString()})`;
      // still trigger background refresh
      backgroundFetch();
      return;
    }

    // no valid cache or forceRefresh => fetch now
    const data = await fetchRepos();
    allRepos = processRepos(data);
    writeCache(allRepos);
    buildLanguageOptions(allRepos);
    buildTags(allRepos);
    applyFilters();
    el.meta.textContent = `Fetched ${allRepos.length} repos from GitHub`;
  } catch (err) {
    // if cache exists, use cached data as fallback
    const cache = readCache();
    if (cache && cache.data){
      allRepos = cache.data;
      buildLanguageOptions(allRepos);
      buildTags(allRepos);
      applyFilters();
      el.meta.textContent = `Using cached data (live fetch failed). ${err.message}`;
    } else {
      el.meta.textContent = `Failed to load repos: ${err.message}`;
      el.projects.innerHTML = `<div class="muted">Unable to fetch GitHub repos. Check network or rate limits. Try Refresh.</div>`;
    }
  }
}

function processRepos(raw){
  // normalize only required fields (small memory)
  return (raw || []).map(r => ({
    id: r.id,
    name: r.name,
    html_url: r.html_url,
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count || 0,
    forks_count: r.forks_count || 0,
    updated_at: r.updated_at,
    homepage: r.homepage,
    topics: Array.isArray(r.topics) ? r.topics : [],
    owner: { avatar_url: r.owner?.avatar_url, login: r.owner?.login }
  }));
}

// background revalidation to refresh cache silently
async function backgroundFetch(){
  try {
    const fresh = await fetchRepos();
    const normalized = processRepos(fresh);
    writeCache(normalized);
    // if there are changes vs current, update UI
    // simple diff by length or latest updated_at
    const freshest = normalized[0]?.updated_at;
    if (!allRepos.length || (freshest && freshest !== allRepos[0]?.updated_at)) {
      allRepos = normalized;
      buildLanguageOptions(allRepos);
      buildTags(allRepos);
      applyFilters();
      el.meta.textContent = `Background refreshed at ${new Date().toLocaleTimeString()}`;
    }
  } catch(e){
    // silently ignore background errors (rate limit etc)
    console.warn("Background fetch failed:", e);
  }
}

// ========== events ==========
el.search.addEventListener("input", debounce(()=>applyFilters(), 180));
el.languageFilter.addEventListener("change", applyFilters);
el.sort.addEventListener("change", applyFilters);
el.refresh.addEventListener("click", ()=> init(true));

// ========== util ==========
let filteredCount = 0;

// init page
init(false);
