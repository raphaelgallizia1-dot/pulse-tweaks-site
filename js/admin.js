/* Panneau admin (verrou de confort cote navigateur : empreinte SHA-256, rien en clair) + ajout d'avis en direct
   + defilement des avis (1 ligne, gauche -> droite, clic = pause 3 s). Stockage : localStorage de CE navigateur. */
document.addEventListener('DOMContentLoaded', () => {
  const $ = (q, p = document) => p.querySelector(q);
  const $$ = (q, p = document) => [...p.querySelectorAll(q)];
  const HASH = '7e269472daf94cc1dd60ca989bfa08fb77cf4a3b95b2dac0f253ce892344caa0';
  const KEY = 'pulseReviews';
  const TOKEN_KEY = 'pulseGh';
  const REMOTE = 'assets/reviews.json';
  const SESSION = 'pulseAdmin';

  /* ---- avis : rendu + defilement ---- */
  const track = $('.reviews_track');
  const marquee = $('.reviews_marquee');
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cardHtml = (r) => '<div class="review is-added" tabindex="0" data-id="' + esc(r.id) + '">\u00ab ' + esc(r.text) + ' \u00bb<div class="review_who">'
    + '\u2605'.repeat(Math.max(1, Math.min(5, +r.stars || 5))) + ' ' + esc(r.who)
    + (r.tag ? '<span class="review_tag">' + esc(r.tag) + '</span>' : '')
    + (r.products ? ' \u00b7 ' + esc(r.products) : '') + '</div></div>';
  const stored = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  let remote = [];   /* avis publies en ligne (assets/reviews.json) : vus par TOUS les visiteurs */
  const all = () => { const seen = new Set(); return [...remote, ...stored()].filter((r) => !seen.has(r.id) && seen.add(r.id)); };
  const gh = () => { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; } };
  let pauseTimer = null;
  const setupMarquee = () => {
    if (!track) return;
    $$('.reviews_track [data-clone]').forEach((c) => c.remove());
    all().forEach((r) => { if (!$$('.review.is-added', track).some((el) => el.dataset.id === r.id)) { const d = document.createElement('div'); d.innerHTML = cardHtml(r); d.firstChild.dataset.id = r.id; track.appendChild(d.firstChild); } });
    /* duplication pour une boucle sans couture */
    const originals = $$('.review:not([data-clone])', track);
    originals.forEach((el) => { const c = el.cloneNode(true); c.dataset.clone = '1'; c.setAttribute('aria-hidden', 'true'); c.removeAttribute('tabindex'); track.appendChild(c); });
    const width = originals.reduce((w, el) => w + el.getBoundingClientRect().width + 16, 0);
    track.style.setProperty('--w', width + 'px');
    track.style.setProperty('--dur', Math.max(40, width / 45) + 's');
  };
  /* survol d'un avis = pause 3 s, puis reprise (un nouveau survol relance les 3 s) */
  const pause = () => {
    marquee.classList.add('is-paused');
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => marquee.classList.remove('is-paused'), 3000);
  };
  if (marquee) {
    /* avis publies en ligne : charges avant le premier rendu de la ligne */
    fetch(REMOTE, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((list) => {
      if (Array.isArray(list) && list.length) { remote = list; setupMarquee(); refreshCount(); }
    }).catch(() => {});
    setupMarquee();
    window.addEventListener('resize', () => { clearTimeout(window.__mqT); window.__mqT = setTimeout(setupMarquee, 300); });
    marquee.addEventListener('pointerover', (e) => { if (e.target.closest('.review')) pause(); });
    marquee.addEventListener('click', (e) => { if (e.target.closest('.review')) pause(); });
    marquee.addEventListener('focusin', (e) => { if (e.target.closest('.review')) pause(); });
  }

  /* ---- modales ---- */
  const open = (id) => { const m = $(id); if (!m) return; m.hidden = false; requestAnimationFrame(() => m.classList.add('is-open')); const f = $('input, textarea', m); if (f) setTimeout(() => f.focus(), 60); };
  const close = (m) => { m.classList.remove('is-open'); setTimeout(() => { m.hidden = true; }, 250); };
  $$('[data-modal-close]').forEach((b) => b.addEventListener('click', () => close(b.closest('.modal'))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal:not([hidden])').forEach(close); });

  const isAdmin = () => sessionStorage.getItem(SESSION) === '1';
  const refreshCount = () => {
    const n = all().length;
    $$('[data-review-count]').forEach((el) => { el.textContent = n; });
    const st = $('[data-sync-state]');
    if (st) st.textContent = gh() ? (stored().length ? stored().length + ' en attente de publication.' : 'Tout est publié en ligne.') : 'Publication en ligne non configurée : ils ne sont visibles que sur ce navigateur.';
  };
  /* publication reelle : ecrit assets/reviews.json dans le depot via l'API GitHub (jeton saisi par l'admin) */
  const publish = async () => {
    const cfg = gh();
    if (!cfg || !cfg.token || !cfg.repo) return { ok: false, msg: 'Jeton non configuré.' };
    const url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + REMOTE;
    const head = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' };
    try {
      const cur = await fetch(url + '?ref=' + (cfg.branch || 'main'), { headers: head });
      let sha = null, base = [];
      if (cur.ok) { const j = await cur.json(); sha = j.sha; try { base = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\s/g, ''))))); } catch (e) { base = []; } }
      else if (cur.status !== 404) return { ok: false, msg: 'Lecture refusée (' + cur.status + ').' };
      const seen = new Set(); const merged = [...base, ...stored()].filter((r) => !seen.has(r.id) && seen.add(r.id));
      const body = { message: 'Avis publie depuis le panneau admin', content: btoa(unescape(encodeURIComponent(JSON.stringify(merged, null, 1)))), branch: cfg.branch || 'main' };
      if (sha) body.sha = sha;
      const put = await fetch(url, { method: 'PUT', headers: head, body: JSON.stringify(body) });
      if (!put.ok) return { ok: false, msg: 'Publication refusée (' + put.status + ').' };
      remote = merged; localStorage.removeItem(KEY); setupMarquee(); refreshCount();
      return { ok: true, msg: 'Publié. Le site en ligne se met à jour dans une minute environ.' };
    } catch (e) { return { ok: false, msg: 'Réseau indisponible.' }; }
  };
  const applyAdmin = () => {
    const on = isAdmin();
    $$('.navpill_addreview').forEach((b) => { b.hidden = !on; });
    const m = $('#admin-modal');
    if (m) { $('[data-admin-form]', m).hidden = on; $('.modal_admin', m).hidden = !on; $('#admin-title').textContent = on ? 'Ajouter un avis' : 'Mot de passe'; }
    refreshCount();
  };
  const sha256 = async (t) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };

  $$('[data-admin-open]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); applyAdmin(); open('#admin-modal'); }));
  $('[data-admin-logout]')?.addEventListener('click', () => { sessionStorage.removeItem(SESSION); applyAdmin(); });

  $('[data-admin-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget; const err = $('.modal_error', form);
    const ok = (await sha256(form.pwd.value)) === HASH;
    err.hidden = ok;
    if (!ok) { form.pwd.select(); return; }
    sessionStorage.setItem(SESSION, '1'); form.reset(); applyAdmin();
    setTimeout(() => $('[data-review-form] textarea')?.focus(), 60);
  });

  $('[data-review-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const r = { id: String(Date.now()), text: form.text.value.trim(), who: form.who.value.trim(), tag: form.tag.value.trim(), products: form.products.value.trim(), stars: form.stars.value, date: new Date().toISOString().slice(0, 10) };
    if (!r.text || !r.who) return;
    const list = stored(); list.push(r); localStorage.setItem(KEY, JSON.stringify(list));
    setupMarquee(); refreshCount();
    form.reset();
    const el = $('.review.is-added[data-id="' + r.id + '"]');
    if (el) { el.classList.add('is-new'); setTimeout(() => el.classList.remove('is-new'), 4000); }
    const ok = document.createElement('div'); ok.className = 'modal_ok'; ok.textContent = 'Ajouté à la ligne d\'avis.'; form.appendChild(ok);
    $$('[data-stars] .star').forEach((b) => b.classList.add('is-on')); form.stars.value = '5';
    if (gh()) { ok.textContent = 'Publication en ligne…'; publish().then((res) => { ok.textContent = res.msg; setTimeout(() => ok.remove(), 4000); }); }
    else setTimeout(() => ok.remove(), 3000);
  });

  /* etoiles : boutons maison (le <select> natif s'affichait en blanc illisible) */
  $$('[data-stars]').forEach((field) => {
    const stars = $$('.star', field); const input = $('input[name=stars]', field);
    const paint = (n) => stars.forEach((b, i) => b.classList.toggle('is-on', i < n));
    stars.forEach((b, i) => {
      b.addEventListener('click', () => { input.value = String(i + 1); paint(i + 1); });
      b.addEventListener('pointerenter', () => paint(i + 1));
    });
    field.addEventListener('pointerleave', () => paint(+input.value || 5));
  });

  /* jeton de publication */
  $('[data-token-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.token.value.trim()) sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ repo: f.repo.value.trim(), token: f.token.value.trim(), branch: 'main' }));
    const res = await publish();
    let msg = $('.modal_ok', f); if (!msg) { msg = document.createElement('div'); msg.className = 'modal_ok'; f.appendChild(msg); }
    msg.textContent = res.msg; f.token.value = '';
    refreshCount();
  });
  $('[data-clear-reviews]')?.addEventListener('click', () => {
    if (!confirm('Effacer les avis ajoutés sur ce navigateur ?')) return;
    localStorage.removeItem(KEY); $$('.reviews_track .review.is-added').forEach((el) => el.remove()); setupMarquee(); refreshCount();
  });

  $('[data-export-reviews]')?.addEventListener('click', () => {
    const ta = $('.modal_export'); const list = stored();
    ta.hidden = false; ta.value = list.length ? JSON.stringify(list, null, 2) : 'Aucun avis ajouté sur ce navigateur.';
    ta.select(); try { document.execCommand('copy'); } catch (err) {}
  });

  applyAdmin();
});
