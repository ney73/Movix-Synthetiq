/* NOVA Streaming — Synthetiq Player V3
 * Initial public-page adapter for watchnova.win.
 * The public catalogue pages render their catalogue dynamically ("Chargement du catalogue…")
 * in browser-facing HTML, so API-backed search and playback remain unverified.
 * This adapter only reads public HTML and explicit media URLs; it does not bypass login,
 * Premium access, DRM, provider restrictions, or anti-embedding controls.
 */
"use strict";

var NOVA_BASE = "https://watchnova.win";
var NOVA_CATALOGUES = [NOVA_BASE + "/films", NOVA_BASE + "/series", NOVA_BASE + "/"];

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&#(\d+);/g, function (_, n) {
      return String.fromCharCode(Number(n));
    });
}
function stripTags(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}
function absoluteUrl(value, base) {
  var href = decodeEntities(String(value || "").trim());
  if (!href || /^(?:javascript:|data:|mailto:|#)/i.test(href)) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  var root = base || NOVA_BASE;
  if (href.charAt(0) === "/") return root + href;
  return root + "/" + href.replace(/^\.\//, "");
}
async function responseBody(response) {
  if (!response) return "";
  if (typeof response === "string") return response;
  if (typeof response.text === "function") {
    try { var text = await response.text(); if (text) return String(text); } catch (_) {}
  }
  if (typeof response.json === "function") {
    try { var data = await response.json(); return typeof data === "string" ? data : JSON.stringify(data); } catch (_) {}
  }
  if (typeof response.body === "string") return response.body;
  return "";
}
async function getPage(url) {
  var request = globalThis.fetchv2 || globalThis.fetch;
  if (typeof request !== "function") return "";
  try {
    var response = await request.call(globalThis, url, {
      method: "GET",
      headers: { "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" }
    });
    return await responseBody(response);
  } catch (_) { return ""; }
}
function firstMatch(html, regex) {
  var match = regex.exec(String(html || ""));
  return match ? decodeEntities(match[1] || "") : "";
}
function pageTitle(html) {
  return firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
    firstMatch(html, /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
}
function pageImage(html, pageUrl) {
  var value = firstMatch(html, /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["'][^>]*>/i) ||
    firstMatch(html, /<img\b[^>]*src=["']([^"']*)["'][^>]*>/i);
  return absoluteUrl(value, pageUrl);
}
function pageDescription(html) {
  return firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
}
function parseCards(html, pageUrl) {
  var results = [], seen = {};
  var re = /<a\b([^>]*href\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi, match;
  while ((match = re.exec(String(html || ""))) !== null) {
    var raw = match[2], href = absoluteUrl(raw, pageUrl);
    if (!href || !/^https?:\/\//i.test(href) || !/watchnova\.win/i.test(href)) continue;
    if (/\/(?:films|series|anti-pub|premium|support|login|register|account|client|request)(?:[/?#]|$)/i.test(raw)) continue;
    if (href.replace(/\/$/, "") === NOVA_BASE || seen[href]) continue;
    var inner = match[3] || "";
    var title = stripTags(inner) || stripTags(firstMatch(inner, /<img\b[^>]*alt=["']([^"']+)["']/i)) ||
      stripTags(firstMatch(match[1], /title=["']([^"']+)["']/i));
    if (!title || title.length > 180) continue;
    var imageRaw = firstMatch(inner, /<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i);
    var image = absoluteUrl(imageRaw, pageUrl);
    var id = href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() || href;
    seen[href] = true;
    results.push({ title: title, href: href, image: image, id: id });
  }
  return results;
}
function catalogRecords(data) {
  var found = [];
  var seen = {};
  function walk(node, depth) {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach(function (item) { walk(item, depth + 1); });
      return;
    }
    if (typeof node !== "object") return;
    var title = node.title || node.name || node.nom || node.label || node.original_title || node.originalTitle;
    var rawHref = node.href || node.url || node.link || node.path || node.slug || node.id;
    var image = node.image || node.poster || node.poster_path || node.thumbnail || node.cover || node.backdrop;
    if (title && rawHref) {
      var href = absoluteUrl(String(rawHref), NOVA_BASE);
      if (href && /watchnova\.win/i.test(href) && !seen[href]) {
        seen[href] = true;
        found.push({
          title: stripTags(String(title)),
          href: href,
          image: image ? absoluteUrl(String(image), NOVA_BASE) : "",
          id: String(node.id || href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() || href),
          description: stripTags(String(node.description || node.overview || node.synopsis || ""))
        });
      }
    }
    Object.keys(node).forEach(function (key) {
      if (node[key] && typeof node[key] === "object") walk(node[key], depth + 1);
    });
  }
  walk(data, 0);
  return found;
}

globalThis.searchResults = async function (query) {
  var q = String(query || "").trim().toLowerCase();
  var apiResponse = await getPage(NOVA_BASE + "/api/catalog");
  if (apiResponse) {
    try {
      var data = JSON.parse(apiResponse);
      var apiItems = catalogRecords(data).filter(function (item) {
        return !q || item.title.toLowerCase().indexOf(q) !== -1;
      });
      if (apiItems.length) return apiItems.slice(0, 30);
    } catch (_) {}
  }
  var all = [], seen = {};
  for (var i = 0; i < NOVA_CATALOGUES.length; i++) {
    var html = await getPage(NOVA_CATALOGUES[i]);
    if (!html) continue;
    var items = parseCards(html, NOVA_CATALOGUES[i]);
    for (var j = 0; j < items.length; j++) {
      if (seen[items[j].href]) continue;
      if (q && items[j].title.toLowerCase().indexOf(q) === -1) continue;
      seen[items[j].href] = true; all.push(items[j]);
      if (all.length >= 30) return all;
    }
  }
  return all.slice(0, 30);
};

globalThis.extractDetails = async function (urlOrId) {
  var input = String(urlOrId || "").trim();
  var href = /^https?:\/\//i.test(input) ? input : "";
  if (!href || !/watchnova\.win/i.test(href)) return null;
  var html = await getPage(href);
  if (!html) return null;
  var title = stripTags(pageTitle(html));
  if (!title) return null;
  var id = href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() || href;
  return { title: title, description: stripTags(pageDescription(html)), image: pageImage(html, href), id: id, href: href };
};
globalThis.extractEpisodes = async function (seriesId) {
  var href = String(seriesId || "").trim();
  if (!/^https?:\/\//i.test(href) || !/watchnova\.win/i.test(href)) return [];
  var html = await getPage(href);
  if (!html) return [];
  var out = [], seen = {}, re = /<a\b([^>]*href\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var raw = m[2];
    if (!/(?:episode|saison|season|watch|play|lecture|player)/i.test(raw + " " + m[1])) continue;
    var url = absoluteUrl(raw, href);
    if (!url || !/watchnova\.win/i.test(url) || seen[url]) continue;
    var title = stripTags(m[3]) || stripTags(firstMatch(m[1], /title=["']([^"']+)["']/i));
    if (!title) continue;
    seen[url] = true;
    out.push({ title: title, href: url, id: url.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() });
  }
  return out;
};
globalThis.extractStreamUrl = async function (episodeHref, lang) {
  var href = String(episodeHref || "").trim();
  if (!/^https?:\/\//i.test(href) || !/watchnova\.win/i.test(href)) return [];
  var html = await getPage(href);
  if (!html) return [];
  var out = [], seen = {};
  function add(value) {
    var url = absoluteUrl(String(value || "").replace(/\\\//g, "/"), href);
    if (!url || !/^https?:\/\//i.test(url) || !/\.(?:m3u8|mp4|mpd|m4v|webm)(?:[?#]|$)/i.test(url) || seen[url]) return;
    seen[url] = true; out.push({ label: out.length ? "Alternative " + (out.length + 1) : "Auto", url: url });
  }
  var re = /(?:https?:)?\\?\/\\?\/[^"'\\\s<>]+?\.(?:m3u8|mp4|mpd|m4v|webm)(?:\?[^"'\\\s<>]*)?/gi, m;
  while ((m = re.exec(html)) !== null) add(m[0]);
  var attr = /(?:file|src|source|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|mpd|m4v|webm)(?:\?[^"']*)?)["']/gi;
  while ((m = attr.exec(html)) !== null) add(m[1]);
  return out;
};
