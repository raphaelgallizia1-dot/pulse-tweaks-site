
  document.addEventListener('DOMContentLoaded', () => {
    // BUTTON HOVER ANIMATION (desktop only)
    if (window.innerWidth > 991) {
      document.querySelectorAll('.button').forEach((btn) => {
        if (btn.closest('.sib-form')) return; // ⬅️ ne pas toucher au bouton Brevo (loader interne)

        const icon = btn.querySelector('.button_icon');
        const iconClone = icon?.cloneNode(true);
        icon?.remove();

        const chars = btn.textContent
          .trim()
          .split('')
          .map((char) => `<span class="char" style="display:inline-block;">${char === ' ' ? '&nbsp;' : char}</span>`)
          .join('');

        btn.innerHTML = `
  <div class="button_text" style="overflow:hidden; display:inline-flex; position:relative;">
  <div class="layer-top">${chars}</div>
  <div class="layer-bottom" style="position:absolute; top:0; left:0;">${chars}</div>
  </div>`;

        if (iconClone) btn.prepend(iconClone);

        const top = btn.querySelectorAll('.layer-top .char');
        const bottom = btn.querySelectorAll('.layer-bottom .char');
        const stagger = Math.min(0.025, 0.25 / top.length);

        gsap.set(bottom, {
          y: '110%',
        });

        btn.addEventListener('mouseenter', () => {
          gsap.killTweensOf([top, bottom]);
          gsap
            .timeline()
            .to(top, { y: '-110%', stagger, duration: 0.4, ease: 'power3.inOut' }, 0)
            .to(bottom, { y: '0%', stagger, duration: 0.4, ease: 'power3.inOut' }, 0);
        });

        btn.addEventListener('mouseleave', () => {
          gsap.killTweensOf([top, bottom]);
          gsap
            .timeline()
            .to(bottom, { y: '110%', stagger, duration: 0.4, ease: 'power3.inOut' }, 0)
            .to(top, { y: '0%', stagger, duration: 0.4, ease: 'power3.inOut' }, 0);
        });
      });
    }
  });
