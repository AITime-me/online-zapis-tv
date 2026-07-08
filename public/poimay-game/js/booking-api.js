(function () {
  'use strict';

  var DEFAULT_TIMEOUT = 8000;

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
      consent: data.consent !== false,
      gamePlayId: getPlayId(data.gamePlayId)
    };

    if (data.comment) {
      body.comment = data.comment;
    }

    return fetchWithTimeout(base + '/api/booking/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, DEFAULT_TIMEOUT);
  }

  window.BookingApi = {
    getBaseUrl: getBaseUrl,
    getBookingUrl: getBookingUrl,
    submitRequest: submitRequest
  };
})();
