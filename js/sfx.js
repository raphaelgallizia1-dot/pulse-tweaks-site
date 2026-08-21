/* Sons d'interface — même logique que la référence (changement de produit, entrée fiche, bénéfices, clics),
   mais synthétisés en Web Audio (aucun fichier tiers). Respecte le bouton ON/OFF de la navbar. */
document.addEventListener('DOMContentLoaded', () => {
  const VOLUME = 0.35;
  let ctx = null;
  let unlocked = false;

  const initCtx = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); };
  const isMuted = () => {
    const btn = document.querySelector('.navbar_sound');
    return btn ? btn.classList.contains('is-muted') : false;
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelector('.navbar_sound')?.classList.add('is-muted');

  // petites recettes : [fréquence, durée, type, glissando]
  const RECIPES = {
    change: { f: 880, to: 1320, d: 0.08, type: 'sine', gain: 0.5 },
    enter: { f: 220, to: 110, d: 0.45, type: 'triangle', gain: 0.9 },
    benefits: { f: 520, to: 780, d: 0.22, type: 'sine', gain: 0.6 },
    click: { f: 1600, to: 1600, d: 0.04, type: 'square', gain: 0.25 },
    tick: { f: 1320, to: 990, d: 0.05, type: 'sine', gain: 0.16 },
  };

  const play = (name, { volume = 1 } = {}) => {
    if (!ctx || !unlocked || isMuted()) return;
    const r = RECIPES[name]; if (!r) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = r.type;
    osc.frequency.setValueAtTime(r.f, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(r.to, 20), t + r.d);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(VOLUME * volume * r.gain, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + r.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + r.d + 0.02);
  };

  /* la molette n'est PAS un geste d'activation : resume() est refuse et le son restait muet toute la session */
  const EV = ['pointerdown', 'touchstart', 'keydown'];
  const unlock = () => {
    initCtx();
    ctx.resume().then(() => {
      if (ctx.state !== 'running') return;
      unlocked = true;
      EV.forEach((ev) => window.removeEventListener(ev, unlock));
    }).catch(() => {});
  };
  EV.forEach((ev) => window.addEventListener(ev, unlock));

  window.pulseSound = { play };

  const nav = { lock: false, timer: null };
  const lockNav = (ms = 1800) => { nav.lock = true; clearTimeout(nav.timer); nav.timer = setTimeout(() => (nav.lock = false), ms); };

  const bindCarousel = () => {
    if (!window.carousel || !window.carousel.changed) return false;
    window.carousel.changed.connect(() => play('change'));
    return true;
  };
  if (!bindCarousel()) window.addEventListener('carousel:ready', bindCarousel, { once: true });

  const bindSectionEnter = () => {
    if (!window.lenis) return false;
    let boundary = 0;
    const computeBoundary = () => { const first = document.querySelector('section'); boundary = first ? first.clientHeight : 0; };
    computeBoundary();
    window.addEventListener('resize', computeBoundary);
    const fireAt = () => Math.max(boundary * 0.03, 24);
    let inHome = true;
    let last = window.lenis.animatedScroll || 0;
    window.lenis.on('scroll', () => {
      const cur = window.lenis.animatedScroll;
      const goingDown = cur > last;
      const threshold = fireAt();
      if (inHome && cur >= threshold) { inHome = false; if (goingDown && !nav.lock) play('enter'); }
      else if (!inHome && cur < threshold) inHome = true;
      last = cur;
    });
    return true;
  };
  if (!bindSectionEnter()) window.addEventListener('carousel:ready', bindSectionEnter, { once: true });

  const bindBenefits = () => {
    if (!window.lenis) return false;
    const wrap = (v, min, max) => { const size = max - min; v = v % size; if (v < 0) v += size; return v + min; };
    let sections = [];
    const buildSections = () => {
      let top = 0;
      sections = [...document.querySelectorAll('section')].map((el) => { const item = { top, isBenefits: el.classList.contains('is-benefits') }; top += el.clientHeight; return item; });
    };
    buildSections();
    window.addEventListener('resize', buildSections);
    const currentIndex = (pos) => { let best = 0, dist = Infinity; sections.forEach((it, i) => { const d = Math.abs(it.top - pos); if (d < dist) { dist = d; best = i; } }); return best; };
    let lastIdx = currentIndex(0);
    window.lenis.on('scroll', () => {
      const max = window.lenis.dimensions.scrollHeight - window.lenis.dimensions.height;
      if (max <= 0) return;
      const pos = wrap(window.lenis.animatedScroll, 0, max);
      const idx = currentIndex(pos);
      if (idx !== lastIdx) {
        const adjacent = Math.abs(idx - lastIdx) === 1;
        if (adjacent && sections[idx]?.isBenefits && !nav.lock) play('benefits');
        lastIdx = idx;
      }
    });
    return true;
  };
  if (!bindBenefits()) window.addEventListener('carousel:ready', bindBenefits, { once: true });

  /* tick discret a chaque passage de section a la molette (hors fiche et benefices, qui ont deja leur son) */
  const bindTick = () => {
    if (!window.sectionChanged) return false;
    window.sectionChanged.connect(({ to }) => { if (to !== 1 && !(to >= 2 && to <= 5)) play('tick'); });
    return true;
  };
  if (!bindTick()) window.addEventListener('carousel:ready', bindTick, { once: true });

  document.querySelector('.navbar_menu-button')?.addEventListener('click', () => play('click'));
  document.querySelectorAll('.navbar_link').forEach((link) => link.addEventListener('click', () => { play('click'); lockNav(); }));
  document.querySelectorAll('.benefits_icon-wrapper').forEach((icon) => icon.addEventListener('click', () => { play('benefits'); lockNav(); }));
  document.querySelectorAll('.faq_question').forEach((q) => q.addEventListener('click', () => play('click')));
});
