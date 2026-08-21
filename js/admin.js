/* Panneau admin Pulse Tweaks
   - verrou par mot de passe (empreinte SHA-256 : le mot de passe n'est pas dans le code), redemande a chaque ouverture
   - ajout d'avis (texte, pseudo, tag, produits, etoiles)
   - SUPPRESSION d'un ou plusieurs avis, y compris ceux d'origine (marques "masques")
   - publication reelle dans assets/reviews.json du depot via l'API GitHub (jeton saisi par l'admin)
   - ligne d'avis : defilement gauche -> droite, pause 3 s au survol
   Etat publie : { "reviews": [...ajoutes...], "hidden": [...ids masques...] } (un simple tableau est accepte : ancien format) */
document.addEventListener('DOMContentLoaded', () => {
  const $ = (q, p = document) => p.querySelector(q);
  const $$ = (q, p = document) => [...p.querySelectorAll(q)];
  const HASH = '7e269472daf94cc1dd60ca989bfa08fb77cf4a3b95b2dac0f253ce892344caa0';
  const KEY = 'pulseReviews';
  const TOKEN_KEY = 'pulseGh';
  const HKEY = 'pulseHidden';   /* avis masques pas encore publies : sinon ils reviennent au rechargement */
  const REMOTE = 'assets/reviews.json';
  let unlocked = false;

  const track = $('.reviews_track');
  const marquee = $('.reviews_marquee');
  if (!track || !marquee) return;

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stars = (n) => '★'.repeat(Math.max(1, Math.min(5, +n || 5)));
  const cardHtml = (r) => '<div class="review is-added" tabindex="0" data-id="' + esc(r.id) + '">« ' + esc(r.text) + ' »<div class="review_who">'
    + stars(r.stars) + ' ' + esc(r.who)
    + (r.tag ? '<span class="review_tag">' + esc(r.tag) + '</span>' : '')
    + (r.products ? ' · ' + esc(r.products) : '') + '</div></div>';

  /* les avis d'origine (ecrits dans le HTML) : captures une seule fois, avant tout rendu */
  const BASE = $$('.review', track).map((el, i) => {
    if (!el.dataset.id) el.dataset.id = 'base-' + (i + 1);
    const raw = ($('.review_who', el)?.textContent || '').trim();
    const m = raw.match(/^(\u2605*)\s*(.*)$/) || [];
    const rest = (m[2] || '').split(' \u00b7 ');
    return {
      id: el.dataset.id, html: el.outerHTML,
      text: (el.childNodes[0]?.textContent || '').replace(/[\u00ab\u00bb]/g, '').trim(),
      who: (rest[0] || '').trim(), products: rest.slice(1).join(' \u00b7 ').trim(),
      stars: String((m[1] || '\u2605\u2605\u2605\u2605\u2605').length), tag: '',
    };
  });

  let remote = { reviews: [], hidden: [] };
  const stored = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const setStored = (l) => localStorage.setItem(KEY, JSON.stringify(l));
  const hiddenLocal = () => { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } };
  const setHiddenLocal = (l) => localStorage.setItem(HKEY, JSON.stringify(l));
  const gh = () => { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { return null; } };
  const normalize = (d) => (Array.isArray(d) ? { reviews: d, hidden: [] } : { reviews: d.reviews || [], hidden: d.hidden || [] });

  /* liste finale affichee : origine (moins les masques) + publies + locaux */
  const visible = () => {
    const hid = new Set([...remote.hidden, ...hiddenLocal()]);
    const seen = new Set();
    const added = [...remote.reviews, ...stored()].filter((r) => !hid.has(r.id) && !seen.has(r.id) && seen.add(r.id));
    return { base: BASE.filter((b) => !hid.has(b.id)), added };
  };

  const render = () => {
    const v = visible();
    track.innerHTML = v.base.map((b) => b.html).join('') + v.added.map(cardHtml).join('');
    const originals = $$('.review', track);
    originals.forEach((el) => { const c = el.cloneNode(true); c.dataset.clone = '1'; c.setAttribute('aria-hidden', 'true'); c.removeAttribute('tabindex'); track.appendChild(c); });
    const width = originals.reduce((w, el) => w + el.getBoundingClientRect().width + 16, 0);
    track.style.setProperty('--w', width + 'px');
    track.style.setProperty('--dur', Math.max(40, width / 45) + 's');
  };

  /* survol = pause 3 s, puis reprise */
  let pauseTimer = null;
  const pause = () => { marquee.classList.add('is-paused'); clearTimeout(pauseTimer); pauseTimer = setTimeout(() => marquee.classList.remove('is-paused'), 3000); };
  ['pointerover', 'click', 'focusin'].forEach((ev) => marquee.addEventListener(ev, (e) => { if (e.target.closest('.review')) pause(); }));
  window.addEventListener('resize', () => { clearTimeout(window.__mqT); window.__mqT = setTimeout(render, 300); });

  render();
  fetch(REMOTE, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    remote = normalize(d);
    const known = new Set(remote.reviews.map((r) => r.id));
    setStored(stored().filter((r) => !known.has(r.id)));   /* deja publie : plus besoin de le garder en local */
    render(); refreshCount(); refreshList();
  }).catch(() => {});

  /* ---------- modales ---------- */
  const open = (id) => { const m = $(id); if (!m) return; m.hidden = false; requestAnimationFrame(() => m.classList.add('is-open')); const f = $('input, textarea', m); if (f) setTimeout(() => f.focus(), 60); };
  const close = (m) => {
    m.classList.remove('is-open');
    setTimeout(() => { m.hidden = true; }, 250);
    if (m.id === 'admin-modal') { unlocked = false; editing = null; $('[data-admin-form]', m)?.reset(); setFormMode(); applyAdmin(); }
  };
  $$('[data-modal-close]').forEach((b) => b.addEventListener('click', () => close(b.closest('.modal'))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal:not([hidden])').forEach(close); });

  const isAdmin = () => unlocked;
  const refreshCount = () => {
    const v = visible();
    $$('[data-review-count]').forEach((el) => { el.textContent = v.added.length; });
    const st = $('[data-sync-state]');
    if (st) st.textContent = gh() ? (stored().length ? stored().length + ' en attente de publication.' : 'Tout est publié en ligne.') : 'Publication en ligne non configurée : ils ne sont visibles que sur ce navigateur.';
  };
  const applyAdmin = () => {
    const on = isAdmin();
    const m = $('#admin-modal');
    if (m) { $('[data-admin-form]', m).hidden = on; $('.modal_admin', m).hidden = !on; $('#admin-title').textContent = on ? 'Ajouter un avis' : 'Mot de passe'; }
    refreshCount(); if (on) refreshList();
  };

  /* ---------- liste des avis, avec cases a cocher ---------- */
  const refreshList = () => {
    const box = $('[data-review-list]');
    if (!box) return;
    const v = visible();
    const rows = [
      ...v.base.map((b) => ({ id: b.id, who: b.who.replace(/^[★\s]+/, ''), text: b.text.replace(/[«»]/g, '').trim(), origin: 'origine' })),
      ...v.added.map((r) => ({ id: r.id, who: r.who + (r.tag ? ' (' + r.tag + ')' : ''), text: r.text, origin: 'ajouté' })),
    ];
    box.innerHTML = rows.map((r) => '<label class="rev_row' + (editing === r.id ? ' is-editing' : '') + '"><input type="checkbox" value="' + esc(r.id) + '"/><span class="rev_who">' + esc(r.who) + '</span><span class="rev_txt">' + esc(r.text.slice(0, 70)) + (r.text.length > 70 ? '\u2026' : '') + '</span><span class="rev_org">' + r.origin + '</span><button type="button" class="rev_edit" data-edit="' + esc(r.id) + '">Modifier</button></label>').join('')
      || '<p class="modal_text">Aucun avis.</p>';
    box.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', (ev) => { ev.preventDefault(); startEdit(btn.dataset.edit); }));
    const del = $('[data-delete-reviews]');
    if (del) del.disabled = true;
    box.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => { if (del) del.disabled = !box.querySelector('input:checked'); }));
  };

  /* ---------- edition d'un avis ---------- */
  let editing = null;
  const findAny = (id) => BASE.find((b) => b.id === id) || remote.reviews.find((r) => r.id === id) || stored().find((r) => r.id === id);
  const setFormMode = () => {
    const lbl = $('[data-submit-label]'); const cancel = $('[data-cancel-edit]'); const title = $('#admin-title');
    if (lbl) lbl.textContent = editing ? 'Enregistrer les modifications' : "Publier l'avis";
    if (cancel) cancel.hidden = !editing;
    if (title && isAdmin()) title.textContent = editing ? "Modifier l'avis" : 'Ajouter un avis';
  };
  const startEdit = (id) => {
    const r = findAny(id); if (!r) return;
    const form = $('[data-review-form]');
    editing = id;
    form.text.value = r.text || ''; form.who.value = r.who || ''; form.tag.value = r.tag || ''; form.products.value = r.products || '';
    form.stars.value = String(r.stars || 5);
    $$('[data-stars] .star').forEach((b, i) => b.classList.toggle('is-on', i < (+r.stars || 5)));
    setFormMode(); refreshList();
    form.scrollIntoView({ block: 'nearest' }); form.text.focus();
  };
  const cancelEdit = () => {
    const form = $('[data-review-form]');
    editing = null; form.reset(); form.stars.value = '5';
    $$('[data-stars] .star').forEach((b) => b.classList.add('is-on'));
    setFormMode(); refreshList();
  };
  $('[data-cancel-edit]')?.addEventListener('click', cancelEdit);

  const removeIds = async (ids) => {
    const set = new Set(ids);
    /* known se calcule AVANT le filtrage : sinon un avis DEJA PUBLIE supprime sans jeton
       n'etait pas masque localement et revenait au prochain chargement */
    const known = new Set([...BASE.map((b) => b.id), ...remote.reviews.map((r) => r.id)]);
    setStored(stored().filter((r) => !set.has(r.id)));
    remote.reviews = remote.reviews.filter((r) => !set.has(r.id));
    setHiddenLocal([...new Set([...hiddenLocal(), ...ids.filter((id) => known.has(id))])]);
    render(); refreshCount(); refreshList();
    return gh() ? publish() : { ok: true, msg: ids.length + ' avis supprimé(s) sur ce navigateur.' };
  };

  /* ---------- publication reelle (API GitHub) ---------- */
  const publish = async () => {
    const cfg = gh();
    if (!cfg || !cfg.token || !cfg.repo) return { ok: false, msg: 'Jeton non configuré.' };
    const url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + REMOTE;
    const head = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' };
    try {
      const cur = await fetch(url + '?ref=' + (cfg.branch || 'main'), { headers: head, cache: 'no-store' });
      let sha = null;
      if (cur.ok) sha = (await cur.json()).sha;
      else if (cur.status !== 404) return { ok: false, msg: 'Lecture refusée (' + cur.status + ').' };
      const seen = new Set();
      const payload = {
        reviews: [...remote.reviews, ...stored()].filter((r) => !seen.has(r.id) && seen.add(r.id)),
        hidden: [...new Set([...remote.hidden, ...hiddenLocal()])],
      };
      const body = { message: 'Avis mis a jour depuis le panneau admin', content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 1)))), branch: cfg.branch || 'main' };
      if (sha) body.sha = sha;
      const put = await fetch(url, { method: 'PUT', headers: head, body: JSON.stringify(body) });
      if (!put.ok) return { ok: false, msg: 'Publication refusée (' + put.status + ').' };
      remote = payload; setStored([]); setHiddenLocal([]); render(); refreshCount(); refreshList();
      return { ok: true, msg: 'Publié. Le site en ligne se met à jour dans une minute environ.' };
    } catch (e) { return { ok: false, msg: 'Réseau indisponible.' }; }
  };

  const sha256 = async (t) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  const flash = (form, msg) => { let el = $('.modal_ok', form); if (!el) { el = document.createElement('div'); el.className = 'modal_ok'; form.appendChild(el); } el.textContent = msg; clearTimeout(el.__t); el.__t = setTimeout(() => el.remove(), 5000); };

  /* ---------- evenements ---------- */
  $$('[data-admin-open]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    unlocked = false; applyAdmin();
    const err = $('#admin-modal .modal_error'); if (err) err.hidden = true;
    open('#admin-modal');
  }));
  $('[data-admin-logout]')?.addEventListener('click', () => { unlocked = false; applyAdmin(); close($('#admin-modal')); });

  $('[data-admin-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget; const err = $('.modal_error', form);
    const ok = (await sha256(form.pwd.value)) === HASH;
    err.hidden = ok;
    if (!ok) { form.pwd.select(); return; }
    unlocked = true; form.reset(); applyAdmin();
    setTimeout(() => $('[data-review-form] textarea')?.focus(), 60);
  });

  $('[data-review-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const r = { id: 'r' + Date.now(), text: form.text.value.trim(), who: form.who.value.trim(), tag: form.tag.value.trim(), products: form.products.value.trim(), stars: form.stars.value, date: new Date().toISOString().slice(0, 10) };
    if (!r.text || !r.who) return;
    if (editing) {
      const old = editing; editing = null; setFormMode();
      if (BASE.some((b) => b.id === old)) {
        /* un avis d'origine vit dans le HTML : on masque l'original et on enregistre la version modifiee */
        setHiddenLocal([...new Set([...hiddenLocal(), old])]);
        setStored([...stored(), r]);
      } else {
        r.id = old;   /* meme identifiant : la modification remplace l'avis */
        remote.reviews = remote.reviews.map((x) => (x.id === old ? r : x));
        const loc = stored();
        setStored(loc.some((x) => x.id === old) ? loc.map((x) => (x.id === old ? r : x)) : [...loc, r]);
      }
    } else setStored([...stored(), r]);
    render(); refreshCount(); refreshList();
    form.reset(); $$('[data-stars] .star').forEach((b) => b.classList.add('is-on')); form.stars.value = '5';
    const el = $('.review[data-id="' + r.id + '"]');
    if (el) { el.classList.add('is-new'); setTimeout(() => el.classList.remove('is-new'), 4000); }
    if (gh()) { flash(form, 'Publication en ligne…'); publish().then((res) => flash(form, res.msg)); }
    else flash(form, 'Ajouté à la ligne d\'avis.');
  });

  $('[data-delete-reviews]')?.addEventListener('click', async (e) => {
    const box = $('[data-review-list]');
    const ids = [...box.querySelectorAll('input:checked')].map((c) => c.value);
    if (!ids.length) return;
    if (!confirm('Supprimer ' + ids.length + ' avis ?')) return;
    const res = await removeIds(ids);
    flash(e.currentTarget.closest('.modal_admin'), res.msg);
  });

  $$('[data-stars]').forEach((field) => {
    const st = $$('.star', field); const input = $('input[name=stars]', field);
    const paint = (n) => st.forEach((b, i) => b.classList.toggle('is-on', i < n));
    st.forEach((b, i) => {
      b.addEventListener('click', () => { input.value = String(i + 1); paint(i + 1); });
      b.addEventListener('pointerenter', () => paint(i + 1));
    });
    field.addEventListener('pointerleave', () => paint(+input.value || 5));
  });

  $('[data-token-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.token.value.trim()) sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ repo: f.repo.value.trim(), token: f.token.value.trim(), branch: 'main' }));
    const res = await publish();
    flash(f, res.msg); f.token.value = ''; refreshCount();
  });

  $('[data-export-reviews]')?.addEventListener('click', () => {
    const ta = $('.modal_export');
    ta.hidden = false;
    ta.value = JSON.stringify({ reviews: [...remote.reviews, ...stored()], hidden: [...new Set([...remote.hidden, ...hiddenLocal()])] }, null, 1);
    ta.select(); try { document.execCommand('copy'); } catch (err) {}
  });

  applyAdmin();
});
