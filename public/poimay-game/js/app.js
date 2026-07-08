(function () {
  'use strict';

  var SCREENS = ['screen-start', 'screen-rules', 'screen-game', 'screen-result'];
  var currentPhrase = '';
  var toastTimer = null;

  function showScreen(id) {
    SCREENS.forEach(function (screenId) {
      var el = document.getElementById(screenId);
      el.classList.toggle('screen--active', screenId === id);
    });

    if (id === 'screen-game') {
      requestAnimationFrame(function () {
        Game.resize();
        Game.start(onGameComplete);
      });
    }
  }

  function setGiftLoading(isLoading) {
    var giftEl = document.getElementById('gift-value');
    var phraseEl = document.getElementById('result-phrase');
    if (!giftEl || !phraseEl) {
      return;
    }

    giftEl.classList.toggle('gift-value--loading', isLoading);

    if (isLoading) {
      giftEl.textContent = '';
      giftEl.setAttribute('aria-busy', 'true');
      phraseEl.textContent = '';
      currentPhrase = '';
      return;
    }

    giftEl.removeAttribute('aria-busy');
  }

  function applyGiftToResult(gift) {
    var giftEl = document.getElementById('gift-value');
    if (giftEl && gift.giftName) {
      giftEl.textContent = gift.giftName;
    }

    var phrase = gift.phrase || '';
    document.getElementById('result-phrase').textContent = phrase;
    currentPhrase = phrase;
  }

  function showResultCelebration() {
    requestAnimationFrame(function () {
      if (window.Confetti) {
        Confetti.burst();
      }
    });
  }

  function persistPlaySession(payload, gift, analytics) {
    if (!window.PlaySession || !payload) {
      return;
    }

    PlaySession.save({
      playId: gift.playId,
      giftId: gift.giftId,
      giftName: gift.giftName,
      gameDirection: payload.gameDirection,
      resultType: payload.resultType,
      skinNeed: payload.skinNeed,
      premiumLevel: payload.premiumLevel,
      score: analytics ? analytics.score : null
    });
  }

  function updateBookingLink() {
    var btn = document.getElementById('btn-vk');
    if (!btn || !window.BookingApi || !window.GiftConfig || !GiftConfig.hasBookingApi()) {
      return;
    }

    var bookingUrl = BookingApi.getBookingUrl();
    if (bookingUrl) {
      btn.href = bookingUrl;
    }
  }

  function onGameComplete(result) {
    var BRAND_RESULT_COPY = {
      faceCare: {
        title: 'Уход за кожей лица',
        explanation: 'В студии «Твоё время» подскажем процедуры, которые помогут коже выглядеть более молодой, ухоженной и сияющей.',
        phraseKey: 'уход за кожей лица'
      },
      toneCare: {
        title: 'Упругость и сияние кожи',
        explanation: 'Подберём процедуры, которые помогут коже выглядеть более ухоженной, поддержать упругость и сохранить красивое сияние.',
        phraseKey: 'упругость и сияние кожи'
      },
      recovery: {
        title: 'Массаж и восстановление',
        explanation: 'Подберём подходящий массаж, который поможет снять напряжение, почувствовать лёгкость и уделить внимание состоянию тела.',
        phraseKey: 'массаж и восстановление'
      },
      faceMassage: {
        title: 'Массаж лица и уход',
        explanation: 'Подберём процедуру, которая поможет расслабить мышцы лица, улучшить состояние кожи и подчеркнуть ухоженный вид.',
        phraseKey: 'массаж лица и уход'
      }
    };

    var key = result && result.key;
    var brandCopy = (key && BRAND_RESULT_COPY[key]) ? BRAND_RESULT_COPY[key] : null;

    if (brandCopy) {
      result.direction = brandCopy.title;
      result.explanation = brandCopy.explanation;
      // Важно: GiftApi.buildPhraseFromResult использует gameResult.phrase (marker " + подарок "),
      // поэтому заменяем и основу фразы тоже (подарок заменится на реальный).
      result.phrase = 'Игра: ' + brandCopy.phraseKey + ' + подарок уход для рук';
    }

    document.getElementById('result-direction').textContent = result.direction;
    document.getElementById('result-explanation').textContent = result.explanation;

    var payload = window.ResultAdapter ? ResultAdapter.toGiftPayload(result) : null;
    var analytics = window.ResultAdapter ? ResultAdapter.toAnalytics(result) : null;

    var fallbackGift = window.GiftApi
      ? GiftApi.getFallbackGift(result)
      : { playId: null, giftName: 'уход для рук', giftId: null, phrase: result.phrase };
    var useGiftApi = window.GiftApi &&
      window.GiftConfig &&
      GiftConfig.hasGiftApi() &&
      payload &&
      GiftApi.hasGiftAccessFactors(payload);

    showScreen('screen-result');

    if (!useGiftApi) {
      applyGiftToResult(fallbackGift);
      persistPlaySession(payload, fallbackGift, analytics);
      updateBookingLink();
      showResultCelebration();
      return;
    }

    setGiftLoading(true);

    GiftApi.selectGift(payload, result).then(function (gift) {
      setGiftLoading(false);
      applyGiftToResult(gift);
      persistPlaySession(payload, gift, analytics);
      updateBookingLink();
      showResultCelebration();
    });
  }

  function showToast(message, isError) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('toast--visible', 'toast--error');
    if (isError) toast.classList.add('toast--error');

    requestAnimationFrame(function () {
      toast.classList.add('toast--visible');
    });

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('toast--visible');
    }, 2800);
  }

  function copyPhrase() {
    var text = currentPhrase;
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () {
          showToast('Фраза скопирована');
        })
        .catch(function () {
          fallbackCopy(text);
        });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      var ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        showToast('Фраза скопирована');
      } else {
        showToast('Не получилось скопировать. Выделите фразу вручную.', true);
      }
    } catch (e) {
      document.body.removeChild(textarea);
      showToast('Не получилось скопировать. Выделите фразу вручную.', true);
    }
  }

  function bindEvents() {
    document.querySelector('[data-action="go-rules"]').addEventListener('click', function () {
      showScreen('screen-rules');
    });

    document.querySelector('[data-action="start-game"]').addEventListener('click', function () {
      showScreen('screen-game');
    });

    var backToStartBtn = document.querySelector('[data-action="back-to-start"]');
    if (backToStartBtn) {
      backToStartBtn.addEventListener('click', function () {
        showScreen('screen-start');
      });
    }

    var backToRulesBtn = document.querySelector('[data-action="back-to-rules"]');
    if (backToRulesBtn) {
      backToRulesBtn.addEventListener('click', function () {
        try {
          if (window.Game && typeof Game.stop === 'function') {
            Game.stop();
          }
        } catch (e) {
          // ignore
        }
        showScreen('screen-rules');
      });
    }

    var backFromResultBtn = document.querySelector('[data-action="back-from-result"]');
    if (backFromResultBtn) {
      backFromResultBtn.addEventListener('click', function () {
        showScreen('screen-rules');
      });
    }

    document.getElementById('btn-copy').addEventListener('click', copyPhrase);

    window.addEventListener('resize', function () {
      if (document.getElementById('screen-game').classList.contains('screen--active')) {
        Game.resize();
      }
    });
  }

  function initApp() {
    Game.init();
    bindEvents();
  }

  // SPA-переходы в Next.js не гарантируют повторный DOMContentLoaded.
  // Поэтому инициализируемся сразу, если DOM уже готов.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
