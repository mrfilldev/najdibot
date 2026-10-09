// Скачивает видео по ссылке (YouTube/TikTok) и отправляет в Telegram-чат.
// Запросы приходят от Worker: POST /download {chat_id, message_id, url}.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const TOKEN = process.env.BOT_TOKEN;
const MAX_MB = 50; // лимит Bot API на отправку файла
const API = `https://api.telegram.org/bot${TOKEN}`;

// Cookies YouTube (нужны для роликов 18+ и против «подтвердите, что вы не бот»).
// Приходят секретом как gzip+base64 текста cookies.txt; yt-dlp пишет в файл, поэтому кладём в /tmp.
const COOKIES = "/tmp/yt-cookies.txt";
let cookieArgs = [];
if (process.env.YT_COOKIES_GZB64) {
  try {
    writeFileSync(COOKIES, gunzipSync(Buffer.from(process.env.YT_COOKIES_GZB64, "base64")));
    cookieArgs = ["--cookies", COOKIES];
    console.log("youtube cookies loaded");
  } catch (e) {
    console.error("cookies broken:", e.message);
  }
}

const tg = (method, body) =>
  fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
  });

const out = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.on("close", (code) => (code === 0 ? resolve(o.trim()) : reject(new Error(`${cmd} exit ${code}`))));
  });

// Если видео не H.264 — перекодируем, иначе на части телефонов будет чёрный экран.
async function ensureH264(file, dir) {
  const codec = await out("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name", "-of", "csv=p=0", file,
  ]);
  if (codec === "h264") return file;
  console.log("recoding from", codec);
  const fixed = path.join(dir, "fixed.mp4");
  await run("ffmpeg", [
    "-y", "-i", file,
    "-vf", "scale='min(1280,iw)':-2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", fixed,
  ]);
  return fixed;
}

async function download({ chat_id, message_id, url }) {
  const reply_parameters = { message_id };
  const dir = await mkdtemp(path.join(tmpdir(), "dl-"));
  try {
    await tg("sendChatAction", { chat_id, action: "upload_video" });
    await run("yt-dlp", [
      "--no-playlist", ...cookieArgs,
      "--max-filesize", `${MAX_MB}M`,
      // H.264 + AAC: AV1/VP9 на части устройств Telegram показывает чёрный экран
      "-f", `bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]/bv*[height<=720]+ba/b`,
      "--postprocessor-args", "ffmpeg:-movflags +faststart",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, "video.%(ext)s"),
      url,
    ]);
    const files = await readdir(dir);
    const name = files.find((f) => f.endsWith(".mp4")) ?? files[0];
    if (!name) throw new Error("файла нет (слишком большой?)");
    let file = path.join(dir, name);
    file = await ensureH264(file, dir);
    if ((await stat(file)).size > MAX_MB * 1024 * 1024) throw new Error("файл больше 50 МБ");

    const form = new FormData();
    form.set("chat_id", String(chat_id));
    form.set("reply_to_message_id", String(message_id));
    form.set("supports_streaming", "true");
    form.set("video", await openAsBlob(file, { type: "video/mp4" }), "video.mp4");
    const r = await fetch(`${API}/sendVideo`, { method: "POST", body: form });
    if (!r.ok) throw new Error(`Telegram: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.error("download failed:", e.message);
    await tg("sendMessage", {
      chat_id,
      reply_parameters,
      text: "Не смог скачать: ролик слишком большой, приватный или площадка меня заблокировала.",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function audio({ chat_id, message_id, query }) {
  const dir = await mkdtemp(path.join(tmpdir(), "au-"));
  try {
    await tg("sendChatAction", { chat_id, action: "upload_voice" });
    // Ссылка качается как есть, текст ищется на YouTube (первый результат).
    const src = /^https?:\/\//i.test(query) ? query : `ytsearch1:${query}`;
    await run("yt-dlp", [
      "--no-playlist", ...cookieArgs,
      "--max-filesize", `${MAX_MB}M`,
      "--match-filters", "duration<900", // не тащим часовые миксы
      "-x", "--audio-format", "mp3", "--audio-quality", "192K",
      "--write-info-json",
      "-o", path.join(dir, "audio.%(ext)s"),
      src,
    ]);
    const files = await readdir(dir);
    const mp3 = files.find((f) => f.endsWith(".mp3"));
    if (!mp3) throw new Error("mp3 нет (длиннее 15 минут или не найдено)");
    const file = path.join(dir, mp3);
    if ((await stat(file)).size > MAX_MB * 1024 * 1024) throw new Error("файл больше 50 МБ");
    const info = JSON.parse(await readFile(path.join(dir, "audio.info.json"), "utf8"));

    const form = new FormData();
    form.set("chat_id", String(chat_id));
    form.set("reply_to_message_id", String(message_id));
    form.set("title", String(info.track || info.title || query).slice(0, 100));
    form.set("performer", String(info.artist || info.uploader || "").slice(0, 100));
    if (info.duration) form.set("duration", String(Math.round(info.duration)));
    form.set("audio", await openAsBlob(file, { type: "audio/mpeg" }), `${(info.title || "track").replace(/[\\/:*?"<>|]/g, "")}.mp3`);
    const r = await fetch(`${API}/sendAudio`, { method: "POST", body: form });
    if (!r.ok) throw new Error(`Telegram: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.error("audio failed:", e.message);
    await tg("sendMessage", {
      chat_id,
      reply_parameters: { message_id },
      text: "Не нашёл или не смог скачать трек (длиннее 15 минут, недоступен или слишком большой).",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

http
  .createServer((req, res) => {
    const handler = { "/download": download, "/audio": audio }[req.url];
    if (req.method !== "POST" || !handler) {
      res.writeHead(200).end("ok");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // Отвечаем сразу, работаем в фоне: скачивание может идти долго.
      res.writeHead(202).end("accepted");
      handler(JSON.parse(body)).catch((e) => console.error(e));
    });
  })
  .listen(8080, () => console.log("listening on 8080"));
