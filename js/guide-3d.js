/* Les modules Pulse en 3D sur les pages guide : le même objet que l'accueil (mêmes géométries, mêmes
   matériaux, même étiquette dessinée), rendu en direct.
   - Le premier écran : le module de la page, dans la figure, avec son propre rendu WebGL.
   - « Les autres guides » et l'offre : les autres modules, chacun dans sa case, rendus par UN seul
     rendu WebGL partagé (une fenêtre par case dans un tampon fixe) et recopiés dans des canvas 2D.
   Si WebGL manque, les packshots restent. Copié de js/engine.js (#region Module Pulse) : si l'accueil
   change, ici aussi.

   Fluidité (27/08, mesuré avant/après dans wiki/pulse-tweaks-site.md) :
   - les nuanciers se compilent en parallèle (compileAsync) : la page ne gèle plus à l'arrivée, le
     packshot reste affiché le temps que la 3D soit prête ;
   - le rendu partagé se prépare une section avant d'être vu, un module par image : jamais plus
     d'une étiquette dessinée dans la même image ;
   - une case hors écran n'est pas rendue ; une case au repos se redessine 40 fois par seconde, 125
     sous la souris (requestAnimationFrame tourne à 280 Hz sur certaines machines : sans plafond, six
     rendus par image pour rien) ;
   - le tampon partagé garde une taille fixe : une fenêtre (viewport) par case, plus de redimension
     du canvas à chaque rendu ;
   - v7 : UN seul contexte WebGL pour le héros et les cases (un seul environnement PMREM, une seule
     compilation), et l'arrivée découpée entre les images : environnement, puis module, puis compilation,
     puis première image. Mesuré à CPU bridé x4 : encore un gel de 507 ms avec deux contextes. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const PRODUCTS = window.PULSE_PRODUCTS || [];
const PAGE = window.PULSE_PRODUCT;
const fig = document.querySelector('.ouverture .objet');
if (!fig || !PAGE) throw new Error('guide-3d : pas de figure ou pas de produit');
window.addEventListener('error', (e) => { if (String(e.message || '').includes('WebGL')) console.warn('guide-3d : WebGL indisponible, packshots conservés'); });
const CALME = matchMedia('(prefers-reduced-motion: reduce)').matches; /* mouvement réduit : la 3D reste, elle ne dérive pas */
const lowPower = navigator.hardwareConcurrency ? navigator.hardwareConcurrency <= 4 : false;
const CADENCE = { actif: 1000 / 125, repos: 1000 / 40 }; /* plafonds de rendu, en ms entre deux images */
const mark = (n) => { try { performance.mark('g3d:' + n); } catch (e) {} };
const image = () => new Promise((r) => requestAnimationFrame(r));

await Promise.race([
  Promise.all([document.fonts.load('italic 100px Anton'), document.fonts.load('400 20px Geistmono'), document.fonts.load('600 20px Geist')]),
  new Promise((r) => setTimeout(r, 2000)),
]).catch(() => {});

/* ---------- ce qui est commun : matériaux, géométries, étiquette ---------- */
const makeMaterial = (params) => {
  if (lowPower) {
    const { clearcoat, clearcoatRoughness, sheen, sheenRoughness, sheenColor, ior, reflectivity, ...std } = params;
    return new THREE.MeshStandardMaterial(std);
  }
  return new THREE.MeshPhysicalMaterial(params);
};
const MOD_W = 1.35, MOD_H = 0.8, MOD_L = 4.0;
const bodyGeometry = new RoundedBoxGeometry(MOD_W, MOD_H, MOD_L, 6, 0.12);
const capGeometry = new THREE.CylinderGeometry(0.42, 0.5, 0.22, 48);
capGeometry.rotateX(Math.PI / 2); capGeometry.translate(0, 0, MOD_L / 2 + 0.1);
const LBL_W = 1.12, LBL_L = 3.4;
const labelGeometry = new THREE.PlaneGeometry(LBL_W, LBL_L);
labelGeometry.rotateX(-Math.PI / 2); labelGeometry.translate(0, MOD_H / 2 + 0.006, 0);
const labelBackGeometry = new THREE.PlaneGeometry(LBL_W, LBL_L);
labelBackGeometry.rotateX(Math.PI / 2); labelBackGeometry.rotateY(Math.PI); labelBackGeometry.translate(0, -MOD_H / 2 - 0.006, 0);
const stripGeometry = new THREE.BoxGeometry(0.03, 0.06, 3.2); stripGeometry.translate(MOD_W / 2 + 0.005, MOD_H / 2 - 0.12, 0);
const strip2Geometry = new THREE.BoxGeometry(0.03, 0.06, 3.2); strip2Geometry.translate(-MOD_W / 2 - 0.005, -MOD_H / 2 + 0.12, 0);
const ledGeometry = new THREE.SphereGeometry(0.06, 16, 16); ledGeometry.translate(-MOD_W / 2 + 0.2, MOD_H / 2 + 0.02, MOD_L / 2 - 0.35);

function labelTexture(renderer, p, res) {
  const REF_W = 2048, REF_H = 6144, RES = res;
  const c = document.createElement('canvas'); c.width = REF_W * RES; c.height = REF_H * RES;
  const g = c.getContext('2d');
  g.setTransform(RES, 0, 0, RES, 0, 0);
  g.fillStyle = '#0b0a10'; g.fillRect(0, 0, REF_W, REF_H);
  g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 8; g.strokeRect(140, 140, REF_W - 280, REF_H - 280);
  g.fillStyle = '#f4f3f6'; g.textAlign = 'center'; g.font = 'italic 210px Anton';
  g.fillText('PULSE TWEAKS', REF_W / 2, 470);
  g.font = '78px Geistmono'; g.fillStyle = 'rgba(228,228,234,.85)';
  g.fillText(p.tag, REF_W / 2, 600);
  g.save(); g.translate(520, REF_H / 2 + 160); g.rotate(-Math.PI / 2);
  g.font = 'italic 620px Anton'; g.fillStyle = '#ffffff'; g.textAlign = 'center';
  g.fillText(p.name, 0, 200); g.restore();
  g.textAlign = 'left'; g.font = '600 92px Geist, Geistmono';
  p.lines.forEach((line, i) => {
    const y = 2760 + i * 400;
    g.fillStyle = p.css; g.fillRect(880, y - 66, 48, 48);
    g.fillStyle = '#e4e4ea';
    const parts = line.split(' / ');
    g.fillText(parts[0], 980, y);
    if (parts[1]) g.fillText(parts[1], 980, y + 118);
  });
  g.textAlign = 'center'; g.font = '66px Geistmono'; g.fillStyle = 'rgba(228,228,234,.9)';
  g.fillText('OPTIMISATION MANUELLE', REF_W / 2, REF_H - 520);
  g.fillText('ZÉRO RÉGLAGE INUTILE', REF_W / 2, REF_H - 410);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  return t;
}

const BASE_Z = Math.PI / 8;
function makeCan(renderer, p, res) {
  const can = new THREE.Group();
  const bodyMaterial = makeMaterial({ color: 0x0c0b12, metalness: 0.78, roughness: 0.32, sheen: 0.2, sheenRoughness: 0.3, sheenColor: 0xffffff,
    clearcoat: 0.6, clearcoatRoughness: 0.25, reflectivity: 1, ior: 2, envMapIntensity: 1.2 });
  const capMaterial = makeMaterial({ color: 0x15141c, metalness: 0.9, roughness: 0.25, clearcoat: 0.4, envMapIntensity: 1 });
  const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture(renderer, p, res), side: THREE.DoubleSide, toneMapped: false });
  const glow = new THREE.MeshBasicMaterial({ color: p.color });
  [new THREE.Mesh(bodyGeometry, bodyMaterial), new THREE.Mesh(capGeometry, capMaterial),
   new THREE.Mesh(labelGeometry, labelMaterial), new THREE.Mesh(labelBackGeometry, labelMaterial),
   new THREE.Mesh(stripGeometry, glow), new THREE.Mesh(strip2Geometry, glow), new THREE.Mesh(ledGeometry, glow)]
    .forEach((m) => { m.rotation.x = Math.PI / 2; can.add(m); });
  can.rotation.set(0, 0, BASE_Z);
  return can;
}

function makeStage(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const white = new THREE.Color(0xffffff);
  const spot1 = new THREE.SpotLight(white, 50, 8, Math.PI / 4, 1, 0.1); spot1.position.set(0, 3.5, 0); spot1.target.position.set(0, 0, 1);
  const spot2 = new THREE.SpotLight(white, 50, 8, Math.PI / 3, 1, 0.1); spot2.position.set(0, -3, 2); spot2.target.position.set(0, 0, 1.8);
  const spot3 = new THREE.SpotLight(white, 18, 15, Math.PI / 8, 1, 0.1); spot3.position.set(0, 3, 5); spot3.target.position.set(0, 0.5, 0);
  const lampe = new THREE.PointLight(white, 6, 6, 2); lampe.position.set(1.4, 0.6, 1.2);
  scene.add(spot1, spot1.target, spot2, spot2.target, spot3, spot3.target, lampe);
  return { scene, camera, lampe };
}
function frameCamera(camera, w, h, fill) {
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const fit = MOD_L * fill;
  const dist = (fit / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, 0, Math.max(dist, dist * (1 / Math.min(1, camera.aspect * 1.6))));
}
const dprCap = () => Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.25);
const makeRenderer = (canvas) => {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  return r;
};
THREE.ColorManagement.enabled = true;

/* ---------- un seul rendu pour toutes les vues : héros, autres guides, offre ---------- */
const off = document.createElement('canvas');
const renderer = makeRenderer(off);
const views = []; const vus = new Set(); /* les vues à l'écran : seules celles-là se dessinent */
let scene = null, camera = null, lampe = null, raf = 0, last = -1; const t0 = performance.now();

function size() {
  const dpr = dprCap();
  views.forEach((v) => {
    const r = v.holder.getBoundingClientRect();
    v.w = Math.max(1, Math.round(r.width)); v.h = Math.max(1, Math.round(r.height));
    v.canvas.width = Math.round(v.w * dpr); v.canvas.height = Math.round(v.h * dpr);
  });
  /* tampon fixe à la taille de la plus grande vue ; chaque vue y prend une fenêtre (viewport + scissor) */
  const maxW = Math.max(...views.map((v) => v.canvas.width)), maxH = Math.max(...views.map((v) => v.canvas.height));
  if (off.width !== maxW || off.height !== maxH) { renderer.setPixelRatio(1); renderer.setSize(maxW, maxH, false); }
  renderer.setScissorTest(true);
}
function dessine(v, t) {
  const k = CALME ? 0 : 1;
  v.cY += (v.tY - v.cY) * (v.hero ? 0.08 : 0.1); v.cX += (v.tX - v.cX) * (v.hero ? 0.08 : 0.1);
  if (v.hero) {
    v.can.rotation.y = v.cY + Math.sin(t * 0.45) * 0.12 * k; v.can.rotation.x = v.cX + Math.sin(t * 0.3) * 0.04 * k;
    v.can.rotation.z = BASE_Z + Math.sin(t * 0.25) * 0.02 * k; v.can.position.y = Math.sin(t * 0.6) * 0.06 * k;
  } else {
    v.can.rotation.y = v.cY + (v.hover || CALME ? 0 : v.calme ? Math.sin(t * 0.4 + v.phase) * 0.14 : (t * 0.35 + v.phase) % (Math.PI * 2));
    v.can.rotation.x = v.cX + Math.sin(t * 0.27 + v.phase) * 0.03; v.can.rotation.z = BASE_Z; v.can.position.y = Math.sin(t * 0.5 + v.phase) * 0.04;
  }
  lampe.color.set(v.p.color);
  views.forEach((o) => { o.can.visible = o === v; });
  const W = v.canvas.width, H = v.canvas.height;
  renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); frameCamera(camera, v.w, v.h, v.fill);
  renderer.render(scene, camera);
  v.ctx.clearRect(0, 0, W, H);
  v.ctx.drawImage(off, 0, off.height - H, W, H, 0, 0, W, H);
}
function loop(now) {
  raf = 0; if (!vus.size) return;
  raf = requestAnimationFrame(loop);
  const actif = views.some((v) => vus.has(v.li) && (v.hover || (v.hero && Math.abs(v.tY - v.cY) + Math.abs(v.tX - v.cX) > 0.003)));
  if (now - last < (actif ? CADENCE.actif : CADENCE.repos) - 1) return;
  last = now;
  const t = (now - t0) / 1000;
  views.forEach((v) => { if (v.pret && vus.has(v.li)) dessine(v, t); });
}
const reveille = () => { if (vus.size && !raf) raf = requestAnimationFrame(loop); };
const io = new IntersectionObserver((es) => { es.forEach((e) => { e.isIntersecting ? vus.add(e.target) : vus.delete(e.target); }); reveille(); }, { threshold: 0.02 });
function ajouteVue(li, p, opts) {
  const canvas = document.createElement('canvas'); canvas.className = opts.hero ? 'objet-3d' : 'voisin-3d'; canvas.setAttribute('aria-hidden', 'true');
  const holder = opts.hero ? li : (li.querySelector('.voisin-objet') || (li.classList.contains('objet') ? li : li.querySelector('a')));
  const v = { li, p, holder, canvas, ctx: canvas.getContext('2d'), w: 1, h: 1, tY: 0, tX: 0, cY: 0, cX: 0, hover: false, pret: false, ...opts };
  v.can = makeCan(renderer, p, v.res); v.can.visible = true; scene.add(v.can);
  if (!opts.hero) holder.appendChild(canvas); /* le héros n'est posé qu'une fois sa première image dessinée */
  views.push(v); io.observe(li);
  return v;
}
addEventListener('resize', size, { passive: true });

/* ---------- 1. le premier écran : le module de la page, morceau par morceau ---------- */
mark('hero:debut');
await image(); ({ scene, camera, lampe } = makeStage(renderer)); /* environnement (PMREM) */
await image(); const hero = ajouteVue(fig, PAGE, { hero: true, fill: 1.55, res: lowPower ? 0.35 : 0.5, calme: false, phase: 0 }); /* étiquette dessinée */
addEventListener('pointermove', (e) => { const r = fig.getBoundingClientRect();
  hero.tY = ((e.clientX - (r.left + r.width / 2)) / r.width) * 0.35; hero.tX = ((e.clientY - (r.top + r.height / 2)) / r.height) * 0.18; }, { passive: true });
addEventListener('scroll', () => { hero.tX = Math.min(0.5, scrollY / innerHeight) * 0.35; }, { passive: true });
size();
/* les nuanciers se compilent en parallèle : pas de gel, le packshot reste affiché en attendant */
if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {});
await image();
hero.pret = true; vus.add(fig); dessine(hero, 0);
fig.appendChild(hero.canvas); fig.classList.add('is-3d');
const img = fig.querySelector('img'); if (img) img.setAttribute('aria-hidden', 'true');
mark('hero:pret');
reveille();

/* ---------- 2. les autres guides et l'offre : même rendu, préparés un écran avant d'être vus ---------- */
const cells = [...document.querySelectorAll('.voisins li[data-key], .offre .objet[data-key]')].filter((li) => PRODUCTS.some((p) => p.key === li.dataset.key));
if (cells.length) {
  let pret = false, enCours = false;
  async function preparer() {
    if (enCours || pret) return; enCours = true; mark('voisins:debut');
    const nouvelles = [];
    for (let i = 0; i < cells.length; i++) {
      await image(); /* un module par image : jamais deux étiquettes dessinées dans la même image */
      const li = cells[i]; const p = PRODUCTS.find((x) => x.key === li.dataset.key);
      const v = ajouteVue(li, p, { hero: false, fill: li.classList.contains('objet') ? 1.35 : 1.12, res: lowPower ? 0.25 : 0.35, calme: li.classList.contains('objet'), phase: i * 1.3 });
      li.addEventListener('pointermove', (e) => { const r = li.getBoundingClientRect();
        v.tY = ((e.clientX - (r.left + r.width / 2)) / r.width) * 0.5; v.tX = ((e.clientY - (r.top + r.height / 2)) / r.height) * 0.25; v.hover = true; }, { passive: true });
      li.addEventListener('pointerleave', () => { v.tY = 0; v.tX = 0; v.hover = false; }, { passive: true });
      nouvelles.push(v);
    }
    size();
    await image();
    nouvelles.forEach((v) => { v.pret = true; });
    mark('voisins:pret');
    pret = true; enCours = false;
    const t = (performance.now() - t0) / 1000;
    nouvelles.forEach((v) => { if (vus.has(v.li)) dessine(v, t); }); /* une première image dans chaque case visible, avant le fondu */
    nouvelles.forEach((v) => v.li.classList.add('is-3d'));
    reveille();
  }
  /* se préparer un écran avant d'être vu, ou au premier moment calme */
  const proche = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { proche.disconnect(); preparer(); } }, { rootMargin: '100% 0px' });
  cells.forEach((c) => proche.observe(c));
  const calme = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  calme(() => preparer(), { timeout: 4000 });
}
