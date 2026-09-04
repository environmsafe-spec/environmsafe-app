/* =============================================================================
   EnvironmSafe form submitter
   -----------------------------------------------------------------------------
   Posts a form to Google Forms through a hidden iframe. Google Forms sends no
   CORS headers, so a normal fetch() would be blocked; a form POST targeting an
   iframe is the one method that works from a static site.

   Because the response is cross-origin we cannot read it. So: we refuse to
   submit when the browser reports it is offline, and we never claim success
   before the request has actually left. Every success screen also shows the
   support email so nobody is ever stranded.
   ========================================================================== */
(function () {
  'use strict';

  var AR = document.documentElement.lang === 'ar';

  function t(en, ar) { return AR ? ar : en; }

  /* Reference code for anonymous complainants, e.g. ES-M4K2P-XQ7.
     No I/O/0/1 so it can be read aloud or written down without ambiguity. */
  function makeRef() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = '';
    for (var i = 0; i < 3; i++) r += A[Math.floor(Math.random() * A.length)];
    return 'ES-' + Date.now().toString(36).toUpperCase().slice(-5) + '-' + r;
  }

  function config(key) {
    var all = window.ES_FORMS || {};
    var c = all[key];
    if (!c || !c.formId) return null;
    return c;
  }

  /* Sends `data` (plain object) to the Google Form registered under `key`.
     done(ok, reason) - reason is 'offline' | 'not-configured' | null */
  function send(key, data, done) {
    var cfg = config(key);
    if (!cfg) { done(false, 'not-configured'); return; }
    if (navigator.onLine === false) { done(false, 'offline'); return; }

    var frameName = 'es-sink-' + Math.random().toString(36).slice(2);
    var frame = document.createElement('iframe');
    frame.name = frameName;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px';
    document.body.appendChild(frame);

    var form = document.createElement('form');
    form.method = 'POST';
    form.target = frameName;
    form.action = 'https://docs.google.com/forms/d/e/' + cfg.formId + '/formResponse';
    form.style.display = 'none';

    Object.keys(data).forEach(function (field) {
      var entry = cfg.entries[field];
      var value = data[field];
      if (!entry) return;
      if (Array.isArray(value)) value = value.join(', ');
      if (value === null || value === undefined || value === '') return;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = entry;
      input.value = String(value);
      form.appendChild(input);
    });

    document.body.appendChild(form);

    var settled = false;
    function finish(ok, why) {
      if (settled) return;
      settled = true;
      setTimeout(function () {
        try { form.parentNode.removeChild(form); } catch (e) {}
        try { frame.parentNode.removeChild(frame); } catch (e) {}
      }, 1000);
      done(ok, why || null);
    }

    /* Google loads its confirmation page into the iframe when it accepts the
       post. We also settle on a timer, because a cross-origin load event is
       not guaranteed to reach us in every browser. */
    frame.addEventListener('load', function () { finish(true); });
    setTimeout(function () { finish(true); }, 2500);

    form.submit();
  }

  /* Reads ?ref= and ?svc= (or ?service=) off the current URL. */
  function linkParams() {
    var p = new URLSearchParams(window.location.search);
    var clean = function (v) { return (v || '').toString().slice(0, 80).replace(/[<>]/g, ''); };
    return {
      ref: clean(p.get('ref')),
      svc: clean(p.get('svc') || p.get('service'))
    };
  }

  window.ESForms = {
    send: send,
    makeRef: makeRef,
    linkParams: linkParams,
    isConfigured: function (key) { return !!config(key); },
    t: t
  };
})();
