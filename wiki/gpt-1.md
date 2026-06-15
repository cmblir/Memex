---
title: "GPT-1"
type: entity
tags:
  - model
  - gpt
  - openai
  - transformer
  - 2018
created: 2026-04-23
last_updated: 2026-06-14
source_count: 1
confidence: medium
status: active
---

# GPT-1

2018년 [[openai|OpenAI]]가 발표한 첫 번째 GPT(Generative Pre-trained Transformer) 모델.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] 논문 제목은 "Improving Language Understanding by Generative Pre-Training", 제1저자는 [[alec-radford|Alec Radford]] 외.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]

## 모델 사양

| 항목 | 값 |
|------|-----|
| 구조 | [[transformer-decoder-only\|Transformer Decoder-only]], 12층[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] |
| 파라미터 | 약 1.17억(117M)[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] |
| 학습 데이터 | [[bookcorpus\|BookCorpus]] (~7,000권)[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] |
| 학습 목표 | 다음 단어 예측(language modeling)[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] |

## 핵심 아이디어

**비지도 사전학습 + 지도 미세조정**의 2단계 학습. 대규모 비라벨 텍스트로 언어 모델을 먼저 학습한 뒤, 각 다운스트림 태스크용으로 소규모 라벨 데이터로 미세조정한다.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] 이 접근은 [[pretrain-finetune-paradigm|사전학습-미세조정 패러다임]]의 대표 사례가 되었다.

## 평가 태스크

질의응답, 함의 추론, 분류 등 다양한 NLP 태스크에서 좋은 성능을 입증했다.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]

## 의의

- 단순한 언어 모델링 목표만으로도 광범위한 NLP 태스크에 전이 가능한 표현을 학습할 수 있음을 처음 증명.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]
- 이후 GPT-2, GPT-3 등 모든 GPT 시리즈의 토대가 되었다.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]

---

[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]: [[source-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]]
