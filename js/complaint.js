/* Complaints and concerns, from customers or employees, named or anonymous. */
(function () {
  'use strict';
  var E = window.ESForms; if (!E) return;
  var AR = document.documentElement.lang === 'ar';
  var t = E.t;

  var step1  = document.getElementById('cpStep1');
  if (!step1) return;
  var roleBox = document.getElementById('cpRole');
  var identBox = document.getElementById('cpIdent');
  var namedBlock = document.getElementById('cpNamedBlock');
  var anonNote = document.getElementById('cpAnonNote');
  var notice = document.getElementById('cpNotice');
  var details = document.getElementById('cpDetails');
  var detailsErr = document.getElementById('cpDetailsErr');
  var sendBtn = document.getElementById('cpSend');
  var done = document.getElementById('cpDone');

  var role = roleBox.querySelector('[aria-pressed="true"]').dataset.v;
  var ident = 'named';

  function wireSeg(box, onPick) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      onPick(b.dataset.v);
    });
  }

  wireSeg(roleBox, function (v) { role = v; });

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
    if (document.getElementById('cpHp').value) return;   // bot
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

    E.send('complaint', {
      refCode:  ref,
      role:     role,
      category: document.getElementById('cpCat').value,
      details:  details.value.trim(),
      place:    document.getElementById('cpPlace').value.trim(),
      name:     anon ? '' : document.getElementById('cpName').value.trim(),
      contact:  anon ? '' : document.getElementById('cpContact').value.trim(),
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
        document.getElementById('cpRef').textContent = ref;
        document.getElementById('cpRefWrap').style.display = '';
      }
      step1.style.display = 'none';
      done.classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
