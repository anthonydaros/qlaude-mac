# qlaude 매뉴얼

## 목차

- [설치](#설치)
- [설정](#설정)
- [큐 시스템](#큐-시스템)
- [입력 모드](#입력-모드)
- [세션 관리](#세션-관리)
- [큐 파일 포맷](#큐-파일-포맷)
- [텔레그램 연동](#텔레그램-연동)
- [상태 감지](#상태-감지)
- [문제 해결](#문제-해결)

---

## 설치

```bash
npm install -g qlaude@alpha
```

필수 요건:
- Node.js >= 20.0.0
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 설치 및 인증 완료

설치 시 Claude Code 세션 추적을 위한 훅이 자동으로 설정됩니다. 삭제 시 훅도 자동으로 정리됩니다.

### 실행

```bash
qlaude                 # 기본 설정으로 시작
qlaude --resume        # 마지막 Claude Code 세션 재개
qlaude --model opus    # Claude Code 인자 전달
```

`qlaude` 뒤의 모든 인자는 Claude Code에 그대로 전달됩니다.

---

## 설정

처음 실행 시 현재 디렉토리에 `.qlauderc.json` (설정 템플릿)과 `.qlaude-queue` (빈 큐 파일)가 자동 생성됩니다.

`.qlauderc.json`을 편집하여 설정을 커스터마이즈합니다:

```json
{
  "startPaused": false,
  "idleThresholdMs": 5000,
  "requiredStableChecks": 2,
  "logLevel": "error",
  "logFile": ".qlaude-debug.log",
  "conversationLog": {
    "enabled": true,
    "filePath": ".qlaude-conversation.log",
    "timestamps": true
  },
  "telegram": {
    "enabled": false,
    "botToken": "your-bot-token",
    "chatId": "your-chat-id",
    "language": "ko"
  }
}
```

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `startPaused` | `false` | 자동 실행 일시정지 상태로 시작 |
| `idleThresholdMs` | `5000` | 화면 상태 분석 전 비활동 대기 시간 (ms) |
| `requiredStableChecks` | `2` | READY 전환에 필요한 연속 안정성 검사 횟수 |
| `logLevel` | `"error"` | 로그 레벨: trace, debug, info, warn, error, fatal, silent |
| `logFile` | — | 디버그 로그 파일 경로 (설정 시 logLevel이 자동으로 debug로 변경) |
| `conversationLog.enabled` | `false` | 대화 로그 활성화 |
| `conversationLog.filePath` | `".qlaude-conversation.log"` | 대화 로그 파일 경로 |
| `conversationLog.timestamps` | `true` | 로그에 타임스탬프 포함 |
| `telegram.enabled` | `false` | 텔레그램 알림 활성화 |
| `telegram.botToken` | — | 텔레그램 Bot API 토큰 |
| `telegram.chatId` | — | 대상 채팅 ID |
| `telegram.language` | `"ko"` | 텔레그램 메시지 언어: `"ko"` (한국어) 또는 `"en"` (영어) |

---

## 큐 시스템

큐에 프롬프트를 추가하면 Claude가 작업을 마칠 때마다 자동으로 순차 실행됩니다.

### 큐에 추가

| 명령어 | 설명 |
|--------|------|
| `>> 프롬프트` | 큐에 프롬프트 추가 |
| `>>> 프롬프트` | 새 Claude 세션 시작 후 프롬프트 실행 |
| `>># 설명` | 중단점 추가 (자동 실행 일시정지) |
| `>>#` | 설명 없이 중단점 추가 |

### 큐에서 제거

| 명령어 | 설명 |
|--------|------|
| `<<` | 큐의 마지막 항목 제거 |

### 메타 명령어

| 명령어 | 설명 |
|--------|------|
| `:pause` | 자동 실행 일시정지 |
| `:resume` | 자동 실행 재개 |
| `:status` | 상태바 표시/숨김 토글 |
| `:reload` | `.qlaude-queue` 파일에서 큐 다시 읽기 |

### 실행 흐름

1. Claude가 작업 완료 (READY 상태 감지)
2. 자동 실행기가 큐에서 다음 항목을 꺼냄
3. PTY를 통해 Claude Code에 프롬프트 전송
4. Claude가 작업을 마칠 때까지 대기, 반복

자동 실행이 일시정지되는 경우:
- 큐가 비어 있을 때
- 중단점에 도달했을 때
- Claude가 선택지를 표시할 때 (권한 요청, 파일 선택 등)
- 작업 실패 감지 (`QUEUE_STOP` 마커 또는 rate limit)
- 사용자가 수동으로 일시정지 (`:pause`)

작업 실패 시 현재 항목은 큐 맨 앞에 다시 추가되어 `:resume` 후 재시도됩니다.

---

## 입력 모드

### 일반 모드

일반적으로 입력하면 버퍼에 쌓이고, Enter를 누르면 Claude Code로 전송됩니다.

### 큐 입력 모드

입력 버퍼가 비어있을 때 `:` 또는 `>`를 누르면 큐 입력 모드로 진입합니다. 터미널 하단에 `[Q]` 프롬프트가 표시됩니다.

- **Enter**: 큐 명령어 실행
- **Escape**: 취소 후 모드 종료
- **Backspace**: 마지막 문자 삭제
- **Ctrl+U**: 입력 버퍼 전체 삭제

### 멀티라인 모드

여러 줄의 프롬프트를 입력할 때:

```
>>(
프롬프트 첫째 줄
프롬프트 둘째 줄
프롬프트 셋째 줄
>>)
```

- `>>(` (또는 새 세션의 경우 `>>>(`로 시작
- 각 줄은 `[ML N]` 인디케이터와 함께 버퍼에 저장
- `>>)`로 입력 종료 및 큐에 추가
- 공백과 들여쓰기가 그대로 유지됨

---

## 세션 관리

### 세션 저장

```
>>{Label:이름}
```

현재 Claude Code 세션 ID를 지정한 이름으로 저장합니다. `.qlaude-session-labels.json`에 기록됩니다.

### 세션 불러오기

```
>>{Load:이름}
```

Claude Code를 재시작하고 저장된 세션을 재개합니다.

```
>>>{Load:이름} 프롬프트
```

세션을 불러온 후 프롬프트를 큐에 추가하여 재개 직후 실행합니다.

### 동작 원리

- Claude Code 세션 ID는 설치 시 등록된 세션 훅을 통해 자동 캡처됩니다
- 세션 ID는 파일 읽기 경쟁 조건을 방지하기 위해 메모리에 캐시됩니다
- 레이블은 `.qlaude-session-labels.json`에 `{ "레이블": "세션ID" }` 형태로 저장됩니다

---

## 큐 파일 포맷

프로젝트 루트에 `.qlaude-queue` 파일을 생성하면 시작 시 프롬프트가 자동으로 로드됩니다.

### 문법

```
# 각 줄이 하나의 프롬프트 (>> 접두사는 선택사항)
로그인 버그 수정해줘
>> 인증 모듈 리팩토링

# 새 세션
>>> 새로운 작업 시작

# 멀티라인 프롬프트
>>(
함수를 작성해줘:
- 숫자 리스트를 받아서
- 정렬된 고유값을 반환
>>)

# 중단점
>># 계속하기 전에 변경사항 확인

# 세션 관리
>>{Label:체크포인트-1}
>>>{Load:이전작업} 이전 작업 계속해줘
```

### 규칙

- 빈 줄과 `#`으로 시작하는 줄(주석)은 무시됩니다
- `>>` 접두사는 일반 프롬프트에서 선택사항입니다
- `>>>`는 새 Claude 세션에서 실행할 프롬프트를 표시합니다
- `>>(` ... `>>)`는 멀티라인 프롬프트를 감쌉니다 (공백 유지)
- `>>>(` ... `>>)`는 새 세션용 멀티라인 프롬프트입니다
- `>>#`는 중단점을 설정합니다
- `>>{Label:이름}` / `>>{Load:이름}`으로 세션을 관리합니다
- 실행 중 `:reload`로 파일을 다시 읽을 수 있습니다
- **큐 항목은 실행될 때마다 `.qlaude-queue`에서 삭제됩니다.** 재사용할 큐 스크립트는 별도 파일로 저장해두고 필요할 때 `.qlaude-queue`로 복사하세요

---

## 텔레그램 연동

### 설정 방법

1. [@BotFather](https://t.me/BotFather)에서 텔레그램 봇 생성
2. 채팅 ID 확인 (봇에 메시지를 보낸 후 `https://api.telegram.org/bot<TOKEN>/getUpdates` 확인)
3. `.qlauderc.json`에 설정:

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "123456:ABC-DEF...",
    "chatId": "987654321"
  }
}
```

### 알림

qlaude가 텔레그램 메시지를 보내는 경우:

| 이벤트 | 설명 |
|--------|------|
| 선택지 표시 | Claude가 사용자 입력 필요 (권한 요청, 선택 UI) |
| 중단점 | 큐가 중단점에 도달 |
| 큐 시작 | 자동 실행 시작됨 |
| 큐 완료 | 모든 큐 항목 실행 완료 |
| 작업 실패 | `QUEUE_STOP` 또는 rate limit 감지 |

선택지 알림에는 원격 응답을 위한 인라인 키보드 버튼이 포함됩니다.

### 원격 명령어

봇에 메시지로 전송합니다:

| 명령어 | 설명 |
|--------|------|
| `/status 인스턴스` | 큐 상태 및 현재 상태 표시 |
| `/pause 인스턴스` | 자동 실행 일시정지 |
| `/resume 인스턴스` | 자동 실행 재개 |
| `/log 인스턴스` | 큐 로그 및 세션 로그 다운로드 |
| `/display 인스턴스` | 현재 터미널 화면 버퍼 표시 |
| `/send 인스턴스 텍스트` | 텍스트 + Enter 전송 |
| `/key 인스턴스 텍스트` | 텍스트만 전송 (Enter 없음) |

`인스턴스`는 알림 메시지에 표시되는 `호스트명:PID` 식별자입니다.

### 선택지 응답

선택지 알림이 도착했을 때:

- **숫자 버튼 (1-16)**: 해당 옵션 선택
- **연필 버튼 (N+연필 아이콘)**: 옵션 N 선택 후 추가 텍스트 입력 (봇이 답장으로 입력 요청)
- **취소 버튼**: Escape 전송하여 선택 취소

### 멀티 인스턴스

여러 qlaude 인스턴스가 같은 텔레그램 봇을 공유할 수 있습니다. 각 인스턴스는 `호스트명:PID`로 식별됩니다. 인스턴스 ID가 없는 명령어는 여러 인스턴스가 실행 중일 때 무시됩니다.

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
| INTERRUPTED | 작업이 중단됨 (차단/알림에는 사용하지 않음) |

### 감지 과정

1. PTY 출력이 헤드리스 xterm 터미널 에뮬레이터에 기록됨
2. `idleThresholdMs` (기본 5초) 동안 출력이 없으면 화면 분석
3. 패턴 매칭으로 상태 판별:
   - 스피너 패턴 (유니코드 스피너 + `…`) → 아직 PROCESSING
   - `QUEUE_STOP` / rate limit → TASK_FAILED
   - `[Y/n]`, `Enter to select`, 번호 선택지 → SELECTION_PROMPT
   - 차단 패턴 없음 + 화면 안정 (`requiredStableChecks`회 연속 동일) → READY
4. 상태 변경 시 자동 실행기 동작 및 텔레그램 알림 발송

### 튜닝

Claude가 아직 생각 중인데 READY가 너무 빨리 감지될 때:
- `idleThresholdMs` 증가 (예: 8000)
- `requiredStableChecks` 증가 (예: 3)

READY 감지가 너무 느릴 때:
- `idleThresholdMs` 감소 (최소 권장: 3000)

---

## 문제 해결

### 디버그 로그 활성화

`.qlauderc.json`에 추가:

```json
{
  "logFile": ".qlaude-debug.log"
}
```

로그 레벨이 자동으로 debug로 설정됩니다. 상태 전환, 패턴 매칭, 화면 스냅샷을 확인할 수 있습니다.

### 자주 발생하는 문제

**큐가 실행되지 않음**: 자동 실행이 일시정지되었는지 확인합니다 (`:resume`으로 재개). 상태바에 큐 개수가 표시되는지 확인합니다.

**READY 오감지**: Claude가 출력 사이에 긴 멈춤이 있을 수 있습니다. `idleThresholdMs` 또는 `requiredStableChecks`를 증가시킵니다.

**SELECTION_PROMPT 오감지**: Claude 출력이 선택지 패턴과 일치할 수 있습니다. 디버그 로그에서 `bufferSnapshot`을 확인하여 감지 원인을 파악합니다.

**텔레그램 미동작**: 설정의 `botToken`과 `chatId`를 확인합니다. 봇이 해당 채팅에 메시지를 보낼 권한이 있는지 확인합니다. 디버그 로그에서 텔레그램 관련 오류를 확인합니다.

**세션 레이블 로드 실패**: `.qlaude-session-labels.json` 파일이 존재하고 해당 레이블이 포함되어 있는지 확인합니다. 세션 ID는 만료되지 않은 유효한 Claude Code 세션이어야 합니다.
