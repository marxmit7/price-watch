"use strict";

var productsEl = document.getElementById("products");
var emptyEl = document.getElementById("empty");
var summaryEl = document.getElementById("summary");
var messageEl = document.getElementById("message");
var refreshButton = document.getElementById("refresh-now");

document.addEventListener("DOMContentLoaded", loadProducts);
refreshButton.addEventListener("click", refreshNow);

async function loadProducts() {
  try {
    var response = await sendMessage({
      type: "GET_PRODUCTS"
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Could not load products");
    }

    renderProducts(response.products || []);
  } catch (error) {
    showMessage(error && error.message ? error.message : String(error));
  }
}

async function refreshNow() {
  refreshButton.disabled = true;
  showMessage("Price refresh started. The list will update as checks finish.");

  try {
    await sendMessage({
      type: "RUN_PRICE_REFRESH_NOW"
    });
    setTimeout(loadProducts, 3000);
  } catch (error) {
    showMessage(error && error.message ? error.message : String(error));
  } finally {
    setTimeout(function enableRefresh() {
      refreshButton.disabled = false;
    }, 1500);
  }
}

function renderProducts(products) {
  productsEl.replaceChildren();
  emptyEl.hidden = products.length !== 0;
  summaryEl.textContent = products.length === 1
    ? "1 product tracked locally"
    : products.length + " products tracked locally";

  products.forEach(function renderProduct(product) {
    productsEl.appendChild(createProductCard(product));
  });
}

function createProductCard(product) {
  var card = document.createElement("article");
  card.className = "product-card";

  if (product.image) {
    var image = document.createElement("img");
    image.className = "product-image";
    image.src = product.image;
    image.alt = "";
    card.appendChild(image);
  } else {
    var placeholder = document.createElement("div");
    placeholder.className = "product-image placeholder";
    placeholder.textContent = product.siteName || product.site || "Item";
    card.appendChild(placeholder);
  }

  var main = document.createElement("div");
  main.className = "product-main";

  var title = document.createElement("div");
  title.className = "product-title";
  title.textContent = product.title || product.id;

  var meta = document.createElement("div");
  meta.className = "product-meta";
  meta.appendChild(createMeta(product.siteName || product.site || "Store"));
  meta.appendChild(createMeta("Checked " + formatShortDate(product.lastCheckedAt || product.updatedAt)));

  var stats = getStats(product);
  var metrics = document.createElement("div");
  metrics.className = "price-row";
  metrics.appendChild(createMetric("Current", formatMoney(product.latestPrice, product.currency)));
  metrics.appendChild(createMetric("Low", formatMoney(stats.lowest, product.currency)));
  metrics.appendChild(createMetric("High", formatMoney(stats.highest, product.currency)));

  var chart = createChart(product.history || [], product.currency);

  var actions = document.createElement("div");
  actions.className = "product-actions";

  var openButton = document.createElement("button");
  openButton.className = "text-button";
  openButton.type = "button";
  openButton.textContent = "Open";
  openButton.addEventListener("click", function openProduct() {
    chrome.tabs.create({
      url: product.url || product.pageUrl
    });
  });

  var removeButton = document.createElement("button");
  removeButton.className = "text-button danger";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", function removeTrackedProduct() {
    removeProduct(product.id);
  });

  actions.appendChild(openButton);
  actions.appendChild(removeButton);

  main.appendChild(title);
  main.appendChild(meta);
  main.appendChild(metrics);
  main.appendChild(chart);
  main.appendChild(actions);
  card.appendChild(main);

  return card;
}

async function removeProduct(productId) {
  try {
    var response = await sendMessage({
      type: "REMOVE_PRODUCT",
      productId: productId
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Could not remove product");
    }

    await loadProducts();
  } catch (error) {
    showMessage(error && error.message ? error.message : String(error));
  }
}

function createMeta(text) {
  var node = document.createElement("span");
  node.textContent = text;
  return node;
}

function createMetric(label, value) {
  var metric = document.createElement("div");
  metric.className = "metric";

  var labelNode = document.createElement("span");
  labelNode.textContent = label;

  var valueNode = document.createElement("strong");
  valueNode.textContent = value || "Unavailable";

  metric.appendChild(labelNode);
  metric.appendChild(valueNode);

  return metric;
}

function createChart(history, currency) {
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 260 52");
  svg.classList.add("chart");

  var points = history
    .filter(function keepPoint(point) {
      return Number.isFinite(Number(point.price));
    })
    .slice(-50);

  if (points.length < 2) {
    var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "130");
    text.setAttribute("y", "29");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#667085");
    text.setAttribute("font-size", "11");
    text.textContent = "More data soon";
    svg.appendChild(text);
    return svg;
  }

  var prices = points.map(function mapPrice(point) {
    return Number(point.price);
  });
  var min = Math.min.apply(Math, prices);
  var max = Math.max.apply(Math, prices);
  var range = max - min || 1;
  var coordinates = points.map(function mapPoint(point, index) {
    var x = 8 + (index / (points.length - 1)) * 244;
    var y = 44 - ((Number(point.price) - min) / range) * 36;

    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");

  var area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  area.setAttribute("points", "8,46 " + coordinates + " 252,46");
  area.setAttribute("class", "chart-area");

  var line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", coordinates);
  line.setAttribute("class", "chart-line");

  svg.appendChild(area);
  svg.appendChild(line);

  return svg;
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

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.hidden = false;

  setTimeout(function hideMessage() {
    messageEl.hidden = true;
  }, 5000);
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
    return "not yet";
  }

  var date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "not yet";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
