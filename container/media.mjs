// Скачивание фото/видео со страниц, которые yt-dlp не умеет: прямые ссылки, og:-теги, X через fxtwitter, публичные диски, поиск трека по странице.
import { isAliExpress, parseAliMedia } from "./ytargs.mjs";

export const DIRECT_RE = /\.(mp4|mov|webm|mkv|m4v|gif|jpe?g|png|webp|avif|mp3|m4a|ogg|wav|flac|pdf|zip)(?:[?#]|$)/i;
export const isDirectMedia = (url) => DIRECT_RE.test(String(url).split(/[?#]/)[0] + (String(url).includes("?") ? "?" : ""));
export const fileKind = (url) => {
  const e = (String(url).split(/[?#]/)[0].match(/\.(\w+)$/) || [])[1]?.toLowerCase();
  if (["mp4", "mov", "webm", "mkv", "m4v"].includes(e)) return "video";
  if (e === "gif") return "animation";
  if (["jpg", "jpeg", "png", "webp", "avif"].includes(e)) return "photo";
  if (["mp3", "m4a"].includes(e)) return "audio"; // sendAudio берёт только mp3/m4a, остальное документом
  return "document";
};

// Сайты, где yt-dlp бесполезен: сразу берём фото/видео со страницы
export const PAGE_ONLY_RE = /^https?:\/\/(?:[\w-]+\.)*(?:aliexpress\.(?:com|ru|us)|wildberries\.ru|wb\.ru|ozon\.(?:ru|by|kz)|market\.yandex\.\w+|avito\.ru|amazon\.[a-z.]+|amzn\.(?:to|eu)|a\.co|ebay\.[a-z.]+|temu\.com|shein\.[a-z.]+|taobao\.com|tmall\.com|tb\.cn|1688\.com|etsy\.com|joom\.com|vinted\.[a-z.]+|olx\.[a-z.]+|kaspi\.kz|lamoda\.ru|megamarket\.ru|dns-shop\.ru|citilink\.ru|poizon\.com|dewu\.com|pixiv\.net|behance\.net|deviantart\.com|artstation\.com|flickr\.com|flic\.kr|unsplash\.com|pexels\.com|giphy\.com|tenor\.com|telegra\.ph|500px\.com|danbooru\.donmai\.us|gelbooru\.com|pikabu\.ru|habr\.com|medium\.com|threads\.(?:net|com))\//i;

const abs = (u, base) => {
  try { return new URL(u.replace(/&amp;/g, "&"), base).href; } catch { return null; }
};
const metaAll = (html, names) => {
  const out = [];
  for (const tag of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0];
    const key = (t.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
    if (!key || !names.includes(key)) continue;
    const v = (t.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (v) out.push(v);
  }
  return out;
};
const uniq = (a) => [...new Set(a.filter(Boolean))];

// og:/twitter:-теги, <video>/<source>, ld+json contentUrl
export const parseOg = (html, base = "https://example.com/") => {
  const h = String(html);
  const vids = metaAll(h, ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]);
  for (const m of h.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) vids.push(m[1]);
  for (const m of h.matchAll(/"contentUrl"\s*:\s*"([^"]+\.(?:mp4|webm|m3u8)[^"]*)"/gi)) vids.push(m[1].replace(/\\\//g, "/"));
  const imgs = metaAll(h, ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]);
  const videos = uniq(vids.map((u) => abs(u, base))).filter((u) => /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(u) || /video/i.test(u));
  const images = uniq(imgs.map((u) => abs(u, base)));
  return { images, videos };
};

// Страница -> медиа: свой разбор для AliExpress, остальным og:-теги
export const parsePage = (html, url) => {
  if (isAliExpress(url)) return parseAliMedia(html);
  return parseOg(html, url);
};

// X/Twitter без логина: api.fxtwitter.com отдаёт JSON с прямыми ссылками
export const twitterId = (url) => (String(url).match(/(?:twitter|x|fxtwitter|fixupx|vxtwitter)\.com\/\w+\/status\/(\d+)/i) || [])[1] || null;
export const parseFx = (json) => {
  const media = json?.tweet?.media || {};
  const videos = (media.videos || media.all?.filter((m) => m.type !== "photo") || []).map((v) => v.url).filter(Boolean);
  const images = (media.photos || []).map((p) => p.url).filter(Boolean);
  return { images: uniq(images), videos: uniq(videos), text: json?.tweet?.text || "" };
};

// Публичные ссылки на диски -> прямая ссылка на файл
export const driveDirect = (url) => {
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/i);
  if (m) return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`;
  if (/dropbox\.com\/s/i.test(url)) return String(url).replace(/[?&]dl=0/, "").replace(/(\?|$)/, (x) => (x ? "?dl=1" : "?dl=1")).replace(/\?dl=1\?/, "?");
  return null;
};
export const yandexDiskApi = (url) =>
  /(?:disk\.yandex\.[a-z]+|yadi\.sk)\/(?:i|d)\//i.test(url) ? `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(url)}` : null;

// Музыкальная страница (Spotify, Яндекс Музыка, Apple Music, Deezer…) -> строка поиска «исполнитель название»
export const MUSIC_LOOKUP_RE = /^https?:\/\/(?:[\w-]+\.)*(?:spotify\.com|spotify\.link|music\.yandex\.\w+|music\.apple\.com|deezer\.com|zvuk\.com|genius\.com)\//i;
export const musicQueryFromHtml = (html) => {
  const t = metaAll(html, ["og:title", "twitter:title"])[0] || (String(html).match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  const d = metaAll(html, ["og:description", "description"])[0] || "";
  let title = t.replace(/\s*[|\-–—]\s*(?:Spotify|Яндекс\s*Музыка|Apple Music|Deezer|Genius).*$/i, "").replace(/\s+on Apple Music$/i, "").replace(/ Lyrics$/i, "").trim();
  // Spotify: «Artist · Song · 2020», Deezer/Apple: «Song by Artist»
  const dot = d.split("·").map((x) => x.trim());
  const artist = dot.length > 1 ? dot[0] : "";
  title = title.replace(/\s+-\s+(?:song|single|EP|album)(?:\s+(?:and|by)\s+.*)?$/i, "");
  return `${artist} ${title}`.replace(/\s+/g, " ").trim().slice(0, 150) || null;
};
