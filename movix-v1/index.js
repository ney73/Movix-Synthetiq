/* Movix Library — Synthetiq Player V3
 * Discovery uses the observed Movix catalogue page. Stream URLs are returned
 * only when a direct media URL is present in the episode page; playback has
 * not yet been verified in the real Player runtime.
 */
"use strict";

var MOVIX_BASE = "https://movix.zip";
var MOVIX_CATALOGUE = MOVIX_BASE + "/movies";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function (_, n) {
      return String.fromCharCode(Number(n));
    });
}

function stripTags(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
    .trim();
}

function absoluteUrl(value, base) {
  var href = decodeEntities(String(value || "").trim());
  if (!href || /^(?:javascript:|data:|mailto:|#)/i.test(href)) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  var root = base || MOVIX_BASE;
  if (href.charAt(0) === "/") return root.replace(/\/$/, "") + href;
  return root.replace(/\/$/, "") + "/" + href.replace(/^\.\//, "");
}

async function responseBody(response) {
  if (!response) return "";
  if (typeof response === "string") return response;
  if (typeof response.text === "function") {
    try {
      var text = await response.text();
      if (text) return String(text);
    } catch (_) {}
  }
  if (typeof response.json === "function") {
    try {
      var data = await response.json();
      return typeof data === "string" ? data : JSON.stringify(data);
    } catch (_) {}
  }
  if (typeof response.body === "string") return response.body;
  if (response.body && typeof response.body === "object") {
    try { return JSON.stringify(response.body); } catch (_) {}
  }
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
  } catch (_) {
    return "";
  }
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

function mediaKindUrl(value) {
  return /\.(?:m3u8|mp4|mpd|m4v)(?:[?#]|$)/i.test(String(value || ""));
}

function parseCards(html, pageUrl) {
  var results = [];
  var seen = {};
  var anchorRegex = /<a\b([^>]*href\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = anchorRegex.exec(String(html || ""))) !== null) {
    var hrefRaw = match[2];
    var inner = match[3] || "";
    var href = absoluteUrl(hrefRaw, pageUrl);
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (!/\/movie\/|\/movies\/|\/series\/|\/tv\/|\/show\//i.test(hrefRaw)) continue;
    if (seen[href]) continue;

    var title = stripTags(inner);
    if (!title) {
      title = firstMatch(inner, /<img\b[^>]*alt=["']([^"']+)["'][^>]*>/i) ||
        firstMatch(match[1], /title=["']([^"']+)["']/i);
    }
    title = stripTags(title);
    if (!title || title.length > 180) continue;

    var imageRaw = firstMatch(inner, /<img\b[^>]*data-src=["']([^"']+)["'][^>]*>/i) ||
      firstMatch(inner, /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i) ||
      firstMatch(inner, /<img\b[^>]*srcset=["']([^"']+)["'][^>]*>/i);
    var imageUrl = absoluteUrl(imageRaw.split(",")[0].trim().split(/\s+/)[0], pageUrl);
    var id = href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() || href;
    seen[href] = true;
    results.push({ title: title, href: href, image: imageUrl, id: id });
  }
  return results;
}

globalThis.searchResults = async function (query) {
  var html = await getPage(MOVIX_CATALOGUE);
  if (!html) return [];
  var items = parseCards(html, MOVIX_CATALOGUE);
  var q = String(query || "").trim().toLowerCase();
  if (q) items = items.filter(function (item) {
    return item.title.toLowerCase().indexOf(q) !== -1;
  });
  return items.slice(0, 30);
};

globalThis.extractDetails = async function (urlOrId) {
  var input = String(urlOrId || "").trim();
  var href = /^https?:\/\//i.test(input) ? input : "";
  if (!href) return null;
  var html = await getPage(href);
  if (!html) return null;
  var title = stripTags(pageTitle(html));
  if (!title) return null;
  var id = href.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() || href;
  return {
    title: title,
    description: stripTags(pageDescription(html)),
    image: pageImage(html, href),
    id: id,
    href: href
  };
};

globalThis.extractEpisodes = async function (seriesId) {
  var input = String(seriesId || "").trim();
  var href = /^https?:\/\//i.test(input) ? input : "";
  if (!href) return [];
  var html = await getPage(href);
  if (!html) return [];
  var results = [];
  var seen = {};
  var anchorRegex = /<a\b([^>]*href\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = anchorRegex.exec(html)) !== null) {
    var rawHref = match[2];
    if (!/\/episode\/|\/watch\/|\/play\//i.test(rawHref)) continue;
    var episodeHref = absoluteUrl(rawHref, href);
    if (!episodeHref || seen[episodeHref]) continue;
    var title = stripTags(match[3]) || firstMatch(match[1], /title=["']([^"']+)["']/i);
    title = stripTags(title);
    if (!title) title = "Episode " + (results.length + 1);
    var id = episodeHref.replace(/[?#].*$/, "").replace(/\/$/, "").split("/").pop() || episodeHref;
    seen[episodeHref] = true;
    results.push({ title: title, href: episodeHref, id: id });
  }
  return results;
};

globalThis.extractStreamUrl = async function (episodeHref, lang) {
  var href = String(episodeHref || "").trim();
  if (!/^https?:\/\//i.test(href)) return [];
  var html = await getPage(href);
  if (!html) return [];

  var candidates = [];
  var seen = {};
  function addCandidate(value) {
    var url = absoluteUrl(value, href);
    if (!url || !mediaKindUrl(url) || seen[url]) return;
    seen[url] = true;
    candidates.push(url);
  }

  var patterns = [
    /(?:file|src|source|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|mpd|m4v)(?:\?[^"']*)?)["']/gi,
    /["'](?:file|src|source|url)["']\s*:\s*["']([^"']+)["']/gi,
    /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mp4|mpd|m4v)(?:\?[^"'\s<>]*)?/gi,
    /(?:src|href)\s*=\s*["']([^"']+\.(?:m3u8|mp4|mpd|m4v)(?:\?[^"']*)?)["']/gi
  ];
  patterns.forEach(function (pattern, index) {
    var match;
    while ((match = pattern.exec(html)) !== null) {
      var value = index === 2 ? match[0].replace(/\\\//g, "/") : match[1];
      addCandidate(value);
    }
  });

  return candidates.map(function (url, index) {
    return { label: index === 0 ? "Auto" : "Alternative " + (index + 1), url: url };
  });
};
