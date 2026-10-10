// Аргументы yt-dlp для скачивания видео: вынесены отдельно, чтобы их можно было проверить тестами.
// Фильтр: `<=?` пропускает и ролики без известной длительности (`?` ставится ПОСЛЕ оператора; `|` как «или» не работает).
export const MATCH_FILTER = "duration<=?1500";
export const FORMAT = "bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]/bv*[height<=720]+ba/b";

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
