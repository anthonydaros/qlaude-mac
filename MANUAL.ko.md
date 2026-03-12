# qlaude 매뉴얼

## 퀵 가이드

```bash
npm install -g qlaude@alpha    # 설치
qlaude                         # 프로젝트 디렉토리에서 실행
```

최초 실행 시 `.qlaude/` 디렉토리가 생성됩니다. `.qlaude/queue` 파일에 프롬프트를 미리 작성할 수 있습니다:

```
@model sonnet
JWT 인증 구현해줘
모든 인증 엔드포인트 단위 테스트 작성해줘
@new
@model opus
전체 코드베이스 보안 리뷰해줘
```

실행 중 `:`를 눌러 커맨드 모드로 진입:

| 커맨드 | 설명 |
|--------|------|
| `:add <프롬프트>` | 큐에 프롬프트 추가 |
| `:pause` / `:resume` | 자동 실행 일시정지 / 재개 |
| `:reload` | `.qlaude/queue`에서 큐 다시 로드 |
| `:save <이름>` / `:load <이름>` | 세션 저장 / 재개 |
| `:model <이름>` | Claude 모델 전환 (예: `opus`, `sonnet`) |

큐 디렉티브(`@new`, `@model`, `@pause`, `@save`, `@load`, `@delay`)로 실행 흐름을 제어합니다. 멀티라인 프롬프트는 인터랙티브에서 `:(` ... `:)`, 큐 파일에서 `@(` ... `@)`을 사용합니다.

텔레그램 원격 제어는 `~/.qlaude/telegram.json`(글로벌)에 봇 토큰과 채팅 ID를 저장하고, `.qlaude/telegram.json`(프로젝트별)에서 활성화하세요. [텔레그램 연동](#텔레그램-연동) 참조.

---

## 목차

- [설치](#설치)
- [설정](#설정)
- [상태바](#상태바)
- [큐 시스템](#큐-시스템)
- [입력 모드](#입력-모드)
- [세션 관리](#세션-관리)
- [큐 파일 포맷](#큐-파일-포맷)
- [대화 로그](#대화-로그)
- [텔레그램 연동](#텔레그램-연동)
- [상태 감지](#상태-감지)
- [패턴 커스터마이즈](#패턴-커스터마이즈)
- [텔레그램 메시지 커스터마이즈](#텔레그램-메시지-커스터마이즈)
- [크래시 복구](#크래시-복구)
- [단축키](#단축키)
- [문제 해결](#문제-해결)

---

## 설치

```bash
npm install -g qlaude@alpha
```

필수 요건:
- Node.js >= 20.19.0
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 설치 및 인증 완료

설치 시 Claude Code 세션 추적을 위한 훅이 자동으로 설정됩니다. 삭제 시 훅도 자동으로 정리됩니다.

### 실행

```bash
qlaude                 # 기본 설정으로 시작
qlaude --resume        # 마지막 Claude Code 세션 재개
qlaude --model opus    # Claude Code 인자 전달
```

`qlaude` 뒤의 모든 표준 인자(`--` 접두사)는 Claude Code에 그대로 전달됩니다.

### qlaude 전용 플래그

qlaude는 Claude Code 플래그와의 충돌을 피하기 위해 트리플 대시(`---`) 접두사를 사용합니다:

| 플래그 | 설명 |
|--------|------|
| `---run` | 배치 모드: `startPaused`를 `false`로 오버라이드하고, 큐 완료 시 자동 종료 (exit 0) 또는 실패 시 종료 (exit 1). `.qlaude/batch-report.json`에 리포트 작성. |
| `---file <경로>` | 지정한 큐 파일을 `.qlaude/queue`에 로드 후 시작. `startPaused`를 `false`로 오버라이드. |

```bash
qlaude ---run                          # 큐 실행 후 종료
qlaude ---file tasks.txt               # 큐 파일 로드 후 시작
qlaude ---run ---file tasks.txt        # 큐 파일 로드, 실행, 종료
qlaude ---run --model opus             # 배치 모드 + Claude Code 플래그
```

#### 배치 리포트

`---run` 사용 시 완료 또는 실패 시점에 `.qlaude/batch-report.json`이 작성됩니다:

```json
{
  "status": "completed",
  "startTime": "2026-01-15T10:00:00.000Z",
  "endTime": "2026-01-15T10:05:30.000Z",
  "durationMs": 330000,
  "itemsExecuted": 5,
  "error": null,
  "queueFile": "tasks.txt"
}
```

`status` 필드는 `"completed"` (exit 0) 또는 `"failed"` (exit 1). 실패 시 `error` 필드에 사유가 포함됩니다 (예: 작업 실패 사유 또는 PTY 종료 코드).

---

## 설정

처음 실행 시 현재 디렉토리에 `.qlaude/` 디렉토리가 자동 생성되며, 설정 템플릿과 빈 큐 파일이 포함됩니다. 디렉토리 구성:

- `.qlaude/config.json` — 공통 설정
- `.qlaude/patterns.json` — 상태 감지 패턴 설정
- `.qlaude/telegram.json` — 텔레그램 설정

설정은 현재 디렉토리의 `.qlaude/` 디렉토리에서 로드됩니다. 파일이 없으면 기본값이 사용됩니다.

### 공통 설정

`.qlaude/config.json`을 편집하여 커스터마이즈합니다:

```json
{
  "startPaused": true,
  "idleThresholdMs": 1000,
  "requiredStableChecks": 3,
  "logLevel": "error",
  "logFile": "debug.log",
  "conversationLog": {
    "enabled": false,
    "filePath": "conversation.log",
    "timestamps": true
  }
}
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `startPaused` | `true` | 자동 실행 일시정지 상태로 시작 |
| `idleThresholdMs` | `1000` | 화면 상태 분석 전 비활동 대기 시간 (ms) |
| `requiredStableChecks` | `3` | READY 전환에 필요한 연속 안정성 검사 횟수 |
| `logLevel` | `"error"` | 로그 레벨: trace, debug, info, warn, error, fatal, silent |
| `logFile` | — | 디버그 로그 파일 경로 (`.qlaude/` 기준 상대경로 또는 절대경로; 설정 시 logLevel이 자동으로 debug로 변경) |
| `conversationLog.enabled` | `false` | 대화 로그 활성화 |
| `conversationLog.filePath` | `"conversation.log"` | 대화 로그 파일 경로 (`.qlaude/` 기준 상대경로 또는 절대경로) |
| `conversationLog.timestamps` | `true` | 로그에 타임스탬프 포함 |

### 텔레그램 설정

텔레그램 설정은 글로벌 자격 증명과 프로젝트별 설정으로 분리됩니다:

**글로벌 자격 증명** (`~/.qlaude/telegram.json`) — 모든 프로젝트에서 공유:

```json
{
  "botToken": "123456:ABC-DEF...",
  "chatId": "987654321"
}
```

**프로젝트별 설정** (`.qlaude/telegram.json`) — 프로젝트별 오버라이드:

```json
{
  "enabled": false,
  "language": "en"
}
```

프로젝트 설정은 글로벌 자격 증명 위에 병합됩니다. 필요하면 프로젝트별로 `botToken`/`chatId`를 오버라이드할 수도 있습니다.

| 옵션 | 위치 | 기본값 | 설명 |
|------|------|--------|------|
| `botToken` | 글로벌 | — | 텔레그램 Bot API 토큰 |
| `chatId` | 글로벌 | — | 대상 채팅 ID |
| `enabled` | 프로젝트 | `false` | 텔레그램 알림 활성화 |
| `language` | 프로젝트 | 자동 | 메시지 언어: `"en"` (영어) 또는 `"ko"` (한국어). 최초 실행 시 시스템 로캘에서 자동 감지. |
| `confirmDelayMs` | 프로젝트 | `30000` | 멀티 인스턴스 폴링 시 업데이트 확인 지연 시간 (ms) |
| `messages` | 프로젝트 | `{}` | 개별 메시지 문자열 오버라이드 (`telegram-messages.ts` 카탈로그 키 사용) |
| `templates` | 프로젝트 | `{}` | 알림 유형별 레이아웃 템플릿 |

### 런타임 파일

`.qlaude/` 디렉토리에는 런타임 파일도 저장됩니다:

- `.qlaude/queue` — 큐 파일
- `.qlaude/session` — 세션 ID 파일
- `.qlaude/session-labels.json` — 세션 레이블
- `.qlaude/queue-logs/` — 큐별 실행 로그
- `.qlaude/messages/` — 언어별 텔레그램 메시지 오버라이드 (`en.json`, `ko.json`)
- `.qlaude/batch-report.json` — 배치 모드 리포트 (`---run` 사용 시)
- `.qlaude/debug.log` — 디버그 로그 (`logFile` 설정 시)
- `.qlaude/conversation.log` — 대화 로그 (활성화 시)

---

## 상태바

qlaude는 터미널 상단에 고정 상태바를 표시합니다. 왼쪽에는 qlaude ASCII 아트 로고, 오른쪽에는 큐 정보가 표시됩니다.

### 상태바 내용

- **항목 수**: 큐의 항목 수 (예: `[3 items]`)
- **실행 상태**: `[running]` 또는 `[paused]`
- **현재 항목**: 큐 항목 실행 중 프롬프트 텍스트가 지속 표시됨 (예: `▶ Fix the login bug...`). 알림 메시지가 있으면 일시적으로 대체됨.
- **큐 미리보기**: 다음 실행될 큐 항목 최대 3개 (타입 태그 포함)
- **알림 메시지**: 임시 메시지 (3초 후 자동 소멸)

### 항목 타입 태그

각 큐 항목은 타입을 나타내는 태그와 함께 표시됩니다:

| 태그 | 의미 |
|------|------|
| (없음) | 일반 프롬프트 |
| `[New Session]` | 새 세션 (`@new` / `:add @new`) |
| `[PAUSE]` | 일시정지 지점 (`@pause`) |
| `[ML]` | 멀티라인 프롬프트 |
| `[SAVE:이름]` | 세션 저장 지점 (`@save`) |
| `[LOAD:이름]` | 세션 로드 지점 (`@load`) |
| `[MODEL:이름]` | 모델 전환 (`@model opus`) |
| `[DELAY:Nms]` | 지연 대기 (`@delay 3000`) |

태그는 조합될 수 있습니다 (예: `[ML] [New Session]`는 멀티라인 새 세션 프롬프트). 자체 설명적 태그(pause, save, load, delay, model, new session)를 가진 항목은 프롬프트 텍스트가 없을 때 `(no prompt)`를 생략합니다.

### 토글

`:status` 명령어로 상태바를 켜고 끌 수 있습니다. 끄면 스크롤 영역이 리셋되고 Claude Code가 전체 화면을 다시 그립니다.

---

## 큐 시스템

큐에 프롬프트를 추가하면 Claude가 작업을 마칠 때마다 자동으로 순차 실행됩니다.

### 큐에 추가

| 명령어 | 설명 |
|--------|------|
| `:add 프롬프트` | 큐에 프롬프트 추가 |
| `:add @new` | 큐에 새 세션 마커 추가 |
| `:add @pause 사유` | 큐에 일시정지 지점 추가 |
| `:add @save 이름` | 큐에 지연 세션 저장 추가 |
| `:add @load 이름` | 큐에 지연 세션 로드 추가 |
| `:add @model 이름` | 큐에 모델 전환 추가 (Claude Code에 `/model 이름` 전송) |
| `:add @delay ms` | 큐에 지연 대기 추가 (예: `:add @delay 3000`) |
| `:add \@텍스트` | 리터럴 `@`로 시작하는 프롬프트 추가 |

### 큐에서 제거

| 명령어 | 설명 |
|--------|------|
| `:drop` | 큐의 마지막 항목 제거 |
| `:clear` | 큐 전체 비우기 |

### 메타 명령어

| 명령어 | 설명 |
|--------|------|
| `:pause` | 자동 실행 일시정지 |
| `:resume` | 자동 실행 재개 |
| `:status` | 상태바 표시/숨김 토글 |
| `:reload` | `.qlaude/queue` 파일에서 큐 다시 읽기 |
| `:help` | 명령어 목록 표시 |
| `:list` | 큐 내용 표시 |
| `:model 이름` | 모델 즉시 전환 (Claude Code에 `/model 이름` 전송) |

### 실행 흐름

1. Claude가 작업 완료 (READY 상태 감지)
2. 자동 실행기가 큐에서 다음 항목을 꺼냄
3. PTY를 통해 Claude Code에 프롬프트 전송
4. Claude가 작업을 마칠 때까지 대기, 반복

자동 실행이 일시정지되는 경우:
- 큐가 비어 있을 때
- 일시정지 지점에 도달했을 때 (큐 파일의 `@pause`)
- Claude가 선택지를 표시할 때 (권한 요청, 파일 선택 등)
- 작업 실패 감지 (`QUEUE_STOP` 마커 또는 rate limit)
- 화면에 스피너가 감지될 때 (안전 일시정지)
- 사용자가 수동으로 일시정지 (`:pause`)

작업 실패 시 현재 항목은 큐 맨 앞에 다시 추가되어 `:resume` 후 재시도됩니다.

### 작업 실패 트리거

Claude 출력에 `QUEUE_STOP`을 포함시켜 의도적으로 큐 실행을 중단할 수 있습니다. Claude가 오류를 스스로 알릴 때 유용합니다:

```
QUEUE_STOP
QUEUE_STOP: 중단 사유
[QUEUE_STOP] 중단 사유
```

감지되면 자동 실행이 중단되고, 현재 항목이 큐 맨 앞에 재추가되며, 텔레그램 알림이 발송됩니다 (활성화된 경우).

Rate limit 메시지 (`You've hit your limit`)도 작업 실패로 감지됩니다.

### 스피너 안전 일시정지

READY 상태가 감지되었지만 화면에 스피너 패턴이 여전히 남아있으면, 다음 프롬프트를 보내는 대신 자동 실행을 일시정지합니다. Claude가 아직 처리 중인데 프롬프트가 전송되는 것을 방지합니다. `:resume`으로 계속할 수 있습니다.

### 큐 이벤트 및 알림

큐 실행 중 qlaude는 전체 큐 라이프사이클을 추적합니다:

- **큐 시작**: 첫 번째 항목이 실행되기 시작할 때 발생. 텔레그램 알림 발송.
- **큐 완료**: 모든 항목이 완료되었을 때 발생. 텔레그램 알림 발송.
- **항목 실행**: 각 항목 실행 후 상태바 업데이트.

이 이벤트들은 개별 항목 실행과 독립적입니다 — 큐 라이프사이클은 첫 항목부터 마지막 항목까지 이어집니다.

---

## 입력 모드

### 일반 모드

일반적으로 입력하면 버퍼에 쌓이고, Enter를 누르면 Claude Code로 전송됩니다.

### 큐 입력 모드

입력 버퍼가 비어있을 때 `:`를 누르면 큐 입력 모드로 진입합니다. 터미널 하단에 `[Q]` 프롬프트가 표시됩니다.

- **Enter**: 큐 명령어 실행
- **Escape**: 취소 후 모드 종료
- **Backspace**: 마지막 문자 삭제
- **Ctrl+U**: 입력 버퍼 전체 삭제

### 멀티라인 모드

여러 줄의 프롬프트를 입력할 때:

```
:(
프롬프트 첫째 줄
프롬프트 둘째 줄
프롬프트 셋째 줄
:)
```

- `:(` 로 시작
- 각 줄은 `[ML N]` 인디케이터와 함께 버퍼에 저장
- `:)`로 입력 종료 및 큐에 추가
- 공백과 들여쓰기가 그대로 유지됨

---

## 세션 관리

### 세션 저장

```
:save 이름
```

현재 Claude Code 세션 ID를 지정한 이름으로 저장합니다. `.qlaude/session-labels.json`에 기록됩니다.

### 세션 불러오기

```
:load 이름
```

Claude Code를 재시작하고 저장된 세션을 재개합니다.

### 동작 원리

- Claude Code 세션 ID는 설치 시 등록된 세션 훅을 통해 자동 캡처됩니다
- 세션 ID는 파일 읽기 경쟁 조건을 방지하기 위해 메모리에 캐시됩니다
- 레이블은 `.qlaude/session-labels.json`에 `{ "레이블": "세션ID" }` 형태로 저장됩니다

---

## 큐 파일 포맷

프로젝트 루트에 `.qlaude/queue` 파일을 생성하면 시작 시 프롬프트가 자동으로 로드됩니다.

### 문법

```
# 주석은 #으로 시작
로그인 버그 수정해줘
인증 모듈 리팩토링

# 새 세션
@new
새로운 작업 시작

# 멀티라인 프롬프트
@(
함수를 작성해줘:
- 숫자 리스트를 받아서
- 정렬된 고유값을 반환
@)

# 일시정지 지점
@pause 계속하기 전에 변경사항 확인

# 세션 관리
@save 체크포인트-1
@load 이전작업

# 모델 전환 (Claude Code에 /model 명령어 전송)
@model opus
복잡한 알고리즘 작성해줘

# 지연 대기 (밀리초)
@delay 3000
이 프롬프트는 3초 지연 후 실행됩니다
```

### 규칙

- 빈 줄과 `#`으로 시작하는 줄(주석)은 무시됩니다
- 일반 텍스트는 프롬프트로 처리됩니다
- `@new`는 새 Claude 세션 마커입니다 (단독 사용, 인라인 프롬프트 없음)
- `@(` ... `@)`는 멀티라인 프롬프트를 감쌉니다 (공백 유지)
- `@pause [사유]`는 일시정지 지점을 설정합니다
- `@save 이름` / `@load 이름`으로 세션을 관리합니다
- `@model 이름`으로 Claude Code 모델을 전환합니다 (Claude Code에 `/model 이름` 전송); 인자 없는 `@model`은 조용히 건너뜀
- `@delay ms`로 지정한 밀리초만큼 큐 실행을 일시정지합니다 (양의 정수 필수; 잘못된 값은 조용히 건너뜀)
- `\@텍스트`는 `@`로 시작하는 프롬프트를 이스케이프합니다 (리터럴 `@`)
- `\\@텍스트`는 `\@`로 시작하는 프롬프트를 이스케이프합니다 (리터럴 `\@`)
- 모든 디렉티브는 대소문자를 가리지 않습니다 (`@NEW`, `@Model`, `@PAUSE` 모두 동작)
- 실행 중 `:reload`로 `.qlaude/queue` 파일을 다시 읽을 수 있습니다
- **큐 항목은 실행될 때마다 `.qlaude/queue`에서 삭제됩니다.** 재사용할 큐 스크립트는 별도 파일로 저장해두고 필요할 때 `.qlaude/queue`로 복사하세요

---

## 대화 로그

qlaude는 큐 실행 이력과 Claude Code 대화를 파일로 기록하여 검토할 수 있습니다.

### 큐 실행 로그

각 큐 실행은 `.qlaude/queue-logs/`에 타임스탬프가 포함된 별도 파일로 생성됩니다 (예: `queue-2026-02-18T09-30-00.log`).

로그에 포함되는 내용:
- 큐 시작/완료 마커와 타임스탬프
- 실행되는 각 큐 항목 (타입 포함: `@new`, `@pause`, `@save`, `@load` 등)
- 멀티라인 항목의 전체 프롬프트 내용
- 세션 전환 (새 세션 시작, 세션 로드)
- Claude Code의 JSONL 세션 파일에서 추출한 대화 내용

텔레그램 `/log` 명령어로 가장 최근 큐 로그 파일을 전송받을 수 있습니다.

### 대화 추출

`conversationLog.enabled`가 `true`이면, qlaude는 Claude Code의 내부 JSONL 세션 파일에서 Q&A 대화를 추출합니다. 대화는 다음 시점에 추출됩니다:

- 새 세션이 시작될 때 (전환 전)
- 큐 실행이 완료될 때
- 텔레그램 `/log` 명령어를 받았을 때

추출은 증분 방식으로 수행됩니다 — 마지막 추출 이후 새로운 대화만 기록되므로 중복이 방지됩니다.

### 설정

`.qlaude/config.json`에서 활성화:

```json
{
  "conversationLog": {
    "enabled": true,
    "filePath": "conversation.log",
    "timestamps": true
  }
}
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `enabled` | `false` | 대화 로그 활성화 |
| `filePath` | `"conversation.log"` | 로그 파일 경로 (`.qlaude/` 기준 상대경로 또는 절대경로) |
| `timestamps` | `true` | 추출된 대화에 타임스탬프 포함 |

---

## 텔레그램 연동

### 설정 방법

1. [@BotFather](https://t.me/BotFather)에서 텔레그램 봇 생성
2. 채팅 ID 확인 (봇에 메시지를 보낸 후 `https://api.telegram.org/bot<TOKEN>/getUpdates` 확인)
3. `~/.qlaude/telegram.json`에 자격 증명 저장 (글로벌, 모든 프로젝트에서 공유):

```json
{
  "botToken": "123456:ABC-DEF...",
  "chatId": "987654321"
}
```

4. 프로젝트별 `.qlaude/telegram.json`에서 활성화:

```json
{
  "enabled": true
}
```

최초 실행 시 셋업 위저드를 통해 대화형으로 설정할 수도 있습니다.

### 알림

qlaude가 텔레그램 메시지를 보내는 경우:

| 이벤트 | 설명 | 버튼 |
|--------|------|------|
| 선택지 표시 | Claude가 사용자 입력 필요 (권한 요청, 선택 UI) | 숫자 버튼 + 취소 |
| 중단점 | 큐가 중단점에 도달 | 재개 |
| 큐 시작 | 자동 실행 시작됨 | — |
| 큐 완료 | 모든 큐 항목 실행 완료 | — |
| 작업 실패 | `QUEUE_STOP` 또는 rate limit 감지 | 재개 |
| PTY 크래시 | Claude Code 프로세스 크래시 (자동 복구 진행 중) | — |

각 알림에는 인스턴스 ID, 호스트명, IP 주소, 프로젝트명이 포함되어 식별이 가능합니다.

선택지 알림은 모든 옵션이 렌더링될 때까지 대기 후 발송됩니다 (800ms 안정화 지연). 동일한 화면 내용에 대한 중복 알림은 자동으로 억제됩니다.

### 원격 명령어

봇에 메시지로 전송합니다:

| 명령어 | 설명 |
|--------|------|
| `/status 인스턴스` | PTY 상태, 상태, 자동실행 상태, 큐 개수 표시 |
| `/pause 인스턴스` | 자동 실행 일시정지 |
| `/resume 인스턴스` | 자동 실행 재개 |
| `/log 인스턴스` | 큐 로그 파일과 세션 대화 로그를 문서로 전송 |
| `/display 인스턴스` | 터미널 화면 버퍼 마지막 25줄 표시 (ANSI 정리, 코드 블록) |
| `/send 인스턴스 텍스트` | 텍스트 + Enter를 Claude Code에 전송 |
| `/key 인스턴스 텍스트` | 텍스트만 전송, Enter 없음 (부분 입력용) |

`인스턴스`는 알림 메시지에 표시되는 `호스트명:PID` 식별자입니다.

`/send`와 `/key`는 인스턴스가 하나일 때 인스턴스 ID를 생략할 수 있습니다:

```
/send 로그인 버그 수정해줘          # 인스턴스 ID 없음 (단일 인스턴스)
/send myhost:12345 버그 수정해줘    # 인스턴스 ID 포함 (멀티 인스턴스)
```

### 선택지 응답

선택지 알림이 도착했을 때:

- **숫자 버튼 (1-16)**: 해당 옵션 선택
- **연필 버튼 (N+연필 아이콘)**: 옵션 N 선택 후 추가 텍스트 입력 (봇이 답장으로 입력 요청)
- **취소 버튼**: Escape 전송하여 선택 취소

### 텍스트 입력 감지

텍스트 입력이 필요한 옵션은 옵션 텍스트의 키워드 매칭으로 자동 감지됩니다 (예: "type", "enter", "input", "custom", "specify", "other", `...`로 끝나는 텍스트). 이런 옵션은 텔레그램 버튼에 연필 아이콘(✏️)으로 표시됩니다.

연필 버튼을 누르면 봇이 ForceReply 메시지로 텍스트 입력을 요청합니다. 답장으로 보낸 텍스트는 옵션 번호 → 대기 → 텍스트 → Enter 순서로 전송됩니다.

텍스트 입력 키워드는 `.qlaude/patterns.json`의 `textInputKeywords`에서 커스터마이즈할 수 있습니다. [패턴 커스터마이즈](#패턴-커스터마이즈) 참조.

### 알림 직접 답장

알림 메시지에 직접 답장하여 Claude Code에 텍스트를 보낼 수 있습니다. 답장된 텍스트는 Enter와 함께 전송되며, `/send 텍스트`와 동일합니다. 전체 명령어를 입력하지 않고 Claude의 질문에 빠르게 응답할 때 유용합니다.

### 멀티 인스턴스

여러 qlaude 인스턴스가 같은 텔레그램 봇을 공유할 수 있습니다. 각 인스턴스는 `호스트명:PID`로 식별됩니다. 인스턴스 ID가 없는 명령어는 `/pause`, `/resume`, `/status`, `/log`, `/display`의 경우 모든 인스턴스에 브로드캐스트됩니다. `/send`와 `/key`는 첫 단어에 콜론이 있으면 인스턴스 ID로 판단합니다.

`confirmDelayMs` 설정 (기본 30000ms)은 업데이트가 모든 인스턴스에 표시된 후 확인되기까지의 대기 시간을 제어합니다. 한 인스턴스가 업데이트를 소비하기 전에 다른 인스턴스도 볼 수 있도록 합니다.

### 수동 스모크 체크리스트

임시 테스트 파일을 저장소에 추가하지 않고, 실제 CLI 상태를 재사용하지 않은 채로 텔레그램 제어를 로컬에서 검증할 때 사용합니다.

1. HOME과 워크스페이스용 임시 디렉토리를 생성합니다:

```bash
SMOKE_HOME="$(mktemp -d -t qlaude-home)"
SMOKE_WORKSPACE="$(mktemp -d -t qlaude-telegram-smoke)"
mkdir -p "$SMOKE_HOME/.qlaude" "$SMOKE_WORKSPACE/.qlaude"
printf 'queue log from manual smoke\n' > "$SMOKE_WORKSPACE/.qlaude/queue.log"
```

2. 임시 HOME에 글로벌 텔레그램 자격 증명을 저장합니다:

```bash
cat > "$SMOKE_HOME/.qlaude/telegram.json" <<'JSON'
{
  "botToken": "123456:ABC-DEF...",
  "chatId": "987654321"
}
JSON
chmod 600 "$SMOKE_HOME/.qlaude/telegram.json"
```

3. 임시 워크스페이스에서 텔레그램을 활성화합니다:

```bash
cat > "$SMOKE_WORKSPACE/.qlaude/telegram.json" <<'JSON'
{
  "enabled": true
}
JSON
chmod 600 "$SMOKE_WORKSPACE/.qlaude/telegram.json"
```

4. 격리된 상태로 qlaude를 실행합니다:

```bash
cd "$SMOKE_WORKSPACE" && HOME="$SMOKE_HOME" qlaude
```

현재 저장소 체크아웃을 전역 설치 대신 검증하려면 다음 명령을 사용합니다:

```bash
cd "$SMOKE_WORKSPACE" && HOME="$SMOKE_HOME" node /absolute/path/to/qlaude/dist/main.js
```

5. 봇에 다음 명령을 보내고 응답을 확인합니다:

- `/status`
  - 인스턴스 ID, 워크스페이스 이름, PTY 상태, 현재 상태, 자동 실행 상태, 큐 개수가 표시되어야 합니다.
- `/display`
  - ANSI 이스케이프가 제거된 최신 터미널 버퍼가 코드 블록으로 표시되어야 합니다.
- `/log`
  - 큐 로그 또는 세션 로그가 있으면 하나 이상의 문서 답장이 와야 합니다.
  - 로그가 아직 없으면 설정된 "로그 없음" 응답이 와야 합니다.

6. 다운로드한 `/log` 첨부 파일이 예상한 큐 또는 세션 내용과 일치하는지 확인합니다.

7. 스모크 테스트가 끝나면 정리합니다:

```bash
rm -rf "$SMOKE_HOME" "$SMOKE_WORKSPACE"
```

스모크 중 봇 토큰이 채팅, 로그, 스크린샷, 녹화 등에 노출되었다면 종료 후 BotFather에서 즉시 토큰을 교체하세요.

---

## 상태 감지

qlaude는 Claude Code의 터미널 출력을 모니터링하여 상태를 판별합니다.

### 상태 종류

| 상태 | 설명 |
|------|------|
| PROCESSING | Claude가 출력 생성 중 |
| READY | Claude가 입력 대기 중 |
| SELECTION_PROMPT | Claude가 선택 UI를 표시 중 |
| TASK_FAILED | `QUEUE_STOP` 마커 또는 rate limit 감지 |
| INTERRUPTED | 작업이 중단됨 (오감지율이 높아 차단/알림에는 사용하지 않음) |

### 감지 우선순위

상태는 다음 우선순위로 검사됩니다 (높은 순):

1. **TASK_FAILED**: `QUEUE_STOP` / `[QUEUE_STOP]` 마커 또는 rate limit 메시지
2. **INTERRUPTED**: `^C`, `Interrupted`, `operation cancelled` (감지되지만 큐를 차단하지 않음)
3. **SELECTION_PROMPT**: `[Y/n]`, `❯ N.`, `Enter to select`, 번호 선택지
4. **READY**: 차단 패턴 없음 + `requiredStableChecks`회 연속 화면 안정

### 감지 과정

1. PTY 출력이 헤드리스 xterm 터미널 에뮬레이터(xterm.js headless)에 기록됨
2. `idleThresholdMs` (기본 1초) 동안 출력이 없으면 화면 마지막 25줄을 분석
3. Tip 라인 (`⎿` 또는 `Tip:` 포함)을 필터링하여 오감지 방지
4. 프롬프트 구분선 (10자 이상 `─` 라인) 아래 영역을 분석 대상으로 추출
5. 우선순위 순서로 패턴 매칭하여 상태 판별
6. READY의 경우, `requiredStableChecks` (기본 3)회 연속 동일 화면이어야 확정
7. READY 조건과 함께 스피너 패턴이 감지되면 `hasSpinner` 메타데이터 설정 (안전 일시정지 트리거)
8. 상태 변경 시 자동 실행기 동작 및 텔레그램 알림 발송

### 감지 패턴

qlaude는 각 상태를 감지하기 위해 정규식 패턴을 사용합니다. 모든 패턴은 `.qlaude/patterns.json`으로 커스터마이즈 가능합니다. 자세한 내용은 [패턴 커스터마이즈](#패턴-커스터마이즈) 참조.

**선택지 감지 패턴** (기본값):
- `[Y/n]` 또는 `[y/N]` — 예/아니오 확인
- `❯ N.` — 화살표 커서와 번호 옵션
- `Enter to select · ↑/↓ to navigate` — Claude Code 선택 UI 푸터
- `←/→ or tab to cycle` — 탭 순환 UI
- `> N. 텍스트` — `>` 접두사와 번호 옵션

**스피너 패턴** (내장, 커스텀 불가):
- 줄 시작이 스피너 문자(`✻`, `·`, `*` 등)이고 줄 끝이 `…` (말줄임표)인 경우
- 예시: `✻ Reading file…`, `* Imagining… (55s · ↓ 1.2k tokens · thinking)`

**작업 실패 패턴** (기본값):
- `QUEUE_STOP` 또는 `QUEUE_STOP: 사유`
- `[QUEUE_STOP]` 또는 `[QUEUE_STOP] 사유`
- `You've hit your limit` (rate limit)

**중단 감지 패턴** (기본값):
- `Interrupted`, `^C`, `operation cancelled`, `request aborted`, `was interrupted`

### 튜닝

스피너가 화면에 표시되어 있으면 타이밍 설정과 관계없이 스피너 안전 일시정지가 조기 실행을 방지합니다. 그러나 Claude가 스피너 없이 출력 사이에 멈추는 경우(예: 도구 호출 사이, 긴 내부 처리 중)에는 READY 오감지가 발생할 수 있습니다.

READY 오감지가 빈번할 때 (Claude가 작업 중인데 다음 프롬프트가 전송됨):
- `idleThresholdMs` 증가 (예: 5000–8000) — 분석 전 더 긴 무출력 시간 요구
- `requiredStableChecks` 증가 (예: 5) — 더 많은 연속 안정 화면 요구

READY 감지가 너무 느릴 때 (Claude가 실제로 완료된 후 체감 지연이 있음):
- `idleThresholdMs` 감소 (예: 500–800)
- `requiredStableChecks` 감소 (최소 1)

---

## 패턴 커스터마이즈

대부분의 상태 감지 패턴은 `.qlaude/patterns.json`에서 커스터마이즈할 수 있습니다. 각 패턴 카테고리를 독립적으로 설정 가능합니다.

> **참고:** `.qlaude/patterns.json` 파일은 기본적으로 비어있습니다 (`{}`). 특정 카테고리를 오버라이드할 때만 항목을 추가하세요. 누락된 카테고리는 항상 최신 내장 기본값을 사용하므로, 업그레이드 시 버그 수정과 개선 사항이 자동 적용됩니다.

> **참고:** 스피너 감지는 내장 패턴을 사용하며 `patterns.json`으로 커스텀할 수 없습니다. 이전 버전의 `spinner` 항목이 `patterns.json`에 남아있어도 무시됩니다.

### 패턴 카테고리

| 카테고리 | 설명 | 기본 개수 |
|----------|------|-----------|
| `selectionPrompt` | 선택지/권한 UI 감지 패턴 | 6개 |
| `interrupted` | 중단 감지 패턴 | 5개 |
| `taskFailure` | 작업 실패 마커 감지 패턴 | 3개 |
| `textInputKeywords` | 텍스트 입력 옵션 감지 키워드 (텔레그램) | 9개 |
| `optionParse` | 번호 옵션 파싱 패턴 (단일) | 1개 |
| `tipFilter` | Tip 라인 필터링 키워드 (부분 문자열 매칭) | 2개 |
| `promptSeparator` | 프롬프트 구분선 감지 패턴 | 1개 |

### 오버라이드 규칙

다중 패턴 카테고리 (`selectionPrompt`, `interrupted`, `taskFailure`, `textInputKeywords`):

| 설정 | 동작 |
|------|------|
| 파일에서 카테고리 누락 | 기본값 사용 |
| `"enabled": false` | 카테고리 전체 비활성화 |
| `"patterns": [...]` (비어있지 않음) | 기본값을 커스텀 패턴으로 **대체** |
| `"patterns": []` (빈 배열) | 카테고리 비활성화 (`enabled: false`와 동일) |

커스텀 패턴은 기본값을 **완전히 대체**합니다 — 병합되지 않습니다. 기본값에 패턴을 추가하려면 모든 기본 패턴을 포함한 뒤 추가 패턴을 넣어야 합니다.

### 패턴 항목 형식

패턴은 일반 문자열 (정규식 소스) 또는 플래그가 포함된 객체로 지정할 수 있습니다:

```json
{
  "selectionPrompt": {
    "patterns": [
      "\\[Y/n\\]",
      { "pattern": "enter to select", "flags": "i" },
      "❯\\s*\\d+\\.\\s"
    ]
  }
}
```

### 예시

**커스텀 작업 실패 패턴 추가**:

```json
{
  "taskFailure": {
    "patterns": [
      "QUEUE_STOP(?::\\s*(.+?))?(?:\\n|$)",
      "\\[QUEUE_STOP\\](?:\\s*(.+?))?(?:\\n|$)",
      "You['\\u2019]ve hit your limit",
      "CUSTOM_ERROR_MARKER"
    ]
  }
}
```

**텍스트 입력 키워드 커스터마이즈** (텔레그램 연필 버튼):

```json
{
  "textInputKeywords": {
    "patterns": [
      "\\btype\\b",
      "\\benter\\b",
      "\\binput\\b",
      "\\bcustom\\b",
      "\\bspecify\\b",
      "\\bother\\b",
      "\\.{2,}$"
    ]
  }
}
```

**옵션 파싱 패턴 커스터마이즈**:

```json
{
  "optionParse": {
    "pattern": "^[\\s❯>]*(\\d+)\\.\\s+(.+)$"
  }
}
```

`"pattern": ""`으로 설정하면 옵션 파싱을 비활성화합니다.

**Tip 라인 필터링 커스터마이즈**:

```json
{
  "tipFilter": {
    "keywords": ["⎿", "Tip:", "Hint:"]
  }
}
```

`"enabled": false`로 Tip 필터링을 비활성화할 수 있습니다.

**프롬프트 구분선 커스터마이즈**:

```json
{
  "promptSeparator": {
    "pattern": "^─+$",
    "minLength": 10
  }
}
```

---

## 텔레그램 메시지 커스터마이즈

텔레그램 알림 메시지는 두 가지 레벨에서 커스터마이즈할 수 있습니다: 개별 메시지 문자열과 알림 레이아웃 템플릿.

### 메시지 오버라이드

`.qlaude/telegram.json`의 `messages`에서 개별 메시지 문자열을 오버라이드합니다. 키는 내부 메시지 카탈로그와 일치합니다. 오버라이드는 `language` 설정에 관계없이 적용됩니다.

```json
{
  "messages": {
    "notify.queue_completed": "모두 완료!",
    "notify.task_failed": "문제가 발생했습니다",
    "queue.items": "📋 {count}개 작업 남음",
    "button.cancel": "❌ 중단"
  }
}
```

#### 사용 가능한 메시지 키

**알림 제목** (`notify.*`):
- `notify.selection_prompt` — 선택지 알림 제목 (기본: "Input Required" / "입력 필요")
- `notify.interrupted` — 중단 제목
- `notify.breakpoint` — 중단점 제목
- `notify.queue_started` — 큐 시작 제목
- `notify.queue_completed` — 큐 완료 제목
- `notify.task_failed` — 작업 실패 제목
- `notify.pty_crashed` — PTY 크래시 복구 제목

**큐 정보** (`queue.*`):
- `queue.items` — 큐 항목 수 (플레이스홀더: `{count}`)
- `queue.label` — 큐 라벨

**버튼** (`button.*`):
- `button.cancel` — 취소 버튼 텍스트

**명령어 응답** (`cmd.*`):
- `cmd.paused` / `cmd.resumed` — 일시정지/재개 확인
- `cmd.paused_broadcast` / `cmd.resumed_broadcast` — 브로드캐스트 버전 (플레이스홀더: `{instanceId}`)
- `cmd.instance_required` — 인스턴스 필요 메시지 (플레이스홀더: `{cmd}`, `{instanceId}`)
- `cmd.send_usage` / `cmd.key_usage` — 사용법 안내
- `cmd.sent` / `cmd.sent_instance` — 전송 확인 (플레이스홀더: `{text}`, `{instanceId}`)
- `cmd.key_sent` / `cmd.key_sent_instance` — 키 입력 확인

**텍스트 입력 흐름** (`textinput.*`):
- `textinput.callback` — 버튼 클릭 확인 (플레이스홀더: `{n}`)
- `textinput.prompt` — 답장 요청 (플레이스홀더: `{n}`)
- `textinput.placeholder` — 입력 필드 플레이스홀더
- `textinput.confirmed` — 확인 (플레이스홀더: `{n}`, `{text}`)

**상태** (`status.*`):
- `status.header` — 상태 보고서 헤더
- `status.pty_running` / `status.pty_stopped` — PTY 상태
- `status.pty` — PTY 줄 (플레이스홀더: `{status}`)
- `status.state` — 상태 줄 (플레이스홀더: `{state}`)
- `status.autoexec_paused` / `status.autoexec_active` — 자동실행 상태
- `status.autoexec` — 자동실행 줄 (플레이스홀더: `{status}`)

**로그** (`log.*`):
- `log.queue_caption` — 큐 로그 캡션 (플레이스홀더: `{instanceId}`)
- `log.session_caption` — 세션 로그 캡션
- `log.none` — 로그 없음 메시지
- `log.sent` — 로그 전송 확인 (플레이스홀더: `{count}`)

**디스플레이** (`display.*`):
- `display.empty` — 빈 화면 메시지

메시지 문자열은 `{플레이스홀더}` 보간을 지원합니다. 우선순위: 사용자 오버라이드 > 언어별 > 영어 폴백.

### 레이아웃 템플릿

`.qlaude/telegram.json`의 `templates`에서 알림 전체 레이아웃을 오버라이드합니다. 템플릿은 `{변수}` 플레이스홀더를 사용합니다. 모든 변수는 원시 데이터(MarkdownV2 이스케이프만 적용)이므로 이모지와 포맷팅은 직접 작성합니다.

```json
{
  "templates": {
    "selection_prompt": "⚠️ *{title}*\n\n🖥️ {hostname} \\({ip}\\)\n📁 {project}\n📋 {queueLength}\n\n{context}\n{options}",
    "breakpoint": "⏸️ *{title}*\n📁 {project}\n💬 {reason}",
    "task_failed": "❌ *{title}*\n⚠️ {error}\n📋 {queueLength}",
    "default": "🤖 *[qlaude]* *{title}*\n🖥️ {hostname}\n📁 {project}"
  }
}
```

#### 공통 변수 (모든 알림 타입)

| 변수 | 설명 | 예시 |
|------|------|------|
| `{title}` | 이벤트 제목 (로컬라이즈) | `입력 필요` |
| `{hostname}` | 호스트명 | `myhost` |
| `{ip}` | IP 주소 | `192.168.1.1` |
| `{instanceId}` | 인스턴스 식별자 | `myhost:12345` |
| `{project}` | 프로젝트명 | `my-project` |
| `{queueLength}` | 큐 항목 수 | `3` |

#### 타입별 변수

| 타입 | 변수 | 설명 | 예시 |
|------|------|------|------|
| breakpoint | `{reason}` | 일시정지 사유 | `결과 확인` |
| task_failed | `{error}` | 실패 메시지 | `Rate limit exceeded` |
| pty_crashed | `{recovery}` | 복구 상태 | `Resuming session...` |
| selection_prompt | `{context}` | 화면 컨텍스트 (코드 블록) | ````...```` |
| selection_prompt | `{options}` | 파싱된 옵션 목록 | `1. 옵션 하나` |

템플릿은 알림 유형별 (`selection_prompt`, `breakpoint`, `queue_started`, `queue_completed`, `task_failed`, `pty_crashed`) 또는 `default` 폴백으로 설정할 수 있습니다. 변수 치환 후 비어지는 줄은 자동으로 제거됩니다.

---

## 크래시 복구

qlaude는 큐 실행 중 Claude Code 크래시를 자동으로 복구합니다.

### PTY 크래시 복구

큐 실행 중 Claude Code 프로세스가 예상치 못하게 종료될 때 (비정상 종료 코드):

1. 현재 실행 중인 항목이 큐 맨 앞에 재추가됩니다
2. 마지막으로 알려진 세션 ID로 `--resume`하여 Claude Code 재시작을 시도합니다
3. 세션 ID가 없으면 새로 시작합니다
4. 텔레그램 알림이 발송됩니다 (활성화된 경우)
5. 중단된 지점부터 큐 실행이 계속됩니다

Claude Code가 **연속 3회** 크래시하면 무한 재시작 루프를 방지하기 위해 자동 실행을 중지합니다. 크래시 카운터는 항목이 성공적으로 실행될 때마다 리셋됩니다. 제한 도달 시:
- 남은 항목을 큐에 보존한 채 자동 실행 일시정지
- 텔레그램 알림 발송
- Claude Code는 대기 모드로 재시작 (큐 실행 없음)
- `:resume`으로 수동 재시도 가능

### 세션 로드 실패 복구

저장된 세션 로드가 실패했을 때 (예: 만료되거나 잘못된 세션 ID):

1. PTY가 비정상 종료됨
2. qlaude가 세션 로드 시도였음을 감지
3. 실패한 항목을 큐 맨 앞에 재추가
4. Claude Code를 `--resume` 없이 새로 시작
5. 사용자 확인을 위해 자동 실행 일시정지
6. 텔레그램 알림 발송

### 새 세션 재시도

새 세션 시작(`:add @new` / `@new`)이 실패했을 때:

1. 1초 지연 후 1회 재시도
2. 재시도도 실패하면 항목을 큐 맨 앞에 재추가
3. 자동 실행 일시정지
4. 텔레그램 알림 발송

---

## 단축키

### 일반 모드

| 키 | 동작 |
|----|------|
| Enter | 현재 입력을 Claude Code에 전송 |
| Backspace | 입력 버퍼에서 마지막 문자 삭제 |
| Ctrl+U | 입력 버퍼 전체 삭제 |
| Ctrl+C | Claude Code에 인터럽트 시그널(SIGINT) 전송 |
| `:` | 큐 입력 모드 진입 (입력 버퍼가 비어있을 때) |
| `:(` | 멀티라인 모드 진입 |

### 큐 입력 모드

| 키 | 동작 |
|----|------|
| Enter | 큐 명령어 실행 |
| Escape | 취소 후 모드 종료 |
| Backspace | 마지막 문자 삭제 |
| Ctrl+U | 입력 버퍼 전체 삭제 |

### 멀티라인 모드

| 키 | 동작 |
|----|------|
| Enter | 현재 줄을 버퍼에 추가 (또는 줄이 `:)`이면 제출) |
| Backspace | 마지막 문자 삭제 |
| Ctrl+U | 현재 줄 삭제 |

---

## 문제 해결

### 디버그 로그 활성화

`.qlaude/config.json`에 추가:

```json
{
  "logFile": "debug.log"
}
```

로그 레벨이 자동으로 debug로 설정됩니다. 상태 전환, 패턴 매칭, 화면 스냅샷을 확인할 수 있습니다.

### 자주 발생하는 문제

**큐가 실행되지 않음**: 자동 실행이 일시정지되었는지 확인합니다 (`:resume`으로 재개). 상태바에 큐 개수와 `[running]` 상태가 표시되는지 확인합니다.

**READY 오감지**: Claude가 출력 사이에 긴 멈춤이 있을 수 있습니다. `idleThresholdMs` 또는 `requiredStableChecks`를 증가시킵니다.

**SELECTION_PROMPT 오감지**: Claude 출력이 선택지 패턴과 일치할 수 있습니다. 디버그 로그에서 `bufferSnapshot`을 확인하여 감지 원인을 파악합니다. `.qlaude/patterns.json`에서 선택지 감지 패턴을 커스터마이즈할 수 있습니다.

**스피너 안전 일시정지 오작동**: 내장 스피너 패턴이 스피너가 아닌 내용과 매칭될 수 있습니다. 디버그 로그에서 `Spinner pattern matched`를 확인하여 원인을 파악합니다. 반복되는 문제라면 이슈로 보고해 주세요.

**텔레그램 미동작**: `~/.qlaude/telegram.json`(글로벌 자격 증명)의 `botToken`과 `chatId`, `.qlaude/telegram.json`(프로젝트별)의 `enabled`를 확인합니다. 봇이 해당 채팅에 메시지를 보낼 권한이 있는지 확인합니다. 디버그 로그에서 텔레그램 관련 오류를 확인합니다.

**텔레그램 텍스트 입력 버튼 미표시**: 텍스트 입력 감지는 키워드 매칭에 의존합니다. 옵션이 비표준 표현을 사용하면 `.qlaude/patterns.json`의 `textInputKeywords`에 키워드를 추가합니다.

**세션 레이블 로드 실패**: `.qlaude/session-labels.json` 파일이 존재하고 해당 레이블이 포함되어 있는지 확인합니다. 세션 ID는 만료되지 않은 유효한 Claude Code 세션이어야 합니다.

**설정 파일이 생성되지 않음**: `.qlaude/` 디렉토리는 존재하지만 설정 파일이 없는 경우, 다음 qlaude 시작 시 자동으로 생성됩니다. 큐나 세션 작업이 설정 초기화보다 먼저 디렉토리를 생성한 경우 발생할 수 있습니다.

**큐 실행 중 Claude Code 크래시**: qlaude가 자동으로 복구합니다 — [크래시 복구](#크래시-복구) 참조. 크래시와 복구 과정의 세부 사항은 디버그 로그에서 확인합니다.

**Windows 터미널 문제**: Windows에서는 [Windows Terminal](https://aka.ms/terminal) 또는 VS Code 통합 터미널을 사용하세요. 기본 cmd.exe 및 PowerShell 콘솔은 지원되지 않습니다. qlaude는 Windows의 Claude Code >= 2.1.30에 대한 자동 워크어라운드를 포함합니다.
