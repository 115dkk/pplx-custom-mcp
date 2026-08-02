// DCinside is the strictest regression target: the article body is server
// rendered but the comment thread is XHR-loaded, so "본문은 나오는데 댓글이 비어 있다"
// is the exact failure mode this suite has to turn RED.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractDcinsideArticleData,
  extractDcinsideEsno,
  dcinsideIdNo,
  dcinsideGallType,
  buildDcinsideMobileUrl,
  dcinsideCommentMemoToText,
  formatDcinsideComments,
  fetchDcinsideComments,
  fetchAndFormat,
  resolveSitePreset,
} from "../src/index.js";
import { fixture, installFetch, formBody, OFFLINE } from "./helpers/harness.mjs";

const POST_URL = "https://gall.dcinside.com/board/view/?id=programming&no=1234567";
const VIEW_HTML = fixture("dcinside-view.html");
const COMMENTS_JSON = fixture("dcinside-comments.json");

const BODY_SENTENCE = "무료 티어로도 충분히 돌아간다";
const BODY_SENTENCE_2 = "콜드 스타트가 거의 없다";

function routes() {
  return [
    { url: "https://gall.dcinside.com/board/comment/", method: "POST", body: (url, init) => {
      const page = Number(new URLSearchParams(String(init.body || "")).get("comment_page") || "1");
      return page === 1 ? COMMENTS_JSON : '{"total_cnt":4,"comments":[]}';
    }, headers: { "content-type": "application/json; charset=utf-8" } },
    { url: "https://gall.dcinside.com/board/view/", body: VIEW_HTML },
  ];
}

test("dcinside: URL is routed to the dcinside preset", () => {
  assert.equal(resolveSitePreset(POST_URL, "auto"), "dcinside");
  assert.deepEqual(dcinsideIdNo(POST_URL), { id: "programming", no: "1234567" });
  assert.equal(dcinsideGallType(POST_URL, VIEW_HTML), "G");
  assert.equal(buildDcinsideMobileUrl(POST_URL), "https://m.dcinside.com/board/programming/1234567");
});

test("dcinside: article body is extracted and ad/script noise is dropped", () => {
  const article = extractDcinsideArticleData(POST_URL, VIEW_HTML, "balanced", {});
  assert.ok(article, "extractor returned null — the body would be missing entirely");
  assert.match(article.text, /워커로 MCP 서버 올린 후기/);
  assert.match(article.text, new RegExp(BODY_SENTENCE));
  assert.match(article.text, new RegExp(BODY_SENTENCE_2));
  assert.doesNotMatch(article.text, /광고 영역입니다/, "ad slot leaked into the body");
  assert.doesNotMatch(article.text, /tracker/, "inline script leaked into the body");
  assert.equal(article.structured.type, "dcinside_post");
  assert.equal(article.structured.gallery_id, "programming");
  assert.equal(article.structured.post_no, "1234567");
  assert.equal(article.structured.author, "익명개발자");
  assert.equal(article.structured.published, "2026-07-30 21:14:07");
});

test("dcinside: e_s_n_o token is recovered from the page", () => {
  assert.equal(extractDcinsideEsno(VIEW_HTML), "3eabbdc6c0dcbc9a0d");
  assert.equal(extractDcinsideEsno('<input value="deadbeefdeadbeef01" name="e_s_n_o">'), "deadbeefdeadbeef01");
  assert.equal(extractDcinsideEsno("<html>no token here</html>"), "");
});

test("dcinside: comment XHR is replicated with the parameters the site expects", async () => {
  const stub = installFetch(routes());
  try {
    const data = await fetchDcinsideComments(POST_URL, VIEW_HTML, new Map(), undefined, { include_comments: true });
    assert.ok(data, "comment fetch returned null — comments would be missing");
    assert.equal(data.total, 4);
    assert.equal(data.items.length, 3, "deleted comment must be filtered out");

    const post = stub.matching("/board/comment/")[0];
    assert.ok(post, "no POST to the comment endpoint was made");
    const sent = formBody(post);
    assert.equal(sent.id, "programming");
    assert.equal(sent.no, "1234567");
    assert.equal(sent.e_s_n_o, "3eabbdc6c0dcbc9a0d");
    assert.equal(sent._GALLTYPE_, "G");
    assert.equal(sent.comment_page, "1");
  } finally {
    stub.restore();
  }
});

test("dcinside: comment bodies keep replies, dccon alt text, and <br> breaks", async () => {
  const stub = installFetch(routes());
  try {
    const data = await fetchDcinsideComments(POST_URL, VIEW_HTML, new Map(), undefined, { include_comments: true });
    const [first, dccon, reply] = data.items;

    assert.equal(first.memo, "오 이거 나도 주말에 해봐야겠다");
    assert.equal(first.depth, 0);
    assert.equal(first.ip, "183.99");

    assert.equal(dccon.memo, "[이미지:ㅋㅋ루삥뽕]", "dccon title must survive as a text hint");
    assert.equal(dccon.user_id, "fixednick");

    assert.equal(reply.depth, 1, "reply depth must be preserved");
    assert.match(reply.memo, /무료 티어 한도는 조심해라 하루 10만 요청 넘으면 과금된다/);
  } finally {
    stub.restore();
  }
});

test("dcinside: comment rendering marks replies and reports the true total", () => {
  const rendered = formatDcinsideComments({
    total: 4,
    truncated: false,
    items: [
      { no: "1", depth: 0, name: "가", ip: "1.2", date: "07.30 21:20", memo: "첫 댓글" },
      { no: "2", depth: 1, name: "나", user_id: "uid", date: "07.30 21:21", memo: "대댓글" },
    ],
  });
  assert.match(rendered, /^## 댓글 \(4\)/);
  assert.match(rendered, /^1\. 가\(1\.2\) 07\.30 21:20: 첫 댓글$/m);
  assert.match(rendered, /^ {3}└ 나\(uid\) 07\.30 21:21: 대댓글$/m);
  assert.equal(formatDcinsideComments(null), "");
  assert.equal(formatDcinsideComments({ total: 0, items: [] }), "");
});

test("dcinside: memo sanitiser strips markup but keeps readable text", () => {
  assert.equal(dcinsideCommentMemoToText("<b>굵게</b> 그리고<br>줄바꿈"), "굵게 그리고 줄바꿈");
  assert.equal(dcinsideCommentMemoToText("&lt;태그&gt; &amp; 엔티티"), "<태그> & 엔티티");
  assert.equal(dcinsideCommentMemoToText('<img src="x.png">'), "[이미지]");
  assert.equal(dcinsideCommentMemoToText(""), "");
});

test("dcinside: end-to-end fetch returns BOTH the body and the comment thread", async () => {
  const stub = installFetch(routes());
  try {
    const { result, text } = await fetchAndFormat(POST_URL, "", { ...OFFLINE, include_comments: true });

    assert.equal(result.ok, true);
    // 본문
    assert.match(text, new RegExp(BODY_SENTENCE), "article body missing from tool output");
    assert.match(text, new RegExp(BODY_SENTENCE_2), "article body truncated");
    // 댓글
    assert.match(text, /## 댓글 \(4\)/, "comment section missing from tool output");
    assert.match(text, /오 이거 나도 주말에 해봐야겠다/, "comment text missing from tool output");
    assert.match(text, /└ .*무료 티어 한도는 조심해라/, "nested reply missing from tool output");

    assert.equal(result.structured.comment_count, 4);
    assert.equal(result.structured.comments.length, 3);
  } finally {
    stub.restore();
  }
});

test("dcinside: include_comments=false keeps the body and skips the comment XHR", async () => {
  const stub = installFetch(routes());
  try {
    const { result, text } = await fetchAndFormat(POST_URL, "", { ...OFFLINE, include_comments: false });

    assert.match(text, new RegExp(BODY_SENTENCE), "disabling comments must not drop the body");
    assert.doesNotMatch(text, /## 댓글/);
    assert.equal(stub.matching("/board/comment/").length, 0, "comment endpoint should not be called");
    assert.equal(result.structured.comment_count, undefined);
  } finally {
    stub.restore();
  }
});

test("dcinside: a failing comment API still yields the article body", async () => {
  const stub = installFetch([
    { url: "https://gall.dcinside.com/board/comment/", method: "POST", status: 500, body: "boom" },
    { url: "https://gall.dcinside.com/board/view/", body: VIEW_HTML },
  ]);
  try {
    const { text } = await fetchAndFormat(POST_URL, "", { ...OFFLINE, include_comments: true });
    assert.match(text, new RegExp(BODY_SENTENCE), "comment failure must not take the body down with it");
    assert.doesNotMatch(text, /## 댓글/);
  } finally {
    stub.restore();
  }
});
