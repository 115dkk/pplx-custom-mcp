# 퍼플렉시티 커스텀 MCP

Cloudflare Workers 위에서 도는 MCP 서버입니다. Perplexity `/search` 검색과, **헤드리스 브라우저 없이** 동작하는 페이지 본문 추출기를 도구로 노출합니다.

일반 웹 검색이 잘 못 긁는 곳 — 커뮤니티, 포럼, 게임 스토어, 댓글, 가볍게 막힌 페이지 — 을 노린 물건입니다.

- **런타임**: Cloudflare Workers 무료 티어 (Durable Object 불필요, stateless)
- **비용**: Workers 무료. `perplexity_fetch`의 직접 경로는 무료이며, 403·SPA 셸·문서 URL에서만 Perplexity `fetch_url`(도구 호출 $0.0005 + 모델 토큰)과 검색 폴백($0.005)을 순서대로 사용
- **라이선스**: MIT

---

## 설계 원칙: 브라우저를 띄우지 않는다

JS로 렌더링되는 콘텐츠를 헤드리스 브라우저로 뜯는 대신, **브라우저가 실제로 보내는 XHR을 그대로 재현**합니다. 콜드 스타트가 없고, Workers 무료 티어 안에서 끝나고, p95가 초 단위가 아니라 밀리초 단위입니다.

대표적인 예가 DCinside입니다. 본문은 서버 렌더링이지만 댓글은 `/board/comment/`로 나가는 별도 XHR로 실려옵니다. 평범한 fetch로는 댓글이 통째로 사라지므로, `e_s_n_o` 토큰을 페이지에서 뽑아 그 XHR을 직접 호출해 `## 댓글` 섹션으로 붙입니다.

---

## 도구 (v1.2.2)

네 개 모두 `outputSchema`를 선언하고 사람이 읽는 텍스트와 `structuredContent`를 함께 돌려줍니다.

### `perplexity_search`
Perplexity `/search` 기반 랭킹 검색 미리보기. `[1] [2] [3]` 번호가 붙어 나오므로 후속 `perplexity_fetch`에서 그대로 참조하면 됩니다.

- `query`(필수), `max_results`(1–20, 기본 10), `max_tokens_per_page`(256–2048, 기본 256)
- `source_profile`: `general` `community` `official` `academic` `reviews` `korean_forums` `news` `steam`
- `auto_source_profile`(기본 켜짐): 질의에 Reddit/디시/나무위키/Steam/YouTube/GitHub·등록된 언론사 이름이 보이면 해당 도메인·언어 필터를 자동 적용. 사용자가 명시한 필터는 절대 덮어쓰지 않음
- `dedupe`(기본 켜짐), `rerank`, `debug`, `country`, 언어/도메인/날짜 필터
- 비용: 호출당 약 $0.005

### `perplexity_fetch`
URL 하나를 직접 가져와 본문을 정제해 돌려줍니다. 직접 경로는 무료이고, 모든 직접 시도가 막힌 경우에만 Perplexity Agent API `fetch_url`을 사용한 뒤 필요하면 동일 문서가 맞는지 검증하는 검색 폴백을 사용합니다.

- `url`(필수), `max_chars`(기본 8000, 상한 32000), `page`(기본 1), `cleaning_mode`(`strict`/`balanced`/`raw-ish`)
- `site_preset`: `auto`가 URL로 사이트를 판별. `none`이면 사이트별 처리를 끔
- `metadata_only`(선별용), `include_links`(기본 켜짐), `include_comments`(기본 켜짐), `include_images`/`max_images`(기본 2), `use_cache`/`cache_ttl_seconds`, `debug`
- 디시인사이드 글은 본문 이미지가 자동 첨부됩니다. 다른 사이트는 이미지·스크린샷·차트 등 시각 정보가 필요할 때 `include_images=true`를 사용합니다. 성공한 이미지는 MCP 이미지 블록과 출처 URL/구조화 메타데이터를 함께 반환하므로 이미지 블록을 표시하지 않는 클라이언트에서도 원본 링크가 남습니다.
- 본문이 `max_chars`를 넘으면 같은 `url`/`max_chars`에 `page+1`로 다시 호출

사이트별 처리:

| 사이트 | 하는 일 |
|---|---|
| DCinside | 모바일 URL 변환, `dcinside.app` UA, 로그인·광고 리다이렉트 싱크 차단, 댓글 XHR 재현, 본문 이미지 자동 첨부 |
| Reddit | HTML이 봇 검증에 걸리면 공개 `.json?raw_json=1`로 폴백, 본문+댓글 트리 추출 |
| 나무위키 | VPN/IDC 공지, `[편집]` 마커, 분류·네비게이션 상자, 목차 제거. `/raw/`는 동일 `rev`의 `/w/` 읽기 URL로 바꾸고 공식 `Perplexity-User` UA로 Worker에서 직접 확인. 직접 경로도 막히면 Agent·검색 폴백 사용 |
| MediaWiki | `mw-content-text` 추출, 목차·편집 링크·알림 상자·썸네일 캡션 제거 |
| SAGE Journals | 인용 메타 + 초록/전문 추출, 막히면 DOI로 PMC 오픈액세스 미러 폴백 |
| SourceForge | 봇 차단된 HTML 대신 Allura REST JSON에서 위키 본문 |
| 뉴스 | 국내외 주요 언론사 도메인 레지스트리, 레거시 한글 인코딩 디코딩, JSON-LD/Arc/일반 본문 추출, 공유·폰트·로그인·광고·관련기사 제거 |
| Steam | 성인 연령 확인 폼 자동 통과, 앱 ID/이름/출시일/가격/태그 구조화 |

그 외 공통: UA 로테이션, 단순 확인 버튼 폼 자동 제출, meta/JS 클라이언트 리다이렉트 추적, 문서(PDF 등) URL 감지, SPA 셸이면 `og:*`+JSON-LD+`<noscript>` 폴백, 쿠키 배너·뉴스레터·네비게이션 등 잡음 제거, Worker Cache 단기 재사용. 직접 fetch가 403·봇 차단·빈 SPA 셸로 끝나면 `fetch_url`로 정확한 URL의 본문을 요청하고, 거부·오류·타임아웃이면 기존 Perplexity 검색 폴백으로 이어집니다.

Worker의 직접 fetch는 `robots.txt`를 요청하거나 적용하지 않습니다. 크롤러가 아니라 사용자가 지목한 URL 하나를 확인하는 fetch 유틸이기 때문입니다. 나무위키 `/raw/`는 사이트가 과거판 경로를 별도로 차단하므로 동일 문서·동일 `rev`의 `/w/` 읽기 URL로 바꾼 뒤, 사용자 요청용 공식 `Perplexity-User` UA를 먼저 써서 Worker가 직접 가져옵니다. 직접 경로도 막힌 경우에만 Perplexity `fetch_url`과 동일 문서 검증 검색 폴백이 이어지며, 현재판이나 다른 `rev`가 돌아오면 폐기합니다.

### `perplexity_fetch_many`
알려진 URL을 최대 5개까지 한 번에 가져와 URL별 섹션으로 나눠 돌려줍니다.

### `perplexity_search_fetch`
검색 → dedupe → 상위 K개 fetch를 한 번에. 증거 묶음이 필요할 때.

---

## 배포

[`DEPLOY-GUIDE.md`](DEPLOY-GUIDE.md)에 단계별로 있습니다. 요약하면:

```bash
npm install
npx wrangler login
npx wrangler secret put PERPLEXITY_API_KEY
npx wrangler deploy
```

배포 후 Claude.ai → Settings → Connectors → Add custom connector에 `https://<워커주소>/mcp`를 등록하면 됩니다.

CI에서 자동 배포하려면 저장소 시크릿에 `CLOUDFLARE_API_TOKEN`(필요하면 `CLOUDFLARE_ACCOUNT_ID`)을 넣어두면 `main` 푸시마다 테스트 통과 후 배포됩니다.

### 보안 메모

- `/mcp`에는 Cloudflare Rate Limiting binding으로 클라이언트당 분당 60회 제한이 적용됩니다.
- fetch 입력은 공개 `http`/`https` URL만 허용하며 localhost, 사설·링크로컬 IP, URL 내 자격증명을 거부합니다. 원격 텍스트 응답은 추출 전에 4 MiB로 제한됩니다.
- 현재 커넥터는 인증 없이 공개되어 있습니다. Rate limiting은 비용 폭주 완화책이지 인증이 아닙니다. 다중 사용자나 민감한 도구로 확장하기 전에는 MCP 표준 OAuth 2.1 보호 리소스 흐름을 추가해야 합니다.
- GitHub CI는 high/critical npm 경보를 배포 차단 조건으로 사용하며, CodeQL과 Dependabot이 주기적으로 재점검합니다.

---

## 개발

```bash
npm test        # 회귀 테스트 (네트워크 불필요, API 키 불필요)
npm run typecheck
npm run dev     # wrangler dev
```

### 구조

```
src/index.js   추출·정제·검색 로직 + MCP 도구 등록 (createServer)
src/worker.js  Workers 진입점. agents/mcp를 여기서만 import
test/          node --test 회귀 스위트
test/fixtures/ 사이트별 고정 HTML/JSON
```

`src/index.js`가 `agents/mcp`를 import하지 않는 것은 의도적입니다. 그 패키지가 `cloudflare:workers`를 끌어오면 일반 Node에서 모듈을 못 불러오고, 그러면 테스트를 workerd 위에서만 돌릴 수 있게 됩니다. Workers 전용 import를 `src/worker.js` 한 곳에 가둬 두면 나머지 전부를 `node --test`로 검증할 수 있습니다.

### 테스트가 보장하는 것

픽스처 기반이라 네트워크도 API 키도 필요 없고, 실패는 전부 결정적입니다. 특히 다음이 깨지면 무조건 RED입니다.

- 본문이 비거나 잘림 (모든 사이트 프리셋 + 일반 HTML)
- DCinside 댓글 누락, 대댓글 깊이 유실, 디시콘 대체 텍스트 유실
- 광고·공유 위젯·목차·관련기사·저작권 푸터가 본문에 새어 들어옴
- 링크 URL 유실, 페이지네이션·`metadata_only`·`include_links=false` 동작 변화
- 검색 dedupe/rerank/자동 프로필, `[N]` 인덱스 렌더링
- MCP 도구 이름·입출력 스키마·`structuredContent` 변경

실제 사이트가 개편되어 셀렉터가 어긋나는 것은 회귀가 아니라 드리프트이므로, 배포된 워커를 실제 URL로 두드리는 별도 워크플로(`live-smoke`)에서 확인합니다. 이쪽은 배포를 막지 않습니다.
