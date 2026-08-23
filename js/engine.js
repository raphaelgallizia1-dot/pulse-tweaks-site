/* Pulse Tweaks — moteur 3D + scroll.
   Structure reprise du moteur Ciao Energy (Three.js 0.161 + Lenis infini + timeline GSAP scrubée,
   10 états, pager molette, swipe, loader, garde-fou de boucle). Seuls changent : l'objet (module Pulse
   procédural au lieu de la canette GLB), les étiquettes (canvas), le socle (procédural) et l'environnement. */

import Lenis from 'https://cdn.jsdelivr.net/npm/lenis@1.3.23/dist/lenis.mjs';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
/* Calage de section : la courbe en S demarrait si lentement que le premier mouvement arrivait
   82 ms apres le cran de molette (mesure) — c'est ce qui se ressent comme de la latence.
   Celle-ci part tout de suite et se pose en douceur. */
const easeSnap = (t) => 1 - Math.pow(1 - t, 4);
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
  return { connect, disconnect, emit, list: callbacks }; /* list : permet de mesurer le cout de chaque abonne */
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

/* duree 0.9 au lieu du defaut 1.2 : la page repond plus vite a la molette sans perdre le lisse */
/* Repere de version : permet de savoir, depuis une capture d'ecran, quelle version tourne vraiment
   dans le navigateur du visiteur (le cache peut en servir une ancienne). */
const BUILD = 'b68-socle-cone · 2026-08-23';
console.info('%cPulse Tweaks ' + BUILD, 'color:#8b5cf6;font-weight:700');

const lenis = new Lenis({ autoRaf: false, infinite: true, syncTouch: true, duration: 0.9 });
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

/* La lampe du socle. Les LED du socle ne sont qu'une image : sans source reelle, elles
   n'eclairent rien et le socle a l'air decoupe et pose sur le fond. Cette lampe se tient au
   niveau de l'anneau lumineux et prend la couleur de l'opti affichee ; elle est declaree ici,
   avec les autres, pour que les nuanciers ne soient compiles qu'une fois. */
const socleLampe = new THREE.PointLight(new THREE.Color(PRODUCTS[0].color), 0, 9, 2);
socleLampe.position.set(0, -3.2, 2.1);
scene.add(socleLampe);

const renderPass = new RenderPass(scene, camera);

// #endregion
// #region Passes / Composer

/* Pas de passe de bloom : mesure du 2026-08-22, elle coutait 14 a 18 % du temps d'image pour un
   ecart maximal de 8/255 sur un pixel (invisible). Le rendu net vient des materiaux et du MSAA. */
const outputPass = new OutputPass();

/* MSAA 4x sur la cible : une seule resolution au lieu des 3 passes plein ecran du SMAA (edges, weights, blend) */
const finalRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, {
  type: lowPower ? THREE.UnsignedByteType : THREE.HalfFloatType,
  samples: lowPower ? 0 : 4,
});
const finalComposer = new EffectComposer(renderer, finalRenderTarget);
finalComposer.addPass(renderPass);
finalComposer.addPass(outputPass);

/* Garde-fou de fluidite.
   Je ne peux pas garantir la fluidite sur une machine que je ne vois pas : le moteur se surveille.
   Si plus d'un quart des images d'une fenetre de 90 depassent 22 ms, il baisse la resolution de
   rendu d'un cran ; si tout est propre pendant longtemps, il la remonte. Deux crans seulement,
   et uniquement sur le nombre de pixels : ni la geometrie, ni l'anticrenelage, ni les materiaux
   ne changent, donc aucune recompilation de shader (qui ferait justement un a-coup). */
/* Plafond de cadence. Sur certaines configurations, requestAnimationFrame n'est pas cale sur
   l'ecran et tourne a 280 images par seconde : on dessine alors quatre fois plus d'images que
   l'ecran n'en affiche, on sature la file du GPU et le compositeur n'a plus son creneau — ce qui
   se voit comme une saccade alors que le compteur d'images, lui, affiche 280.
   On ne rend pas plus vite que 125 images par seconde : invisible en dessous, et ca rend au
   compositeur la moitie du temps GPU. */
const renderCap = { interval: 1 / 130, last: -1 };

const quality = { level: 0, max: 3, base: pixelRatio, frames: 0, slow: 0, lastChange: 0, drops: 0 };
quality.factor = () => [1, 0.82, 0.66, 0.66][quality.level];
quality.apply = () => {
  pixelRatio = Math.max(0.6, quality.base * quality.factor());
  renderer.setPixelRatio(pixelRatio);
  /* dernier cran : on lache l'anticrenelage. C'est le plus gros poste de bande passante sur un
     GPU integre, et un bord legerement plus dur vaut mieux qu'une image sur trois perdue. */
  const samples = quality.level >= 3 ? 0 : lowPower ? 0 : 4;
  [finalComposer.renderTarget1, finalComposer.renderTarget2].forEach((rt) => {
    if (rt && rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
  });
  finalComposer.setPixelRatio(pixelRatio);
  finalComposer.setSize(window.innerWidth, window.innerHeight);
};
quality.watch = (delta, now) => {
  if (delta > 0.022) { quality.slow += 1; quality.drops += 1; }
  quality.frames += 1;
  if (quality.frames < 90) return;
  const part = quality.slow / quality.frames;
  quality.frames = 0; quality.slow = 0;
  if (part > 0.25 && quality.level < quality.max && now - quality.lastChange > 2.5) {
    quality.level += 1; quality.apply(); quality.lastChange = now;
  } else if (part === 0 && quality.level > 0 && now - quality.lastChange > 8) {
    quality.level -= 1; quality.apply(); quality.lastChange = now;
  }
};

// #endregion
// #region Base (socle bas + luminaire haut, procéduraux — mêmes cotes que la référence)

const baseMaterial = makeMaterial({
  color: 0xababab, metalness: 0.9, roughness: 0.3, sheen: 0.3, sheenRoughness: 0.2, sheenColor: 0xffffff,
  reflectivity: 1, ior: 2, envMapIntensity: 0.1,
});
applyEnvironmentTint(baseMaterial);

const base = new THREE.Group();
{
  /* enfant 0 : le socle. Ce n'etait qu'un cylindre ; c'est desormais le socle rendu fourni par
     Kouro, en cinq versions de couleur (une par opti), detourees. Une seule surface porte les
     deux textures a la fois et les melange : le changement de produit se fait en fondu, sans
     saut. Un halo teinte, lui, se contente d'un changement de couleur progressif. */
  const bottom = new THREE.Group();

  const socleTex = PRODUCTS.map((prod) => {
    const t = new THREE.TextureLoader().load('assets/socles/socle-' + prod.key + '.webp');
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });

  const SOCLE_L = 5.4;                       /* largeur en unites de scene */
  const SOCLE_H = SOCLE_L * (394 / 1200);    /* proportions du fichier */
  const socleMat = new THREE.ShaderMaterial({
    uniforms: { tA: { value: socleTex[0] }, tB: { value: socleTex[0] }, melange: { value: 0 }, gain: { value: 1.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tA; uniform sampler2D tB; uniform float melange; uniform float gain; varying vec2 vUv; void main(){ vec4 a = texture2D(tA, vUv); vec4 b = texture2D(tB, vUv); vec4 c = mix(a, b, melange); if (c.a < 0.004) discard; gl_FragColor = vec4(c.rgb * gain, c.a); }',
    transparent: true, depthWrite: false,
  });
  const socle = new THREE.Mesh(new THREE.PlaneGeometry(SOCLE_L, SOCLE_H), socleMat);
  socle.position.y = -3.36 - SOCLE_H / 2 + 0.10;   /* le plateau arrive au niveau de l'ancien anneau */
  socle.renderOrder = -1;

  /* --- ce que le socle projette -------------------------------------------------------
     Retour du 23/08 : les faisceaux du socle ne projetaient rien, on ne voyait qu'une ombre
     de lumiere posee dessus. Quatre pieces repondent maintenant a l'anneau, toutes reglees
     sur la couleur de l'opti :
       assise   : le sol est un degrade clair ; sans le creuser sous le socle, la plaque noire
                  du socle tranche et il a l'air colle sur un mur.
       nappes   : la lumiere qui deborde au sol autour du pied (une large, une serree).
       colonne  : ce qui monte de l'anneau vers le module.
     La lampe, elle, est declaree avec les autres lumieres : c'est elle qui eclaire vraiment. */

  const masqueRond = (arrets) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    arrets.forEach(([q, a]) => grad.addColorStop(q, 'rgba(255,255,255,' + a + ')'));
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  };

  const nappe = (tex, l, h, y, z, opacite, ordre, blend) => {
    const m = new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(PRODUCTS[0].color), transparent: true,
      opacity: opacite, blending: blend, depthWrite: false,
    });
    const o = new THREE.Mesh(new THREE.PlaneGeometry(l, h), m);
    o.position.set(0, y, z);
    o.renderOrder = ordre;
    return o;
  };

  /* reperes mesures dans l'image : pied du socle a v = 0.04, anneau du plateau a v = 0.58 */
  const yPied = socle.position.y - SOCLE_H * 0.46;
  const yAnneau = socle.position.y + SOCLE_H * 0.08;

  const texAssise = masqueRond([[0, 0.85], [0.45, 0.55], [1, 0]]);
  const assise = nappe(texAssise, SOCLE_L * 2.30, SOCLE_L * 0.62, yPied + 0.06, -0.9, 0.72, -6, THREE.NormalBlending);
  assise.material.color.setHex(0x05040a);          /* le sol se creuse, il ne se teinte pas */

  const texLarge = masqueRond([[0, 0.30], [0.35, 0.11], [1, 0]]);
  const large = nappe(texLarge, SOCLE_L * 2.60, SOCLE_L * 0.70, yPied, -0.8, 1, -5, THREE.AdditiveBlending);

  const texHalo = masqueRond([[0, 0.62], [0.28, 0.20], [1, 0]]);
  const halo = nappe(texHalo, SOCLE_L * 1.30, SOCLE_L * 0.26, yPied, -0.7, 1, -4, THREE.AdditiveBlending);

  /* la colonne. Deux essais rates avant celui-ci : un rectangle degrade (ses bords se voyaient,
     cela faisait une boite de brume), puis une ellipse centree en l'air — et une ellipse a son
     point le plus vif en son centre, donc la lumiere avait l'air de naitre a mi-hauteur, autour
     du module. Ici le degrade part du BAS de l'image : le point le plus vif tombe sur l'anneau
     du socle, et tout ce qui monte s'eteint. La lumiere vient du socle. */
  const texCone = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    /* rayon = 128, soit la MOITIE du cote : le degre s'eteint donc pile au bord de l'image.
       Avec un rayon de 256, les bords gauche et droit restaient allumes et on voyait un
       rectangle clair en plein ecran (vu sur capture, corrige). */
    const gr = g.createRadialGradient(128, 256, 0, 128, 256, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0.62)');
    gr.addColorStop(0.20, 'rgba(255,255,255,0.28)');
    gr.addColorStop(0.50, 'rgba(255,255,255,0.09)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const HAUTEUR_COLONNE = 6.0;
  const colonne = nappe(texCone, SOCLE_L * 1.30, HAUTEUR_COLONNE, yAnneau + HAUTEUR_COLONNE / 2, -0.25, 1, 1, THREE.AdditiveBlending);

  /* le reflet du module sur le plateau. Un plateau sombre et parfaitement propre sous un objet
     lumineux, c'est ce qui trahissait l'image collee : rien ne se renvoyait. */
  const reflet = nappe(masqueRond([[0, 0.50], [0.35, 0.16], [1, 0]]), SOCLE_L * 0.46, SOCLE_H * 0.40, socle.position.y + SOCLE_H * 0.28, 0.02, 1, 0, THREE.AdditiveBlending);

  const teintes = [assise, large, halo, colonne, reflet];

  /* bottom lui-meme sert de rail vertical a la ligne du temps (position.y ecrite a chaque
     image) : la pose du socle tient donc dans un sous-groupe. Il etait a ras du bas de l'ecran,
     sans un centimetre de sol dessous ; d'ou l'impression d'une image collee. */
  const pose = new THREE.Group();
  pose.position.y = 0.10;
  pose.scale.setScalar(0.93);
  pose.add(assise, large, halo, socle, reflet, colonne);
  bottom.add(pose);
  window.__socle = { socle, assise, large, halo, colonne, reflet, pose, lampe: socleLampe };


  /* Changement de produit : on charge la nouvelle texture dans l'emplacement B et on fond vers
     elle. Tout ce que le socle projette suit le meme fondu : nappes, colonne, lampe, et le spot
     du bas de la scene, qui est justement celui qui vient d'ou se tient le socle. Rien ne saute. */
  const socleFondu = { t: 1, duree: 0.55, cible: 0 };
  const teinteDe = new THREE.Color(PRODUCTS[0].color);
  const teinteVers = new THREE.Color(PRODUCTS[0].color);
  const teinteNow = new THREE.Color(PRODUCTS[0].color);
  const BLANC = new THREE.Color(0xffffff);
  /* le spot du bas ne prend qu'une part de la couleur : au-dela, les modules virent au monochrome */
  const PART_SPOT = 0.40;
  const poseTeinte = () => {
    teintes.forEach((o) => { if (o !== assise) o.material.color.copy(teinteNow); });
    socleLampe.color.copy(teinteNow);
    spot2.color.copy(BLANC).lerp(teinteNow, PART_SPOT);
  };
  poseTeinte();
  window.socleVersProduit = (i) => {
    const n = ((i % PRODUCTS.length) + PRODUCTS.length) % PRODUCTS.length;
    if (n === socleFondu.cible) return;
    socleMat.uniforms.tA.value = socleTex[socleFondu.cible];
    socleMat.uniforms.tB.value = socleTex[n];
    socleMat.uniforms.melange.value = 0;
    socleFondu.cible = n; socleFondu.t = 0;
    teinteDe.copy(teinteNow); teinteVers.set(PRODUCTS[n].color);
  };
  /* Les quatre autres socles ne partiraient vers le GPU qu'au premier changement de produit,
     ce qui couterait une image a ce moment-la. On les televerse un par un une fois le site en
     main, quand plus personne ne regarde. */
  {
    let i = 0;
    let essais = 0;
    const prechauffe = () => {
      if (i >= socleTex.length || essais > 200) return;
      const t = socleTex[i];
      if (t.image && t.image.width) {
        try { renderer.initTexture(t); } catch (err) { /* version sans initTexture */ }
        i += 1;
      }
      essais += 1;
      setTimeout(prechauffe, 140);
    };
    setTimeout(prechauffe, 3000);
  }

  window.socleAvance = (delta) => {
    if (socleFondu.t >= 1) return;
    socleFondu.t = Math.min(1, socleFondu.t + delta / socleFondu.duree);
    const k = socleFondu.t < 0.5 ? 2 * socleFondu.t * socleFondu.t : 1 - Math.pow(-2 * socleFondu.t + 2, 2) / 2;
    socleMat.uniforms.melange.value = k;
    teinteNow.copy(teinteDe).lerp(teinteVers, k);
    poseTeinte();
    if (socleFondu.t >= 1) { socleMat.uniforms.tA.value = socleTex[socleFondu.cible]; socleMat.uniforms.melange.value = 0; }
  };

  /* Les lumieres de la scene s'eteignent quand on quitte la gamme : ce que le socle projette
     doit s'eteindre avec elles, sinon il reste une tache de couleur sur une scene noire. */
  const ECLAT = { assise: 0.72, large: 1, halo: 1, colonne: 1, reflet: 1 };
  const LAMPE_MAX = 44;
  window.socleEclat = (part) => {
    const q = Math.max(0, Math.min(1, part));
    socleLampe.intensity = LAMPE_MAX * q;
    assise.material.opacity = ECLAT.assise * q;
    large.material.opacity = ECLAT.large * q;
    halo.material.opacity = ECLAT.halo * q;
    colonne.material.opacity = ECLAT.colonne * q;
    reflet.material.opacity = ECLAT.reflet * q;
    const v = q > 0.01;
    teintes.forEach((o) => { o.visible = v; });
  };
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
/* le socle suit le produit affiche */
carousel.changed.connect(({ index }) => { if (window.socleVersProduit) window.socleVersProduit(index); });

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

/* Reperes de chargement : sert a savoir ce qui bloque, sans cout mesurable */
window.__t = [];
const mark = (n) => window.__t.push([n, Math.round(performance.now())]);

/* Étiquette portée par la face avant (et l'arrière) */
function labelTexture(p) {
  /* haute résolution : l'objet remplit l'écran sur les bénéfices, les textes doivent rester nets */
  /* Le dessin ci-dessous est cale sur une planche de 2048x6144 (coordonnees en dur). La texture
     peut etre plus petite : on met la planche a l'echelle, sinon tout est dessine trop gros et
     l'etiquette devient une bouillie blanche. RES = taille reelle / taille de reference. */
  const REF_W = 2048, REF_H = 6144, RES = 0.5;
  const W = REF_W * RES, H = REF_H * RES;
  const t0 = performance.now();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.setTransform(RES, 0, 0, RES, 0, 0); /* on continue a dessiner en coordonnees 2048x6144 */
  g.fillStyle = '#0b0a10'; g.fillRect(0, 0, REF_W, REF_H);
  g.strokeStyle = 'rgba(255,255,255,.42)'; g.lineWidth = 8; g.strokeRect(140, 140, REF_W - 280, REF_H - 280);
  g.fillStyle = '#f4f3f6'; g.textAlign = 'center'; g.font = 'italic 210px Anton';
  g.fillText('PULSE TWEAKS', REF_W / 2, 470);
  g.font = '78px Geistmono'; g.fillStyle = 'rgba(228,228,234,.85)';
  g.fillText(p.tag, REF_W / 2, 600);
  g.save(); g.translate(520, REF_H / 2 + 160); g.rotate(-Math.PI / 2);
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
  g.fillText('OPTIMISATION MANUELLE', REF_W / 2, REF_H - 520);
  g.fillText('ZÉRO RÉGLAGE INUTILE', REF_W / 2, REF_H - 410);
  mark('dessin etiquette ' + p.name + ' : ' + Math.round(performance.now() - t0) + ' ms');
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

mark('debut creation des modules');
await Promise.all(PRODUCTS.map((p) => createCan(p))).then((items) => {
  items.forEach((item) => cans.push(item));
  /* le wrap de la reference place au centre le module n. cans.length/2 : cette moitie DOIT etre un multiple du nombre de produits
     (24/2 = 12 = 3 x 4 marchait par construction ; avec 5 produits : 30 clones, 15 = 3 x 5). Sinon aucun module n'est centre. */
  const targetCount = PRODUCTS.length * 2 * (lowPower ? 1 : 2); /* 20 au lieu de 30 : 10 de chaque cote, la rangee couvre deja bien plus que l'ecran */
  let i = 0;
  while (cans.length < targetCount) { cans.push(duplicateCan(cans[i % PRODUCTS.length])); i++; }
  mark('modules prets');
});

/* Le premier rendu televersait les cinq etiquettes vers le GPU d'un seul coup : 1040 ms de gel
   mesures, en plein sur la premiere section. On les envoie une par image, pendant le chargeur,
   ou une pause de 150 ms ne se voit pas. */
{
  const textures = [];
  cans.forEach((c) => c.traverse((o) => {
    if (o.isMesh && o.material && o.material.map && textures.indexOf(o.material.map) < 0) textures.push(o.material.map);
  }));
  for (const t of textures) {
    try { renderer.initTexture(t); } catch (err) { /* version sans initTexture : le premier rendu s'en chargera */ }
    await new Promise((r) => requestAnimationFrame(r));
  }
  mark('etiquettes televersees (' + textures.length + ')');
}

// #endregion
// #region Raycaster / Cursor

const raycast = new THREE.Raycaster();
/* ce qui est reellement cliquable : ni glisse ni selection 3D ne doivent le court-circuiter */
const notDraggable = (t) => !!(t && t.closest && t.closest('a, button, input, textarea, select, label, .modal, .navbar, .navpill'));
on(window, 'click', (e) => {
  /* on ecarte ce qui est reellement cliquable (fleches, menu, fenetres) ; le reste de l'ecran
     selectionne un module, meme la ou un element d'une autre section couvre le canvas */
  if (notDraggable(e.target) || pointer.prevent || swipe.direction != 0 || scroll.position > section.items[1].top) return;
  const mouse = new THREE.Vector2((e.clientX / renderer.domElement.clientWidth) * 2 - 1, -(e.clientY / renderer.domElement.clientHeight) * 2 + 1);
  raycast.setFromCamera(mouse, camera);
  for (const can of cans) {
    can.getWorldPosition(hoverVec);
    hoverSphere.set(hoverVec, HOVER_RAYON * Math.abs(can.scale.x));
    if (!raycast.ray.intersectsSphere(hoverSphere)) continue;
    if (raycast.intersectObject(can).length === 0) continue;
    const delta = Math.round(can.position.x / carousel.spacing);
    /* le module clique vient AU CENTRE, meme s'il est a trois places (avant : un cran a la fois) */
    if (delta !== 0) carousel.goTo(carousel.getIndex(false) + delta);
    else scroll.to(section.items[1].top, { duration: wheelPager.duration, lock: true, easing: easeSnap });
    break;
  }
});

const isInGamme = () => scroll.position < section.items[1].top;
/* Ecrire style.cursor salit le style de TOUT le document : on n'ecrit que si la valeur change. */
let cursorNow = '';
const setCursor = (v) => { if (v !== cursorNow) { cursorNow = v; document.body.style.cursor = v; } };

/* Survol du carrousel — le poste le plus cher du site avant cette version.
   Il testait la GEOMETRIE REELLE des 20 modules (des milliers de triangles chacun) a chaque
   image, soit jusqu'a 280 fois par seconde, pour un simple changement de curseur : 12 % du
   temps processeur mesure au profileur, 16 % avec ses fonctions filles.
   Trois economies qui ne changent rien au comportement :
     1. 20 fois par seconde suffisent pour un curseur (au lieu de 280) ;
     2. seuls les exemplaires du produit CENTRE peuvent changer le curseur : 4 modules sur 20 ;
     3. une sphere englobante ecarte d'abord ceux que le rayon ne peut pas toucher ; le test
        precis ne tourne que sur les survivants, donc la detection reste exacte. */
const hoverSphere = new THREE.Sphere();
const hoverVec = new THREE.Vector3();
const HOVER_RAYON = 2.2;   /* demi-diagonale d'un module */
const HOVER_PAUSE = 50;    /* ms entre deux tests */
let hoverLast = 0;
let hoverEvt = null;
let hoverPending = false;
on(window, 'mousemove', (e) => {
  if (!isInGamme()) { setCursor(''); return; }
  hoverEvt = e;
  if (hoverPending) return;
  const reste = HOVER_PAUSE - (performance.now() - hoverLast);
  hoverPending = true;
  setTimeout(() => { hoverPending = false; hoverLast = performance.now(); if (hoverEvt) hoverTest(hoverEvt); }, Math.max(0, reste));
});
const hoverTest = (e) => {
  const mouse = new THREE.Vector2((e.clientX / renderer.domElement.clientWidth) * 2 - 1, -(e.clientY / renderer.domElement.clientHeight) * 2 + 1);
  raycast.setFromCamera(mouse, camera);
  let hoverActive = false;
  for (let i = 0; i < cans.length; i += 1) {
    if (i % PRODUCTS.length !== carousel.index) continue;
    const can = cans[i];
    can.getWorldPosition(hoverVec);
    hoverSphere.set(hoverVec, HOVER_RAYON * Math.abs(can.scale.x));
    if (!raycast.ray.intersectsSphere(hoverSphere)) continue;
    if (raycast.intersectObject(can).length > 0) { hoverActive = true; break; }
  }
  setCursor(hoverActive ? 'pointer' : ''); /* plus de main ouverte : on ne glisse plus, on clique */
};

// #endregion
// #region Sections

const section = { items: [] };
section.getIndex = () => closest(section.items, scroll.position, (item) => item.top).index;
section.previous = () => section.goTo(section.getIndex() - 1);
section.next = () => section.goTo(section.getIndex() + 1);
section.goTo = (index) => { const n = section.items.length; scroll.to(section.items[((index % n) + n) % n].top); };
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
/* La derive demarre 2 s apres l'ouverture et s'arrete DEFINITIVEMENT des que le visiteur fait tourner
   la gamme lui-meme (glisse ou fleches). Defiler la page, elle, ne l'arrete pas.
   Elle ne depend plus de « mouvement reduit » : Kouro la veut visible sur sa machine, ou l'option est active. */
const auto = { speed: 0.45, startAfter: 2, resumeAfter: 3, startedAt: 0, lastInput: -1e9, running: false };
auto.take = () => { auto.lastInput = performance.now() / 1000; auto.running = false; };
const _goTo = carousel.goTo;
carousel.goTo = (index) => { auto.take(); _goTo(index); };
carousel.isDragging = () => swipe.holding && swipe.direction === 1;
/* lu par home.js : voir la teinte du site */


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

  // Avis (section DOM) : scene hors champ
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

  // Ecran de fin : la scene sort du champ, la page se termine sur le texte et le pied de page
  //  (la reference finissait par un retour anime a l'accueil ; ici le site a une vraie fin)
  tl.to(data, { camPosX: 0, camPosY: -5.5, camPosZ: 10, camRotX: 0, camRotY: 0, camRotZ: 0, fov: 30, canScale: 1,
    canPosX: 0, canPosY: 0, canPosZ: -0.4, canRotX: 0, canRotY: 0, canRotZ: 0, canSpin: 0, spacing: 0.6,
    wave: 0, swirl: 1, baseOffset: 20, stack: 0, lightIntensity: 0, lightWidth: 3, tintStrength: 1,
    spotIntensity: 0, spotY: 3, pointerInfluence: 0, swipeSpeed: 1,
    duration: section.items[i] ? section.items[i].height / section.total() : 1 });
  i += 1;

  // Raccord de boucle : sur la fin de l'ecran final, la scene revient EXACTEMENT a l'etat de depart,
  //  si bien qu'au moment ou le defilement reboucle, l'image ne saute pas.
  tl.to(data, { ...startData, duration: section.items[i] ? Math.max(0.02, (section.items[i].height - lenis.dimensions.height) / section.total()) : 1 });

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
  loader.ended.emit();
};

// #endregion
// #region Animation

const animation = { paused: false };
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; }, false);
renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; }, false);

const loopGuard = { lastPos: 0, snapping: false, timer: null };
let renderHidden = false; /* le canvas a deja ete vide : inutile de le redessiner */

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
  if (!animation.paused && !pointer.prevent) quality.watch(delta, time);
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

  /* demi-largeur visible au plan des modules, plus 60 % de marge : on ne masque que ce qui est
     tres largement hors cadre, jamais un module qui pourrait apparaitre */
  const demiLargeur = Math.abs(Math.tan((data.fov * Math.PI) / 360) * Math.max(1, data.camPosZ) * camera.aspect) * 2 + 6;

  const minX = cans.length * -0.5 * carousel.spacing;
  const maxX = cans.length * 0.5 * carousel.spacing;

  carousel.target -= swipe.deltaX * 0.02 * data.swipeSpeed;
  swipe.deltaX = 0;

  pointer.smoothX = lerp(pointer.smoothX, pointer.x, delta * 10);
  pointer.smoothY = lerp(pointer.smoothY, pointer.y, delta * 10);

  if (!animation.paused) {
    if (!auto.startedAt && !pointer.prevent) auto.startedAt = time; /* le compte a rebours part a la fin du chargement */
    const demarre = auto.startedAt > 0 && time - auto.startedAt > auto.startAfter;   /* 2 s apres l'arrivee */
    const libre = time - auto.lastInput > auto.resumeAfter;                           /* reprend 3 s apres la derniere manipulation */
    const onHome = section.items.length > 1 && scroll.position < section.items[1].top * 0.5;
    auto.running = demarre && libre && onHome && !swipe.holding && !pointer.prevent;
    if (auto.running) {
      /* derive lente ; position lissee (et non collee a la cible) : un clic recu pendant l'intro ne fait plus sauter la rangee */
      carousel.target += auto.speed * delta;
      carousel.position = lerp(carousel.position, carousel.target, Math.min(1, delta * 10));
    } else {
      if (!swipe.holding) carousel.target = carousel.getRounded(carousel.target);
      /* souris posee : la rangee colle au geste (a 10, elle trainait derriere) */
      carousel.position = lerp(carousel.position, carousel.target, Math.min(1, delta * (swipe.holding ? 26 : 10)));
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
      const filtered = !!(window.stackHighlight && window.stackHighlight.size);
      const advised = filtered && window.stackHighlight.has(k);
      const active = i < PRODUCTS.length && (advised || (!filtered && k === carousel.index));
      /* filtre actif : ce qui n'est pas conseille recule et se reduit (lisible d'un coup d'oeil) */
      can.userData.dim = lerp(can.userData.dim || 0, filtered && !advised ? 1 : 0, Math.min(1, delta * 6));
      /* la couche active s'avance, grossit et bascule vers la camera (en douceur, lerp par module) */
      can.userData.lift = lerp(can.userData.lift || 0, active ? 1 : 0, Math.min(1, delta * 7));
      const L = can.userData.lift;
      canPosX = lerp(canPosX, data.canPosX + L * 0.35, sst);
      canPosY = lerp(canPosY, sy, sst);
      canPosZ = lerp(canPosZ, data.canPosZ + L * 1.6 - can.userData.dim * 1.5, sst);
      canScale = lerp(canScale, (1 + L * 0.08) * (1 - can.userData.dim * 0.12), sst);
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

    /* Un module trop loin du centre ne peut pas etre a l'ecran. En le declarant invisible, three.js
       le saute au parcours de la scene et a la preparation du rendu : autant de travail par image
       en moins, sans rien changer a l'image. Le cadre est centre sur la CAMERA (qui n'est pas
       toujours en x=0 : premiere version fausse, elle masquait un module de la pile des optis).
       Dans la pile, les positions sortent de la logique de rangee : on ne masque rien. */
    /* et un module reduit a une taille nulle (la pile des optis en met 15 sur 20 a zero) n'a
       aucune raison d'etre dessine : mesure, la section passait 141 appels de rendu au lieu de 36. */
    can.visible = canScale > 0.01 && (data.stack > 0 || Math.abs(canPosX - data.camPosX) < demiLargeur);
  });

  if (window.socleAvance) window.socleAvance(delta);
  /* 14 : l'eclairage de la gamme, la seule section ou le socle est en vue */
  if (window.socleEclat) window.socleEclat(data.lightIntensity / 14);
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

  if (window.stepFx && window.stepFx.spin !== 0) window.stepFx.spin = lerp(window.stepFx.spin, 0, Math.min(1, delta * 4));

  /* Sections ou la scene est HORS CHAMP (avis, FAQ, fin) : mesure faite, le canvas y est
     entierement vide (alpha 0). On ne paie ni les 30 objets ni les passes plein ecran. */
  const hidden = data.camPosY <= -5.2 && data.lightIntensity === 0 && data.spotIntensity === 0;
  /* tolerance d une demi-image : sinon, avec une boucle a 280 Hz, on saute deux images sur trois */
  const dessine = time - renderCap.last >= renderCap.interval - delta * 0.5;
  if (dessine) renderCap.last = time;
  if (!contextLost && dessine) {
    if (!hidden) { window.__drawn++; if (!window.__firstDone) { const a = performance.now(); finalComposer.render(); mark('1er rendu : ' + Math.round(performance.now() - a) + ' ms'); window.__firstDone = 1; } else finalComposer.render(); renderHidden = false; }
    else if (!renderHidden) { renderer.setRenderTarget(null); renderer.clear(); renderHidden = true; }
  }
  carousel.lastPosition = carousel.position;
}

// #region Pointer / Swipe

const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, smoothX: window.innerWidth / 2, smoothY: window.innerHeight / 2, prevent: true };

const blockScrollWhilePrevented = (e) => { if (pointer.prevent) { e.preventDefault(); e.stopPropagation(); } };
window.addEventListener('wheel', blockScrollWhilePrevented, { passive: false, capture: true });
window.addEventListener('touchmove', blockScrollWhilePrevented, { passive: false, capture: true });
on(window, 'mousemove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });

/* Le glisse ecoutait le canvas : a droite de l'ecran, un paragraphe d'une AUTRE section (en position
   fixe, invisible) captait le clic et le geste ne demarrait jamais. On ecoute la fenetre, en laissant
   passer ce qui est reellement cliquable. */
/* Plus de glisse a la souris (demande de Kouro 2026-08-23 : « clairement ca bug, aucun interet a le
   garder »). La gamme se parcourt aux fleches, au clic sur un module, et toute seule. Le geste tactile
   reste, lui : sur telephone il n'y a pas de clic gauche, et c'est la facon normale de faire defiler. */
const touchXY = (e) => (e.touches && e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null);
on(window, 'mousedown touchstart', (e) => {
  if (!e.touches) return;
  if (!swipe.active || pointer.prevent || notDraggable(e.target)) return;
  const pt = touchXY(e);
  if (!pt) return; /* liste de touches vide : rien a suivre */
  swipe.holding = true;
  swipe.deltaX = 0;
  const x = pt.x;
  const y = pt.y;
  swipe.startX = x; swipe.lastX = x; swipe.startY = y; swipe.lastY = y;
});
on(window, 'mousemove touchmove', (e) => {
  if (!e.touches) return; /* la souris ne fait plus tourner la gamme */
  if (!swipe.active || !swipe.holding || pointer.prevent) return;
  const pt = touchXY(e);
  if (!pt) return;
  const x = pt.x;
  const y = pt.y;
  const deltaX = x - swipe.lastX;
  const deltaY = y - swipe.lastY;
  if (swipe.direction == 0) {
    if (Math.abs(swipe.startX - x) > 2 || Math.abs(swipe.startY - y) > 2) swipe.direction = Math.abs(deltaX) > Math.abs(deltaY) ? 1 : 2;
  }
  if (swipe.direction == 1) {
    if (swipe.lastX === swipe.startX) lenis.stop(); /* une seule fois par geste, pas a chaque mouvement */
    auto.take();                                   /* le visiteur prend la main : la derive s'arrete pour de bon */
    swipe.lastX = x;
    swipe.deltaX += deltaX;
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
  scroll.to(section.items[target].top, { duration: 1.5, easing: easeSnap });
  paging.active = false;
  paging.axis = 0;
});

// #endregion
// #region Desktop Paging (1 cran de molette = 1 section)

/* Passage de section : courbe entree-sortie (demarrage doux, arrivee douce) au lieu du cubique sortant
   qui partait brutalement ; duree unique ; un COOLDOWN et un filtre de geste : l'inertie d'un trackpad
   envoie des dizaines d'evenements decroissants apres le geste, qui relancaient un 2e saut. */
const wheelPager = { locked: false, lastSnap: 7, duration: 1.0, cooldown: 140, lastTime: 0, lastDelta: 0 };
window.sectionChanged = signal();
let wheelTimer;
const inOverlay = (e) => !!(e.target && e.target.closest && e.target.closest('.modal:not([hidden])'));
window.addEventListener('wheel', (e) => {
  if (pointer.prevent || inOverlay(e)) return;   /* fenetre admin ouverte : la molette lui appartient */
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
  scroll.to(section.items[target].top, { duration, lock: true, easing: easeSnap });
  window.sectionChanged.emit({ from: anchor, to: target });
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => (wheelPager.locked = false), duration * 1000 + wheelPager.cooldown);
}, { passive: false });

// #region Clavier (1 touche = 1 section, coherent avec la molette)

window.addEventListener('keydown', (e) => {
  if (pointer.prevent || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.querySelector('.modal:not([hidden])')) return;   /* saisie dans la fenetre admin */
  const tag = document.activeElement?.tagName || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
  if ((e.key === ' ' || e.key === 'Enter') && /^(BUTTON|A)$/.test(tag)) return; /* activation native du bouton focalise */
  const anchor = closest(section.items, scroll.position, (item) => item.top).index;
  const last = section.items.length - 2; /* la FAQ est la derniere section navigable */
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
  const opts = { duration, lock: true, easing: easeSnap };
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

/* Programmes GL prets avant la premiere image (sinon chaque section compile a la volee et
   fait un a-coup). Jamais bloquant plus de 3 s, et jamais fatal : le site doit demarrer. */
try {
  if (renderer.compileAsync) {
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 3000))]);
  } else renderer.compile(scene, camera);
} catch (err) { console.warn('precompilation ignoree', err); }
mark('shaders prets');

/* Rendu de chauffe sur une cible minuscule : il lie les programmes du composeur et alloue les
   cibles sans payer le remplissage. Sans lui, la toute premiere vraie image coutait ~460 ms. */
try {
  const plein = pixelRatio;
  renderer.setPixelRatio(0.05); finalComposer.setPixelRatio(0.05); finalComposer.setSize(window.innerWidth, window.innerHeight);
  finalComposer.render();
  renderer.setPixelRatio(plein); finalComposer.setPixelRatio(plein); finalComposer.setSize(window.innerWidth, window.innerHeight);
  mark('rendu de chauffe');
} catch (err) { console.warn('chauffe ignoree', err); }

animate();
/* Programmes GL prets avant la premiere image : sinon le premier rendu de chaque section
   compile a la volee et fait un a-coup. */
mark('compilation des shaders');

let lastResizeWidth = window.innerWidth;
const coarse = matchMedia('(pointer: coarse)').matches;
on(window, 'resize', () => {
  /* sur tactile, la barre d'URL change la hauteur en permanence : on n'y reagit qu'a la largeur ; sur desktop, toute resize compte */
  if (coarse && window.innerWidth === lastResizeWidth) return;
  lastResizeWidth = window.innerWidth;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  quality.base = computePixelRatio();
  quality.apply();
  renderer.setSize(window.innerWidth, window.innerHeight);
  rebuildTimeline();
});
/* le contenu change de hauteur (accordeon FAQ, polices) : la timeline suit */
if (window.ResizeObserver) new ResizeObserver(debounce(() => { if (!pointer.prevent) rebuildTimeline(); }, 300)).observe(document.querySelector('.page-wrapper'));

lenis.scrollTo(0, { immediate: true });
window.loader = loader;

/* Ecran de fin : remonter en haut sur demande (la reference le faisait toute seule, en boucle) */
document.querySelector('[data-scroll-top]')?.addEventListener('click', () => {
  wheelPager.locked = true;
  scroll.to(0, { duration: 1.6, lock: true, easing: easeSnap });
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => (wheelPager.locked = false), 1800);
});

/* Sonde de diagnostic, toujours disponible (getters seuls, aucun cout) */
window.__dbg = { get objets() { return cans; }, get scene() { return scene; }, get data() { return data; }, get timeline() { return timeline; }, get section() { return section; }, get scroll() { return scroll; }, get lenis() { return lenis; }, get pixelRatio() { return pixelRatio; }, get cans() { return cans.map((c) => [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2), +c.scale.x.toFixed(2)]); }, get contextLost() { return contextLost; }, get renderer() { return renderer; }, get composer() { return finalComposer; }, get build() { return BUILD; }, get quality() { return { niveau: quality.level, dpr: +pixelRatio.toFixed(2), imagesLentes: quality.drops, fenetre: quality.frames, lentesFenetre: quality.slow, depuis: +(time - quality.lastChange).toFixed(1) }; }, get info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, progs: renderer.info.programs.length, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries }; } };

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
  }
}

window.__sceneReady = true; /* le module peut finir AVANT DOMContentLoaded (await de haut niveau) : flag pour les retardataires */
window.dispatchEvent(new CustomEvent('carousel:ready', { detail: carousel }));

// #endregion
