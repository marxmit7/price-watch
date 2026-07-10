"use strict";

chrome.runtime.onMessage.addListener(function onMessage(message, sender, sendResponse) {
  if (!message || message.target !== "offscreen" || message.type !== "PARSE_PRODUCT_HTML") {
    return false;
  }

  try {
    var payload = message.payload || {};
    var product = PriceWatchAdapters.extractFromHtml(payload.site, payload.url, payload.html);

    if (!product) {
      sendResponse({
        ok: false,
        error: "No supported product data found in fetched page"
      });
      return true;
    }

    sendResponse({
      ok: true,
      product: product
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }

  return true;
});
