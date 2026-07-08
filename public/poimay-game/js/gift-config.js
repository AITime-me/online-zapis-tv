(function () {
  'use strict';

  var overrides = {
    giftApiUrl: '',
    bookingApiBase: ''
  };

  function readDataAttr(name) {
    if (!document.body) {
      return '';
    }
    return document.body.getAttribute(name) || '';
  }

  function getSameOrigin() {
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
      return '';
    }

    var origin = window.location.origin;
    if (!origin || origin === 'null' || origin.indexOf('file:') === 0) {
      return '';
    }

    return origin.replace(/\/$/, '');
  }

  function resolveDefaultGiftApiUrl() {
    return '/api/game/play';
  }

  function resolveDefaultBookingApiBase() {
    return getSameOrigin();
  }

  function getGiftApiUrl() {
    if (overrides.giftApiUrl) {
      return overrides.giftApiUrl;
    }
    if (window.GIFT_API_URL) {
      return window.GIFT_API_URL;
    }
    var dataAttrUrl = readDataAttr('data-gift-api-url');
    if (dataAttrUrl) {
      return dataAttrUrl;
    }
    return resolveDefaultGiftApiUrl();
  }

  function getBookingApiBase() {
    if (overrides.bookingApiBase) {
      return overrides.bookingApiBase;
    }
    if (window.BOOKING_API_BASE) {
      return window.BOOKING_API_BASE;
    }
    var dataAttrBase = readDataAttr('data-booking-api-base');
    if (dataAttrBase) {
      return dataAttrBase;
    }
    return resolveDefaultBookingApiBase();
  }

  function setGiftApiUrl(url) {
    overrides.giftApiUrl = url || '';
  }

  function setBookingApiBase(url) {
    overrides.bookingApiBase = url || '';
  }

  function canResolveGiftApiUrl() {
    var url = getGiftApiUrl();
    if (!url) {
      return false;
    }
    if (/^https?:\/\//i.test(url)) {
      return true;
    }
    return !!getSameOrigin();
  }

  function hasGiftApi() {
    return canResolveGiftApiUrl();
  }

  function hasBookingApi() {
    return !!getBookingApiBase();
  }

  window.GiftConfig = {
    getGiftApiUrl: getGiftApiUrl,
    getBookingApiBase: getBookingApiBase,
    setGiftApiUrl: setGiftApiUrl,
    setBookingApiBase: setBookingApiBase,
    hasGiftApi: hasGiftApi,
    hasBookingApi: hasBookingApi
  };
})();
