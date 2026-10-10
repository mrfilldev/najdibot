import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FORMAT, MATCH_FILTER, videoArgs } from "../container/ytargs.mjs";

describe("аргументы yt-dlp для видео", () => {
  const args = videoArgs({ maxMb: 50, dir: "/tmp/x", url: "https://youtu.be/abc" });
  it("фильтр длительности в правильном синтаксисе (`?` после оператора, без `|`)", () => {
    expect(MATCH_FILTER).toMatch(/^duration<=\?\d+$/);
    expect(args[args.indexOf("--match-filters") + 1]).toBe(MATCH_FILTER);
  });
  it("лимит размера, формат H.264, вывод в mp4, ссылка последним", () => {
    expect(args[args.indexOf("--max-filesize") + 1]).toBe("50M");
    expect(args[args.indexOf("-f") + 1]).toBe(FORMAT);
    expect(FORMAT).toContain("avc1");
    expect(args).toContain("--no-playlist");
    expect(args.at(-1)).toBe("https://youtu.be/abc");
    expect(args[args.indexOf("-o") + 1]).toBe("/tmp/x/video.%(ext)s");
  });

  // Реальная проверка синтаксиса парсером yt-dlp (если он есть: pip install yt-dlp); иначе пропускаем.
  const hasYt = (() => { try { execFileSync("python3", ["-c", "import yt_dlp"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.skipIf(!hasYt)("yt-dlp принимает фильтр и применяет как задумано", () => {
    const run = (info) => execFileSync("python3", ["-c", `import sys,json\nfrom yt_dlp.utils import match_str\nprint(match_str(sys.argv[1], json.loads(sys.argv[2])))`, MATCH_FILTER, JSON.stringify(info)]).toString().trim();
    expect(run({ duration: 60 })).toBe("True");
    expect(run({})).toBe("True"); // длительность неизвестна: пропускаем
    expect(run({ duration: 5000 })).toBe("False");
  });
});
