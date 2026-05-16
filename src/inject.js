(function() {
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      if (this._url && this._url.includes('/api/timedtext') && this._url.includes('fmt=json3')) {
        try {
          const data = JSON.parse(this.responseText);
          window.postMessage({ type: 'YT_CAPTIONS_INTERCEPT', url: this._url, data: data }, '*');
        } catch(e) {}
      }
    });
    return originalXhrSend.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = async function() {
    const response = await originalFetch.apply(this, arguments);
    const url = arguments[0];
    if (typeof url === 'string' && url.includes('/api/timedtext') && url.includes('fmt=json3')) {
      try {
        const cloned = response.clone();
        cloned.json().then(data => {
          window.postMessage({ type: 'YT_CAPTIONS_INTERCEPT', url: url, data: data }, '*');
        }).catch(() => {});
      } catch(e) {}
    }
    return response;
  };
})();
