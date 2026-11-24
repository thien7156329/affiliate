/**
 * Story URL → plain text of every chapter: read the page body, follow the "next chapter" link (a[rel=next])
 * while it stays inside the same story, stop at the last chapter. Tuned for truyenmacothat.net (div.reader-text),
 * with common WordPress/article fallbacks. Used when a spirit/story topic carries a story link.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BODY_SELECTORS = [".reader-text", ".chapter-content", ".reading-content", ".entry-content", "article"];
const MAX_CHAPTERS = Number(process.env.STORY_MAX_CHAPTERS || 30);
/** Hosts whose links are fetched automatically from a topic. */
export const STORY_HOSTS = ["truyenmacothat.net"];

export const findStoryUrl = (text: string): string | null => {
  for (const m of text.match(/https?:\/\/[^\s)"'<>]+/g) ?? []) {
    try {
      if (STORY_HOSTS.some((h) => new URL(m).host.endsWith(h))) return m;
    } catch {
      /* not a URL */
    }
  }
  return null;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8230;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#8217;/g, "'")
    .replace(/&nbsp;/g, " ");

const extract = async (html: string, base: string) => {
  let title = "";
  let next: string | null = null;
  const bySel: Record<string, string[]> = {};
  let rw = new HTMLRewriter()
    .on("title", {text: (t) => void (title += t.text)})
    .on('a[rel="next"]', {element: (e) => void (next ??= e.getAttribute("href"))});
  for (const sel of BODY_SELECTORS) {
    bySel[sel] = [];
    let cur = "";
    rw = rw.on(`${sel} p`, {
      element: (e) => {
        cur = "";
        e.onEndTag(() => {
          const t = cur.replace(/\s+/g, " ").trim();
          // skip the page's meta line ("Tháng 9 17, 2026 · Ongoing · 202 lượt xem · Ch. 1/3")
          if (t && !/lượt xem|·\s*(Ongoing|Completed|Hoàn thành)/i.test(t)) bySel[sel].push(t);
        });
      },
      text: (t) => void (cur += t.text),
    });
  }
  await rw.transform(new Response(html)).text();
  const paras = BODY_SELECTORS.map((s) => bySel[s]).find((p) => p.join(" ").length > 300) ?? [];
  return {
    title: decode(title.replace(/\s*[|–-]\s*Truyện Ma.*$/i, "").trim()),
    text: decode(paras.join("\n")),
    next: next ? new URL(next, base).toString() : null,
  };
};

export type FetchedStory = {url: string; title: string; chapters: {title: string; url: string; text: string}[]; text: string; words: number};

export const fetchStoryFromUrl = async (url: string, log?: (s: string) => void): Promise<FetchedStory> => {
  const start = new URL(url.trim());
  const storyPrefix = start.pathname.replace(/chuong-\d+\/?$/, "");
  const chapters: FetchedStory["chapters"] = [];
  const seen = new Set<string>();
  let at: string | null = start.toString();
  while (at && chapters.length < MAX_CHAPTERS && !seen.has(at)) {
    seen.add(at);
    const res = await fetch(at, {headers: {"user-agent": UA, "accept-language": "vi,en;q=0.8"}});
    if (!res.ok) {
      if (!chapters.length) throw new Error(`Không tải được ${at} (HTTP ${res.status})`);
      break;
    }
    const page = await extract(await res.text(), at);
    if (!page.text) {
      if (!chapters.length) throw new Error(`Không tìm thấy nội dung truyện ở ${at}`);
      break;
    }
    chapters.push({title: page.title, url: at, text: page.text});
    log?.(`[Truyện] Chương ${chapters.length}: ${page.title.slice(0, 80)} (${page.text.split(/\s+/).length} chữ)`);
    const nxt: string | null = page.next;
    at = nxt && new URL(nxt).host === start.host && new URL(nxt).pathname.startsWith(storyPrefix) ? nxt : null;
  }
  const title = chapters[0]?.title.replace(/\s*Chương\s*\d+.*$/i, "").trim() || start.pathname;
  const text = chapters.map((c, i) => `--- CHƯƠNG ${i + 1} ---\n${c.text}`).join("\n\n");
  return {url: start.toString(), title, chapters, text, words: text.split(/\s+/).filter(Boolean).length};
};
