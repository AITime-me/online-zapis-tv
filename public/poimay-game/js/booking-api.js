(function () {
  'use strict';

  var DEFAULT_TIMEOUT = 8000;
  var IDEMPOTENCY_STORAGE_PREFIX = 'booking-idempotency:';

  function getBaseUrl() {
    if (window.GiftConfig) {
      return GiftConfig.getBookingApiBase();
    }
    if (window.BOOKING_API_BASE) {
      return window.BOOKING_API_BASE;
    }
    if (document.body && document.body.getAttribute('data-booking-api-base')) {
      return document.body.getAttribute('data-booking-api-base');
    }
    return '';
  }

  function normalizeBase(url) {
    return (url || '').replace(/\/$/, '');
  }

  function formatUuidFromBytes(bytes) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map
      .call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      })
      .join('');
    return (
      hex.slice(0, 8) +
      '-' +
      hex.slice(8, 12) +
      '-' +
      hex.slice(12, 16) +
      '-' +
      hex.slice(16, 20) +
      '-' +
      hex.slice(20)
    );
  }

  function generateIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('secure_random_unavailable');
    }
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return formatUuidFromBytes(bytes);
  }

  function resolveIdempotencyScope(data) {
    var playId = getPlayId(data.gamePlayId);
    if (playId) {
      return 'booking:poimay-game:' + playId;
    }
    return 'booking:poimay-game:regular';
  }

  function getOrCreateIdempotencyKey(scope) {
    var storageKey = IDEMPOTENCY_STORAGE_PREFIX + scope;
    try {
      var existing = sessionStorage.getItem(storageKey);
      if (existing) {
        return existing;
      }
      var created = generateIdempotencyKey();
      sessionStorage.setItem(storageKey, created);
      return created;
    } catch (_error) {
      return generateIdempotencyKey();
    }
  }

  function clearIdempotencyKey(scope) {
    try {
      sessionStorage.removeItem(IDEMPOTENCY_STORAGE_PREFIX + scope);
    } catch (_error) {
      // Ignore storage errors.
    }
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

  function getPlayId(explicitPlayId) {
    if (explicitPlayId) {
      return explicitPlayId;
    }
    if (window.PlaySession) {
      return PlaySession.getPlayId();
    }
    return null;
  }

  function getBookingUrl(playId) {
    var base = normalizeBase(getBaseUrl());
    if (!base) {
      return '';
    }

    var url = base + '/booking';
    var resolvedPlayId = getPlayId(playId);

    if (resolvedPlayId) {
      url += '?gamePlayId=' + encodeURIComponent(resolvedPlayId);
    }

    return url;
  }

  function submitRequest(data) {
    var base = normalizeBase(getBaseUrl());
    if (!base) {
      return Promise.reject(new Error('no_booking_api'));
    }

    var body = {
      clientName: data.clientName,
      clientPhone: data.clientPhone,
      type: data.type || 'MANAGER_REQUEST',
      personalDataConsent: data.personalDataConsent === true,
      offerAcknowledgement: data.offerAcknowledgement === true,
      gamePlayId: getPlayId(data.gamePlayId)
    };

    if (data.personalDataConsent !== true || data.offerAcknowledgement !== true) {
      return Promise.reject(new Error('consent_required'));
    }

    if (data.comment) {
      body.comment = data.comment;
    }

    var scope = resolveIdempotencyScope(data);
    var idempotencyKey = getOrCreateIdempotencyKey(scope);

    return fetchWithTimeout(
      base + '/api/booking/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(body)
      },
      DEFAULT_TIMEOUT
    ).then(function (payload) {
      if (payload && payload.ok) {
        clearIdempotencyKey(scope);
      }
      return payload;
    });
  }

  window.BookingApi = {
    getBaseUrl: getBaseUrl,
    getBookingUrl: getBookingUrl,
    submitRequest: submitRequest
  };
})();
