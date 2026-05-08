---
title: "LLM 학습 파이프라인"
type: concept
tags:
  - llm
  - training
  - pretraining
  - fine-tuning
  - rl
created: 2026-04-23
last_updated: 2026-04-24
source_count: 3
confidence: high
status: active
---

# LLM 학습 파이프라인

현대 대규모 언어 모델(LLM)을 처음부터 구축하는 전체 과정. 단순 사전학습을 넘어 사용자와 대화 가능한 모델로 만들기까지 여러 단계를 거친다.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

## 역사적 배경

이 파이프라인의 기원은 2018년 [[gpt-1|GPT-1]] 논문의 [[pretrain-finetune-paradigm|비지도 사전학습 + 지도 미세조정]] 2단계 패러다임이다.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] 이후 중간학습·RL·배포 단계가 추가되며 오늘날의 멀티 스테이지 파이프라인으로 확장되었다.

## 단계별 구성

1. **토크나이저 학습** — 텍스트를 토큰 시퀀스로 변환하는 어휘(vocabulary) 구축. LLM에서 가장 대중적으로 쓰이는 알고리즘은 [[byte-pair-encoding|BPE (Byte Pair Encoding)]]로, 원시 바이트에서 시작해 가장 빈번한 쌍을 반복적으로 병합한다.[^src-byte-pair-encoding-bpe] [[nanochat]]은 65,536 토큰 어휘, Rust 구현.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

2. **사전학습(Pretraining)** — 대용량 텍스트 코퍼스(예: FineWeb-EDU)로 다음 토큰을 예측하는 기초 언어 모델 학습.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt] [[nanogpt|nanoGPT]]는 이 단계까지만 다뤘다.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

3. **[[midtraining|중간학습(Midtraining)]]** — 사전학습과 SFT 사이의 단계. 대화·지식·추론 관련 특화 데이터로 모델을 전문화.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

4. **지도학습 미세조정(SFT, Supervised Fine-Tuning)** — 사람이 작성한 이상적인 응답 예시로 명령 수행 능력 부여.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

5. **강화학습(RL, Reinforcement Learning)** — 보상 신호를 통해 응답 품질 추가 정제. RLHF 등이 대표적.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

6. **배포(Deployment)** — 추론 엔진(KV 캐시, prefill/decode 분리 등) + 사용자 인터페이스 제공.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

## 구현 사례

[[nanochat]]은 이 전체 파이프라인을 약 8,000줄의 코드로 구현한 오픈소스 프로젝트로, 약 $100의 GPU 비용으로 전 과정을 실행할 수 있음을 보였다.[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]

---

[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]: [[source-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]]

[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]: [[source-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]]

[^src-byte-pair-encoding-bpe]: [[source-byte-pair-encoding-bpe]]
