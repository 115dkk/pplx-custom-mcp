# Perplexity MCP — Cloudflare Workers 배포 가이드

이 프로젝트는 빌드 검증 완료된 상태입니다. 아래 3단계만 수행하면 배포됩니다.

---

## 1단계: 의존성 설치 및 Cloudflare 로그인

```bash
npm install
npx wrangler login          # 브라우저가 열림 → 승인 클릭
```

## 2단계: 시크릿 등록

```bash
npx wrangler secret put PERPLEXITY_API_KEY
# 프롬프트가 뜨면 Perplexity API 키(pplx-...)를 붙여넣기
# 키 발급: https://www.perplexity.ai/settings/api
```

## 3단계: 배포

```bash
npx wrangler deploy
```

배포 완료 시 출력 예시:
```
Published perplexity-mcp (X.XX sec)
  https://perplexity-mcp.<계정명>.workers.dev
```

## 4단계: 동작 확인

```bash
# 헬스 체크
curl https://perplexity-mcp.<계정명>.workers.dev/health

# MCP 초기화 테스트
curl -X POST https://perplexity-mcp.<계정명>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

## 5단계: Claude.ai 커넥터 등록

1. Claude.ai → Settings → Connectors → Add custom connector
2. URL 입력: `https://perplexity-mcp.<계정명>.workers.dev/mcp`
3. 연결 후 대화에서 아래 도구가 노출되는지 확인 (v1.1.0 기준):
   - perplexity_search — 비공식 웹 검색 (제목·URL·스니펫 미리보기)
   - perplexity_fetch — URL 본문 직접 추출 + 잡음 정제
   - perplexity_fetch_many — 여러 URL 본문 일괄 추출
   - perplexity_search_fetch — 검색 후 상위 결과 자동 fetch
4. 간단한 검색 쿼리로 실제 동작 테스트

---

## 아키텍처 참고

- **Stateless**: `createMcpHandler` 사용 (Durable Object 불필요, 무료 티어 호환)
- **MCP SDK ≥1.26.0 호환**: 요청마다 새 McpServer 인스턴스 생성
- **4개 도구** (v1.2.0):
  - `perplexity_search` — Perplexity `/search` 호출, source_profile/dedupe/date signals 지원, ~$0.005/회
  - `perplexity_fetch` — Worker 직접 fetch + JS 우회 + 단순 확인 form 자동 제출 + Steam 성인 연령 확인 처리 + 잡음 정제 + page 기반 본문 페이지네이션. 직접 경로가 막히면 Perplexity `fetch_url`, 이어서 동일 문서 검증 검색 폴백 사용
  - `perplexity_fetch_many` — 여러 URL을 하나의 evidence pack으로 fetch
  - `perplexity_search_fetch` — 검색 + dedupe + 상위 K개 fetch 원샷 워크플로
  - 모든 도구는 `outputSchema`와 `structuredContent`를 제공
- **CORS**: 모든 origin 허용 (Claude.ai 브라우저 클라이언트 지원)
- **비용**: Workers 무료. 직접 fetch는 무료. 막힌 페이지의 `fetch_url`은 도구 호출 $0.0005 + 모델 토큰 비용이며, 후속 검색 폴백은 호출당 $0.005.
