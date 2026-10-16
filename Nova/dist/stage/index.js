/* ============================================================================
 * Nova (watchnova.win) — Synthetiq Player video module (contract v4)
 * ----------------------------------------------------------------------------
 * Source: public guest catalogue at https://watchnova.win
 *   GET /api/catalog?search=1        -> { items: [...] } (films + series)
 *   GET /api/titles/{id}/episodes    -> { episodes: [...] } (series only)
 *   Films carry item.watchUrl: either a signed .m3u8 or an embed page (.html).
 *   Series episodes carry signed .m3u8 links; films with embed pages need the
 *   embed page unpacked (Uqload Dean-Edwards packer, Vidmoly plain file:).
 *
 * Identity: catalogue id (movie-123 / tv-456) for titles, episode id
 * (tv-456-s1e2) for episodes. Signed media URLs are resolved at play time
 * and never cached across calls.
 *
 * Limits (honest): guest routes only, no login, no premium/direct-link API
 * (401 without session), no DRM/paywall/CAPTCHA bypass. Hosts needing
 * browser-only obfuscation (vidzy token builder, playmogo, movix/*, etc.)
 * return { streams: [] }. No subtitles are exposed: embeds only carry
 * thumbnail tracks and an empty caption placeholder.
 * ==========================================================================*/

(function () {
  'use strict';

  var SITE = 'https://watchnova.win';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  var HEADERS = { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5' };
  var CATALOG_TTL_MS = 5 * 60 * 1000;

  var catalogCache = { at: 0, items: null };

  function now() { return Date.now(); }
  function left(deadline, cap) { return Math.max(600, Math.min(deadline - now(), cap || 12000)); }

  function absolute(href, base) {
    var v = String(href == null ? '' : href).trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    if (/^\//.test(v)) return SITE + v;
    return (base || SITE) + '/' + v.replace(/^\.?\//, '');
  }

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ').trim();
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[àâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[îï]/g, 'i')
      .replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u').replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* Read parsed JSON from app responses: json may be a value or an async
   * method; JSON bodies arrive with an EMPTY text body, so try body/text. */
  async function readJson(res) {
    if (!res) return null;
    if (typeof res.json === 'function') {
      try { var v = await res.json(); if (v != null) return v; } catch (_) {}
    } else if (res.json != null && typeof res.json !== 'function') {
      return res.json;
    }
    if (typeof res.body === 'string' && res.body) {
      try { return JSON.parse(res.body); } catch (_) {}
    }
    if (typeof res.text === 'function') {
      try { var t = await res.text(); if (t) return JSON.parse(t); } catch (_) {}
    }
    return null;
  }

  async function readText(res) {
    if (!res) return '';
    if (typeof res.text === 'function') {
      try { var t = await res.text(); if (t) return String(t); } catch (_) {}
    }
    if (typeof res.body === 'string' && res.body) return res.body;
    return '';
  }

  async function fetchJson(url, headers, timeoutMs) {
    var res = await fetchv2(url, Object.assign({}, HEADERS, headers || {}), 'GET', null, { timeoutMs: timeoutMs });
    var status = Number(res && (res.status || res.statusCode)) || 0;
    var data = await readJson(res);
    return { status: status, data: data };
  }

  async function fetchText(url, headers, timeoutMs) {
    var res = await fetchv2(url, Object.assign({}, HEADERS, headers || {}), 'GET', null, { timeoutMs: timeoutMs });
    var status = Number(res && (res.status || res.statusCode)) || 0;
    var text = await readText(res);
    return { status: status, text: String(text || '') };
  }

  async function getCatalog(deadline) {
    if (catalogCache.items && (now() - catalogCache.at) < CATALOG_TTL_MS) return catalogCache.items;
    var r = await fetchJson(SITE + '/api/catalog?search=1', { Referer: SITE + '/', Accept: 'application/json' }, left(deadline));
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.items)) throw new Error('catalogue indisponible (' + r.status + ')');
    var items = r.data.items.filter(function (x) { return x && x.id && x.title; });
    catalogCache = { at: now(), items: items };
    return items;
  }

  function findInCatalog(items, id) {
    var want = String(id || '').trim();
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === want) return items[i];
    }
    return null;
  }

  function extractId(input) {
    var v = String(input == null ? '' : input).trim();
    if (!v) return '';
    var m = v.match(/[?&]id=([^&#]+)/);
    if (m) { try { return decodeURIComponent(m[1]).trim(); } catch (_) { return m[1].trim(); } }
    m = v.match(/((?:movie|tv)-[A-Za-z0-9-]+)/);
    if (m) return m[1];
    return v;
  }

  function cardOf(item) {
    return {
      title: item.title,
      href: String(item.id),
      image: item.poster || item.backdrop || '',
      year: item.year || '',
      type: item.type || ''
    };
  }

  /* ================================================================ SEARCH */
  async function searchResults(query) {
    var deadline = now() + 15000;
    var term = norm(query);
    if (!term) return [];
    var items = await getCatalog(deadline);
    var words = term.split(' ').filter(Boolean);
    var scored = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var hay = norm([it.title, it.originalTitle, it.year, (it.genres || []).join(' ')].join(' '));
      if (!hay) continue;
      var rank = -1;
      if (hay === term) rank = 1000;
      else if (hay.indexOf(term) === 0) rank = 850;
      else if (hay.indexOf(term) >= 0) rank = 700 - Math.min(200, hay.length - term.length);
      else {
        var hits = 0;
        for (var w = 0; w < words.length; w++) {
          if (words[w].length > 1 && hay.indexOf(words[w]) >= 0) hits++;
        }
        if (hits > 0 && hits >= Math.min(words.length, 2)) rank = 300 + hits * 40;
      }
      if (rank >= 0) scored.push({ it: it, rank: rank });
    }
    scored.sort(function (a, b) { return b.rank - a.rank; });
    return scored.slice(0, 30).map(function (s) { return cardOf(s.it); });
  }

  /* =============================================================== DETAILS */
  async function extractDetails(urlOrId) {
    var id = extractId(urlOrId);
    if (!id) throw new Error('details: missing id');
    var deadline = now() + 15000;
    var items = await getCatalog(deadline);
    var item = findInCatalog(items, id);
    if (!item) throw new Error('details: titre introuvable');
    return {
      id: String(item.id),
      href: String(item.id),
      url: String(item.id),
      type: item.type === 'serie' ? 'series' : 'video',
      title: item.title || '',
      description: item.synopsis || '',
      image: item.poster || item.backdrop || '',
      poster: item.poster || '',
      backdrop: item.backdrop || '',
      year: item.year || '',
      genres: Array.isArray(item.genres) ? item.genres : [],
      rating: item.voteAverage != null ? item.voteAverage : undefined
    };
  }

  /* ============================================================== EPISODES */
  async function extractEpisodes(seriesId) {
    var id = extractId(seriesId);
    if (!id) throw new Error('episodes: missing id');
    var deadline = now() + 15000;
    var items = await getCatalog(deadline);
    var item = findInCatalog(items, id);
    if (!item) throw new Error('episodes: titre introuvable');
    if (item.type !== 'serie') {
      return [{ number: 1, href: String(item.id), title: item.title || 'Film', season: null }];
    }
    var r = await fetchJson(SITE + '/api/titles/' + encodeURIComponent(String(item.id)) + '/episodes',
      { Referer: SITE + '/', Accept: 'application/json' }, left(deadline));
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.episodes)) throw new Error('episodes indisponibles (' + r.status + ')');
    var eps = r.data.episodes.slice().sort(function (a, b) {
      return (Number(a.seasonNumber) - Number(b.seasonNumber)) || (Number(a.episodeNumber) - Number(b.episodeNumber));
    });
    return eps.map(function (e, i) {
      return {
        number: i + 1,
        href: String(e.id),
        title: e.name || ('S' + e.seasonNumber + ' E' + e.episodeNumber),
        season: Number(e.seasonNumber) || null,
        episode: Number(e.episodeNumber) || null
      };
    });
  }

  /* ------------------------------------------------- embed unpack helpers */
  function unpackDeanEdwards(html) {
    try {
      var m = html.match(/\}\('([\s\S]{200,}?)',(\d+),(\d+),'/);
      if (!m) return '';
      /* The dictionary belongs to this packer call: it starts right where
       * the encoder match ends. Scanning the whole page for '.split('|')'
       * can latch onto an earlier unrelated snippet and blow the decode up. */
      var tail = html.slice(html.indexOf(m[0]) + m[0].length, html.indexOf(m[0]) + m[0].length + 200000);
      var e = tail.match(/^([\s\S]{100,}?)'\.split\('\|'\)/);
      if (!e) return '';
      var enc = m[1];
      var radix = parseInt(m[2], 10);
      var count = parseInt(m[3], 10);
      var dict = e[1].split('|');
      if (dict.length < count) return '';
      while (count-- > 0) {
        if (dict[count]) {
          var re = new RegExp('\\b' + count.toString(radix) + '\\b', 'g');
          enc = enc.replace(re, (function (v) { return function () { return v; }; })(dict[count]));
        }
        if (enc.length > 1000000) return '';
      }
      return enc;
    } catch (_) { return ''; }
  }

  /* Known placeholder, identical for every title on its host: a seconds-long
   * clip, never the requested film. The real route needs browser-only token
   * math (no atob in this sandbox), so these embeds stay unsupported. */
  var PLACEHOLDER_RE = /fsvid\.lol\/troll/i;

  function firstM3u8(text) {
    var m = text.match(/file\s*:\s*['"](https?:[^'"]+?\.m3u8[^'"]*?)['"]/);
    if (m && !PLACEHOLDER_RE.test(m[1])) return m[1];
    m = text.match(/sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*['"](https?:[^'"]+?)['"]/);
    if (m && /\.m3u8/i.test(m[1]) && !PLACEHOLDER_RE.test(m[1])) return m[1];
    return '';
  }

  function firstMp4(text) {
    var m = text.match(/file\s*:\s*['"](https?:[^'"]+?\.mp4[^'"]*?)['"]/);
    return m ? m[1] : '';
  }

  function directHeaders(referer) {
    return { 'User-Agent': UA, Referer: referer || (SITE + '/') };
  }

  async function resolveEmbed(embedUrl, deadline) {
    var page = await fetchText(embedUrl, { Referer: SITE + '/' }, left(deadline, 9000));
    if (page.status !== 200 || !page.text) return null;
    var html = page.text;
    if (/<html[\s>]/i.test(html.slice(0, 2000)) && !/jwplayer|file\s*:|m3u8|mp4/i.test(html)) return null;
    var decoded = unpackDeanEdwards(html);
    var src = decoded ? firstM3u8(decoded) : '';
    var kind = 'hls';
    if (!src) src = firstM3u8(html);
    if (!src) {
      var mp4 = decoded ? firstMp4(decoded) : '';
      if (!mp4) mp4 = firstMp4(html);
      if (mp4) return { url: mp4, type: 'mp4' };
    } else {
      return { url: src, type: kind };
    }
    return null;
  }

  /* ============================================================ STREAM URL */
  async function extractStreamUrl(episodeHref, lang) {
    var deadline = now() + 16000;
    void lang;
    var ref = String(episodeHref == null ? '' : episodeHref).trim();
    if (!ref) return { streams: [] };

    /* Direct media URL passed as href: hand back with route headers. */
    if (/^https?:\/\//i.test(ref) && /\.m3u8(\?|#|$)/i.test(ref)) {
      return { url: ref, headers: directHeaders(SITE + '/'), streamType: 'hls' };
    }
    if (/^https?:\/\//i.test(ref) && /\.mp4(\?|#|$)/i.test(ref)) {
      return { url: ref, headers: directHeaders(SITE + '/'), streamType: 'mp4' };
    }

    var watchUrl = '';
    var referer = SITE + '/';
    var epId = extractId(ref);
    var epMatch = epId.match(/^(tv-\d+)-s(\d+)e(\d+)$/i);

    if (epMatch) {
      var titleId = epMatch[1];
      var r = await fetchJson(SITE + '/api/titles/' + encodeURIComponent(titleId) + '/episodes',
        { Referer: SITE + '/', Accept: 'application/json' }, left(deadline));
      if (r.status !== 200 || !r.data || !Array.isArray(r.data.episodes)) return { streams: [] };
      for (var i = 0; i < r.data.episodes.length; i++) {
        if (String(r.data.episodes[i].id) === epId) { watchUrl = String(r.data.episodes[i].watchUrl || ''); break; }
      }
      if (!watchUrl) return { streams: [] };
    } else {
      /* Film catalogue id: fresh lookup so signed links are current. */
      var items = await getCatalog(deadline);
      var item = findInCatalog(items, epId);
      if (!item) return { streams: [] };
      watchUrl = String(item.watchUrl || '');
      if (!watchUrl) return { streams: [] };
    }

    if (/\.m3u8(\?|#|$)/i.test(watchUrl)) {
      return { url: watchUrl, headers: directHeaders(referer), streamType: 'hls' };
    }
    if (/\.mp4(\?|#|$)/i.test(watchUrl)) {
      return { url: watchUrl, headers: directHeaders(referer), streamType: 'mp4' };
    }
    if (/^https?:\/\//i.test(watchUrl)) {
      var resolved = null;
      try { resolved = await resolveEmbed(watchUrl, deadline); } catch (_) { resolved = null; }
      if (resolved && resolved.url && !PLACEHOLDER_RE.test(resolved.url)) {
        return { url: resolved.url, headers: directHeaders(watchUrl), streamType: resolved.type };
      }
      return { streams: [] };
    }
    return { streams: [] };
  }

  /* =============================================================== exports */
  globalThis.searchResults = searchResults;
  globalThis.extractDetails = extractDetails;
  globalThis.extractEpisodes = extractEpisodes;
  globalThis.extractStreamUrl = extractStreamUrl;
})();
