/* EnvironmSafe — Main JavaScript */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────
  const header    = document.getElementById('header');
  const hamburger = document.getElementById('hamburger');
  const nav       = document.getElementById('nav');
  const backToTop = document.getElementById('backToTop');
  const form      = document.getElementById('contactForm');

  // ── Current year ──────────────────────────────────────────
  document.querySelectorAll('.year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  // ── Active nav link (multi-page) ──────────────────────────
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';
  const pageKey = currentFile.replace('.html', '') || 'index';
  document.querySelectorAll('.nav__link[data-page]').forEach(link => {
    if (link.dataset.page === pageKey) link.classList.add('active');
  });

  // ── Sticky header shadow ──────────────────────────────────
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
    if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 400);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Back to top ───────────────────────────────────────────
  if (backToTop) {
    backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // ── Mobile nav toggle ─────────────────────────────────────
  hamburger.addEventListener('click', () => {
    const open = hamburger.classList.toggle('open');
    nav.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('.nav__link').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      nav.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  // ── Intersection Observer — fade-up animations ────────────
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

  // ── Counter animation ─────────────────────────────────────
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el     = entry.target;
      const target = parseInt(el.dataset.target, 10);
      let current  = 0;
      const timer  = setInterval(() => {
        current += Math.ceil(target / 60);
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = current.toLocaleString();
      }, 16);
      counterObserver.unobserve(el);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.stat-item__number[data-target]').forEach(el => counterObserver.observe(el));

  // ── Contact form validation ───────────────────────────────
  if (!form) return;

  const fields = {
    name:    { el: document.getElementById('name'),    err: document.getElementById('nameError'),    msg: 'Please enter your name.' },
    email:   { el: document.getElementById('email'),   err: document.getElementById('emailError'),   msg: 'Please enter a valid email address.' },
    service: { el: document.getElementById('service'), err: document.getElementById('serviceError'), msg: 'Please select a service.' },
    message: { el: document.getElementById('message'), err: document.getElementById('messageError'), msg: 'Please describe your project.' },
  };
  const successEl = document.getElementById('formSuccess');

  const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const showError = (f, msg) => {
    f.el.classList.add('error');
    f.err.textContent = msg;
    f.err.classList.add('show');
  };
  const clearError = (f) => {
    f.el.classList.remove('error');
    f.err.classList.remove('show');
  };

  const validateField = (f) => {
    if (f.el.name === 'email') {
      if (!isValidEmail(f.el.value)) { showError(f, f.msg); return false; }
    } else if (f.el.tagName === 'SELECT') {
      if (!f.el.value) { showError(f, f.msg); return false; }
    } else {
      if (!f.el.value.trim()) { showError(f, f.msg); return false; }
    }
    clearError(f);
    return true;
  };

  Object.values(fields).forEach(f => {
    f.el.addEventListener('blur', () => validateField(f));
    f.el.addEventListener('input', () => { if (f.el.classList.contains('error')) validateField(f); });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const allValid = Object.values(fields).map(validateField).every(Boolean);
    if (!allValid) return;

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.querySelector('.btn__text').textContent = 'Sending…';

    // Replace setTimeout body with a real fetch() to your form endpoint (e.g. Formspree)
    setTimeout(() => {
      btn.disabled = false;
      btn.querySelector('.btn__text').textContent = 'Send Message';
      form.reset();
      if (successEl) {
        successEl.classList.add('show');
        setTimeout(() => successEl.classList.remove('show'), 5000);
      }
    }, 1200);
  });

})();
