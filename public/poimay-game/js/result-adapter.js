(function () {
  'use strict';

  var DIRECTION_KEYS = ['faceCare', 'faceMassage', 'recovery', 'toneCare'];

  var SKIN_LABELS = ['уход', 'увлажнение', 'тонус', 'сияние'];

  var SKIN_NEED_MAP = {
    'увлажнение': 'hydration',
    'тонус': 'tone',
    'сияние': 'glow',
    'уход': 'care'
  };

  function countCatches(bucket) {
    if (!bucket) return 0;
    return Object.keys(bucket).reduce(function (sum, label) {
      return sum + (bucket[label] || 0);
    }, 0);
  }

  function resolveSkinNeed(gameResult) {
    if (gameResult.key === 'recovery') {
      return 'general';
    }

    var good = (gameResult.catches && gameResult.catches.good) || {};
    var bestLabel = null;
    var bestCount = 0;

    SKIN_LABELS.forEach(function (label) {
      var count = good[label] || 0;
      if (count > bestCount) {
        bestCount = count;
        bestLabel = label;
      }
    });

    if (!bestLabel || bestCount === 0) {
      return 'general';
    }

    return SKIN_NEED_MAP[bestLabel] || 'general';
  }

  function resolvePremiumLevel(gameResult) {
    var score = gameResult.score || 0;
    var negativeCount = countCatches(gameResult.catches && gameResult.catches.bad);

    if (score >= 70 && negativeCount <= 1) {
      return 3;
    }
    if (score >= 45) {
      return 2;
    }
    if (score >= 15 || negativeCount === 0) {
      return 1;
    }
    return 0;
  }

  function normalizeDirectionKey(key) {
    if (DIRECTION_KEYS.indexOf(key) !== -1) {
      return key;
    }
    return 'faceCare';
  }

  function toGiftPayload(gameResult) {
    var key = normalizeDirectionKey(gameResult.key);

    return {
      gameDirection: key,
      skinNeed: resolveSkinNeed(gameResult),
      resultType: key,
      premiumLevel: resolvePremiumLevel(gameResult)
    };
  }

  function getGiftAccessFactors(gameResult) {
    var payload = toGiftPayload(gameResult);

    return {
      premiumLevel: payload.premiumLevel,
      gameDirection: payload.gameDirection,
      resultType: payload.resultType
    };
  }

  function hasGiftAccessFactors(payload) {
    if (!payload) {
      return false;
    }

    return payload.gameDirection != null &&
      payload.resultType != null &&
      payload.premiumLevel != null;
  }

  function toAnalytics(gameResult) {
    return {
      score: gameResult.score,
      catches: JSON.parse(JSON.stringify(gameResult.catches || { good: {}, bad: {} }))
    };
  }

  window.ResultAdapter = {
    DIRECTION_KEYS: DIRECTION_KEYS,
    toGiftPayload: toGiftPayload,
    getGiftAccessFactors: getGiftAccessFactors,
    hasGiftAccessFactors: hasGiftAccessFactors,
    toAnalytics: toAnalytics
  };
})();
