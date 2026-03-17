(function () {
  'use strict';

  // Lottie: load when library and container exist
  function initLottie(containerId, url, opts) {
    var container = document.getElementById(containerId);
    if (!container || typeof lottie === 'undefined') return;

    var options = Object.assign(
      {
        container: container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
      },
      opts || {}
    );

    if (url) {
      options.path = url;
      try {
        lottie.loadAnimation(options);
      } catch (e) {
        console.warn('Lottie load failed for ' + containerId, e);
      }
    }
  }

  // Hero: subtle automation-style animation (free Lottie)
  initLottie(
    'hero-lottie',
    'https://assets2.lottiefiles.com/packages/lf20_1pxy2b.json',
    { loop: true, autoplay: true }
  );

  // Content generation section: template → output visual
  initLottie(
    'gen-lottie',
    'https://assets2.lottiefiles.com/packages/lf20_1pxy2b.json',
    { loop: true, autoplay: true }
  );

  // Optional: intersection observer for fade-in on scroll
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    document.querySelectorAll('.card, .platform-card, .flow-step').forEach(function (el) {
      el.classList.add('animate-on-scroll');
      observer.observe(el);
    });
  }

  // Add CSS for animate-on-scroll if not already present
  var style = document.createElement('style');
  style.textContent =
    '.animate-on-scroll { opacity: 0.85; transform: translateY(8px); transition: opacity 0.4s ease, transform 0.4s ease; }' +
    '.animate-on-scroll.is-visible { opacity: 1; transform: translateY(0); }';
  document.head.appendChild(style);

  // CTA: Add to Chrome — placeholder until Web Store link is available
  var ctaChrome = document.getElementById('cta-chrome');
  if (ctaChrome) {
    ctaChrome.addEventListener('click', function (e) {
      var href = ctaChrome.getAttribute('href');
      if (!href || href === '#') {
        e.preventDefault();
        if (ctaChrome.textContent.indexOf('Coming soon') === -1) {
          ctaChrome.textContent = 'Coming soon';
          ctaChrome.setAttribute('aria-label', 'Chrome Web Store link coming soon');
        }
      }
    });
  }
})();
