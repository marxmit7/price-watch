(function startLocalPriceWatchContent() {
  "use strict";

  var HOST_ID = "local-price-watch-host";
  var WIDGET_ID = "local-price-watch-widget";
  var STYLE_TEXT = [
    ".lpw-widget {",
    "  box-sizing: border-box;",
    "  width: 100%;",
    "  padding: 12px;",
    "  border: 1px solid #d6dde8;",
    "  border-radius: 8px;",
    "  background: #ffffff;",
    "  color: #162033;",
    "  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10);",
    "  font-family: Arial, Helvetica, sans-serif;",
    "  line-height: 1.35;",
    "}",
    ".lpw-widget *, .lpw-widget *::before, .lpw-widget *::after { box-sizing: border-box; }",
    ".lpw-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }",
    ".lpw-title { color: #111827; font-size: 14px; font-weight: 700; }",
    ".lpw-subtitle { margin-top: 2px; color: #64748b; font-size: 12px; }",
    ".lpw-status { flex: 0 0 auto; min-height: 24px; padding: 4px 8px; border-radius: 999px; background: #e8f5ef; color: #126b45; font-size: 12px; font-weight: 700; white-space: nowrap; }",
    ".lpw-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }",
    ".lpw-stat { min-width: 0; padding: 8px; border: 1px solid #e4eaf2; border-radius: 6px; background: #f8fafc; }",
    ".lpw-stat-label { display: block; color: #64748b; font-size: 11px; }",
    ".lpw-stat-value { display: block; overflow-wrap: anywhere; color: #162033; font-size: 13px; font-weight: 700; }",
    ".lpw-chart-wrap { min-height: 96px; border: 1px solid #e4eaf2; border-radius: 6px; background: #fbfdff; overflow: hidden; }",
    ".lpw-chart { display: block; width: 100%; height: 96px; }",
    ".lpw-grid { stroke: #dbe4ef; stroke-width: 1; }",
    ".lpw-area { fill: rgba(16, 129, 111, 0.13); }",
    ".lpw-line { fill: none; stroke: #10816f; stroke-linecap: round; stroke-linejoin: round; stroke-width: 3; }",
    ".lpw-chart-label { fill: #64748b; font-size: 10px; font-weight: 700; }",
    ".lpw-empty-chart { display: flex; min-height: 96px; align-items: center; justify-content: center; padding: 12px; color: #64748b; font-size: 12px; text-align: center; }",
    ".lpw-error { margin-top: 8px; padding: 8px; border-radius: 6px; background: #fff7ed; color: #9a3412; font-size: 12px; }",
    "@media (max-width: 520px) { .lpw-stats { grid-template-columns: 1fr; } }"
  ].join("\n");
  var activeUrl = "";
  var activeProductId = "";
  var lastRenderedProduct = null;
  var mutationObserver = null;
  var repairTimer = null;
  var missingPriceRefreshTimer = null;
  var missingPriceRetryCount = 0;
  var missingPriceRetryProductId = "";
  var urlPollTimer = null;

  init();

  function init() {
    startDomGuard();
    processCurrentPage("initial");

    if (urlPollTimer) {
      clearInterval(urlPollTimer);
    }

    urlPollTimer = setInterval(function pollUrl() {
      if (location.href !== activeUrl) {
        processCurrentPage("url-change");
      }
    }, 1500);
  }

  async function processCurrentPage(reason) {
    activeUrl = location.href;

    var snapshot = await extractProductWithRetries();

    if (!snapshot || !snapshot.productKey) {
      removeWidget();
      activeProductId = "";
      lastRenderedProduct = null;
      clearMissingPriceRefresh();
      return;
    }

    if (snapshot.id === activeProductId && reason !== "url-change") {
      return;
    }

    activeProductId = snapshot.id;

    try {
      var response = await sendMessage({
        type: "PRODUCT_PAGE_SEEN",
        product: snapshot
      });

      if (response && response.ok && response.product) {
        renderWidget(response.product);
        scheduleMissingPriceRefresh(response.product);
      } else {
        var failedProduct = Object.assign({}, snapshot, {
          error: response && response.error ? response.error : "Could not save product locally",
          history: snapshot.price === null ? [] : [{
            price: snapshot.price,
            currency: snapshot.currency,
            capturedAt: snapshot.capturedAt,
            source: "page"
          }]
        });

        renderWidget(failedProduct);
        scheduleMissingPriceRefresh(failedProduct);
      }
    } catch (error) {
      var errorProduct = Object.assign({}, snapshot, {
        error: error && error.message ? error.message : String(error),
        history: snapshot.price === null ? [] : [{
          price: snapshot.price,
          currency: snapshot.currency,
          capturedAt: snapshot.capturedAt,
          source: "page"
        }]
      });

      renderWidget(errorProduct);
      scheduleMissingPriceRefresh(errorProduct);
    }
  }

  async function extractProductWithRetries() {
    var bestSnapshot = null;

    for (var attempt = 0; attempt < 5; attempt += 1) {
      var snapshot = PriceWatchAdapters.extractFromDocument(document, location.href);

      if (snapshot && snapshot.productKey) {
        bestSnapshot = snapshot;
      }

      if (snapshot && snapshot.productKey && snapshot.price !== null) {
        return snapshot;
      }

      await delay(500 + attempt * 400);
    }

    return bestSnapshot || PriceWatchAdapters.extractFromDocument(document, location.href);
  }

  function renderWidget(product) {
    lastRenderedProduct = product;

    var host = getOrCreateHost();
    var root = getWidgetRoot(host);
    var widget = document.createElement("section");
    widget.id = WIDGET_ID;
    widget.className = "lpw-widget";
    widget.setAttribute("aria-label", "Local Price Watch price history");

    var header = document.createElement("div");
    header.className = "lpw-header";

    var titleBlock = document.createElement("div");
    titleBlock.className = "lpw-title-block";

    var title = document.createElement("div");
    title.className = "lpw-title";
    title.textContent = "Price Watch";

    var subtitle = document.createElement("div");
    subtitle.className = "lpw-subtitle";
    subtitle.textContent = product.siteName || product.site || "Tracked locally";

    titleBlock.appendChild(title);
    titleBlock.appendChild(subtitle);

    var status = document.createElement("div");
    status.className = "lpw-status";
    status.textContent = product.status === "ok" ? "Tracking" : "Needs check";

    header.appendChild(titleBlock);
    header.appendChild(status);

    var stats = getStats(product);
    var statGrid = document.createElement("div");
    statGrid.className = "lpw-stats";

    statGrid.appendChild(createStat("Current", formatMoney(product.latestPrice, product.currency)));
    statGrid.appendChild(createStat("Lowest", formatMoney(stats.lowest, product.currency)));
    statGrid.appendChild(createStat("Highest", formatMoney(stats.highest, product.currency)));
    statGrid.appendChild(createStat("Last check", formatShortDate(product.lastCheckedAt || product.updatedAt || product.capturedAt)));

    var chart = createChart(product.history || [], product.currency);

    widget.appendChild(header);
    widget.appendChild(statGrid);
    widget.appendChild(chart);

    if (product.error) {
      var error = document.createElement("div");
      error.className = "lpw-error";
      error.textContent = product.error;
      widget.appendChild(error);
    }

    var style = document.createElement("style");
    style.textContent = STYLE_TEXT;

    root.replaceChildren(style, widget);
    mountHost(host, product.site);
  }

  function getInsertionAnchor(site) {
    if (site === "amazon") {
      return document.querySelector("#titleSection") ||
        document.querySelector("#corePriceDisplay_desktop_feature_div") ||
        document.querySelector("#centerCol");
    }

    if (site === "flipkart") {
      var price = document.querySelector("._30jeq3._16Jk6d") ||
        document.querySelector("._30jeq3") ||
        document.querySelector(".Nx9bqj.CxhGGd") ||
        document.querySelector(".Nx9bqj") ||
        document.querySelector(".CxhGGd") ||
        document.querySelector("._1_WHN1") ||
        document.querySelector("[class*='CxhGGd']") ||
        document.querySelector("[class*='Nx9bqj']") ||
        document.querySelector("[class*='_1_WHN1']") ||
        document.querySelector("[class*='_16Jk6d']");

      if (price) {
        return price.closest("div") || price;
      }

      var title = document.querySelector("h1") ||
        document.querySelector("span.B_NuCI");

      return title ? title.closest("div") || title : null;
    }

    return null;
  }

  function getOrCreateHost() {
    var existing = document.getElementById(HOST_ID);

    if (existing && !existing.shadowRoot) {
      existing.remove();
      existing = null;
    }

    if (existing) {
      return existing;
    }

    var host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-local-price-watch", "true");
    host.attachShadow({
      mode: "open"
    });

    return host;
  }

  function getWidgetRoot(host) {
    return host.shadowRoot || host.attachShadow({
      mode: "open"
    });
  }

  function mountHost(host, site) {
    var anchor = getInsertionAnchor(site);
    var canAnchor = anchor && anchor.parentNode && anchor !== host;

    host.setAttribute("data-lpw-site", site || "");
    applyHostStyle(host, !canAnchor);

    if (canAnchor) {
      if (host.parentNode !== anchor.parentNode || host.previousSibling !== anchor) {
        anchor.parentNode.insertBefore(host, anchor.nextSibling);
      }
      return;
    }

    if (document.body && host.parentNode !== document.body) {
      document.body.appendChild(host);
    }
  }

  function applyHostStyle(host, floating) {
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("box-sizing", "border-box", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("font-size", "16px", "important");
    host.style.setProperty("line-height", "normal", "important");
    host.style.setProperty("z-index", "2147483647", "important");

    if (floating) {
      host.style.setProperty("position", "fixed", "important");
      host.style.setProperty("right", "16px", "important");
      host.style.setProperty("bottom", "16px", "important");
      host.style.setProperty("width", "min(380px, calc(100vw - 32px))", "important");
      host.style.setProperty("max-width", "calc(100vw - 32px)", "important");
      host.style.setProperty("margin", "0", "important");
      return;
    }

    host.style.setProperty("position", "relative", "important");
    host.style.removeProperty("right");
    host.style.removeProperty("bottom");
    host.style.setProperty("width", "min(100%, 460px)", "important");
    host.style.setProperty("max-width", "100%", "important");
    host.style.setProperty("margin", "12px 0", "important");
  }

  function startDomGuard() {
    if (mutationObserver || !window.MutationObserver) {
      return;
    }

    mutationObserver = new MutationObserver(function onDomChanged() {
      scheduleWidgetRepair();
      scheduleMissingPriceRefresh(lastRenderedProduct);
    });

    mutationObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  }

  function scheduleWidgetRepair() {
    if (!lastRenderedProduct || repairTimer) {
      return;
    }

    repairTimer = setTimeout(function repairWidget() {
      repairTimer = null;

      if (!lastRenderedProduct) {
        return;
      }

      var host = document.getElementById(HOST_ID);

      if (!host || !host.isConnected || !host.shadowRoot || !host.shadowRoot.getElementById(WIDGET_ID)) {
        renderWidget(lastRenderedProduct);
        return;
      }

      mountHost(host, lastRenderedProduct.site);
    }, 250);
  }

  function scheduleMissingPriceRefresh(product) {
    if (!product || product.site !== "flipkart") {
      clearMissingPriceRefresh();
      return;
    }

    var currentPrice = product.latestPrice !== undefined ? product.latestPrice : product.price;

    if (hasPriceValue(currentPrice)) {
      clearMissingPriceRefresh();
      return;
    }

    if (missingPriceRetryProductId !== product.id) {
      missingPriceRetryProductId = product.id;
      missingPriceRetryCount = 0;
    }

    if (missingPriceRetryCount >= 8) {
      return;
    }

    if (missingPriceRefreshTimer) {
      return;
    }

    missingPriceRefreshTimer = setTimeout(function retryMissingPrice() {
      missingPriceRefreshTimer = null;
      missingPriceRetryCount += 1;

      if (!lastRenderedProduct || lastRenderedProduct.site !== "flipkart") {
        return;
      }

      activeProductId = "";
      processCurrentPage("missing-price-retry");
    }, 1200);
  }

  function clearMissingPriceRefresh() {
    if (missingPriceRefreshTimer) {
      clearTimeout(missingPriceRefreshTimer);
      missingPriceRefreshTimer = null;
    }

    missingPriceRetryCount = 0;
    missingPriceRetryProductId = "";
  }

  function createStat(label, value) {
    var item = document.createElement("div");
    item.className = "lpw-stat";

    var labelNode = document.createElement("span");
    labelNode.className = "lpw-stat-label";
    labelNode.textContent = label;

    var valueNode = document.createElement("strong");
    valueNode.className = "lpw-stat-value";
    valueNode.textContent = value || "Unavailable";

    item.appendChild(labelNode);
    item.appendChild(valueNode);

    return item;
  }

  function createChart(history, currency) {
    var chartWrap = document.createElement("div");
    chartWrap.className = "lpw-chart-wrap";

    if (!history || history.length < 2) {
      var empty = document.createElement("div");
      empty.className = "lpw-empty-chart";
      empty.textContent = "More price checks will build the graph.";
      chartWrap.appendChild(empty);
      return chartWrap;
    }

    var width = 360;
    var height = 96;
    var padding = 10;
    var points = history
      .filter(function keepPoint(point) {
        return Number.isFinite(Number(point.price));
      })
      .slice(-80);

    if (points.length < 2) {
      return createChart([], currency);
    }

    var prices = points.map(function mapPrice(point) {
      return Number(point.price);
    });
    var min = Math.min.apply(Math, prices);
    var max = Math.max.apply(Math, prices);
    var range = max - min || 1;

    var coordinates = points.map(function mapPoint(point, index) {
      var x = padding + (index / (points.length - 1)) * (width - padding * 2);
      var y = height - padding - ((Number(point.price) - min) / range) * (height - padding * 2);

      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Price history chart");
    svg.classList.add("lpw-chart");

    var grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
    grid.setAttribute("d", "M10 20H350M10 48H350M10 76H350");
    grid.setAttribute("class", "lpw-grid");

    var area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("points", "10,86 " + coordinates + " 350,86");
    area.setAttribute("class", "lpw-area");

    var line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", coordinates);
    line.setAttribute("class", "lpw-line");

    var minLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    minLabel.setAttribute("x", "12");
    minLabel.setAttribute("y", "90");
    minLabel.setAttribute("class", "lpw-chart-label");
    minLabel.textContent = formatMoney(min, currency);

    var maxLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    maxLabel.setAttribute("x", "12");
    maxLabel.setAttribute("y", "16");
    maxLabel.setAttribute("class", "lpw-chart-label");
    maxLabel.textContent = formatMoney(max, currency);

    svg.appendChild(grid);
    svg.appendChild(area);
    svg.appendChild(line);
    svg.appendChild(minLabel);
    svg.appendChild(maxLabel);
    chartWrap.appendChild(svg);

    return chartWrap;
  }

  function getStats(product) {
    var prices = (product.history || [])
      .map(function mapPrice(point) {
        return Number(point.price);
      })
      .filter(function keepPrice(price) {
        return Number.isFinite(price);
      });

    if (!prices.length && hasPriceValue(product.latestPrice)) {
      prices.push(Number(product.latestPrice));
    }

    return {
      lowest: prices.length ? Math.min.apply(Math, prices) : null,
      highest: prices.length ? Math.max.apply(Math, prices) : null
    };
  }

  function removeWidget() {
    var existing = document.getElementById(HOST_ID);

    if (existing) {
      existing.remove();
    }

    var legacy = document.getElementById(WIDGET_ID);

    if (legacy) {
      legacy.remove();
    }
  }

  function sendMessage(message) {
    return new Promise(function resolveMessage(resolve, reject) {
      chrome.runtime.sendMessage(message, function onResponse(response) {
        var error = chrome.runtime.lastError;

        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  function formatMoney(value, currency) {
    if (!hasPriceValue(value)) {
      return "Unavailable";
    }

    var amount = Number(value);

    if (!Number.isFinite(amount)) {
      return "Unavailable";
    }

    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "INR",
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2
      }).format(amount);
    } catch (error) {
      return amount.toLocaleString();
    }
  }

  function hasPriceValue(value) {
    if (value === null || value === undefined || value === "") {
      return false;
    }

    return Number.isFinite(Number(value));
  }

  function formatShortDate(value) {
    if (!value) {
      return "Not yet";
    }

    var date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Not yet";
    }

    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function delay(ms) {
    return new Promise(function resolveDelay(resolve) {
      setTimeout(resolve, ms);
    });
  }
})();
