(function () {
  'use strict';

  var DEFAULT_TIMEOUT = 6000;
  var FALLBACK_GIFT_NAME = 'уход для рук';

  function resolveRequestUrl(url) {
    if (!url) {
      return '';
    }

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return url;
    }

    var origin = window.location.origin;
    if (!origin || origin === 'null' || origin.indexOf('file:') === 0) {
      return '';
    }

    if (url.charAt(0) === '/') {
      return origin + url;
    }

    return origin + '/' + url;
  }

  function getApiUrl() {
    var configuredUrl = '';

    if (window.GiftConfig) {
      configuredUrl = GiftConfig.getGiftApiUrl();
    } else if (window.GIFT_API_URL) {
      configuredUrl = window.GIFT_API_URL;
    } else if (document.body && document.body.getAttribute('data-gift-api-url')) {
      configuredUrl = document.body.getAttribute('data-gift-api-url');
    }

    return resolveRequestUrl(configuredUrl);
  }

  function hasGiftAccessFactors(payload) {
    if (window.ResultAdapter && ResultAdapter.hasGiftAccessFactors) {
      return ResultAdapter.hasGiftAccessFactors(payload);
    }

    return !!(payload &&
      payload.gameDirection != null &&
      payload.resultType != null &&
      payload.premiumLevel != null);
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('timeout'));
      }, timeoutMs);

      fetch(url, options)
        .then(function (response) {
          clearTimeout(timer);
          if (!response.ok) {
            reject(new Error('http_' + response.status));
            return null;
          }
          return response.json();
        })
        .then(function (data) {
          if (data !== null && data !== undefined) {
            resolve(data);
          }
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function normalizeGiftResponse(data, gameResult) {
    if (!data || typeof data !== 'object') {
      return null;
    }

    if (data.ok === false) {
      return null;
    }

    var playId = data.playId || data.play_id || null;
    var fallback = getFallbackGift(gameResult);

    if (data.gift && typeof data.gift === 'object') {
      var nestedGiftName = data.gift.name || data.gift.giftName || '';
      if (!nestedGiftName) {
        if (playId) {
          fallback.playId = playId;
        }
        return fallback;
      }

      return {
        playId: playId,
        giftName: nestedGiftName,
        giftId: data.gift.id || data.gift.giftId || null,
        phrase: data.phrase || null,
        fromApi: true
      };
    }

    var giftName = data.giftName || data.gift_name || '';
    if (!giftName) {
      if (playId) {
        fallback.playId = playId;
      }
      return fallback;
    }

    return {
      playId: playId,
      giftName: giftName,
      giftId: data.giftId || data.gift_id || null,
      phrase: data.phrase || null,
      fromApi: true
    };
  }

  function buildPhraseFromResult(gameResult, giftName) {
    var base = gameResult.phrase || '';
    var marker = ' + подарок ';
    var markerIndex = base.indexOf(marker);

    if (markerIndex !== -1) {
      return base.slice(0, markerIndex + marker.length) + giftName;
    }

    return 'Игра: ' + (gameResult.direction || '') + ' + подарок ' + giftName;
  }

  function getFallbackGift(gameResult) {
    return {
      playId: null,
      giftName: FALLBACK_GIFT_NAME,
      giftId: null,
      phrase: gameResult.phrase,
      fromApi: false
    };
  }

  function selectGift(payload, gameResult) {
    var url = getApiUrl();

    if (!url) {
      return Promise.resolve(getFallbackGift(gameResult));
    }

    if (!hasGiftAccessFactors(payload)) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[GiftApi] incomplete gift access factors, using fallback');
      }
      return Promise.resolve(getFallbackGift(gameResult));
    }

    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, DEFAULT_TIMEOUT)
      .then(function (data) {
        var gift = normalizeGiftResponse(data, gameResult);
        if (!gift) {
          return getFallbackGift(gameResult);
        }
        if (!gift.phrase) {
          gift.phrase = buildPhraseFromResult(gameResult, gift.giftName);
        }

        return gift;
      })
      .catch(function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[GiftApi] fallback:', err.message || err);
        }
        return getFallbackGift(gameResult);
      });
  }

  window.GiftApi = {
    selectGift: selectGift,
    getFallbackGift: getFallbackGift,
    hasGiftAccessFactors: hasGiftAccessFactors
  };
})();
