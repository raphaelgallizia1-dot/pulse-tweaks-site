/* Panneau admin (verrou de confort cote navigateur : empreinte SHA-256, rien en clair) + ajout d'avis en direct
   + defilement des avis (1 ligne, gauche -> droite, clic = pause 3 s). Stockage : localStorage de CE navigateur. */
document.addEventListener('DOMContentLoaded', () => {
  const $ = (q, p = document) => p.querySelector(q);
  const $$ = (q, p = document) => [...p.querySelectorAll(q)];
  const HASH = '7e269472daf94cc1dd60ca989bfa08fb77cf4a3b95b2dac0f253ce892344caa0';
  const KEY = 'pulseReviews';
  const SESSION = 'pulseAdmin';

  /* ---- avis : rendu + defilement ---- */
  const track = $('.reviews_track');
  const marquee = $('.reviews_marquee');
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cardHtml = (r) => '<div class="review is-added" tabindex="0">\u00ab ' + esc(r.text) + ' \u00bb<div class="review_who">' + '\u2605'.repeat(Math.max(3, Math.min(5, +r.stars || 5))) + ' ' + esc(r.who) + (r.products ? ' \u00b7 ' + esc(r.products) : '') + '</div></div>';
  const stored = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  let pauseTimer = null;
  const setupMarquee = () => {
    if (!track) return;
    $$('.reviews_track [data-clone]').forEach((c) => c.remove());
    stored().forEach((r) => { if (!$$('.review.is-added', track).some((el) => el.dataset.id === r.id)) { const d = document.createElement('div'); d.innerHTML = cardHtml(r); d.firstChild.dataset.id = r.id; track.appendChild(d.firstChild); } });
    /* duplication pour une boucle sans couture */
    const originals = $$('.review:not([data-clone])', track);
    originals.forEach((el) => { const c = el.cloneNode(true); c.dataset.clone = '1'; c.setAttribute('aria-hidden', 'true'); c.removeAttribute('tabindex'); track.appendChild(c); });
    const width = originals.reduce((w, el) => w + el.getBoundingClientRect().width + 16, 0);
    track.style.setProperty('--w', width + 'px');
    track.style.setProperty('--dur', Math.max(40, width / 45) + 's');
  };
  const pause = () => {
    marquee.classList.add('is-paused');
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => marquee.classList.remove('is-paused'), 3000);
  };
  if (marquee) {
    setupMarquee();
    window.addEventListener('resize', () => { clearTimeout(window.__mqT); window.__mqT = setTimeout(setupMarquee, 300); });
    marquee.addEventListener('click', (e) => { if (e.target.closest('.review')) pause(); });
    marquee.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.review')) { e.preventDefault(); pause(); } });
  }

  /* ---- modales ---- */
  const open = (id) => { const m = $(id); if (!m) return; m.hidden = false; requestAnimationFrame(() => m.classList.add('is-open')); const f = $('input, textarea', m); if (f) setTimeout(() => f.focus(), 60); };
  const close = (m) => { m.classList.remove('is-open'); setTimeout(() => { m.hidden = true; }, 250); };
  $$('[data-modal-close]').forEach((b) => b.addEventListener('click', () => close(b.closest('.modal'))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal:not([hidden])').forEach(close); });

  const isAdmin = () => sessionStorage.getItem(SESSION) === '1';
  const applyAdmin = () => {
    const on = isAdmin();
    $$('.navpill_addreview').forEach((b) => { b.hidden = !on; });
    const m = $('#admin-modal');
    if (m) { $('[data-admin-form]', m).hidden = on; $('.modal_admin', m).hidden = !on; $('#admin-title').textContent = on ? 'Admin activé' : 'Mot de passe'; }
  };
  const sha256 = async (t) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };

  $$('[data-admin-open]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); applyAdmin(); open('#admin-modal'); }));
  $$('[data-review-open]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); if (!isAdmin()) { open('#admin-modal'); return; } $$('.modal:not([hidden])').forEach(close); open('#review-modal'); }));
  $('[data-admin-logout]')?.addEventListener('click', () => { sessionStorage.removeItem(SESSION); applyAdmin(); });

  $('[data-admin-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget; const err = $('.modal_error', form);
    const ok = (await sha256(form.pwd.value)) === HASH;
    err.hidden = ok;
    if (!ok) { form.pwd.select(); return; }
    sessionStorage.setItem(SESSION, '1'); form.reset(); applyAdmin();
  });

  $('[data-review-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const r = { id: String(Date.now()), text: form.text.value.trim(), who: form.who.value.trim(), products: form.products.value.trim(), stars: form.stars.value, date: new Date().toISOString().slice(0, 10) };
    if (!r.text || !r.who) return;
    const list = stored(); list.push(r); localStorage.setItem(KEY, JSON.stringify(list));
    setupMarquee();
    form.reset(); close(form.closest('.modal'));
    const el = $('.review.is-added[data-id="' + r.id + '"]');
    if (el) { el.classList.add('is-new'); setTimeout(() => el.classList.remove('is-new'), 4000); }
    $('#FAQ')?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  });

  $('[data-export-reviews]')?.addEventListener('click', () => {
    const ta = $('.modal_export'); const list = stored();
    ta.hidden = false; ta.value = list.length ? JSON.stringify(list, null, 2) : 'Aucun avis ajouté sur ce navigateur.';
    ta.select(); try { document.execCommand('copy'); } catch (err) {}
  });

  applyAdmin();
});
