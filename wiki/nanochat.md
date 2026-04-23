---
title: "nanochat"
type: entity
tags:
  - open-source
  - llm
  - karpathy
  - pytorch
  - training-framework
created: 2026-04-23
last_updated: 2026-04-24
source_count: 2
confidence: high
status: active
---

# nanochat

[[andrej-karpathy|Andrej Karpathy]]가 2025년 10월 13일 공개한 오픈소스 LLM 풀스택 학습 파이프라인.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] 이전 프로젝트 [[nanogpt|nanoGPT]]가 사전학습만 다뤘던 것과 달리, 토크나이저 학습부터 배포까지 전 과정을 단일 코드베이스에 담았다.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

## 파이프라인 단계

[[llm-training-pipeline|LLM 학습 파이프라인]] 전 과정을 포함:

1. **토크나이저 학습** — 어휘 크기 65,536 토큰, 약 4.8 문자/토큰, Rust 구현[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] (LLM에서 가장 대중적인 토큰화 알고리즘은 [[byte-pair-encoding|BPE]][^src-byte-pair-encoding-bpe])
2. **사전학습(Pretraining)** — FineWeb-EDU 데이터셋 사용[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
3. **[[midtraining|중간학습(Midtraining)]]** — SmolTalk 데이터(사용자-어시스턴트 대화, 객관식 문제, tool use)[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
4. **지도학습 미세조정(SFT)**
5. **강화학습(RL)**
6. **웹 UI 배포**

## 비용 및 성능

| 예산 | 학습 시간 | 성능 |
|------|-----------|------|
| ~$100 | 4시간 (8×H100, $24/hr) | 기초적 대화 가능[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] |
| ~$100, 12시간 | 12시간 | GPT-2 CORE 벤치마크 초과[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] |
| ~$1,000 | 41.6시간 | MMLU 40점대, ARC-Easy 70점대, GSM8K 20점대 (GPT-3 연산량의 ~1/1,000)[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] |

## 기술 스택

- **모델 파라미터**: 약 560M[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
- **코드 규모**: 약 8,000줄[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
- **주 언어**: Python/PyTorch (토크나이저: Rust)[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

## 추론 엔진

- KV 캐시(KV cache)[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
- prefill/decode 분리[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
- Python 인터프리터를 통한 tool use[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]
- 학습 완료 후 `report.md` 자동 생성 (CORE, ARC-E/C, MMLU, GSM8K, HumanEval, ChatCORE)[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

## 설계 철학

복잡한 설정 객체나 모델 팩토리 없이 읽기 쉽고 수정하기 쉬운 '강력한 베이스라인(strong baseline)' 코드베이스 지향.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] [[llm101n|LLM101n]] 강의의 캡스톤 프로젝트로 계획되어 있다.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

## 커뮤니티 활용 사례

공개 직후 Red Hat OpenShift AI, Apple Silicon, CPU 전용 환경 등에서 실험 사례가 공유되었다.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

---

[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]: [[source-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]]

[^src-byte-pair-encoding-bpe]: [[source-byte-pair-encoding-bpe]]
