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

// ---- Погода голосом: Open-Meteo -> LLM пишет реплику -> TTS (OpenRouter) -> ffmpeg (хрипота, тон выше) -> sendVoice ----
const OR_KEY = process.env.OPENROUTER_API_KEY;
const LLM = process.env.LLM_MODEL || "google/gemini-2.5-flash";
const TTS_MODEL = "openai/gpt-audio-mini";
const TTS_VOICE = "ash"; // голос потоньше, чем onyx
const PITCH = 1.12; // подъём тона (1 = без изменений)

const WMO = {
  0: "ясно", 1: "почти ясно", 2: "переменная облачность", 3: "пасмурно", 45: "туман", 48: "туман с изморозью",
  51: "морось", 53: "морось", 55: "сильная морось", 61: "небольшой дождь", 63: "дождь", 65: "сильный дождь",
  71: "небольшой снег", 73: "снег", 75: "сильный снег", 80: "ливни", 81: "сильные ливни", 82: "очень сильные ливни",
  95: "гроза", 96: "гроза с градом", 99: "сильная гроза с градом",
};

const STYLE = `Ты пишешь реплику для озвучки: грубый уличный парень отвечает на вопрос о погоде. Стиль:
- быстрый рваный говор, почти после каждого слова или короткой фразы матерная вставка-паразит («нахуй», «блядь»);
- начни с обращения («Слышь…») и вопроса-вызова, мол, сам в окно выглянуть не можешь;
- назови город, температуру, как ощущается, ветер и осадки по данным ниже, числа пиши словами;
- закончи коротким приказом и «понял?».
Длина 40-60 слов. Только текст реплики, без кавычек и пояснений. Без оскорблений по национальности, полу, вере и здоровью.`;

async function weatherLine({ city, lat, lon }) {
  const w = await (await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,precipitation,weather_code&timezone=auto`,
    { signal: AbortSignal.timeout(10_000) },
  )).json();
  const c = w.current;
  const facts = `Город: ${city}. Температура ${Math.round(c.temperature_2m)} градусов, ощущается как ${Math.round(c.apparent_temperature)}. ` +
    `Ветер ${Math.round(c.wind_speed_10m)} км/ч. Осадки: ${c.precipitation} мм. Небо: ${WMO[c.weather_code] ?? "непонятно что"}.`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${OR_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: LLM, max_tokens: 300,
        messages: [{ role: "system", content: STYLE }, { role: "user", content: facts }],
      }),
    });
    const text = (await r.json()).choices?.[0]?.message?.content?.trim();
    if (text) return text;
  } catch (e) {
    console.error("weather llm failed:", e.message);
  }
  // запасной вариант без LLM
  return `Слышь, ты чё, нахуй, в окно выглянуть не можешь, блядь? ${city}, нахуй, ${Math.round(c.temperature_2m)} градусов, блядь, ` +
    `ощущается как ${Math.round(c.apparent_temperature)}, ${WMO[c.weather_code] ?? "хрен поймёшь"}, нахуй. Одевайся нормально, понял?`;
}

// Озвучка через OpenRouter: поток SSE с pcm16 (24 кГц, моно).
async function ttsPcm(text) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OR_KEY}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: TTS_MODEL, stream: true, modalities: ["text", "audio"],
      audio: { voice: TTS_VOICE, format: "pcm16" },
      messages: [
        { role: "system", content: "Ты озвучиваешь текст. Говори по-русски быстро, грубо и нагло, как уличный парень. Произнеси текст пользователя дословно, ничего не добавляя и не пропуская." },
        { role: "user", content: text },
      ],
    }),
  });
  const chunks = [];
  for (const line of (await r.text()).split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    try {
      const a = JSON.parse(line.slice(6)).choices?.[0]?.delta?.audio;
      if (a?.data) chunks.push(Buffer.from(a.data, "base64"));
    } catch {}
  }
  const pcm = Buffer.concat(chunks);
  if (!pcm.length) throw new Error("TTS: пустой звук");
  return pcm;
}

async function weather({ chat_id, message_id, city, lat, lon }) {
  const dir = await mkdtemp(path.join(tmpdir(), "wx-"));
  try {
    await tg("sendChatAction", { chat_id, action: "record_voice" });
    const text = await weatherLine({ city, lat, lon });
    const pcmFile = path.join(dir, "in.pcm");
    const ogg = path.join(dir, "out.ogg");
    writeFileSync(pcmFile, await ttsPcm(text));
    // тон выше (asetrate + возврат темпа), хрипота, компрессия, громкость -> opus для голосового
    await run("ffmpeg", [
      "-y", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmFile,
      "-af", `asetrate=24000*${PITCH},aresample=48000,atempo=${(1 / PITCH * 1.05).toFixed(3)},highpass=f=100,acrusher=bits=11:mode=log:mix=0.2,acompressor=threshold=-18dB:ratio=4,loudnorm=I=-16`,
      "-c:a", "libopus", "-b:a", "40k", "-ac", "1", ogg,
    ]);
    const dur = Math.round(parseFloat(await out("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ogg])));
    const form = new FormData();
    form.set("chat_id", String(chat_id));
    form.set("reply_to_message_id", String(message_id));
    form.set("duration", String(dur));
    form.set("voice", await openAsBlob(ogg, { type: "audio/ogg" }), "weather.ogg");
    const r = await fetch(`${API}/sendVoice`, { method: "POST", body: form });
    if (!r.ok) throw new Error(`Telegram: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.error("weather failed:", e.message);
    await tg("sendMessage", { chat_id, reply_parameters: { message_id }, text: "Не смог озвучить погоду, глянь в окно." });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

http
  .createServer((req, res) => {
    const handler = { "/download": download, "/audio": audio, "/weather": weather }[req.url];
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
