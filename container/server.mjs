// Скачивает видео по ссылке (YouTube/TikTok) и отправляет в Telegram-чат.
// Запросы приходят от Worker: POST /download {chat_id, message_id, url}.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = process.env.BOT_TOKEN;
const MAX_MB = 50; // лимит Bot API на отправку файла
const API = `https://api.telegram.org/bot${TOKEN}`;

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

async function download({ chat_id, message_id, url }) {
  const reply_parameters = { message_id };
  const dir = await mkdtemp(path.join(tmpdir(), "dl-"));
  try {
    await tg("sendChatAction", { chat_id, action: "upload_video" });
    await run("yt-dlp", [
      "--no-playlist",
      "--max-filesize", `${MAX_MB}M`,
      "-f", `bv*[filesize<${MAX_MB}M]+ba/b[filesize<${MAX_MB}M]/b`,
      "--merge-output-format", "mp4",
      "-o", path.join(dir, "video.%(ext)s"),
      url,
    ]);
    const files = await readdir(dir);
    const name = files.find((f) => f.endsWith(".mp4")) ?? files[0];
    if (!name) throw new Error("файла нет (слишком большой?)");
    const file = path.join(dir, name);
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

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/download") {
      res.writeHead(200).end("ok");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // Отвечаем сразу, работаем в фоне: скачивание может идти долго.
      res.writeHead(202).end("accepted");
      download(JSON.parse(body)).catch((e) => console.error(e));
    });
  })
  .listen(8080, () => console.log("listening on 8080"));
