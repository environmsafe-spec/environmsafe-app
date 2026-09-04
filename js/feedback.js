/* Post-service feedback: pick a face, optionally say more, send. */
(function () {
  'use strict';
  var E = window.ESForms; if (!E) return;
  var AR = document.documentElement.lang === 'ar';
  var t = E.t;

  var step1 = document.getElementById('fbStep1');
  var more  = document.getElementById('fbMore');
  var chips = document.getElementById('fbChips');
  var qEl   = document.getElementById('fbReasonQ');
  var done  = document.getElementById('fbDone');
  var notice= document.getElementById('fbNotice');
  var sendBtn = document.getElementById('fbSend');
  if (!step1) return;

  var LABEL = {
    bad:  t('Not good', 'غير جيد'),
    ok:   t('Okay', 'مقبول'),
    good: t('Great', 'ممتاز')
  };
  var Q = {
    neg: t('What let us down? <span class="tool__hint">optional, choose any</span>',
           'ما الذي لم يعجبك؟ <span class="tool__hint">اختياري، اختر ما ينطبق</span>'),
    pos: t('What went well? <span class="tool__hint">optional, choose any</span>',
           'ما الذي أعجبك؟ <span class="tool__hint">اختياري، اختر ما ينطبق</span>')
  };
  var CHIPS = {
    neg: AR ? ['استغرق وقتاً طويلاً','ضعف التواصل','جودة العمل','سلوك الفريق','السعر','شيء آخر']
            : ['Took too long','Poor communication','Quality of work','Staff conduct','Price','Something else'],
    pos: AR ? ['في الوقت المحدد','تواصل واضح','جودة العمل','فريق محترف','قيمة جيدة','شيء آخر']
            : ['On time','Clear communication','Quality of work','Professional team','Good value','Something else']
  };

  var rating = null;
  var picked = [];

  /* Show the job reference and service from the link, so the customer sees
     we know which visit this is about. */
  (function showContext() {
    var p = E.linkParams();
    var box = document.getElementById('fbContext');
    var bits = [];
    if (p.svc) bits.push('<span class="tool__chip-static">' + t('Service', 'الخدمة') + ': <strong>' + prettySvc(p.svc) + '</strong></span>');
    if (p.ref) bits.push('<span class="tool__chip-static">' + t('Job', 'رقم العمل') + ': <strong>' + esc(p.ref) + '</strong></span>');
    box.innerHTML = bits.join('');
  })();

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* Known service slugs get their proper name; anything else is title-cased. */
  var SVC = {
    'hse':                     ['HSE', 'الصحة والسلامة والبيئة'],
    'evaluation':              ['Evaluation', 'التقييم'],
    'lpg-systems':             ['LPG Systems', 'أنظمة الغاز LPG'],
    'lpg':                     ['LPG Systems', 'أنظمة الغاز LPG'],
    'inspection-monitoring':   ['Inspection & Monitoring', 'الفحص والمراقبة'],
    'inspection':              ['Inspection & Monitoring', 'الفحص والمراقبة'],
    'engineering-construction':['Engineering & Construction', 'الهندسة والإنشاء'],
    'engineering':             ['Engineering & Construction', 'الهندسة والإنشاء'],
    'hvac':                    ['HVAC', 'تكييف الهواء والتهوية'],
    'maintenance':             ['Maintenance & Parts', 'الصيانة وقطع الغيار'],
    'training':                ['Training', 'التدريب'],
    'fire-protection':         ['Fire Protection', 'الحماية من الحرائق']
  };
  function prettySvc(s) {
    var hit = SVC[s.toLowerCase()];
    if (hit) return esc(AR ? hit[1] : hit[0]);
    return esc(s.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }));
  }

  function renderChips(kind) {
    qEl.innerHTML = Q[kind];
    chips.innerHTML = '';
    picked = [];
    CHIPS[kind].forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var on = b.getAttribute('aria-pressed') === 'true';
        b.setAttribute('aria-pressed', on ? 'false' : 'true');
        if (on) picked = picked.filter(function (x) { return x !== label; });
        else picked.push(label);
      });
      chips.appendChild(b);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.face'), function (btn) {
    btn.addEventListener('click', function () {
      rating = btn.dataset.v;
      Array.prototype.forEach.call(document.querySelectorAll('.face'), function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderChips(rating === 'good' ? 'pos' : 'neg');
      more.classList.add('open');
      setTimeout(function () { sendBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 260);
    });
  });

  function showNotice(html) {
    notice.querySelector('span').innerHTML = html;
    notice.classList.add('show');
  }

  sendBtn.addEventListener('click', function () {
    if (!rating) return;
    if (document.getElementById('fbHp').value) return;   // bot
    notice.classList.remove('show');

    var txt = sendBtn.querySelector('.btn__text');
    var original = txt.textContent;
    sendBtn.disabled = true;
    txt.textContent = t('Sending…', 'جارٍ الإرسال…');

    var p = E.linkParams();
    E.send('feedback', {
      rating:  LABEL[rating],
      reasons: picked,
      comment: document.getElementById('fbComment').value.trim(),
      jobRef:  p.ref,
      service: p.svc,
      name:    document.getElementById('fbName').value.trim(),
      contact: document.getElementById('fbContact').value.trim(),
      lang:    AR ? 'ar' : 'en'
    }, function (ok, why) {
      sendBtn.disabled = false;
      txt.textContent = original;
      if (!ok) {
        showNotice(why === 'offline'
          ? t('You appear to be offline, so nothing was sent. Please try again when you have a connection, or email <a href="mailto:support@environmsafe.com">support@environmsafe.com</a>.',
              'يبدو أنك غير متصل بالإنترنت، لذلك لم يُرسل شيء. حاول مجدداً عند توفر الاتصال، أو راسلنا على <a href="mailto:support@environmsafe.com">support@environmsafe.com</a>.')
          : t('This form is not connected to its inbox yet, so nothing was sent. Please email <a href="mailto:support@environmsafe.com">support@environmsafe.com</a> instead.',
              'هذا النموذج غير موصول بصندوق الوارد بعد، لذلك لم يُرسل شيء. يرجى مراسلتنا على <a href="mailto:support@environmsafe.com">support@environmsafe.com</a>.'));
        return;
      }
      var low = rating !== 'good';
      document.getElementById('fbDoneIcon').className = 'tool__result-icon' + (low ? ' tool__result-icon--warn' : '');
      document.getElementById('fbDoneIcon').innerHTML = '<i class="fa-solid ' + (low ? 'fa-headset' : 'fa-check') + '"></i>';
      document.getElementById('fbDoneH').textContent = low
        ? t('Thank you for telling us', 'شكراً لإخبارنا')
        : t('Thank you', 'شكراً لك');
      document.getElementById('fbDoneP').textContent = low
        ? t('We take this seriously. Our management team reviews every low rating, and if you left your contact details we will be in touch.',
            'نأخذ هذا على محمل الجد. يراجع فريق الإدارة كل تقييم منخفض، وإذا تركت بيانات التواصل فسنعاود الاتصال بك.')
        : t('Your feedback has been recorded and goes to our management team.',
            'تم تسجيل تقييمك وسيصل إلى فريق الإدارة لدينا.');
      step1.style.display = 'none';
      done.classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
