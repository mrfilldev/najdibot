// Аргументы yt-dlp для скачивания видео: вынесены отдельно, чтобы их можно было проверить тестами.
// Фильтр: `<=?` пропускает и ролики без известной длительности (`?` ставится ПОСЛЕ оператора; `|` как «или» не работает).
export const MATCH_FILTER = "duration<=?1500";
// Лесенка качества: берём самое высокое, что по оценке размера влезает в 50 МБ (видеопоток + ~5 МБ на звук).
// Планка считается по длинной стороне (width и height оба <= side): у вертикальных рилсов height = 1280 при «720p»,
// и обычное height<=720 отбрасывало их в самый низкий формат.
// Размер неизвестен (`?`) допускаем только на уровне 720p и ниже; если всё же не влезло, срабатывает --max-filesize.
const tier = (side, mb, unknown = "") =>
  `bv*[vcodec^=avc1][height<=${side}][width<=${side}][filesize_approx<=${mb}M]${unknown}+ba[acodec^=mp4a]`;
export const FORMAT = [
  tier(1920, 40),
  tier(1280, 44),
  tier(1280, 44, "?"),
  // Инстаграм отдаёт только VP9 без размера в метаданных: берём лучшее до 1080p, в H.264 переведёт ensureH264
  "bv*[height<=1920][width<=1920]+ba",
  "bv*[vcodec^=avc1][height<=854][width<=854]+ba[acodec^=mp4a]",
  "b[vcodec^=avc1][height<=1280][width<=1280]",
  "bv*[height<=1280][width<=1280]+ba",
  "b",
].join("/");

export const videoArgs = ({ maxMb, dir, url }) => [
  "--no-playlist",
  "--max-filesize", `${maxMb}M`,
  // Длинные ролики (часовые плейлисты и т.п.) в 50 МБ не влезут: пропускаем, а не берём огрызок
  "--match-filters", MATCH_FILTER,
  // H.264 + AAC: AV1/VP9 на части устройств Telegram показывает чёрный экран
  "-f", FORMAT,
  "--postprocessor-args", "ffmpeg:-movflags +faststart",
  "--merge-output-format", "mp4",
  "-o", `${dir}/video.%(ext)s`,
  url,
];

// Instagram-пост без видео (одни фото): yt-dlp говорит «There is no video in this post».
// Картинку берём со страницы встраивания (без логина); для карусели доступна только первая.
export const NO_VIDEO_RE = /There is no video in this post/i;
export const instagramEmbedUrl = (url) => {
  const m = String(url).match(/instagram\.com\/(?:p|reels?|tv)\/([\w-]+)/i);
  return m ? `https://www.instagram.com/p/${m[1]}/embed/captioned/` : null;
};
export const parseEmbedImage = (html) => {
  const m = String(html).match(/class="EmbeddedMediaImage"[^>]*?src="([^"]+)"/);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&#0?38;/g, "&") : null;
};
