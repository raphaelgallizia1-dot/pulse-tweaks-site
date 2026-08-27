/* Les modules Pulse en 3D sur les pages guide : le même objet que l'accueil (mêmes géométries, mêmes
   matériaux, même étiquette dessinée), rendu en direct.
   - Le premier écran : le module de la page, dans la figure, avec son propre rendu WebGL.
   - « Les autres guides » : les quatre autres modules, chacun dans sa case, immobiles (dérive lente,
     inclinaison au survol), rendus par UN seul rendu WebGL partagé et recopiés dans des canvas 2D.
   Si WebGL manque, les packshots restent. Copié de js/engine.js (#region Module Pulse) : si l'accueil
   change, ici aussi. */
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

/* ---------- 1. le premier écran : le module de la page, rendu direct ---------- */
{
  const canvas = document.createElement('canvas'); canvas.className = 'objet-3d'; canvas.setAttribute('aria-hidden', 'true');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0); THREE.ColorManagement.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const { scene, camera, lampe } = makeStage(renderer);
  lampe.color.set(PAGE.color);
  const can = makeCan(renderer, PAGE, lowPower ? 0.35 : 0.5); scene.add(can);
  let targetY = 0, targetX = 0, curY = 0, curX = 0, visible = true, raf = 0; const t0 = performance.now();
  function resize() {
    const r = fig.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(dprCap()); renderer.setSize(w, h, false); frameCamera(camera, w, h, 1.55);
  }
  addEventListener('pointermove', (e) => { const r = fig.getBoundingClientRect();
    targetY = ((e.clientX - (r.left + r.width / 2)) / r.width) * 0.35; targetX = ((e.clientY - (r.top + r.height / 2)) / r.height) * 0.18; }, { passive: true });
  addEventListener('scroll', () => { targetX = Math.min(0.5, scrollY / innerHeight) * 0.35; }, { passive: true });
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }, { threshold: 0.02 }).observe(fig);
  addEventListener('resize', resize, { passive: true });
  function loop(now) {
    raf = 0; if (!visible) return;
    const t = (now - t0) / 1000;
    curY += (targetY - curY) * 0.06; curX += (targetX - curX) * 0.06;
    const k = CALME ? 0 : 1;
    can.rotation.y = curY + Math.sin(t * 0.45) * 0.12 * k; can.rotation.x = curX + Math.sin(t * 0.3) * 0.04 * k;
    can.rotation.z = BASE_Z + Math.sin(t * 0.25) * 0.02 * k; can.position.y = Math.sin(t * 0.6) * 0.06 * k;
    renderer.render(scene, camera); raf = requestAnimationFrame(loop);
  }
  resize(); renderer.render(scene, camera);
  fig.appendChild(canvas); fig.classList.add('is-3d');
  const img = fig.querySelector('img'); if (img) img.setAttribute('aria-hidden', 'true');
  raf = requestAnimationFrame(loop);
}

/* ---------- 2. les autres guides : quatre modules, un rendu partagé, chacun dans sa case ---------- */
const cells = [...document.querySelectorAll('.voisins li[data-key], .offre .objet[data-key]')].filter((li) => PRODUCTS.some((p) => p.key === li.dataset.key));
if (cells.length) {
  const off = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: off, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const { scene, camera, lampe } = makeStage(renderer);
  const views = cells.map((li, i) => {
    const p = PRODUCTS.find((x) => x.key === li.dataset.key);
    const can = makeCan(renderer, p, lowPower ? 0.25 : 0.35); can.visible = false; scene.add(can);
    const canvas = document.createElement('canvas'); canvas.className = 'voisin-3d'; canvas.setAttribute('aria-hidden', 'true');
    const holder = li.querySelector('.voisin-objet') || (li.classList.contains('objet') ? li : li.querySelector('a'));
    holder.appendChild(canvas);
    const v = { li, p, can, canvas, ctx: canvas.getContext('2d'), w: 1, h: 1, tY: 0, tX: 0, cY: 0, cX: 0, phase: i * 1.3, hover: false, calme: li.classList.contains('objet') };
    li.addEventListener('pointermove', (e) => { const r = li.getBoundingClientRect();
      v.tY = ((e.clientX - (r.left + r.width / 2)) / r.width) * 0.5; v.tX = ((e.clientY - (r.top + r.height / 2)) / r.height) * 0.25; v.hover = true; }, { passive: true });
    li.addEventListener('pointerleave', () => { v.tY = 0; v.tX = 0; v.hover = false; }, { passive: true });
    return v;
  });
  let visible = false, raf = 0; const t0 = performance.now();
  function size() {
    const dpr = dprCap();
    views.forEach((v) => {
      const holder = v.canvas.parentElement; const r = holder.getBoundingClientRect();
      v.w = Math.max(1, Math.round(r.width)); v.h = Math.max(1, Math.round(r.height));
      v.canvas.width = Math.round(v.w * dpr); v.canvas.height = Math.round(v.h * dpr);
    });
    const maxW = Math.max(...views.map((v) => v.w)), maxH = Math.max(...views.map((v) => v.h));
    renderer.setPixelRatio(dpr); renderer.setSize(maxW, maxH, false);
  }
  function loop(now) {
    raf = 0; if (!visible) return;
    const t = (now - t0) / 1000; const dpr = dprCap();
    views.forEach((v) => {
      v.cY += (v.tY - v.cY) * 0.08; v.cX += (v.tX - v.cX) * 0.08;
      v.can.rotation.y = v.cY + (v.hover || CALME ? 0 : v.calme ? Math.sin(t * 0.4 + v.phase) * 0.14 : (t * 0.35 + v.phase) % (Math.PI * 2)); v.can.rotation.x = v.cX + Math.sin(t * 0.27 + v.phase) * 0.03;
      v.can.rotation.z = BASE_Z; v.can.position.y = Math.sin(t * 0.5 + v.phase) * 0.04;
      lampe.color.set(v.p.color);
      views.forEach((o) => { o.can.visible = o === v; });
      renderer.setSize(v.w, v.h, false); frameCamera(camera, v.w, v.h, v.calme ? 1.35 : 1.12);
      renderer.render(scene, camera);
      v.ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
      v.ctx.drawImage(off, 0, off.height - v.h * dpr, v.w * dpr, v.h * dpr, 0, 0, v.canvas.width, v.canvas.height);
    });
    raf = requestAnimationFrame(loop);
  }
  const vus = new Set();
  const io = new IntersectionObserver((es) => { es.forEach((e) => { e.isIntersecting ? vus.add(e.target) : vus.delete(e.target); }); visible = vus.size > 0; if (visible && !raf) raf = requestAnimationFrame(loop); }, { threshold: 0.05 });
  new Set(cells.map((c) => c.closest('section') || c)).forEach((sec) => io.observe(sec));
  addEventListener('resize', size, { passive: true });
  size();
  views.forEach((v) => v.li.classList.add('is-3d'));
  raf = requestAnimationFrame(loop);
}
