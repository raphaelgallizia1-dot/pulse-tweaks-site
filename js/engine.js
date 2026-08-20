/* Pulse Tweaks — moteur 3D + scroll.
   Structure reprise du moteur Ciao Energy (Three.js 0.161 + Lenis infini + timeline GSAP scrubée,
   10 états, pager molette, swipe, loader, garde-fou de boucle). Seuls changent : l'objet (module Pulse
   procédural au lieu de la canette GLB), les étiquettes (canvas), le socle (procédural) et l'environnement. */

import Lenis from 'https://cdn.jsdelivr.net/npm/lenis@1.3.23/dist/lenis.mjs';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
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

// #endregion Device Profile
// #region Setup

const lenis = new Lenis({ autoRaf: false, infinite: true, syncTouch: true });
window.lenis = lenis;

// #endregion Setup
// #region Scroll

const scroll = { position: 0 };
scroll.wrapped = (position) => wrap(position, 0, lenis.dimensions.scrollHeight - lenis.dimensions.height);
scroll.to = (pos, options) => { if (pos !== 0) pos -= 10; lenis.scrollTo(pos, options); };
scroll.distanceTo = (target, position = scroll.position) => {
  const min = position;
  const max = position - lenis.dimensions.scrollHeight + lenis.dimensions.height;
  if (Math.abs(max - target) < Math.abs(min - target)) return Math.abs(max - target);
  return Math.abs(min - target);
};
lenis.on('scroll', () => { scroll.position = scroll.wrapped(lenis.animatedScroll); });
scroll.snap = (position = scroll.position) => {
  if (window.innerWidth < 1024) return;
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
  offset: PRODUCTS.length % 2 === 0 ? 0 : 1.5,
};
carousel.getRounded = () => round(carousel.target + carousel.offset, carousel.spacing) - carousel.offset;
carousel.getIndex = (wrapped = true) => {
  const index = round((carousel.position + carousel.offset) / carousel.spacing, 1);
  if (wrapped) return wrap(index, 0, PRODUCTS.length);
  return index;
};
carousel.goTo = (index) => { carousel.target = index * carousel.spacing - carousel.offset; };
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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
let pixelRatio = lowPower ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1.25);
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

const resolution = new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5);
const bloomPass = new UnrealBloomPass(resolution, 0.1, 0.1, 1);
const smaaPass = new SMAAPass();
const outputPass = new OutputPass();

const finalRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, {
  type: lowPower ? THREE.UnsignedByteType : THREE.HalfFloatType,
  samples: 0,
});
const finalComposer = new EffectComposer(renderer, finalRenderTarget);
finalComposer.addPass(renderPass);
if (!lowPower) finalComposer.addPass(bloomPass);
finalComposer.addPass(outputPass);
if (!lowPower) finalComposer.addPass(smaaPass);

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

/* Polices de l'étiquette : Archivo large (comme le packaging de Kouro), Geist pour les petits textes */
for (const f of ['italic 900 expanded 100px Archivo', '700 expanded 100px Archivo', '300 20px Geist', '400 20px Geistmono']) {
  await Promise.race([document.fonts.load(f), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
}

/* Boîte noire mate (référence : packshot Pulse Tweaks fourni par Kouro le 2026-08-20) */
const bodyMaterial = makeMaterial({
  color: 0x0a0a0c, metalness: 0.0, roughness: 0.8, sheen: 0, sheenRoughness: 1, sheenColor: 0x000000,
  clearcoat: 0.03, clearcoatRoughness: 0.7, reflectivity: 0.3, ior: 1.4, envMapIntensity: 0.35,
});
applyEnvironmentTint(bodyMaterial);

const SPLIT = { bios: ['BIOS', 'TUNER'], os: ['PULSE', 'OS'], timer: ['TIMER', 'TUNER'], flux: ['FLUX', 'TUNER'] };
const TAGLINE = {
  bios: ['TUNE THE BIOS.', 'UNLOCK THE HARDWARE.'],
  os: ['CLEAN SYSTEM.', 'PURE PERFORMANCE.'],
  timer: ['REDUCE DELAY.', 'GAIN ADVANTAGE.'],
  flux: ['STABLE PING.', 'ZERO PACKET LOSS.'],
};

/* logo « PULSE ∿ TWEAKS » */
function drawLogo(g, cx, cy, size, color) {
  g.save();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 expanded ${size}px Archivo`;
  g.fillText('PULSE', cx - size * 0.55, cy);
  g.fillText('TWEAKS', cx, cy + size * 1.15);
  const x0 = cx + size * 1.35, w = size * 1.1, y = cy;
  g.strokeStyle = color; g.lineWidth = Math.max(2, size * 0.07); g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x0, y); g.lineTo(x0 + w * 0.2, y); g.lineTo(x0 + w * 0.32, y - size * 0.45); g.lineTo(x0 + w * 0.5, y + size * 0.5);
  g.lineTo(x0 + w * 0.64, y - size * 0.25); g.lineTo(x0 + w * 0.74, y); g.lineTo(x0 + w, y);
  g.stroke();
  g.restore();
}

/* Face avant / arrière : canvas 1024 × 3386 (ratio 1.3 : 4.3) */
function labelTexture(p) {
  const W = 1024, H = 3386;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, W, H);
  drawLogo(g, W / 2, 300, 78, '#f2f2f2');
  const [w1, w2] = SPLIT[p.key] || [p.name, ''];
  g.save(); g.translate(W / 2, H / 2 + 60); g.rotate(-Math.PI / 2);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = 'italic 900 expanded 330px Archivo';
  g.fillText(w1, 0, -40);
  g.fillText(w2, 0, 290);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(290, H - 470, W - 580, 2);
  g.fillStyle = '#e8e8e8'; g.textAlign = 'center'; g.font = '300 44px Geist';
  const [t1, t2] = TAGLINE[p.key] || ['', ''];
  const spaced = (t) => t.split('').join('\u200A');
  g.fillText(spaced(t1), W / 2, H - 370);
  g.fillText(spaced(t2), W / 2, H - 300);
  g.fillStyle = p.css; g.beginPath(); g.arc(W / 2, H - 215, 9, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/* Tranches : nom vertical discret + filet, comme le packaging */
function sideTexture(p) {
  const W = 496, H = 3386;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, W, H);
  const [w1, w2] = SPLIT[p.key] || [p.name, ''];
  g.save(); g.translate(W / 2, 560); g.rotate(-Math.PI / 2);
  g.fillStyle = '#e8e8e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 expanded 58px Archivo';
  g.fillText(w1, 0, -42); g.fillText(w2, 0, 42);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(W / 2 - 1, 900, 2, 1500);
  g.fillStyle = p.css; g.fillRect(W / 2 - 1, 2400, 2, 260);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/* Géométrie : boîte élancée (même repère que la canette : axe long = Z local) */
const MOD_W = 1.3, MOD_H = 0.62, MOD_L = 4.3;
const bodyGeometry = new RoundedBoxGeometry(MOD_W, MOD_H, MOD_L, 3, 0.035);
const E = 0.004;
const labelGeometry = new THREE.PlaneGeometry(MOD_W - 0.07, MOD_L - 0.07);
labelGeometry.rotateX(-Math.PI / 2); labelGeometry.translate(0, MOD_H / 2 + E, 0);
const labelBackGeometry = new THREE.PlaneGeometry(MOD_W - 0.07, MOD_L - 0.07);
labelBackGeometry.rotateX(Math.PI / 2); labelBackGeometry.rotateY(Math.PI); labelBackGeometry.translate(0, -MOD_H / 2 - E, 0);
const sideRGeometry = new THREE.PlaneGeometry(MOD_H - 0.07, MOD_L - 0.07);
sideRGeometry.rotateX(-Math.PI / 2); sideRGeometry.rotateZ(-Math.PI / 2); sideRGeometry.translate(MOD_W / 2 + E, 0, 0);
const sideLGeometry = new THREE.PlaneGeometry(MOD_H - 0.07, MOD_L - 0.07);
sideLGeometry.rotateX(-Math.PI / 2); sideLGeometry.rotateZ(Math.PI / 2); sideLGeometry.translate(-MOD_W / 2 - E, 0, 0);

const createCan = async (p) => {
  const can = new THREE.Group();
  const labelMaterial = makeMaterial({
    color: 0xffffff, metalness: 0.0, roughness: 0.78, sheen: 0, sheenRoughness: 1, sheenColor: 0x000000,
    clearcoat: 0.03, clearcoatRoughness: 0.7, reflectivity: 0.3, ior: 1.4, map: labelTexture(p), envMapIntensity: 0.35,
  });
  applyEnvironmentTint(labelMaterial);
  const sideMaterial = labelMaterial.clone(); sideMaterial.map = sideTexture(p);
  applyEnvironmentTint(sideMaterial);

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial); body.name = 'Body';
  const shell = new THREE.Mesh(labelGeometry, labelMaterial); shell.name = 'Shell';
  const shellBack = new THREE.Mesh(labelBackGeometry, labelMaterial); shellBack.name = 'ShellBack';
  const sideR = new THREE.Mesh(sideRGeometry, sideMaterial); sideR.name = 'SideR';
  const sideL = new THREE.Mesh(sideLGeometry, sideMaterial); sideL.name = 'SideL';
  [body, shell, shellBack, sideR, sideL].forEach((m) => { m.rotation.x = Math.PI / 2; can.add(m); });

  scene.add(can);
  can.rotation.z = (Math.PI / 360) * 45;
  return can;
};

const duplicateCan = (item) => { const can = item.clone(); scene.add(can); return can; };

await Promise.all(PRODUCTS.map((p) => createCan(p))).then((items) => {
  items.forEach((item) => cans.push(item));
  const targetCount = lowPower ? 12 : 24;
  let i = 0;
  while (cans.length < targetCount) { cans.push(duplicateCan(cans[i % PRODUCTS.length])); i++; }
});

// #endregion
// #region Raycaster / Cursor

const raycast = new THREE.Raycaster();
on(window, 'click', (e) => {
  if (pointer.prevent || swipe.direction != 0 || scroll.position > section.items[1].top) return;
  const mouse = new THREE.Vector2((e.clientX / renderer.domElement.clientWidth) * 2 - 1, -(e.clientY / renderer.domElement.clientHeight) * 2 + 1);
  raycast.setFromCamera(mouse, camera);
  cans.forEach((can) => {
    if (raycast.intersectObject(can).length > 0) {
      const delta = Math.round(can.position.x / carousel.spacing);
      if (delta > 0) carousel.next();
      if (delta < 0) carousel.previous();
      if (delta == 0)
        scroll.to(section.items[1].top, {
          duration: wheelPager.slowIndexes.includes(0) ? wheelPager.durationSlow : wheelPager.durationFast,
          easing: (t) => 1 - Math.pow(1 - t, 3),
        });
    }
  });
});

const isInGamme = () => scroll.position < section.items[1].top;

on(window, 'mousemove', (e) => {
  if (!isInGamme()) { document.body.style.cursor = ''; return; }
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
});
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

// #endregion
// #region Timeline (états-clés identiques à la référence)

const data = {
  camPosX: 0, camPosY: 0, camPosZ: 29, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 20,
  canScale: 1, canPosX: 0, canPosY: 0, canPosZ: 0, canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0,
  spacing: 1, wave: 1, swirl: 0, baseOffset: 0,
  lightIntensity: 50, lightWidth: 1, tintStrength: 1, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1,
};
const startData = JSON.parse(JSON.stringify(data));
const D = Math.PI / 180;

const createTimeline = () => {
  let i = 0;
  const tl = gsap.timeline({ defaults: { ease: 'power1.inOut' } });
  const dur = () => section.items[i].height / lenis.dimensions.scrollHeight;

  // Gamme (carrousel)
  tl.to(data, { camPosX: 0, camPosY: 0, camPosZ: 6, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 40, canScale: 1, canPosX: 0.5, canPosY: -0.5, canPosZ: 0,
    canRotX: D * -37.5, canRotY: D * 15, canRotZ: D * 22.5, canSpin: 0, spacing: 3.5, wave: 0, swirl: 0, baseOffset: 3,
    lightIntensity: 30, lightWidth: 1, tintStrength: 1, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1, duration: dur() });
  i += 1;
  tl.set(swipe, { active: false });

  // Bénéfices 1-4 : caméra recule + plonge, module seul recentré qui monte section après section
  const adv = (rotZ, posY, spin) => ({ camPosX: 0, camPosY: -2, camPosZ: 12, camRotX: D * 10, camRotY: 0, camRotZ: D * rotZ, fov: 20, canScale: 1,
    canPosX: 0, canPosY: posY, canPosZ: 0, canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: D * spin, spacing: 2.2, wave: 0, swirl: 0, baseOffset: 3,
    lightIntensity: 0, lightWidth: 1, tintStrength: 0.2, spotIntensity: 35, spotY: 2.2, pointerInfluence: 0, swipeSpeed: 1 });
  tl.to(data, { ...adv(-10, -0.8, 120), duration: dur() }); i += 1;
  tl.to(data, { ...adv(5, -0.48, 130), duration: dur() }); i += 1;
  tl.to(data, { ...adv(-10, 0.02, 120), duration: dur() }); i += 1;
  tl.to(data, { ...adv(5, 0.5, 130), duration: dur() }); i += 1;

  // Claim (« zéro réglage inutile »)
  tl.to(data, { camPosX: 0, camPosY: 0, camPosZ: 8, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 45, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: -0.5,
    canRotX: D * -20, canRotY: 0, canRotZ: D * -5, canSpin: 0, spacing: 5, wave: 0, swirl: 0, baseOffset: 3,
    lightIntensity: 45, lightWidth: 1.5, tintStrength: 2, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1, duration: dur() });
  i += 1;
  tl.set(swipe, { active: true });

  // Packshot (gamme debout en diagonale, swirl)
  tl.to(data, { camPosX: -3, camPosY: -3.5, camPosZ: 20, camRotX: D * 10, camRotY: D * -9, camRotZ: D * -10, fov: 30, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: -0.4,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.47, wave: 0, swirl: 1, baseOffset: 20,
    lightIntensity: 10, lightWidth: 3, tintStrength: 2, spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 2, duration: dur() });
  i += 1;

  // Hors champ (FAQ)
  tl.to(data, { camPosX: 0, camPosY: -5.5, camPosZ: 10, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 30, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: -0.4,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.6, wave: 0, swirl: 1, baseOffset: 20,
    lightIntensity: 0, lightWidth: 3, spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 1, duration: dur() });
  i += 1;
  tl.set(swipe, { active: false });

  // Téléport : caméra en haut
  tl.set(data, { camPosX: 0, camPosY: 8, camPosZ: 10, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 20, spacing: 5, swirl: 0 });

  // Retour à l'écran (footer)
  tl.to(data, { camPosX: 0, camPosY: 0, camPosZ: 29, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 20, canScale: 1, canPosX: 0, canPosY: 0, canPosZ: 0.5,
    canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: D * 20, spacing: 5, wave: 0, swirl: 0, baseOffset: 10,
    lightIntensity: 50, lightWidth: 1, tintStrength: 1, spotIntensity: 0, spotY: 3, pointerInfluence: 0.2, swipeSpeed: 1, duration: dur() });
  i += 1;

  // Boucle : retour aux valeurs initiales
  tl.to(data, { ...startData, duration: section.items[i] ? section.items[i].height / lenis.dimensions.scrollHeight : 1 });

  tl.pause();
  return tl;
};

let timeline = createTimeline();

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

  const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 2.5 } });
  carousel.target = carousel.offset;
  carousel.position = carousel.offset;
  tl.set(data, { camPosZ: 25, spacing: 10, baseOffset: 3, wave: 0, swirl: 0, lightWidth: 2, lightIntensity: 0, canSpin: D * 20, pointerInfluence: 0 });
  tl.to(data, { lightIntensity: 30 }, 0);
  tl.to(data, { camPosZ: 29 }, 1);
  tl.to(data, startData, 2);
  loader.timeline = tl;

  const animMs = Math.max(tl.duration() * 1000, 2500);
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
  var delta = tick / 1000 - time;
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
        scroll.to(section.items[0].top, { duration: 1.2, lock: true, easing: (t) => 1 - Math.pow(1 - t, 3) });
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
    if (!swipe.holding) carousel.target = carousel.getRounded(carousel.target);
    carousel.position = lerp(carousel.position, carousel.target, delta * 10);
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
  timeline.seek(scroll.position / lenis.dimensions.scrollHeight);

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

    can.position.set(canPosX, canPosY, canPosZ);
    can.rotation.set(canRotX, canRotY, canRotZ);
    can.scale.setScalar(canScale);

    can.rotation.y += (pointer.smoothX / 1280) * data.pointerInfluence * p;
    can.rotation.x += (pointer.smoothY / 1280) * data.pointerInfluence * p;

    can.children.forEach((child) => {
      if (child.isMesh) child.rotation.z = can.rotation.y * 0.6 + data.canSpin * p;
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

  if (!contextLost) finalComposer.render();
  carousel.lastPosition = carousel.position;
}

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
    swipe.deltaX *= 8;
    swipe.holding = false;
    swipe.direction = 0;
    lenis.start();
    document.body.style.overflow = '';
  });
});

// #endregion
// #region Mobile Paging

const paging = { startX: 0, startY: 0, anchor: 0, axis: 0, active: false, threshold: 24, lastSnap: 7 };
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
  scroll.to(section.items[target].top, { duration: 1.5, easing: (t) => 1 - Math.pow(1 - t, 3) });
  paging.active = false;
  paging.axis = 0;
});

// #endregion
// #region Desktop Paging (1 cran de molette = 1 section)

const wheelPager = { locked: false, lastSnap: 6, durationSlow: 1.5, durationFast: 1, slowIndexes: [0, 1, 5, 6], cooldown: 0 };
let wheelTimer;
window.addEventListener('wheel', (e) => {
  if (pointer.prevent) return;
  const anchor = closest(section.items, scroll.position, (item) => item.top).index;
  if (anchor > wheelPager.lastSnap) return;
  e.preventDefault();
  if (wheelPager.locked) return;
  if (Math.abs(e.deltaY) < 4) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const target = clamp(anchor + dir, 0, section.items.length - 1);
  if (target === anchor) return;
  const duration = wheelPager.slowIndexes.includes(anchor) ? wheelPager.durationSlow : wheelPager.durationFast;
  wheelPager.locked = true;
  scroll.to(section.items[target].top, { duration, lock: true, easing: (t) => 1 - Math.pow(1 - t, 3) });
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => (wheelPager.locked = false), duration * 1000 + wheelPager.cooldown);
}, { passive: false });

// #endregion
// #region Resize / Start

animate();

let lastResizeWidth = window.innerWidth;
on(window, 'resize', () => {
  if (window.innerWidth === lastResizeWidth) return;
  lastResizeWidth = window.innerWidth;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  finalComposer.setSize(window.innerWidth, window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
  section.resize();
  timeline = createTimeline();
});

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
    pointer.prevent = false; swipe.active = true; animation.paused = false;
    carousel.target = carousel.getRounded(); carousel.position = carousel.target;
    loopGuard.lastPos = window.QA_POS;
    window.dispatchEvent(new CustomEvent('pulse:qa', { detail: { pos: window.QA_POS, idx } }));
  }
}

window.__sceneReady = true; /* le module peut finir AVANT DOMContentLoaded (await de haut niveau) : flag pour les retardataires */
window.dispatchEvent(new CustomEvent('carousel:ready', { detail: carousel }));

// #endregion
