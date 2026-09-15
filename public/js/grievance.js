/* Staff complaints and grievances. Named or anonymous. */
(function () {
  'use strict';
  var E = window.ESForms; if (!E) return;
  var AR = document.documentElement.lang === 'ar';
  var t = E.t;

  var step1 = document.getElementById('gvStep1');
  if (!step1) return;
  var roleBox    = document.getElementById('gvRole');
  var raisedBox  = document.getElementById('gvRaised');
  var identBox   = document.getElementById('gvIdent');
  var namedBlock = document.getElementById('gvNamedBlock');
  var anonNote   = document.getElementById('gvAnonNote');
  var notice     = document.getElementById('gvNotice');
  var details    = document.getElementById('gvDetails');
  var detailsErr = document.getElementById('gvDetailsErr');
  var sendBtn    = document.getElementById('gvSend');
  var done       = document.getElementById('gvDone');

  function pressed(box) { return box.querySelector('[aria-pressed="true"]').dataset.v; }

  var role   = pressed(roleBox);
  var raised = pressed(raisedBox);
  var ident  = 'named';

  function wireSeg(box, onPick) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      onPick(b.dataset.v);
    });
  }

  wireSeg(roleBox,   function (v) { role = v; });
  wireSeg(raisedBox, function (v) { raised = v; });

  wireSeg(identBox, function (v) {
    ident = v;
    var anon = v === 'anon';
    namedBlock.style.display = anon ? 'none' : '';
    anonNote.classList.toggle('show', anon);
  });

  details.addEventListener('input', function () {
    if (details.value.trim()) {
      details.classList.remove('error');
      detailsErr.classList.remove('show');
    }
  });

  sendBtn.addEventListener('click', function () {
    if (document.getElementById('gvHp').value) return;   // bot
    notice.classList.remove('show');

    if (!details.value.trim()) {
      details.classList.add('error');
      detailsErr.classList.add('show');
      details.focus();
      return;
    }

    var anon = ident === 'anon';
    var ref = E.makeRef();
    var txt = sendBtn.querySelector('.btn__text');
    var original = txt.textContent;
    sendBtn.disabled = true;
    txt.textContent = t('Sending…', 'جارٍ الإرسال…');

    E.send('grievance', {
      refCode:  ref,
      role:     role,
      dept:     document.getElementById('gvDept').value.trim(),
      category: document.getElementById('gvCat').value,
      details:  details.value.trim(),
      outcome:  document.getElementById('gvOutcome').value.trim(),
      raised:   raised,
      place:    document.getElementById('gvPlace').value.trim(),
      name:     anon ? '' : document.getElementById('gvName').value.trim(),
      contact:  anon ? '' : document.getElementById('gvContact').value.trim(),
      lang:     AR ? 'ar' : 'en'
    }, function (ok, why) {
      sendBtn.disabled = false;
      txt.textContent = original;
      if (!ok) {
        notice.querySelector('span').innerHTML = (why === 'offline')
          ? t('You appear to be offline, so nothing was sent. Please try again when you have a connection, or email <a href="mailto:support@environmsafe.com">support@environmsafe.com</a>.',
              'يبدو أنك غير متصل بالإنترنت، لذلك لم يُرسل شيء. حاول مجدداً عند توفر الاتصال، أو راسلنا على <a href="mailto:support@environmsafe.com">support@environmsafe.com</a>.')
          : t('This form is not connected to its inbox yet, so nothing was sent. Please email <a href="mailto:support@environmsafe.com">support@environmsafe.com</a> instead.',
              'هذا النموذج غير موصول بصندوق الوارد بعد، لذلك لم يُرسل شيء. يرجى مراسلتنا على <a href="mailto:support@environmsafe.com">support@environmsafe.com</a>.');
        notice.classList.add('show');
        return;
      }
      if (anon) {
        document.getElementById('gvRef').textContent = ref;
        document.getElementById('gvRefWrap').style.display = '';
      }
      step1.style.display = 'none';
      done.classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
