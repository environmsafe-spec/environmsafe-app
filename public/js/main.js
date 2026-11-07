/* EnvironmSafe — Main JavaScript */

(function () {
  'use strict';

  const header    = document.getElementById('header');
  const hamburger = document.getElementById('hamburger');
  const nav       = document.getElementById('nav');
  const backToTop = document.getElementById('backToTop');
  const form      = document.getElementById('contactForm');

  // ── Quote form: pre-select the service a service page linked from ──
  // Service pages link to contact.html?service=<slug>; the matching <option>
  // carries data-svc="<slug>". Unknown or missing slugs leave the list alone.
  try {
    const svcSelect = document.getElementById('service');
    const svcSlug = new URLSearchParams(location.search).get('service');
    if (svcSelect && svcSlug && /^[a-z-]+$/.test(svcSlug)) {
      const opt = svcSelect.querySelector('option[data-svc="' + svcSlug + '"]');
      if (opt) opt.selected = true;
    }
  } catch (e) {}

  // ── Current year ──────────────────────────────────────────
  document.querySelectorAll('.year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  // Remember language: records the language of the last page viewed, so the root
  // redirect (functions/index.js) doesn't bounce English readers to Arabic.
  try {
    const pageLang = document.documentElement.lang === 'ar' ? 'ar' : 'en';
    document.cookie = 'es-lang=' + pageLang + '; path=/; max-age=2592000; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  } catch (e) {}

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

  // ── WhatsApp chat button ──────────────────────────────────
  // Added here rather than in each page so every public page gets it from one place.
  // Icons are inline SVG, not the Font Awesome CDN: when the icon font does not
  // load (common on slow mobile data) the buttons showed as empty circles.
  // Two copies: a floating button for wide screens, and a compact icon in the
  // header bar for phones, so nothing floats over the page content.
  const WA_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.43 9.43 0 0 1-4.8-1.31l-.35-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.21-4.24 9.45-9.45 9.45zm8.04-17.48A11.3 11.3 0 0 0 12.04.7C5.77.7.67 5.8.67 12.07c0 2 .52 3.96 1.52 5.68L.57 23.3l5.68-1.49a11.33 11.33 0 0 0 5.43 1.38h.01c6.27 0 11.37-5.1 11.37-11.37 0-3.04-1.18-5.9-3.33-8.04z"/></svg>';
  {
    const ar = document.documentElement.lang === 'ar';
    const text = ar ? 'مرحباً، أود طلب عرض سعر' : 'Hello, I would like to request a quote';
    const label = ar ? 'تواصلوا معنا عبر واتساب' : 'Chat with us on WhatsApp';
    const make = (cls) => {
      const a = document.createElement('a');
      a.className = cls;
      a.href = 'https://wa.me/967783402932?text=' + encodeURIComponent(text);
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', label);
      a.innerHTML = WA_SVG;
      return a;
    };
    document.body.appendChild(make('whatsapp-float'));
    if (hamburger && hamburger.parentNode) hamburger.parentNode.insertBefore(make('header-wa'), hamburger);
  }

  // Back-to-top arrow as inline SVG too (same reason as above).
  if (backToTop) {
    backToTop.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
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
