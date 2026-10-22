import { describe, expect, it } from "vitest";
import { ANY_URL, AUDIO_URL, DOWNLOAD_CMD } from "../worker/sites.js";
import { PAGE_ONLY_RE, driveDirect, fileKind, isDirectMedia, musicQueryFromHtml, parseFx, parseOg, twitterId } from "../container/media.mjs";

const yes = [
  "https://x.com/user/status/123", "https://twitter.com/u/status/9?s=20", "https://vk.com/video-1_2", "https://vkvideo.ru/video-1_2",
  "https://www.facebook.com/reel/1", "https://pin.it/abc", "https://rutube.ru/video/abc/", "https://vimeo.com/12345",
  "https://www.twitch.tv/videos/99", "https://clips.twitch.tv/Foo", "https://www.pixiv.net/en/artworks/1", "https://www.wildberries.ru/catalog/12345/detail.aspx",
  "https://www.ozon.ru/product/some-123/", "https://www.amazon.com/Some-Thing/dp/B000", "https://a.aliexpress.com/_EHNy1se", "https://www.avito.ru/moskva/telefony/x_123",
  "https://drive.google.com/file/d/AbC/view", "https://open.spotify.com/track/xyz", "https://soundcloud.com/a/b", "https://music.yandex.ru/album/1/track/2",
  "https://pikabu.ru/story/foo_123", "https://www.threads.net/@u/post/Abc",
];
const no = ["https://x.com/user", "https://vk.com/durov", "https://t.me/durov", "https://t.me/durov/123", "https://github.com/a/b", "https://google.com", "https://example.com/page"];

describe("sites", () => {
  it.each(yes)("ловит %s", (u) => expect(ANY_URL.test(u)).toBe(true));
  it.each(no)("пропускает %s", (u) => expect(ANY_URL.test(u)).toBe(false));
  it("музыка отдельно", () => {
    expect(AUDIO_URL.test("https://open.spotify.com/track/xyz")).toBe(true);
    expect(AUDIO_URL.test("https://x.com/u/status/1")).toBe(false);
  });
  it("команда скачай", () => {
    expect(DOWNLOAD_CMD.exec("скачай https://foo.bar/x.mp4")[1]).toBe("https://foo.bar/x.mp4");
    expect(DOWNLOAD_CMD.test("Саня, скачай https://foo.bar")).toBe(true);
  });
});

describe("media", () => {
  it("прямые файлы", () => {
    expect(isDirectMedia("https://a/b.mp4?x=1")).toBe(true);
    expect(isDirectMedia("https://a/b")).toBe(false);
    expect(fileKind("https://a/b.GIF")).toBe("animation");
    expect(fileKind("https://a/b.zip")).toBe("document");
    expect(fileKind("https://a/b.ogg")).toBe("document");
    expect(fileKind("https://a/b.mp3")).toBe("audio");
  });
  it("PAGE_ONLY", () => {
    expect(PAGE_ONLY_RE.test("https://www.ozon.ru/product/1/")).toBe(true);
    expect(PAGE_ONLY_RE.test("https://youtube.com/watch?v=1")).toBe(false);
  });
  it("og и fxtwitter", () => {
    const r = parseOg('<meta property="og:image" content="/a.jpg"><meta property="og:video" content="https://v/x.mp4">', "https://s.com/p");
    expect(r).toEqual({ images: ["https://s.com/a.jpg"], videos: ["https://v/x.mp4"] });
    expect(twitterId("https://x.com/a/status/42")).toBe("42");
    expect(parseFx({ tweet: { media: { photos: [{ url: "p" }], videos: [{ url: "v" }] } } })).toMatchObject({ images: ["p"], videos: ["v"] });
  });
  it("диски и музыка", () => {
    expect(driveDirect("https://drive.google.com/file/d/AbC_1/view")).toContain("id=AbC_1");
    expect(musicQueryFromHtml('<meta property="og:title" content="Song"><meta property="og:description" content="Artist · Song · 2020">')).toBe("Artist Song");
  });
});

import { FEATURES } from "../worker/settings.js";
import { MUSIC_LOOKUP_RE, yandexDiskApi } from "../container/media.mjs";
describe("мелочи", () => {
  it("подписи кнопок настроек влезают без многоточия", () => {
    for (const [, name] of FEATURES) expect(`✅ ${name}`.length).toBeLessThanOrEqual(16);
  });
  it("Dropbox: dl=0 -> dl=1, ссылка без параметров тоже", () => {
    expect(driveDirect("https://www.dropbox.com/s/abc/f.mp4?dl=0")).toBe("https://www.dropbox.com/s/abc/f.mp4?dl=1");
    expect(driveDirect("https://www.dropbox.com/s/abc/f.mp4")).toBe("https://www.dropbox.com/s/abc/f.mp4?dl=1");
    expect(driveDirect("https://youtube.com/x")).toBeNull();
  });
  it("Яндекс Диск и поиск музыки", () => {
    expect(yandexDiskApi("https://disk.yandex.ru/i/AbC")).toContain("public_key=https%3A%2F%2Fdisk.yandex.ru%2Fi%2FAbC");
    expect(yandexDiskApi("https://example.com/i/x")).toBeNull();
    expect(MUSIC_LOOKUP_RE.test("https://open.spotify.com/track/1")).toBe(true);
    expect(MUSIC_LOOKUP_RE.test("https://soundcloud.com/a/b")).toBe(false);
  });
  it("названия треков чистятся от хвостов сервисов", () => {
    expect(musicQueryFromHtml('<meta property="og:title" content="Song by Artist on Apple Music">')).toBe("Song by Artist");
    expect(musicQueryFromHtml(`<meta property="og:title" content="Song - Single by Artist">`)).toBe("Song");
    expect(musicQueryFromHtml('<meta property="og:title" content="Numb | Spotify"><meta property="og:description" content="Linkin Park · Meteora · Song · 2003">')).toBe("Linkin Park Numb");
    expect(musicQueryFromHtml("<title>Artist - Song Lyrics | Genius Lyrics</title>")).toContain("Artist - Song");
    expect(musicQueryFromHtml("<html></html>")).toBeNull();
  });
  it("fxtwitter без медиа", () => {
    expect(parseFx({})).toMatchObject({ images: [], videos: [] });
    expect(parseFx({ tweet: { media: { all: [{ type: "video", url: "v" }, { type: "photo", url: "p" }] } } }).videos).toEqual(["v"]);
  });
});
