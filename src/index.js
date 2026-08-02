import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Config ──────────────────────────────────────────────────────────

const VERSION = "1.2.0";

const PERPLEXITY_TIMEOUT_MS = 30_000;
const FETCH_PER_ATTEMPT_MS = 8_000;
const FETCH_TOTAL_BUDGET_MS = 25_000;
const FETCH_MAX_CHARS_DEFAULT = 8_000;
const FETCH_MAX_CHARS_LIMIT = 32_000;
const SPA_SHELL_THRESHOLD = 200;
const SIMPLE_CHALLENGE_BODY_SCAN_LIMIT = 80_000;
// looksBlocked strips inline script/style from this much source, then inspects
// the first BLOCK_SCAN_LIMIT characters of what is left.
const BLOCK_SCAN_SOURCE_LIMIT = 200_000;
const BLOCK_SCAN_LIMIT = 4_000;
const CLIENT_REDIRECT_LIMIT = 2;
const CACHE_TTL_SECONDS_DEFAULT = 300;
const FETCH_MANY_LIMIT = 5;
const SEARCH_FETCH_TOP_K_LIMIT = 5;
const STEAM_ADULT_AGE = { day: "1", month: "January", year: "1988" };

// note: robots.txt intentionally not honored — this is a fetch utility, not a crawler.
const USER_AGENTS = [
  // Googlebot first: many SPA sites pre-render for SEO.
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  // Desktop Chrome.
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // iOS Safari (mobile-light variants of paywalled/heavy sites).
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];

const DCINSIDE_USER_AGENTS = [
  "dcinside.app",
  "dcinside.app",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];

const REDDIT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  `perplexity-mcp/${VERSION} public Reddit JSON fallback`,
];

const CLEANING_MODES = ["strict", "balanced", "raw-ish"];
const SITE_PRESETS = ["auto", "none", "steam", "reddit", "dcinside", "namu", "mediawiki", "sage", "sourceforge", "youtube", "github", "news"];
const SOURCE_PROFILES = ["general", "community", "official", "academic", "reviews", "korean_forums", "news", "steam"];

const DOCUMENT_EXT_RE = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|csv|tsv)(?:[?#]|$)/i;
const DOCUMENT_CONTENT_RE = /(application\/pdf|application\/msword|application\/vnd\.openxmlformats|application\/vnd\.ms-|application\/octet-stream|text\/csv|text\/tab-separated-values)/i;

/** @type {Array<[string, string, string[], string[], string[]?]>} */
const NEWS_SOURCE_ROWS = [
  ["News1", "KR", ["ko"], ["news1.kr"], ["뉴스1"]],
  ["Newsis", "KR", ["ko"], ["newsis.com"], ["뉴시스"]],
  ["Yonhap News Agency", "KR", ["ko"], ["yna.co.kr"], ["Yonhap", "Yonhap News", "연합뉴스"]],
  ["Kyunghyang Shinmun", "KR", ["ko"], ["khan.co.kr"], ["Khan", "Kyunghyang", "경향신문"]],
  ["Kukmin Ilbo", "KR", ["ko"], ["kmib.co.kr"], ["국민일보"]],
  ["The Dong-A Ilbo", "KR", ["ko"], ["donga.com"], ["Dong-A Ilbo", "Donga", "동아일보"]],
  ["Munhwa Ilbo", "KR", ["ko"], ["munhwa.com"], ["문화일보"]],
  ["Seoul Shinmun", "KR", ["ko"], ["seoul.co.kr"], ["서울신문"]],
  ["Segye Ilbo", "KR", ["ko"], ["segye.com"], ["세계일보"]],
  ["Chosun Ilbo", "KR", ["ko"], ["chosun.com"], ["Chosun", "조선일보"]],
  ["JoongAng Ilbo", "KR", ["ko"], ["joongang.co.kr"], ["JoongAng", "중앙일보"]],
  ["The Hankyoreh", "KR", ["ko"], ["hani.co.kr"], ["Hankyoreh", "한겨레"]],
  ["Hankook Ilbo", "KR", ["ko"], ["hankookilbo.com"], ["한국일보"]],
  ["Money Today", "KR", ["ko"], ["mt.co.kr"], ["머니투데이"]],
  ["Maeil Business Newspaper", "KR", ["ko"], ["mk.co.kr"], ["Maeil Business", "매일경제"]],
  ["Seoul Economic Daily", "KR", ["ko"], ["sedaily.com"], ["Seoul Economy", "서울경제"]],
  ["Asia Economy", "KR", ["ko"], ["asiae.co.kr"], ["아시아경제"]],
  ["Edaily", "KR", ["ko"], ["edaily.co.kr"], ["이데일리"]],
  ["The Korea Economic Daily", "KR", ["ko"], ["hankyung.com"], ["Hankyung", "한국경제"]],
  ["Herald Economy", "KR", ["ko"], ["heraldcorp.com"], ["헤럴드경제"]],
  ["Sports Donga", "KR", ["ko"], ["sports.donga.com"], ["스포츠동아"]],
  ["Sports Seoul", "KR", ["ko"], ["sportsseoul.com"], ["스포츠서울"]],
  ["Sports Chosun", "KR", ["ko"], ["sports.chosun.com"], ["스포츠조선"]],
  ["Sports Kyunghyang", "KR", ["ko"], ["sports.khan.co.kr"], ["스포츠경향"]],
  ["Ilgan Sports", "KR", ["ko"], ["isplus.com"], ["일간스포츠"]],
  ["Kyeonggi Ilbo", "KR", ["ko"], ["kyeonggi.com"], ["경기일보"]],
  ["Kyeongin Ilbo", "KR", ["ko"], ["kyeongin.com"], ["경인일보"]],
  ["Gyeonggi Shinmun", "KR", ["ko"], ["kgnews.co.kr"], ["경기신문"]],
  ["Kiho Ilbo", "KR", ["ko"], ["kihoilbo.co.kr"], ["기호일보"]],
  ["Kangwon Ilbo", "KR", ["ko"], ["kwnews.co.kr"], ["강원일보"]],
  ["Kangwon Domin Ilbo", "KR", ["ko"], ["kado.net"], ["강원도민일보"]],
  ["Daejeon Ilbo", "KR", ["ko"], ["daejonilbo.com"], ["대전일보"]],
  ["Joongdo Ilbo", "KR", ["ko"], ["joongdo.co.kr"], ["중도일보"]],
  ["Chungcheong Today", "KR", ["ko"], ["cctoday.co.kr"], ["충청투데이"]],
  ["Jungbu Maeil", "KR", ["ko"], ["jbnews.com"], ["중부매일"]],
  ["Maeil Shinmun", "KR", ["ko"], ["imaeil.com"], ["매일신문"]],
  ["Yeongnam Ilbo", "KR", ["ko"], ["yeongnam.com"], ["영남일보"]],
  ["Kyongbuk Ilbo", "KR", ["ko"], ["kyongbuk.co.kr"], ["경북일보"]],
  ["Busan Ilbo", "KR", ["ko"], ["busan.com"], ["부산일보"]],
  ["Kookje Shinmun", "KR", ["ko"], ["kookje.co.kr"], ["국제신문"]],
  ["Gyeongsang Ilbo", "KR", ["ko"], ["ksilbo.co.kr"], ["경상일보"]],
  ["Ulsan Maeil", "KR", ["ko"], ["iusm.co.kr"], ["울산매일"]],
  ["Gyeongnam Shinmun", "KR", ["ko"], ["knnews.co.kr"], ["경남신문"]],
  ["Gyeongnam Domin Ilbo", "KR", ["ko"], ["idomin.com"], ["경남도민일보"]],
  ["Kwangju Ilbo", "KR", ["ko"], ["kwangju.co.kr"], ["광주일보"]],
  ["Jeonnam Ilbo", "KR", ["ko"], ["jnilbo.com"], ["전남일보"]],
  ["Jeonbuk Ilbo", "KR", ["ko"], ["jjan.kr"], ["전북일보"]],
  ["Jeonbuk Domin Ilbo", "KR", ["ko"], ["domin.co.kr"], ["전북도민일보"]],
  ["Jeju Ilbo", "KR", ["ko"], ["jejunews.com"], ["제주일보"]],
  ["Halla Ilbo", "KR", ["ko"], ["ihalla.com"], ["한라일보"]],
  ["KBS", "KR", ["ko"], ["kbs.co.kr"], ["KBS News", "한국방송공사"]],
  ["MBC", "KR", ["ko"], ["imbc.com", "mbc.co.kr"], ["MBC News", "문화방송"]],
  ["SBS", "KR", ["ko"], ["sbs.co.kr"], ["SBS News"]],
  ["EBS", "KR", ["ko"], ["ebs.co.kr"], []],
  ["JTBC", "KR", ["ko"], ["jtbc.co.kr"], []],
  ["MBN", "KR", ["ko"], ["mbn.co.kr"], []],
  ["TV Chosun", "KR", ["ko"], ["tvchosun.com"], ["TV조선"]],
  ["Channel A", "KR", ["ko"], ["ichannela.com"], ["채널A"]],
  ["YTN", "KR", ["ko"], ["ytn.co.kr"], []],
  ["Yonhap News TV", "KR", ["ko"], ["yonhapnewstv.co.kr"], ["연합뉴스TV"]],
  ["KNN", "KR", ["ko"], ["knn.co.kr"], []],
  ["TBC", "KR", ["ko"], ["tbc.co.kr"], []],
  ["KBC", "KR", ["ko"], ["ikbc.co.kr"], []],
  ["TJB", "KR", ["ko"], ["tjb.co.kr"], []],
  ["UBC", "KR", ["ko"], ["ubc.co.kr"], []],
  ["JTV", "KR", ["ko"], ["jtv.co.kr"], []],
  ["CJB", "KR", ["ko"], ["cjb.co.kr"], []],
  ["G1", "KR", ["ko"], ["g1tv.co.kr"], ["G1 TV"]],
  ["JIBS", "KR", ["ko"], ["jibs.co.kr"], []],
  ["Gyeongin Broadcasting", "KR", ["ko"], ["ifm.kr"], ["경인방송"]],
  ["OBS", "KR", ["ko"], ["obsnews.co.kr"], ["OBS Gyeongin TV", "OBS경인TV"]],
  ["Financial Times", "GB", ["en"], ["ft.com"], ["FT.com", "파이낸셜 타임즈"]],
  ["The Times", "GB", ["en"], ["thetimes.com", "times.co.uk"], ["더 타임즈"]],
  ["The Guardian", "GB", ["en"], ["theguardian.com"], ["Guardian", "더 가디언"]],
  ["BBC", "GB", ["en"], ["bbc.com", "bbc.co.uk"], ["BBC News"]],
  ["The Independent", "GB", ["en"], ["independent.co.uk"], ["Independent"]],
  ["Reuters", "GB", ["en"], ["reuters.com"], ["로이터"]],
  ["The Telegraph", "GB", ["en"], ["telegraph.co.uk"], ["Daily Telegraph"]],
  ["The Economist", "GB", ["en"], ["economist.com"], []],
  ["ITV", "GB", ["en"], ["itv.com"], ["ITV News"]],
  ["Channel 4", "GB", ["en"], ["channel4.com"], ["Channel 4 News"]],
  ["Channel 5", "GB", ["en"], ["channel5.com"], []],
  ["Sky News", "GB", ["en"], ["sky.com"], []],
  ["Wired", "GB", ["en"], ["wired.com"], []],
  ["The New York Times", "US", ["en"], ["nytimes.com"], ["New York Times", "NYTimes", "NYT", "뉴욕 타임즈"]],
  ["The Wall Street Journal", "US", ["en"], ["wsj.com"], ["Wall Street Journal", "WSJ", "월스트리트 저널"]],
  ["The Washington Post", "US", ["en"], ["washingtonpost.com"], ["Washington Post", "WaPo", "워싱턴 포스트"]],
  ["Time", "US", ["en"], ["time.com"], ["Time Magazine", "Time.com"]],
  ["CNN", "US", ["en"], ["cnn.com"], []],
  ["Associated Press", "US", ["en"], ["apnews.com"], ["AP News", "AP"]],
  ["The Atlantic", "US", ["en"], ["theatlantic.com"], []],
  ["Bloomberg", "US", ["en"], ["bloomberg.com"], []],
  ["Forbes", "US", ["en"], ["forbes.com"], []],
  ["ABC News", "US", ["en"], ["abcnews.go.com"], []],
  ["CBS News", "US", ["en"], ["cbsnews.com"], []],
  ["PBS", "US", ["en"], ["pbs.org"], ["PBS NewsHour"]],
  ["NBC News", "US", ["en"], ["nbcnews.com"], []],
  ["MSNBC", "US", ["en"], ["msnbc.com"], []],
  ["NPR", "US", ["en"], ["npr.org"], []],
  ["CNBC", "US", ["en"], ["cnbc.com"], []],
  ["The New Yorker", "US", ["en"], ["newyorker.com"], []],
  ["Politico", "US", ["en"], ["politico.com"], []],
  ["The Hill", "US", ["en"], ["thehill.com"], []],
  ["Fox News", "US", ["en"], ["foxnews.com"], []],
  ["The Globe and Mail", "CA", ["en"], ["theglobeandmail.com"], []],
  ["CBC", "CA", ["en"], ["cbc.ca"], ["CBC News"]],
  ["Neue Zurcher Zeitung", "CH", ["de"], ["nzz.ch"], ["NZZ", "노이에 취르허 차이퉁"]],
  ["Le Monde", "FR", ["fr"], ["lemonde.fr"], ["르몽드"]],
  ["AFP", "FR", ["fr"], ["afp.com"], ["Agence France-Presse"]],
  ["Le Figaro", "FR", ["fr"], ["lefigaro.fr"], []],
  ["France 24", "FR", ["fr", "en"], ["france24.com"], []],
  ["Liberation", "FR", ["fr"], ["liberation.fr"], ["Libération"]],
  ["Deutsche Welle", "DE", ["de", "en"], ["dw.com"], ["DW"]],
  ["ZDF", "DE", ["de"], ["zdf.de"], []],
  ["ARD", "DE", ["de"], ["ard.de", "tagesschau.de"], ["Tagesschau"]],
  ["Frankfurter Allgemeine Zeitung", "DE", ["de"], ["faz.net"], ["FAZ", "Frankfurter Allgemeine"]],
  ["Der Spiegel", "DE", ["de"], ["spiegel.de"], ["Spiegel"]],
  ["Die Zeit", "DE", ["de"], ["zeit.de"], []],
  ["El Pais", "ES", ["es"], ["elpais.com"], ["El País"]],
  ["El Mundo", "ES", ["es"], ["elmundo.es"], []],
  ["Al Jazeera", "QA", ["en", "ar"], ["aljazeera.com"], ["알 자지라"]],
  ["Haaretz", "IL", ["en", "he"], ["haaretz.com"], []],
  ["The Jerusalem Post", "IL", ["en"], ["jpost.com"], ["Jerusalem Post"]],
  ["Kyodo News", "JP", ["ja", "en"], ["kyodonews.net", "kyodo.co.jp"], ["교도통신"]],
  ["NHK", "JP", ["ja"], ["nhk.or.jp"], []],
  ["Yomiuri Shimbun", "JP", ["ja"], ["yomiuri.co.jp"], ["Yomiuri", "요미우리"]],
  ["Asahi Shimbun", "JP", ["ja"], ["asahi.com"], ["Asahi", "아사히"]],
  ["Mainichi Shimbun", "JP", ["ja"], ["mainichi.jp"], ["Mainichi", "마이니치"]],
  ["Nikkei", "JP", ["ja"], ["nikkei.com"], ["니혼게이자이"]],
  ["Nippon TV", "JP", ["ja"], ["ntv.co.jp"], ["닛폰 테레비"]],
  ["TV Asahi", "JP", ["ja"], ["tv-asahi.co.jp"], ["테레비 아사히"]],
  ["TBS", "JP", ["ja"], ["tbs.co.jp"], ["TBS TV"]],
  ["TV Tokyo", "JP", ["ja"], ["tv-tokyo.co.jp"], ["테레비 도쿄"]],
  ["Fuji TV", "JP", ["ja"], ["fujitv.co.jp"], ["후지 테레비"]],
  ["South China Morning Post", "HK", ["en"], ["scmp.com"], ["SCMP"]],
  ["The Straits Times", "SG", ["en"], ["straitstimes.com"], ["Straits Times"]],
  ["CNA", "SG", ["en"], ["channelnewsasia.com"], ["Channel NewsAsia"]],
  ["ABC Australia", "AU", ["en"], ["abc.net.au"], ["Australian Broadcasting Corporation"]],
  ["SBS Australia", "AU", ["en"], ["sbs.com.au"], []],
  ["The Times of India", "IN", ["en"], ["timesofindia.indiatimes.com", "indiatimes.com"], ["Times of India"]],
];

const NEWS_AUTO_ALIAS_DENYLIST = new Set(["time"]);

const NEWS_SOURCES = NEWS_SOURCE_ROWS.map(([site, country, languages, domains, aliases = []]) => ({
  site,
  country,
  languages,
  domains,
  aliases: [...new Set([site, ...aliases, ...domains])].filter((alias) => !NEWS_AUTO_ALIAS_DENYLIST.has(String(alias).toLowerCase())),
}));

const NEWS_DOMAINS = [...new Set(NEWS_SOURCES.flatMap((source) => source.domains))];
// Sites that render MediaWiki markup, so #mw-content-text / .mw-parser-output
// extraction applies. Matching is suffix-based, which covers every language
// subdomain (en.wikipedia.org, ko.wikipedia.org, …) from one entry.
// A miss is cheap: extractMediaWikiArticleData returns null when the expected
// containers are absent and the page falls back to generic extraction.
const MEDIAWIKI_DOMAINS = [
  "k-wiki.kr",
  // Wikimedia family
  "wikipedia.org",
  "wikimedia.org",
  "wiktionary.org",
  "wikiquote.org",
  "wikibooks.org",
  "wikisource.org",
  "wikinews.org",
  "wikiversity.org",
  "wikivoyage.org",
  "wikidata.org",
  // Large MediaWiki hosts
  "fandom.com",
  "miraheze.org",
  "wiki.gg",
  "gamepedia.com",
  // Korean MediaWiki wikis
  "librewiki.net",
  "lunawiki.kr",
];
const SAGE_DOMAINS = ["journals.sagepub.com"];
const SOURCEFORGE_DOMAINS = ["sourceforge.net"];

const NEWS_PROFILE_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "nytimes.com",
  "wsj.com",
  "washingtonpost.com",
  "bloomberg.com",
  "cnn.com",
  "theguardian.com",
  "ft.com",
  "yna.co.kr",
  "newsis.com",
  "news1.kr",
  "khan.co.kr",
  "chosun.com",
  "joongang.co.kr",
  "hani.co.kr",
  "hankyung.com",
  "mk.co.kr",
  "ytn.co.kr",
];

const SEARCH_PROFILE_DEFAULTS = {
  community: {
    search_domain_filter: ["reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "news.ycombinator.com", "youtube.com"],
    note: "community profile: forum/Q&A/social domains",
  },
  official: {
    search_domain_filter: ["-reddit.com", "-quora.com", "-medium.com", "-substack.com", "-youtube.com"],
    note: "official profile: excludes common user-generated domains",
  },
  academic: {
    search_domain_filter: ["arxiv.org", "nih.gov", "nature.com", "science.org", "springer.com", "ieee.org", ".edu"],
    note: "academic profile: papers, journals, .edu, and research institutions",
  },
  reviews: {
    search_domain_filter: ["steamcommunity.com", "store.steampowered.com", "metacritic.com", "opencritic.com", "youtube.com", "reddit.com"],
    note: "reviews profile: stores, review aggregators, video/community reviews",
  },
  korean_forums: {
    country: "KR",
    search_language_filter: ["ko"],
    search_domain_filter: ["dcinside.com", "fmkorea.com", "ruliweb.com", "theqoo.net", "clien.net", "ppomppu.co.kr", "arca.live", "inven.co.kr"],
    note: "korean_forums profile: Korean community domains",
  },
  news: {
    search_domain_filter: NEWS_PROFILE_DOMAINS,
    note: "news profile: mainstream news domains",
  },
  steam: {
    search_domain_filter: ["store.steampowered.com", "steamcommunity.com"],
    note: "steam profile: Steam Store and Steam Community",
  },
};

const AUTO_SEARCH_SOURCE_PRESETS = [
  {
    name: "reddit",
    domains: ["reddit.com"],
    terms: [/\breddit\b/i, /레딧/i, /\br\/[A-Za-z0-9_]+\b/i],
    note: "auto source preset: Reddit",
  },
  {
    name: "dcinside",
    domains: ["dcinside.com"],
    languages: ["ko"],
    country: "KR",
    terms: [/\bdcinside\b/i, /디시(?:인사이드)?/i, /마이너\s*갤러리/i],
    note: "auto source preset: DCinside",
  },
  {
    name: "namu",
    domains: ["namu.wiki"],
    languages: ["ko"],
    country: "KR",
    terms: [/\bnamu(?:\s*wiki)?\b/i, /나무위키/i],
    note: "auto source preset: NamuWiki",
  },
  {
    name: "steam",
    domains: ["store.steampowered.com", "steamcommunity.com"],
    terms: [/\bsteam\b/i, /스팀/i, /steampowered/i, /steamcommunity/i],
    note: "auto source preset: Steam",
  },
  {
    name: "youtube",
    domains: ["youtube.com", "youtu.be"],
    terms: [/\byoutube\b/i, /youtu\.be/i, /유튜브/i],
    note: "auto source preset: YouTube",
  },
  {
    name: "github",
    domains: ["github.com"],
    terms: [/\bgithub\b/i, /깃허브/i],
    note: "auto source preset: GitHub",
  },
];

// ── Text cleanup ────────────────────────────────────────────────────

const HTML_ENTITIES = [
  [/&nbsp;|&#160;/g, " "],
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;|&apos;/g, "'"],
];

const BASE_STRUCTURAL_PATTERNS = [
  [/<script[\s\S]*?<\/script>/gi, ""],
  [/<style[\s\S]*?<\/style>/gi, ""],
  [/<!--[\s\S]*?-->/g, ""],
];

const BALANCED_STRUCTURAL_PATTERNS = [
  ...BASE_STRUCTURAL_PATTERNS,
  [/<noscript[\s\S]*?<\/noscript>/gi, ""],
  [/<iframe[\s\S]*?<\/iframe>/gi, ""],
  [/<svg[\s\S]*?<\/svg>/gi, ""],
  [/<canvas[\s\S]*?<\/canvas>/gi, ""],
  [/<form[\s\S]*?<\/form>/gi, ""],
  [/<button[\s\S]*?<\/button>/gi, ""],
  [/<select[\s\S]*?<\/select>/gi, ""],
  [/<textarea[\s\S]*?<\/textarea>/gi, ""],
  [/<input\b[^>]*>/gi, ""],
  [/<label[\s\S]*?<\/label>/gi, ""],
  [/<(nav|footer|aside|header)[\s\S]*?<\/\1>/gi, ""],
];

const STRICT_STRUCTURAL_PATTERNS = [
  ...BALANCED_STRUCTURAL_PATTERNS,
  [/<dialog[\s\S]*?<\/dialog>/gi, ""],
  [/<menu[\s\S]*?<\/menu>/gi, ""],
];

// Sentence-bounded so a single literal "cookie" mention in body doesn't nuke a paragraph.
const JUNK_PATTERNS = [
  [/(we use cookies|cookie policy|accept (all )?cookies|쿠키 (사용|정책|동의))[^.\n]{0,200}\.?/gi, ""],
  [/(subscribe to (our )?newsletter|sign up for[^.\n]{0,80}newsletter|뉴스레터 (구독|신청))[^.\n]{0,200}\.?/gi, ""],
  [/(skip to (main )?content|jump to (content|navigation|search)|메인 콘텐츠로 건너뛰기|toggle the table of contents)/gi, ""],
  [/(share on (facebook|twitter|x|kakao)|공유하기)/gi, ""],
  [/(loading\.\.\.|로딩 중\.\.\.)/gi, ""],
  [/^\s*(홈|메인|home)\s*[>›»][^\n]{1,80}$/gim, ""],
];

const UI_LINE_PATTERNS = [
  /^(accept|accept all|agree|allow|continue|continue reading|dismiss|got it|i agree|load more|log in|login|menu|next|ok|previous|read more|reject|save|search|share|show more|sign in|subscribe)$/i,
  /^(계속|검색|공유|구독|닫기|더보기|동의|모두 동의|메뉴|로그인|수락|신청|아니요|예|이전|저장|취소|확인)$/i,
];

function isLikelyUiLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 40) return false;
  return UI_LINE_PATTERNS.some((re) => re.test(trimmed));
}

function decodeEntities(s) {
  let out = s;
  for (const [re, rep] of HTML_ENTITIES) out = out.replace(re, rep);
  // Numeric entities: &#160; / &#x00A0;
  out = out.replace(/&#(\d+);/g, (_, code) => {
    try { return String.fromCodePoint(parseInt(code, 10)); } catch { return " "; }
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
    try { return String.fromCodePoint(parseInt(code, 16)); } catch { return " "; }
  });
  return out;
}

function normalizeCleaningMode(mode) {
  return CLEANING_MODES.includes(mode) ? mode : "balanced";
}

function structuralPatternsForMode(mode) {
  const normalized = normalizeCleaningMode(mode);
  if (normalized === "raw-ish") return BASE_STRUCTURAL_PATTERNS;
  if (normalized === "strict") return STRICT_STRUCTURAL_PATTERNS;
  return BALANCED_STRUCTURAL_PATTERNS;
}

function cleanText(s, mode = "balanced") {
  if (!s) return "";
  let out = s;
  const normalized = normalizeCleaningMode(mode);
  if (normalized !== "raw-ish") {
    for (const [re, rep] of JUNK_PATTERNS) out = out.replace(re, rep);
  }
  if (normalized === "strict" || normalized === "balanced") {
    out = out
      .split("\n")
      .filter((line) => !isLikelyUiLine(line))
      .join("\n");
  }
  // Collapse whitespace-only lines and tab/space runs.
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n[ \t]+/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function normalizeLinkHref(href, baseUrl = "") {
  const raw = decodeEntities(String(href || "")).trim();
  if (!raw || /^(?:javascript|data|blob):/i.test(raw)) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (!baseUrl) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function markdownLinkText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim();
}

function markdownLinkUrl(url) {
  return String(url || "").replace(/</g, "%3C").replace(/>/g, "%3E").trim();
}

function markdownLink(label, url) {
  const safeUrl = markdownLinkUrl(url);
  const safeLabel = markdownLinkText(label) || safeUrl;
  return safeUrl ? `[${safeLabel}](<${safeUrl}>)` : safeLabel;
}

function htmlLinksToMarkdown(html, { include_links = false, base_url = "" } = {}) {
  return String(html || "").replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (all, rawAttrs, inner) => {
    const label = fragmentToText(inner);
    if (!include_links) return ` ${label || inner} `;
    const href = normalizeLinkHref(parseAttributes(rawAttrs).href, base_url);
    if (!href) return ` ${label || inner} `;
    return ` ${markdownLink(label || href, href)} `;
  });
}

function stripMarkdownLinks(text) {
  return String(text || "")
    .replace(/!?\[([^\]\n]{0,400})\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>/gi, "$1");
}

function cleanMarkdownText(markdown, mode = "balanced", opts = {}) {
  let out = String(markdown || "").replace(/\r\n?/g, "\n");
  out = htmlLinksToMarkdown(out, opts);
  if (opts.include_links === false) out = stripMarkdownLinks(out);
  return cleanText(out, mode);
}

function extractLinksFromMarkdown(text, baseUrl = "", limit = 80) {
  const links = [];
  const seen = new Set();
  const add = (label, href) => {
    const url = normalizeLinkHref(href, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ text: markdownLinkText(label) || url, url });
  };

  for (const match of String(text || "").matchAll(/(^|[^!])\[([^\]\n]{1,400})\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    add(match[2], match[3]);
    if (links.length >= limit) return links;
  }
  for (const match of String(text || "").matchAll(/<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>/gi)) {
    add(match[1], match[1]);
    if (links.length >= limit) return links;
  }
  for (const match of String(text || "").matchAll(/\bhttps?:\/\/[^\s<>()\]]+/gi)) {
    add(match[0], match[0].replace(/[.,;:!?]+$/g, ""));
    if (links.length >= limit) return links;
  }
  return links;
}

function htmlToText(html, mode = "balanced", opts = {}) {
  let out = html;
  for (const [re, rep] of structuralPatternsForMode(mode)) out = out.replace(re, rep);
  out = htmlLinksToMarkdown(out, opts);
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/(p|div|li|h[1-6]|tr|article|section)>/gi, "\n");
  // htmlLinksToMarkdown emits `[label](<url>)`; the angle brackets keep URLs
  // containing spaces or parens valid in Markdown, but they also look like tags.
  // Skip anything whose first token is a URL scheme so tag stripping does not
  // swallow the href and leave `[label]( )` behind.
  out = out.replace(/<(?!(?:https?|mailto|tel|ftp):)[^>]+>/g, " ");
  out = decodeEntities(out);
  return cleanText(out, mode);
}

// ── Metadata extraction (SPA fallback) ──────────────────────────────

function tagAttribute(tag, attrName) {
  const re = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, "i");
  const match = tag.match(re);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim() : "";
}

function findMetaContent(html, keys) {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = (tagAttribute(tag, "name") || tagAttribute(tag, "property") || tagAttribute(tag, "itemprop")).toLowerCase();
    if (keySet.has(name)) return tagAttribute(tag, "content");
  }
  return "";
}

function findMetaContents(html, keys) {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const values = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = (tagAttribute(tag, "name") || tagAttribute(tag, "property") || tagAttribute(tag, "itemprop")).toLowerCase();
    if (!keySet.has(name)) continue;
    const content = tagAttribute(tag, "content");
    if (content) values.push(content);
  }
  return [...new Set(values)];
}

function findLinkHref(html, rel) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const relValue = tagAttribute(tag, "rel").toLowerCase();
    if (relValue.split(/\s+/).includes(rel.toLowerCase())) return tagAttribute(tag, "href");
  }
  return "";
}

function extractMetadata(html) {
  const meta = {
    title: "",
    description: "",
    jsonLd: "",
    noscript: "",
    canonical: "",
    author: "",
    published: "",
    modified: "",
    siteName: "",
    type: "",
  };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim();

  if (!meta.title) meta.title = findMetaContent(html, ["og:title", "twitter:title"]);
  meta.description = findMetaContent(html, ["og:description", "twitter:description", "description"]);
  meta.canonical = findLinkHref(html, "canonical");
  meta.author = findMetaContent(html, ["author", "article:author"]);
  meta.published = findMetaContent(html, ["article:published_time", "datePublished", "date", "pubdate", "publishdate"]);
  meta.modified = findMetaContent(html, ["article:modified_time", "dateModified", "lastmod", "last-modified"]);
  meta.siteName = findMetaContent(html, ["og:site_name", "application-name"]);
  meta.type = findMetaContent(html, ["og:type"]);

  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (jsonLdMatches.length) {
    const parts = [];
    for (const m of jsonLdMatches) {
      try {
        const parsed = JSON.parse(m[1].trim());
        const pickText = (v) => {
          if (typeof v === "string") return v;
          if (Array.isArray(v)) return v.map(pickText).filter(Boolean).join(" ");
          if (v && typeof v === "object") {
            if (!meta.author && typeof v.author === "object" && typeof v.author.name === "string") meta.author = v.author.name;
            if (!meta.published && typeof v.datePublished === "string") meta.published = v.datePublished;
            if (!meta.modified && typeof v.dateModified === "string") meta.modified = v.dateModified;
            if (!meta.type && typeof v["@type"] === "string") meta.type = v["@type"];
            return ["headline", "name", "description", "articleBody", "text"]
              .map((k) => v[k]).filter((x) => typeof x === "string").join(" ");
          }
          return "";
        };
        const text = pickText(parsed);
        if (text) parts.push(text);
      } catch { /* skip malformed */ }
    }
    meta.jsonLd = parts.join("\n").trim();
  }

  const noscriptMatches = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)];
  if (noscriptMatches.length) {
    meta.noscript = noscriptMatches.map((m) => htmlToText(m[1])).join("\n").trim();
  }

  return meta;
}

// ── Direct fetch with UA rotation + JS bypass ───────────────────────

const HARD_CHALLENGE_RE = /(g-recaptcha|hcaptcha|cf-turnstile|data-sitekey|arkoselabs|funcaptcha|solve captcha|enter the characters|press and hold)/i;
const SIMPLE_CHALLENGE_RE = /\b(continue|verify|proceed|start|confirm|submit|unlock|i am human|i'm human|not a robot)\b|(?:계속|확인|입장|인증|검증|제출|시작|로봇이 아닙니다|사람입니다)/i;

function parseAttributes(raw) {
  const attrs = {};
  const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRe.exec(raw || ""))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeEntities(value).trim();
  }
  return attrs;
}

function fragmentToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie();
    if (Array.isArray(values) && values.length) return values;
  }
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=)/g) : [];
}

function storeResponseCookies(cookieJar, headers) {
  if (!cookieJar) return;
  for (const setCookie of getSetCookieHeaders(headers)) {
    const pair = setCookie.split(";")[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (/;\s*max-age=0(?:\D|$)/i.test(setCookie) || /;\s*expires=thu,\s*01 jan 1970/i.test(setCookie)) {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
}

function cookieHeader(cookieJar) {
  if (!cookieJar || cookieJar.size === 0) return "";
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

// Header sets a real browser sends alongside a navigation request. Several
// Cloudflare-fronted sites (namu.wiki among them) answer 403 to a request that
// carries only a browser User-Agent but none of the fetch-metadata or client
// hints that browser would also send — the mismatch is the signal, not the UA.
//
// The hints have to agree with the UA: Googlebot and app UAs send neither
// Sec-Fetch-* nor sec-ch-ua, and Safari sends Sec-Fetch-* but no client hints.
// Claiming Chrome hints under a Googlebot UA is a worse tell than sending none.
const NAVIGATION_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";

// Fetch metadata differs per request kind; sending navigation metadata on an
// XHR is itself a mismatch, so each call site declares what it is doing.
const SEC_FETCH_BY_KIND = {
  navigate: {
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  },
  form: {
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  },
  xhr: {
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  },
};

const CHROME_CLIENT_HINTS = {
  "sec-ch-ua": '"Chromium";v="120", "Google Chrome";v="120", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

function browserRequestHeaders(ua, kind) {
  const agent = String(ua || "");
  // Crawlers and in-app clients send neither fetch metadata nor client hints.
  if (/googlebot|bingbot|bot\/|dcinside\.app|perplexity-mcp/i.test(agent)) return {};
  const secFetch = SEC_FETCH_BY_KIND[kind] || SEC_FETCH_BY_KIND.navigate;
  // Client hints are Chromium-only; Safari sends fetch metadata but no hints.
  if (/\bChrome\/\d+/.test(agent) && !/\bMobile\b/.test(agent)) {
    return { ...secFetch, ...CHROME_CLIENT_HINTS };
  }
  return { ...secFetch };
}

/** @param {"navigate"|"form"|"xhr"} [kind] */
function fetchHeaders(ua, cookieJar, extra = {}, kind = "navigate") {
  /** @type {Record<string, string>} */
  const headers = {
    "User-Agent": ua,
    Accept: NAVIGATION_ACCEPT,
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    ...browserRequestHeaders(ua, kind),
    ...extra,
  };
  const cookies = cookieHeader(cookieJar);
  if (cookies) headers.Cookie = cookies;
  return headers;
}

function charsetFromContentType(contentType) {
  const match = String(contentType || "").match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  const raw = (match?.[1] || "utf-8").toLowerCase();
  if (raw === "ks_c_5601-1987" || raw === "x-windows-949" || raw === "cp949") return "euc-kr";
  return raw;
}

async function readTextResponse(res, contentType) {
  const buffer = await res.arrayBuffer();
  const charset = charsetFromContentType(contentType);
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function isSteamStoreUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "store.steampowered.com" || hostname.endsWith(".store.steampowered.com");
  } catch {
    return false;
  }
}

function seedSteamAdultCookies(cookieJar) {
  cookieJar.set("birthtime", "568022401");
  cookieJar.set("lastagecheckage", `${STEAM_ADULT_AGE.day}-${STEAM_ADULT_AGE.month}-${STEAM_ADULT_AGE.year}`);
  cookieJar.set("wants_mature_content", "1");
  cookieJar.set("mature_content", "1");
}

function looksSteamAgeGate(pageUrl, body) {
  if (!isSteamStoreUrl(pageUrl)) return false;
  const lower = body.slice(0, 120_000).toLowerCase();
  return (
    new URL(pageUrl).pathname.includes("/agecheck") ||
    lower.includes("agecheck_form") ||
    lower.includes("please enter your birth date") ||
    lower.includes("enter your birth date to continue") ||
    lower.includes("age gate")
  );
}

function buildSimpleChallengeSubmission(pageUrl, html) {
  const scanHtml = html.slice(0, SIMPLE_CHALLENGE_BODY_SCAN_LIMIT);
  if (HARD_CHALLENGE_RE.test(scanHtml)) return null;

  const page = new URL(pageUrl);
  const formMatches = [...scanHtml.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0, 5);
  for (const match of formMatches) {
    const formAttrs = parseAttributes(match[1]);
    const formHtml = match[2];
    if (/<input\b[^>]*type=["']?(password|file)["']?/i.test(formHtml)) continue;

    const buttonLabels = [
      ...[...formHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map((m) => fragmentToText(m[2])),
      ...[...formHtml.matchAll(/<input\b([^>]*)>/gi)]
        .map((m) => parseAttributes(m[1]))
        .filter((attrs) => ["submit", "button", "image"].includes((attrs.type || "text").toLowerCase()))
        .map((attrs) => attrs.value || attrs["aria-label"] || attrs.name || ""),
    ].filter(Boolean);

    const intentText = [fragmentToText(formHtml), ...buttonLabels].join(" ");
    const searchLikeText = intentText.toLowerCase();
    if (/\b(search this journal|search all journals|enter search terms|advanced search)\b/.test(searchLikeText)) continue;
    if (/\bsearch\b/.test(searchLikeText) && !/\b(continue|verify|proceed|confirm|unlock|human|robot)\b/.test(searchLikeText)) continue;
    if (!SIMPLE_CHALLENGE_RE.test(intentText)) continue;

    const method = (formAttrs.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") continue;

    let target;
    try {
      target = new URL(formAttrs.action || pageUrl, pageUrl);
    } catch {
      continue;
    }
    if (target.origin !== page.origin) continue;

    const params = new URLSearchParams();
    let submitAdded = false;

    for (const inputMatch of formHtml.matchAll(/<input\b([^>]*)>/gi)) {
      const attrs = parseAttributes(inputMatch[1]);
      const type = (attrs.type || "text").toLowerCase();
      const name = attrs.name;
      if (!name) continue;
      if (["button", "file", "image", "password", "reset"].includes(type)) continue;
      if (["checkbox", "radio"].includes(type) && !("checked" in attrs)) continue;
      if (type === "submit") {
        if (!submitAdded) {
          params.append(name, attrs.value || buttonLabels[0] || "submit");
          submitAdded = true;
        }
        continue;
      }
      params.append(name, attrs.value || "");
    }

    for (const buttonMatch of formHtml.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      if (submitAdded) break;
      const attrs = parseAttributes(buttonMatch[1]);
      const type = (attrs.type || "submit").toLowerCase();
      if (type !== "submit" || !attrs.name) continue;
      params.append(attrs.name, attrs.value || fragmentToText(buttonMatch[2]) || "submit");
      submitAdded = true;
    }

    return {
      method,
      target,
      params,
      label: buttonLabels.find((label) => SIMPLE_CHALLENGE_RE.test(label)) || buttonLabels[0] || "submit",
    };
  }

  return null;
}

function buildSteamAgeSubmission(pageUrl, html) {
  const scanHtml = html.slice(0, SIMPLE_CHALLENGE_BODY_SCAN_LIMIT);
  const page = new URL(pageUrl);
  const formMatches = [...scanHtml.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0, 6);
  const formMatch = formMatches.find((match) => {
    const attrs = parseAttributes(match[1]);
    const text = `${attrs.id || ""} ${attrs.name || ""} ${attrs.action || ""} ${match[2]}`;
    return /agecheck|agegate|ageYear|ageMonth|birth/i.test(text);
  });
  const formAttrs = formMatch ? parseAttributes(formMatch[1]) : {};
  const formHtml = formMatch ? formMatch[2] : "";

  let target;
  try {
    target = new URL(formAttrs.action || pageUrl, pageUrl);
  } catch {
    target = page;
  }
  if (!isSteamStoreUrl(target.toString())) return null;

  const method = (formAttrs.method || "POST").toUpperCase();
  const params = new URLSearchParams();

  for (const inputMatch of formHtml.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = parseAttributes(inputMatch[1]);
    const type = (attrs.type || "text").toLowerCase();
    if (!attrs.name || ["button", "file", "image", "password", "reset"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type) && !("checked" in attrs)) continue;
    params.append(attrs.name, attrs.value || "");
  }

  for (const selectMatch of formHtml.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = parseAttributes(selectMatch[1]);
    if (!attrs.name || params.has(attrs.name)) continue;
    const selected = selectMatch[2].match(/<option\b(?=[^>]*\bselected\b)([^>]*)>/i)
      || selectMatch[2].match(/<option\b([^>]*)>/i);
    const optionAttrs = selected ? parseAttributes(selected[1]) : {};
    params.append(attrs.name, optionAttrs.value || fragmentToText(selected?.[0] || ""));
  }

  params.set("ageDay", STEAM_ADULT_AGE.day);
  params.set("ageMonth", STEAM_ADULT_AGE.month);
  params.set("ageYear", STEAM_ADULT_AGE.year);

  return {
    method: method === "GET" ? "GET" : "POST",
    target,
    params,
    label: `Steam age gate ${STEAM_ADULT_AGE.year}-${STEAM_ADULT_AGE.month}-${STEAM_ADULT_AGE.day}`,
  };
}

async function submitSteamAgeCheck(originalUrl, pageUrl, html, ua, signal, cookieJar) {
  seedSteamAdultCookies(cookieJar);
  const submission = buildSteamAgeSubmission(pageUrl, html);
  if (!submission) return null;

  const headers = fetchHeaders(ua, cookieJar, {
    Referer: pageUrl,
    Origin: new URL(pageUrl).origin,
  }, "form");
  let requestUrl = submission.target.toString();
  const init = {
    method: submission.method,
    headers,
    redirect: "follow",
    signal,
  };

  if (submission.method === "GET") {
    const target = new URL(requestUrl);
    for (const [name, value] of submission.params) target.searchParams.set(name, value);
    requestUrl = target.toString();
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = submission.params.toString();
  }

  const res = await fetch(requestUrl, init);
  storeResponseCookies(cookieJar, res.headers);
  let body = "";
  try { body = await res.text(); } catch { /* ignore */ }
  let result = { status: res.status, body, finalUrl: res.url || requestUrl, label: submission.label };

  if (looksSteamAgeGate(result.finalUrl, result.body)) {
    const retry = await fetchOnce(originalUrl, ua, signal, cookieJar, "steam");
    result = { ...retry, label: `${submission.label}; retried original URL` };
  }

  return result;
}

async function submitSimpleChallenge(pageUrl, html, ua, signal, cookieJar) {
  const submission = buildSimpleChallengeSubmission(pageUrl, html);
  if (!submission) return null;

  const extraHeaders = { Referer: pageUrl };
  if (submission.method === "POST") extraHeaders.Origin = new URL(pageUrl).origin;
  const headers = fetchHeaders(ua, cookieJar, extraHeaders, "form");
  let requestUrl = submission.target.toString();
  const init = {
    method: submission.method,
    headers,
    redirect: "follow",
    signal,
  };

  if (submission.method === "GET") {
    const target = new URL(requestUrl);
    for (const [name, value] of submission.params) target.searchParams.append(name, value);
    requestUrl = target.toString();
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = submission.params.toString();
  }

  const res = await fetch(requestUrl, init);
  storeResponseCookies(cookieJar, res.headers);
  let body = "";
  try { body = await res.text(); } catch { /* ignore */ }
  return { status: res.status, body, finalUrl: res.url || requestUrl, label: submission.label };
}

async function fetchOnce(url, ua, signal, cookieJar, sitePreset = "auto") {
  const res = await fetch(url, {
    method: "GET",
    headers: fetchHeaders(ua, cookieJar, sitePresetHeaders(sitePreset)),
    redirect: "follow",
    signal,
  });
  storeResponseCookies(cookieJar, res.headers);
  const status = res.status;
  const finalUrl = res.url || url;
  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length") || "";
  let body = "";
  if (isTextualResponse(finalUrl, contentType)) {
    try { body = await readTextResponse(res, contentType); } catch { /* ignore */ }
  } else {
    try { await res.body?.cancel?.(); } catch { /* ignore */ }
  }
  return { status, body, finalUrl, contentType, contentLength };
}

function looksBlocked(status, body, pageUrl = "") {
  if (status === 403 || status === 503 || status === 429) return true;
  if (isDcinsideAuthOrSinkUrl(pageUrl)) return true;
  // Common challenge/verification page markers (HTTP 200 with bot-block content).
  //
  // Scan rendered markup only. Inline config blobs name captcha providers as
  // ordinary settings — Wikipedia ships
  // "wgConfirmEditCaptchaNeededForGenericEdit":"hcaptcha" in its <head> — and
  // matching those threw away a perfectly good page, then paid for the
  // Perplexity fallback to fetch it again. Challenge pages carry their markers
  // in visible text and element attributes, which survive this strip.
  const lower = body
    .slice(0, BLOCK_SCAN_SOURCE_LIMIT)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .slice(0, BLOCK_SCAN_LIMIT)
    .toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("checking your browser") ||
    lower.includes("attention required") ||
    lower.includes("access denied") ||
    lower.includes("please wait for verification") ||
    lower.includes("please enable javascript") ||
    lower.includes("are you a robot") ||
    /(g-recaptcha|hcaptcha|cf-turnstile|data-sitekey|solve captcha|enter the characters|captcha[^<]{0,80}(challenge|required|verify|verification))/i.test(lower) ||
    lower.includes("dcinside.pandalive.co.kr") ||
    lower.includes("/auth/login") ||
    lower.includes("msign.dcinside.com") ||
    /reddit[^<]{0,40}(verification|please wait)/i.test(lower)
  );
}

function hasMeaningfulHtmlContent(html, text) {
  if (text.length >= SPA_SHELL_THRESHOLD) return true;
  if (text.length < 40) return false;
  return /<(article|main|p|h1|h2|section)\b/i.test(html);
}

function resolveSitePreset(url, requested = "auto") {
  if (requested && requested !== "auto") return requested;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "store.steampowered.com" || host.endsWith(".steampowered.com")) return "steam";
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
    if (host === "dcinside.com" || host.endsWith(".dcinside.com")) return "dcinside";
    if (host === "namu.wiki" || host.endsWith(".namu.wiki")) return "namu";
    if (isMediaWikiHost(host)) return "mediawiki";
    if (isSageHost(host)) return "sage";
    if (isSourceForgeHost(host)) return "sourceforge";
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (isNewsHost(host)) return "news";
  } catch { /* keep generic */ }
  return "auto";
}

function hostMatchesDomain(host, domain) {
  const normalized = String(host || "").replace(/^www\./, "").toLowerCase();
  const target = String(domain || "").replace(/^www\./, "").toLowerCase();
  return !!target && (normalized === target || normalized.endsWith(`.${target}`));
}

function findNewsSourceByHost(host) {
  return NEWS_SOURCES.find((source) => source.domains.some((domain) => hostMatchesDomain(host, domain))) || null;
}

function isNewsHost(host) {
  return !!findNewsSourceByHost(host);
}

function isMediaWikiHost(host) {
  return MEDIAWIKI_DOMAINS.some((domain) => hostMatchesDomain(host, domain));
}

function isSageHost(host) {
  return SAGE_DOMAINS.some((domain) => hostMatchesDomain(host, domain));
}

function isSourceForgeHost(host) {
  return SOURCEFORGE_DOMAINS.some((domain) => hostMatchesDomain(host, domain));
}

function isSourceForgeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return isSourceForgeHost(host);
  } catch {
    return false;
  }
}

function buildSourceForgeRestUrl(url) {
  try {
    const u = new URL(url);
    if (!isSourceForgeHost(u.hostname.replace(/^www\./, ""))) return "";
    if (!/^\/p\/[^/]+\/[^/]+(?:\/|$)/i.test(u.pathname)) return "";
    const rest = new URL(u.toString());
    rest.pathname = u.pathname.replace(/^\/p\//i, "/rest/p/");
    rest.search = "";
    rest.hash = "";
    return rest.toString();
  } catch {
    return "";
  }
}

function isDcinsideUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "dcinside.com" || host.endsWith(".dcinside.com");
  } catch {
    return false;
  }
}

function buildDcinsideMobileUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "m.dcinside.com") return u.toString();
    if (!(host === "gall.dcinside.com" || host.endsWith(".dcinside.com"))) return "";
    const id = u.searchParams.get("id");
    const no = u.searchParams.get("no");
    if (!id || !no || !/\/board\/view\/?/i.test(u.pathname)) return "";
    return `https://m.dcinside.com/board/${encodeURIComponent(id)}/${encodeURIComponent(no)}`;
  } catch {
    return "";
  }
}

function isRedditUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "reddit.com" || host.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

function isNamuWikiUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "namu.wiki" || host.endsWith(".namu.wiki");
  } catch {
    return false;
  }
}

function isMediaWikiUrl(url) {
  try {
    return isMediaWikiHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isSageUrl(url) {
  try {
    return isSageHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isNewsUrl(url) {
  try {
    return isNewsHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function buildRedditJsonUrl(url) {
  try {
    const u = new URL(url);
    if (!isRedditUrl(url)) return "";
    let path = u.pathname.replace(/\/+$/g, "");
    if (!path) return "";

    if (!/\.json$/i.test(path)) {
      const commentsMatch = path.match(/^\/(?:r\/[^/]+\/)?comments\/[a-z0-9]+(?:\/[^/]+)?/i);
      if (!commentsMatch) return "";
      path = `${path}.json`;
    }

    const out = new URL(`https://www.reddit.com${path}`);
    out.searchParams.set("raw_json", "1");
    return out.toString();
  } catch {
    return "";
  }
}

function buildSageFullTextUrl(url) {
  try {
    if (!isSageUrl(url)) return "";
    const u = new URL(url);
    const match = u.pathname.match(/^\/doi\/(?!full\/|pdf\/|epub\/|abs\/)(.+)$/i);
    if (!match) return "";
    u.pathname = `/doi/full/${match[1]}`;
    return u.toString();
  } catch {
    return "";
  }
}

function userAgentsForSitePreset(preset) {
  if (preset === "reddit") return REDDIT_USER_AGENTS;
  return preset === "dcinside" ? DCINSIDE_USER_AGENTS : USER_AGENTS;
}

function fetchUrlForAttempt(url, preset, attemptIndex) {
  if (preset === "reddit") {
    const jsonUrl = buildRedditJsonUrl(url);
    if (jsonUrl && (attemptIndex > 0 || /\.json\/?$/i.test(new URL(url).pathname))) {
      return { url: jsonUrl, kind: "reddit-json" };
    }
    return { url, kind: "original" };
  }
  if (preset === "sage") {
    const fullTextUrl = buildSageFullTextUrl(url);
    if (fullTextUrl && attemptIndex > 0) return { url: fullTextUrl, kind: "sage-fulltext" };
    return { url, kind: "original" };
  }
  if (preset !== "dcinside") return { url, kind: "original" };
  const mobileUrl = buildDcinsideMobileUrl(url);
  if (mobileUrl && mobileUrl !== url && attemptIndex > 0) {
    return { url: mobileUrl, kind: "dcinside-mobile" };
  }
  return { url, kind: mobileUrl === url ? "dcinside-mobile" : "original" };
}

function applySitePresetCookies(cookieJar, preset) {
  if (preset === "steam") seedSteamAdultCookies(cookieJar);
  if (preset === "reddit") cookieJar.set("over18", "1");
}

function sitePresetHeaders(preset) {
  if (preset === "dcinside") {
    return {
      "Accept-Language": "ko-KR,ko;q=0.95,en-US;q=0.8,en;q=0.7",
      Referer: "https://www.dcinside.com/",
    };
  }
  if (preset === "namu") return { "Accept-Language": "ko-KR,ko;q=0.95,en-US;q=0.8,en;q=0.7" };
  if (preset === "mediawiki") return { "Accept-Language": "ko-KR,ko;q=0.95,en-US;q=0.8,en;q=0.7" };
  if (preset === "sage") return { "Accept-Language": "en-US,en;q=0.95,ko;q=0.7" };
  if (preset === "sourceforge") return { Accept: "application/json,text/html;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.95,ko;q=0.7" };
  if (preset === "news") return { "Accept-Language": "ko-KR,ko;q=0.95,en-US;q=0.8,en;q=0.7" };
  if (preset === "steam") return { "Accept-Language": "en-US,en;q=0.9,ko;q=0.7" };
  if (preset === "reddit") {
    return {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ko;q=0.7",
    };
  }
  if (preset === "github" || preset === "youtube") return { "Accept-Language": "en-US,en;q=0.9,ko;q=0.7" };
  return {};
}

function isDocumentUrl(url) {
  return DOCUMENT_EXT_RE.test(url);
}

function isDocumentResponse(url, contentType) {
  return isDocumentUrl(url) || DOCUMENT_CONTENT_RE.test(contentType || "");
}

function isTextualResponse(url, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (!ct) return !isDocumentUrl(url);
  return /text\/|html|xml|json|javascript|x-www-form-urlencoded/.test(ct) && !isDocumentResponse(url, ct);
}

function safeResolveUrl(baseUrl, candidate) {
  try {
    const target = new URL(decodeEntities(candidate).trim(), baseUrl);
    if (target.protocol === "http:" || target.protocol === "https:") return target.toString();
  } catch { /* invalid URL */ }
  return "";
}

function extractClientRedirect(baseUrl, html) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (tagAttribute(tag, "http-equiv").toLowerCase() !== "refresh") continue;
    const content = tagAttribute(tag, "content");
    const urlMatch = content.match(/url\s*=\s*([^;]+)/i);
    if (urlMatch) {
      const target = safeResolveUrl(baseUrl, urlMatch[1].replace(/^['"]|['"]$/g, ""));
      if (target) return { url: target, kind: "meta-refresh" };
    }
  }

  const jsPatterns = [
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/i,
    /document\.location\s*=\s*["']([^"']+)["']/i,
  ];
  const scan = html.slice(0, 40_000);
  for (const re of jsPatterns) {
    const match = scan.match(re);
    if (!match) continue;
    const target = safeResolveUrl(baseUrl, match[1]);
    if (target) return { url: target, kind: "javascript-redirect" };
  }
  return null;
}

function isDcinsideAuthOrSinkUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return (
      host === "msign.dcinside.com" ||
      host.endsWith(".pandalive.co.kr") ||
      (host === "m.dcinside.com" && /^\/auth\/login\/?$/i.test(u.pathname)) ||
      (host.endsWith(".dcinside.com") && /\/login\/?$/i.test(u.pathname))
    );
  } catch {
    return false;
  }
}

function shouldFollowClientRedirect(baseUrl, targetUrl, preset) {
  if (preset === "dcinside" && isDcinsideUrl(baseUrl) && isDcinsideAuthOrSinkUrl(targetUrl)) return false;
  if (preset === "news" && isNewsRedirectSinkUrl(targetUrl, baseUrl)) return false;
  return true;
}

function isNewsRedirectSinkUrl(url, baseUrl = "") {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.endsWith("kmib.co.kr") && /^\/article\/keyword\.asp$/i.test(u.pathname) && !u.searchParams.get("kwd")) return true;
    if (isNewsHost(host) && baseUrl) {
      const base = new URL(baseUrl);
      const basePath = base.pathname.replace(/\/+$/g, "") || "/";
      const targetPath = u.pathname.replace(/\/+$/g, "") || "/";
      const dropsToHome = targetPath === "/" || /^\/(?:news\/)?home$/i.test(targetPath);
      const dropsToDocument = /^\/pdf$/i.test(targetPath);
      if ((dropsToHome || dropsToDocument) && basePath !== "/" && base.hostname.replace(/^www\./, "") === host) return true;
    }
  } catch { /* invalid URL */ }
  return false;
}

// Never delete the containers an article body normally lives in.
const ARTICLE_CONTAINER_TAGS = ["article", "main", "body"];
// Tag names that are chrome regardless of their attributes (news pages only).
const NEWS_NOISE_TAGS_RE = /^(aside|nav|footer|header|figure|figcaption)$/i;
// Elements that never contribute text and can go before any attribute analysis.
const BOILERPLATE_INERT_TAGS_RE = /<(script|style|noscript|iframe|svg|canvas|form|button|select|textarea)\b[\s\S]*?<\/\1>/gi;
// Defensive stop only; real pages never approach it.
const BOILERPLATE_MAX_REMOVALS = 5000;

// MediaWiki, SAGE and news pages all need the same operation: walk the markup
// and delete whole elements whose id/class/role marks them as chrome. The three
// call sites differ only in which attribute pattern counts as noise, which
// container tags must never be deleted, and whether some tag names are noise on
// their own.
//
// Scanning moves strictly forward. An earlier version restarted from index 0
// after every removal and gave up after 80-100 passes, so a page carrying more
// boilerplate than that kept the remainder in its extracted body.
/**
 * @param {string} html
 * @param {{ attrPattern: RegExp, keepTags?: string[], noiseTagPattern?: RegExp|null, includeAriaLabel?: boolean }} options
 */
function stripBoilerplateElements(html, { attrPattern, keepTags = [], noiseTagPattern = null, includeAriaLabel = false }) {
  let out = String(html || "")
    .replace(BOILERPLATE_INERT_TAGS_RE, "")
    .replace(/<input\b[^>]*>/gi, "");

  const openTagRe = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let removals = 0;
  let match;
  while ((match = openTagRe.exec(out)) && removals < BOILERPLATE_MAX_REMOVALS) {
    const tagName = match[1].toLowerCase();
    if (keepTags.includes(tagName)) continue;

    const attrs = parseAttributes(match[2]);
    const attrText = [attrs.id, attrs.class, attrs.role, includeAriaLabel ? attrs["aria-label"] : ""]
      .map((value) => value || "")
      .join(" ");
    const tagIsNoise = !!noiseTagPattern && noiseTagPattern.test(tagName);
    if (!tagIsNoise && !attrPattern.test(attrText)) continue;

    const element = extractElementFromOpenTag(out, match.index, tagName);
    if (!element.length) continue; // malformed markup; never risk a stuck loop
    out = out.slice(0, match.index) + out.slice(match.index + element.length);
    // Everything before match.index is unchanged and already scanned, so resume
    // exactly where the removed element used to start.
    openTagRe.lastIndex = match.index;
    removals++;
  }
  return out;
}

function findElementByClass(html, className) {
  const openTagRe = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;
  while ((match = openTagRe.exec(html))) {
    const attrs = parseAttributes(match[2]);
    const classes = (attrs.class || "").split(/\s+/);
    if (!classes.includes(className)) continue;

    const tagName = match[1].toLowerCase();
    const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
    tagRe.lastIndex = match.index;
    let depth = 0;
    let tagMatch;
    while ((tagMatch = tagRe.exec(html))) {
      const tag = tagMatch[0];
      const closing = /^<\//.test(tag);
      const selfClosing = /\/\s*>$/.test(tag);
      if (closing) {
        depth--;
      } else if (!selfClosing) {
        depth++;
      }
      if (depth === 0) return html.slice(match.index, tagRe.lastIndex);
    }
    return html.slice(match.index);
  }
  return "";
}

function findTagByClass(html, className) {
  const openTagRe = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;
  while ((match = openTagRe.exec(html))) {
    const attrs = parseAttributes(match[2]);
    if ((attrs.class || "").split(/\s+/).includes(className)) return match[0];
  }
  return "";
}

function findElementById(html, id) {
  const openTagRe = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;
  while ((match = openTagRe.exec(html))) {
    const attrs = parseAttributes(match[2]);
    if (attrs.id !== id) continue;

    const tagName = match[1].toLowerCase();
    const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
    tagRe.lastIndex = match.index;
    let depth = 0;
    let tagMatch;
    while ((tagMatch = tagRe.exec(html))) {
      const tag = tagMatch[0];
      const closing = /^<\//.test(tag);
      const selfClosing = /\/\s*>$/.test(tag);
      if (closing) {
        depth--;
      } else if (!selfClosing) {
        depth++;
      }
      if (depth === 0) return html.slice(match.index, tagRe.lastIndex);
    }
    return html.slice(match.index);
  }
  return "";
}

function extractElementFromOpenTag(html, openIndex, tagName) {
  const tagRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagRe.lastIndex = openIndex;
  let depth = 0;
  let tagMatch;
  while ((tagMatch = tagRe.exec(html))) {
    const tag = tagMatch[0];
    const closing = /^<\//.test(tag);
    const selfClosing = /\/\s*>$/.test(tag);
    if (closing) {
      depth--;
    } else if (!selfClosing) {
      depth++;
    }
    if (depth === 0) return html.slice(openIndex, tagRe.lastIndex);
  }
  return html.slice(openIndex);
}

function findElementsByTagName(html, tagName, limit = 12) {
  const out = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let match;
  while ((match = re.exec(html)) && out.length < limit) {
    out.push(extractElementFromOpenTag(html, match.index, tagName.toLowerCase()));
  }
  return out;
}

function findElementsByAttributePattern(html, attrName, pattern, limit = 24) {
  const out = [];
  const openTagRe = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;
  while ((match = openTagRe.exec(html)) && out.length < limit) {
    const attrs = parseAttributes(match[2]);
    if (!pattern.test(attrs[attrName] || "")) continue;
    out.push(extractElementFromOpenTag(html, match.index, match[1].toLowerCase()));
  }
  return out;
}

function textByClass(html, className) {
  const element = findElementByClass(html, className);
  return element ? htmlToText(element, "strict") : "";
}

function extractDcinsideArticleData(url, html, mode = "balanced", opts = {}) {
  if (!isDcinsideUrl(url)) return null;
  const bodyHtml = findElementByClass(html, "write_div");
  if (!bodyHtml) return null;

  const title = [textByClass(html, "title_headtext"), textByClass(html, "title_subject")]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const writerTag = findTagByClass(html, "gall_writer");
  const writerAttrs = writerTag ? parseAttributes(writerTag.replace(/^<[a-z][\w:-]*\b/i, "").replace(/>$/, "")) : {};
  const author = writerAttrs["data-nick"] || textByClass(html, "nickname");
  const dateTag = findTagByClass(html, "gall_date");
  const dateAttrs = dateTag ? parseAttributes(dateTag.replace(/^<[a-z][\w:-]*\b/i, "").replace(/>$/, "")) : {};
  const published = dateAttrs.title || textByClass(html, "gall_date");
  const stats = [
    textByClass(html, "gall_count"),
    textByClass(html, "gall_reply_num"),
    textByClass(html, "gall_comment"),
  ].filter(Boolean).join(" ");
  const articleHtml = bodyHtml
    .replace(/<div\b[^>]*id=["'](?:ad_nv_slot|zzbang_div)["'][\s\S]*?<\/div>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  let articleText = htmlToText(articleHtml, mode, { include_links: opts.include_links !== false, base_url: url });
  // Image-centric posts have almost no body text — keep them instead of
  // discarding (which would drop to noisy generic extraction). Only bail
  // when there is no text, no title, and no real content image.
  const hasContentImage = /viewimage\.php|dcimg\d+\.dcinside/i.test(articleHtml);
  if (!articleText || articleText.length < 40) {
    if (!title && !hasContentImage) return null;
    if (!articleText) articleText = hasContentImage ? "(본문은 주로 이미지입니다)" : "";
  }

  let galleryId = "";
  let postNo = "";
  try {
    const u = new URL(url);
    galleryId = u.searchParams.get("id") || u.pathname.match(/\/board\/([^/]+)\/(\d+)/)?.[1] || "";
    postNo = u.searchParams.get("no") || u.pathname.match(/\/board\/([^/]+)\/(\d+)/)?.[2] || "";
  } catch { /* keep empty */ }

  const heading = [
    title ? `# ${title}` : "",
    [author ? `Author: ${author}` : "", published ? `Published: ${published}` : "", stats].filter(Boolean).join(" | "),
  ].filter(Boolean).join("\n");

  return {
    text: [heading, articleText].filter(Boolean).join("\n\n"),
    structured: compactObject({
      type: "dcinside_post",
      gallery_id: galleryId,
      post_no: postNo,
      title,
      author,
      published,
      stats,
    }),
  };
}

// ── DCinside comments (AJAX replication, no browser needed) ─────────
// DCinside renders the article body server-side but loads the comment
// thread via a separate XHR POST to /board/comment/. A plain fetch never
// runs that JS, so comments are missing. We replicate the XHR directly.
const DCINSIDE_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DCINSIDE_COMMENT_ENDPOINT = "https://gall.dcinside.com/board/comment/";
const DCINSIDE_COMMENT_MAX_PAGES = 8;
const DCINSIDE_COMMENT_MAX_ITEMS = 400;
const DCINSIDE_COMMENT_PER_PAGE = 100;

function dcinsideIdNo(url) {
  try {
    const u = new URL(url);
    const pathPair = u.pathname.match(/\/board\/([^/]+)\/(\d+)/);
    const id = u.searchParams.get("id") || pathPair?.[1] || "";
    const no = u.searchParams.get("no") || pathPair?.[2] || "";
    return { id, no };
  } catch {
    return { id: "", no: "" };
  }
}

function dcinsideGallType(url, html) {
  const m = html && html.match(/_GALLTYPE_["']?\s*[:=]\s*["']?([A-Z]{1,3})\b/);
  if (m) return m[1];
  let path = "";
  try { path = new URL(url).pathname; } catch { /* ignore */ }
  if (/\/mgallery\//i.test(path)) return "M";
  if (/\/mini\//i.test(path)) return "MI";
  if (/\/person\//i.test(path)) return "P";
  return "G";
}

function dcinsideViewUrl(id, no, gallType) {
  const seg = gallType === "M" ? "mgallery/board"
    : gallType === "MI" ? "mini/board"
    : gallType === "P" ? "person/board"
    : "board";
  return `https://gall.dcinside.com/${seg}/view/?id=${encodeURIComponent(id)}&no=${encodeURIComponent(no)}`;
}

function extractDcinsideEsno(html) {
  if (!html) return "";
  const m = html.match(/name=["']e_s_n_o["'][^>]*\bvalue=["']([^"']+)["']/i)
    || html.match(/\bvalue=["']([^"']+)["'][^>]*name=["']e_s_n_o["']/i)
    || html.match(/e_s_n_o["']?\s*[:=]\s*["']([0-9a-f]{16,})["']/i);
  return m ? m[1] : "";
}

function dcinsideCommentMemoToText(memo) {
  if (!memo) return "";
  let out = String(memo);
  // dccon / emoticon images → keep their title/alt as a hint, else a placeholder.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const hint = tagAttribute(tag, "title") || tagAttribute(tag, "alt");
    return hint ? ` [이미지:${hint}] ` : " [이미지] ";
  });
  out = out.replace(/<br\s*\/?>/gi, " ");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeEntities(out);
  return out.replace(/\s+/g, " ").trim();
}

async function fetchDcinsideCommentPage(idNo, gallType, esno, cookieJar, page, signal) {
  const params = new URLSearchParams({
    id: idNo.id,
    no: idNo.no,
    cmt_id: idNo.id,
    cmt_no: idNo.no,
    e_s_n_o: esno,
    comment_page: String(page),
    sort: "",
    _GALLTYPE_: gallType,
  });
  const headers = fetchHeaders(DCINSIDE_DESKTOP_UA, cookieJar, {
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Origin: "https://gall.dcinside.com",
    Referer: dcinsideViewUrl(idNo.id, idNo.no, gallType),
  }, "xhr");
  const res = await fetch(DCINSIDE_COMMENT_ENDPOINT, {
    method: "POST",
    headers,
    body: params.toString(),
    signal,
    redirect: "follow",
  });
  storeResponseCookies(cookieJar, res.headers);
  if (!res.ok) return null;
  const textBody = await readTextResponse(res, res.headers.get("content-type") || "");
  try {
    return JSON.parse(textBody);
  } catch {
    return null;
  }
}

async function fetchDcinsideComments(url, html, cookieJar, signal, opts = {}) {
  if (!isDcinsideUrl(url)) return null;
  const idNo = dcinsideIdNo(url);
  if (!idNo.id || !idNo.no) return null;
  const gallType = dcinsideGallType(url, html);
  let esno = extractDcinsideEsno(html);

  // Mobile/redirect variants may not carry the desktop token. Fetch the
  // desktop view once to obtain e_s_n_o and refresh session cookies.
  if (!esno) {
    try {
      const viewUrl = dcinsideViewUrl(idNo.id, idNo.no, gallType);
      const res = await fetch(viewUrl, {
        method: "GET",
        headers: fetchHeaders(DCINSIDE_DESKTOP_UA, cookieJar, { Referer: "https://www.dcinside.com/" }),
        signal,
        redirect: "follow",
      });
      storeResponseCookies(cookieJar, res.headers);
      const pageHtml = await readTextResponse(res, res.headers.get("content-type") || "");
      esno = extractDcinsideEsno(pageHtml);
    } catch { /* fall through to early return */ }
  }
  if (!esno) return null;

  const items = [];
  let total = 0;
  for (let page = 1; page <= DCINSIDE_COMMENT_MAX_PAGES; page++) {
    if (signal?.aborted) break;
    let data = null;
    try {
      data = await fetchDcinsideCommentPage(idNo, gallType, esno, cookieJar, page, signal);
    } catch {
      break;
    }
    if (!data || !Array.isArray(data.comments)) break;
    if (Number.isFinite(Number(data.total_cnt))) total = Number(data.total_cnt);
    let added = 0;
    for (const c of data.comments) {
      if (!c || c.del_yn === "Y" || c.is_delete === "1") continue;
      const memo = dcinsideCommentMemoToText(c.memo);
      const body = memo || (c.vr_type || c.voice ? "[보이스 리플]" : "");
      if (!body) continue;
      items.push({
        no: String(c.no || ""),
        depth: Number(c.depth) || 0,
        name: decodeEntities(String(c.name || "")).trim(),
        ip: c.ip ? String(c.ip) : "",
        user_id: c.user_id ? String(c.user_id) : "",
        date: String(c.reg_date || "").trim(),
        memo: body,
      });
      added++;
      if (items.length >= DCINSIDE_COMMENT_MAX_ITEMS) break;
    }
    if (items.length >= DCINSIDE_COMMENT_MAX_ITEMS) break;
    if (added === 0) break;
    if (total && page * DCINSIDE_COMMENT_PER_PAGE >= total) break;
  }
  if (!items.length) return null;
  return {
    total: total || items.length,
    items,
    truncated: items.length >= DCINSIDE_COMMENT_MAX_ITEMS,
  };
}

function formatDcinsideComments(data) {
  if (!data || !Array.isArray(data.items) || !data.items.length) return "";
  const lines = [`## 댓글 (${data.total})`];
  let topIndex = 0;
  for (const c of data.items) {
    const who = `${c.name || "익명"}${c.ip ? `(${c.ip})` : c.user_id ? `(${c.user_id})` : ""}`;
    const when = c.date ? ` ${c.date}` : "";
    if (c.depth > 0) {
      lines.push(`   └ ${who}${when}: ${c.memo}`);
    } else {
      topIndex++;
      lines.push(`${topIndex}. ${who}${when}: ${c.memo}`);
    }
  }
  if (data.truncated) lines.push(`… (이하 생략, 총 ${data.total}개)`);
  return lines.join("\n");
}

// ── Content image selection + MCP image blocks ─────────────────────
// htmlToText strips every <img>, so image context never reaches the model.
// We pick genuine content images (not UI chrome / emoticons), fetch them,
// and return them as MCP image blocks for multimodal clients to see.
const IMAGE_FETCH_BUDGET_MS = 12_000;
const IMAGE_MAX_BYTES = 3_500_000;
const IMAGE_TOTAL_MAX_BYTES = 9_000_000;
const IMAGE_SUPPORTED_MIME_RE = /^image\/(jpeg|png|gif|webp)$/;
// UI chrome, emoticons (dccon), spacers, icons, logos — never article content.
const IMAGE_URL_DENY_RE =
  /nstatic\.dcinside|wstatic\.dcinside|\/dccon\/|\/dc\/w\/images\/|noimg|blank\.gif|spacer|1x1|\bloading\b|\bicon\b|\blogo\b|button|btn_|emoticon|sprite/i;

function selectContentImageUrls(html, baseUrl, opts = {}) {
  if (!html) return [];
  const max = Math.max(1, Math.min(Number(opts.max_images) || 4, 10));
  const dcinside = isDcinsideUrl(baseUrl);
  let scope = html;
  if (dcinside) {
    const articleBody = findElementByClass(html, "write_div");
    if (articleBody) scope = articleBody;
  }
  const urls = [];
  const seen = new Set();
  const push = (raw) => {
    if (!raw || raw.startsWith("data:") || raw.includes("${")) return;
    const abs = safeResolveUrl(baseUrl, raw);
    if (!abs) return;
    if (/\.svg(?:[?#]|$)/i.test(abs)) return;
    if (IMAGE_URL_DENY_RE.test(abs)) return;
    const key = abs.split("#")[0];
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(abs);
  };
  // og:image / twitter:image is usually the headline image — try it first.
  push(findMetaContent(html, ["og:image", "twitter:image", "twitter:image:src"]));
  for (const m of scope.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    push(tagAttribute(tag, "src") || tagAttribute(tag, "data-original") || tagAttribute(tag, "data-src"));
    if (urls.length >= max * 4) break;
  }
  // DCinside: prefer genuinely uploaded post images (viewimage.php) when present.
  if (dcinside) {
    const real = urls.filter((u) => /viewimage\.php/i.test(u));
    if (real.length) return real.slice(0, max);
  }
  return urls.slice(0, max);
}

// DCinside serves images as application/octet-stream, so trust the bytes.
function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function collectImageBlocks(urls, baseUrl, signal, opts = {}) {
  const blocks = [];
  const notes = [];
  if (!Array.isArray(urls) || !urls.length) return { blocks, notes };
  const referer = isDcinsideUrl(baseUrl) ? "https://gall.dcinside.com/" : (baseUrl || "");
  let totalBytes = 0;
  for (const url of urls) {
    if (signal?.aborted) { notes.push("이미지 시간 초과로 일부 생략"); break; }
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": DCINSIDE_DESKTOP_UA,
          Referer: referer,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        signal,
        redirect: "follow",
      });
      if (!res.ok) { notes.push(`이미지 HTTP ${res.status}: ${url}`); continue; }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > IMAGE_MAX_BYTES) { notes.push(`용량 초과(${Math.round(buf.byteLength / 1024)}KB): ${url}`); continue; }
      if (!buf.byteLength) { notes.push(`빈 응답: ${url}`); continue; }
      // DCinside returns application/octet-stream, so prefer byte sniffing over the header.
      const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const mime = sniffImageMime(new Uint8Array(buf)) || (IMAGE_SUPPORTED_MIME_RE.test(headerMime) ? headerMime : "");
      if (!mime) { notes.push(`미지원/비이미지(${headerMime || "unknown"}): ${url}`); continue; }
      if (totalBytes + buf.byteLength > IMAGE_TOTAL_MAX_BYTES) { notes.push("이미지 총 용량 한도 도달, 이후 생략"); break; }
      totalBytes += buf.byteLength;
      blocks.push({ type: "image", data: arrayBufferToBase64(buf), mimeType: mime });
    } catch (err) {
      notes.push(`이미지 로드 실패(${err && err.name === "AbortError" ? "timeout" : "error"}): ${url}`);
    }
  }
  return { blocks, notes };
}

function redditMarkdownToText(markdown, opts = {}) {
  return cleanMarkdownText(markdown, "balanced", opts);
}

function redditCreatedIso(createdUtc) {
  if (!createdUtc || !Number.isFinite(Number(createdUtc))) return "";
  try {
    return new Date(Number(createdUtc) * 1000).toISOString();
  } catch {
    return "";
  }
}

function collectRedditComments(listing, out = [], limit = 20, depth = 0, opts = {}) {
  if (!listing || out.length >= limit || depth > 4) return out;
  const children = listing?.data?.children || [];
  for (const child of children) {
    if (out.length >= limit) break;
    if (child?.kind !== "t1") continue;
    const data = child.data || {};
    const body = redditMarkdownToText(data.body || "", opts);
    if (body && body !== "[deleted]" && body !== "[removed]") {
      out.push({
        author: data.author ? `u/${data.author}` : "",
        score: Number.isFinite(Number(data.score)) ? Number(data.score) : undefined,
        created: redditCreatedIso(data.created_utc),
        body,
      });
    }
    if (data.replies && typeof data.replies === "object") {
      collectRedditComments(data.replies, out, limit, depth + 1, opts);
    }
  }
  return out;
}

function extractRedditPostData(url, body, opts = {}) {
  if (!isRedditUrl(url) || !body) return null;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const post = Array.isArray(parsed)
    ? parsed[0]?.data?.children?.find((child) => child?.kind === "t3")?.data
    : parsed?.data?.children?.find((child) => child?.kind === "t3")?.data;
  if (!post) return null;

  const linkOpts = { include_links: opts.include_links !== false, base_url: url };
  const title = redditMarkdownToText(post.title || "", { include_links: false, base_url: url });
  const selfText = redditMarkdownToText(post.selftext || "", linkOpts);
  const published = redditCreatedIso(post.created_utc);
  const permalink = post.permalink ? safeResolveUrl("https://www.reddit.com/", post.permalink) : "";
  const subreddit = post.subreddit_name_prefixed || (post.subreddit ? `r/${post.subreddit}` : "");
  const author = post.author ? `u/${post.author}` : "";
  const comments = Array.isArray(parsed) ? collectRedditComments(parsed[1], [], 20, 0, linkOpts) : [];
  const linkUrl = post.url && post.url !== permalink && !post.is_self ? post.url : "";

  const facts = [
    subreddit ? `Subreddit: ${subreddit}` : "",
    author ? `Author: ${author}` : "",
    Number.isFinite(Number(post.score)) ? `Score: ${Number(post.score)}` : "",
    Number.isFinite(Number(post.num_comments)) ? `Comments: ${Number(post.num_comments)}` : "",
    Number.isFinite(Number(post.upvote_ratio)) ? `Upvote ratio: ${Number(post.upvote_ratio)}` : "",
    published ? `Published: ${published}` : "",
  ].filter(Boolean).join(" | ");

  const commentText = comments.length
    ? [
        "Top comments:",
        ...comments.map((comment, index) => {
          const score = Number.isFinite(Number(comment.score)) ? ` (${comment.score})` : "";
          return `[C${index + 1}] ${comment.author || "unknown"}${score}: ${comment.body}`;
        }),
      ].join("\n\n")
    : "";

  const text = [
    title ? `# ${title}` : "",
    facts,
    linkUrl ? `Link: ${linkUrl}` : "",
    selfText,
    commentText,
  ].filter(Boolean).join("\n\n");

  if (!text.trim()) return null;

  return {
    text,
    meta: compactObject({
      title,
      description: selfText.slice(0, 500),
      canonical: permalink || url,
      author,
      published,
      siteName: "Reddit",
      type: "reddit_post",
    }),
    structured: compactObject({
      type: "reddit_post",
      id: post.id,
      name: post.name,
      subreddit,
      title,
      author,
      published,
      score: Number.isFinite(Number(post.score)) ? Number(post.score) : undefined,
      upvote_ratio: Number.isFinite(Number(post.upvote_ratio)) ? Number(post.upvote_ratio) : undefined,
      num_comments: Number.isFinite(Number(post.num_comments)) ? Number(post.num_comments) : undefined,
      permalink: permalink || undefined,
      link_url: linkUrl || undefined,
      is_self: !!post.is_self,
      comments: comments.length ? comments : undefined,
    }),
  };
}

function isNamuActualHeading(line) {
  const trimmed = line.trim();
  if (!/^\d+(?:\.\d+)*\.\s+\S/.test(trimmed)) return false;
  const tocMarkers = trimmed.match(/\b\d+(?:\.\d+)*\s+\.\s+/g) || [];
  return tocMarkers.length <= 1;
}

function isNamuTocLine(line) {
  const trimmed = line.trim();
  if (trimmed.length < 30) return false;
  const tocMarkers = trimmed.match(/\b\d+(?:\.\d+)*\s+\.\s+/g) || [];
  return tocMarkers.length >= 3;
}

function cleanNamuWikiText(text) {
  if (!text) return "";

  let out = text
    .replace(/\s*\[편집\]/g, "")
    .replace(/IP 우회 수단[\s\S]{0,800}?문의하시길 바랍니다\.?/g, "")
    .replace(/\[?\s*펼치기\s*·\s*접기\s*\]?/g, "");

  let lines = out
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const categoryIndex = lines.findIndex((line) => /^분류(?:\s|$)/.test(line));
  if (categoryIndex >= 0) {
    const firstHeadingAfterCategory = lines.findIndex((line, index) => index > categoryIndex && isNamuActualHeading(line));
    if (firstHeadingAfterCategory > categoryIndex) {
      lines = [
        ...lines.slice(0, categoryIndex),
        ...lines.slice(firstHeadingAfterCategory),
      ];
    }
  }

  const dropLine = (line) => (
    /^(최근 변경 최근 토론 특수 기능|최근 변경|최근 토론|특수 기능|토론 역사|편집|역사|토론|분류|닫기)$/.test(line) ||
    /^\d+$/.test(line) ||
    /^IP 우회 수단/.test(line) ||
    /^\(VPN이나 iCloud/.test(line) ||
    /^잘못된 IDC 대역 차단/.test(line) ||
    /^나무위키는 백과사전이 아니며/.test(line) ||
    /^이 저작물은/.test(line) ||
    isNamuTocLine(line)
  );

  return lines
    .filter((line) => !dropLine(line))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractNamuWikiData(url, html, mode = "balanced", opts = {}) {
  if (!isNamuWikiUrl(url)) return null;
  const text = cleanNamuWikiText(htmlToText(html, mode, { include_links: opts.include_links !== false, base_url: url }));
  if (!text || text.length < 40) return null;

  let title = "";
  try {
    const u = new URL(url);
    const rawTitle = decodeURIComponent(u.pathname.replace(/^\/w\//, "").split("/")[0] || "");
    title = rawTitle || "";
  } catch { /* keep empty */ }

  return {
    text,
    structured: compactObject({
      type: "namu_wiki_article",
      title,
    }),
  };
}

const MEDIAWIKI_BOILERPLATE_ATTR_RE = /(?:^|[\s_-])(mw-editsection|toc|catlinks|printfooter|navbox|metadata|ambox|headAlert|noprint|thumb|tright|tleft|floatright|floatleft|gallery)(?:$|[\s_-])/i;

function stripMediaWikiBoilerplateHtml(html) {
  // No regex shortcut for mw-editsection: MediaWiki nests bracket spans inside
  // it (`<span class=mw-editsection><span>[</span><a><span>edit</span>…`), so a
  // non-greedy `[sS]*?</span>` stops at the first inner close tag and leaves an
  // orphaned "edit" beside every heading. Depth-aware removal handles it.
  return stripBoilerplateElements(html, { attrPattern: MEDIAWIKI_BOILERPLATE_ATTR_RE });
}

// Table-of-contents heading, in the languages the registry actually covers.
const MEDIAWIKI_TOC_HEADING_RE = /^(목차|Contents|Table of contents)$/i;
// Section edit affordances: "[편집]", "[edit]", "[edit | edit source]".
const MEDIAWIKI_EDIT_MARKER_RE = /^\[\s*(편집(?:\s*\|\s*원본 편집)?|edit(?:\s*\|\s*edit source)?)\s*\]$/i;
// Skin chrome that survives as bare one-word lines. Deliberately conservative:
// "History", "Contents", "Tools" and "Search" are all plausible section
// headings, so only phrases that cannot be article headings belong here.
const MEDIAWIKI_UI_LINE_RE =
  /^(편집|원본 편집|문서|토론|읽기|역사|보기|도구|이동|검색|edit source|view source|view history|jump to content)$/i;

function cleanMediaWikiText(text) {
  const out = [];
  let inToc = false;
  for (const rawLine of String(text || "").replace(/\r\n?/g, "\n").split(/\n+/)) {
    const line = rawLine.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    if (MEDIAWIKI_TOC_HEADING_RE.test(line)) {
      inToc = true;
      continue;
    }
    if (inToc && /^\d+(?:\.\d+)*\s+\S/.test(line)) continue;
    if (inToc) inToc = false;
    if (MEDIAWIKI_EDIT_MARKER_RE.test(line)) continue;
    if (MEDIAWIKI_UI_LINE_RE.test(line)) continue;
    out.push(line);
  }
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

// "Anycast - Wikipedia" -> "Wikipedia". Wikimedia sites do not emit
// og:site_name, so the <title> suffix is the only in-page signal.
function mediaWikiSiteName(meta, url) {
  if (meta.siteName) return meta.siteName;
  const fromTitle = String(meta.title || "").match(/\s+[-–—|]\s+([^-–—|]{2,40})\s*$/)?.[1]?.trim();
  if (fromTitle) return fromTitle;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractMediaWikiArticleData(url, html, mode = "balanced", opts = {}) {
  if (!isMediaWikiUrl(url)) return null;
  const meta = extractMetadata(html);
  const title = htmlToText(findElementById(html, "firstHeading"), "strict")
    || (meta.title || "").replace(/\s+-\s+[^-]+$/g, "").trim();
  const bodyHtml = findElementById(html, "mw-content-text") || findElementByClass(html, "mw-parser-output");
  if (!bodyHtml) return null;

  const body = cleanMediaWikiText(htmlToText(stripMediaWikiBoilerplateHtml(bodyHtml), mode, { include_links: opts.include_links !== false, base_url: url }));
  if (!body || body.length < 80) return null;

  const site = mediaWikiSiteName(meta, url);
  const header = [
    title ? `# ${title}` : "",
    site ? `Site: ${site}` : "",
  ].filter(Boolean).join("\n");

  return {
    text: [header, body].filter(Boolean).join("\n\n"),
    meta: {
      ...meta,
      title: title || meta.title,
      siteName: site || meta.siteName,
      type: "mediawiki_article",
    },
    structured: compactObject({
      type: "mediawiki_article",
      site,
      title,
      canonical: meta.canonical,
    }),
  };
}

const SAGE_BODY_ATTR_RE = /(hlFld[-_\s]?(Abstract|Fulltext|FullText)|article[-_\s]?(body|content|fulltext|full-text)|NLM_article-body|abstractSection|abstractInFull|core-container|publicationContent)/i;
const SAGE_BOILERPLATE_ATTR_RE = /(?:^|[\s_-])(access|alert|article-tools|author-information|banner|breadcrumb|collection|cookie|download|figures|footer|header|issue-item|metrics|modal|navbar|permissions|popup|recommended|related|rights|share|sidebar|social|table-of-contents|toc|toolbar)(?:$|[\s_-])/i;

function stripSageBoilerplateHtml(html) {
  return stripBoilerplateElements(html, {
    attrPattern: SAGE_BOILERPLATE_ATTR_RE,
    keepTags: ARTICLE_CONTAINER_TAGS,
    includeAriaLabel: true,
  });
}

function cleanSageArticleText(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    if (out.length > 8 && /^(Cite|Share options?|Information, rights and permissions|Metrics and citations|Figures and tables)$/i.test(normalized)) break;
    if (/^(Skip to main content|Intended for healthcare professionals|Search this journal|Search all journals|Enter search terms|Search Search|Advanced search|Access\/Profile Access|View access options|View profile|Create profile|Cart 0|Close Drawer Menu|Open Drawer Menu|Menu)$/i.test(normalized)) continue;
    if (/^(Contents|PDF\/EPUB|More|Cite|Share options?|Information, rights and permissions|Metrics and citations|Figures and tables|Request permissions|Add email alerts|Create email alert)$/i.test(normalized)) continue;
    if (/^(Crossref|PubMed|Web of Science|Google Scholar|Email Link|FacebookX \(formerly Twitter\)LinkedInWeChat|Copy Citation|Direct import|Download to reference manager|Select your citation manager software:.*)$/i.test(normalized)) continue;
    if (/^(All Articles|View all authors and affiliations|View all publications by this author|View All Journal Metrics)$/i.test(normalized)) continue;
    if (/^(OR|Open access|Research article|More from|Related articles?|Recommended|Advertisement|Advertising)$/i.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractSageArticleData(url, html, mode = "balanced", opts = {}) {
  if (!isSageUrl(url)) return null;
  const meta = extractMetadata(html);
  const title = findMetaContent(html, ["citation_title", "dc.Title", "og:title", "twitter:title"])
    || (meta.title || "").replace(/\s*\|\s*SAGE.*$/i, "").trim();
  const journal = findMetaContent(html, ["citation_journal_title", "dc.Source"]) || meta.siteName || "SAGE Journals";
  const doi = findMetaContent(html, ["citation_doi", "dc.Identifier"]).replace(/^doi:\s*/i, "");
  const published = findMetaContent(html, ["citation_publication_date", "dc.Date", "article:published_time"]) || meta.published;
  const authors = findMetaContents(html, ["citation_author", "dc.Creator"]).join(", ");

  const candidates = [
    findElementByClass(html, "hlFld-Abstract"),
    findElementByClass(html, "hlFld-Fulltext"),
    findElementByClass(html, "hlFld-FullText"),
    findElementByClass(html, "articleFullText"),
    findElementByClass(html, "NLM_article-body"),
    findElementByClass(html, "abstractSection"),
    ...findElementsByAttributePattern(html, "id", SAGE_BODY_ATTR_RE, 12),
    ...findElementsByAttributePattern(html, "class", SAGE_BODY_ATTR_RE, 24),
    findElementsByTagName(html, "article", 4)[0],
    findElementsByTagName(html, "main", 2)[0],
  ].filter(Boolean);

  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    const text = cleanSageArticleText(htmlToText(stripSageBoilerplateHtml(candidate), mode, { include_links: opts.include_links !== false, base_url: url }));
    const hasAbstract = /\bAbstract\b/i.test(text);
    const hasReferences = /\bReferences\b/i.test(text);
    const score = text.length + (hasAbstract ? 1500 : 0) + (hasReferences ? 800 : 0);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }

  if (!best || best.length < 300) return null;
  if (/^(Sage Journals: Discover world-class research|Just a moment)/i.test(title)) return null;
  if (/(IP you are accessing the site with .* has been blocked|Block reason:|Performing security verification|requires? CAPTCHA)/i.test(best)) return null;

  const header = [
    title ? `# ${title}` : "",
    [
      journal ? `Journal: ${journal}` : "",
      authors ? `Authors: ${authors}` : "",
      doi ? `DOI: ${doi}` : "",
      published ? `Published: ${published}` : "",
    ].filter(Boolean).join(" | "),
  ].filter(Boolean).join("\n");

  return {
    text: [header, best].filter(Boolean).join("\n\n"),
    meta: {
      ...meta,
      title: title || meta.title,
      author: authors || meta.author,
      published: published || meta.published,
      siteName: journal || meta.siteName,
      type: "scholarly_article",
    },
    structured: compactObject({
      type: "scholarly_article",
      publisher: "SAGE Journals",
      journal,
      title,
      authors,
      doi,
      published,
      canonical: meta.canonical,
    }),
  };
}

function doiFromSageUrl(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/doi\/(?:full\/|pdf\/|epub\/|abs\/)?(.+)$/i);
    return match ? decodeURIComponent(match[1]).replace(/\/+$/g, "") : "";
  } catch {
    return "";
  }
}

function cleanPmcArticleText(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    if (/^(Skip to main content|An official website of the United States government|Here'?s how you know|Official websites use \.gov|Secure \.gov websites use HTTPS|NCBI Literature Resources|MeSH PMC Bookshelf Disclaimer)$/i.test(normalized)) continue;
    if (/^(Find articles\b|Author information|Article notes|Copyright and License information|Associated Data|Supplementary Materials)$/i.test(normalized)) continue;
    if (/^(Corresponding author\.?|Correspondence:|Corresponding Author:)/i.test(normalized)) continue;
    if (/^(Received|Accepted|Published online)\s+\d{4}/i.test(normalized)) continue;
    if (/^(©|\(c\)|Copyright)\s+/i.test(normalized)) continue;
    if (/^This article is distributed under the terms of the Creative Commons/i.test(normalized)) continue;
    if (/^(Abstract|Plain language summary)$/.test(normalized) && out.some((item) => item === normalized)) continue;
    if (/^(Similar articles|Cited by|Publication types|MeSH terms|Related information|LinkOut - more resources|Full text links)$/i.test(normalized)) break;
    if (/^(Copy|Download|Share|Save|Email|Send to|Display options|Format|PubMed|PMC|Bookshelf|Search|Log in)$/i.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  const firstAbstract = out.findIndex((line) => /^(Abstract|Plain language summary)$/i.test(line));
  const trimmed = firstAbstract > 0 && firstAbstract < 30 ? out.slice(firstAbstract) : out;
  return trimmed.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractPmcArticleData(url, html, mode = "balanced", opts = {}) {
  const meta = extractMetadata(html);
  const title = findMetaContent(html, ["citation_title", "dc.Title", "og:title", "twitter:title"]) || meta.title || "";
  const journal = findMetaContent(html, ["citation_journal_title", "dc.Source"]) || meta.siteName || "PubMed Central";
  const doi = findMetaContent(html, ["citation_doi", "dc.Identifier"]).replace(/^doi:\s*/i, "");
  const published = findMetaContent(html, ["citation_publication_date", "dc.Date", "article:published_time"]) || meta.published;
  const authors = findMetaContents(html, ["citation_author", "dc.Creator"]).join(", ");
  const pmcid = findMetaContent(html, ["citation_pmcid"]) || new URL(url).pathname.match(/\/articles\/(PMC\d+)/i)?.[1] || "";

  const candidates = [
    findElementById(html, "main-content"),
    findElementById(html, "mc"),
    findElementByClass(html, "article"),
    findElementByClass(html, "jats-article"),
    findElementsByTagName(html, "article", 4)[0],
    findElementsByTagName(html, "main", 2)[0],
  ].filter(Boolean);

  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    const text = cleanPmcArticleText(htmlToText(candidate, mode, { include_links: opts.include_links !== false, base_url: url }));
    const score = text.length + (/\bAbstract\b/i.test(text) ? 1500 : 0) + (/\bReferences\b/i.test(text) ? 800 : 0);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  if (!best || best.length < 500) return null;

  const header = [
    title ? `# ${title}` : "",
    [
      journal ? `Journal: ${journal}` : "",
      authors ? `Authors: ${authors}` : "",
      doi ? `DOI: ${doi}` : "",
      pmcid ? `PMCID: ${pmcid}` : "",
      published ? `Published: ${published}` : "",
    ].filter(Boolean).join(" | "),
  ].filter(Boolean).join("\n");

  return {
    text: [header, best].filter(Boolean).join("\n\n"),
    meta: {
      ...meta,
      title: title || meta.title,
      author: authors || meta.author,
      published: published || meta.published,
      siteName: journal || meta.siteName,
      type: "scholarly_article",
    },
    structured: compactObject({
      type: "scholarly_article",
      publisher: "PubMed Central",
      journal,
      title,
      authors,
      doi,
      pmcid,
      published,
      canonical: meta.canonical || url,
    }),
  };
}

async function fetchSageViaPmc(url, mode, signal, opts = {}) {
  const doi = doiFromSageUrl(url);
  if (!doi) return null;
  const idUrl = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(doi)}&format=json&tool=perplexity-mcp`;
  const idRes = await fetch(idUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": `perplexity-mcp/${VERSION}`,
    },
    signal,
  });
  if (!idRes.ok) return null;
  const idData = await idRes.json();
  const pmcid = idData?.records?.find((record) => record.pmcid)?.pmcid;
  if (!pmcid) return null;

  const pmcUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${encodeURIComponent(pmcid)}/`;
  const res = await fetch(pmcUrl, {
    headers: {
      "User-Agent": `perplexity-mcp/${VERSION}`,
      "Accept-Language": "en-US,en;q=0.95,ko;q=0.7",
    },
    signal,
  });
  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length") || "";
  if (!isTextualResponse(res.url || pmcUrl, contentType)) return null;
  const html = await readTextResponse(res, contentType);
  const article = extractPmcArticleData(res.url || pmcUrl, html, mode, opts);
  if (!article) return null;
  return {
    ...article,
    html,
    status: res.status,
    finalUrl: res.url || pmcUrl,
    contentType,
    contentLength,
  };
}

function sourceForgePageTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const title = parts.slice(3).join("/");
    return title ? decodeURIComponent(title.replace(/\/+$/g, "")) : parts[2] || "SourceForge wiki";
  } catch {
    return "SourceForge wiki";
  }
}

function sourceForgePageUrl(baseUrl, pageTitle) {
  try {
    const u = new URL(baseUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 3 || parts[0] !== "p") return "";
    u.pathname = `/${parts.slice(0, 3).map(encodeURIComponent).join("/")}/${encodeURIComponent(pageTitle)}/`;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function extractSourceForgeAlluraData(url, data, mode = "balanced", opts = {}) {
  const title = data?.title || sourceForgePageTitleFromUrl(url);
  const modified = data?.mod_date || "";
  const discussionThreadUrl = data?.discussion_thread_url || "";
  let body = "";

  if (typeof data?.text === "string" && data.text.trim()) {
    const markdown = data.text.replace(/^\s*\[TOC\]\s*$/gmi, "");
    body = cleanMarkdownText(markdown, mode, {
      include_links: opts.include_links !== false,
      base_url: url,
    });
  } else if (Array.isArray(data?.pages)) {
    body = data.pages
      .map((page) => {
        const pageUrl = sourceForgePageUrl(url, page);
        return pageUrl && opts.include_links !== false ? `- ${markdownLink(page, pageUrl)}` : `- ${page}`;
      })
      .join("\n");
  }

  if (!body || body.length < 20) return null;
  const header = [
    title ? `# ${title}` : "",
    [modified ? `Modified: ${modified}` : "", "Source: SourceForge Allura REST API"].filter(Boolean).join(" | "),
  ].filter(Boolean).join("\n");

  return {
    text: [header, body].filter(Boolean).join("\n\n"),
    meta: {
      title,
      modified,
      canonical: url,
      siteName: "SourceForge",
      type: "sourceforge_wiki_page",
    },
    structured: compactObject({
      type: "sourceforge_wiki_page",
      title,
      modified,
      canonical: url,
      discussion_thread_url: discussionThreadUrl,
      labels: Array.isArray(data?.labels) ? data.labels : undefined,
      attachments: Array.isArray(data?.attachments) ? data.attachments.map((a) => a?.url || a?.filename || a?.name).filter(Boolean) : undefined,
      page_count: Array.isArray(data?.pages) ? data.pages.length : undefined,
    }),
  };
}

async function fetchSourceForgeAllura(url, mode, signal, opts = {}) {
  const restUrl = buildSourceForgeRestUrl(url);
  if (!restUrl) return null;
  const res = await fetch(restUrl, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.95,ko;q=0.7",
      "User-Agent": `perplexity-mcp/${VERSION} SourceForge Allura REST fetch`,
    },
    redirect: "follow",
    signal,
  });
  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length") || "";
  const raw = await res.text();
  if (!res.ok || !/json/i.test(contentType)) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const page = extractSourceForgeAlluraData(url, data, mode, opts);
  if (!page) return null;
  return {
    ...page,
    html: raw,
    status: res.status,
    finalUrl: url,
    restUrl: res.url || restUrl,
    contentType,
    contentLength,
  };
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return out;
  }
  if (typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
  }
  return out;
}

function jsonLdTypeMatches(value, re) {
  const type = value?.["@type"] || value?.type;
  if (Array.isArray(type)) return type.some((item) => re.test(String(item)));
  return re.test(String(type || ""));
}

function normalizeNewsAuthor(author) {
  if (!author) return "";
  if (typeof author === "string") return cleanText(author, "strict");
  if (Array.isArray(author)) return author.map(normalizeNewsAuthor).filter(Boolean).join(", ");
  if (typeof author === "object") return cleanText(author.name || author.alternateName || "", "strict");
  return "";
}

function plainNewsText(value, mode = "balanced", opts = {}) {
  const raw = String(value || "");
  if (!raw) return "";
  return /<[^>]+>/.test(raw) ? htmlToText(raw, mode, opts) : cleanText(decodeEntities(raw), mode);
}

function extractNewsJsonLdData(html, mode = "balanced", opts = {}) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    let parsed;
    const raw = script[1].trim();
    try {
      parsed = JSON.parse(raw);
    } catch {
      try { parsed = JSON.parse(decodeEntities(raw)); } catch { continue; }
    }
    const nodes = flattenJsonLd(parsed);
    const articleCandidates = nodes.filter((node) => jsonLdTypeMatches(node, /^(NewsArticle|Article|ReportageNewsArticle|LiveBlogPosting)$/i))
      .concat(nodes.filter((node) => node.headline || node.articleBody || node.text));
    const article = articleCandidates
      .filter((node, index, self) => self.indexOf(node) === index)
      .sort((a, b) => plainNewsText(b.articleBody || b.text || "", mode, opts).length - plainNewsText(a.articleBody || a.text || "", mode, opts).length)[0];
    if (!article) continue;

    const body = plainNewsText(article.articleBody || article.text || "", mode, opts);
    return {
      title: plainNewsText(article.headline || article.name || "", "strict"),
      description: plainNewsText(article.description || "", "balanced"),
      author: normalizeNewsAuthor(article.author),
      published: article.datePublished || article.dateCreated || "",
      modified: article.dateModified || "",
      section: plainNewsText(article.articleSection || "", "strict"),
      site: normalizeNewsAuthor(article.publisher) || "",
      body,
    };
  }
  return null;
}

function extractChosunFusionData(html, mode = "balanced", opts = {}) {
  const match = html.match(/Fusion\.globalContent\s*=\s*({[\s\S]*?});\s*Fusion\.globalContentConfig=/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const parts = [];
  const appendElement = (element) => {
    if (!element || typeof element !== "object") return;
    if (["text", "header", "subhead"].includes(element.type) && element.content) {
      parts.push(plainNewsText(element.content, mode, opts));
    } else if (element.type === "list" && Array.isArray(element.items)) {
      for (const item of element.items) {
        if (typeof item === "string") parts.push(plainNewsText(item, mode, opts));
        else appendElement(item);
      }
    } else if (element.type === "quote" && element.content) {
      parts.push(plainNewsText(element.content, mode, opts));
    }
  };
  for (const element of data.content_elements || []) appendElement(element);

  const subheadline = plainNewsText(data.subheadlines?.basic || "", "balanced");
  const body = cleanNewsText([subheadline, ...parts].filter(Boolean).join("\n\n"));
  if (!body) return null;

  return {
    title: plainNewsText(data.headlines?.basic || "", "strict"),
    description: plainNewsText(data.description?.basic || "", "balanced"),
    author: normalizeNewsAuthor(data.credits?.by),
    published: data.first_publish_date || data.display_date || "",
    modified: data.last_updated_date || "",
    section: plainNewsText(data.taxonomy?.primary_section?.name || "", "strict"),
    site: data.distributor?.name || "Chosun",
    body,
  };
}

const NEWS_BODY_ATTR_RE = /(article[-_\s]?(body|content|text|view|main)|story[-_\s]?(body|content|text)|news[-_\s]?(body|content|view|text|article)|view[-_\s]?(body|content|article|text)|post[-_\s]?(body|content)|entry[-_\s]?content|articlebody|article_body|articlebodycontents|article_txt|article-text|article_content|articleview|news_view|view_cont|view_con|cont_view|read_body|news_end|newsct_article|dic_area|article_area|art_body|articlecopy|article__content|caas-body)/i;
const NEWS_BOILERPLATE_ATTR_RE = /(?:^|[\s_-])(ad|ads|advert|advertisement|banner|share|sns|social|comment|comments|reply|recommend|recommended|related|newsletter|subscribe|popular|ranking|mostread|most-read|toolbar|toolbox|font|print|email|login|paywall|cookie|breadcrumb|nav|footer|header|aside|popup|modal|promotion|promo|outbrain|taboola|video|photo|caption|byline|author-card)(?:$|[\s_-])/i;

function isNewsBoilerplateLine(line) {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  return (
    /^(share|save|print|email|copy link|copied|listen|follow|subscribe|sign in|sign up|log in|login|menu|search|comments?|more|read more|show more|close)$/i.test(normalized) ||
    /^(facebook|twitter|x|threads|linkedin|whatsapp|telegram|reddit|kakao|line|pinterest)$/i.test(normalized) ||
    /^(advertisement|advertising|sponsored|promotion|promoted|ad|ads|ADVERTISEMENT)$/i.test(normalized) ||
    /^(related articles?|recommended|most read|popular|latest news|top stories|editor'?s picks?|more from|around the web)$/i.test(normalized) ||
    /^this article is more than\b/i.test(normalized) ||
    /^(your browser does not support the audio element\.?|0:00|기사를 읽어드립니다)$/i.test(normalized) ||
    (/(기사를 읽어드립니다|your browser does not support the audio element)/i.test(normalized) && normalized.length < 180) ||
    /^(입력|수정|업데이트)\s+\d{4}[-.]\d{1,2}[-.]\d{1,2}/i.test(normalized) ||
    (/^[\p{L}\s,·.]+기자$/u.test(normalized) && normalized.length < 60) ||
    /^(카카오톡|페이스북|트위터|엑스|라인|밴드|URL 복사|주소 복사|링크 복사|공유|공유하기|기사공유|보내기|닫기|인쇄|프린트)$/i.test(normalized) ||
    /^(글자 ?크기|본문 ?글자 ?크기|폰트 ?크기|크게|작게|보통|전체메뉴|메뉴|검색|로그인|회원가입|구독|구독신청|댓글|댓글쓰기)$/i.test(normalized) ||
    /^(광고|광고문의|관련기사|추천기사|인기기사|많이 본 뉴스|최신뉴스|주요뉴스|포토뉴스|영상뉴스|오늘의 뉴스|이 시각 추천뉴스)$/i.test(normalized) ||
    /^(본문 바로가기|메인으로|상단으로|건너뛰기|모바일웹|PC버전|지면보기|기자페이지|기자 페이지)$/i.test(normalized) ||
    (/^(copyright|all rights reserved)\b/i.test(normalized) && normalized.length < 220) ||
    (/(무단 전재|무단전재|재배포 금지|전재 및 재배포 금지|저작권자|all rights reserved|copyright)/i.test(normalized) && normalized.length < 220) ||
    (/(newsletter|cookie|privacy policy|terms of service|sign up to|subscribe to|enable javascript)/i.test(normalized) && normalized.length < 220)
  );
}

function stripNewsBoilerplateHtml(html) {
  return stripBoilerplateElements(html, {
    attrPattern: NEWS_BOILERPLATE_ATTR_RE,
    keepTags: ARTICLE_CONTAINER_TAGS,
    noiseTagPattern: NEWS_NOISE_TAGS_RE,
    includeAriaLabel: true,
  });
}

function scoreNewsText(text) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const longLines = lines.filter((line) => line.length >= 45).length;
  const shortLines = lines.filter((line) => line.length <= 18).length;
  return longLines * 500 + Math.min(text.length, 20_000) - shortLines * 20;
}

function cleanNewsText(text) {
  if (!text) return "";
  const lines = String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/&hellip;/g, "...")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const drop = (line) => {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (isNewsBoilerplateLine(normalized)) return true;
    return (
      /^(카카오톡|페이스북|트위터|X|URL 복사|이메일|메일|밴드|공유|공유하기|닫기|인쇄|프린트)$/i.test(normalized) ||
      /^(보기 설정|글자 크기|글자크기|글자크기 설정|컬러 모드|라이트|다크|베이지|그린|보통|크게|아주 크게)$/i.test(normalized) ||
      /^(본문 바로가기|본문 요약|ADVERTISEMENT|AD|광고|기사 스크랩|댓글|로그인|회원가입|구독하기|읽는 중)$/i.test(normalized) ||
      /^구글 검색 선호 출처로 추가$/i.test(normalized) ||
      /^Google 검색에서 .*기사를 더 자주 볼 수 있습니다\.?$/i.test(normalized) ||
      /^글자크기 설정 시 다른 기사의 본문도/i.test(normalized) ||
      /^\d+단계$/.test(normalized) ||
      /^중앙일보 지면보기 서비스는$/i.test(normalized) ||
      /^로그인 (후 이용 가능합니다|하시면|하시겠습니까)/i.test(normalized) ||
      /^최근 1개월 내$/i.test(normalized) ||
      /^지면만 열람하실 수 있습니다\.?$/i.test(normalized) ||
      /^무단 전재 및 재배포 금지/i.test(normalized) ||
      /^Copyright\b/i.test(normalized) ||
      /^기자 페이지$/i.test(normalized) ||
      /^좋아요\s*\d*$/i.test(normalized)
    );
  };

  return lines
    .filter((line) => !drop(line))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractNewsHtmlBody(html, mode = "balanced", opts = {}) {
  const candidates = [
    findElementById(html, "articleBody"),
    findElementById(html, "artCont"),
    findElementById(html, "articletxt"),
    findElementById(html, "article_body"),
    findElementByClass(html, "article_body"),
    findElementByClass(html, "article-body"),
    findElementByClass(html, "article_txt"),
    findElementByClass(html, "article-content"),
    findElementByClass(html, "article_content"),
    findElementByClass(html, "news_view"),
    findElementByClass(html, "view_cont"),
    ...findElementsByAttributePattern(html, "id", NEWS_BODY_ATTR_RE),
    ...findElementsByAttributePattern(html, "class", NEWS_BODY_ATTR_RE),
    ...findElementsByTagName(html, "article"),
    ...findElementsByTagName(html, "main", 4),
  ];

  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = cleanNewsText(htmlToText(stripNewsBoilerplateHtml(candidate), mode, opts));
    const score = scoreNewsText(text);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}

function siteNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const source = findNewsSourceByHost(host);
    if (source?.site) return source.site;
    return host;
  } catch {
    return "";
  }
}

function normalizeNewsHeadlineForDedupe(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["'“”‘’()[\]{}.,:;!?|｜·…\s_-]+/g, "")
    .trim();
}

function dedupeNewsBodyAgainstTitle(body, title) {
  const normalizedTitle = normalizeNewsHeadlineForDedupe(title);
  if (!normalizedTitle || normalizedTitle.length < 8) return body;

  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let removed = 0;
  const filtered = lines.filter((line, index) => {
    if (index > 8 || removed >= 2) return true;
    if (normalizeNewsHeadlineForDedupe(line.replace(/^본문\s+/, "")) !== normalizedTitle) return true;
    removed++;
    return false;
  });
  return filtered.join("\n\n");
}

function extractNewsArticleData(url, html, mode = "balanced", opts = {}) {
  if (!isNewsUrl(url)) return null;
  const meta = extractMetadata(html);
  const linkOpts = { include_links: opts.include_links !== false, base_url: url };
  /** @type {Record<string, any>} */
  const jsonLd = extractNewsJsonLdData(html, mode, linkOpts) || {};
  /** @type {Record<string, any>} */
  const fusion = extractChosunFusionData(html, mode, linkOpts) || {};
  const htmlBody = extractNewsHtmlBody(html, mode, linkOpts);
  const title = fusion.title || jsonLd.title || meta.title || "";
  const body = cleanNewsText(dedupeNewsBodyAgainstTitle(fusion.body || jsonLd.body || htmlBody, title));
  if (!body || body.length < 80) return null;

  const description = fusion.description || jsonLd.description || meta.description || "";
  const author = fusion.author || jsonLd.author || meta.author || "";
  const published = fusion.published || jsonLd.published || meta.published || "";
  const modified = fusion.modified || jsonLd.modified || meta.modified || "";
  const site = fusion.site || jsonLd.site || meta.siteName || siteNameFromUrl(url);
  const section = fusion.section || jsonLd.section || "";

  const header = [
    title ? `# ${title}` : "",
    [
      site ? `Site: ${site}` : "",
      section ? `Section: ${section}` : "",
      author ? `Author: ${author}` : "",
      published ? `Published: ${published}` : "",
      modified ? `Modified: ${modified}` : "",
    ].filter(Boolean).join(" | "),
    description && !body.includes(description.slice(0, 80)) ? `Summary: ${description}` : "",
  ].filter(Boolean).join("\n");

  return {
    text: [header, body].filter(Boolean).join("\n\n"),
    meta: {
      ...meta,
      title: title || meta.title,
      description: description || meta.description,
      author: author || meta.author,
      published: published || meta.published,
      modified: modified || meta.modified,
      siteName: site || meta.siteName,
      type: "news_article",
    },
    structured: compactObject({
      type: "news_article",
      site,
      section,
      title,
      author,
      published,
      modified,
      canonical: meta.canonical,
    }),
  };
}

// ── Site extractor registry ─────────────────────────────────────────
// Exactly one preset is active per fetch, so the old code — six ternaries
// producing six variables, then OR-chains over all of them for text, meta,
// structured and source — was five parallel copies of a single lookup. Adding
// a site meant editing all five, and missing one failed silently.
//
// "source" is the label reported back to the caller: it names the transport
// that produced the body, so presets served by an ordinary HTML fetch stay
// "direct" and only genuinely different paths get their own name.
const SITE_EXTRACTORS = {
  reddit: {
    source: "reddit-json",
    extract: (url, body, mode, opts) => extractRedditPostData(url, body, opts),
  },
  namu: {
    source: "direct",
    extract: (url, body, mode, opts) => extractNamuWikiData(url, body, mode, opts),
  },
  mediawiki: {
    source: "mediawiki",
    extract: (url, body, mode, opts) => extractMediaWikiArticleData(url, body, mode, opts),
  },
  sage: {
    source: "sage",
    extract: (url, body, mode, opts) => extractSageArticleData(url, body, mode, opts),
  },
  news: {
    source: "news",
    extract: (url, body, mode, opts) => extractNewsArticleData(url, body, mode, opts),
  },
  dcinside: {
    source: "direct",
    extract: (url, body, mode, opts) => extractDcinsideArticleData(url, body, mode, opts),
  },
};

// Run the extractor registered for this preset, if any.
function extractSitePage(url, html, preset, mode, opts) {
  const handler = SITE_EXTRACTORS[preset];
  if (!handler) return null;
  const page = handler.extract(url, html, mode, opts);
  return page ? { ...page, source: handler.source } : null;
}

function extractSiteStructuredData(url, html, text, meta, preset) {
  // Only reached when the preset's own extractor returned nothing, in which
  // case re-running that extractor here would return nothing either. Steam is
  // the exception: it has no text extractor, only structured fields lifted
  // off the page.
  return extractSteamStoreData(url, html, text, meta);
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

function extractSteamStoreData(url, html, text, meta) {
  if (resolveSitePreset(url, "auto") !== "steam") return null;
  const pick = (re) => {
    const match = html.match(re);
    return match ? cleanText(decodeEntities(match[1]), "strict") : "";
  };
  const tagMatches = [...html.matchAll(/<a[^>]+class=["'][^"']*app_tag[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => cleanText(fragmentToText(m[1]), "strict"))
    .filter(Boolean)
    .slice(0, 12);
  const appIdMatch = url.match(/\/app\/(\d+)/) || html.match(/steam_appid["']?\s*[:=]\s*["']?(\d+)/i);
  const matureNotice = pick(/<div[^>]+class=["'][^"']*(?:mature|agegate|content_descriptor)[^"']*["'][^>]*>([\s\S]{0,1200}?)<\/div>/i);

  return compactObject({
    type: "steam_store",
    app_id: appIdMatch?.[1] || "",
    name: pick(/<div[^>]+class=["']apphub_AppName["'][^>]*>([\s\S]*?)<\/div>/i) || meta.title,
    release_date: pick(/<div[^>]+class=["']date["'][^>]*>([\s\S]*?)<\/div>/i),
    price: pick(/<div[^>]+class=["'][^"']*(?:discount_final_price|game_purchase_price price)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i),
    discount: pick(/<div[^>]+class=["']discount_pct["'][^>]*>([\s\S]*?)<\/div>/i),
    recent_reviews: pick(/Recent Reviews:[\s\S]{0,500}?<span[^>]*>([\s\S]*?)<\/span>/i),
    all_reviews: pick(/All Reviews:[\s\S]{0,500}?<span[^>]*>([\s\S]*?)<\/span>/i),
    tags: tagMatches.length ? tagMatches : undefined,
    mature_content_notice: matureNotice,
  });
}

function metadataSummary(meta) {
  return compactObject({
    title: meta.title,
    description: meta.description,
    canonical: meta.canonical,
    author: meta.author,
    published: meta.published,
    modified: meta.modified,
    site: meta.siteName,
    type: meta.type,
  });
}

/** @param {{ result?: Record<string, any>, meta?: Record<string, any> }} [input] */
function assessDateSignals({ result, meta } = {}) {
  const published = result?.date || meta?.published || "";
  const updated = result?.last_updated || meta?.modified || "";
  if (published && updated && published !== updated) return `published=${published}; updated=${updated}; confidence=medium`;
  if (published || updated) return `date=${published || updated}; confidence=medium`;
  return "date=unknown; confidence=low";
}

function fetchCacheKey(url, opts) {
  const key = new URL("https://perplexity-mcp-cache.local/fetch");
  key.searchParams.set("v", VERSION);
  key.searchParams.set("url", url);
  key.searchParams.set("mode", normalizeCleaningMode(opts.cleaning_mode));
  key.searchParams.set("preset", resolveSitePreset(url, opts.site_preset || "auto"));
  key.searchParams.set("links", opts.include_links === false ? "0" : "1");
  key.searchParams.set("cmt", opts.include_comments === false ? "0" : "1");
  key.searchParams.set("img", opts.include_images ? `1x${Math.max(1, Math.min(Number(opts.max_images) || 4, 10))}` : "0");
  return new Request(key.toString(), { method: "GET" });
}

async function readFetchCache(url, opts) {
  if (opts.use_cache === false || typeof caches === "undefined") return null;
  try {
    const hit = await caches.default.match(fetchCacheKey(url, opts));
    if (!hit) return null;
    const cached = await hit.json();
    return {
      ...cached,
      warnings: [...(cached.warnings || []), "cache hit"],
      debugInfo: { ...(cached.debugInfo || {}), cache: "hit" },
    };
  } catch {
    return null;
  }
}

async function writeFetchCache(url, opts, result) {
  if (opts.use_cache === false || typeof caches === "undefined") return;
  if (!result.ok) return;
  try {
    const ttl = Math.max(30, Math.min(opts.cache_ttl_seconds ?? CACHE_TTL_SECONDS_DEFAULT, 3600));
    const cacheable = { ...result, html: undefined };
    await caches.default.put(
      fetchCacheKey(url, opts),
      new Response(JSON.stringify(cacheable), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${ttl}`,
        },
      })
    );
  } catch { /* cache is best-effort */ }
}

// The fields every degraded result echoes back from the last response we saw.
// Repeated verbatim in six payloads before this existed.
function lastResponseFields(last) {
  return {
    html: last.body,
    status: last.status,
    finalUrl: last.finalUrl,
    contentType: last.contentType,
    contentLength: last.contentLength,
  };
}

// Why the direct fetch did not produce a body. Same three-way choice was
// spelled out at each of the three degradation points.
function degradationCause(flags) {
  if (flags.steamAgeGate) return "steamAgeGate";
  if (flags.blocked) return "blocked";
  return "shell";
}

const DEGRADATION_TEXT = {
  agentFetch: {
    steamAgeGate: "[Steam 성인 연령 확인으로 직접 fetch 실패 → Perplexity fetch_url로 원문 수신 (비용 ~$0.003-0.008)]",
    blocked: "[봇 차단으로 직접 fetch 실패 → Perplexity fetch_url로 원문 수신 (비용 ~$0.003-0.008)]",
    shell: "[직접 fetch가 SPA 셸만 반환 → Perplexity fetch_url로 원문 수신 (비용 ~$0.003-0.008)]",
  },
  perplexity: {
    steamAgeGate: "[Steam 성인 연령 확인으로 직접 fetch 실패 → Perplexity site: 폴백 사용 (비용 ~$0.005)]",
    blocked: "[봇 차단으로 직접 fetch 실패 → Perplexity site: 폴백 사용 (비용 ~$0.005)]",
    shell: "[직접 fetch가 SPA 셸만 반환 → Perplexity site: 폴백 사용 (비용 ~$0.005)]",
  },
  metadata: {
    steamAgeGate: "[경고: Steam 성인 연령 확인 + Perplexity 폴백 실패, 메타데이터만 추출]",
    blocked: "[경고: 봇 차단 + Perplexity 폴백 실패, 메타데이터만 추출]",
    shell: "[경고: JS 렌더링 + Perplexity 폴백 실패, 메타데이터만 추출]",
  },
};

function failureText(flags, status) {
  switch (degradationCause(flags)) {
    case "steamAgeGate":
      return `[경고: Steam 성인 연령 확인 감지(HTTP ${status}) + Perplexity 폴백 실패, 본문 추출 실패]`;
    case "blocked":
      return `[경고: 봇 차단 감지(HTTP ${status}) + Perplexity 폴백 실패, 본문 추출 실패]`;
    default:
      return `[경고: 응답 본문 부족(HTTP ${status}) + Perplexity 폴백 실패]`;
  }
}

// SourceForge blocks its own HTML pages but leaves the Allura REST API open, so
// the wiki JSON is tried before any HTML attempt rather than after.
// Returns a result object, or null to fall through to the normal path.
async function trySourceForgeAlluraRest(url, opts, signal, warnings, debugInfo) {
  const restUrl = buildSourceForgeRestUrl(url);
  if (!restUrl) return null;
  try {
    const page = await fetchSourceForgeAllura(url, opts.cleaning_mode, signal, opts);
    if (!page) return null;
    warnings.push("SourceForge HTML page is bot-blocked; fetched Allura REST wiki JSON instead");
    debugInfo.attempts.push({
      ua: 1,
      url: page.restUrl || restUrl,
      urlKind: "sourceforge-allura-rest",
      status: page.status,
      finalUrl: page.finalUrl || url,
      contentType: page.contentType,
      contentLength: page.contentLength,
      bodyChars: page.html?.length || 0,
    });
    return {
      ok: true,
      text: page.text,
      html: page.html,
      status: page.status,
      attempt: 1,
      attempt_total: 1,
      warnings,
      source: "sourceforge-allura",
      meta: page.meta,
      finalUrl: page.finalUrl,
      contentType: page.contentType,
      contentLength: page.contentLength,
      structured: page.structured,
    };
  } catch (err) {
    warnings.push(`SourceForge Allura REST fallback failed: ${String(err).slice(0, 200)}`);
    return null;
  }
}

// SAGE articles that are open access are mirrored on PubMed Central, reachable
// by DOI when the publisher blocks us. Tried after the direct attempts fail.
async function trySagePmcMirror(url, opts, signal, warnings, attemptTotal) {
  try {
    const article = await fetchSageViaPmc(url, opts.cleaning_mode, signal, opts);
    if (!article) return null;
    warnings.push("SAGE direct fetch blocked; fetched PubMed Central open-access mirror by DOI");
    return {
      ok: true,
      text: article.text,
      html: article.html,
      status: article.status,
      attempt: attemptTotal + 1,
      warnings,
      partial: true,
      source: "sage-pmc",
      meta: article.meta,
      finalUrl: article.finalUrl,
      contentType: article.contentType,
      contentLength: article.contentLength,
      structured: article.structured,
    };
  } catch (err) {
    warnings.push(`SAGE PMC fallback failed: ${String(err).slice(0, 200)}`);
    return null;
  }
}

// Both remote paths, in order. fetch_url is an EXTRA step in front of our own
// search fallback, never a replacement for it: whatever fetch_url does —
// refuse, error, or time out — the search fallback still gets its turn, because
// a robots-disallowed page is usually still indexed and searchable.
// Returns { text, source } or null.
async function fetchRemoteBody(url, maxChars, apiKey, warnings) {
  if (!apiKey) return null;

  try {
    const agent = await fetchViaAgentUrlTool(url, maxChars, apiKey);
    if (agent.text) return { text: agent.text, source: "agent-fetch-url" };
    if (agent.reason) warnings.push(`Perplexity fetch_url 실패: ${agent.reason}`);
  } catch (err) {
    warnings.push(`Perplexity fetch_url 오류: ${String(err).slice(0, 160)}`);
  }

  // Always reached, whatever happened above.
  try {
    const searched = await fetchViaPerplexity(url, maxChars, apiKey);
    if (searched) return { text: searched, source: "perplexity" };
  } catch (err) {
    warnings.push(`Perplexity 검색 폴백 실패: ${String(err).slice(0, 160)}`);
  }
  return null;
}

// Every direct attempt is spent. Walk the remaining ladder — document handling,
// the paid Perplexity site: fallback, page metadata — and return whatever still
// carries information, rather than nothing at all. Caller applies finish().
async function resolveExhaustedFetch({ url, apiKey, opts, warnings, attemptTotal, last, flags }) {
  if (flags.document) {
    const remote = await fetchRemoteBody(url, FETCH_MAX_CHARS_LIMIT, apiKey, warnings);
    if (remote) {
      return {
        ok: true,
        text: `[Document URL detected: direct binary parsing is not available in this Worker. Perplexity fallback was used.]\n\n${remote.text}`.slice(0, FETCH_MAX_CHARS_LIMIT),
        attempt: attemptTotal + 1,
        warnings,
        partial: true,
        source: `document-${remote.source}`,
        meta: {},
        ...lastResponseFields(last),
      };
    }
    return {
      ok: false,
      text: `[Document URL detected (${last.contentType || "unknown content type"}). Direct binary parsing is not available in this Worker, and Perplexity fallback did not return usable text.]`,
      attempt: attemptTotal,
      warnings,
      partial: true,
      source: "document",
      meta: {},
      ...lastResponseFields(last),
    };
  }

  // Compute meta once; both remaining paths and the tool handler reuse it.
  const meta = last.body ? extractMetadata(last.body) : {};
  const metaText = last.body
    ? [meta.title && `# ${meta.title}`, meta.description, meta.jsonLd, meta.noscript]
        .filter(Boolean).join("\n\n").trim()
    : "";
  const cause = degradationCause(flags);

  // Paid, but works on Cloudflare-protected SPAs that pre-render for no UA.
  const remote = await fetchRemoteBody(url, FETCH_MAX_CHARS_LIMIT, apiKey, warnings);
  if (remote) {
    return {
      ok: true,
      text: `${DEGRADATION_TEXT[remote.source === "agent-fetch-url" ? "agentFetch" : "perplexity"][cause]}\n\n${remote.text}`.slice(0, FETCH_MAX_CHARS_LIMIT),
      attempt: attemptTotal + 1,
      warnings,
      partial: true,
      source: remote.source,
      meta,
      ...lastResponseFields(last),
    };
  }

  if (metaText) {
    return {
      ok: true,
      text: `${DEGRADATION_TEXT.metadata[cause]}\n\n${cleanText(metaText, opts.cleaning_mode)}`,
      attempt: attemptTotal,
      warnings,
      partial: true,
      source: "metadata",
      meta,
      ...lastResponseFields(last),
    };
  }

  return {
    ok: false,
    text: failureText(flags, last.status),
    attempt: attemptTotal,
    warnings,
    partial: true,
    source: "none",
    meta,
    ...lastResponseFields(last),
  };
}

async function fetchPageWithFallbacks(url, apiKey, opts = {}) {
  const normalizedOpts = {
    cleaning_mode: normalizeCleaningMode(opts.cleaning_mode),
    site_preset: resolveSitePreset(url, opts.site_preset || "auto"),
    include_links: opts.include_links !== false,
    include_comments: opts.include_comments !== false,
    include_images: !!opts.include_images,
    max_images: opts.max_images,
    use_cache: opts.use_cache !== false,
    cache_ttl_seconds: opts.cache_ttl_seconds ?? CACHE_TTL_SECONDS_DEFAULT,
    debug: !!opts.debug,
  };
  const cached = await readFetchCache(url, normalizedOpts);
  if (cached) return cached;

  const overallController = new AbortController();
  const overallTimer = setTimeout(() => overallController.abort(), FETCH_TOTAL_BUDGET_MS);

  let lastStatus = 0;
  let lastBody = "";
  let lastFinalUrl = url;
  let lastContentType = "";
  let lastContentLength = "";
  let blockedSeen = false;
  let steamAgeGateSeen = false;
  let documentSeen = false;
  const warnings = [];
  const cookieJar = new Map();
  const debugInfo = {
    requestedUrl: url,
    finalUrl: url,
    cleaningMode: normalizedOpts.cleaning_mode,
    sitePreset: normalizedOpts.site_preset,
    cache: "miss",
    attempts: [],
    clientRedirects: [],
  };
  applySitePresetCookies(cookieJar, normalizedOpts.site_preset);
  const userAgents = userAgentsForSitePreset(normalizedOpts.site_preset);

  const finish = async (result) => {
    const enriched = {
      ...result,
      attempt_total: result.attempt_total || userAgents.length,
      debugInfo: {
        ...debugInfo,
        finalUrl: result.finalUrl || debugInfo.finalUrl || lastFinalUrl,
        rawChars: result.html ? result.html.length : lastBody.length,
        cleanedChars: (result.text || "").length,
        contentType: result.contentType || lastContentType || "",
        contentLength: result.contentLength || lastContentLength || "",
      },
    };
    await writeFetchCache(url, normalizedOpts, enriched);
    return enriched;
  };

  try {
    if (normalizedOpts.site_preset === "sourceforge") {
      const page = await trySourceForgeAlluraRest(url, normalizedOpts, overallController.signal, warnings, debugInfo);
      if (page) return finish(page);
    }

    for (let i = 0; i < userAgents.length; i++) {
      if (overallController.signal.aborted) break;

      const attemptController = new AbortController();
      const attemptTimer = setTimeout(() => attemptController.abort(), FETCH_PER_ATTEMPT_MS);
      const composite = new AbortController();
      const onAbort = () => composite.abort();
      overallController.signal.addEventListener("abort", onAbort);
      attemptController.signal.addEventListener("abort", onAbort);

      const attemptTarget = fetchUrlForAttempt(url, normalizedOpts.site_preset, i);
      let status = 0, body = "", finalUrl = attemptTarget.url, contentType = "", contentLength = "";
      try {
        ({ status, body, finalUrl, contentType, contentLength } = await fetchOnce(attemptTarget.url, userAgents[i], composite.signal, cookieJar, normalizedOpts.site_preset));
        let redirectCount = 0;
        while (status >= 200 && status < 300 && body && redirectCount < CLIENT_REDIRECT_LIMIT) {
          const clientRedirect = extractClientRedirect(finalUrl, body);
          if (!clientRedirect) break;
          if (!shouldFollowClientRedirect(finalUrl, clientRedirect.url, normalizedOpts.site_preset)) {
            blockedSeen = true;
            warnings.push(`UA #${i + 1}: ignored ${clientRedirect.kind} to ${clientRedirect.url}`);
            debugInfo.clientRedirects.push({ from: finalUrl, to: clientRedirect.url, kind: `ignored-${clientRedirect.kind}` });
            break;
          }
          warnings.push(`UA #${i + 1}: followed ${clientRedirect.kind} to ${clientRedirect.url}`);
          debugInfo.clientRedirects.push({ from: finalUrl, to: clientRedirect.url, kind: clientRedirect.kind });
          ({ status, body, finalUrl, contentType, contentLength } = await fetchOnce(clientRedirect.url, userAgents[i], composite.signal, cookieJar, normalizedOpts.site_preset));
          redirectCount++;
        }
      } catch (err) {
        warnings.push(`UA #${i + 1} 실패: ${err && err.name === "AbortError" ? "timeout" : String(err).slice(0, 120)}`);
      } finally {
        clearTimeout(attemptTimer);
        overallController.signal.removeEventListener("abort", onAbort);
        attemptController.signal.removeEventListener("abort", onAbort);
      }

      lastStatus = status;
      lastBody = body;
      lastFinalUrl = finalUrl || url;
      lastContentType = contentType;
      lastContentLength = contentLength;
      debugInfo.finalUrl = lastFinalUrl;
      debugInfo.attempts.push({
        ua: i + 1,
        url: attemptTarget.url,
        urlKind: attemptTarget.kind,
        status,
        finalUrl: lastFinalUrl,
        contentType,
        contentLength,
        bodyChars: body.length,
      });

      if (status >= 200 && status < 300 && isDocumentResponse(lastFinalUrl, contentType)) {
        documentSeen = true;
        warnings.push(`UA #${i + 1}: document response detected (${contentType || "by URL extension"})`);
        break;
      }

      if (looksSteamAgeGate(lastFinalUrl, body)) {
        steamAgeGateSeen = true;
        const steamController = new AbortController();
        const steamTimer = setTimeout(() => steamController.abort(), FETCH_PER_ATTEMPT_MS);
        const steamComposite = new AbortController();
        const onSteamAbort = () => steamComposite.abort();
        overallController.signal.addEventListener("abort", onSteamAbort);
        steamController.signal.addEventListener("abort", onSteamAbort);
        try {
          const submitted = await submitSteamAgeCheck(url, lastFinalUrl, body, userAgents[i], steamComposite.signal, cookieJar);
          if (submitted) {
            warnings.push(`UA #${i + 1}: Steam 성인 연령 확인 자동 제출 (${submitted.label})`);
            status = submitted.status;
            body = submitted.body;
            finalUrl = submitted.finalUrl || lastFinalUrl;
            lastStatus = status;
            lastBody = body;
            lastFinalUrl = finalUrl;
          }
        } catch (err) {
          warnings.push(`UA #${i + 1}: Steam 성인 연령 확인 실패: ${err && err.name === "AbortError" ? "timeout" : String(err).slice(0, 120)}`);
        } finally {
          clearTimeout(steamTimer);
          overallController.signal.removeEventListener("abort", onSteamAbort);
          steamController.signal.removeEventListener("abort", onSteamAbort);
        }
      }

      if (looksSteamAgeGate(lastFinalUrl, body)) {
        steamAgeGateSeen = true;
        continue;
      }

      if (normalizedOpts.site_preset === "sage" && body) {
        const sageArticle = extractSageArticleData(lastFinalUrl, body, normalizedOpts.cleaning_mode, normalizedOpts);
        if (sageArticle) {
          if (status >= 400) warnings.push(`UA #${i + 1}: extracted SAGE article body despite HTTP ${status}`);
          return finish({
            ok: true,
            text: sageArticle.text,
            html: body,
            status,
            attempt: i + 1,
            warnings,
            source: "sage",
            meta: sageArticle.meta,
            finalUrl: lastFinalUrl,
            contentType,
            contentLength,
            structured: sageArticle.structured,
          });
        }
      }

      if (looksBlocked(status, body, lastFinalUrl)) {
        blockedSeen = true;
        const challengeController = new AbortController();
        const challengeTimer = setTimeout(() => challengeController.abort(), FETCH_PER_ATTEMPT_MS);
        const challengeComposite = new AbortController();
        const onChallengeAbort = () => challengeComposite.abort();
        overallController.signal.addEventListener("abort", onChallengeAbort);
        challengeController.signal.addEventListener("abort", onChallengeAbort);
        try {
          const submitted = await submitSimpleChallenge(lastFinalUrl, body, userAgents[i], challengeComposite.signal, cookieJar);
          if (submitted) {
            warnings.push(`UA #${i + 1}: 단순 확인 버튼 자동 제출 (${submitted.label})`);
            status = submitted.status;
            body = submitted.body;
            finalUrl = submitted.finalUrl || lastFinalUrl;
            lastStatus = status;
            lastBody = body;
            lastFinalUrl = finalUrl;
          }
        } catch (err) {
          warnings.push(`UA #${i + 1}: 단순 확인 버튼 제출 실패: ${err && err.name === "AbortError" ? "timeout" : String(err).slice(0, 120)}`);
        } finally {
          clearTimeout(challengeTimer);
          overallController.signal.removeEventListener("abort", onChallengeAbort);
          challengeController.signal.removeEventListener("abort", onChallengeAbort);
        }
      }

      if (looksBlocked(status, body, lastFinalUrl)) {
        blockedSeen = true;
        continue;
      }

      if (looksSteamAgeGate(lastFinalUrl, body)) {
        steamAgeGateSeen = true;
        continue;
      }

      if (status >= 200 && status < 300 && body) {
        const sitePage = extractSitePage(
          lastFinalUrl,
          body,
          normalizedOpts.site_preset,
          normalizedOpts.cleaning_mode,
          normalizedOpts
        );
        // DCinside comments are XHR-loaded. Fetch them for any DCinside post,
        // independent of whether article-body extraction succeeded (image-only
        // posts often yield no article body but still have a comment thread).
        let dcComments = null;
        if (normalizedOpts.site_preset === "dcinside" && normalizedOpts.include_comments) {
          try {
            dcComments = await fetchDcinsideComments(url, body, cookieJar, overallController.signal, normalizedOpts);
          } catch (err) {
            warnings.push(`디시 댓글 로드 실패: ${String(err).slice(0, 160)}`);
          }
        }
        let text = sitePage?.text
          || htmlToText(body, normalizedOpts.cleaning_mode, { include_links: normalizedOpts.include_links, base_url: lastFinalUrl });
        if (dcComments) {
          const commentBlock = formatDcinsideComments(dcComments);
          if (commentBlock) text = `${text}\n\n${commentBlock}`;
        }
        if (sitePage || dcComments || hasMeaningfulHtmlContent(body, text)) {
          // Extract meta once here so the tool handler can reuse it.
          const meta = sitePage?.meta || extractMetadata(body);
          // Extractors that report no meta of their own (namu, dcinside) still
          // carry these fields in structured output; fill the gaps.
          for (const field of ["title", "author", "published"]) {
            if (!meta[field] && sitePage?.structured?.[field]) meta[field] = sitePage.structured[field];
          }
          let structured = sitePage?.structured
            || extractSiteStructuredData(lastFinalUrl, body, text, meta, normalizedOpts.site_preset);
          if (dcComments) {
            structured = { ...(structured || {}), comment_count: dcComments.total, comments: dcComments.items };
          }
          return finish({
            ok: true,
            text,
            html: body,
            status,
            attempt: i + 1,
            warnings,
            source: sitePage?.source || "direct",
            meta,
            finalUrl: lastFinalUrl,
            contentType,
            contentLength,
            structured,
            imageUrls: normalizedOpts.include_images ? selectContentImageUrls(body, lastFinalUrl, normalizedOpts) : undefined,
          });
        }
        // SPA shell — try next UA.
        continue;
      }
    }

    if (normalizedOpts.site_preset === "sage") {
      const article = await trySagePmcMirror(url, normalizedOpts, overallController.signal, warnings, userAgents.length);
      if (article) return finish(article);
    }

    // Every UA is spent, or every response was a shell. Hand off to the
    // fallback ladder; it decides between document handling, the paid
    // Perplexity fallback, page metadata, and outright failure.
    return finish(await resolveExhaustedFetch({
      url,
      apiKey,
      opts: normalizedOpts,
      warnings,
      attemptTotal: userAgents.length,
      last: {
        status: lastStatus,
        body: lastBody,
        finalUrl: lastFinalUrl,
        contentType: lastContentType,
        contentLength: lastContentLength,
      },
      flags: {
        blocked: blockedSeen,
        steamAgeGate: steamAgeGateSeen,
        document: documentSeen,
      },
    }));
  } finally {
    clearTimeout(overallTimer);
  }
}

// Perplexity-mediated fetch: site:domain + slug keywords with high max_tokens_per_page.
// Used as the final fallback when direct fetch fails on Cloudflare-protected SPAs.
// Tries narrowest query first (slug only), then progressively broader.
// The Perplexity fallback searches for the page instead of fetching it, so the
// result is only usable if it is the SAME document. Without this check a URL
// whose slug carries no meaning — namu.wiki/thread/FunnySulkySpuriousGate —
// returns whatever ranks first on that domain, presented as the requested page.
function sameDocument(requestedUrl, candidateUrl) {
  if (!candidateUrl) return false;
  try {
    const a = new URL(requestedUrl);
    const b = new URL(candidateUrl);
    // Accept language variants of the same site (en.namu.wiki vs namu.wiki).
    const registrable = (host) => host.replace(/^www\./, "").split(".").slice(-2).join(".");
    if (registrable(a.hostname) !== registrable(b.hostname)) return false;

    const path = (u) => decodeURIComponent(u.pathname).replace(/\/+$/, "").toLowerCase();
    if (path(a) !== path(b)) return false;

    // When the identity lives in the query string, it has to survive too.
    for (const [key, value] of a.searchParams) {
      if (b.searchParams.get(key) !== value) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Opaque identifiers (thread tokens, hashes, UUIDs) carry no searchable meaning,
// so a keyword search built from them can only return an unrelated page. Skip
// the paid call rather than pay for a result that will be rejected anyway.
function isOpaqueSlug(slug) {
  const token = String(slug || "").trim();
  if (token.includes(" ") || token.length < 12) return false;
  return (
    /^(?:[A-Z][a-z]{2,}){3,}$/.test(token) ||        // FunnySulkySpuriousGate
    /^[0-9a-f]{16,}$/i.test(token) ||                 // hex digest
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(token) ||       // uuid
    (/^[A-Za-z0-9_-]{16,}$/.test(token) && /[a-z]/.test(token) && /[A-Z0-9]/.test(token))
  );
}

// ── Agent API fetch_url fallback ────────────────────────────────────
// Perplexity's Agent API can fetch a URL from its own infrastructure and hand
// back the extracted body. Unlike the search fallback below it retrieves THE
// requested page rather than searching for something like it, and it returns
// the full text instead of a snippet.
//
// Measured 2026-08-02 (preset "fast" -> openai/gpt-5.4-mini):
//   blocked/robots-refused page  $0.0030   (no content)
//   SourceForge wiki, 2 KB body  $0.0025
//   Wikipedia article, 33 KB     $0.0073
// versus $0.005 for one Search API request. Cost is dominated by input tokens,
// so it scales with page size, not with a per-call premium.
const AGENT_ENDPOINT = "v1/agent";
const AGENT_PRESET = "fast";
// Measured 11-15 s per call, but a Worker colo saw one run past 30 s. This is
// an extra step in front of our own fallback, not a replacement for it, so it
// gets a bounded slice of the budget and hands over on expiry rather than
// spending the time that the search fallback still needs.
const AGENT_FETCH_TIMEOUT_MS = 20_000;
const SEARCH_FALLBACK_TIMEOUT_MS = 20_000;
// The tool reports failure as a sentence inside the snippet, not as an error.
const AGENT_NO_CONTENT_RE = /^\s*\[fetch_url:\s*no content could be retrieved/i;

async function fetchViaAgentUrlTool(url, maxChars, apiKey) {
  const response = await makeApiRequest(AGENT_ENDPOINT, {
    preset: AGENT_PRESET,
    // Keep the instruction short: the body text is read straight off the tool
    // result, so nothing is gained by having the model repeat it back.
    input: `Fetch ${url}. Reply with OK.`,
    tools: [{ type: "fetch_url", max_urls: 1 }],
  }, apiKey, AGENT_FETCH_TIMEOUT_MS);
  const data = await response.json();

  const item = (Array.isArray(data?.output) ? data.output : []).find((o) => o?.type === "fetch_url_results");
  const entry = Array.isArray(item?.contents) ? item.contents[0] : null;
  const snippet = entry?.snippet ? String(entry.snippet) : "";
  if (!snippet || AGENT_NO_CONTENT_RE.test(snippet)) {
    // robots disallow, upstream block, or an empty page — say why if we can.
    const reason = snippet.match(/—\s*([a-z_]+)\./i)?.[1] || "";
    return { text: null, reason };
  }
  // fetch_url is given our URL, but never assume: a redirect elsewhere is a
  // different document and must not be presented as this one.
  if (entry.url && !sameDocument(url, entry.url)) return { text: null, reason: "redirected" };

  const parts = [
    entry.title ? `# ${cleanText(entry.title)}` : "",
    `URL (Perplexity fetch_url): ${entry.url || url}`,
    "",
    cleanText(snippet),
  ].filter(Boolean);
  return { text: parts.join("\n").slice(0, maxChars), reason: "" };
}

async function fetchViaPerplexity(url, maxChars, apiKey) {
  let host, segments;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    segments = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }

  const slugify = (s) =>
    s
      .replace(/\.(html?|aspx?|php|jsp)$/i, "")
      .replace(/[_\-+]/g, " ")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")  // strip ISO dates
      .replace(/\b\d+\b/g, "")                // strip bare numbers
      .replace(/\s+/g, " ")
      .trim();

  // Build query candidates from narrowest (just deepest meaningful segment) to broadest.
  const candidates = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const slug = slugify(segments[i]);
    if (slug.length < 3) continue;
    // The deepest meaningful segment is what identifies the document. If that
    // is an opaque id, no broader segment can stand in for it — "thread" would
    // just search the route name — so the page is simply not searchable.
    if (candidates.length === 0 && isOpaqueSlug(slug)) return null;
    candidates.push(slug);
    if (candidates.length >= 2) break;  // try at most 2 narrowing levels
  }
  // Fallback to all path segments concatenated.
  if (candidates.length === 0) {
    candidates.push(segments.map(slugify).join(" ").slice(0, 120));
  }

  for (const keywords of candidates) {
    const query = keywords.slice(0, 200).trim();
    if (!query || isOpaqueSlug(query)) continue;
    try {
      // Use official search_domain_filter (allowlist for the host) instead of `site:` query operator.
      // Ask for several results: the requested document is not always ranked first.
      const response = await makeApiRequest("search", {
        query,
        max_results: 5,
        max_tokens_per_page: 2048,
        search_domain_filter: [host],
      }, apiKey, SEARCH_FALLBACK_TIMEOUT_MS);
      const data = await response.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      // Only the requested document will do. A near-miss on the same domain is
      // still the wrong page, and returning it would be worse than returning
      // nothing, because the caller has no way to tell.
      const r = results.find((item) => sameDocument(url, item?.url) && (item.snippet || item.title));
      if (r) {
        const parts = [
          r.title ? `# ${cleanText(r.title)}` : "",
          `URL (Perplexity-mediated): ${r.url || url}`,
          `Query used: ${query} (domain_filter: ${host})`,
          r.date ? `Date: ${r.date}` : "",
          "",
          r.snippet ? cleanText(r.snippet) : "",
        ].filter(Boolean);
        return parts.join("\n").slice(0, maxChars);
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

function paginateText(text, pageSize, requestedPage) {
  const totalChars = text.length;
  const totalPages = Math.max(1, Math.ceil(totalChars / pageSize));
  const page = Math.max(1, requestedPage || 1);
  const outOfRange = page > totalPages;
  const start = outOfRange ? totalChars : (page - 1) * pageSize;
  const end = outOfRange ? totalChars : Math.min(start + pageSize, totalChars);
  return {
    page,
    totalPages,
    totalChars,
    start,
    end,
    text: outOfRange ? "" : text.slice(start, end),
    hasNext: page < totalPages,
    outOfRange,
  };
}

// ── Perplexity /search ──────────────────────────────────────────────

async function makeApiRequest(endpoint, body, apiKey, timeoutMs = PERPLEXITY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.perplexity.ai/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": `perplexity-mcp/${VERSION}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let errorText;
      try { errorText = await res.text(); } catch { errorText = "Unable to parse error response"; }
      throw new Error(`Perplexity API error: ${res.status} ${res.statusText}\n${errorText}`);
    }
    return res;
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`Perplexity API timeout (${timeoutMs} ms).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function applySearchProfile(opts) {
  const { opts: autoOpts, notes: autoNotes } = applyAutoSearchSourcePreset(opts);
  const profile = autoOpts.source_profile || "general";
  const preset = SEARCH_PROFILE_DEFAULTS[profile];
  if (!preset) return { opts: autoOpts, notes: autoNotes };

  const out = { ...autoOpts };
  const notes = [...autoNotes, preset.note];
  if (!out.search_domain_filter?.length && preset.search_domain_filter) out.search_domain_filter = preset.search_domain_filter;
  if (!out.search_language_filter?.length && preset.search_language_filter) out.search_language_filter = preset.search_language_filter;
  if (!out.country && preset.country) out.country = preset.country;
  if (autoOpts.search_domain_filter?.length) notes.push("profile did not override existing search_domain_filter");
  return { opts: out, notes };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function newsAliasMatches(query, alias) {
  const rawAlias = String(alias || "").trim();
  if (!rawAlias) return false;
  const q = String(query || "");
  if (!q) return false;

  const asciiAlias = /^[a-z0-9][a-z0-9 .&'_-]*$/i.test(rawAlias);
  if (asciiAlias) {
    const escaped = escapeRegExp(rawAlias).replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(q);
  }
  return q.toLowerCase().includes(rawAlias.toLowerCase());
}

function detectAutoNewsSourcePreset(query) {
  let best = null;
  let bestAliasLength = 0;
  for (const source of NEWS_SOURCES) {
    const alias = source.aliases.find((candidate) => newsAliasMatches(query, candidate));
    if (!alias || alias.length <= bestAliasLength) continue;
    best = source;
    bestAliasLength = alias.length;
  }
  if (best) {
    return {
      name: `news:${best.site}`,
      domains: best.domains,
      languages: best.languages,
      country: best.country,
      note: `auto source preset: ${best.site} news domain`,
    };
  }
  return null;
}

function detectAutoSearchSourcePreset(query) {
  const q = String(query || "");
  return AUTO_SEARCH_SOURCE_PRESETS.find((preset) => preset.terms.some((re) => re.test(q)))
    || detectAutoNewsSourcePreset(q)
    || null;
}

function applyAutoSearchSourcePreset(opts) {
  if (opts.auto_source_profile === false) return { opts, notes: ["auto source preset disabled"] };
  const preset = detectAutoSearchSourcePreset(opts.query);
  if (!preset) return { opts, notes: [] };

  const out = { ...opts, auto_source_preset: preset.name };
  const notes = [preset.note];
  const hasExplicitProfile = !!(opts.source_profile && opts.source_profile !== "general");

  if (hasExplicitProfile) {
    notes.push("auto source preset did not override user-supplied source_profile");
    return { opts: out, notes };
  }

  if (!out.search_domain_filter?.length && preset.domains?.length) {
    out.search_domain_filter = preset.domains;
  } else if (preset.domains?.length) {
    notes.push("auto source preset did not override user-supplied search_domain_filter");
  }

  if (!out.search_language_filter?.length && preset.languages?.length) {
    out.search_language_filter = preset.languages;
  } else if (preset.languages?.length) {
    notes.push("auto source preset did not override user-supplied search_language_filter");
  }

  if (!out.country && preset.country) {
    out.country = preset.country;
  } else if (preset.country) {
    notes.push("auto source preset did not override user-supplied country");
  }

  return { opts: out, notes };
}

function searchAppliedFilters(opts) {
  const appliedFilters = [];
  if (opts.auto_source_preset) appliedFilters.push(`auto_source=${opts.auto_source_preset}`);
  if (opts.source_profile && opts.source_profile !== "general") appliedFilters.push(`profile=${opts.source_profile}`);
  if (opts.search_recency_filter) appliedFilters.push(`recency=${opts.search_recency_filter}`);
  if (opts.search_after_date_filter) appliedFilters.push(`after=${opts.search_after_date_filter}`);
  if (opts.search_before_date_filter) appliedFilters.push(`before=${opts.search_before_date_filter}`);
  if (opts.last_updated_after_filter) appliedFilters.push(`updated_after=${opts.last_updated_after_filter}`);
  if (opts.last_updated_before_filter) appliedFilters.push(`updated_before=${opts.last_updated_before_filter}`);
  if (opts.search_language_filter?.length) appliedFilters.push(`lang=[${opts.search_language_filter.join(",")}]`);
  if (opts.search_domain_filter?.length) appliedFilters.push(`domains=[${opts.search_domain_filter.join(",")}]`);
  if (opts.country) appliedFilters.push(`country=${opts.country}`);
  return appliedFilters;
}

function searchResultKey(result) {
  try {
    const u = new URL(result.url);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`.toLowerCase();
  } catch {
    return String(result.url || result.title || "").toLowerCase();
  }
}

function dedupeSearchResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const result of results || []) {
    const key = searchResultKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return { results: deduped, dropped: (results || []).length - deduped.length };
}

function scoreSearchResult(result, query) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter((term) => term.length >= 3).slice(0, 12);
  const haystack = `${result.title || ""} ${result.snippet || ""} ${result.url || ""}`.toLowerCase();
  let score = 0;
  for (const term of terms) if (haystack.includes(term)) score += 2;
  if (result.date) score += 1;
  if (result.last_updated) score += 1;
  if ((result.snippet || "").length > 120) score += 1;
  return score;
}

function suggestSearchAlternatives(opts) {
  const suggestions = [];
  const query = opts.query || "";
  if (!opts.search_domain_filter?.length) suggestions.push("Add search_domain_filter for the exact source family you want.");
  if (!opts.search_language_filter?.length && /[가-힣]/.test(query)) suggestions.push("Add search_language_filter: [\"ko\"] for Korean-only material.");
  if (!opts.search_recency_filter && !opts.search_after_date_filter && /\b(latest|recent|today|202[5-9]|최신|최근)\b/i.test(query)) {
    suggestions.push("Add search_recency_filter or explicit date filters for time-sensitive queries.");
  }
  if (query.length < 12) suggestions.push("Use more specific nouns, product names, model numbers, years, or exact communities.");
  return suggestions.slice(0, 4);
}

async function runSearch(opts, apiKey) {
  const { opts: profiledOpts, notes } = applySearchProfile(opts);
  const body = {
    query: profiledOpts.query,
    max_results: profiledOpts.max_results,
    max_tokens_per_page: profiledOpts.max_tokens_per_page,
    ...(profiledOpts.country && { country: profiledOpts.country }),
    ...(profiledOpts.search_recency_filter && { search_recency_filter: profiledOpts.search_recency_filter }),
    ...(profiledOpts.search_after_date_filter && { search_after_date_filter: profiledOpts.search_after_date_filter }),
    ...(profiledOpts.search_before_date_filter && { search_before_date_filter: profiledOpts.search_before_date_filter }),
    ...(profiledOpts.last_updated_after_filter && { last_updated_after_filter: profiledOpts.last_updated_after_filter }),
    ...(profiledOpts.last_updated_before_filter && { last_updated_before_filter: profiledOpts.last_updated_before_filter }),
    ...(profiledOpts.search_language_filter && profiledOpts.search_language_filter.length > 0 && { search_language_filter: profiledOpts.search_language_filter }),
    ...(profiledOpts.search_domain_filter && profiledOpts.search_domain_filter.length > 0 && { search_domain_filter: profiledOpts.search_domain_filter }),
  };
  const response = await makeApiRequest("search", body, apiKey);
  const data = await response.json();
  let results = Array.isArray(data.results) ? data.results : [];
  const rawCount = results.length;
  let dropped = 0;
  if (profiledOpts.dedupe !== false) {
    const deduped = dedupeSearchResults(results);
    results = deduped.results;
    dropped = deduped.dropped;
  }
  if (profiledOpts.rerank) {
    results = results
      .map((result, index) => ({ result, index, score: scoreSearchResult(result, profiledOpts.query) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ result }) => result);
  }
  return {
    query: profiledOpts.query,
    opts: profiledOpts,
    results,
    rawCount,
    dropped,
    profileNotes: notes,
    suggestions: results.length ? [] : suggestSearchAlternatives(profiledOpts),
  };
}

function formatSearchResults(search, { debug = false } = {}) {
  if (!search.results.length) {
    const suggestions = search.suggestions.length ? `\nTry next:\n- ${search.suggestions.join("\n- ")}` : "";
    return `No search results found for query: "${search.query}".${suggestions}`;
  }

  const appliedFilters = searchAppliedFilters(search.opts);
  let out = `Found ${search.results.length} results (query: "${search.query}"`;
  if (appliedFilters.length) out += `, filters: ${appliedFilters.join(" ")}`;
  out += "):\n";
  if (search.profileNotes.length) out += `Profile: ${search.profileNotes.join("; ")}\n`;
  if (search.dropped) out += `Deduplication: dropped ${search.dropped} duplicate result(s).\n`;
  out += "\n";

  search.results.forEach((r, i) => {
    const title = cleanText(r.title || "(untitled)", "strict");
    const snippet = r.snippet ? cleanText(r.snippet, "balanced") : "";
    out += `[${i + 1}] **${title}**\n   URL: ${r.url}\n`;
    if (snippet) out += `   Snippet: ${snippet}\n`;
    if (r.date) out += `   Date: ${r.date}\n`;
    if (r.last_updated) out += `   Last updated: ${r.last_updated}\n`;
    out += `   Date signal: ${assessDateSignals({ result: r })}\n`;
    if (debug) out += `   Debug key: ${searchResultKey(r)}\n`;
    out += "\n";
  });
  out += "Next step: call perplexity_fetch on the most relevant [N] URL. When citing, keep both the [N] marker and the URL.";
  return out;
}

async function performSearch(opts, apiKey) {
  const search = await runSearch(opts, apiKey);
  return formatSearchResults(search, { debug: opts.debug });
}

function structuredSearchResult(result, index) {
  return compactObject({
    index,
    title: cleanText(result.title || "(untitled)", "strict"),
    url: result.url || "",
    snippet: result.snippet ? cleanText(result.snippet, "balanced") : undefined,
    date: result.date || undefined,
    last_updated: result.last_updated || undefined,
    date_signal: assessDateSignals({ result }),
  });
}

function buildSearchStructured(search, text) {
  return {
    text,
    query: search.query,
    result_count: search.results.length,
    raw_count: search.rawCount,
    dropped_duplicates: search.dropped,
    profile_notes: search.profileNotes,
    suggestions: search.suggestions,
    results: search.results.map((result, i) => structuredSearchResult(result, i + 1)),
  };
}

function formatDebugBlock(debugInfo) {
  if (!debugInfo) return "";
  return [
    "Debug:",
    `  cache: ${debugInfo.cache || "n/a"}`,
    `  final_url: ${debugInfo.finalUrl || "n/a"}`,
    `  cleaning_mode: ${debugInfo.cleaningMode || "balanced"}`,
    `  site_preset: ${debugInfo.sitePreset || "auto"}`,
    `  content_type: ${debugInfo.contentType || "n/a"}`,
    `  raw_chars: ${debugInfo.rawChars ?? "n/a"}`,
    `  cleaned_chars: ${debugInfo.cleanedChars ?? "n/a"}`,
    debugInfo.clientRedirects?.length ? `  client_redirects: ${debugInfo.clientRedirects.map((r) => `${r.kind}:${r.to}`).join(" | ")}` : null,
    debugInfo.attempts?.length ? `  attempts: ${debugInfo.attempts.map((a) => `#${a.ua}${a.urlKind ? ` ${a.urlKind}` : ""} ${a.status} ${a.contentType || "unknown"} ${a.bodyChars} chars`).join(" | ")}` : null,
  ].filter(Boolean).join("\n");
}

function formatMetadataOnly(url, result, { debug = false } = {}) {
  const meta = metadataSummary(result.meta || {});
  const structured = result.structured ? `\nStructured data:\n${JSON.stringify(result.structured, null, 2)}` : "";
  const debugBlock = debug ? `\n\n${formatDebugBlock(result.debugInfo)}` : "";
  return [
    `URL: ${url}`,
    `HTTP: ${result.status || "n/a"}  source: ${result.source || "unknown"}`,
    `Date signal: ${assessDateSignals({ meta: result.meta || {} })}`,
    "",
    "Metadata:",
    JSON.stringify(meta, null, 2),
    structured,
    debugBlock,
  ].filter((part) => part !== "").join("\n");
}

function formatFetchResult(url, result, opts = {}) {
  if (opts.metadata_only) return formatMetadataOnly(url, result, opts);

  const cap = Math.min(opts.max_chars ?? FETCH_MAX_CHARS_DEFAULT, FETCH_MAX_CHARS_LIMIT);
  const requestedPage = opts.page ?? 1;
  const body = result.text || "";
  const pageInfo = paginateText(body, cap, requestedPage);
  const links = opts.include_links === false ? [] : extractLinksFromMarkdown(body, result.finalUrl || url);
  const range = pageInfo.totalChars === 0
    ? "0/0"
    : `${pageInfo.start + 1}-${pageInfo.end}/${pageInfo.totalChars}`;

  const meta = result.meta || {};
  const notes = (result.warnings || []).slice(-5).join(" | ");
  const structured = result.structured ? `Structured data:\n${JSON.stringify(result.structured, null, 2)}\n` : "";
  const linksBlock = links.length
    ? [
        `Links found (${links.length}; first ${Math.min(12, links.length)} shown):`,
        ...links.slice(0, 12).map((link, index) => `${index + 1}. ${markdownLink(link.text, link.url)}`),
        links.length > 12 ? `... ${links.length - 12} more links in structuredContent.result.links` : "",
        "",
      ].filter((line) => line !== "").join("\n")
    : "";
  const debugBlock = opts.debug ? `\n${formatDebugBlock(result.debugInfo)}\n` : "";
  const attemptTotal = result.attempt_total || userAgentsForSitePreset(resolveSitePreset(url, opts.site_preset || "auto")).length;
  const header = [
    `URL: ${url}`,
    result.finalUrl && result.finalUrl !== url ? `Final URL: ${result.finalUrl}` : null,
    `HTTP: ${result.status || "n/a"}  attempt #${result.attempt}/${attemptTotal}  source: ${result.source || "unknown"}`,
    `Page: ${pageInfo.page}/${pageInfo.totalPages}  chars: ${range}  page_size: ${cap}`,
    meta.title ? `Title: ${meta.title}` : null,
    `Date signal: ${assessDateSignals({ meta })}`,
    notes ? `Notes: ${notes}` : null,
    result.partial ? "Note: partial extract" : null,
    pageInfo.outOfRange ? `Note: requested page=${pageInfo.page} is beyond the last page (${pageInfo.totalPages}).` : null,
    pageInfo.hasNext ? `Next: call this tool again with the same url/max_chars and page=${pageInfo.page + 1}.` : null,
    opts.include_links === false ? "Links: disabled by include_links=false." : links.length ? `Links: ${links.length} extracted; inline Markdown links are preserved.` : "Links: none detected.",
    "Citation rule: if you use this content, cite the URL above.",
  ].filter(Boolean).join("\n");

  return `${header}\n\n${structured}${linksBlock}${pageInfo.text || "(empty body)"}${debugBlock}`;
}

async function fetchAndFormat(url, apiKey, opts = {}) {
  const result = await fetchPageWithFallbacks(url, apiKey, opts);
  let text = formatFetchResult(url, result, opts);
  let imageContent = [];
  if (opts.include_images && Array.isArray(result.imageUrls) && result.imageUrls.length) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_BUDGET_MS);
    try {
      const { blocks, notes } = await collectImageBlocks(result.imageUrls, result.finalUrl || url, controller.signal, opts);
      imageContent = blocks;
      if (blocks.length) {
        text += `\n\n[첨부 이미지 ${blocks.length}개 포함 — 멀티모달 모델이 직접 확인 가능${notes.length ? `; 일부 생략: ${notes.slice(0, 2).join(" | ")}` : ""}]`;
      } else if (notes.length) {
        text += `\n\n[이미지 첨부 실패: ${notes.slice(0, 3).join(" | ")}]`;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { result, text, imageContent };
}

function buildFetchStructured(url, result, text, opts = {}) {
  const body = result.text || "";
  const cap = Math.min(opts.max_chars ?? FETCH_MAX_CHARS_DEFAULT, FETCH_MAX_CHARS_LIMIT);
  const pageInfo = opts.metadata_only ? null : paginateText(body, cap, opts.page ?? 1);
  const links = opts.include_links === false ? [] : extractLinksFromMarkdown(body, result.finalUrl || url);
  const page = pageInfo ? {
    page: pageInfo.page,
    total_pages: pageInfo.totalPages,
    has_next: pageInfo.hasNext,
    start: pageInfo.start,
    end: pageInfo.end,
    total_chars: pageInfo.totalChars,
    page_size: cap,
  } : undefined;

  const structuredResult = {
      url,
      source: result.source || "unknown",
      text: opts.metadata_only ? "" : (pageInfo?.text || ""),
      metadata: metadataSummary(result.meta || {}),
      warnings: result.warnings || [],
  };
  if (result.finalUrl) structuredResult.final_url = result.finalUrl;
  if (result.status) structuredResult.status = result.status;
  if (result.meta?.title) structuredResult.title = result.meta.title;
  if (result.structured) structuredResult.structured_data = result.structured;
  if (links.length) structuredResult.links = links;
  if (page) structuredResult.page = page;
  if (typeof pageInfo?.hasNext === "boolean") structuredResult.has_next = pageInfo.hasNext;
  if (opts.debug && result.debugInfo) structuredResult.debug = result.debugInfo;

  return {
    text,
    result: structuredResult,
  };
}

// ── MCP server ──────────────────────────────────────────────────────

const SERVER_INSTRUCTIONS = [
  "This MCP provides search and fetch tools optimized for sources that ordinary web search often misses: forums, communities, game stores, comments, niche pages, and lightly gated public pages.",
  "Recommended workflow: use perplexity_search for ranked previews, then perplexity_fetch for one URL; use perplexity_fetch_many to compare several known URLs; use perplexity_search_fetch when you explicitly want search plus automatic fetching in one call.",
  "Use explicit parameters for filters instead of burying filters in the query. Use search_domain_filter for domains, search_language_filter for language, search_recency_filter or date filters for time. Do not mix allowlist and denylist domain filters.",
  "auto_source_profile is enabled by default: queries that name Reddit, DCinside, NamuWiki, Steam, YouTube, GitHub, or a registered mainstream news outlet get matching search filters unless explicit source/search filters are supplied.",
  "source_profile can quickly focus a search: community, official, academic, reviews, korean_forums, news, or steam. Explicit user filters override profile defaults.",
  "For fetch, cleaning_mode controls page cleanup. balanced is default; strict removes more UI/navigation; raw-ish preserves more text. include_links is enabled by default and preserves page links as Markdown plus structured links; set include_links=false to suppress link URLs. site_preset=auto detects known sites by URL, including registered news, MediaWiki, SAGE Journals, and SourceForge Allura wiki domains; site_preset=none disables site-specific handling. page/max_chars paginate long bodies. metadata_only is for source triage.",
  "Always cite URLs from tool output. Search result indexes [N] are stable within that result set and should be kept when discussing evidence.",
].join(" ");

const SEARCH_DESCRIPTION = [
  "Ranked web search previews using Perplexity /search.",
  "Best for community/forum reactions, unofficial tips, reviews, Steam/community material, Korean forums, and sources not well covered by ordinary WebSearch.",
  "Returns indexed [N] results with title, URL, snippet, date signals, optional profile notes, dedupe information, and next-step guidance.",
  "By default, auto_source_profile detects named source sites and registered news outlets in the query and applies matching domain/language filters. Set auto_source_profile=false or provide explicit filters for full control. Cost is one Perplexity search call.",
].join(" ");

const FETCH_DESCRIPTION = [
  "Fetch one URL, clean the page text, and return a paginated body with citation-ready metadata.",
  "The fetch path tries direct HTTP with UA rotation, simple same-origin form submission for button-only checks, Steam Store adult age gates, client-side meta/JS redirects, metadata fallback, document detection, optional Perplexity domain fallback, and short Worker Cache reuse.",
  "Use metadata_only for triage; debug for redirects/status/content-type/cache diagnostics; cleaning_mode for strict/balanced/raw-ish text cleanup; include_links=false only when link URLs would add noise; site_preset for known sites such as steam/reddit/dcinside/namu/mediawiki/sage/sourceforge/youtube/github/news.",
  "For DCinside posts the comment thread is XHR-loaded and would otherwise be missing; it is fetched via the comment API and appended under '## 댓글' by default (set include_comments=false to skip). Set include_images=true (max_images N) to also attach the post's content images as image blocks for multimodal models.",
  "If the body exceeds max_chars, call again with the same URL and page+1.",
].join(" ");

const FETCH_MANY_DESCRIPTION = [
  "Fetch up to five known URLs in one call and return separate citation-ready sections.",
  "Use this when search already found several promising sources and you need quick comparison. Each URL uses the same fetch options.",
].join(" ");

const SEARCH_FETCH_DESCRIPTION = [
  "Search, dedupe, optionally profile/rerank, then fetch the top K results in one call.",
  "Use this when you want a compact evidence pack rather than manually calling search and fetch. Search uses auto_source_profile by default; fetched pages use site_preset=auto by result URL unless site_preset is forced or set to none. Cost is one Perplexity search plus any fallback fetch costs.",
  "For careful research, inspect the search preview and fetched sections; cite the original URLs.",
].join(" ");

// ── Tool input schemas (module-scope: built once, reused per request) ──

const DATE_REGEX = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/[0-9]{4}$/;
const LANG_CODE_REGEX = /^[a-z]{2}$/;

const SEARCH_INPUT_SHAPE = {
  query: z.string().describe("Search query. Use specific nouns, product names, model numbers, years, communities, and domain terms."),
  max_results: z.number().int().min(1).max(20).optional().describe("Number of results to return (1-20, default 10)."),
  max_tokens_per_page: z.number().int().min(256).max(2048).optional().describe("Per-result preview budget (256-2048, default 256). Use 256 for discovery, 2048 for richer snippets."),
  source_profile: z.enum(SOURCE_PROFILES).optional().describe("Optional preset that applies sensible language/domain filters unless you provide explicit filters. Values: general, community, official, academic, reviews, korean_forums, news, steam."),
  auto_source_profile: z.boolean().optional().describe("Detect named source sites in the query (Reddit, DCinside, NamuWiki, Steam, YouTube, GitHub) and apply matching search filters by default. Set false to keep the search unmodified; explicit source_profile/domain/language/country values are not overridden."),
  dedupe: z.boolean().optional().describe("Remove duplicate URLs/canonical-equivalent results before rendering (default true)."),
  rerank: z.boolean().optional().describe("Lightly rerank results by query-term coverage and date signals after dedupe (default false; Perplexity order is otherwise preserved)."),
  debug: z.boolean().optional().describe("Include additional diagnostic fields such as dedupe keys and applied profile notes."),
  country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code, e.g. KR, US, JP."),
  search_recency_filter: z.enum(["hour", "day", "week", "month", "year"]).optional()
    .describe("Relative time filter: hour/day/week/month/year. Mutually exclusive with explicit date filters."),
  search_after_date_filter: z.string().regex(DATE_REGEX).optional()
    .describe("Published after date in MM/DD/YYYY format."),
  search_before_date_filter: z.string().regex(DATE_REGEX).optional()
    .describe("Published before date in MM/DD/YYYY format."),
  last_updated_after_filter: z.string().regex(DATE_REGEX).optional()
    .describe("Last updated after date in MM/DD/YYYY format."),
  last_updated_before_filter: z.string().regex(DATE_REGEX).optional()
    .describe("Last updated before date in MM/DD/YYYY format."),
  search_language_filter: z.array(z.string().regex(LANG_CODE_REGEX)).max(10).optional()
    .describe("Language filter as ISO 639-1 lowercase codes, e.g. [\"ko\"], [\"en\",\"ja\"]. Max 10."),
  search_domain_filter: z.array(z.string()).max(20).optional()
    .describe("Domain filter. Allowlist: [\"nature.com\"]. Denylist: [\"-reddit.com\"]. Do not mix allow and deny. Use domains/TLDs only, no protocol/path."),
};

const FETCH_INPUT_SHAPE = {
  url: z.string().url().describe("Absolute URL to fetch."),
  max_chars: z.number().int().min(500).max(FETCH_MAX_CHARS_LIMIT).optional()
    .describe(`Body characters per page (default ${FETCH_MAX_CHARS_DEFAULT}, max ${FETCH_MAX_CHARS_LIMIT}). Headers and diagnostics do not count against this budget.`),
  page: z.number().int().min(1).max(1000).optional()
    .describe("Body page number (default 1). If hasNext is shown, call again with page+1."),
  cleaning_mode: z.enum(CLEANING_MODES).optional()
    .describe("Content cleaning strength. strict removes most UI/navigation; balanced is the default; raw-ish preserves more page text while still stripping scripts/styles."),
  site_preset: z.enum(SITE_PRESETS).optional()
    .describe("Optional site-specific handling. auto detects known sites by URL; none disables site-specific handling; steam handles age gates; reddit sets over18; news/mediawiki/sage extract article text from registered domains."),
  metadata_only: z.boolean().optional()
    .describe("Return metadata and structured data only, without the body page. Useful for fast source triage."),
  include_links: z.boolean().optional()
    .describe("Preserve links in fetched body text as Markdown and expose extracted links in structured output (default true). Set false to suppress link URLs."),
  include_comments: z.boolean().optional()
    .describe("For DCinside posts, fetch the full comment thread (replies included) via the comment API and append it under a '## 댓글' section, with comments also in structured output. Default true. Set false to skip comments."),
  include_images: z.boolean().optional()
    .describe("Fetch the post's content images (UI chrome and emoticons excluded) and return them as image blocks so multimodal models can see them directly. Default false; increases response size."),
  max_images: z.number().int().min(1).max(10).optional()
    .describe("Maximum content images to attach when include_images is true (default 4, max 10)."),
  debug: z.boolean().optional()
    .describe("Include redirect/cache/attempt/content-type diagnostics."),
  use_cache: z.boolean().optional()
    .describe("Use the Worker Cache API for full cleaned fetch results (default true). Set false for fresh fetch/debugging."),
  cache_ttl_seconds: z.number().int().min(30).max(3600).optional()
    .describe(`Cache TTL in seconds when use_cache is true (default ${CACHE_TTL_SECONDS_DEFAULT}).`),
};

const FETCH_MANY_INPUT_SHAPE = {
  urls: z.array(z.string().url()).min(1).max(FETCH_MANY_LIMIT).describe(`URLs to fetch, max ${FETCH_MANY_LIMIT}.`),
  max_chars: z.number().int().min(500).max(12000).optional().describe("Body characters per URL (default 4000)."),
  page: z.number().int().min(1).max(1000).optional().describe("Body page number to return for every URL (default 1)."),
  cleaning_mode: z.enum(CLEANING_MODES).optional().describe("Content cleaning strength: strict, balanced, raw-ish."),
  site_preset: z.enum(SITE_PRESETS).optional().describe("Site preset to force for every URL. auto detects by URL; none disables site-specific handling."),
  metadata_only: z.boolean().optional().describe("Return metadata/structured data only for every URL."),
  include_links: z.boolean().optional().describe("Preserve links as Markdown and expose extracted links in structured output for every URL (default true)."),
  debug: z.boolean().optional().describe("Include diagnostics for every URL."),
  use_cache: z.boolean().optional().describe("Use Worker Cache API (default true)."),
};

const SEARCH_FETCH_INPUT_SHAPE = {
  ...SEARCH_INPUT_SHAPE,
  fetch_top_k: z.number().int().min(1).max(SEARCH_FETCH_TOP_K_LIMIT).optional().describe(`Fetch the top K deduped search results (1-${SEARCH_FETCH_TOP_K_LIMIT}, default 3).`),
  fetch_chars: z.number().int().min(500).max(12000).optional().describe("Body characters per fetched result (default 3500)."),
  cleaning_mode: z.enum(CLEANING_MODES).optional().describe("Content cleaning strength for fetched pages."),
  site_preset: z.enum(SITE_PRESETS).optional().describe("Site preset for fetched pages. auto detects by result URL; none disables site-specific handling."),
  metadata_only: z.boolean().optional().describe("Fetch metadata/structured data only instead of body pages."),
  include_links: z.boolean().optional().describe("Preserve fetched-page links as Markdown and expose extracted links in structured output (default true)."),
  use_cache: z.boolean().optional().describe("Use Worker Cache API for fetched pages (default true)."),
};

const SEARCH_RESULT_OUTPUT = z.object({
  index: z.number().int(),
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  date: z.string().optional(),
  last_updated: z.string().optional(),
  date_signal: z.string(),
});

const FETCH_PAGE_OUTPUT = z.object({
  page: z.number().int(),
  total_pages: z.number().int(),
  has_next: z.boolean(),
  start: z.number().int(),
  end: z.number().int(),
  total_chars: z.number().int(),
  page_size: z.number().int(),
});

const LINK_OUTPUT = z.object({
  text: z.string(),
  url: z.string(),
});

const FETCH_OUTPUT = z.object({
  url: z.string(),
  final_url: z.string().optional(),
  status: z.number().int().optional(),
  source: z.string(),
  title: z.string().optional(),
  text: z.string(),
  metadata: z.object({}).passthrough(),
  structured_data: z.object({}).passthrough().optional(),
  links: z.array(LINK_OUTPUT).optional(),
  page: FETCH_PAGE_OUTPUT.optional(),
  has_next: z.boolean().optional(),
  warnings: z.array(z.string()),
  debug: z.object({}).passthrough().optional(),
});

const SEARCH_OUTPUT_SHAPE = {
  text: z.string(),
  query: z.string(),
  result_count: z.number().int(),
  raw_count: z.number().int(),
  dropped_duplicates: z.number().int(),
  profile_notes: z.array(z.string()),
  suggestions: z.array(z.string()),
  results: z.array(SEARCH_RESULT_OUTPUT),
};

const FETCH_OUTPUT_SHAPE = {
  text: z.string(),
  result: FETCH_OUTPUT,
};

const FETCH_MANY_OUTPUT_SHAPE = {
  text: z.string(),
  count: z.number().int(),
  items: z.array(FETCH_OUTPUT),
};

const SEARCH_FETCH_OUTPUT_SHAPE = {
  text: z.string(),
  search: z.object(SEARCH_OUTPUT_SHAPE),
  fetched_count: z.number().int(),
  fetched: z.array(FETCH_OUTPUT),
};

const SERVER_INFO = { name: "ai.perplexity/mcp-server", version: VERSION };
const SERVER_OPTIONS = { instructions: SERVER_INSTRUCTIONS };

function validateSearchArgs(args) {
  const dateFiltersSet = !!(args.search_after_date_filter || args.search_before_date_filter || args.last_updated_after_filter || args.last_updated_before_filter);
  if (args.search_recency_filter && dateFiltersSet) {
    return "search_recency_filter is mutually exclusive with explicit published/updated date filters. Use one style.";
  }

  const { opts } = applySearchProfile(args);
  if (opts.search_domain_filter && opts.search_domain_filter.length > 0) {
    const hasAllow = opts.search_domain_filter.some((d) => !d.startsWith("-"));
    const hasDeny = opts.search_domain_filter.some((d) => d.startsWith("-"));
    if (hasAllow && hasDeny) {
      return "search_domain_filter must be all allowlist entries or all denylist entries; do not mix values with and without '-'.";
    }
  }
  return "";
}

// Four tool schemas share the same fetch and search knobs. Normalising the
// defaults in one place each keeps them from drifting apart — previously the
// same three `?? "balanced"` / `?? "auto"` / `!== false` lines were copied into
// every handler.
function normalizeFetchOpts(args, overrides = {}) {
  return {
    ...args,
    cleaning_mode: args.cleaning_mode ?? "balanced",
    site_preset: args.site_preset ?? "auto",
    include_links: args.include_links !== false,
    ...overrides,
  };
}

function normalizeSearchOpts(args, overrides = {}) {
  return {
    ...args,
    max_results: args.max_results ?? 10,
    max_tokens_per_page: args.max_tokens_per_page ?? 256,
    source_profile: args.source_profile ?? "general",
    ...overrides,
  };
}

function toolError(message) {
  /** @type {Array<import("@modelcontextprotocol/sdk/types.js").ContentBlock>} */
  const content = [{ type: "text", text: `Error: ${message}` }];
  return { content, isError: true };
}

function createServer(apiKey) {
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);

  server.registerTool(
    "perplexity_search",
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: SEARCH_INPUT_SHAPE,
      outputSchema: SEARCH_OUTPUT_SHAPE,
    },
    async (args) => {
      const opts = normalizeSearchOpts(args);
      const validationError = validateSearchArgs(opts);
      if (validationError) return toolError(validationError);

      const search = await runSearch(opts, apiKey);
      const text = formatSearchResults(search, { debug: opts.debug });
      const structuredContent = buildSearchStructured(search, text);
      return { content: [{ type: "text", text }], structuredContent };
    }
  );

  server.registerTool(
    "perplexity_fetch",
    {
      description: FETCH_DESCRIPTION,
      inputSchema: FETCH_INPUT_SHAPE,
      outputSchema: FETCH_OUTPUT_SHAPE,
    },
    async (args) => {
      const opts = normalizeFetchOpts(args);
      const { result, text, imageContent } = await fetchAndFormat(args.url, apiKey, opts);
      const structuredContent = buildFetchStructured(args.url, result, text, opts);
      // Text first, then any image blocks collected for multimodal clients.
      /** @type {Array<import("@modelcontextprotocol/sdk/types.js").ContentBlock>} */
      const content = [{ type: "text", text }];
      if (Array.isArray(imageContent) && imageContent.length) content.push(...imageContent);
      return { content, structuredContent };
    }
  );

  server.registerTool(
    "perplexity_fetch_many",
    {
      description: FETCH_MANY_DESCRIPTION,
      inputSchema: FETCH_MANY_INPUT_SHAPE,
      outputSchema: FETCH_MANY_OUTPUT_SHAPE,
    },
    async (args) => {
      const parts = [];
      const items = [];
      for (let i = 0; i < args.urls.length; i++) {
        const url = args.urls[i];
        try {
          const opts = normalizeFetchOpts(args, { max_chars: args.max_chars ?? 4000 });
          const { result, text } = await fetchAndFormat(url, apiKey, opts);
          parts.push(`## [${i + 1}] ${url}\n\n${text}`);
          items.push(buildFetchStructured(url, result, text, opts).result);
        } catch (err) {
          const errorText = `Error: ${String(err).slice(0, 500)}`;
          parts.push(`## [${i + 1}] ${url}\n\n${errorText}`);
          items.push({
            url,
            source: "error",
            text: errorText,
            metadata: {},
            warnings: [errorText],
          });
        }
      }
      const text = parts.join("\n\n---\n\n");
      const structuredContent = { text, count: items.length, items };
      return { content: [{ type: "text", text }], structuredContent };
    }
  );

  server.registerTool(
    "perplexity_search_fetch",
    {
      description: SEARCH_FETCH_DESCRIPTION,
      inputSchema: SEARCH_FETCH_INPUT_SHAPE,
      outputSchema: SEARCH_FETCH_OUTPUT_SHAPE,
    },
    async (args) => {
      const opts = normalizeSearchOpts(args, {
        max_results: args.max_results ?? Math.max(8, args.fetch_top_k ?? 3),
      });
      const validationError = validateSearchArgs(opts);
      if (validationError) return toolError(validationError);

      const search = await runSearch(opts, apiKey);
      const topK = Math.min(args.fetch_top_k ?? 3, SEARCH_FETCH_TOP_K_LIMIT, search.results.length);
      const chunks = [
        "# Search preview",
        formatSearchResults(search, { debug: args.debug }),
        "",
        `# Fetched top ${topK}`,
      ];
      const fetchedItems = [];
      for (let i = 0; i < topK; i++) {
        const result = search.results[i];
        try {
          // Explicit allowlist, not a spread: search arguments such as query
          // and fetch_top_k must not leak into the fetch options.
          const fetchOpts = normalizeFetchOpts({
            max_chars: args.fetch_chars ?? 3500,
            page: 1,
            cleaning_mode: args.cleaning_mode,
            site_preset: args.site_preset,
            metadata_only: args.metadata_only,
            include_links: args.include_links,
            debug: args.debug,
            use_cache: args.use_cache,
          });
          const fetched = await fetchAndFormat(result.url, apiKey, fetchOpts);
          chunks.push(`\n## [${i + 1}] ${cleanText(result.title || result.url, "strict")}\nSearch URL: ${result.url}\n${fetched.text}`);
          fetchedItems.push(buildFetchStructured(result.url, fetched.result, fetched.text, fetchOpts).result);
        } catch (err) {
          const errorText = `Error: ${String(err).slice(0, 500)}`;
          chunks.push(`\n## [${i + 1}] ${result.url}\n${errorText}`);
          fetchedItems.push({
            url: result.url || "",
            source: "error",
            text: errorText,
            metadata: {},
            warnings: [errorText],
          });
        }
      }
      const text = chunks.join("\n");
      const searchText = formatSearchResults(search, { debug: args.debug });
      const structuredContent = {
        text,
        search: buildSearchStructured(search, searchText),
        fetched_count: fetchedItems.length,
        fetched: fetchedItems,
      };
      return { content: [{ type: "text", text }], structuredContent };
    }
  );

  return server;
}

// ── Test surface ─────────────────────────────────────────────
// Named exports consumed by test/. src/worker.js is the deploy entry and
// esbuild tree-shakes whatever it does not reach.

export {
  // Worker composition
  createServer,
  VERSION,
  // Text + HTML cleaning
  cleanText,
  cleanMarkdownText,
  normalizeCleaningMode,
  htmlToText,
  htmlLinksToMarkdown,
  extractLinksFromMarkdown,
  extractMetadata,
  decodeEntities,
  paginateText,
  // Site routing
  resolveSitePreset,
  isDcinsideUrl,
  isRedditUrl,
  isNamuWikiUrl,
  isMediaWikiUrl,
  isSageUrl,
  isNewsUrl,
  isSourceForgeUrl,
  isDocumentUrl,
  findNewsSourceByHost,
  buildDcinsideMobileUrl,
  buildRedditJsonUrl,
  buildSageFullTextUrl,
  buildSourceForgeRestUrl,
  // Site extractors
  extractDcinsideArticleData,
  extractRedditPostData,
  extractNamuWikiData,
  cleanNamuWikiText,
  extractMediaWikiArticleData,
  cleanMediaWikiText,
  extractSageArticleData,
  cleanSageArticleText,
  extractPmcArticleData,
  cleanPmcArticleText,
  extractSourceForgeAlluraData,
  extractNewsArticleData,
  cleanNewsText,
  stripNewsBoilerplateHtml,
  dedupeNewsBodyAgainstTitle,
  extractSteamStoreData,
  extractSiteStructuredData,
  extractSitePage,
  SITE_EXTRACTORS,
  // DCinside comments
  extractDcinsideEsno,
  dcinsideCommentMemoToText,
  formatDcinsideComments,
  dcinsideIdNo,
  dcinsideGallType,
  // Request shaping
  fetchHeaders,
  browserRequestHeaders,

  // Anti-bot and redirects
  extractClientRedirect,
  looksBlocked,
  looksSteamAgeGate,
  buildSimpleChallengeSubmission,
  buildSteamAgeSubmission,
  hasMeaningfulHtmlContent,
  // Images
  selectContentImageUrls,
  sniffImageMime,
  arrayBufferToBase64,
  // Search shaping
  dedupeSearchResults,
  scoreSearchResult,
  suggestSearchAlternatives,
  applySearchProfile,
  applyAutoSearchSourcePreset,
  detectAutoSearchSourcePreset,
  detectAutoNewsSourcePreset,
  searchAppliedFilters,
  formatSearchResults,
  buildSearchStructured,
  validateSearchArgs,
  // Network paths (tests drive these through a stubbed globalThis.fetch)
  fetchPageWithFallbacks,
  fetchAndFormat,
  fetchDcinsideComments,
  fetchSourceForgeAllura,
  fetchSageViaPmc,
  fetchViaPerplexity,
  fetchViaAgentUrlTool,
  fetchRemoteBody,
  sameDocument,
  isOpaqueSlug,
  runSearch,
  performSearch,
  makeApiRequest,

  // Fetch shaping
  formatFetchResult,
  formatMetadataOnly,
  buildFetchStructured,
  fetchCacheKey,
};
