const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => (p == null ? '—' : Math.round(p * 100) + '%');
const money = v => '$' + (v || 0).toFixed(v >= 1 ? 2 : 4);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const raw = k => (k ? String(k).replace(/_/g, ' ') : '—');
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const NICE = {
  pain_problem: 'Pain / problem', desire_outcome: 'Desire / outcome', curiosity: 'Curiosity', social_proof: 'Social proof',
  authority: 'Authority', offer_led: 'Offer-led', news_launch: 'News / launch', contrarian: 'Contrarian', story: 'Story',
  comparison: 'Comparison', urgency_scarcity: 'Urgency', identity_callout: "Who it's for", other: 'Other',
  discount: 'Discount', free_trial: 'Free trial', free_lead_magnet: 'Free webinar / guide', free_consultation: 'Free consultation',
  bundle_bonus: 'Bundle / bonus', guarantee: 'Guarantee', delivery_perk: 'Delivery perk', app_install: 'App install',
  full_price: 'Full price', no_offer_brand: 'No offer',
  buy_now: 'Buy now', register_event: 'Register for event', sign_up: 'Sign up', book_call: 'Book a call',
  download_install: 'Download', claim_offer: 'Claim offer', message_us: 'Message us', learn_more: 'Learn more',
  unaware: 'Unaware', problem_aware: 'Problem aware', solution_aware: 'Solution aware', product_aware: 'Product aware', most_aware: 'Most aware',
  unrelated: 'Unrelated', different_offer: 'Different offer', details_differ: 'Details differ', matches: 'Matches',
};
const nice = k => NICE[k] || raw(k);
const STAGES = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'];
const TAGS = { uses_specific_numbers: 'Numbers', mentions_price: 'Price', has_testimonial: 'Testimonial',
  has_urgency: 'Urgency', has_guarantee: 'Guarantee', targets_specific_audience: 'Named audience' };
const FMT_COLORS = { problem_solution: '#f76707', offer_promo: '#e03e3e', product_announcement: '#7048e8',
  lifestyle_aspiration: '#5c5fd6', catalog_generic: '#9a9a9a', educational_howto: '#d6336c', testimonial_ugc: '#0ca678',
  demo_showcase: '#1c7ed6', brand_story: '#a0522d', comparison: '#2f9e44', meme_entertainment: '#f59f00', other: '#c4c4c4' };
const COLORS = ['#3b5bdb', '#0ca678', '#f08c00', '#ae3ec9', '#1098ad', '#e8590c', '#5c7cfa', '#66a80f'];
const colorOf = {};
const color = k => FMT_COLORS[k] || (colorOf[k] ||= COLORS[Object.keys(colorOf).length % COLORS.length]);
const LP_TEXT = { no_url: 'no link', blocked: 'page blocked', too_little_text: 'no readable text', error: "didn't load",
  not_a_web_page: 'not a web page', catalog: 'catalog ad', jev_error: 'jev error', timeout: 'page too slow to load' };
const KIND = { whatsapp: 'Goes to WhatsApp', messenger: 'Goes to Messenger', app_store: 'Goes to an app store',
  facebook: 'Stays on Facebook', instagram: 'Goes to Instagram' };
const LOW = 0.45;
const DEST = { whatsapp: 'goes to WhatsApp', messenger: 'goes to Messenger', app_store: 'goes to an app store',
  facebook: 'stays on Facebook', instagram: 'goes to Instagram' };
// Where an ad sends people when there's no web page to judge.
function destOf(r) {
  const h = host(r.landing_url);
  const kind = r.lp_kind || (/play\.google|apps\.apple|itunes\.apple/.test(h) ? 'app_store' : /(^|\.)wa\.me$|whatsapp/.test(h) ? 'whatsapp'
    : /(^|\.)m\.me$/.test(h) ? 'messenger' : null);
  return DEST[kind] || LP_TEXT[r.lp_status] || r.lp_status || 'not checked';
}

const S = {
  cfg: null, chips: [], runId: null, live: false, ads: new Map(), rows: new Map(), media: new Map(), order: [],
  stats: {}, es: null, tab: 'ads', lines: 0, cards: new Map(), dirty: new Set(), lastT: 0, lastLocal: 0,
  f: { brand: '', hook: '', offer: '', stage: '', flag: false, review: false, sort: 'new' },
};

// ---------- search box ----------
function renderChips() {
  $('#chips').innerHTML = S.chips.map((c, i) =>
    `<span class="chip"><span title="${esc(c)}">${esc(c)}</span><button type="button" data-i="${i}" aria-label="Remove">×</button></span>`).join('');
  estimate();
  syncClear();
}
const syncClear = () => { $('#qclear').hidden = !S.chips.length && !$('#queryInput').value; };
function addChips(text) {
  text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).forEach(s => { if (!S.chips.includes(s)) S.chips.push(s); });
  renderChips();
}
function estimate() {
  if (!S.cfg) return;
  const n = (S.chips.length + ($('#queryInput').value.trim() ? 1 : 0)) * +$('#perBrand').value;
  if (!n) { $('#estimate').textContent = ''; return; }
  const apify = n * S.cfg.apify_usd_per_ad, jev = n * S.cfg.jev_usd_per_ad;
  $('#estimate').textContent = `Up to ${n} ads · est. ≤ ${money(apify + jev)} (Apify ${money(apify)} + Jev ${money(jev)})`;
}
$('#queryInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!R.open) { showRecent(); return; }
    const n = R.items.length;
    R.hi = e.key === 'ArrowDown' ? (R.hi + 1) % n : (R.hi <= 0 ? n - 1 : R.hi - 1);
    highlightRecent();
  } else if (e.key === 'Escape' && R.open) { e.preventDefault(); setRecentOpen(false); }
  else if (e.key === 'Enter' && R.open && R.hi >= 0) { e.preventDefault(); pickRecent(R.items[R.hi].id); }
  else if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) { e.preventDefault(); const v = e.target.value; e.target.value = ''; addChips(v); setRecentOpen(false); }
  else if (e.key === 'Backspace' && !e.target.value && S.chips.length) { S.chips.pop(); renderChips(); }
});
$('#queryInput').addEventListener('input', () => { estimate(); syncClear(); R.hi = -1; showRecent(); });
$('#queryInput').addEventListener('paste', e => {
  const t = e.clipboardData.getData('text');
  if (/[\n,]/.test(t)) { e.preventDefault(); addChips(t); }
});
$('#queryBox').addEventListener('click', e => {
  if (e.target.dataset.i != null) { S.chips.splice(+e.target.dataset.i, 1); renderChips(); }
  $('#queryInput').focus();
  showRecent();
});
$('#qclear').addEventListener('click', e => {
  e.stopPropagation();
  S.chips = []; $('#queryInput').value = ''; renderChips();
  $('#queryInput').focus(); R.hi = -1; showRecent();
});
$('#perBrand').addEventListener('change', estimate);
$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pending = $('#queryInput').value.trim();
  if (pending) { $('#queryInput').value = ''; addChips(pending); }
  if (!S.chips.length) { $('#queryInput').focus(); return; }
  setRecentOpen(false);
  if (S.cfg && (!S.cfg.has_openrouter || !S.cfg.has_apify)) {
    openSettings(`Add your ${[!S.cfg.has_openrouter && 'OpenRouter key', !S.cfg.has_apify && 'Apify token'].filter(Boolean).join(' and ')} to start searching.`);
    return;
  }
  $('#searchBtn').disabled = true;
  if (S.live && S.runId) fetch(`/api/runs/${S.runId}/stop`, { method: 'POST' }).catch(() => {});
  try {
    const r = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brands: S.chips, country: $('#country').value, per_brand: +$('#perBrand').value, reuse: $('#reuse').checked }) });
    if (!r.ok) throw new Error(await r.text());
    const { id } = await r.json();
    await openRun(id);
  } catch (err) { alert('Could not start: ' + err.message); }
  $('#searchBtn').disabled = false;
});

// ---------- recent searches: a Google-style dropdown under the search bar ----------
// The × on a row, or "Clear all", moves the search to runs/.cleared/ on the server (restorable), never deletes it.
const R = { runs: [], items: [], open: false, hi: -1 };
const CLOCK = '<svg viewBox="0 0 24 24" class="rc-ic" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const runBrands = m => (m.brands_found?.length ? m.brands_found : m.request?.brands) || [];
const isRunning = m => !(S.cfg?.terminal_states || ['done', 'stopped', 'failed', 'interrupted']).includes(m.stats?.status);

async function loadRecent() {
  try { R.runs = await (await fetch('/api/runs')).json(); } catch { return; }
  if (R.open) renderRecent();
}
function renderRecent() {
  const q = $('#queryInput').value.trim().toLowerCase();
  R.items = R.runs.filter(m => !q || [...runBrands(m), ...(m.request?.brands || [])]
    .some(b => String(b).toLowerCase().includes(q))).slice(0, 8);
  if (R.hi >= R.items.length) R.hi = R.items.length - 1;
  $('#recent').innerHTML = `<div class="rc-head"><span>Recent searches</span>`
    + `<button type="button" class="rc-clear" data-clear>Clear all</button></div>`
    + R.items.map((m, i) => {
      const b = runBrands(m);
      const when = new Date(m.created).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const country = m.request?.country === 'ALL' ? 'All countries' : m.request?.country;
      const live = isRunning(m);
      return `<div class="rc-item" role="option" id="rc-${i}" data-run="${esc(m.id)}" aria-selected="${i === R.hi}">${CLOCK}
        <div class="rc-text"><b>${esc(b.slice(0, 3).join(', '))}${b.length > 3 ? ` +${b.length - 3}` : ''}</b>
        <small>${esc(country)} · ${m.stats?.analysed || 0} ads · ${when}</small></div>
        ${live ? '<span class="rc-live">Running</span>'
          : `<button type="button" class="rc-x" data-remove="${esc(m.id)}" aria-label="Remove ${esc(b.join(', '))} from recent searches" title="Remove">
             <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`}
      </div>`;
    }).join('');
  highlightRecent();
  if (!R.items.length) setRecentOpen(false);
}
function setRecentOpen(open) {
  R.open = open && R.items.length > 0;
  $('#recent').hidden = !R.open;
  $('#gbar').classList.toggle('open', R.open);
  $('#queryInput').setAttribute('aria-expanded', R.open);
  if (!R.open) { R.hi = -1; $('#queryInput').removeAttribute('aria-activedescendant'); }
}
function showRecent() { renderRecent(); setRecentOpen(true); }
function highlightRecent() {
  document.querySelectorAll('#recent .rc-item').forEach((el, i) => el.setAttribute('aria-selected', i === R.hi));
  if (R.hi >= 0) $('#queryInput').setAttribute('aria-activedescendant', 'rc-' + R.hi);
  else $('#queryInput').removeAttribute('aria-activedescendant');
}
function pickRecent(id) { setRecentOpen(false); $('#queryInput').value = ''; syncClear(); estimate(); $('#queryInput').blur(); openRun(id); }
async function removeRecent(id) {
  const r = await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
  if (!r?.ok) { alert(r?.status === 409 ? 'This search is still running. Stop it first.' : 'Could not remove that search.'); return; }
  R.runs = R.runs.filter(m => m.id !== id);
  if (S.runId === id) closeRun();
  renderRecent();
}
async function clearRecent() {
  if (!confirm('Clear all recent searches?\n\nThey move to runs/.cleared/ and can be restored from there. Searches still running are kept.')) return;
  const r = await fetch('/api/runs', { method: 'DELETE' }).catch(() => null);
  if (!r?.ok) { alert('Could not clear recent searches.'); return; }
  await loadRecent();
  if (S.runId && !R.runs.some(m => m.id === S.runId)) closeRun();
  setRecentOpen(false);
  $('#queryInput').focus();
}
// Keep focus in the input while using the dropdown, so clicking a row doesn't close it first.
$('#recent').addEventListener('mousedown', e => e.preventDefault());
$('#recent').addEventListener('click', e => {
  const x = e.target.closest('[data-remove]');
  if (x) { removeRecent(x.dataset.remove); return; }
  if (e.target.closest('[data-clear]')) { clearRecent(); return; }
  const row = e.target.closest('[data-run]');
  if (row) pickRecent(row.dataset.run);
});
$('#recent').addEventListener('mousemove', e => {
  const row = e.target.closest('.rc-item');
  const i = row ? +row.id.slice(3) : -1;
  if (i !== R.hi) { R.hi = i; highlightRecent(); }
});
$('#gbar').addEventListener('focusout', e => { if (!$('#gbar').contains(e.relatedTarget)) setRecentOpen(false); });

// Back to the empty search page (the open search was removed from Recent).
function closeRun() {
  if (S.es) S.es.close();
  stopReplay();
  clearTimeout(finaleTimer);
  if (V) V.queue.length = 0;
  Object.assign(S, { runId: null, live: false });
  $('#finale').hidden = true;
  $('#runView').hidden = true;
  document.body.classList.remove('has-run');
}

// ---------- opening a run ----------
async function openRun(id) {
  if (S.es) S.es.close();
  stopReplay();
  clearTimeout(finaleTimer);
  Object.assign(S, { runId: id, ads: new Map(), rows: new Map(), media: new Map(), order: [], stats: {}, lines: 0,
    cards: new Map(), dirty: new Set(), live: false, lastI: -1 });
  $('#console').innerHTML = ''; $('#adGrid').innerHTML = '';
  $('#runView').hidden = false;
  document.body.classList.add('has-run');
  const data = await (await fetch(`/api/runs/${id}`)).json();
  const req = data.meta.request;
  S.request = req;
  S.live = !!data.live;
  setTitle(data.meta.brands_found?.length ? data.meta.brands_found : req.brands);
  $('#csvBtn').href = `/api/runs/${id}/csv`;
  S.stats = data.meta.stats || {};
  wrReset('live');
  if (data.live) {
    connect(id);
  } else {
    data.ads.forEach(a => { S.ads.set(a.ad_id, a); S.order.push(a.ad_id); });
    data.rows.forEach(r => { S.rows.set(r.ad_id, r); if (r.img) S.media.set(r.ad_id, { image: true }); });
    S.order.forEach(i => S.dirty.add(i));
    line(0, 'DONE', `Saved search from ${esc(new Date(data.meta.created).toLocaleString())} · ${S.rows.size} ads analysed by Jev`);
    data.rows.slice(0, 300).forEach(r => jevLine(0, r));
    wrShowStatic();
  }
  window.scrollTo({ top: $('#runView').offsetTop - 60, behavior: 'smooth' });
  render();
}

function setTitle(brands) {
  S.titleBrands = brands;
  const name = brands.length > 1 ? 'the whole category' : (brands[0] || 'search');
  $('#runTitle').textContent = S.live ? `${name}, live` : name;
  const req = S.request || {};
  $('#runSub').textContent = `${brands.join(' · ')} · ${req.country === 'ALL' ? 'all countries' : req.country} · every hook, offer and angle they're running · ${S.cfg?.model || 'jev'}`;
}

function connect(id) {
  S.es = new EventSource(`/api/runs/${id}/events`);
  S.es.onmessage = e => handle(JSON.parse(e.data));
  S.es.onerror = () => {
    if (!S.live) S.es.close();
    else if (S.es.readyState === EventSource.CLOSED && S.runId === id) openRun(id);  // stream gone: show it as saved
  };
}

function handle(ev) {
  if (ev.i != null) { if (ev.i <= S.lastI) return; S.lastI = ev.i; }
  S.stats = ev.s; S.lastT = ev.t; S.lastLocal = performance.now();
  switch (ev.type) {
    case 'log': line(ev.t, ev.kind, esc(ev.msg)); break;
    case 'ad': {
      const a = ev.ad; S.ads.set(a.ad_id, a); S.order.push(a.ad_id); S.dirty.add(a.ad_id);
      setTitle([...new Set([...S.ads.values()].map(x => x.brand))]);
      line(ev.t, 'PULL', `<span class="hl">${esc(a.brand)}</span> · ${esc(a.format || 'ad')} · ${a.days_running ?? '?'}d running · “${esc((a.body || a.headline || '').split('\n')[0].slice(0, 90))}”`);
      wrPulled(a);
      break;
    }
    case 'media': {
      S.media.set(ev.ad_id, ev); S.dirty.add(ev.ad_id);
      wrThumb(ev.ad_id);
      const p = ev.page || {};
      if (p.status === 'ok') line(ev.t, 'PAGE', `${esc(host(p.url))} → read${p.via === 'apify_browser' ? ' (real browser)' : ''} · “${esc((p.title || '').slice(0, 70))}”`);
      else if (p.status !== 'no_url' && p.status !== 'catalog') line(ev.t, 'PAGE', `${esc(host(p.url) || '')} → ${esc(KIND[p.kind] || LP_TEXT[p.status] || p.status)}`);
      break;
    }
    case 'tagged': {
      const r = ev.row; S.rows.set(r.ad_id, r); S.dirty.add(r.ad_id);
      if (ev.partial) jevLine(ev.t, r, 'ad'); else if (r.error) jevLine(ev.t, r); else jevLine(ev.t, r, 'page');
      wrAnalysed(r, !!ev.partial);
      break;
    }
    case 'done':
      line(ev.t, 'DONE', `Finished · ${S.stats.analysed} ads · ${S.stats.judgments.toLocaleString()} Jev judgments · Jev cost ${money(S.stats.jev_cost)} · ${S.stats.elapsed}s`);
      S.live = false; S.es.close(); loadRecent(); setTitle(S.titleBrands || []); wrTiles();  // final state now, even in a background tab
      if (!S.rows.size) wrNoAds();
      scheduleFinale(900);
      break;
    case 'failed':
      line(ev.t, 'ERROR', esc(ev.error)); S.live = false; S.es.close(); loadRecent(); setTitle(S.titleBrands || []); wrTiles();
      if (!S.rows.size) wrNoAds();
      break;
  }
  schedule();
}

// ---------- raw feed ----------
function jevLine(t, r, part = 'both') {
  const id = `#${esc(String(r.ad_id).slice(-6))}`;
  if (r.error) { line(t, 'ERROR', `${id} ${esc(r.error.slice(0, 140))}`); return; }
  if (part !== 'page') {
    line(t, 'JEV', `${id} hook=<span class="hl">${esc(r.hook_type)}</span> <span class="p">${pct(r.hook_type_conf)}</span>`
      + ` · format=<span class="hl">${esc(r.creative_format)}</span> · offer=<span class="hl">${esc(r.offer_type)}</span> <span class="p">${pct(r.offer_type_conf)}</span>`
      + ` · stage=${esc(r.awareness_stage)} · driver=${esc(r.driver)}`
      + (part === 'ad' ? ` · ${r.judgments || '?'} answers · ${r.jev_ms ?? '?'}ms · ${money(r.cost_usd)}` : ''));
  }
  if (part !== 'ad' && r.lp_match) {
    line(t, 'JEV', `${id} page=<span class="hl">${esc(r.lp_match)}</span> · same offer <span class="p">${pct(r.lp_same_offer)}</span>`
      + ` · headline continues hook <span class="p">${pct(r.lp_headline_continues_hook)}</span>${r.lp_homepage ? ' · homepage' : ''}`);
  }
  if (part !== 'ad' && r.mismatch) line(t, 'FLAG', `${esc(r.brand)}: page doesn't match the ad's offer (same offer ${pct(r.lp_same_offer)}${r.lp_free_to_paid > 0.6 ? ', free in ad → paid on page' : ''})`);
}
function line(t, kind, html) {
  const c = $('#console');
  const el = document.createElement('div');
  el.className = 'line';
  el.innerHTML = `<span class="t">${(+t || 0).toFixed(1)}s</span><span class="k k-${kind}">${kind}</span>${html}`;
  c.appendChild(el);
  if (++S.lines > 600) c.firstChild.remove();
  $('#consoleCount').textContent = `· ${S.lines} events`;
  if ($('#autoscroll').checked) c.scrollTop = c.scrollHeight;
}

// ---------- sort stage ----------
// Every ad pulled lands in an unsorted pile; when Jev tags it, its thumbnail flies along a curved trail into
// the bin for its format (or hook, offer, stage). Thumbnails are the same elements the war room highlights and pins.
const BY = {  // row field -> [name in the prompt, plural for the totals]
  creative_format: ['creative format', 'formats'], hook_type: ['hook', 'hooks'],
  offer_type: ['offer', 'offers'], awareness_stage: ['awareness stage', 'stages'],
};
const ST = { by: 'creative_format', bins: new Map(), at: new Map(), spot: new Map(), pile: new Set(), fl: new Map(),
  tails: [], n: 0, m: null, ps: 40, binBox: null, raf: 0, typing: 0, ready: false };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const FLY_MS = 900, TAIL = 0.45;
const frac = x => x - Math.floor(x);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const keyOf = r => (!r || r.error ? '_error' : r[ST.by] || 'other');
const binName = k => (k === '_error' ? "Couldn't read" : cap(nice(k)));
const binColor = k => (k === '_error' ? '#6b7280' : color(k));

function stMeasure() {
  const stage = $('#stage'), pile = $('#pile'), w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  const pw = pile.clientWidth, ph = pile.clientHeight, ry = ph * 0.36, rx = Math.min(pw * 0.42, ry * 1.25);
  ST.m = { w, h, cx: pile.offsetLeft + pw / 2, cy: pile.offsetTop + ph / 2 + 8, rx, ry, f: 1 };
  const c = $('#trails'), d = window.devicePixelRatio || 1;
  c.width = Math.round(w * d); c.height = Math.round(h * d);
  c.getContext('2d').setTransform(d, 0, 0, d, 0, 0);
  ST.binBox = null;
  stPileSize();
  ST.bins.forEach(stFit);
}
// Thumbnails shrink as the pile grows so it stays one dense ball; a small pile pulls in towards the centre.
function stPileSize() {
  const m = ST.m;
  if (!m) return;
  const n = Math.max(ST.n, 1), area = Math.PI * m.rx * m.ry;
  ST.ps = Math.max(12, Math.min(56, 1.5 * Math.sqrt(area / n)));
  m.f = Math.max(0.3, Math.min(1, ST.ps * Math.sqrt(n / area) / 1.5));
  const st = $('#pile').style;
  st.setProperty('--ps', ST.ps.toFixed(1) + 'px');
  st.setProperty('--rx', (m.rx * m.f).toFixed(1) + 'px');
  st.setProperty('--ry', (m.ry * m.f).toFixed(1) + 'px');
  $('#pile').classList.toggle('tiny', ST.ps < 14);
}
function stAdd(id, el) {
  // A fixed, evenly scattered spot in the unit disc for the i-th ad, so the pile stays even however many arrive.
  const i = ST.n++, r = Math.sqrt(frac(0.5 + i * 0.7548776662466927)) * 0.94, a = 2 * Math.PI * frac(0.5 + i * 0.5698402909980532);
  const spot = [r * Math.cos(a), r * Math.sin(a), (frac(i * 0.381966) - 0.5) * 22];
  ST.spot.set(id, spot); ST.at.set(id, null); ST.pile.add(id);
  el.style.setProperty('--px', spot[0].toFixed(4));
  el.style.setProperty('--py', spot[1].toFixed(4));
  el.style.setProperty('--rot', spot[2].toFixed(1) + 'deg');
  $('#pile').appendChild(el);
  stPileSize();
}

function stBin(k) {
  let b = ST.bins.get(k);
  if (b) return b;
  const el = document.createElement('div'), c = binColor(k);
  el.className = 'bin';
  el.style.setProperty('--c', c);
  el.innerHTML = `<div class="bin-h"><i></i><span title="${esc(binName(k))}">${esc(binName(k))}</span><b>0</b></div><div class="bin-g"></div>`;
  b = { k, c, el, grid: el.lastChild, num: el.querySelector('b'), shown: 0, plan: 0, s: 0 };
  ST.bins.set(k, b);
  const n = ST.bins.size, box = $('#bins');
  box.style.setProperty('--cols', n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : 5);
  box.appendChild(el);
  ST.binBox = null;  // every bin changes size when one is added
  ST.bins.forEach(stFit);
  return b;
}
// Largest thumbnail size that still fits everything headed for this bin (all bins are the same size).
function stFit(b) {
  if (!ST.binBox) ST.binBox = [b.grid.clientWidth, b.grid.clientHeight];
  const [w, h] = ST.binBox, n = Math.max(b.grid.childElementCount, b.plan, 1);
  if (!w || !h) return;
  let s = 40;
  while (s > 5 && Math.floor((w + 2) / (s + 2)) * Math.floor((h + 2) / (s + 2)) < n) s--;
  if (b.s === s) return;
  b.s = s;
  b.grid.style.setProperty('--bs', s + 'px');
  b.grid.classList.toggle('tiny', s < 14);  // too small to carry the "needs a human" dot
}
// Bins for rows we already have, biggest first (awareness stages keep their funnel order), each sized for its final count.
function stPlan(rows) {
  const c = {};
  rows.forEach(r => { const k = keyOf(r); c[k] = (c[k] || 0) + 1; });
  const keys = Object.keys(c).sort((a, b) => c[b] - c[a]);
  if (ST.by === 'awareness_stage') keys.sort((a, b) => (STAGES.indexOf(a) + 99) % 99 - (STAGES.indexOf(b) + 99) % 99);
  keys.forEach(k => { stBin(k).plan = c[k]; });
  ST.bins.forEach(stFit);
}

// Send one ad to its bin. `from` = [x, y, width] in stage coordinates when the thumbnail is already off the pile.
function stSort(id, delay = 0, from) {
  const el = V.thumbs.get(id);
  if (!el) return;
  const k = keyOf(V.rows.get(id)), was = ST.at.get(id);
  if (was === k) return;
  const b = stBin(k), slot = document.createElement('i');
  slot.className = 'slot';
  b.grid.appendChild(slot);
  stFit(b);
  ST.at.set(id, k);
  let f = ST.fl.get(id);
  if (f) { f.slot.remove(); f.slot = slot; f.b = b; }  // already in the air: change course
  else {
    f = { id, el, slot, b, t0: performance.now() + delay, dur: FLY_MS, bend: (Math.random() - 0.5) * 90, rot: 0, up: false };
    if (was != null && !from) {  // sitting in another bin: lift it from where it is
      const sr = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect();
      from = [r.left - sr.left + r.width / 2, r.top - sr.top + r.height / 2, r.width];
      stUnbin(was);
    }
    if (from) { f.p0 = from; f.w0 = from[2]; stLift(f); }
    ST.fl.set(id, f);
  }
  if (REDUCED.matches || document.hidden || !ST.m) stLand(f);
  else stRun();
}
function stUnbin(k) { const b = ST.bins.get(k); if (b) b.num.textContent = --b.shown; }
function stLift(f) {
  if (!f.p0) {  // still in the pile: its spot is known without measuring
    const m = ST.m, [x, y, rot] = ST.spot.get(f.id);
    f.p0 = [m.cx + x * m.rx * m.f, m.cy + y * m.ry * m.f]; f.w0 = ST.ps; f.rot = rot;
  }
  f.up = true;
  ST.pile.delete(f.id);
  f.el.style.width = f.el.style.height = f.w0 + 'px';
  f.el.style.transform = `translate(${f.p0[0] - f.w0 / 2}px,${f.p0[1] - f.w0 / 2}px) rotate(${f.rot}deg)`;
  $('#fly').appendChild(f.el);
}
function stLand(f) {
  ST.fl.delete(f.id);
  ST.pile.delete(f.id);
  f.el.style.width = f.el.style.height = f.el.style.transform = '';
  f.slot.replaceWith(f.el);
  f.b.num.textContent = ++f.b.shown;
  if (f.up && !REDUCED.matches) {
    f.el.animate([{ scale: 1.45 }, { scale: 1 }], { duration: 240, easing: 'ease-out' });
    f.b.el.animate([{ borderColor: f.b.c }, {}], { duration: 600, easing: 'ease-out' });
  }
  if (!ST.fl.size) stStatus();
}

// The curve a flight follows: leaves and arrives level, so the trails read as streams between pile and bins.
function stPoint(f, u) {
  const [x0, y0] = f.p0, [x3, y3] = f.to, dx = x3 - x0, dy = y3 - y0, flat = Math.abs(dx) >= Math.abs(dy);
  const x1 = flat ? x0 + dx * 0.5 : x0 + f.bend, y1 = flat ? y0 + f.bend : y0 + dy * 0.5;
  const x2 = flat ? x3 - dx * 0.5 : x3, y2 = flat ? y3 : y3 - dy * 0.5, v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return [a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3];
}
function stTrail(ctx, f, t) {
  const head = ease(Math.min(1, t)), tail = ease(Math.max(0, Math.min(1, t - TAIL)));
  if (head - tail < 0.004) return;
  const [tx, ty] = stPoint(f, tail), [hx, hy] = stPoint(f, head);
  const g = ctx.createLinearGradient(tx, ty, hx, hy);
  g.addColorStop(0, f.b.c + '00'); g.addColorStop(1, f.b.c + 'f0');
  ctx.strokeStyle = g; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(tx, ty);
  for (let i = 1; i <= 14; i++) { const [x, y] = stPoint(f, tail + (head - tail) * i / 14); ctx.lineTo(x, y); }
  ctx.stroke();
  if (t < 1) {  // the faint route ahead
    ctx.strokeStyle = f.b.c + '26'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, hy);
    for (let i = 1; i <= 10; i++) { const [x, y] = stPoint(f, head + (1 - head) * i / 10); ctx.lineTo(x, y); }
    ctx.stroke();
  }
}
function stRun() { if (!ST.raf) ST.raf = requestAnimationFrame(stFrame); }
function stFrame(now) {
  ST.raf = 0;
  const m = ST.m, sr = $('#stage').getBoundingClientRect(), air = [], landed = [];
  for (const f of ST.fl.values()) {  // read every target first, then write
    if (now < f.t0) continue;
    const r = f.slot.getBoundingClientRect();
    f.to = [r.left - sr.left + r.width / 2, r.top - sr.top + r.height / 2, r.width];
    air.push(f);
  }
  const ctx = $('#trails').getContext('2d');
  ctx.clearRect(0, 0, m.w, m.h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const f of air) {
    if (!f.up) stLift(f);
    const t = Math.min(1, (now - f.t0) / f.dur), e = ease(t), [x, y] = stPoint(f, e);
    const size = (f.w0 + (f.to[2] - f.w0) * e) * (1 + 0.18 * Math.sin(Math.PI * t));
    f.el.style.transform = `translate(${x - f.w0 / 2}px,${y - f.w0 / 2}px) rotate(${f.rot * (1 - e)}deg) scale(${size / f.w0})`;
    stTrail(ctx, f, t);
    if (t >= 1) landed.push(f);
  }
  ST.tails = ST.tails.filter(f => {  // trails of thumbnails that just landed drain into the bin
    const t = (now - f.t0) / f.dur;
    if (t < 1 + TAIL) stTrail(ctx, f, t);
    return t < 1 + TAIL;
  });
  landed.forEach(f => { stLand(f); ST.tails.push(f); });
  if (ST.fl.size || ST.tails.length) stRun();
}

// Switch what the bins mean: everything already sorted flies across to its new bin.
function stSetBy(by) {
  if (by === ST.by || !BY[by]) return;
  ST.by = by;
  document.querySelectorAll('#spBy button').forEach(x => { const on = x.dataset.by === by; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  stType();
  if (!V) return;
  [...ST.fl.values()].forEach(stLand);
  ST.tails = [];
  const ids = [...ST.at].filter(([, k]) => k != null).map(([id]) => id);
  const sr = $('#stage').getBoundingClientRect();
  const from = ids.map(id => { const r = V.thumbs.get(id).getBoundingClientRect(); return [r.left - sr.left + r.width / 2, r.top - sr.top + r.height / 2, r.width]; });
  ids.forEach(id => ST.at.set(id, undefined));
  ST.bins.forEach(b => b.el.remove());
  ST.bins.clear();
  ST.ready = false; $('#spReady').hidden = true;
  stPlan(ids.map(id => V.rows.get(id)));
  const gap = Math.min(1400, ids.length * 5) / Math.max(ids.length, 1);
  ids.forEach((id, i) => stSort(id, i * gap, from[i]));
  stStatus();
}
// Sort a whole saved search in one cascade: at most ~150 thumbnails in the air at once.
function stCascade(ids) {
  const gap = Math.min(4500, Math.max(900, ids.length * 6)) / Math.max(ids.length, 1);
  ids.forEach((id, i) => stSort(id, 450 + i * gap));
  stStatus();
}

function stType() {
  const text = `Sort every ad by ${BY[ST.by][0]}`, el = $('#spPrompt');
  clearInterval(ST.typing);
  if (REDUCED.matches) { el.textContent = text; return; }
  let i = 0;
  el.textContent = '';
  ST.typing = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(ST.typing); }, 26);
}
function stStatus() {
  if (!V) return;
  const total = ST.n, left = ST.pile.size, all = [...ST.bins.values()], done = all.reduce((s, b) => s + b.shown, 0);
  const bins = all.filter(b => b.shown && b.k !== '_error'), bad = ST.bins.get('_error')?.shown || 0, read = done - bad;  // "couldn't read" isn't a format
  const busy = S.live || V.mode === 'replay' || ST.fl.size > 0, word = BY[ST.by][1];
  const kinds = plural(bins.length, word.slice(0, -1), word), unread = bad ? ` · ${bad.toLocaleString()} couldn't be read` : '';
  $('#pileCap').textContent = left ? `Unsorted · ${left.toLocaleString()}` : busy ? 'Unsorted' : '';
  $('#spBar').style.width = (total ? 100 * done / total : 0) + '%';
  $('#spStatus').textContent = !total ? (S.live ? 'Waiting for the first ads…' : 'No ads to sort.')
    : busy ? `Sorting ${done.toLocaleString()} of ${plural(total, 'ad', 'ads')}`
    : left ? `${done.toLocaleString()} of ${plural(total, 'ad', 'ads')} sorted · ${left.toLocaleString()} not read`
    : read ? `${plural(read, 'ad', 'ads')} sorted into ${kinds}${unread}` : `${plural(bad, 'ad', 'ads')} couldn't be read`;
  const ready = read > 0 && !busy && !left;
  if (ready === ST.ready) return;
  ST.ready = ready;
  $('#spReady').hidden = !ready;
  if (!ready) return;
  const top = bins.sort((a, b) => b.shown - a.shown).slice(0, 3);
  $('#spReady').innerHTML = `<h3>Every ad is sorted.</h3><div class="big">${plural(read, 'ad', 'ads')}.<br>${kinds}.</div>`
    + top.map(b => `<div class="rr" style="--c:${b.c}"><i></i><span>${esc(binName(b.k))}</span><b>${b.shown} · ${Math.round(100 * b.shown / Math.max(read, 1))}%</b></div>`).join('');
}
function stReset() {
  cancelAnimationFrame(ST.raf);
  Object.assign(ST, { raf: 0, tails: [], n: 0, ready: false });
  [ST.bins, ST.at, ST.spot, ST.pile, ST.fl].forEach(x => x.clear());
  document.querySelectorAll('#pile .th').forEach(e => e.remove());
  $('#bins').innerHTML = ''; $('#fly').innerHTML = '';
  $('#spReady').hidden = true;
  stMeasure();
  if (ST.m) $('#trails').getContext('2d').clearRect(0, 0, ST.m.w, ST.m.h);
  stType();
  stStatus();
}
$('#spBy').addEventListener('click', e => { const b = e.target.closest('[data-by]'); if (b) stSetBy(b.dataset.by); });
new ResizeObserver(() => { if (V) stMeasure(); }).observe($('#stage'));

// ---------- teardown war room ----------
// V is what the war room shows. Live: fed by events. Replay: fed by a timer from saved rows.
let V = null;
function wrReset(mode) {
  V = { mode, rows: new Map(), order: [], thumbs: new Map(), queue: [], shown: new Set(), current: null, pinned: false,
        humans: 0, humanKeys: new Set(), t0: performance.now(), firstT: null, batch: false };
  stReset();
  $('#human').innerHTML = '<div class="td-empty">Low-confidence calls land here.</div>';
  $('#td').innerHTML = '<div class="td-empty">Waiting for the first ad…</div>';
  $('#adview').innerHTML = '<div class="td-empty">The real ad shows here, in sync with the teardown.</div>';
  $('#adview').dataset.id = ''; $('#avMeta').textContent = '';
  $('#tdMs').textContent = '';
  $('#finale').hidden = true;
  ['#tAds', '#tJudg', '#tAdv', '#tRate', '#tTime', '#tCost'].forEach(s => { $(s).dataset.v = ''; });
  wrLegend();
  wrTiles();
}
function imgSrc(id) {
  const r = (V && V.rows.get(id)) || S.rows.get(id), m = S.media.get(id);
  return (r?.img || m?.image) ? `/runs/${encodeURIComponent(S.runId)}/img/${encodeURIComponent(String(id).replace(/[^\w-]/g, '_'))}.jpg` : null;
}
function wrPulled(a) {
  if (V.thumbs.has(a.ad_id)) return;
  V.order.push(a.ad_id);
  const el = document.createElement('div');
  el.className = 'th pending';
  el.title = a.brand;
  el.innerHTML = `<span class="ini">${esc((a.brand || '?').slice(0, 2))}</span>`;
  el.onclick = () => pin(a.ad_id);
  V.thumbs.set(a.ad_id, el);
  wrThumb(a.ad_id);
  // Warm the browser cache so the real ad shows instantly when the teardown reaches it.
  const pre = (a.image_urls || [])[0] || a.video_thumbnail_url || a.page_avatar;
  if (pre) { const im = new Image(); im.src = pre; }
  if (a.page_avatar) { const im = new Image(); im.src = a.page_avatar; }
  stAdd(a.ad_id, el);
}
// Show the saved image on an ad's thumbnail as soon as there is one (it starts as the advertiser's initials).
function wrThumb(id) {
  const el = V && V.thumbs.get(id), src = imgSrc(id);
  if (!el || !src || el.querySelector('img')) return;
  el.innerHTML = `<img src="${src}" alt="">`;
  el.classList.remove('pending');
}
function needsHuman(r) {
  const out = [];
  const ch = [['hook_type', 'hook archetype'], ['creative_format', 'format'], ['offer_type', 'offer'], ['cta_ask', 'cta intent'],
    ['driver', 'driver'], ['funnel', 'funnel'], ['awareness', 'awareness'], ['hook_specificity', 'hook specificity'],
    ['offer_strength', 'offer strength'], ['durability', 'durability']];
  ch.forEach(([k, label]) => { const c = r[k + '_conf']; if (c != null && c < LOW) out.push([label, c]); });
  if (r.claim_risk != null && r.claim_risk > 0.35 && r.claim_risk < 0.65) out.push(['claim risk', r.claim_risk]);
  if (r.lp_same_offer != null && r.lp_same_offer > 0.35 && r.lp_same_offer < 0.65) out.push([r.lp_homepage ? 'homepage match' : 'message match', r.lp_same_offer]);
  return out;
}
function wrAnalysed(r, partial) {
  if (!V.thumbs.has(r.ad_id) && S.ads.has(r.ad_id)) wrPulled(S.ads.get(r.ad_id));
  if (V.firstT == null) V.firstT = performance.now();
  V.rows.set(r.ad_id, r);
  const el = V.thumbs.get(r.ad_id);
  if (el) {
    el.classList.remove('pending');
    wrThumb(r.ad_id);
    el.classList.toggle('flag', !!r.mismatch);
    const hs = needsHuman(r);
    el.classList.toggle('needs', !r.mismatch && hs.length > 0);
    el.title = r.error ? `${r.brand} · couldn't be read` : `${r.brand} · ${raw(r.hook_type)} · ${raw(r.creative_format)}`;
    if (!V.batch) stSort(r.ad_id);
  }
  needsHuman(r).forEach(([field, p]) => {
    const key = r.ad_id + field;
    if (V.humanKeys.has(key)) return;
    V.humanKeys.add(key); V.humans++;
    const box = $('#human');
    if (box.querySelector('.td-empty')) box.innerHTML = '';
    const c = document.createElement('div');
    c.className = 'hc';
    c.innerHTML = `<b>${esc(r.brand)}</b><div class="f">${esc(field)}</div><div class="n">${pct(p)}</div><div class="c">too close to call</div>`;
    c.onclick = () => pin(r.ad_id);
    box.prepend(c);
    while (box.children.length > 60) box.lastChild.remove();
  });
  if (V.current === r.ad_id) showTeardown(r.ad_id);
  else if (!V.queue.includes(r.ad_id) && (!V.shown.has(r.ad_id) || (!partial && r.mismatch))) V.queue.push(r.ad_id);
  scheduleWr();
}

// Teardown ticker: show each analysed ad in turn. Lingers when ads trickle in (so you can read the ad),
// speeds up when Jev outruns the eye, and resumes 8s after you click an ad to inspect it.
let lastShow = 0;
setInterval(() => {
  if (!V || !V.queue.length) return;
  if (V.pinned) { if (performance.now() < V.pinnedUntil) return; V.pinned = false; }
  const q = V.queue.length;
  const dwell = q > 20 ? 450 : q > 8 ? 700 : q > 3 ? 1100 : 1800;  // long enough to see the real ad
  if (performance.now() - lastShow < dwell) return;
  if (q > 40) V.queue.splice(0, q - 15);  // far behind: jump closer to the newest ads
  lastShow = performance.now();
  showTeardown(V.queue.shift());
}, 100);
function pin(id) { V.pinned = true; V.pinnedUntil = performance.now() + 8000; showTeardown(id); }

function verdictHtml(r) {
  if (!r || !r.hook_type) return '';
  return [`jev → hook · ${raw(r.hook_type)}`, `format · ${raw(r.creative_format)}`, `offer · ${raw(r.offer_type)}`, raw(r.awareness_stage)]
    .map(t => `<span>${esc(t)}</span>`).join('')
    + (r.mismatch ? '<span class="red">page breaks promise</span>'
      : r.lp_status === 'ok' && !r.lp_homepage ? '<span class="green">page holds</span>'
      : r.lp_status === 'pending' ? '<span>checking page…</span>' : '');
}

// The real ad, rendered the way it shows on Facebook / in Ad Library.
function renderAdView(id) {
  const a = S.ads.get(id) || {}, r = V.rows.get(id) || S.rows.get(id) || {};
  const local = imgSrc(id), idx = V.order.indexOf(id);
  $('#avMeta').textContent = idx >= 0 ? `ad ${idx + 1} / ${V.order.length}` : '';
  const fallback = local ? ` onerror="this.onerror=null;this.src='${local}'"` : '';
  const cards = (a.cards || []).filter(c => c.image);
  let media;
  if (a.video_url) {
    media = `<div class="fb-media"><video src="${esc(a.video_url)}" poster="${esc(a.video_thumbnail_url || local || '')}" autoplay muted loop playsinline controls></video></div>`;
  } else if (cards.length > 1) {
    media = `<div class="fb-car">${cards.map(c => `<div class="fb-card"><div class="ci" style="background-image:url('${esc(c.image)}')"></div>
      <div class="cf"><b>${esc(c.title || a.headline || '')}</b>${c.cta ? `<span>${esc(c.cta)}</span>` : ''}</div></div>`).join('')}</div>`;
  } else {
    const src = (a.image_urls || [])[0] || cards[0]?.image || local;
    // Show our saved thumbnail instantly; the full-size Facebook image fades in when it arrives.
    media = src ? `<div class="fb-media" ${local ? `style="background:#f0f2f5 url('${local}') center/contain no-repeat"` : ''}>
      <img src="${esc(src)}"${fallback} alt="" style="opacity:0;transition:opacity .2s" onload="this.style.opacity=1"></div>` : '';
  }
  const started = typeof a.start_date === 'number' ? new Date(a.start_date * 1000) : a.start_date ? new Date(a.start_date) : null;
  const lib = a.ad_library_url || `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
  const verdict = verdictHtml(r);
  $('#adview').innerHTML = `<div class="fbad">
    <div class="fb-top"><div class="fb-av" ${a.page_avatar ? `style="background-image:url('${esc(a.page_avatar)}')"` : ''}>${a.page_avatar ? '' : esc((a.brand || '?').slice(0, 2))}</div>
      <div><div class="fb-name">${esc(a.brand || r.brand || '')}</div>
      <div class="fb-sp">Sponsored${started && !isNaN(started) ? ` · since ${started.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${a.days_running != null ? ` · ${a.days_running}d running` : ''}</div></div>
      <a class="fb-open" href="${esc(lib)}" target="_blank" rel="noopener">Open in Ad Library ↗</a></div>
    ${a.body ? `<div class="fb-body">${esc(a.body)}</div>` : ''}
    ${media}
    <div class="fb-foot"><div style="min-width:0">${a.caption ? `<small>${esc(a.caption)}</small>` : a.landing_url ? `<small>${esc(host(a.landing_url))}</small>` : ''}
      ${a.headline ? `<b>${esc(a.headline)}</b>` : ''}${a.link_description ? `<div class="ld">${esc(a.link_description)}</div>` : ''}</div>
      ${a.cta_button ? `<span class="fb-cta">${esc(a.cta_button)}</span>` : ''}</div>
    ${verdict ? `<div class="fb-verdict">${verdict}</div>` : ''}
  </div>`;
}

function bar(p, cls = '') { return `<div class="bar2 ${cls}"><i style="width:${Math.round((p || 0) * 100)}%"></i></div>`; }
function trChoice(k, val, conf) {
  const low = conf != null && conf < 0.5;
  return `<div class="tr"><span class="k">${k}</span><div><div class="v">${esc(raw(val))}</div>${bar(conf, low ? 'low' : '')}</div><span class="p ${low ? 'low' : ''}">${pct(conf)}</span></div>`;
}
function trScore(k, score, probs, conf) {
  const low = conf != null && conf < 0.5;
  const segs = (probs || [0, 0, 0, 0]).map(p => `<span><i style="width:${Math.round(p * 100)}%"></i></span>`).join('');
  return `<div class="tr"><span class="k">${k}</span><div><div class="v">${score == null ? '—' : score.toFixed(1)} / 3</div><div class="seg">${segs}</div></div><span class="p ${low ? 'low' : ''}">${pct(conf)}</span></div>`;
}
function trMatch(r) {
  let v, cls = '', b = '', p = r.lp_same_offer;
  if (r.lp_status === 'pending' || r.lp_status == null) { v = '<span class="dots">checking page</span>'; cls = 'gray'; }
  else if (r.lp_status !== 'ok') { v = esc(destOf(r)); cls = 'gray'; }
  else if (p != null && p > 0.35 && p < 0.65) { v = r.lp_homepage ? 'homepage · unclear' : 'unclear'; cls = 'orange'; b = 'low'; }
  else if (r.lp_homepage) { v = 'homepage'; cls = 'orange'; }
  else if (r.mismatch) { v = 'BREAKS'; cls = 'red'; b = 'red'; }
  else { v = 'holds'; cls = 'green'; b = 'green'; }
  return `<div class="tr"><span class="k">message match</span><div><div class="v ${cls}">${v}</div>${bar(p, b)}</div><span class="p ${b === 'low' ? 'low' : ''}">${p == null ? '' : pct(p)}</span></div>`;
}
function showTeardown(id) {
  const r = V.rows.get(id) || S.rows.get(id), a = S.ads.get(id) || {};
  if (!r || r.error) return;
  if (V.current && V.thumbs.get(V.current)) V.thumbs.get(V.current).classList.remove('current');
  V.current = id;
  V.shown.add(id);
  V.thumbs.get(id)?.classList.add('current');
  const img = imgSrc(id), risk = r.claim_risk;
  if ($('#adview').dataset.id !== String(id)) { renderAdView(id); $('#adview').dataset.id = id; }
  else { const v = $('#adview .fb-verdict'); if (v) v.innerHTML = verdictHtml(r); }  // keep a playing video playing
  $('#tdMs').textContent = r.jev_ms != null ? `${r.jev_ms} ms` : '';
  $('#td').innerHTML = `
    <div class="td-left">
      <div class="td-img" ${img ? `style="background-image:url('${img}')"` : ''}></div>
      <div><div class="td-brand">${esc(r.brand)}</div>
      <div class="td-meta">${r.judgments || '?'} questions · ${r.requests === 2 ? 'two requests' : 'one request'}<br>
        ${r.jev_ms ?? '?'} ms · ${(r.tokens || 0).toLocaleString()} tokens<br>
        running ${r.days_running ?? '?'} days · ${esc(a.cta_button || r.button_label || a.format || '')}</div></div>
      <div class="td-body">${esc((a.body || '').trim() || a.headline || '(no body copy)')}</div>
    </div>
    <div class="td-rows">
      ${trChoice('hook archetype', r.hook_type, r.hook_type_conf)}
      ${trChoice('format', r.creative_format, r.creative_format_conf)}
      ${trChoice('offer', r.offer_type, r.offer_type_conf)}
      ${trChoice('cta intent', r.cta_ask, r.cta_ask_conf)}
      ${trChoice('awareness', r.awareness_stage, r.awareness_conf)}
      ${trChoice('driver', r.driver, r.driver_conf)}
      ${trChoice('funnel', r.funnel, r.funnel_conf)}
      ${trScore('hook specificity', r.hook_specificity, r.hook_specificity_probs, r.hook_specificity_conf)}
      ${trScore('offer strength', r.offer_strength, r.offer_strength_probs, r.offer_strength_conf)}
      ${trScore('durability', r.durability, r.durability_probs, r.durability_conf)}
      <div class="tr"><span class="k">claim risk</span><div><div class="v ${risk >= 0.5 ? 'red' : ''}">${risk == null ? '—' : risk >= 0.5 ? 'YES' : 'no'}</div>${bar(risk, risk > 0.35 && risk < 0.65 ? 'low' : '')}</div><span class="p ${risk > 0.35 && risk < 0.65 ? 'low' : ''}">${pct(risk)}</span></div>
      ${trMatch(r)}
    </div>`;
}

function rollText(el, next) {
  const prev = el.dataset.v || '';
  if (prev === next) return;
  el.dataset.v = next;
  let i = 0;
  while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
  el.innerHTML = esc(next.slice(0, i)) + (i < next.length ? `<span class="roll">${esc(next.slice(i))}</span>` : '');
}
function wrTiles() {
  if (!V) return;
  const rows = [...V.rows.values()].filter(r => !r.error);
  const judg = rows.reduce((s, r) => s + (r.judgments || 0), 0);
  const cost = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const adv = new Set(rows.map(r => r.brand)).size;
  let elapsed;
  if (V.mode === 'replay') elapsed = (performance.now() - V.t0) / 1000;
  else if (S.live) elapsed = S.lastT + (performance.now() - S.lastLocal) / 1000;
  else elapsed = S.stats.elapsed || 0;
  const active = V.firstT ? Math.max(0.5, (performance.now() - V.firstT) / 1000) : 0;
  const rate = V.mode === 'static' ? (S.stats.judgments && S.stats.elapsed ? S.stats.judgments / S.stats.elapsed : 0) : (active ? judg / active : 0);
  rollText($('#tAds'), rows.length.toLocaleString());
  rollText($('#tJudg'), judg.toLocaleString());
  rollText($('#tAdv'), String(adv));
  rollText($('#tRate'), Math.round(rate).toLocaleString());
  rollText($('#tTime'), elapsed.toFixed(1));
  rollText($('#tCost'), money(cost));
  const apify = (S.stats.apify_cost_est || 0) + (S.stats.browser_cost_est || 0);
  $('#tCostNote').textContent = apify ? `+ scraping ≈ ${money(apify)}` : '';
  $('#adsCount').textContent = `${rows.length} / ${Math.max(V.order.length, rows.length)}`;
  const badge = $('#statusBadge');
  const state = S.stats.status || 'done';
  const mode = V.mode === 'replay' ? 'replay' : S.live ? 'live' : (state === 'failed' || state === 'interrupted' ? 'failed' : 'done');
  badge.className = 'status ' + mode;
  badge.textContent = mode === 'live' ? `Live · ${state}` : mode === 'replay' ? 'Replay' : state;
  const notice = $('#notice');
  notice.hidden = !S.stats.notice;
  notice.textContent = S.stats.notice || '';
  notice.classList.toggle('bad', state === 'failed' || state === 'interrupted');
  stStatus();
  $('#stopBtn').hidden = !S.live;
  $('#replayBtn').hidden = S.live || !S.rows.size;
  $('#summaryBtn').hidden = S.live || !S.rows.size || V.mode === 'replay';
  $('#csvBtn').hidden = S.live || !S.rows.size;
}
setInterval(() => { if (V && (S.live || V.mode === 'replay')) wrTiles(); }, 120);

function countsOf(rows, key, order) {
  const c = {};
  rows.forEach(r => { if (r[key]) c[r[key]] = (c[r[key]] || 0) + 1; });
  const keys = order ? order.filter(k => c[k]).sort((a, b) => c[b] - c[a]) : Object.keys(c).sort((a, b) => c[b] - c[a]);
  return keys.map(k => [k, c[k]]);
}
function wrCategory() {
  const rows = [...V.rows.values()].filter(r => !r.error);
  $('#catCount').textContent = `${rows.length} ads`;
  const col = (title, key, colored, order) => {
    const data = countsOf(rows, key, order).slice(0, 5), max = data[0]?.[1] || 1;
    return `<div><h5>${title}</h5>${data.map(([k, n]) => `<div class="cr"><span>${esc(raw(k))}</span><span>${n}</span></div>
      <div class="cb"><i style="width:${100 * n / max}%;${colored ? `background:${color(k)}` : ''}"></i></div>`).join('') || '<div class="td-empty" style="padding:0">—</div>'}</div>`;
  };
  $('#cat').innerHTML = col('hook archetype', 'hook_type') + col('format', 'creative_format', true) + col('awareness stage', 'awareness_stage', false, STAGES);
  $('#humanCount').textContent = V.humans;
}
function wrLegend() {
  $('#legend').innerHTML = '<span><i style="--c:var(--red)"></i>Page breaks promise</span><span><i class="dot" style="--c:var(--orange)"></i>Needs a human</span>';
}
let wrRaf = 0;
function scheduleWr() { if (!wrRaf) wrRaf = requestAnimationFrame(() => { wrRaf = 0; wrTiles(); wrCategory(); }); }

function wrNoAds() {
  $('#td').innerHTML = '<div class="td-empty">No ads were analysed in this search.</div>';
  $('#adview').innerHTML = '<div class="td-empty">No ads to show.</div>';
}

function wrShowStatic() {
  wrReset('static');
  V.batch = true;  // sort the whole search in one cascade, not one flight per row
  S.order.forEach(id => wrPulled(S.ads.get(id)));
  S.order.forEach(id => { const r = S.rows.get(id); if (r && !r.error) wrAnalysed(r, false); });
  V.batch = false;
  V.queue = [];
  const sorted = S.order.filter(id => S.rows.has(id));  // includes ads Jev couldn't read: they get their own bin
  stPlan(sorted.map(id => V.rows.get(id)));
  stCascade(sorted);
  const pick = [...S.rows.values()].find(r => r.mismatch) || [...S.rows.values()].find(r => !r.error);
  if (pick) showTeardown(pick.ad_id); else wrNoAds();
  scheduleWr();
}

// Replay: re-run the saved analysis on screen at watchable speed.
let replayTimer = null;
function stopReplay() { if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; } }
function startReplay() {
  stopReplay();
  clearTimeout(finaleTimer);
  const ids = S.order.filter(id => S.rows.get(id) && !S.rows.get(id).error);
  if (!ids.length) return;
  wrReset('replay');
  S.order.forEach(id => wrPulled(S.ads.get(id)));
  const failed = S.order.filter(id => S.rows.get(id)?.error);
  stPlan([...ids, ...failed].map(id => S.rows.get(id)));
  const per = Math.max(70, Math.min(900, 30000 / ids.length));
  let i = 0;
  const step = () => {
    if (i >= ids.length) { replayTimer = null; V.mode = 'static'; failed.forEach(id => stSort(id)); wrTiles(); scheduleFinale(800); return; }
    wrAnalysed(S.rows.get(ids[i++]), false);
    replayTimer = setTimeout(step, per);
  };
  step();
  document.getElementById('wr').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#replayBtn').addEventListener('click', startReplay);
$('#summaryBtn').addEventListener('click', showFinale);

let finaleTimer = null;
function scheduleFinale(ms) {
  clearTimeout(finaleTimer);
  const id = S.runId;
  finaleTimer = setTimeout(() => { finaleTimer = null; if (S.runId === id) showFinale(); }, ms);
}

function showFinale() {
  const rows = [...S.rows.values()].filter(r => !r.error);
  if (!rows.length) return;
  const n = rows.length;
  const top = (key, order) => countsOf(rows, key, order)[0] || ['—', 0];
  const [hook, hookN] = top('hook_type'), [fmt, fmtN] = top('creative_format'), [stage, stageN] = top('awareness_stage', STAGES);
  const checked = rows.filter(r => r.mismatch != null), broke = checked.filter(r => r.mismatch).length;
  const judg = rows.reduce((s, r) => s + (r.judgments || 0), 0), cost = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const brands = new Set(rows.map(r => r.brand));
  const apify = (S.stats.apify_cost_est || 0) + (S.stats.browser_cost_est || 0);
  const cents = cost * 100;
  let pageCard;
  if (checked.length) {
    pageCard = `<div class="big">${Math.round(100 * broke / checked.length)}%</div><div class="tn">${broke} of ${checked.length} real landing pages fetched</div>`;
  } else {
    const why = countsOf(rows.map(r => ({ d: destOf(r) })), 'd')[0] || ['not checked', n];
    pageCard = `<div class="big">no pages</div><div class="tn">${why[1]} of ${n} ads ${esc(why[0])}, so there's no landing page to compare</div>`;
  }
  $('#finale').innerHTML = `
    <button class="fin-x" id="finX" aria-label="Close summary">×</button>
    <div class="fin-cards">
      <div class="fin-card"><div class="tl">The hook everyone is running</div><div class="big">${esc(raw(hook))}</div><div class="tn">${Math.round(100 * hookN / n)}% of ${n} ads</div></div>
      <div class="fin-card"><div class="tl">The format everyone is running</div><div class="big">${esc(raw(fmt))}</div><div class="tn">${Math.round(100 * fmtN / n)}% of ${n} ads</div></div>
      <div class="fin-card"><div class="tl">Who they are all writing for</div><div class="big">${esc(raw(stage))}</div><div class="tn">${Math.round(100 * stageN / n)}% of ${n} ads</div></div>
      <div class="fin-card"><div class="tl">Ads that break their promise on the page they link to</div>${pageCard}</div>
    </div>
    <div class="fin-line">that's ${brands.size > 1 ? 'the whole category' : esc([...brands][0])}.<br>
      ${Math.round(S.stats.elapsed || 0)} seconds. <span class="g">${cents < 1 ? cents.toFixed(2) : cents.toFixed(1)} cents.</span><br>
      <span class="g">${judg.toLocaleString()} judgments · median ${median(rows.map(r => r.jev_ms || 0))} ms per ad.</span></div>
    <div class="fin-note">Jev cost ${money(cost)} · scraping by Apify ≈ ${money(apify)} · ${S.stats.pages_read || 0} landing pages opened · ${S.stats.pulled || n} ads pulled live from Ad Library</div>
    <div class="fin-actions"><button class="wr-btn" id="finBack">Back to dashboard</button><button class="wr-btn" id="finReplay">▶ Replay</button></div>`;
  $('#finale').hidden = false;
  $('#finBack').onclick = $('#finX').onclick = closeFinale;
  $('#finReplay').onclick = () => { closeFinale(); startReplay(); };
}
function closeFinale() {
  $('#finale').hidden = true;
  document.getElementById('wr').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#finale').hidden) closeFinale(); });
window.addEventListener('focus', () => loadRecent());

// ---------- detail tabs (ads, mismatches, brands) ----------
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  const rows = [...S.rows.values()].filter(r => !r.error);
  $('#nAds').textContent = S.ads.size || '';
  $('#nMis').textContent = rows.filter(r => r.mismatch).length || '';
  if (S.tab === 'ads') { renderFilters(); renderGrid(); }
  if (S.tab === 'mismatch') renderMismatches();
  if (S.tab === 'brands') renderBrands();
  if (V) scheduleWr();
}

function options(values, current, label) {
  return `<option value="">${label}</option>` + values.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(nice(v))}</option>`).join('');
}
let lastFilterSig = '';
function renderFilters() {
  const rows = [...S.rows.values()];
  const brands = [...new Set([...S.ads.values()].map(a => a.brand))].sort();
  const uniq = k => [...new Set(rows.map(r => r[k]).filter(Boolean))].sort();
  const sig = JSON.stringify([brands, uniq('hook_type'), uniq('offer_type'), uniq('awareness_stage'), S.f]);
  if (sig === lastFilterSig) return;
  lastFilterSig = sig;
  const f = S.f;
  $('#filters').innerHTML = `
    <select data-f="brand">${options(brands, f.brand, 'All advertisers')}</select>
    <select data-f="hook">${options(uniq('hook_type'), f.hook, 'All hooks')}</select>
    <select data-f="offer">${options(uniq('offer_type'), f.offer, 'All offers')}</select>
    <select data-f="stage">${options(STAGES.filter(s => uniq('awareness_stage').includes(s)), f.stage, 'All stages')}</select>
    <select data-f="sort"><option value="new" ${f.sort === 'new' ? 'selected' : ''}>Newest pulled</option>
      <option value="days" ${f.sort === 'days' ? 'selected' : ''}>Longest running</option>
      <option value="variants" ${f.sort === 'variants' ? 'selected' : ''}>Most variants</option></select>
    <label><input type="checkbox" data-f="flag" ${f.flag ? 'checked' : ''}> Mismatches only</label>
    <label><input type="checkbox" data-f="review" ${f.review ? 'checked' : ''}> Low confidence</label>`;
}
$('#filters').addEventListener('change', e => {
  const k = e.target.dataset.f; if (!k) return;
  S.f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  lastFilterSig = ''; S.order.forEach(id => S.dirty.add(id)); render();
});

function lpBox(r) {
  if (!r) return '';
  if (r.lp_status === 'pending') return `<div class="lp wait">Checking landing page…</div>`;
  if (r.lp_status === 'catalog') return `<div class="lp na">Catalog ad: each viewer lands on a different product page, so it isn't checked</div>`;
  if (r.lp_status === 'jev_error') return `<div class="lp na">Couldn't judge the page (Jev error)</div>`;
  if (r.lp_status === 'ok') {
    if (r.lp_homepage) return `<div class="lp warn">🏠 Lands on the homepage, not a page for this offer · same offer ${pct(r.lp_same_offer)}</div>`;
    if (r.mismatch) return `<div class="lp bad">🚩 ${esc(nice(r.lp_match))}: page doesn't repeat the ad's offer · same offer ${pct(r.lp_same_offer)}${r.lp_free_to_paid > 0.6 ? ' · free in ad, paid on page' : ''}</div>`;
    return `<div class="lp ok">✓ Landing page ${esc(nice(r.lp_match).toLowerCase())} · same offer ${pct(r.lp_same_offer)}</div>`;
  }
  const d = destOf(r);
  return `<div class="lp na">${esc(d.charAt(0).toUpperCase() + d.slice(1))}</div>`;
}
function cardImg(id) {
  const r = S.rows.get(id), m = S.media.get(id);
  return (m?.image || r?.img) ? `/runs/${encodeURIComponent(S.runId)}/img/${encodeURIComponent(String(id).replace(/[^\w-]/g, '_'))}.jpg` : null;
}
function cardHtml(id) {
  const a = S.ads.get(id), r = S.rows.get(id), img = cardImg(id);
  const copy = (a.body || '').trim().split('\n')[0] || a.headline || '(no text)';
  const tag = (label, val, c) => `<span class="tag ${c != null && c < 0.5 ? 'low' : ''}" style="border-left:3px solid ${color(val)}">${esc(label)}${c != null ? ` <i>${pct(c)}</i>` : ''}</span>`;
  const tags = r ? (r.error ? `<div class="lp bad">Jev error: ${esc(r.error.slice(0, 120))}</div>` :
    `<div class="tags">${tag(nice(r.hook_type), r.hook_type, r.hook_type_conf)}${tag(raw(r.creative_format), r.creative_format, r.creative_format_conf)}${tag(nice(r.offer_type), r.offer_type, r.offer_type_conf)}${tag(nice(r.cta_ask), r.cta_ask, r.cta_ask_conf)}${tag(nice(r.awareness_stage), r.awareness_stage)}</div>
     <div class="tags">${Object.entries(TAGS).filter(([k]) => (r['tag_' + k] || 0) >= 0.6).map(([, l]) => `<span class="tag">✓ ${l}</span>`).join('')}${r.claim_risk >= 0.5 ? '<span class="tag" style="color:var(--bad)">⚠ Claim risk</span>' : ''}</div>`)
    : `<div class="shimmer"></div><div class="analysing">Jev is reading this ad…</div>`;
  return `<div class="img ${img ? '' : 'noimg'}" ${img ? `style="background-image:url('${img}')"` : ''}>${img ? '' : esc(a.format === 'video' ? 'Video ad' : 'No image')}
      <span class="fmt">${esc(a.format || 'ad')}</span>${a.days_running != null ? `<span class="days">${a.days_running}d running</span>` : ''}</div>
    <div class="body"><div class="who">${esc(a.brand)}${a.variant_count > 1 ? ` · ${a.variant_count} variants` : ''}</div>
      <div class="copy">${esc(copy)}</div>${a.headline ? `<div class="hd">${esc(a.headline)}</div>` : ''}
      ${tags}${r ? lpBox(r) : ''}</div>`;
}
function visible(id) {
  const a = S.ads.get(id), r = S.rows.get(id), f = S.f;
  if (f.brand && a.brand !== f.brand) return false;
  if ((f.hook || f.offer || f.stage || f.flag || f.review) && !r) return false;
  if (f.hook && r.hook_type !== f.hook) return false;
  if (f.offer && r.offer_type !== f.offer) return false;
  if (f.stage && r.awareness_stage !== f.stage) return false;
  if (f.flag && !r.mismatch) return false;
  if (f.review && !r.needs_review) return false;
  return true;
}
function renderGrid() {
  const grid = $('#adGrid');
  let ids = S.order.filter(visible);
  if (S.f.sort === 'new') ids = ids.slice().reverse();
  if (S.f.sort === 'days') ids.sort((x, y) => (S.ads.get(y).days_running || 0) - (S.ads.get(x).days_running || 0));
  if (S.f.sort === 'variants') ids.sort((x, y) => (S.ads.get(y).variant_count || 0) - (S.ads.get(x).variant_count || 0));
  ids = ids.slice(0, 400);
  for (const id of S.dirty) {
    if (!S.ads.has(id)) continue;
    let el = S.cards.get(id);
    if (!el) { el = document.createElement('div'); el.className = 'ad'; S.cards.set(id, el); }
    el.innerHTML = cardHtml(id);
    el.classList.toggle('flag', !!S.rows.get(id)?.mismatch);
  }
  S.dirty.clear();
  const want = ids.map(id => S.cards.get(id)).filter(Boolean);
  if (want.length !== grid.children.length || want.some((el, i) => grid.children[i] !== el)) grid.replaceChildren(...want);
  if (!ids.length) grid.innerHTML = `<div class="empty">${S.live ? 'Ads will appear here as they are pulled…' : 'No ads match these filters.'}</div>`;
}

function score(label, p, bad) {
  const v = Math.round((p || 0) * 100);
  return `<div class="score">${label} <b>${p == null ? '—' : v + '%'}</b><div class="track"><div class="fill" style="width:${v}%;background:${bad ? 'var(--bad)' : 'var(--good)'}"></div></div></div>`;
}
function renderMismatches() {
  const rows = [...S.rows.values()].filter(r => r.mismatch).sort((a, b) => (a.lp_same_offer || 0) - (b.lp_same_offer || 0));
  $('#misList').innerHTML = rows.length ? rows.map(r => {
    const a = S.ads.get(r.ad_id) || {}, img = cardImg(r.ad_id);
    return `<div class="mis">
      <div><h4>The ad promises</h4>${img ? `<div class="thumb" style="background-image:url('${img}')"></div>` : ''}
        <b>${esc(a.brand)}</b><div>${esc((a.body || '').split('\n')[0])}</div>${a.headline ? `<div class="muted">${esc(a.headline)}</div>` : ''}
        <div class="muted">Button: ${esc(a.cta_button || '—')} · ${esc(nice(r.offer_type))}</div></div>
      <div><h4>The landing page shows</h4><b>${esc(r.lp_title || '(no title)')}</b>
        ${r.lp_headlines ? `<div class="muted">${esc(r.lp_headlines)}</div>` : ''}
        <a href="${esc(r.landing_url)}" target="_blank" rel="noopener">${esc(r.landing_url)}</a></div>
      <div><h4>Jev's judgment</h4><div><b>${esc(nice(r.lp_match))}</b></div>
        ${score('Same offer', r.lp_same_offer)}${score('Free in ad → paid on page', r.lp_free_to_paid, true)}${score('Headline continues hook', r.lp_headline_continues_hook)}</div>
    </div>`;
  }).join('') : `<div class="empty">${S.live ? 'Mismatches show up here as Jev finds them.' : 'No mismatches found among readable landing pages.'}</div>`;
}

function topOf(rows, key) { const c = countsOf(rows, key); return c.length ? `${nice(c[0][0])} <span class="muted">${Math.round(100 * c[0][1] / rows.length)}%</span>` : '—'; }
function renderBrands() {
  const by = {};
  const pid = {};
  [...S.ads.values()].forEach(a => { (by[a.brand] ||= { ads: [], rows: [] }).ads.push(a); if (a.page_id) pid[a.brand] = a.page_id; });
  [...S.rows.values()].filter(r => !r.error).forEach(r => (by[r.brand] ||= { ads: [], rows: [] }).rows.push(r));
  const list = Object.entries(by).sort((a, b) => b[1].ads.length - a[1].ads.length);
  $('#brandTable').innerHTML = list.length ? `<table class="brands"><thead><tr><th>Advertiser</th><th>Ads</th><th>Top hook</th><th>Top format</th><th>Top offer</th><th>Top stage</th><th>Avg days running</th><th>Page mismatch</th></tr></thead><tbody>
    ${list.map(([b, { ads, rows }]) => {
      const days = ads.map(a => a.days_running).filter(d => d != null), chk = rows.filter(r => r.mismatch != null);
      const lib = pid[b] ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(S.request?.country || 'ALL')}&view_all_page_id=${pid[b]}&search_type=page` : '';
      return `<tr><td><b>${esc(b)}</b>${lib ? `<br><a href="${esc(lib)}" target="_blank" rel="noopener" class="muted" style="font-size:12px">page ${esc(pid[b])} ↗</a>` : ''}</td><td>${ads.length}</td><td>${topOf(rows, 'hook_type')}</td><td>${topOf(rows, 'creative_format')}</td><td>${topOf(rows, 'offer_type')}</td><td>${topOf(rows, 'awareness_stage')}</td>
        <td>${days.length ? Math.round(days.reduce((x, y) => x + y, 0) / days.length) : '—'}</td>
        <td>${chk.length ? Math.round(100 * chk.filter(r => r.mismatch).length / chk.length) + '% of ' + chk.length : '—'}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No data yet.</div>';
}

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== 'tab-' + S.tab);
  if (S.tab === 'ads') { lastFilterSig = ''; S.order.forEach(id => S.dirty.add(id)); }
  render();
});
$('#stopBtn').addEventListener('click', () => fetch(`/api/runs/${S.runId}/stop`, { method: 'POST' }));

// ---------- settings: Jev (OpenRouter) and Apify keys ----------
// Keys are never sent back to the page: it only sees whether one is saved and a masked hint.
const SET = { data: null, remove: new Set() };
const KEYS = [
  { svc: 'openrouter', field: 'openrouter_api_key', input: '#kOpenrouter', hint: '#hOpenrouter', status: '#stJev',
    result: '#rOpenrouter', rm: '#xOpenrouter', example: 'sk-or-v1-…' },
  { svc: 'apify', field: 'apify_token', input: '#kApify', hint: '#hApify', status: '#stApify',
    result: '#rApify', rm: '#xApify', example: 'apify_api_…' },
];
const FINE = 'Saved to .env on this computer only. Used from your next search.';
function renderCfg() {
  const c = S.cfg;
  $('#cfg').innerHTML = `<button type="button" class="${c.has_openrouter ? 'ok' : 'missing'}" title="${c.has_openrouter ? 'Jev key saved' : 'Jev key missing'}">Jev ${esc(c.model.replace('typesafe/', ''))}</button>`
    + `<button type="button" class="${c.has_apify ? 'ok' : 'missing'}" title="${c.has_apify ? 'Apify token saved' : 'Apify token missing'}">Apify</button>`;
}
function fillSettings() {
  KEYS.forEach(k => {
    const d = SET.data[k.svc], removing = SET.remove.has(k.field);
    const st = $(k.status);
    st.textContent = removing ? 'Will be removed' : d.set ? 'Connected' : 'Not set';
    st.className = 'set-status ' + (removing ? 'warn' : d.set ? 'ok' : 'off');
    $(k.hint).textContent = removing ? 'Removed when you save.'
      : d.set ? `Saved: ${d.hint}` + (d.from_shell ? ' (also set in your shell, which wins after a restart)' : '') : 'No key saved yet.';
    $(k.rm).hidden = !d.set;
    $(k.rm).textContent = removing ? 'Undo' : 'Remove';
    $(k.input).placeholder = d.set ? 'Paste a new key to replace it' : k.example;
  });
  $('#modelReset').hidden = $('#kModel').value.trim() === SET.data.default_model;
}
async function openSettings(note) {
  SET.remove.clear();
  KEYS.forEach(k => { $(k.input).value = ''; $(k.result).textContent = ''; $(k.result).className = 'test-result'; });
  $('#setNote').hidden = !note;
  $('#setNote').textContent = note || '';
  $('#setError').textContent = FINE;
  $('#setError').className = 'set-fine';
  try { SET.data = await (await fetch('/api/settings')).json(); } catch { alert('Could not load settings.'); return; }
  $('#kModel').value = SET.data.model;
  fillSettings();
  if (!$('#settings').open) $('#settings').showModal();
  const missing = KEYS.find(k => !SET.data[k.svc].set);
  if (missing) $(missing.input).focus();
}
async function testKey(k) {
  const res = $(k.result);
  res.className = 'test-result wait';
  res.textContent = 'Testing…';
  try {
    const r = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: k.svc, key: $(k.input).value.trim() || null }) });
    const d = await r.json();
    res.className = 'test-result ' + (d.ok ? 'ok' : 'bad');
    res.textContent = (d.ok ? '✓ ' : '✕ ') + (d.message || (d.ok ? 'Works' : 'Failed'));
  } catch { res.className = 'test-result bad'; res.textContent = "✕ Couldn't run the test."; }
}
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#cfg').addEventListener('click', e => { if (e.target.closest('button')) openSettings(); });
$('#settings').addEventListener('click', e => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) { $('#settings').close(); return; }
  const rv = e.target.closest('[data-reveal]');
  if (rv) { const i = $(rv.dataset.reveal); i.type = i.type === 'password' ? 'text' : 'password'; rv.textContent = i.type === 'password' ? 'Show' : 'Hide'; return; }
  const t = e.target.closest('[data-test]');
  if (t) { testKey(KEYS.find(k => k.svc === t.dataset.test)); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    const f = rm.dataset.remove, k = KEYS.find(x => x.field === f);
    if (SET.remove.has(f)) SET.remove.delete(f); else { SET.remove.add(f); $(k.input).value = ''; }
    fillSettings();
  }
  if (e.target.id === 'modelReset') { $('#kModel').value = SET.data.default_model; fillSettings(); }
});
KEYS.forEach(k => $(k.input).addEventListener('input', () => {
  if ($(k.input).value && SET.remove.delete(k.field)) fillSettings();
  $(k.result).textContent = '';
}));
$('#kModel').addEventListener('input', fillSettings);
// Don't leave pasted keys sitting in the page once the dialog closes.
$('#settings').addEventListener('close', () => KEYS.forEach(k => {
  $(k.input).value = ''; $(k.input).type = 'password';
  $(k.input).parentElement.querySelector('[data-reveal]').textContent = 'Show';
}));
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {};
  KEYS.forEach(k => {
    const v = $(k.input).value.trim();
    if (v) body[k.field] = v; else if (SET.remove.has(k.field)) body[k.field] = '';
  });
  const model = $('#kModel').value.trim();
  if (model !== SET.data.model) body.jev_model = model;
  $('#setSave').disabled = true;
  try {
    if (Object.keys(body).length) {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(typeof d.detail === 'string' ? d.detail : 'Check the values and try again.');
      }
      S.cfg = await (await fetch('/api/config')).json();
      renderCfg();
      estimate();
    }
    $('#settings').close();
  } catch (err) {
    $('#setError').textContent = 'Not saved: ' + err.message;
    $('#setError').className = 'set-fine bad';
  }
  $('#setSave').disabled = false;
});

// ---------- boot ----------
(async () => {
  S.cfg = await (await fetch('/api/config')).json();
  Object.assign(LP_TEXT, S.cfg.lp_labels || {});
  renderCfg();
  estimate();
  loadRecent();
  $('#queryInput').focus();
})();
