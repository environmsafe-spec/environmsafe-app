/* EnvironmSafe — Main JavaScript */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────
  const header     = document.getElementById('header');
  const hamburger  = document.getElementById('hamburger');
  const nav        = document.getElementById('nav');
  const backToTop  = document.getElementById('backToTop');
  const yearEl     = document.getElementById('year');
  const form       = document.getElementById('contactForm');

  // ── Current year ──────────────────────────────────────────
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ── Sticky header shadow ──────────────────────────────────
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
    backToTop.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });

  // ── Back to top ───────────────────────────────────────────
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Mobile nav toggle ─────────────────────────────────────
  hamburger.addEventListener('click', () => {
    const open = hamburger.classList.toggle('open');
    nav.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  });

  // Close nav on link click
  nav.querySelectorAll('.nav__link').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      nav.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  // ── Active nav link on scroll ─────────────────────────────
  const sections = document.querySelectorAll('section[id]');
  const navLinks  = document.querySelectorAll('.nav__link');

  const updateActiveLink = () => {
    let current = '';
    const offset = 100;
    sections.forEach(sec => {
      if (window.scrollY >= sec.offsetTop - offset) current = sec.id;
    });
    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  };
  window.addEventListener('scroll', updateActiveLink, { passive: true });

  // ── Intersection Observer — fade-up animations ────────────
  const fadeEls = document.querySelectorAll('.fade-up');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  fadeEls.forEach(el => observer.observe(el));

  // ── Counter animation ─────────────────────────────────────
  const counters = document.querySelectorAll('.stat-item__number[data-target]');
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el     = entry.target;
      const target = parseInt(el.dataset.target, 10);
      const duration = 1800;
      const step   = Math.ceil(duration / target);
      let current  = 0;
      const timer  = setInterval(() => {
        current += Math.ceil(target / (duration / 16));
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = current.toLocaleString();
      }, 16);
      counterObserver.unobserve(el);
    });
  }, { threshold: 0.5 });
  counters.forEach(el => counterObserver.observe(el));

  // ── Contact form validation ───────────────────────────────
  if (form) {
    const fields = {
      name:    { el: document.getElementById('name'),    err: document.getElementById('nameError'),    msg: 'Please enter your name.' },
      email:   { el: document.getElementById('email'),   err: document.getElementById('emailError'),   msg: 'Please enter a valid email address.' },
      service: { el: document.getElementById('service'), err: document.getElementById('serviceError'), msg: 'Please select a service.' },
      message: { el: document.getElementById('message'), err: document.getElementById('messageError'), msg: 'Please describe your project.' },
    };
    const success = document.getElementById('formSuccess');

    const showError = (field, msg) => {
      field.el.classList.add('error');
      field.err.textContent = msg;
      field.err.classList.add('show');
    };
    const clearError = (field) => {
      field.el.classList.remove('error');
      field.err.classList.remove('show');
    };

    const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

    const validate = () => {
      let ok = true;
      if (!fields.name.el.value.trim())    { showError(fields.name, fields.name.msg);       ok = false; } else clearError(fields.name);
      if (!isValidEmail(fields.email.el.value)) { showError(fields.email, fields.email.msg); ok = false; } else clearError(fields.email);
      if (!fields.service.el.value)        { showError(fields.service, fields.service.msg); ok = false; } else clearError(fields.service);
      if (!fields.message.el.value.trim()) { showError(fields.message, fields.message.msg); ok = false; } else clearError(fields.message);
      return ok;
    };

    // Live validation on blur
    Object.values(fields).forEach(f => {
      f.el.addEventListener('blur', () => {
        if (f.el.name === 'email') {
          if (!isValidEmail(f.el.value)) showError(f, f.msg); else clearError(f);
        } else {
          if (!f.el.value.trim() && f.el.tagName !== 'SELECT') showError(f, f.msg); else clearError(f);
          if (f.el.tagName === 'SELECT') { if (!f.el.value) showError(f, f.msg); else clearError(f); }
        }
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate()) return;
      // Simulate submission (replace with real backend/Formspree endpoint)
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.querySelector('.btn__text').textContent = 'Sending…';
      setTimeout(() => {
        btn.disabled = false;
        btn.querySelector('.btn__text').textContent = 'Send Message';
        form.reset();
        success.classList.add('show');
        setTimeout(() => success.classList.remove('show'), 5000);
      }, 1200);
    });
  }
})();
