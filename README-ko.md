# Karpathy LLM Dashboard

스스로 쓰이는 개인 지식 베이스.

[Andrej Karpathy의 LLM Wiki 패턴](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 기반. 원본 소스를 넣으면, Claude가 이를 통합하여 영속적으로 쌓이는 위키를 만들고 유지합니다. Obsidian과 이 대시보드로 열람합니다.

**[English README](README.md)**

---

## 작동 원리

RAG는 질문할 때마다 지식을 처음부터 다시 찾습니다. 이 프로젝트는 그러지 않습니다. Claude가 소스를 한 번 읽어 서로 연결된 위키 페이지로 통합하고, 새 소스가 들어올 때마다 **기존 지식 위에 쌓입니다**. 사람은 소스를 큐레이션하고 질문하며, Claude는 요약·교차참조·인용·모순 관리 같은 번잡한 유지보수를 담당합니다.

- `raw/` — 원본 문서(기사, 논문, 노트). Claude는 **읽을 수만** 있고 절대 수정할 수 없습니다(4단계 보호).
- `wiki/` — LLM이 관리하는 마크다운 페이지(엔티티·개념·소스 요약·분석).
- `CLAUDE.md` — Claude에게 위키 운영 방법을 알려주는 설계 문서.
- **대시보드** — 브라우저에서 여는 컨트롤 패널 (`http://localhost:8090`).

---

## 빠른 시작

```bash
git clone https://github.com/cmblir/karpathy-llm-dashboard.git my-wiki
cd my-wiki
python dashboard/server.py
# → http://localhost:8090
```

Obsidian에서 vault로 열기 (`Open folder as vault` → `my-wiki`). Obsidian 설정·그래프 색·단축키가 미리 구성되어 있습니다.

**필요 조건**: Python 3.10+ (외부 의존성 0), [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`), 브라우저. Obsidian은 선택사항이지만 권장.

---

## 대시보드

### UI/UX

- **떠다니는 도우미 캐릭터** — 픽셀 아트 Claude 캐릭터가 화면을 돌아다닙니다. 클릭(또는 드래그)하면 채팅 패널이 열리고, 대시보드 기능에 대해 자유롭게 물어볼 수 있습니다. Claude CLI 기반이며 대시보드 전용 컨텍스트로 답변합니다 (위키 내용 질문은 Query 기능으로 안내).
- **흑백(Black & White) 디자인** — 집중 독서를 위한 모노크롬 팔레트. 색은 상태·diff에만 사용합니다.
- **카테고리형 툴바** — 기능들을 5개 드롭다운으로 묶었습니다 (작업·분석·탐색·만들기·더보기). 현재 보고 있는 뷰가 속한 카테고리는 상단에 강조됩니다.
- **인터랙티브** — 호버·포커스 애니메이션, 토스트 알림, 드롭다운 팝, 부드러운 뷰 전환.
- **리사이즈 가능한 사이드바** — 우측 경계 드래그(220–500px) 또는 `Cmd/Ctrl + B`로 접기. 너비는 `localStorage`에 저장.
- **폴더 연속 뷰** — 트리에서 폴더 **이름**을 클릭하면 하위 페이지를 한 화면에서 길게 스크롤하며 읽을 수 있고, 우측에 플로팅 스크롤 네비게이터가 표시됩니다.
- **영/한 전환** — 헤더 우측 토글. 선택 저장됨.
- **모델 선택** — 헤더에서 Claude 모델 선택 (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / Default).

### 주요 기능

| 카테고리 | 기능 | 설명 |
|---------|------|------|
| **작업** | 수집(Ingest) | 소스 붙여넣기 → `raw/` 저장 → Claude가 위키 페이지 생성/갱신 → diff + 판단 근거 + 되돌리기 |
| | 질문(Query) | 위키에 질문. 읽은 파일 추적, Wiki Ratio, 토큰 사용량 기록 |
| | 작성(Write) | 위키 지식으로 에세이 초안 작성. 인용 자동 삽입. 주제·분량·스타일 선택 |
| | 비교(Compare) | 두 페이지 → 공통점·차이점·시사점 → comparison 페이지로 저장 |
| **분석** | 검진(Lint) | 16개 항목 건강 검진 + 자동 수정 |
| | 성찰(Reflect) | 주간 메타 분석. 추천 페이지·스키마 개선·부족한 소스·모순 패턴 |
| | 복습(Review) | 30일 이상 갱신되지 않은 active 페이지 목록. 원클릭 갱신 |
| | 출처(Provenance) | 페이지별 인용 커버리지 (주장 대비 `[^src-*]` 비율). 자동 보완 |
| **탐색** | 검색(Search) | 위키 전체에 대한 TF-IDF 전문 검색 |
| | 그래프(Graph) | Force-directed 지식 그래프. 드래그, 클릭으로 이동 |
| | 이력(History) | git 기반 수집 이력. 특정 수집 원클릭 되돌리기 |
| **만들기** | + 폴더 | 위키 하위 폴더 생성 |
| | + 페이지 | frontmatter 포함 빈 페이지 생성 |
| **더보기** | CLAUDE.md | 스키마 파일을 대시보드에서 확인·편집 |
| | 가이드 | 빌트인 인터랙티브 가이드 (첫 관람 시 스트리밍) |

### 페이지별 액션

- **편집** — 인라인 마크다운 에디터
- **Slides** — 해당 페이지를 Marp 슬라이드 덱으로 내보내기
- **삭제** — 시스템 외 페이지

### 헤더 지표

- **Live 도트** + 통계: 총 페이지 · 소스 · 링크
- **Wiki Ratio 게이지** — 최근 쿼리에서 Claude가 wiki를 얼마나 참고했는지. 0.4 미만이면 위키가 raw를 대체하지 못하고 있다는 의미
- **인덱스 전략 배지** — `flat`(< 50 페이지), `hierarchical`(50–200), `indexed`(> 200, qmd 권장)
- **상태 바 (좌측 하단)**: Claude CLI · Obsidian — 둘 다 raw fact만 표시 (process/vault_open)

---

## 지식이 쌓이는 방식

```
소스 드롭 ──────────►  raw/article.md
                       │
                       ▼
       Claude가 읽고 생성:
       ├─ wiki/source-article.md     (요약, 자동 생성)
       ├─ wiki/entity-X.md           (신규 또는 갱신)
       ├─ wiki/concept-Y.md          (신규 또는 갱신)
       ├─ wiki/index.md              (갱신)
       ├─ wiki/log.md                (append)
       └─ ingest-reports/YYYY-MM-DD-{slug}.md  (WHY 보고서)

       │
       ▼
       git commit: "ingest: Article Title"
       │
       ▼
       대시보드: diff 뷰 + 판단 근거 + 승인/되돌리기
```

모든 수집은 git 커밋이고, 모든 페이지는 되돌릴 수 있습니다.

---

## 내부 시스템

- **Git 기반 이력**. 모든 수집은 커밋. 모든 되돌리기는 올바른 `git revert`.
- **인라인 인용**. 모든 사실 주장에 `[^src-소스슬러그]` 필수. 대시보드에서는 숫자 배지로 렌더링되며 소스 페이지 툴팁 제공.
- **Provenance 추적**. `/api/provenance`가 페이지별 인용 커버리지 보고.
- **raw/ 불변성** — 4단계 방어:
  1. `CLAUDE.md`가 LLM에게 raw/ 수정 금지 명시
  2. 모든 수집 프롬프트에 "raw/는 불변" 주입
  3. `assert_writable()`가 서버에서 프로그래밍적 쓰기 차단
  4. `check_raw_integrity()`가 사후 변조 감지
- **적응형 인덱싱**. 50페이지를 넘으면 `index.md`가 자동으로 `index-sources.md`, `index-entities.md`, `index-concepts.md` 등으로 분할됩니다. 프롬프트도 관련 서브 인덱스만 참조.
- **수집 보고서** (`ingest-reports/`). 모든 수집 시 Claude가 WHY 보고서 작성 — "왜 이 페이지를 만들고 저 페이지를 수정하고 이 교차참조를 추가했는가".
- **성찰 보고서** (`reflect-reports/`). 주간 메타 분석을 나중에 볼 수 있도록 저장.
- **질문 로그** (`query-log.jsonl`). 읽은 파일·Wiki Ratio·토큰 사용량 기록. 헤더 게이지의 근거.
- **모순 해결**. CLAUDE.md가 3가지 경로 정의: historical-claims 이관, disputed 표기, superseded 체인.

---

## 스키마 (`CLAUDE.md`)

스키마가 정의하는 것:

- **Frontmatter 규칙** — `type`, `confidence`, `status`, `source_count`, `superseded_by`
- **인라인 인용 규칙** — 형식, 의무 기준, 소스 슬러그 매핑
- **모순 해결** — 3가지 케이스와 구체적 예시 마크다운
- **수집 워크플로** — 9단계 엄격 절차. 인용 없이는 페이지 생성 불가
- **Lint 체크리스트** — 구조 / 인용 / 링크 / 신선도 16개 검사

대시보드에서 편집하거나 (더보기 → CLAUDE.md → 편집) 터미널에서 수정. 다음 작업부터 적용됩니다.

---

## 디렉토리 구조

```
raw/                     원본 문서 (불변)
raw/assets/              이미지
wiki/                    LLM이 관리하는 페이지
  index.md               콘텐츠 카탈로그 (flat/hierarchical 자동)
  log.md                 활동 타임라인
  overview.md            위키 통계
ingest-reports/          각 수집의 WHY 보고서
reflect-reports/         주간 메타 분석
plans/                   프로젝트 계획 (기능 큐)
query-log.jsonl          질문 추적 로그 (gitignored)
.dashboard-settings.json  런타임 설정 (모델, gitignored)
dashboard/
  server.py              API 서버 (Python 3.10+, stdlib만)
  index.html             단일 파일 대시보드 UI
  provenance.py          인용 파싱 + 커버리지
  index_strategy.py      적응형 인덱싱
  build.py               (선택) wiki → data.json 컴파일러
CLAUDE.md                스키마
.obsidian/               미리 구성된 vault 설정
```

---

## API 레퍼런스

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/status` | Claude CLI + Obsidian 연결 (raw facts) |
| GET | `/api/wiki` | 전체 위키 데이터 |
| GET | `/api/folders` | 폴더 트리 |
| GET | `/api/hash` | 변경 감지 해시 |
| GET | `/api/schema` | CLAUDE.md 읽기 |
| GET | `/api/history` | 수집 커밋 이력 |
| GET | `/api/provenance` | 페이지별 인용 커버리지 |
| GET | `/api/query-stats` | 최근 Wiki Ratio 평균 |
| GET | `/api/index/status` | 현재 인덱싱 전략 |
| GET | `/api/raw/integrity` | raw/ 변조 체크 |
| GET | `/api/reflect/status` | 마지막 성찰 날짜 |
| GET | `/api/review/list` | 30일+ 갱신 안 된 페이지 |
| GET | `/api/settings` | 현재 모델 + 사용 가능한 모델 |
| POST | `/api/settings` | `{model}` — 모델 변경 |
| POST | `/api/ingest` | `{title, content, folder}` — diff + 판단 근거 + 자동 커밋 |
| POST | `/api/query` | `{question}` — files_read + wiki_ratio 추적 |
| POST | `/api/query/save` | `{title, content}` — analysis 페이지로 저장 |
| POST | `/api/lint` / `/api/lint/fix` | 검진 + 자동 수정 |
| POST | `/api/reflect` | `{window}` — 메타 분석 |
| POST | `/api/write` | `{topic, length, style}` — 작성 동반자 |
| POST | `/api/compare` | `{page_a, page_b, save_as?}` |
| POST | `/api/review/refresh` | `{filename}` — 오래된 페이지 갱신 |
| POST | `/api/slides` | `{page}` — Marp 내보내기 |
| POST | `/api/search` | `{query, top_k}` — TF-IDF |
| POST | `/api/suggest/sources` | 다음 수집할 소스 추천 |
| POST | `/api/assistant` | `{question, lang, history}` — 대시보드 도우미 챗봇 |
| POST | `/api/provenance/fix` | `{page}` — 인용 보완 |
| POST | `/api/index/rebuild` | 인덱스 강제 재빌드 |
| POST | `/api/revert` | `{commit_hash}` — 수집 되돌리기 |
| POST | `/api/page` / `/api/page/update` / `/api/page/delete` | 페이지 CRUD |
| POST | `/api/folder` | 폴더 생성 |
| POST | `/api/schema` | CLAUDE.md 수정 |

---

## CLI 사용 (선택)

대시보드의 모든 기능은 터미널에서도 작동합니다:

```bash
claude                                # 대화형
"Ingest raw/some-article.md"
"Self-Attention이 뭐야?"
"Lint the wiki"
"Reflect on the last 10 ingests"
```

---

## 단축키

- `Cmd/Ctrl + B` — 사이드바 접기/펼치기
- `Esc` — 드롭다운 / 모달 닫기

---

## 라이선스

MIT
