/* Pulse Tweaks — moteur 3D + scroll.
   Structure reprise du moteur Ciao Energy (Three.js 0.161 + Lenis infini + timeline GSAP scrubée,
   10 états, pager molette, swipe, loader, garde-fou de boucle). Seuls changent : l'objet (module Pulse
   procédural au lieu de la canette GLB), les étiquettes (canvas), le socle (procédural) et l'environnement. */

import Lenis from 'https://cdn.jsdelivr.net/npm/lenis@1.3.23/dist/lenis.mjs';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// #region Helpers

const wrap = (value, min, max) => {
  const size = max - min;
  value = value % size;
  if (value < 0) value += size;
  return value + min;
};
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const round = (value, step) => Math.round(value / step) * step;
const toArray = (item) => {
  if (Array.isArray(item)) return item;
  if (item instanceof NodeList || item instanceof HTMLCollection) return Array.from(item);
  return [item];
};
const on = (els, events, callback) => {
  if (typeof els === 'string' || els instanceof String) els = document.querySelectorAll(els);
  toArray(els).forEach((el) => {
    events.split(' ').forEach((event) => {
      if (typeof el === 'object' && el.hasOwnProperty(event) && el[event].connect) el[event].connect(callback);
      else el.addEventListener(event, callback);
    });
  });
};
const signal = () => {
  const callbacks = [];
  const connect = (callback) => callbacks.push(callback);
  const disconnect = (callback) => callbacks.splice(callbacks.indexOf(callback), 1);
  const emit = (data) => callbacks.forEach((callback) => callback(data));
  return { connect, disconnect, emit };
};
function debounce(callback, limit, isImmediate = false) {
  var timeout;
  return function () {
    var context = this, args = arguments;
    var later = function () { timeout = null; if (!isImmediate) callback.apply(context, args); };
    var callNow = isImmediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, limit);
    if (callNow) callback.apply(context, args);
  };
}
const closest = (items, goal, map, check) => {
  let dist = Infinity, index = -1;
  if (!check) check = (goal, value, dist) => Math.abs(value - goal) < Math.abs(dist - goal);
  items.forEach((value, i) => {
    if (map) value = map(value);
    if (check(goal, value, dist)) { dist = value; index = i; }
  });
  return { diff: Math.abs(goal - dist), index };
};

// #endregion Helpers
// #region Device Profile

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const lowPower = isIOS || window.innerWidth < 1024;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// #endregion Device Profile
// #region Setup

const lenis = new Lenis({ autoRaf: false, infinite: true, syncTouch: true });
window.lenis = lenis;

// #endregion Setup
// #region Scroll

const scroll = { position: 0 };
scroll.wrapped = (position) => wrap(position, 0, lenis.dimensions.scrollHeight - lenis.dimensions.height);
scroll.to = (pos, options) => { if (pos !== 0) pos -= 2; lenis.scrollTo(pos, options); }; /* -2 et non -10 : a 10 px du debut, des revelations calees sur le top ne se declenchaient pas */
scroll.distanceTo = (target, position = scroll.position) => {
  const min = position;
  const max = position - lenis.dimensions.scrollHeight + lenis.dimensions.height;
  if (Math.abs(max - target) < Math.abs(min - target)) return Math.abs(max - target);
  return Math.abs(min - target);
};
lenis.on('scroll', () => { scroll.position = scroll.wrapped(lenis.animatedScroll); });
scroll.snap = (position = scroll.position) => {
  if (window.innerWidth < 1024 || typeof section === 'undefined' || !section.items.length) return;
  const found = closest(section.items, position, (item) => item.top);
  if (found.index >= 0 && section.items[found.index].snap) scroll.to(section.items[found.index].top);
  else if (scroll.distanceTo(section.items[0].top, position) < section.items[0].height / 2) scroll.to(section.items[0].top);
};
on(window, 'scroll', debounce(() => scroll.snap(), 250));
on(window, 'scrollend', debounce(() => scroll.snap(), 50));

// #endregion Scroll
// #region Produits (l'équivalent des 6 saveurs : 4 couches)

const PRODUCTS = window.PULSE_PRODUCTS;

const cans = [];

let carousel = {
  spacing: 3.5,
  target: -1.5,
  position: -1.5,
  index: 0,
  lastIndex: 0,
  lastPosition: -1.5,
  delta: 0,
  offset: 0, /* l'offset 1.5 de la reference (nombre impair) supposait un pas de 3 ; avec un pas de 3.5 aucun module ne tombait au centre (5 produits : fiche ChipsetTuner affichait TimerTuner) */
};
carousel.getRounded = () => round(carousel.target + carousel.offset, carousel.spacing) - carousel.offset;
carousel.getIndex = (wrapped = true) => {
  const index = round((carousel.position + carousel.offset) / carousel.spacing, 1);
  if (wrapped) return wrap(index, 0, PRODUCTS.length);
  return index;
};
carousel.goTo = (index) => {
  /* chemin le plus court depuis la position courante : apres le defilement auto, un goTo absolu rembobinait des tours entiers */
  const cur = carousel.getIndex(false), n = PRODUCTS.length;
  let d = (((index - cur) % n) + n) % n;
  if (d > n / 2) d -= n;
  carousel.target = (cur + d) * carousel.spacing - carousel.offset;
};
carousel.previous = () => carousel.goTo(carousel.getIndex(false) - 1);
carousel.next = () => carousel.goTo(carousel.getIndex(false) + 1);
carousel.changed = signal();
carousel.indexChanged = carousel.changed;
window.carousel = carousel;

// #endregion
// #region Camera / Renderer

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, window.innerWidth / window.innerHeight, 0.1, 1000);

const mainEl = document.querySelector('main');
/* antialias:false — l'anticrenelage est fait par la cible MSAA du composer (le canvas par defaut n'en a pas besoin) */
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
/* budget de pixels : 1,25 DPR max ET ~4 Mpx max, sinon un 1440p/4K multiplie le cout des passes plein ecran */
const pixelBudget = 4.0e6;
const computePixelRatio = () => {
  const cap = lowPower ? 2 : 1.25;
  const byBudget = Math.sqrt(pixelBudget / (window.innerWidth * window.innerHeight));
  return Math.max(0.75, Math.min(window.devicePixelRatio, cap, byBudget));
};
let pixelRatio = computePixelRatio();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio);
renderer.setClearColor(0x000000, 0);
THREE.ColorManagement.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
mainEl.appendChild(renderer.domElement);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// #endregion
// #region Environment (teinte indirecte, comme la référence)

const white = new THREE.Color(0xffffff);
const tint = { color: { value: new THREE.Color(0xffffff) }, strength: { value: 1 } };

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

function applyEnvironmentTint(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tintColor = tint.color;
    shader.uniforms.tintStrength = tint.strength;
    shader.fragmentShader = `uniform vec3 tintColor;\nuniform float tintStrength;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= tintColor * tintStrength;\nreflectedLight.indirectSpecular *= tintColor * tintStrength;\n`,
    );
    material.userData.shader = shader;
  };
}

const makeMaterial = (params) => {
  if (lowPower) {
    const { clearcoat, clearcoatRoughness, sheen, sheenRoughness, sheenColor, ior, reflectivity, ...std } = params;
    return new THREE.MeshStandardMaterial(std);
  }
  return new THREE.MeshPhysicalMaterial(params);
};

// #endregion
// #region Lights (mêmes 3 spots)

const spot1 = new THREE.SpotLight(white, 50, 8, Math.PI / 4, 1, 0.1);
spot1.position.set(0, 3.5, 0); spot1.target.position.set(0, 0, 1);
scene.add(spot1, spot1.target);

const spot2 = new THREE.SpotLight(white, 50, 8, Math.PI / 3, 1, 0.1);
spot2.position.set(0, -3, 2); spot2.target.position.set(0, 0, 1.8);
scene.add(spot2, spot2.target);

const spot3 = new THREE.SpotLight(white, 0, 15, Math.PI / 8, 1, 0.1);
spot3.position.set(0, 3, 5); spot3.target.position.set(0, 0.5, 0);
scene.add(spot3, spot3.target);

const renderPass = new RenderPass(scene, camera);

// #endregion
// #region Passes / Composer

const resolution = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
const bloomPass = new UnrealBloomPass(resolution, 0.08, 0.1, 1.4); /* demi-resolution + seuil plus haut : le halo en gros pixels autour du texte blanc disparait */
const outputPass = new OutputPass();

/* MSAA 4x sur la cible : une seule resolution au lieu des 3 passes plein ecran du SMAA (edges, weights, blend) */
const finalRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, {
  type: lowPower ? THREE.UnsignedByteType : THREE.HalfFloatType,
  samples: lowPower ? 0 : 4,
});
const finalComposer = new EffectComposer(renderer, finalRenderTarget);
finalComposer.addPass(renderPass);
if (!lowPower) finalComposer.addPass(bloomPass);
finalComposer.addPass(outputPass);

// #endregion
// #region Base (socle bas + luminaire haut, procéduraux — mêmes cotes que la référence)

const baseMaterial = makeMaterial({
  color: 0xababab, metalness: 0.9, roughness: 0.3, sheen: 0.3, sheenRoughness: 0.2, sheenColor: 0xffffff,
  reflectivity: 1, ior: 2, envMapIntensity: 0.1,
});
applyEnvironmentTint(baseMaterial);

const base = new THREE.Group();
{
  // enfant 0 : piédestal (disque y ≈ -5.3 → -3.4, rayon 2.07)
  const bottom = new THREE.Group();
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.07, 2.07, 1.9, 96), baseMaterial);
  pedestal.position.y = -4.3;
  const pedestalRing = new THREE.Mesh(new THREE.TorusGeometry(2.07, 0.03, 12, 128), new THREE.MeshBasicMaterial({ color: 0xf4f3f6 }));
  pedestalRing.rotation.x = Math.PI / 2; pedestalRing.position.y = -3.36;
  bottom.add(pedestal, pedestalRing);
  // enfant 1 : luminaire (cloche y ≈ 3.4 → 5.4, rayon 1.87)
  const top = new THREE.Group();
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.87, 1.96, 96), baseMaterial);
  lamp.position.y = 4.4;
  const lampRing = new THREE.Mesh(new THREE.TorusGeometry(1.87, 0.04, 12, 128), new THREE.MeshBasicMaterial({ color: 0xf4f3f6 }));
  lampRing.rotation.x = Math.PI / 2; lampRing.position.y = 3.42;
  top.add(lamp, lampRing);
  base.add(bottom, top);
}
scene.add(base);

// #endregion
// #region Module Pulse (remplace can.glb : même repère — axe long = Z local, enfants tournés de +90° en X)

/* les 3 polices en PARALLELE avec une seule echeance (en serie, c'etait jusqu'a 9 s de loader) */
await Promise.race([
  Promise.all([document.fonts.load('400 100px Anton'), document.fonts.load('400 20px Geistmono'), document.fonts.load('400 20px Geist')]),
  new Promise(r => setTimeout(r, 2000)),
]).catch(() => {});

const bodyMaterial = makeMaterial({
  color: 0x0c0b12, metalness: 0.78, roughness: 0.32, sheen: 0.2, sheenRoughness: 0.3, sheenColor: 0xffffff,
  clearcoat: 0.6, clearcoatRoughness: 0.25, reflectivity: 1, ior: 2, envMapIntensity: 1.2,
});
applyEnvironmentTint(bodyMaterial);

const capMaterial = makeMaterial({ color: 0x15141c, metalness: 0.9, roughness: 0.25, clearcoat: 0.4, envMapIntensity: 1 });
applyEnvironmentTint(capMaterial);

/* Étiquette : canvas 1024×3072, portée par la face avant (et l'arrière) */
function labelTexture(p) {
  /* haute résolution : l'objet remplit l'écran sur les bénéfices, les textes doivent rester nets */
  const W = 2048, H = 6144;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0a10'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 8; g.strokeRect(140, 140, W - 280, H - 280);
  g.fillStyle = '#f4f3f6'; g.textAlign = 'center'; g.font = 'italic 210px Anton';
  g.fillText('PULSE TWEAKS', W / 2, 470);
  g.font = '78px Geistmono'; g.fillStyle = 'rgba(228,228,234,.85)';
  g.fillText(p.tag, W / 2, 600);
  g.save(); g.translate(520, H / 2 + 160); g.rotate(-Math.PI / 2);
  g.font = 'italic 620px Anton'; g.fillStyle = '#ffffff'; g.textAlign = 'center';
  g.fillText(p.name, 0, 200); g.restore();
  g.textAlign = 'left'; g.font = '600 92px Geist, Geistmono'; /* petites lignes en blanc casse : pas de brulure */
  p.lines.forEach((line, i) => {
    const y = 2760 + i * 400;
    g.fillStyle = p.css; g.fillRect(880, y - 66, 48, 48);
    g.fillStyle = '#e4e4ea';
    const parts = line.split(' / ');
    g.fillText(parts[0], 980, y);
    if (parts[1]) g.fillText(parts[1], 980, y + 118);
  });
  g.textAlign = 'center'; g.font = '66px Geistmono'; g.fillStyle = 'rgba(228,228,234,.9)';
  g.fillText('OPTIMISATION MANUELLE', W / 2, H - 520);
  g.fillText('ZÉRO RÉGLAGE INUTILE', W / 2, H - 410);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.premultiplyAlpha = false;
  return t;
}

const MOD_W = 1.35, MOD_H = 0.8, MOD_L = 4.0;
const bodyGeometry = new RoundedBoxGeometry(MOD_W, MOD_H, MOD_L, 6, 0.12); /* 8 segments : biseau lisse, sans facettes */
const capGeometry = new THREE.CylinderGeometry(0.42, 0.5, 0.22, 48);
capGeometry.rotateX(Math.PI / 2); capGeometry.translate(0, 0, MOD_L / 2 + 0.1);
const LBL_W = 1.12, LBL_L = 3.4; /* plaque d'origine (validee) */ /* = la face plane du boitier (hors biseau), a 1 cm pres */
const labelGeometry = new THREE.PlaneGeometry(LBL_W, LBL_L);
labelGeometry.rotateX(-Math.PI / 2); labelGeometry.translate(0, MOD_H / 2 + 0.006, 0);
const labelBackGeometry = new THREE.PlaneGeometry(LBL_W, LBL_L);
labelBackGeometry.rotateX(Math.PI / 2); labelBackGeometry.rotateY(Math.PI); labelBackGeometry.translate(0, -MOD_H / 2 - 0.006, 0);
const stripGeometry = new THREE.BoxGeometry(0.03, 0.06, 3.2);
stripGeometry.translate(MOD_W / 2 + 0.005, MOD_H / 2 - 0.12, 0);
const strip2Geometry = new THREE.BoxGeometry(0.03, 0.06, 3.2);
strip2Geometry.translate(-MOD_W / 2 - 0.005, -MOD_H / 2 + 0.12, 0);
const ledGeometry = new THREE.SphereGeometry(0.06, 16, 16);
ledGeometry.translate(-MOD_W / 2 + 0.2, MOD_H / 2 + 0.02, MOD_L / 2 - 0.35);

const createCan = async (p) => {
  const can = new THREE.Group();
  const texture = labelTexture(p);

  /* etiquette NON eclairee : elle s'affiche telle qu'imprimee (les spots surexposaient les petits textes, illisibles) */
  const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  const glow = new THREE.MeshBasicMaterial({ color: p.color });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial); body.name = 'Body';
  const cap = new THREE.Mesh(capGeometry, capMaterial); cap.name = 'Cap';
  const shell = new THREE.Mesh(labelGeometry, labelMaterial); shell.name = 'Shell';
  const shellBack = new THREE.Mesh(labelBackGeometry, labelMaterial); shellBack.name = 'ShellBack';
  const strip = new THREE.Mesh(stripGeometry, glow); strip.name = 'Strip';
  const strip2 = new THREE.Mesh(strip2Geometry, glow); strip2.name = 'Strip2';
  const led = new THREE.Mesh(ledGeometry, glow); led.name = 'Led';
  [body, cap, shell, shellBack, strip, strip2, led].forEach((m) => { m.rotation.x = Math.PI / 2; can.add(m); });

  scene.add(can);
  can.rotation.z = (Math.PI / 360) * 45;
  return can;
};

const duplicateCan = (item) => { const can = item.clone(); scene.add(can); return can; };

await Promise.all(PRODUCTS.map((p) => createCan(p))).then((items) => {
  items.forEach((item) => cans.push(item));
  /* le wrap de la reference place au centre le module n. cans.length/2 : cette moitie DOIT etre un multiple du nombre de produits
     (24/2 = 12 = 3 x 4 marchait par construction ; avec 5 produits : 30 clones, 15 = 3 x 5). Sinon aucun module n'est centre. */
  const targetCount = PRODUCTS.length * 2 * (lowPower ? 1 : 3);
  let i = 0;
  while (cans.length < targetCount) { cans.push(duplicateCan(cans[i % PRODUCTS.length])); i++; }
});

// #endregion
// #region Raycaster / Cursor

const raycast = new THREE.Raycaster();
on(window, 'click', (e) => {
  /* uniquement les clics sur le canvas : les fleches/pagination sont posees au centre, sinon double action */
  if (e.target !== renderer.domElement || pointer.prevent || swipe.direction != 0 || scroll.position > section.items[1].top) return;
  const mouse = new THREE.Vector2((e.clientX / renderer.domElement.clientWidth) * 2 - 1, -(e.clientY / renderer.domElement.clientHeight) * 2 + 1);
  raycast.setFromCamera(mouse, camera);
  cans.forEach((can) => {
    if (raycast.intersectObject(can).length > 0) {
      const delta = Math.round(can.position.x / carousel.spacing);
      if (delta > 0) carousel.next();
      if (delta < 0) carousel.previous();
      if (delta == 0)
        scroll.to(section.items[1].top, { duration: wheelPager.duration, lock: true, easing: easeInOut });
    }
  });
});

const isInGamme = () => scroll.position < section.items[1].top;

let hoverPending = false;
on(window, 'mousemove', (e) => {
  if (!isInGamme()) { document.body.style.cursor = ''; return; }
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => { hoverPending = false; hoverTest(e); });
});
const hoverTest = (e) => {
  if (swipe.holding && swipe.direction === 1) { document.body.style.cursor = 'grabbing'; return; }
  const mouse = new THREE.Vector2((e.clientX / renderer.domElement.clientWidth) * 2 - 1, -(e.clientY / renderer.domElement.clientHeight) * 2 + 1);
  raycast.setFromCamera(mouse, camera);
  let hoverActive = false;
  cans.forEach((can, i) => {
    if (raycast.intersectObject(can).length > 0) {
      if (i % PRODUCTS.length === carousel.index) hoverActive = true;
    }
  });
  document.body.style.cursor = hoverActive ? 'pointer' : 'grab';
};
on(window, 'mouseup touchend', () => { if (isInGamme()) document.body.style.cursor = 'grab'; });

// #endregion
// #region Sections

const section = { items: [] };
section.getIndex = () => closest(section.items, scroll.position, (item) => item.top).index;
section.previous = () => section.goTo(section.getIndex() - 1);
section.next = () => section.goTo(section.getIndex() + 1);
section.goTo = (index) => scroll.to(section.items[index % (section.items.length - 1)].top);
section.resize = () => {
  section.items.length = 0;
  let top = 0;
  document.querySelectorAll('section').forEach((el, i) => {
    const height = el.clientHeight;
    let snap = i < 2;
    if (window.innerWidth < 1024) snap = i < 6;
    section.items.push({ el, top, height, snap });
    top += height;
  });
};
section.resize();

// #endregion
// #region Swipe State

const swipe = { active: true, holding: false, startX: 0, startY: 0, lastX: 0, lastY: 0, deltaX: 0, deltaY: 0, direction: 0 };

// Défilement automatique (demande Kouro 2026-08-20 : « les produits se scrollent toutes seules, pas vite »)
const auto = { speed: reducedMotion ? 0 : 0.45, idleAfter: 3, lastInput: 0, running: false };
auto.touch = () => { auto.lastInput = performance.now() / 1000; auto.running = false; };
['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, auto.touch, { passive: true }));
const _goTo = carousel.goTo;
carousel.goTo = (index) => { auto.touch(); _goTo(index); };


// #endregion
// #region Timeline (états-clés identiques à la référence)

const data = {
  camPosX: 0, camPosY: 0, camPosZ: 29, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 20,
  canScale: 1, canPosX: 0, canPosY: 0, canPosZ: 0, canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0,
  spacing: 1, wave: 1, swirl: 0, baseOffset: 0, stack: 0,
  lightIntensity: 22, lightWidth: 1, tintStrength: 1, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1,
};
const startData = JSON.parse(JSON.stringify(data));
window.stepFx = { spin: 0, y: 0, rotZ: 0 };
const _v3 = new THREE.Vector3();
const D = Math.PI / 180;

const createTimeline = () => {
  let i = 0;
  const tl = gsap.timeline({ defaults: { ease: 'power1.inOut' } });
  /* denominateur = somme des sections (pas lenis.dimensions, remesure avec 250 ms de retard au resize) */
  const dur = () => section.items[i].height / section.total();

  // Gamme (carrousel)
  tl.to(data, { camPosX: 0, camPosY: 0, camPosZ: 6, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 40, canScale: 1, canPosX: 0.5, canPosY: -0.5, canPosZ: 0,
    canRotX: D * -37.5, canRotY: D * 15, canRotZ: D * 22.5, canSpin: 0, spacing: 3.5, wave: 0, swirl: 0, baseOffset: 3,
    lightIntensity: 14, lightWidth: 1, tintStrength: 1, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1, duration: dur() });
  i += 1;
  tl.set(swipe, { active: false });

  // Bénéfices 1-4 : caméra recule + plonge, module seul recentré qui monte section après section
  const adv = (rotZ, posY, spin) => ({ camPosX: 0, camPosY: -2, camPosZ: 12, camRotX: D * 10, camRotY: 0, camRotZ: D * rotZ, fov: 20, canScale: 1,
    canPosX: 0, canPosY: posY, canPosZ: 0, canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: D * spin, spacing: 2.2, wave: 0, swirl: 0, baseOffset: 3,
    lightIntensity: 0, lightWidth: 1, tintStrength: 0.2, spotIntensity: 35, spotY: 2.2, pointerInfluence: 0, swipeSpeed: 1 });
  /* une seule section "methode" : les 4 points defilent DANS la section (stepper), le module pivote par point via stepFx */
  tl.to(data, { ...adv(-6, -0.3, 120), duration: dur() }); i += 1;

  // Claim (« zéro réglage inutile »)
  tl.to(data, { camPosX: -3.4, camPosY: 0, camPosZ: 8, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 45, canScale: 0.7, canPosX: 0, canPosY: -1.3, canPosZ: -0.5, /* camera a gauche : le module passe a droite du texte geant (canPosX n'est pas lu sur l'axe X) */
    canRotX: D * -20, canRotY: 0, canRotZ: D * -8, canSpin: 0, spacing: 5, wave: 0, swirl: 0, baseOffset: 3,
    lightIntensity: 45, lightWidth: 1.5, tintStrength: 2, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1, duration: dur() });
  i += 1;
  tl.set(swipe, { active: true });

  // Packshot (gamme debout en diagonale, swirl)
  tl.to(data, { camPosX: -3, camPosY: -3.5, camPosZ: 20, camRotX: D * 10, camRotY: D * -9, camRotZ: D * -10, fov: 30, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: -0.4,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.47, wave: 0, swirl: 1, baseOffset: 20,
    lightIntensity: 8, lightWidth: 3, tintStrength: 1.25, /* 2 : reflet blanc qui effacait l'etiquette TIMERTUNER */ spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 2, duration: dur() });
  i += 1;

  // Couches (section signature Pulse) : les 4 modules s'empilent a gauche, BIOS en bas, reseau en haut
  const mob = window.innerWidth < 992; /* mobile : la pile se loge en haut, au-dessus du texte (colonne unique) */
  tl.to(data, { camPosX: mob ? 0 : 4.2, camPosY: mob ? -40 : 0.1, camPosZ: mob ? 74 : 29, /* mobile : pile hors champ, la liste suffit (pas la place a 390 px) */ camRotX: 0, camRotY: 0, camRotZ: 0, fov: 22, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: 0,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.47, wave: 0, swirl: 0, baseOffset: 20, stack: 1,
    lightIntensity: 0, lightWidth: 2.4, tintStrength: 1.9, spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 1, duration: dur() }); /* spots coupes : seul l'environnement eclaire, uniformement -> aucun reflet sur les etiquettes */
  i += 1;

  // Methode (bento DOM) : scene hors champ, meme etat que la FAQ
  tl.to(data, { stack: 0, camPosX: 0, camPosY: -5.5, camPosZ: 10, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 30, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: -0.4,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.6, wave: 0, swirl: 1, baseOffset: 20,
    lightIntensity: 0, lightWidth: 3, spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 1, duration: dur() });
  i += 1;

  // Hors champ (FAQ)
  tl.to(data, { stack: 0, camPosX: 0, camPosY: -5.5, camPosZ: 10, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 30, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: -0.4,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.6, wave: 0, swirl: 1, baseOffset: 20,
    lightIntensity: 0, lightWidth: 3, spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 1, duration: dur() });
  i += 1;
  tl.set(swipe, { active: false });

  // Téléport : caméra en haut
  tl.set(data, { camPosX: 0, camPosY: 8, camPosZ: 10, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 20, spacing: 5, swirl: 0, stack: 0 });

  // Retour à l'écran (footer)
  tl.to(data, { camPosX: 0, camPosY: 0, camPosZ: 29, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 20, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: 0.5,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: D * 20, spacing: 5, wave: 0, swirl: 0, baseOffset: 10,
    lightIntensity: 50, lightWidth: 1, tintStrength: 1, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1, duration: dur() });
  i += 1;

  // Boucle : retour aux valeurs initiales
  tl.to(data, { ...startData, duration: section.items[i] ? section.items[i].height / lenis.dimensions.scrollHeight : 1 });

  tl.pause();
  tl.render(0, true, true); /* fige les valeurs de depart du 1er tween sur startData, pas sur l'etat courant */
  return tl;
};

section.total = () => section.items.reduce((sum, it) => sum + it.height, 0);
let timeline = createTimeline();
const rebuildTimeline = () => {
  section.resize();
  if (timeline) timeline.kill();
  Object.assign(data, startData);
  timeline = createTimeline();
  timeline.seek(scroll.position / (window.QA_H || section.total()), false);
};

// #endregion
// #region Loader

const loader = { complete: false, timeline: null, callbacks: [], ended: signal() };

loader.play = async () => {
  if (loader.timeline) loader.timeline.kill();
  lenis.scrollTo(0, { immediate: true });
  lenis.stop();
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  animation.paused = true;
  swipe.active = false;
  pointer.prevent = true;

  const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.8 } });
  carousel.target = carousel.offset;
  carousel.position = carousel.offset;
  tl.set(data, { camPosZ: 25, spacing: 10, baseOffset: 3, wave: 0, swirl: 0, lightWidth: 2, lightIntensity: 0, canSpin: D * 20, pointerInfluence: 0 });
  tl.to(data, { lightIntensity: 14 }, 0);
  tl.to(data, { camPosZ: 29 }, 0.6);
  tl.to(data, startData, 1.2); /* intro : 3,0 s au lieu de 3,8 (la page n'est pilotable qu'a la fin) */
  loader.timeline = tl;

  const animMs = Math.max(tl.duration() * 1000, 1800);
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    tl.eventCallback('onComplete', finish);
    setTimeout(finish, animMs);
  });

  lenis.start();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  pointer.prevent = false;
  swipe.active = true;
  animation.paused = false;
  loopGuard.lastPos = scroll.position;
  loopGuard.snapping = false;
  auto.lastInput = performance.now() / 1000 - auto.idleAfter; /* démarre tout de suite après l'intro */
  loader.ended.emit();
};

// #endregion
// #region Animation

const animation = { paused: false };
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; }, false);
renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; }, false);

const loopGuard = { lastPos: 0, snapping: false, timer: null };

let time = 0;
function animate(tick = 0) {
  var delta = Math.min(tick / 1000 - time, 1 / 30); /* borne : au retour d'onglet, 60 s de delta faisaient sauter le carrousel */
  requestAnimationFrame(animate);
  time = tick / 1000;

  if (lenis.targetScroll < 0) {
    lenis.targetScroll = 0;
    lenis.animatedScroll = 0;
    if (lenis.animate) lenis.animate.to = 0;
  }
  lenis.raf(time * 1000);
  if (window.QA_POS !== undefined) scroll.position = window.QA_POS;

  {
    const total = lenis.dimensions.scrollHeight - lenis.dimensions.height;
    const prev = loopGuard.lastPos;
    const cur = scroll.position;
    if (pointer.prevent) loopGuard.lastPos = cur;
    else {
      if (total > 0 && prev - cur > total * 0.6 && !loopGuard.snapping) {
        loopGuard.snapping = true;
        scroll.to(section.items[0].top, { duration: 1.2, lock: true, easing: easeInOut });
        clearTimeout(loopGuard.timer);
        loopGuard.timer = setTimeout(() => (loopGuard.snapping = false), 1300);
      }
      loopGuard.lastPos = cur;
    }
  }

  const minX = cans.length * -0.5 * carousel.spacing;
  const maxX = cans.length * 0.5 * carousel.spacing;

  carousel.target -= swipe.deltaX * 0.02 * data.swipeSpeed;
  swipe.deltaX = 0;

  pointer.smoothX = lerp(pointer.smoothX, pointer.x, delta * 10);
  pointer.smoothY = lerp(pointer.smoothY, pointer.y, delta * 10);

  if (!animation.paused) {
    const idle = time - auto.lastInput > auto.idleAfter;
    const onHome = section.items.length > 1 && scroll.position < section.items[1].top * 0.5;
    auto.running = idle && onHome && !swipe.holding && !pointer.prevent;
    if (auto.running) {
      /* derive lente ; position lissee (et non collee a la cible) : un clic recu pendant l'intro ne fait plus sauter la rangee */
      carousel.target += auto.speed * delta;
      carousel.position = lerp(carousel.position, carousel.target, Math.min(1, delta * 10));
    } else {
      if (!swipe.holding) carousel.target = carousel.getRounded(carousel.target);
      carousel.position = lerp(carousel.position, carousel.target, delta * 10);
    }
  }

  camera.fov = data.fov;
  camera.updateProjectionMatrix();

  carousel.delta = carousel.position - carousel.lastPosition;
  const index = carousel.getIndex();
  if (index !== carousel.lastIndex) {
    carousel.changed.emit({ index, previous: carousel.lastIndex });
    carousel.lastIndex = index;
  }
  carousel.index = index;

  const p0 = clamp(scroll.distanceTo(0) / section.items[0].height, 0, 1);
  timeline.seek(scroll.position / (window.QA_H || section.total())); /* somme des sections : independant des remesures Lenis */

  const windowRatio = clamp(1440 / lenis.dimensions.scrollWidth, 1, 2.4);
  const wave = windowRatio * 0.25 * (1 - p0) * data.wave;

  cans.forEach((can, i) => {
    var target = i * carousel.spacing - carousel.position;
    const x = wrap(target, minX, maxX);

    let p = clamp(1 - Math.abs(x) / carousel.spacing, 0, 1);
    const p1 = Math.min(p, p0);
    let canScale = 1.2;
    let canPosX = x * data.spacing;
    let canPosY = Math.sin(canPosX * wave);
    let canPosZ = (Math.abs(x) * -1 - 0.2) * data.wave;
    let canRotX = (-Math.PI / 180) * 20 * data.wave;
    let canRotY = (canPosX * 0.5 - (Math.PI / 180) * 20) * data.wave;
    let canRotZ = (Math.PI / 360) * 22.5 * data.wave;

    canRotX = lerp(canRotX, x * 0.06 * windowRatio + 0.2, data.swirl);

    canScale = lerp(canScale, data.canScale, p0);
    canPosY = lerp(canPosY, data.canPosY, p0);
    canPosZ = lerp(canPosZ, data.canPosZ, p0);
    canRotX = canRotX + data.canRotX;
    canRotY = lerp(canRotY, data.canRotY, p1);
    canRotZ = lerp(canRotZ, data.canRotZ, p1);

    if (data.stack > 0) {
      /* empilement : cans[k] (k < 4) = un produit chacun, les clones s'effacent ; la couche active s'avance */
      const k = i % PRODUCTS.length, sst = data.stack;
      const gap = 1.5; /* ecart entre couches : on voit chaque module en entier */
      const sy = (k - (PRODUCTS.length - 1) / 2) * gap + data.canPosY;
      const active = i < PRODUCTS.length && (k === carousel.index || (window.stackHighlight && window.stackHighlight.has(k)));
      /* la couche active s'avance, grossit et bascule vers la camera (en douceur, lerp par module) */
      can.userData.lift = lerp(can.userData.lift || 0, active ? 1 : 0, Math.min(1, delta * 7));
      const L = can.userData.lift;
      canPosX = lerp(canPosX, data.canPosX + L * 0.35, sst);
      canPosY = lerp(canPosY, sy, sst);
      canPosZ = lerp(canPosZ, data.canPosZ + L * 1.6, sst);
      canScale = lerp(canScale, 1 + L * 0.08, sst);
      canRotX = lerp(canRotX, 0, sst); /* pas de bascule : inclinee vers le spot, l'etiquette se couvrait d'un reflet blanc illisible */
      canRotY = lerp(canRotY, 0, sst);
      canRotZ = lerp(canRotZ, -Math.PI / 2, sst); /* -90 : l'etiquette se lit a l'endroit (a +90 elle est retournee) */
      if (i >= PRODUCTS.length) canScale = lerp(canScale, 0.0001, sst);
    }

    if (p0 >= 1 && data.stack === 0 && data.swirl === 0) { canPosY += window.stepFx.y * p; canRotZ += window.stepFx.rotZ * p; }

    can.position.set(canPosX, canPosY, canPosZ);
    can.rotation.set(canRotX, canRotY, canRotZ);
    can.scale.setScalar(canScale);

    can.rotation.y += (pointer.smoothX / 1280) * data.pointerInfluence * p;
    can.rotation.x += (pointer.smoothY / 1280) * data.pointerInfluence * p;

    can.children.forEach((child) => {
      if (child.isMesh) child.rotation.z = (can.rotation.y * 0.6 + (data.canSpin + window.stepFx.spin) * p) * (1 - data.stack);
    });
  });

  base.children[0].position.y = -1 * data.baseOffset;
  base.children[1].position.y = 1 * data.baseOffset;

  camera.position.set(data.camPosX, data.camPosY, data.camPosZ);
  camera.rotation.set(data.camRotX, data.camRotY, data.camRotZ);

  spot1.intensity = data.lightIntensity;
  spot1.angle = (Math.PI / 4) * data.lightWidth;
  spot2.intensity = data.lightIntensity;
  spot2.angle = (Math.PI / 4) * data.lightWidth;
  spot3.intensity = data.spotIntensity;
  spot3.position.set(0, data.spotY, 2);
  spot3.target.position.set(0, data.spotY - 2.5, 0);

  tint.strength.value = data.tintStrength;

  /* points chauds de la section methode : coordonnees locales du module central projetees a l'ecran */
  if (window.hotspots && window.hotspots.active) {
    const center = cans[Math.floor(cans.length / 2)];
    const W = window.innerWidth, H = window.innerHeight;
    window.hotspots.items.forEach((hs) => {
      _v3.set(hs.local[0], hs.local[1], hs.local[2]).applyMatrix4(center.matrixWorld).project(camera);
      hs.el.style.transform = 'translate(' + ((_v3.x + 1) / 2 * W).toFixed(1) + 'px,' + ((1 - _v3.y) / 2 * H).toFixed(1) + 'px)';
      hs.el.style.opacity = _v3.z < 1 ? 1 : 0;
    });
    window.stepFx.spin = Math.sin(time * 0.7) * 0.18; /* oscillation douce : le module "respire", invite a explorer */
  } else if (window.stepFx) window.stepFx.spin = lerp(window.stepFx.spin, 0, Math.min(1, delta * 4));

  if (!contextLost) finalComposer.render();
  carousel.lastPosition = carousel.position;
  if (fpsMeter) fpsMeter.tick(tick);
}

/* ?fps=1 : compteur en haut a gauche (FPS sur 1 s, minimum sur 5 s, DPR, resolution) — pour mesurer sur un vrai GPU */
const fpsMeter = new URLSearchParams(location.search).has('fps') ? (() => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.7);padding:6px 10px;border-radius:6px;pointer-events:none';
  document.body.appendChild(el);
  let frames = 0, last = 0, minFps = 999, since = 0;
  return { tick(t) {
    frames++;
    if (t - last >= 1000) {
      const fps = Math.round(frames * 1000 / (t - last)); frames = 0; last = t;
      if (t - since > 5000) { minFps = fps; since = t; } else minFps = Math.min(minFps, fps);
      el.textContent = fps + ' fps (min 5 s : ' + minFps + ') · ' + window.innerWidth + 'x' + window.innerHeight + ' · DPR ' + pixelRatio.toFixed(2);
    }
  } };
})() : null;

// #endregion
// #region Pointer / Swipe

const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, smoothX: window.innerWidth / 2, smoothY: window.innerHeight / 2, prevent: true };

const blockScrollWhilePrevented = (e) => { if (pointer.prevent) { e.preventDefault(); e.stopPropagation(); } };
window.addEventListener('wheel', blockScrollWhilePrevented, { passive: false, capture: true });
window.addEventListener('touchmove', blockScrollWhilePrevented, { passive: false, capture: true });
on(window, 'mousemove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

on(renderer.domElement, 'mousedown touchstart', (e) => {
  if (!swipe.active || pointer.prevent) return;
  swipe.holding = true;
  swipe.deltaX = 0;
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  swipe.startX = x; swipe.lastX = x; swipe.startY = y; swipe.lastY = y;
});
on(window, 'mousemove touchmove', (e) => {
  if (!swipe.active || !swipe.holding || pointer.prevent) return;
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  const deltaX = x - swipe.lastX;
  const deltaY = y - swipe.lastY;
  if (swipe.direction == 0) {
    if (Math.abs(swipe.startX - x) > 2 || Math.abs(swipe.startY - y) > 2) swipe.direction = Math.abs(deltaX) > Math.abs(deltaY) ? 1 : 2;
  }
  if (swipe.direction == 1) {
    swipe.lastX = x;
    swipe.deltaX += deltaX;
    lenis.stop();
    if (e.touches) document.body.style.overflow = 'hidden';
  }
});
on(window, 'mouseup touchend', () => {
  if (!swipe.holding) return;
  setTimeout(() => {
    swipe.deltaX = clamp(swipe.deltaX * 8, -90, 90); /* 90 x 0.02 = 1.8 < 3.5 : un geste deplace au plus d'un produit */
    swipe.holding = false;
    swipe.direction = 0;
    lenis.start();
    document.body.style.overflow = '';
  });
});

// #endregion
// #region Mobile Paging

const paging = { startX: 0, startY: 0, anchor: 0, axis: 0, active: false, threshold: 24, lastSnap: 5 };
const isMobile = () => window.innerWidth < 1024;

on(window, 'touchstart', (e) => {
  if (!isMobile() || pointer.prevent) return;
  paging.startX = e.touches[0].clientX;
  paging.startY = e.touches[0].clientY;
  paging.axis = 0;
  paging.anchor = closest(section.items, scroll.position, (item) => item.top).index;
  paging.active = paging.anchor <= paging.lastSnap;
});
window.addEventListener('touchmove', (e) => {
  if (!isMobile() || pointer.prevent || !paging.active) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  if (paging.axis === 0) {
    const dx = Math.abs(x - paging.startX), dy = Math.abs(y - paging.startY);
    if (dx > 2 || dy > 2) paging.axis = dx > dy ? 1 : 2;
  }
  if (paging.axis === 2) { e.preventDefault(); lenis.stop(); }
}, { passive: false });
on(window, 'touchend', (e) => {
  if (!isMobile() || pointer.prevent || !paging.active || paging.axis !== 2) return;
  const endY = (e.changedTouches && e.changedTouches[0].clientY) || paging.startY;
  const delta = endY - paging.startY;
  let target = paging.anchor;
  if (Math.abs(delta) > paging.threshold) target = paging.anchor + (delta < 0 ? 1 : -1);
  target = clamp(target, 0, section.items.length - 1);
  lenis.start();
  scroll.to(section.items[target].top, { duration: 1.5, easing: easeInOut });
  paging.active = false;
  paging.axis = 0;
});

// #endregion
// #region Desktop Paging (1 cran de molette = 1 section)

/* Passage de section : courbe entree-sortie (demarrage doux, arrivee douce) au lieu du cubique sortant
   qui partait brutalement ; duree unique ; un COOLDOWN et un filtre de geste : l'inertie d'un trackpad
   envoie des dizaines d'evenements decroissants apres le geste, qui relancaient un 2e saut. */
const wheelPager = { locked: false, lastSnap: 6, duration: 1.2, cooldown: 220, lastTime: 0, lastDelta: 0 };
window.sectionChanged = signal();
let wheelTimer;
window.addEventListener('wheel', (e) => {
  if (pointer.prevent) return;
  const anchor = closest(section.items, scroll.position, (item) => item.top).index;
  const dirNow = e.deltaY > 0 ? 1 : -1;
  if (anchor > wheelPager.lastSnap) {
    /* zone libre (FAQ, avis) : on ne reprend la main que pour REMONTER vers la pile depuis le haut de la FAQ */
    const faqTop = section.items[wheelPager.lastSnap + 1].top;
    if (!(dirNow < 0 && scroll.position <= faqTop + 60)) return;
  }
  e.preventDefault();
  const now = performance.now();
  const d = Math.abs(e.deltaY);
  /* nouveau geste = pause > 90 ms OU delta qui remonte franchement ; sinon c'est la traine du geste precedent */
  const fresh = now - wheelPager.lastTime > 90 || d > wheelPager.lastDelta * 1.6;
  wheelPager.lastTime = now; wheelPager.lastDelta = d;
  if (wheelPager.locked || !fresh) return;
  if (d < 4) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const off = scroll.position - section.items[anchor].top;
  let target = clamp(anchor + dir, 0, section.items.length - 1);
  /* page desalignee (scroll libre, clavier) : le 1er cran recale sur la section la plus proche dans le sens du geste */
  if (Math.abs(off) > 40) target = (dir < 0 && off > 0) || (dir > 0 && off < 0) ? anchor : target;
  if (target === anchor && Math.abs(off) <= 40) return;
  const duration = wheelPager.duration;
  wheelPager.locked = true;
  scroll.to(section.items[target].top, { duration, lock: true, easing: easeInOut });
  window.sectionChanged.emit({ from: anchor, to: target });
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => (wheelPager.locked = false), duration * 1000 + wheelPager.cooldown);
}, { passive: false });

// #region Clavier (1 touche = 1 section, coherent avec la molette)

window.addEventListener('keydown', (e) => {
  if (pointer.prevent || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = document.activeElement?.tagName || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
  if ((e.key === ' ' || e.key === 'Enter') && /^(BUTTON|A)$/.test(tag)) return; /* activation native du bouton focalise */
  const anchor = closest(section.items, scroll.position, (item) => item.top).index;
  const last = section.items.length - 3; /* la FAQ est la derniere section navigable */
  /* zone libre (FAQ, avis, pied de page) : le clavier defile nativement, on ne bloque rien */
  if (anchor >= last && ['ArrowDown', 'PageDown', ' ', 'End'].includes(e.key)) return;
  let target = null;
  if (['ArrowDown', 'PageDown', ' '].includes(e.key)) target = Math.min(anchor + 1, last);
  if (['ArrowUp', 'PageUp'].includes(e.key)) target = Math.max(anchor - 1, 0);
  if (e.key === 'Home') target = 0;
  if (e.key === 'End') target = last;
  if (e.key === 'ArrowLeft' && anchor === 0) { carousel.previous(); e.preventDefault(); return; }
  if (e.key === 'ArrowRight' && anchor === 0) { carousel.next(); e.preventDefault(); return; }
  if (target === null || target === anchor || wheelPager.locked) { if (target !== null) e.preventDefault(); return; }
  e.preventDefault();
  wheelPager.locked = true;
  const far = Math.abs(target - anchor) > 1;
  const duration = far ? 1.8 : wheelPager.duration;
  /* saut lointain (End/Home) : Lenis infini prendrait le chemin le plus court a REBOURS, que le clamp anti-negatif bloque a 0.
     On coupe l'infini le temps du trajet : la page descend/remonte vraiment. */
  const opts = { duration, lock: true, easing: easeInOut };
  if (far) {
    const inf = lenis.options.infinite; lenis.options.infinite = false;
    loopGuard.snapping = true; clearTimeout(loopGuard.timer);
    loopGuard.timer = setTimeout(() => { loopGuard.snapping = false; lenis.options.infinite = inf; }, duration * 1000 + 250);
    opts.onComplete = () => { lenis.options.infinite = inf; };
  }
  scroll.to(section.items[target].top, opts);
  window.sectionChanged.emit({ from: anchor, to: target });
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => (wheelPager.locked = false), duration * 1000 + wheelPager.cooldown);
});

// #endregion
// #region Resize / Start

animate();

let lastResizeWidth = window.innerWidth;
const coarse = matchMedia('(pointer: coarse)').matches;
on(window, 'resize', () => {
  /* sur tactile, la barre d'URL change la hauteur en permanence : on n'y reagit qu'a la largeur ; sur desktop, toute resize compte */
  if (coarse && window.innerWidth === lastResizeWidth) return;
  lastResizeWidth = window.innerWidth;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  pixelRatio = computePixelRatio();
  renderer.setPixelRatio(pixelRatio);
  finalComposer.setPixelRatio(pixelRatio);
  finalComposer.setSize(window.innerWidth, window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
  rebuildTimeline();
});
/* le contenu change de hauteur (accordeon FAQ, polices) : la timeline suit */
if (window.ResizeObserver) new ResizeObserver(debounce(() => { if (!pointer.prevent) rebuildTimeline(); }, 300)).observe(document.querySelector('.page-wrapper'));

lenis.scrollTo(0, { immediate: true });
window.loader = loader;

// Indicateur de progression (barre du haut)
const indicator = { el: document.querySelector('.scroll_indicator'), set: null };
if (indicator.el) {
  gsap.set(indicator.el, { '--p': 0 });
  indicator.set = gsap.quickTo(indicator.el, '--p', { duration: 0.3, ease: 'power3.out' });
  lenis.on('scroll', () => {
    const max = lenis.dimensions.scrollHeight - lenis.dimensions.height;
    indicator.set(max > 0 ? scroll.position / max : 0);
  });
}

/* Mode QA (captures headless) : ?seek=<index de section> place la page sur une section sans animation */
{
  const q = new URLSearchParams(location.search).get('seek');
  if (q !== null) {
    const idx = clamp(parseInt(q, 10) || 0, 0, section.items.length - 1);
    window.QA_POS = section.items[idx].top;
    window.QA_H = lenis.dimensions.scrollHeight;
    auto.lastInput = Infinity; /* captures deterministes : pas de derive auto */
    pointer.prevent = false; swipe.active = true; animation.paused = false;
    carousel.target = carousel.getRounded(); carousel.position = carousel.target;
    loopGuard.lastPos = window.QA_POS;
    window.dispatchEvent(new CustomEvent('pulse:qa', { detail: { pos: window.QA_POS, idx } }));
    /* sonde QA : lire l'etat reel du moteur depuis une page de test */
    window.__dbg = { get data() { return data; }, get timeline() { return timeline; }, get section() { return section; }, get scroll() { return scroll; }, get lenis() { return lenis; }, get pixelRatio() { return pixelRatio; }, get cans() { return cans.map((c) => [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2), +c.scale.x.toFixed(2)]); }, get contextLost() { return contextLost; } };
  }
}

window.__sceneReady = true; /* le module peut finir AVANT DOMContentLoaded (await de haut niveau) : flag pour les retardataires */
window.dispatchEvent(new CustomEvent('carousel:ready', { detail: carousel }));

// #endregion
