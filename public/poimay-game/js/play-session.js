(function () {
  'use strict';

  var STORAGE_KEY = 'tvoiovremya_play_session';
  var memorySession = null;

  function save(data) {
    var session = {
      playId: data.playId || null,
      giftId: data.giftId || null,
      giftName: data.giftName || null,
      gameDirection: data.gameDirection || null,
      resultType: data.resultType || null,
      skinNeed: data.skinNeed || null,
      premiumLevel: data.premiumLevel != null ? data.premiumLevel : null,
      activationConditionText: data.activationConditionText || null,
      validityDays:
        typeof data.validityDays === 'number' ? data.validityDays : null,
      score: data.score != null ? data.score : null,
      savedAt: new Date().toISOString()
    };

    memorySession = session;

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
      // sessionStorage may be unavailable
    }

    return session;
  }

  function get() {
    if (memorySession) {
      return memorySession;
    }

    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        memorySession = JSON.parse(raw);
        return memorySession;
      }
    } catch (e) {
      // ignore read errors
    }

    return null;
  }

  function getPlayId() {
    var session = get();
    return session && session.playId ? session.playId : null;
  }

  function clear() {
    memorySession = null;

    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore clear errors
    }
  }

  function beginNewAttempt() {
    clear();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('poimay-game:new-attempt'));
    }
  }

  window.PlaySession = {
    save: save,
    get: get,
    getPlayId: getPlayId,
    clear: clear,
    beginNewAttempt: beginNewAttempt
  };
})();
