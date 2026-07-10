"use strict";

var ALARM_NAME = "local-price-watch-refresh";
var ALARM_PERIOD_MINUTES = 180;
var HISTORY_LIMIT = 730;
var MIN_PAGE_HISTORY_INTERVAL_MS = 30 * 60 * 1000;
var MIN_BACKGROUND_HISTORY_INTERVAL_MS = 2 * 60 * 60 * 1000;
var REFRESH_LOCK_KEY = "refreshLock";
var REFRESH_LOCK_TTL_MS = 20 * 60 * 1000;
var PRODUCTS_KEY = "trackedProducts";
var OFFSCREEN_DOCUMENT_PATH = "src/background/offscreen.html";
var refreshPromise = null;
var creatingOffscreenDocument = null;

chrome.runtime.onInstalled.addListener(function onInstalled() {
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(function onStartup() {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener(function onAlarm(alarm) {
  if (alarm.name === ALARM_NAME) {
    runPriceRefresh("alarm");
  }
});

chrome.runtime.onMessage.addListener(function onMessage(message, sender, sendResponse) {
  if (!message || message.target === "offscreen") {
    return false;
  }

  handleMessage(message, sender)
    .then(function respond(response) {
      sendResponse(response);
    })
    .catch(function respondWithError(error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });

  return true;
});

function handleMessage(message) {
  if (message.type === "PRODUCT_PAGE_SEEN") {
    return handleProductPageSeen(message.product);
  }

  if (message.type === "ENSURE_ALARM") {
    return ensureAlarm().then(function alarmEnsured(alarm) {
      return {
        ok: true,
        alarm: alarm
      };
    });
  }

  if (message.type === "GET_PRODUCTS") {
    return getProductList().then(function productsLoaded(products) {
      return {
        ok: true,
        products: products
      };
    });
  }

  if (message.type === "REMOVE_PRODUCT") {
    return removeProduct(message.productId);
  }

  if (message.type === "RUN_PRICE_REFRESH_NOW") {
    runPriceRefresh("manual");

    return Promise.resolve({
      ok: true,
      started: true
    });
  }

  return Promise.resolve({
    ok: false,
    error: "Unknown message type: " + message.type
  });
}

async function handleProductPageSeen(productSnapshot) {
  await ensureAlarm();

  var product = normalizeProduct(productSnapshot);

  if (!product) {
    return {
      ok: false,
      error: "This page does not look like a supported product page."
    };
  }

  var savedProduct = await upsertProduct(product, {
    source: "page",
    minHistoryIntervalMs: MIN_PAGE_HISTORY_INTERVAL_MS
  });

  return {
    ok: true,
    product: savedProduct
  };
}

function storageGet(keys) {
  return new Promise(function resolveStorageGet(resolve) {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(items) {
  return new Promise(function resolveStorageSet(resolve, reject) {
    chrome.storage.local.set(items, function onSet() {
      var error = chrome.runtime.lastError;

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function alarmsGet(name) {
  return new Promise(function resolveAlarmGet(resolve) {
    chrome.alarms.get(name, resolve);
  });
}

function alarmsCreate(name, details) {
  return new Promise(function resolveAlarmCreate(resolve) {
    chrome.alarms.create(name, details);
    resolve();
  });
}

async function ensureAlarm() {
  var existingAlarm = await alarmsGet(ALARM_NAME);

  if (existingAlarm) {
    return {
      name: existingAlarm.name,
      scheduledTime: existingAlarm.scheduledTime,
      periodInMinutes: existingAlarm.periodInMinutes,
      created: false
    };
  }

  await alarmsCreate(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: ALARM_PERIOD_MINUTES
  });

  var createdAlarm = await alarmsGet(ALARM_NAME);

  return {
    name: ALARM_NAME,
    scheduledTime: createdAlarm ? createdAlarm.scheduledTime : null,
    periodInMinutes: ALARM_PERIOD_MINUTES,
    created: true
  };
}

async function getProductsMap() {
  var data = await storageGet(PRODUCTS_KEY);
  return data[PRODUCTS_KEY] || {};
}

async function setProductsMap(products) {
  var update = {};
  update[PRODUCTS_KEY] = products;
  await storageSet(update);
}

async function getProductList() {
  var products = await getProductsMap();

  return Object.keys(products)
    .map(function mapProduct(key) {
      return products[key];
    })
    .sort(function sortByLastSeen(left, right) {
      return Date.parse(right.lastSeenAt || right.updatedAt || right.createdAt || 0) -
        Date.parse(left.lastSeenAt || left.updatedAt || left.createdAt || 0);
    });
}

async function removeProduct(productId) {
  var products = await getProductsMap();

  delete products[productId];
  await setProductsMap(products);

  return {
    ok: true
  };
}

function normalizeProduct(snapshot) {
  if (!snapshot || !snapshot.site || !snapshot.productKey) {
    return null;
  }

  var productId = snapshot.id || snapshot.site + ":" + snapshot.productKey;
  var now = new Date().toISOString();
  var price = snapshot.price;

  if (price !== null && price !== undefined) {
    price = Number(price);
  }

  if (!Number.isFinite(price)) {
    price = null;
  }

  return {
    id: productId,
    site: snapshot.site,
    siteName: snapshot.siteName || snapshot.site,
    productKey: snapshot.productKey,
    title: snapshot.title || snapshot.siteName || productId,
    image: snapshot.image || "",
    url: snapshot.url || snapshot.pageUrl || "",
    pageUrl: snapshot.pageUrl || snapshot.url || "",
    price: price,
    priceText: snapshot.priceText || "",
    currency: snapshot.currency || "INR",
    status: snapshot.status || (price === null ? "needs_attention" : "ok"),
    capturedAt: snapshot.capturedAt || now,
    error: snapshot.error || ""
  };
}

async function upsertProduct(snapshot, options) {
  var products = await getProductsMap();
  var existing = products[snapshot.id];
  var now = new Date().toISOString();
  var history = existing && Array.isArray(existing.history) ? existing.history.slice() : [];
  var minHistoryIntervalMs = options && options.minHistoryIntervalMs !== undefined
    ? options.minHistoryIntervalMs
    : MIN_BACKGROUND_HISTORY_INTERVAL_MS;

  if (snapshot.price !== null && shouldAppendHistory(history, snapshot, minHistoryIntervalMs)) {
    history.push({
      price: snapshot.price,
      currency: snapshot.currency,
      capturedAt: snapshot.capturedAt || now,
      source: options && options.source ? options.source : "unknown"
    });
  }

  if (history.length > HISTORY_LIMIT) {
    history = history.slice(history.length - HISTORY_LIMIT);
  }

  var product = Object.assign({}, existing || {}, {
    id: snapshot.id,
    site: snapshot.site,
    siteName: snapshot.siteName,
    productKey: snapshot.productKey,
    title: snapshot.title || (existing && existing.title) || snapshot.id,
    image: snapshot.image || (existing && existing.image) || "",
    url: snapshot.url || (existing && existing.url) || "",
    pageUrl: snapshot.pageUrl || (existing && existing.pageUrl) || snapshot.url || "",
    latestPrice: snapshot.price !== null ? snapshot.price : existing ? existing.latestPrice : null,
    latestPriceText: snapshot.priceText || (existing && existing.latestPriceText) || "",
    currency: snapshot.currency || (existing && existing.currency) || "INR",
    status: snapshot.status || (snapshot.price === null ? "needs_attention" : "ok"),
    error: snapshot.error || "",
    history: history,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
    lastSeenAt: options && options.source === "page" ? now : existing && existing.lastSeenAt,
    lastCheckedAt: options && options.source !== "page" ? now : existing && existing.lastCheckedAt
  });

  products[product.id] = product;
  await setProductsMap(products);

  return product;
}

function shouldAppendHistory(history, snapshot, minIntervalMs) {
  if (snapshot.price === null) {
    return false;
  }

  if (!history.length) {
    return true;
  }

  var last = history[history.length - 1];
  var lastPrice = Number(last.price);
  var lastTime = Date.parse(last.capturedAt || 0);
  var snapshotTime = Date.parse(snapshot.capturedAt || new Date().toISOString());

  if (Math.abs(lastPrice - snapshot.price) > 0.009) {
    return true;
  }

  return snapshotTime - lastTime >= minIntervalMs;
}

async function runPriceRefresh(source) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshProducts(source)
    .catch(function logRefreshError(error) {
      console.warn("Local Price Watch refresh failed", error);
    })
    .finally(function clearRefreshPromise() {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function refreshProducts(source) {
  await ensureAlarm();

  var lock = await acquireRefreshLock(source);

  if (!lock.acquired) {
    return;
  }

  try {
    var products = await getProductList();

    for (var index = 0; index < products.length; index += 1) {
      await refreshSingleProduct(products[index]);
      await delay(randomBetween(1200, 3200));
    }
  } finally {
    await releaseRefreshLock();
  }
}

async function acquireRefreshLock(source) {
  var data = await storageGet(REFRESH_LOCK_KEY);
  var lock = data[REFRESH_LOCK_KEY];
  var now = Date.now();

  if (lock && now - lock.startedAt < REFRESH_LOCK_TTL_MS) {
    return {
      acquired: false
    };
  }

  var update = {};
  update[REFRESH_LOCK_KEY] = {
    source: source,
    startedAt: now
  };

  await storageSet(update);

  return {
    acquired: true
  };
}

function releaseRefreshLock() {
  var update = {};
  update[REFRESH_LOCK_KEY] = null;
  return storageSet(update);
}

async function refreshSingleProduct(product) {
  var snapshot = null;

  try {
    snapshot = await fetchProductSnapshot(product);
  } catch (error) {
    snapshot = normalizeProduct(Object.assign({}, product, {
      price: null,
      status: "needs_attention",
      error: error && error.message ? error.message : String(error),
      capturedAt: new Date().toISOString()
    }));
  }

  if (snapshot) {
    await upsertProduct(snapshot, {
      source: "background",
      minHistoryIntervalMs: MIN_BACKGROUND_HISTORY_INTERVAL_MS
    });
  }
}

async function fetchProductSnapshot(product) {
  if (!product.url) {
    throw new Error("Missing product URL");
  }

  var controller = new AbortController();
  var timeoutId = setTimeout(function abortFetch() {
    controller.abort();
  }, 30000);

  try {
    var response = await fetch(product.url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error("Fetch failed with HTTP " + response.status);
    }

    var html = await response.text();
    var parsed = await parseHtmlWithOffscreen({
      html: html,
      site: product.site,
      url: response.url || product.url
    });

    if (!parsed || !parsed.product) {
      throw new Error(parsed && parsed.error ? parsed.error : "Could not parse product page");
    }

    return normalizeProduct(Object.assign({}, product, parsed.product, {
      capturedAt: new Date().toISOString()
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseHtmlWithOffscreen(payload) {
  await ensureOffscreenDocument();

  return new Promise(function resolveOffscreenMessage(resolve) {
    chrome.runtime.sendMessage({
      target: "offscreen",
      type: "PARSE_PRODUCT_HTML",
      payload: payload
    }, function onResponse(response) {
      var error = chrome.runtime.lastError;

      if (error) {
        resolve({
          ok: false,
          error: error.message
        });
      } else {
        resolve(response);
      }
    });
  });
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("chrome.offscreen is unavailable in this browser");
  }

  var offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (await hasOffscreenDocument(offscreenUrl)) {
    return;
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["DOM_PARSER"],
    justification: "Parse fetched product HTML for local price history updates."
  }).finally(function clearCreatingOffscreenDocument() {
    creatingOffscreenDocument = null;
  });

  await creatingOffscreenDocument;
}

async function hasOffscreenDocument(offscreenUrl) {
  if (chrome.runtime.getContexts) {
    var contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length) {
      return true;
    }
  }

  if (typeof clients !== "undefined" && clients.matchAll) {
    var matchedClients = await clients.matchAll();

    return matchedClients.some(function isOffscreenClient(client) {
      return client.url === offscreenUrl;
    });
  }

  return false;
}

function delay(ms) {
  return new Promise(function resolveDelay(resolve) {
    setTimeout(resolve, ms);
  });
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
