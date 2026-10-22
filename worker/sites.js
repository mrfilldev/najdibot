// t.me намеренно нет: ссылки на сообщения чатов кидают постоянно, качаем их только по «скачай <ссылка>».
// Какие ссылки бот скачивает сам. Каждый шаблон: хост (с любыми поддоменами) + путь, по которому видно, что это контент, а не главная/профиль.
const H = "(?:[\\w-]+\\.)*";
const VIDEO_SITES = [
  "youtube\\.com", "youtu\\.be", "tiktok\\.com",
  "v\\.redd\\.it", "reddit\\.com\\/r\\/[\\w-]+\\/(?:s|comments)(?=\\/)",
  "instagram\\.com\\/(?:reels?|p|tv)(?=\\/)",
  // соцсети и видеохостинги
  "(?:twitter|x|fxtwitter|fixupx|vxtwitter)\\.com\\/\\w+\\/status\\/\\d+",
  "(?:vk\\.com|vk\\.ru|vkvideo\\.ru)\\/(?:video|clip)-?\\d+_\\d+", "vkvideo\\.ru\\/video",
  "facebook\\.com\\/(?:reel|watch|share\\/[vr]|[\\w.-]+\\/(?:videos|posts))", "fb\\.watch\\/", "fb\\.com\\/",
  "pinterest\\.[a-z.]+\\/pin\\/", "pin\\.it\\/",
  "likee\\.(?:video|com)\\/", "snapchat\\.com\\/(?:spotlight|t|add)\\/",
  "ok\\.ru\\/(?:video|live|movie)", "rutube\\.ru\\/(?:video|shorts|play)\\/",
  "dzen\\.ru\\/(?:video|shorts|a)\\/", "zen\\.yandex\\.ru\\/(?:video|media)",
  "twitch\\.tv\\/(?:videos\\/\\d+|\\w+\\/clip\\/)", "clips\\.twitch\\.tv\\/", "kick\\.com\\/[\\w-]+(?:\\/clips\\/|\\?clip=)",
  "vimeo\\.com\\/(?:channels\\/[\\w-]+\\/)?\\d+", "dailymotion\\.com\\/video\\/", "dai\\.ly\\/",
  "bilibili\\.com\\/video\\/", "b23\\.tv\\/", "bsky\\.app\\/profile\\/[^\\/\\s]+\\/post\\/",
  "threads\\.(?:net|com)\\/@[\\w.]+\\/post\\/", "linkedin\\.com\\/(?:posts|feed\\/update|video)\\/",
  "tumblr\\.com\\/(?:post\\/)?[\\w-]*\\/?\\d{8,}", "9gag\\.com\\/gag\\/", "imgur\\.com\\/(?:a|gallery|t\\/[\\w-]+)\\/\\w+", "i\\.imgur\\.com\\/\\w+",
  "streamable\\.com\\/\\w+", "coub\\.com\\/view\\/", "ted\\.com\\/talks\\/", "odysee\\.com\\/@", "imdb\\.com\\/video\\/",
  "smotrim\\.ru\\/video\\/", "substack\\.com\\/(?:p|@[\\w-]+\\/p)", "khanacademy\\.org\\/.+\\/v\\/",
  // картинки, арт, гифки
  "pixiv\\.net\\/(?:\\w+\\/)?artworks\\/\\d+", "behance\\.net\\/gallery\\/", "deviantart\\.com\\/[\\w-]+\\/art\\/", "artstation\\.com\\/artwork\\/",
  "flickr\\.com\\/photos\\/", "flic\\.kr\\/p\\/", "unsplash\\.com\\/photos\\/", "pexels\\.com\\/(?:\\w+\\/)?(?:photo|video)\\/",
  "giphy\\.com\\/gifs\\/", "tenor\\.com\\/view\\/", "telegra\\.ph\\/", "500px\\.com\\/photo\\/",
  "(?:danbooru\\.donmai\\.us|gelbooru\\.com)\\/.*(?:posts\\/\\d+|id=\\d+)",
  // статьи и посты
  "pikabu\\.ru\\/story\\/", "habr\\.com\\/(?:\\w+\\/)?(?:articles|posts|news)\\/\\d+", "medium\\.com\\/.+-[0-9a-f]{10,}",
  // маркетплейсы: фото и видео товара
  "a\\.aliexpress\\.com\\/_", "aliexpress\\.(?:com|ru|us)\\/(?:item|i)\\/",
  "wildberries\\.ru\\/catalog\\/\\d+", "wb\\.ru\\/", "ozon\\.(?:ru|by|kz)\\/(?:product|t|context)\\/", "market\\.yandex\\.(?:ru|by|kz)\\/(?:product|card)",
  "avito\\.ru\\/[\\w\\/-]*_\\d+", "amazon\\.(?:com|de|co\\.uk|fr|it|es|ca|co\\.jp|in|pl|se|nl)\\/(?:[^\\s\\/]+\\/)?(?:dp|gp\\/product)\\/", "amzn\\.(?:to|eu)\\/", "a\\.co\\/d\\/",
  "ebay\\.[a-z.]+\\/itm\\/", "temu\\.com\\/", "shein\\.[a-z.]+\\/.*-p-\\d+", "(?:item|detail)\\.(?:taobao|tmall)\\.com\\/", "m\\.tb\\.cn\\/", "e\\.tb\\.cn\\/",
  "detail\\.1688\\.com\\/offer\\/", "etsy\\.com\\/(?:\\w+\\/)?listing\\/\\d+", "joom\\.com\\/(?:\\w+\\/)?products\\/",
  "vinted\\.[a-z.]+\\/items\\/", "olx\\.[a-z.]+\\/d\\/", "kaspi\\.kz\\/shop\\/p\\/", "lamoda\\.ru\\/p\\/", "megamarket\\.ru\\/catalog\\/details\\/",
  "dns-shop\\.ru\\/product\\/", "citilink\\.ru\\/product\\/", "poizon\\.com\\/", "dewu\\.com\\/",
  // публичные файлы
  "drive\\.google\\.com\\/(?:file\\/d\\/|open\\?id=)", "dropbox\\.com\\/s", "(?:disk\\.yandex\\.[a-z]+|yadi\\.sk)\\/(?:i|d)\\/", "mediafire\\.com\\/(?:file|view)\\/",
];
// Музыкальные сервисы: качаем звук (SoundCloud и др.) либо находим трек по названию на YouTube (Spotify, Яндекс Музыка…)
const AUDIO_SITES = [
  "soundcloud\\.com\\/[\\w-]+\\/[\\w-]+", "on\\.soundcloud\\.com\\/", "[\\w-]+\\.bandcamp\\.com\\/track\\/", "mixcloud\\.com\\/[\\w-]+\\/[\\w-]+", "audiomack\\.com\\/[\\w-]+\\/song\\/",
  "open\\.spotify\\.com\\/(?:intl-\\w+\\/)?track\\/", "spotify\\.link\\/", "music\\.yandex\\.(?:ru|com|by|kz)\\/(?:album\\/\\d+\\/)?track\\/\\d+", "music\\.apple\\.com\\/[\\w-]+\\/(?:album|song)\\/",
  "deezer\\.com\\/(?:\\w+\\/)?track\\/\\d+", "zvuk\\.com\\/track\\/\\d+", "genius\\.com\\/[\\w-]+-lyrics",
];
const build = (list) => new RegExp(`https?:\\/\\/${H}(?:${list.join("|")})\\S*`, "i");
export const AUDIO_URL = build(AUDIO_SITES);
export const VIDEO_URL = build(VIDEO_SITES);
// Ссылка, которую качаем автоматически (видео, картинки или звук)
export const ANY_URL = build([...VIDEO_SITES, ...AUDIO_SITES]);
// «скачай <любая ссылка>» — явная просьба: берём любую страницу или прямой файл
export const DOWNLOAD_CMD = /^(?:саня[\s,]+)?(?:скачай|качни|скачать|загрузи|download)[\s,:;!.-]+(https?:\/\/\S+)/i;
