/* EnvironmSafe — Main JavaScript */

(function () {
  'use strict';

  const header    = document.getElementById('header');
  const hamburger = document.getElementById('hamburger');
  const nav       = document.getElementById('nav');
  const backToTop = document.getElementById('backToTop');
  const form      = document.getElementById('contactForm');

  // ── Current year ──────────────────────────────────────────
  document.querySelectorAll('.year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  // ── Active nav link ───────────────────────────────────────
  const currentFile = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link[data-page]').forEach(link => {
    const pageKey = currentFile.replace('.html', '') || 'index';
    if (link.dataset.page === pageKey) link.classList.add('active');
  });
  document.querySelectorAll('.nav__dropdown-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.split('/').pop() === currentFile) {
      link.classList.add('active');
      link.closest('.nav__item--dropdown')?.querySelector('.nav__dropdown-toggle')?.classList.add('active');
    }
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
  nav.querySelectorAll('a.nav__link, a.nav__dropdown-link').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      nav.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });

  // ── Services dropdown ─────────────────────────────────────
  const dropdownItems = document.querySelectorAll('.nav__item--dropdown');
  dropdownItems.forEach(item => {
    const toggle = item.querySelector('.nav__dropdown-toggle');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = item.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      dropdownItems.forEach(other => {
        if (other !== item) {
          other.classList.remove('open');
          other.querySelector('.nav__dropdown-toggle').setAttribute('aria-expanded', 'false');
        }
      });
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav__item--dropdown')) {
      dropdownItems.forEach(item => {
        item.classList.remove('open');
        item.querySelector('.nav__dropdown-toggle').setAttribute('aria-expanded', 'false');
      });
    }
  });

  // ── Intersection Observer — fade-up ───────────────────────
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
    name:    { el: document.getElementById('name'),    err: document.getElementById('nameError'),    msg: document.documentElement.lang === 'ar' ? 'يرجى إدخال اسمك.' : 'Please enter your name.' },
    email:   { el: document.getElementById('email'),   err: document.getElementById('emailError'),   msg: document.documentElement.lang === 'ar' ? 'يرجى إدخال بريد إلكتروني صحيح.' : 'Please enter a valid email address.' },
    service: { el: document.getElementById('service'), err: document.getElementById('serviceError'), msg: document.documentElement.lang === 'ar' ? 'يرجى اختيار خدمة.' : 'Please select a service.' },
    message: { el: document.getElementById('message'), err: document.getElementById('messageError'), msg: document.documentElement.lang === 'ar' ? 'يرجى وصف مشروعك.' : 'Please describe your project.' },
  };
  const successEl = document.getElementById('formSuccess');

  const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const showError = (f, msg) => { f.el.classList.add('error'); f.err.textContent = msg; f.err.classList.add('show'); };
  const clearError = (f) => { f.el.classList.remove('error'); f.err.classList.remove('show'); };

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
    const textEl = btn.querySelector('.btn__text');
    btn.disabled = true;
    if (textEl) textEl.textContent = document.documentElement.lang === 'ar' ? 'جارٍ الإرسال…' : 'Sending…';

    const AR = document.documentElement.lang === 'ar';
    const restore = () => {
      btn.disabled = false;
      if (textEl) textEl.textContent = AR ? 'إرسال الرسالة' : 'Send Message';
    };

    // Real submission. Previously this only pretended to send.
    if (!window.ESForms) { restore(); return; }
    window.ESForms.send('contact', {
      name:    (fields.name    && fields.name.el.value.trim())    || '',
      company: (document.getElementById('company') || {}).value   || '',
      email:   (fields.email   && fields.email.el.value.trim())   || '',
      phone:   (document.getElementById('phone')   || {}).value   || '',
      service: (fields.service && fields.service.el.value)        || '',
      message: (fields.message && fields.message.el.value.trim()) || '',
      lang:    AR ? 'ar' : 'en'
    }, (ok, why) => {
      restore();
      if (!ok) {
        alert(why === 'offline'
          ? (AR ? 'يبدو أنك غير متصل بالإنترنت، لذلك لم تُرسل الرسالة. يرجى المحاولة مجدداً أو مراسلتنا على support@environmsafe.com'
                : 'You appear to be offline, so nothing was sent. Please try again, or email support@environmsafe.com')
          : (AR ? 'تعذّر إرسال الرسالة. يرجى مراسلتنا مباشرة على support@environmsafe.com'
                : 'We could not send your message. Please email us directly at support@environmsafe.com'));
        return;
      }
      form.reset();
      if (successEl) {
        successEl.classList.add('show');
        setTimeout(() => successEl.classList.remove('show'), 8000);
      }
    });
  });

})();
