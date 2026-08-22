
  document.addEventListener('DOMContentLoaded', () => {
    // #region Helpers

    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => parent.querySelectorAll(selector);
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

    // Debounce util (mutualisé pour colors / video)
    const debounce = (fn, ms = 150) => {
      let t = null;
      return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          fn(...args);
          t = null;
        }, ms);
      };
    };

    // Breakpoints

    const bp = {
      mobile: window.matchMedia('(max-width: 991px)'),
      desktop: window.matchMedia('(min-width: 992px)'),
    };

    const isMobile = () => bp.mobile.matches;
    const isDesktop = () => bp.desktop.matches;

    // SplitText

    const createLinesMask = (el, options = {}) => {
      const { stagger = 0.08, duration = 0.7, ease = 'power3.out' } = options;

      const split = new SplitText(el, {
        type: 'lines',
        mask: 'lines',
        linesClass: 'line',
      });
      const targets = split.lines;

      gsap.set(targets, { yPercent: 110 });

      return {
        in: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: 0,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        out: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: -110,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        revert: () => split.revert(),
      };
    };

    const createCharsMask = (el, options = {}) => {
      const { stagger = 0.01, duration = 0.6, ease = 'power3.out' } = options;

      const split = new SplitText(el, {
        type: 'lines,chars',
        mask: 'lines',
        linesClass: 'line',
      });
      const targets = split.chars;

      gsap.set(targets, { yPercent: 110 });

      return {
        in: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: 0,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        out: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: -110,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        revert: () => split.revert(),
      };
    };

    const initAnimations = (parent = document, excludeSelector = '') => {
      const all = $$('[data-anim]', parent);
      const els = excludeSelector ? [...all].filter((el) => !el.closest(excludeSelector)) : [...all];
      if (!els.length) return null;

      const instances = [];

      els.forEach((el) => {
        const type = el.dataset.anim;
        const stagger = parseFloat(el.dataset.animStagger) || undefined;
        const duration = parseFloat(el.dataset.animDuration) || undefined;
        const ease = el.dataset.animEase || undefined;

        const opts = { stagger, duration, ease };
        let anim = null;

        if (type === 'lines-mask') {
          anim = createLinesMask(el, opts);
        }

        if (type === 'chars-mask') {
          anim = createCharsMask(el, opts);
        }

        if (anim) instances.push(anim);
      });

      if (!instances.length) return null;

      return {
        in: (opts) => instances.forEach((a) => a.in(opts)),
        out: (opts) => instances.forEach((a) => a.out(opts)),
        revert: () => instances.forEach((a) => a.revert()),
      };
    };

    // #region Loader

    const QA = new URLSearchParams(location.search).has('seek');
    if (QA) {
      /* ScrollTrigger lit la position virtuelle ; ?shift=1 translate le DOM en flux (FAQ/footer) */
      const onQa = (ev) => {
        /* verrou : la page ne doit plus pouvoir défiler réellement (capture noire dès qu'elle défile) */
        document.documentElement.style.cssText += ';height:100vh;overflow:hidden';
        document.body.style.cssText += ';height:100vh;overflow:hidden';
        window.scrollTo(0, 0);
        /* ScrollTrigger lit window.pageYOffset : on lui sert la position virtuelle */
        try {
          Object.defineProperty(window, 'pageYOffset', { get: () => ev.detail.pos, configurable: true });
          Object.defineProperty(window, 'scrollY', { get: () => ev.detail.pos, configurable: true });
        } catch (e) {}
        ScrollTrigger.refresh();
        ScrollTrigger.update();
        setTimeout(() => { ScrollTrigger.refresh(); ScrollTrigger.update(); }, 50);
        if (new URLSearchParams(location.search).has('shift')) {
          document.querySelector('.page-wrapper').style.transform = 'translateY(' + (-ev.detail.pos) + 'px)';
        }
      };
      window.addEventListener('pulse:qa', onQa);
      /* le moteur a pu finir avant nous : rattrapage (après l'init des ScrollTriggers, d'où le setTimeout) */
      if (window.QA_POS !== undefined) setTimeout(() => onQa({ detail: { pos: window.QA_POS } }), 0);
    }

    const initLoader = () => {
      const loaderWrapper = $('.loader');
      if (QA) {
        /* mode capture : pas de séquence d'entrée */
        gsap.set(loaderWrapper, { display: 'none' });
        gsap.set(document.body, { '--loader-reveal': '0vh' });
        document.body.style.setProperty('--loader-reveal', '0vh');
        return;
      }
      const loaderPercent = $('.loader_percent');
      const loaderVideo = $('.loader_video');
      const gammeContainer = $('.gamme_container');
      const navbar = $('.navbar');
      const hud = $('.hud');
      const hudLeft = $('.hud_left');
      const hudRight = $('.hud_right');
      const canvas = $('canvas');

      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }

      window.scrollTo(0, 0);
      window.lenis?.scrollTo(0, { immediate: true });

      window.addEventListener('load', () => {
        window.scrollTo(0, 0);
        window.lenis?.scrollTo(0, { immediate: true });
      });

      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        window.lenis?.scrollTo(0, { immediate: true });
      });

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      window.lenis?.stop();

      const hideTargets = [gammeContainer, navbar, hud, canvas].filter(Boolean);
      hideTargets.forEach((el) => gsap.set(el, { autoAlpha: 0 }));
      gsap.set(document.body, { '--loader-reveal': '100vh' });

      let sceneReady = false;
      let videoEnded = false;
      let entered = false;

      const percentObj = { value: 0 };
      const updatePercent = () => {
        if (loaderPercent) loaderPercent.textContent = `${Math.round(percentObj.value)}%`;
      };
      updatePercent();

      const enterScene = async () => {
        if (entered || !videoEnded || !sceneReady) return;
        entered = true;
        document.documentElement.dataset.entered = '1';

        gsap.killTweensOf(percentObj);
        gsap.to(percentObj, {
          value: 100,
          duration: 0.4,
          ease: 'power2.out',
          onUpdate: updatePercent,
        });
        gsap.to(loaderPercent, { autoAlpha: 0, duration: 0.4, ease: 'power2.in', delay: 0.3 });

        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          delay: 0.5,
          onComplete: () => {
            /* overflow + lenis.start() sont faits par le moteur a la fin de loader.play() (sinon 1,8 s de clavier actif en plein tween) */
            if (window.ScrollTrigger) ScrollTrigger.refresh();
            window.dispatchEvent(new CustomEvent('pulse:loaded'));
          },
        });

        if (hud) tl.set(hud, { autoAlpha: 1 }, 0);

        tl.to(
          loaderWrapper,
          {
            autoAlpha: 0,
            duration: 0.6,
            ease: 'power2.in',
            onComplete: () => gsap.set(loaderWrapper, { display: 'none' }),
          },
          0,
        )
          .to(canvas, { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, 0)
          .to(document.body, { '--loader-reveal': '0vh', duration: 1, ease: 'power2.out' }, 0.2)
          .fromTo(navbar, { autoAlpha: 0, yPercent: -120 }, { autoAlpha: 1, yPercent: 0, duration: 0.9 }, 0.3)
          .fromTo(hudLeft, { autoAlpha: 0, x: '-10rem' }, { autoAlpha: 1, x: '0rem', duration: 0.9 }, 0.4)
          .fromTo(hudRight, { autoAlpha: 0, x: '10rem' }, { autoAlpha: 1, x: '0rem', duration: 0.9 }, 0.4)
          .fromTo(gammeContainer, { autoAlpha: 0 }, { autoAlpha: 1, yPercent: 0, duration: 1 }, 0.5);

        if (typeof window.loader?.play === 'function') {
          await window.loader.play();
        }
      };

      const onSceneReady = () => {
        if (sceneReady) return;
        sceneReady = true;
        document.documentElement.dataset.sceneReady = '1';
        enterScene();
      };
      window.addEventListener('carousel:ready', onSceneReady);
      if (window.carousel && window.__sceneReady) {
        onSceneReady();
      }
      /* garde-fou : CDN injoignable ou WebGL absent -> on ne laisse pas une page morte derriere le loader */
      setTimeout(() => {
        if (sceneReady) return;
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        if (loaderPercent) loaderPercent.textContent = 'Affichage simplifié';
        gsap.to(loaderWrapper, { autoAlpha: 0, duration: 0.5, delay: 0.6, onComplete: () => gsap.set(loaderWrapper, { display: 'none' }) });
        [gammeContainer, navbar, hud].forEach((el) => el && gsap.set(el, { autoAlpha: 1 }));
        document.documentElement.dataset.fallback = '1';
      }, 15000);

      const startFakePercent = () => {
        gsap.to(percentObj, {
          value: 90,
          duration: 8,
          ease: 'power1.out',
          onUpdate: updatePercent,
        });
      };

      if (loaderVideo) {
        loaderVideo.muted = true;
        loaderVideo.playsInline = true;
        loaderVideo.loop = false;

        let videoStarted = false;
        const videoTimeout = setTimeout(() => {
          if (!videoStarted && !videoEnded) {
            videoEnded = true;
            startFakePercent();
            enterScene();
          }
        }, 3000);

        loaderVideo.addEventListener('playing', () => {
          videoStarted = true;
          clearTimeout(videoTimeout);
        });

        const onTimeUpdate = () => {
          const d = loaderVideo.duration;
          if (!d || !isFinite(d)) return;
          const target = Math.min((loaderVideo.currentTime / d) * 99, 99);
          if (target > percentObj.value) {
            percentObj.value = target;
            updatePercent();
          }
        };

        const onEnded = () => {
          videoEnded = true;
          percentObj.value = Math.max(percentObj.value, 99);
          updatePercent();
          enterScene();
        };

        loaderVideo.addEventListener('timeupdate', onTimeUpdate);
        loaderVideo.addEventListener('ended', onEnded);

        loaderVideo.addEventListener('error', () => {
          clearTimeout(videoTimeout);
          videoEnded = true;
          startFakePercent();
          enterScene();
        });

        const playPromise = loaderVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            clearTimeout(videoTimeout);
            videoEnded = true;
            startFakePercent();
            enterScene();
          });
        }
      } else {
        videoEnded = true;
        startFakePercent();
        enterScene(); /* la scène peut déjà être prête (module fini avant DOMContentLoaded) */
      }
    };

    // #region Navbar

    // Sound Button

    const initSoundToggle = () => {
      const sounds = [...$$('.navbar_sound')];
      const sound = sounds[0];
      if (!sound) return;

      const label = $('div:first-child', sound);
      const bars = $$('svg rect', sound);
      /* bouton de la pilule (desktop) et bouton mobile restent synchronises */
      const mirror = () => sounds.slice(1).forEach((b) => { b.classList.toggle('is-muted', sound.classList.contains('is-muted')); $('div:first-child', b).textContent = label.textContent; b.setAttribute('aria-pressed', sound.getAttribute('aria-pressed')); });
      let isMuted = false;
      let playing = false;

      const animateBar = (bar) => {
        if (!playing) return;
        const h = gsap.utils.random(2, 8, 0.1);
        gsap.to(bar, {
          attr: { height: h, y: (8 - h) / 2 },
          duration: gsap.utils.random(0.2, 0.5),
          ease: 'power1.inOut',
          onComplete: () => animateBar(bar),
        });
      };

      const start = () => {
        playing = true;
        bars.forEach(animateBar);
      };

      const stop = () => {
        playing = false;
        gsap.killTweensOf(bars);
        gsap.to(bars, {
          attr: { height: 2, y: 3 },
          duration: 0.3,
          ease: 'power2.out',
        });
      };

      const toggle = () => {
        isMuted = !isMuted;
        sound.classList.toggle('is-muted', isMuted);
        sound.setAttribute('aria-pressed', isMuted ? 'false' : 'true');
        label.textContent = isMuted ? 'OFF' : 'ON';
        isMuted ? stop() : start();
        mirror();
      };
      sounds.forEach((b) => b.addEventListener('click', toggle));

      start();
    };

    // Menu Button

    const initMenuButton = () => {
      if (!isDesktop()) return;

      const button = $('.navbar_menu-button');
      if (!button) return;

      const circles = $$('svg circle', button);
      if (!circles.length) return;

      gsap.set(circles, { transformOrigin: '50% 50%' });

      let tl = null;

      button.addEventListener('mouseenter', () => {
        if (tl) tl.kill();
        gsap.set(circles, { scale: 1 });

        tl = gsap.timeline({ repeat: -1 });
        tl.to(circles, {
          scale: 0.5,
          duration: 0.4,
          ease: 'power2.inOut',
          stagger: { each: 0.1, from: 'start' },
        }).to(circles, {
          scale: 1,
          duration: 0.4,
          ease: 'power2.inOut',
          stagger: { each: 0.1, from: 'start' },
        });
      });

      button.addEventListener('mouseleave', () => {
        if (tl) tl.kill();
        tl = null;
        gsap.to(circles, {
          scale: 1,
          duration: 0.3,
          ease: 'power2.out',
          overwrite: true,
        });
      });
    };

    // Arrow Button

    const initCarouselArrowsHover = () => {
      if (!isDesktop()) return;

      const arrows = $$('.carousel_arrow');
      if (!arrows.length) return;

      arrows.forEach((arrow) => {
        const shapes = $$('svg path, svg rect', arrow);
        if (!shapes.length) return;

        gsap.set(shapes, { transformOrigin: '50% 50%' });

        let tl = null;

        arrow.addEventListener('mouseenter', () => {
          if (tl) tl.kill();
          gsap.set(shapes, { scale: 1 });

          tl = gsap.timeline({ repeat: -1 });
          tl.to(shapes, {
            scale: 0.5,
            duration: 0.4,
            ease: 'power2.inOut',
            stagger: { each: 0.08, from: 'start' },
          }).to(shapes, {
            scale: 1,
            duration: 0.4,
            ease: 'power2.inOut',
            stagger: { each: 0.08, from: 'start' },
          });
        });

        arrow.addEventListener('mouseleave', () => {
          if (tl) tl.kill();
          tl = null;
          gsap.to(shapes, {
            scale: 1,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true,
          });
        });
      });
    };

    // Menu Open/close

    const initMenuToggle = () => {
      const button = $('.navbar_menu-button');
      const menu = $('.navbar_menu');
      if (!button || !menu) return;

      const links = $$('.navbar_link', menu);
      if (!links.length) return;

      const middle = $('.navbar_middle', menu);
      const bottom = $('.navbar_bottom', menu);
      const mobileExtras = [middle, bottom].filter(Boolean);

      const linkReveals = [...links].map((link) => createLinesMask(link, { duration: 0.6, stagger: 0.05 }));

      let isOpen = false;
      let animating = false;

      const getOpenHeight = () => (isMobile() ? '100svh' : 'auto');

      gsap.set(menu, { height: 0, opacity: 0, display: 'none', overflow: 'hidden' });
      gsap.set(mobileExtras, { autoAlpha: 0, y: 30 });

      const open = () => {
        if (animating || isOpen) return;
        animating = true;
        isOpen = true;
        button.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');

        const mobile = isMobile();
        const menuDuration = mobile ? 0.8 : 0.6;
        const linkStagger = mobile ? 0.1 : 0.06;
        const linkDelay = mobile ? 0.45 : 0.3;

        gsap.set(menu, { display: 'flex' });

        gsap.to(menu, {
          height: getOpenHeight(),
          opacity: 1,
          duration: menuDuration,
          ease: 'power3.inOut',
          onComplete: () => {
            animating = false;
          },
        });

        linkReveals.forEach((reveal, i) => {
          reveal.in({ delay: linkDelay + i * linkStagger });
        });

        if (mobile) {
          const extrasDelay = linkDelay + links.length * linkStagger + 0.15;
          gsap.to(mobileExtras, {
            autoAlpha: 1,
            y: 0,
            duration: 0.8,
            ease: 'power3.out',
            stagger: 0.15,
            delay: extrasDelay,
          });
        }
      };

      const close = () => {
        if (animating || !isOpen) return;
        animating = true;
        isOpen = false;
        button.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');

        const mobile = isMobile();
        const menuDuration = mobile ? 0.7 : 0.5;
        const closeDelay = mobile ? 0.45 : 0.3;

        if (mobile) {
          gsap.to(mobileExtras, {
            autoAlpha: 0,
            y: 30,
            duration: 0.4,
            ease: 'power2.in',
            stagger: 0.08,
          });
        }

        linkReveals.forEach((reveal, i) => {
          reveal.out({ delay: i * 0.05 });
        });

        gsap.to(menu, {
          height: 0,
          opacity: 0,
          duration: menuDuration,
          ease: 'power3.inOut',
          delay: closeDelay,
          onComplete: () => {
            gsap.set(menu, { display: 'none' });
            gsap.set(mobileExtras, { autoAlpha: 0, y: 30 });
            animating = false;
          },
        });
      };

      button.addEventListener('click', () => {
        isOpen ? close() : open();
      });

      links.forEach((link) => {
        link.addEventListener('click', () => close());
      });

      document.addEventListener('click', (e) => {
        if (!isOpen || isMobile()) return;
        if (menu.contains(e.target) || button.contains(e.target)) return;
        close();
      });

      bp.mobile.addEventListener('change', () => {
        if (!isOpen) return;
        gsap.set(menu, { height: getOpenHeight() });
        if (isMobile()) gsap.set(mobileExtras, { autoAlpha: 1, y: 0 });
      });
    };

    // #region Carousel

    // Carousel Text

    const initCarouselText = () => {
      const slides = $$('.carousel_slide');
      const descs = $$('.carousel_desc');
      const titles = $$('.carousel_title-b');
      if (!slides.length || !window.carousel) return null;

      const createMultiReveal = (container, selector, factory) => {
        const els = $$(selector, container);
        if (!els.length) return null;

        const instances = [...els].map((el) => factory(el));

        return {
          in: (opts) => instances.forEach((a) => a.in(opts)),
          out: (opts) => instances.forEach((a) => a.out(opts)),
        };
      };

      const descReveals = [...descs].map((desc) => {
        const lines = createMultiReveal(desc, '[data-anim="lines-mask"]', (el) => createLinesMask(el));
        const chars = createMultiReveal(desc, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
        return {
          in: (opts) => {
            lines?.in(opts);
            chars?.in(opts);
          },
          out: (opts) => {
            lines?.out(opts);
            chars?.out(opts);
          },
        };
      });

      const titleReveals = [...titles].map((title) => createMultiReveal(title, '[data-anim="chars-mask"]', (el) => createCharsMask(el)));
      const slideReveals = [...slides].map((slide) => createMultiReveal(slide, '[data-anim="chars-mask"]', (el) => createCharsMask(el)));

      const fade = (els, activeIndex) => {
        els.forEach((el, i) => {
          gsap.to(el, {
            autoAlpha: i === activeIndex ? 1 : 0,
            duration: 0.5,
            ease: 'power2.inOut',
            overwrite: true,
          });
        });
      };

      slides.forEach((el, i) => gsap.set(el, { autoAlpha: i === window.carousel.index ? 1 : 0 }));
      descs.forEach((el, i) => gsap.set(el, { autoAlpha: i === window.carousel.index ? 1 : 0 }));
      titles.forEach((el, i) => gsap.set(el, { autoAlpha: i === window.carousel.index ? 1 : 0 }));

      window.carousel.changed.connect(({ index, previous }) => {
        fade(slides, index);
        fade(descs, index);
        fade(titles, index);

        descReveals[previous]?.out();
        descReveals[index]?.in({ delay: 0.3 });

        titleReveals[previous]?.out();
        titleReveals[index]?.in({ delay: 0.3 });

        slideReveals[previous]?.out();
        slideReveals[index]?.in({ delay: 0.3 });
      });

      slideReveals[window.carousel.index]?.in({ delay: 0.3 });

      return {
        inActive: (opts) => {
          descReveals[window.carousel.index]?.in(opts);
          titleReveals[window.carousel.index]?.in(opts);
        },
        outActive: (opts) => {
          descReveals[window.carousel.index]?.out(opts);
          titleReveals[window.carousel.index]?.out(opts);
        },
      };
    };

    // Carousel Nav

    const initCarouselNav = () => {
      const prev = $('.carousel_arrow.is-prev');
      const next = $('.carousel_arrow.is-next');
      if (!window.carousel) return;

      prev?.addEventListener('click', () => window.carousel.previous());
      next?.addEventListener('click', () => window.carousel.next());
    };

    const initCarouselPagination = () => {
      const container = $('.carousel_pagination');
      if (!container || !window.carousel) return;

      const svg = $('svg', container);
      const dot = $('.carousel_pagination-dot', container);
      const slides = $$('.carousel_slide');
      const count = slides.length;
      if (!count) return;

      const viewBoxWidth = 1000;
      const padding = 20;
      const usable = viewBoxWidth - padding * 2;

      const indexToX = (i) => padding + (usable / Math.max(count - 1, 1)) * i;
      const xToIndex = (x) => Math.round(((x - padding) / usable) * (count - 1));

      gsap.set(dot, {
        attr: { cx: indexToX(window.carousel.index) },
        transformBox: 'fill-box',
        transformOrigin: '50% 50%',
        x: 0,
      });

      let dotTl = null;

      window.carousel.changed.connect(({ index, previous }) => {
        const delta = index - previous;
        const isWrap = Math.abs(delta) > count / 2;

        if (dotTl) dotTl.kill();
        gsap.killTweensOf(dot);

        if (isWrap) {
          const exitRight = previous > index;
          const slide = 150;
          const exitX = exitRight ? slide : -slide;
          const enterX = exitRight ? -slide : slide;

          dotTl = gsap.timeline();
          dotTl
            .to(dot, { x: exitX, scale: 0, duration: 0.3, ease: 'power2.in' })
            .set(dot, { attr: { cx: indexToX(index) }, x: enterX })
            .to(dot, { x: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
        } else {
          dotTl = gsap.timeline();
          dotTl.to(dot, { attr: { cx: indexToX(index) }, scale: 1, x: 0, duration: 0.6, ease: 'power3.out' });
        }
      });

      const getXFromEvent = (e) => {
        const rect = svg.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = (clientX - rect.left) / rect.width;
        return clamp(ratio * viewBoxWidth, padding, viewBoxWidth - padding);
      };

      let dragging = false;

      const updateFromPointer = (e) => {
        const x = getXFromEvent(e);
        const targetIndex = clamp(xToIndex(x), 0, count - 1);
        if (targetIndex !== window.carousel.index) {
          window.carousel.goTo(targetIndex);
        }
      };

      container.addEventListener('pointerdown', (e) => {
        dragging = true;
        container.setPointerCapture(e.pointerId);
        updateFromPointer(e);
      });

      container.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        updateFromPointer(e);
      });

      container.addEventListener('pointerup', () => {
        dragging = false;
      });

      container.addEventListener('pointercancel', () => {
        dragging = false;
      });
    };

    // Carousel Gradient Angulaire

    const initGammeGradient = () => {
      const gradient = $('.gamme_gradient');
      if (!gradient || !window.carousel) return;

      const slides = $$('.carousel_slide');
      if (!slides.length) return;

      const step = 360 / slides.length;
      let current = 0;

      gsap.set(gradient, { rotation: 0 });

      window.carousel.changed.connect(({ index, previous }) => {
        let delta = index - previous;
        if (delta > slides.length / 2) delta -= slides.length;
        if (delta < -slides.length / 2) delta += slides.length;

        current -= delta * step;

        gsap.to(gradient, {
          rotation: current,
          duration: 0.8,
          ease: 'power2.inOut',
          overwrite: true,
        });
      });
    };

    // Carousel Color

    const initCarouselColors = () => {
      const slides = $$('.carousel_slide');
      if (!slides.length || !window.carousel) return;

      const root = document.documentElement;

      const applyColors = (slide) => {
        const primary = slide.dataset.tastePrimary;
        const secondary = slide.dataset.tasteSecondary;
        if (primary) root.style.setProperty('--color-scheme-1--taste-primary', primary);
        if (secondary) root.style.setProperty('--color-scheme-1--taste-secondary', secondary);
      };

      applyColors(slides[window.carousel.index]);

      const apply = debounce((index) => applyColors(slides[index]), 150);
      window.carousel.changed.connect(({ index }) => apply(index));
    };

    // Carousel Video

    const initCarouselVideo = () => {
      const section = $('.section.is-argument');
      if (!section || !window.carousel) return;

      const items = [...$$('.argument_video', section)];
      if (!items.length) return;

      let inView = false;

      const goTo = (i) => {
        items.forEach((wrapper, idx) => {
          gsap.to(wrapper, { autoAlpha: idx === i ? 1 : 0, duration: 0.6, ease: 'power2.inOut', overwrite: true });
        });
      };

      items.forEach((wrapper) => gsap.set(wrapper, { autoAlpha: 0 }));

      const apply = debounce((index) => { if (inView) goTo(index); }, 150);
      window.carousel.changed.connect(({ index }) => apply(index));

      ScrollTrigger.create({
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: ({ isActive }) => {
          inView = isActive;
          if (isActive) goTo(window.carousel.index);
        },
      });
    };

    // FAQ : accordéon (remplace l'interaction Webflow)
    const initFaq = () => {
      $$('.faq_accordion').forEach((acc) => {
        const q = $('.faq_question', acc);
        const a = $('.faq_answer', acc);
        const icon = $('.faq_icon-wrapper', acc);
        if (!q || !a) return;
        let open = false;
        const toggle = () => {
          open = !open;
          q.setAttribute('aria-expanded', open ? 'true' : 'false');
          gsap.to(a, { height: open ? 'auto' : 0, duration: 0.5, ease: 'power3.inOut' });
          if (icon) gsap.to(icon, { rotation: open ? 45 : 0, duration: 0.4, ease: 'power2.out' });
        };
        q.addEventListener('click', toggle);
        q.setAttribute('tabindex', '0'); q.setAttribute('role', 'button'); q.setAttribute('aria-expanded', 'false');
        q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      });
    };

    // #region Sections

    // Section Gamme

    const initSectionGamme = () => {
      const section = $('.section.is-gamme');
      if (!section) return;

      const tl = gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'bottom bottom',
          toggleActions: 'play none none reverse',
        },
      });

      tl.to('.carousel_pagination, .carousel_arrow.is-prev, .scroll_discover, .gamme_gradient-wrapper', { autoAlpha: 0 });

      if (isDesktop()) {
        tl.to('.carousel_title-collection', { autoAlpha: 0 }, '<');
        tl.to('.carousel_nav', { maxWidth: '55%' }, '<');
      }

      if (isMobile()) {
        tl.to('.carousel_arrow.is-next', { autoAlpha: 0 }, '<');
        tl.to('.carousel_title-collection', { y: '-2.5rem' }, '<');
      }
    };

    // Section Profile

    const initSectionProfile = () => {
      const section = $('.section.is-profile');
      if (!section) return;

      const container = $('.profile_container', section);
      if (!container) return;

      const gammeContainer = $('.gamme_container');
      const reveal = initAnimations(section, '.carousel_desc, .carousel_title-b');

      gsap
        .timeline({
          defaults: { duration: 0.5, ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom bottom',
            toggleActions: 'play reverse play reverse',
            onEnter: () => {
              document.body.classList.add('is-profile-active');
              reveal?.in({ delay: 0 });
              window.carouselText?.inActive({ delay: 0 });
            },
            onEnterBack: () => {
              reveal?.in({ delay: 0 });
              window.carouselText?.inActive({ delay: 0 });
              gsap.to(gammeContainer, { autoAlpha: 1, duration: 0.5, ease: 'power2.inOut' });
            },
            onLeave: () => {
              reveal?.out();
              window.carouselText?.outActive();
              gsap.to(gammeContainer, { autoAlpha: 0, duration: 0.5, ease: 'power2.inOut' });
            },
            onLeaveBack: () => {
              document.body.classList.remove('is-profile-active');
              reveal?.out();
              window.carouselText?.outActive();
            },
          },
        })
        .fromTo(container, { autoAlpha: 0 }, { autoAlpha: 1 })
        .fromTo('.carousel_title-bis-wrapper', { autoAlpha: 0 }, { autoAlpha: 1 }, '<');
    };

    // Section Benefits

    const initSectionBenefits = () => {
      const sections = $$('.section.is-benefits');
      if (!sections.length) return;
      sections.forEach((section) => {
        const container = $('.benefits_container', section);
        if (!container) return;
        const reveal = initAnimations(section);


        gsap
          .timeline({
            defaults: { duration: 0.5, ease: 'power2.inOut' },
            scrollTrigger: {
              trigger: section,
              start: 'top bottom',
              end: 'bottom bottom',
              toggleActions: 'play reverse play reverse',
              onEnter: () => {
                reveal?.in({ delay: 0.35 });
                gsap.fromTo(section, { '--benefits-line': 0 }, { '--benefits-line': 1, duration: 0.8, ease: 'power3.out', delay: 1 });
              },
              onEnterBack: () => {
                reveal?.in({ delay: 0.35 });
                gsap.fromTo(section, { '--benefits-line': 0 }, { '--benefits-line': 1, duration: 0.8, ease: 'power3.out', delay: 1 });
              },
              onLeave: () => reveal?.out(),
              onLeaveBack: () => reveal?.out(),
            },
          })
          .fromTo(container, { autoAlpha: 0 }, { autoAlpha: 1, delay: 0.35 });
      });
    };

    const initBenefitsNav = () => {
      const nav = $('.benefits_nav');
      const section = $('.section.is-benefits');
      const profileSection = $('.section.is-profile');
      if (!nav || !section || !profileSection) return;
      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: { trigger: profileSection, start: 'top bottom', endTrigger: section, end: 'bottom bottom', toggleActions: 'play reverse play reverse' },
      }).fromTo(nav, { autoAlpha: 0 }, { autoAlpha: 1 });
    };

    // Methode : rail fixe de 4 reperes + panneau de lecture a droite (le module ne bouge pas)
    const initMethodRail = () => {
      const section = $('.section.is-benefits');
      if (!section) return;
      const marks = [...$$('.method_mark', section)];
      const items = [...$$('.method_item', section)];
      const side = $('.method_side', section);
      let cur = -1;
      /* hauteur figee sur le texte le plus long : sans ca, le bloc changeait de taille a chaque survol (saccade) */
      const lockHeight = () => {
        const panel = $('.method_panel', section);
        if (!panel) return;
        panel.style.minHeight = '';
        const max = Math.max(...items.map((it) => { const prev = it.style.cssText; it.style.cssText = 'position:absolute;visibility:hidden;opacity:0;left:0;right:0'; const h = it.scrollHeight; it.style.cssText = prev; return h; }));
        if (max) panel.style.minHeight = Math.ceil(max) + 'px';
      };
      const show = (i, animate = true) => {
        if (i === cur) return;                 /* deja affiche : on ne rejoue rien */
        const prev = cur; cur = i;
        marks.forEach((m, k) => { m.classList.toggle('is-active', k === i); m.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
        items.forEach((it, k) => it.classList.toggle('is-active', k === i));
        if (!animate) { gsap.set(items, { clearProps: 'all' }); return; }
        /* seuls le sortant et l'entrant sont animes */
        if (items[prev]) gsap.to(items[prev], { autoAlpha: 0, x: -12, duration: 0.18, ease: 'power2.in', overwrite: true });
        gsap.fromTo(items[i], { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.34, ease: 'power2.out', delay: 0.05, overwrite: true });
      };
      marks.forEach((m, i) => {
        m.addEventListener('pointerenter', () => show(i));
        m.addEventListener('click', () => show(i));
        m.addEventListener('focus', () => show(i));
        m.setAttribute('role', 'tab');
      });
      show(0, false);
      lockHeight();
      window.addEventListener('resize', () => { clearTimeout(window.__mhT); window.__mhT = setTimeout(lockHeight, 300); });
      document.fonts?.ready.then(lockHeight);
      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section, start: 'top bottom', end: 'bottom bottom', toggleActions: 'play reverse play reverse',
          onEnter: () => { show(0, false); gsap.fromTo(marks, { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.08, delay: 0.5, ease: 'power3.out', overwrite: true }); },
          onEnterBack: () => { show(0, false); gsap.fromTo(marks, { autoAlpha: 0, x: 14 }, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.08, delay: 0.5, ease: 'power3.out', overwrite: true }); },
        },
      }).fromTo(side, { autoAlpha: 0 }, { autoAlpha: 1, delay: 0.45 });
    };

    // Section Argument

    const initSectionArgument = () => {
      const section = $('.section.is-argument');
      if (!section) return;

      const svgShapes = $$('.argument_svg svg path, .argument_svg svg polygon, .argument_svg svg text', section);
      const svgBlur = $('.argument_svg-blur', section);

      gsap.set(svgShapes, { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 50%' });
      if (svgBlur) gsap.set(svgBlur, { autoAlpha: 0 });

      const animateSvgIn = () => {
        gsap.to(svgShapes, {
          autoAlpha: 1,
          scale: 1,
          duration: 0.5,
          ease: 'back.out(2)',
          stagger: 0.04,
          delay: 0.4,
          overwrite: true,
        });
        if (svgBlur) {
          gsap.to(svgBlur, {
            autoAlpha: 1,
            duration: 0.4,
            ease: 'power2.out',
            delay: 1,
            overwrite: true,
          });
        }
      };

      const animateSvgOut = () => {
        gsap.to(svgShapes, {
          autoAlpha: 0,
          scale: 0.6,
          duration: 0.4,
          ease: 'power2.in',
          overwrite: true,
        });
        if (svgBlur) {
          gsap.to(svgBlur, {
            autoAlpha: 0,
            duration: 0.4,
            ease: 'power2.in',
            overwrite: true,
          });
        }
      };

      gsap
        .timeline({
          defaults: { duration: 0.5, ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom bottom',
            toggleActions: 'play reverse play reverse',
            onEnter: animateSvgIn,
            onEnterBack: animateSvgIn,
            onLeave: animateSvgOut,
            onLeaveBack: animateSvgOut,
          },
        })
        .fromTo('.argument_container', { autoAlpha: 0 }, { autoAlpha: 1 })
        .fromTo('.gradient_overlay', { autoAlpha: 1 }, { autoAlpha: 0 }, '<');
    };

    // Section Full Gamme

    const initSectionFullGamme = () => {
      const section = $('.section.is-full-gamme');
      if (!section) return;

      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'bottom bottom',
          toggleActions: 'play reverse play reverse',
          onEnter: () => document.body.classList.remove('is-profile-active'),
          onLeaveBack: () => document.body.classList.add('is-profile-active'),
        },
      });
    };

    // Section FAQ (mobile : fade out du HUD)

    const initSectionFaq = () => {
      if (!isMobile()) return;

      const section = $('.section.is-faq');
      if (!section) return;

      gsap.fromTo(
        '.hud_container',
        { autoAlpha: 1 },
        {
          autoAlpha: 0,
          duration: 0.5,
          ease: 'power2.inOut',
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom top',
            toggleActions: 'play reverse play reverse',
          },
        },
      );
    };


    // Section Couches (signature Pulse : 4 modules empilés, la liste pilote le carrousel)

    const initSectionStack = () => {
      const section = $('.section.is-stack');
      if (!section) return;
      const container = $('.stack_container', section);
      const reveal = initAnimations(section);
      const layers = [...$$('.stack_layer', section)];
      const setActive = (i) => layers.forEach((l) => l.classList.toggle('is-active', Number(l.dataset.index) === i));

      /* configurateur par symptome : chaque puce conseille des couches (liste + 3D via window.stackHighlight) */
      const chips = [...$$('.stack_chip', section)];
      window.stackHighlight = new Set();
      const list = $('.stack_list', section);
      /* l'opacite est pilotee par GSAP (il pose un style inline a l'entree de section,
         qui ecraserait toute regle CSS) : ce qui n'est pas conseille s'efface vraiment */
      const applySuggest = () => {
        const on = window.stackHighlight.size > 0;
        layers.forEach((l) => {
          const adv = window.stackHighlight.has(Number(l.dataset.index));
          l.classList.toggle('is-suggested', adv);
          gsap.to(l, { opacity: on ? (adv ? 1 : 0.2) : 1, x: on && adv ? 10 : 0, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
        });
        if (list) list.classList.toggle('is-filtered', on);
      };
      chips.forEach((chip) => chip.addEventListener('click', () => {
        const on = chip.classList.contains('is-on');
        chips.forEach((ch) => { ch.classList.remove('is-on'); ch.setAttribute('aria-pressed', 'false'); });
        window.stackHighlight = new Set();
        if (!on) {
          chip.classList.add('is-on');
          chip.setAttribute('aria-pressed', 'true');
          const ids = chip.dataset.layers.split(',').map(Number);
          window.stackHighlight = new Set(ids);
          if (window.carousel) window.carousel.goTo(ids[0]);
          window.pulseSound?.play('click');
        }
        applySuggest();
      }));

      initWhenCarousel(() => {
        setActive(window.carousel.index);
        window.carousel.changed.connect(({ index }) => setActive(index));
        layers.forEach((l) => {
          const go = () => { const i = Number(l.dataset.index); if (i !== window.carousel.index) window.carousel.goTo(i); };
          l.addEventListener('pointerenter', go);
          l.addEventListener('click', go);
          l.addEventListener('focus', go);
        });
      });

      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section, start: 'top bottom', end: 'bottom bottom', toggleActions: 'play reverse play reverse',
          onEnter: () => { reveal?.in({ delay: 0.35 }); gsap.fromTo(layers, { x: -16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.6, stagger: 0.07, delay: 0.5, ease: 'power3.out', overwrite: true }); },
          onEnterBack: () => { reveal?.in({ delay: 0.35 }); gsap.fromTo(layers, { x: -16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.6, stagger: 0.07, delay: 0.5, ease: 'power3.out', overwrite: true }); },
          onLeave: () => reveal?.out(),
          onLeaveBack: () => reveal?.out(),
        },
      }).fromTo(container, { autoAlpha: 0 }, { autoAlpha: 1, delay: 0.35 });
    };

    // Protocole (FAQ) : relevé numéroté qui s'écrit à l'arrivée

    const initProtocol = () => {
      const block = $('.protocol');
      if (!block) return;
      const reveal = initAnimations(block);
      const steps = $$('.protocol_step', block);
      gsap.set(steps, { autoAlpha: 0, y: 14 });
      ScrollTrigger.create({
        trigger: block, start: 'top 85%', once: true,
        onEnter: () => { reveal?.in(); gsap.to(steps, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.12, ease: 'power3.out', delay: 0.2 }); },
      });
    };

    // HUD : lecture dactylographiée de la section et de la couche courantes

    const initHudReadout = () => {
      const secEl = $('.hud_readout-sec');
      const layEl = $('.hud_readout-layer');
      if (!secEl || !layEl) return;
      const NAMES = ['GAMME', 'FICHE', 'MÉTHODE', 'CLAIM', 'PACKSHOT', 'OPTIS', 'MÉTHODE', 'AVIS', 'FAQ', 'FIN'];
      const type = (el, text) => {
        if (el.dataset.txt === text) return;
        el.dataset.txt = text;
        gsap.killTweensOf(el);
        const o = { n: 0 };
        gsap.to(o, { n: text.length, duration: 0.05 * text.length, ease: 'none', onUpdate: () => { el.textContent = text.slice(0, Math.round(o.n)) + (o.n < text.length ? '_' : ''); } });
      };
      initWhenCarousel(() => {
        const total = String((window.PULSE_PRODUCTS || []).length || 5).padStart(2, '0');
        const layer = (ev) => type(layEl, String((ev && typeof ev.index === 'number' ? ev.index : window.carousel.index) + 1).padStart(2, '0') + ' / ' + total);
        layer();
        window.carousel.changed.connect(layer);
        if (!window.lenis) return;
        let tops = [];
        const build = () => { let top = 0; tops = [...$$('section')].map((el) => { const t = top; top += el.clientHeight; return t; }); };
        build();
        window.addEventListener('resize', build);
        const wrap = (v, min, max) => { const size = max - min; v = v % size; if (v < 0) v += size; return v + min; };
        const pills = [...$$('.navpill_link[data-sections]')].map((el) => ({ el, secs: el.dataset.sections.split(',').map(Number) }));
        let lastBest = -1;
        const sync = () => {
          const max = window.lenis.dimensions.scrollHeight - window.lenis.dimensions.height;
          if (max <= 0) return;
          const pos = wrap(window.lenis.animatedScroll, 0, max);
          let best = 0, dist = Infinity;
          tops.forEach((t, i) => { const d = Math.abs(t - pos); if (d < dist) { dist = d; best = i; } });
          if (best === lastBest) return; /* une ecriture DOM par changement de section, pas par image */
          lastBest = best;
          type(secEl, NAMES[best] || '');
          pills.forEach(({ el, secs }) => el.classList.toggle('is-current', secs.includes(best)));
        };
        window.lenis.on('scroll', sync);
        window.sectionChanged?.connect(({ to }) => type(secEl, NAMES[to] || ''));
        setInterval(sync, 600); /* filet : apres un saut (End/Home, boucle) le dernier evenement scroll pouvait manquer */
      });
    };

    // Section Methode (bento) : tuiles en cascade, journal qui s'ecrit, graphe qui se trace

    const initSectionBento = () => {
      const section = $('.section.is-bento');
      if (!section) return;
      const container = $('.bento_container', section);
      const reveal = initAnimations(section);
      const cards = $$('.bento_card', section);
      const lines = [...$$('.bento_log-line', section)];
      let logTl = null;
      const playLog = () => {
        if (logTl) logTl.kill();
        lines.forEach((l) => { l.textContent = ''; l.classList.remove('is-done'); });
        logTl = gsap.timeline({ delay: 0.9 });
        lines.forEach((l, i) => {
          const text = l.dataset.line; const o = { n: 0 };
          logTl.to(o, { n: text.length, duration: 0.035 * text.length, ease: 'none', onUpdate: () => { l.textContent = text.slice(0, Math.round(o.n)); }, onComplete: () => l.classList.add('is-done') }, i === 0 ? 0 : '+=0.25');
        });
      };
      gsap.set(cards, { autoAlpha: 0, y: 22 });
      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section, start: 'top bottom', end: 'bottom bottom', toggleActions: 'play reverse play reverse',
          onEnter: () => { reveal?.in({ delay: 0.3 }); gsap.to(cards, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08, delay: 0.45, ease: 'power3.out', overwrite: true }); section.classList.add('is-live'); playLog(); },
          onEnterBack: () => { reveal?.in({ delay: 0.3 }); gsap.to(cards, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08, delay: 0.45, ease: 'power3.out', overwrite: true }); section.classList.add('is-live'); playLog(); },
          onLeave: () => { reveal?.out(); section.classList.remove('is-live'); },
          onLeaveBack: () => { reveal?.out(); section.classList.remove('is-live'); },
        },
      }).fromTo(container, { autoAlpha: 0 }, { autoAlpha: 1, delay: 0.3 });
    };

    // #region Init

    const initWhenCarousel = (fn) => {
      if (window.carousel) {
        fn();
      } else {
        window.addEventListener('carousel:ready', fn, { once: true });
      }
    };

    const setupCarouselText = () => {
      window.carouselText = initCarouselText();
    };

    /* SplitText mesure les lignes : attendre les polices evite des coupures fausses (et 12 warnings console) */
    const boot = () => {
    initLoader();
    initMenuButton();
    initMenuToggle();
    initCarouselArrowsHover();
    initWhenCarousel(setupCarouselText);
    initWhenCarousel(initCarouselNav);
    initWhenCarousel(initCarouselPagination);
    initWhenCarousel(initCarouselColors);
    initWhenCarousel(initGammeGradient);
    initWhenCarousel(initCarouselVideo);
    initSectionGamme();
    initSectionProfile();
    initSectionBenefits();
    initMethodRail();
    initSectionArgument();
    initSectionFullGamme();
    initSectionFaq();
    initFaq();
    initSectionStack();
    initProtocol();
    initHudReadout();
    initSectionBento();
    };
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]).then(boot);
  });
