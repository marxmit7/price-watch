(function registerPriceWatchAdapters(root) {
  "use strict";

  var AMAZON_PRICE_SELECTORS = [
    "#corePrice_feature_div .a-price .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
    "#apex_desktop .a-price .a-offscreen",
    "#price_inside_buybox",
    "#priceblock_dealprice",
    "#priceblock_ourprice",
    "#priceblock_saleprice",
    ".a-price .a-offscreen"
  ];

  var FLIPKART_PRICE_SELECTORS = [
    "._30jeq3._16Jk6d",
    "._30jeq3",
    ".Nx9bqj.CxhGGd",
    ".Nx9bqj",
    ".CxhGGd",
    "._1_WHN1",
    "._25b18c ._30jeq3",
    "[class*='CxhGGd']",
    "[class*='Nx9bqj']",
    "[class*='_30jeq3']",
    "[class*='_1_WHN1']",
    "[class*='_16Jk6d']"
  ];

  function toUrl(rawUrl) {
    try {
      return new URL(rawUrl);
    } catch (error) {
      return null;
    }
  }

  function isAmazonHost(hostname) {
    return /(^|\.)amazon\.(com|in)$/i.test(hostname);
  }

  function isFlipkartHost(hostname) {
    return /(^|\.)flipkart\.com$/i.test(hostname);
  }

  function textFrom(node) {
    if (!node) {
      return "";
    }

    return (node.textContent || node.getAttribute("content") || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function firstText(documentRef, selectors) {
    for (var index = 0; index < selectors.length; index += 1) {
      var nodes = documentRef.querySelectorAll(selectors[index]);

      for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        var value = textFrom(nodes[nodeIndex]);

        if (value) {
          return value;
        }
      }
    }

    return "";
  }

  function firstAttribute(documentRef, selectors, attributes) {
    for (var index = 0; index < selectors.length; index += 1) {
      var nodes = documentRef.querySelectorAll(selectors[index]);

      for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        for (var attrIndex = 0; attrIndex < attributes.length; attrIndex += 1) {
          var value = nodes[nodeIndex].getAttribute(attributes[attrIndex]);

          if (value) {
            return value;
          }
        }
      }
    }

    return "";
  }

  function absoluteUrl(value, pageUrl) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, pageUrl).href;
    } catch (error) {
      return value;
    }
  }

  function parsePrice(rawText, defaultCurrency) {
    if (!rawText) {
      return null;
    }

    var text = String(rawText).replace(/\s+/g, " ").trim();
    var currency = defaultCurrency || "INR";

    if (text.indexOf("$") !== -1) {
      currency = "USD";
    } else if (text.indexOf("₹") !== -1 || /rs\.?|inr/i.test(text)) {
      currency = "INR";
    }

    var match = text.match(/(?:₹|\$|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);

    if (!match) {
      return null;
    }

    var amount = Number(match[1].replace(/,/g, ""));

    if (!Number.isFinite(amount)) {
      return null;
    }

    return {
      amount: amount,
      currency: currency,
      text: text
    };
  }

  function getMetaContent(documentRef, property) {
    var node = documentRef.querySelector(
      "meta[property='" + property + "'], meta[name='" + property + "']"
    );

    return node ? node.getAttribute("content") || "" : "";
  }

  function compactPriceText(value, defaultCurrency) {
    var parsed = parsePrice(value, defaultCurrency);

    if (!parsed) {
      return null;
    }

    return parsed;
  }

  function extractJsonLdPrice(documentRef, defaultCurrency) {
    var scripts = documentRef.querySelectorAll("script[type='application/ld+json']");

    for (var index = 0; index < scripts.length; index += 1) {
      var raw = scripts[index].textContent || "";

      if (!raw.trim()) {
        continue;
      }

      try {
        var parsed = JSON.parse(raw);
        var found = findPriceInStructuredData(parsed, defaultCurrency);

        if (found) {
          return found;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  function findPriceInStructuredData(value, defaultCurrency) {
    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      for (var index = 0; index < value.length; index += 1) {
        var arrayFound = findPriceInStructuredData(value[index], defaultCurrency);

        if (arrayFound) {
          return arrayFound;
        }
      }

      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    var offer = value.offers || value.offer || value.priceSpecification;
    var directPrice = value.price || value.lowPrice || value.highPrice || value.salePrice;
    var currency = value.priceCurrency || value.currency || defaultCurrency;

    if (directPrice !== undefined && directPrice !== null) {
      var directParsed = compactPriceText(String(directPrice), currency);

      if (directParsed) {
        return directParsed;
      }
    }

    if (offer) {
      var offerFound = findPriceInStructuredData(offer, currency);

      if (offerFound) {
        return offerFound;
      }
    }

    if (value["@graph"]) {
      return findPriceInStructuredData(value["@graph"], defaultCurrency);
    }

    return null;
  }

  function extractMetaPrice(documentRef, defaultCurrency) {
    var metaValues = [
      getMetaContent(documentRef, "product:price:amount"),
      getMetaContent(documentRef, "og:price:amount"),
      getMetaContent(documentRef, "twitter:data1"),
      getMetaContent(documentRef, "twitter:label1"),
      firstAttribute(documentRef, [
        "meta[itemprop='price']",
        "[itemprop='price']"
      ], [
        "content",
        "value"
      ]),
      firstText(documentRef, [
        "[itemprop='price']"
      ])
    ];

    for (var index = 0; index < metaValues.length; index += 1) {
      var parsed = compactPriceText(metaValues[index], defaultCurrency);

      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  function extractFlipkartEmbeddedPrice(documentRef) {
    var scripts = documentRef.querySelectorAll("script:not([src])");
    var patterns = [
      /"sellingPrice"\s*:\s*\{\s*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /"finalPrice"\s*:\s*\{\s*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /"price"\s*:\s*\{\s*"value"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /\\"sellingPrice\\"\s*:\s*\{\s*\\"value\\"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /\\"finalPrice\\"\s*:\s*\{\s*\\"value\\"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
    ];

    for (var scriptIndex = 0; scriptIndex < scripts.length; scriptIndex += 1) {
      var text = scripts[scriptIndex].textContent || "";

      if (text.indexOf("Price") === -1 && text.indexOf("price") === -1) {
        continue;
      }

      for (var patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
        var match = text.match(patterns[patternIndex]);

        if (match) {
          return compactPriceText(match[1], "INR");
        }
      }
    }

    return null;
  }

  function getAmazonProductKey(pageUrl, documentRef) {
    var url = toUrl(pageUrl);

    if (!url) {
      return "";
    }

    var asinFromPath = url.pathname.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    var asinFromQuery = url.searchParams.get("ASIN") || url.searchParams.get("asin");
    var fromDocument = "";

    if (asinFromPath) {
      return asinFromPath[1].toUpperCase();
    }

    if (asinFromQuery && /^[A-Z0-9]{10}$/i.test(asinFromQuery)) {
      return asinFromQuery.toUpperCase();
    }

    if (documentRef) {
      var asinInput = documentRef.querySelector("#ASIN, input[name='ASIN']");
      fromDocument = asinInput && asinInput.value ? asinInput.value.trim() : "";
    }

    if (fromDocument && /^[A-Z0-9]{10}$/i.test(fromDocument)) {
      return fromDocument.toUpperCase();
    }

    return "";
  }

  function getFlipkartProductKey(pageUrl) {
    var url = toUrl(pageUrl);

    if (!url) {
      return "";
    }

    var pid = url.searchParams.get("pid");
    var pathId = url.pathname.match(/\/p\/([^/?]+)/i);

    return (pid || (pathId ? pathId[1] : "") || "").trim();
  }

  function getStatus(documentRef) {
    var availability = firstText(documentRef, [
      "#availability",
      "[class*='availability']",
      "[class*='out-of-stock']"
    ]);

    if (/unavailable|out of stock|currently unavailable|sold out/i.test(availability)) {
      return "unavailable";
    }

    return "ok";
  }

  function extractAmazon(documentRef, pageUrl) {
    var url = toUrl(pageUrl);

    if (!url || !isAmazonHost(url.hostname)) {
      return null;
    }

    var productKey = getAmazonProductKey(pageUrl, documentRef);

    if (!productKey) {
      return null;
    }

    var priceText = firstText(documentRef, AMAZON_PRICE_SELECTORS);
    var parsedPrice = parsePrice(priceText, url.hostname.endsWith(".com") ? "USD" : "INR");
    var title = firstText(documentRef, [
      "#productTitle",
      "#title",
      "h1#title span",
      "h1 span",
      "h1",
      "meta[property='og:title']"
    ]) || getMetaContent(documentRef, "og:title");
    var image = firstAttribute(documentRef, [
      "#landingImage",
      "#imgTagWrapperId img",
      "#ebooksImgBlkFront",
      "[data-a-image-name='landingImage']"
    ], [
      "data-old-hires",
      "src"
    ]) || getMetaContent(documentRef, "og:image");

    return {
      id: "amazon:" + productKey,
      site: "amazon",
      siteName: "Amazon",
      productKey: productKey,
      title: title || "Amazon product " + productKey,
      image: absoluteUrl(image, pageUrl),
      url: url.origin + "/dp/" + productKey,
      pageUrl: pageUrl,
      price: parsedPrice ? parsedPrice.amount : null,
      priceText: parsedPrice ? parsedPrice.text : priceText,
      currency: parsedPrice ? parsedPrice.currency : (url.hostname.endsWith(".com") ? "USD" : "INR"),
      status: parsedPrice ? "ok" : getStatus(documentRef),
      capturedAt: new Date().toISOString()
    };
  }

  function extractFlipkart(documentRef, pageUrl) {
    var url = toUrl(pageUrl);

    if (!url || !isFlipkartHost(url.hostname)) {
      return null;
    }

    var productKey = getFlipkartProductKey(pageUrl);

    if (!productKey) {
      return null;
    }

    var priceText = firstText(documentRef, FLIPKART_PRICE_SELECTORS);
    var parsedPrice = parsePrice(priceText, "INR") ||
      extractJsonLdPrice(documentRef, "INR") ||
      extractMetaPrice(documentRef, "INR") ||
      extractFlipkartEmbeddedPrice(documentRef);
    var title = firstText(documentRef, [
      "span.B_NuCI",
      "h1 span",
      "h1",
      "meta[property='og:title']"
    ]) || getMetaContent(documentRef, "og:title");
    var image = firstAttribute(documentRef, [
      "img._396cs4",
      "img.DByuf4",
      ".CXW8mj img",
      "._1YokD2 img",
      "img[loading]",
      "img"
    ], [
      "src",
      "data-src"
    ]) || getMetaContent(documentRef, "og:image");
    var canonicalUrl = url.origin + url.pathname;

    if (url.searchParams.get("pid")) {
      canonicalUrl += "?pid=" + encodeURIComponent(url.searchParams.get("pid"));
    }

    return {
      id: "flipkart:" + productKey,
      site: "flipkart",
      siteName: "Flipkart",
      productKey: productKey,
      title: title || "Flipkart product " + productKey,
      image: absoluteUrl(image, pageUrl),
      url: canonicalUrl,
      pageUrl: pageUrl,
      price: parsedPrice ? parsedPrice.amount : null,
      priceText: parsedPrice ? parsedPrice.text : priceText,
      currency: "INR",
      status: parsedPrice ? "ok" : getStatus(documentRef),
      capturedAt: new Date().toISOString()
    };
  }

  function getSiteFromUrl(pageUrl) {
    var url = toUrl(pageUrl);

    if (!url) {
      return "";
    }

    if (isAmazonHost(url.hostname)) {
      return "amazon";
    }

    if (isFlipkartHost(url.hostname)) {
      return "flipkart";
    }

    return "";
  }

  function extractFromDocument(documentRef, pageUrl) {
    var site = getSiteFromUrl(pageUrl);

    if (site === "amazon") {
      return extractAmazon(documentRef, pageUrl);
    }

    if (site === "flipkart") {
      return extractFlipkart(documentRef, pageUrl);
    }

    return null;
  }

  function extractFromHtml(site, pageUrl, html) {
    var parser = new DOMParser();
    var documentRef = parser.parseFromString(html, "text/html");

    if (site === "amazon") {
      return extractAmazon(documentRef, pageUrl);
    }

    if (site === "flipkart") {
      return extractFlipkart(documentRef, pageUrl);
    }

    return extractFromDocument(documentRef, pageUrl);
  }

  var api = {
    extractFromDocument: extractFromDocument,
    extractFromHtml: extractFromHtml,
    getSiteFromUrl: getSiteFromUrl,
    parsePrice: parsePrice
  };

  root.PriceWatchAdapters = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
