---
title: "사전학습-미세조정 패러다임 (Pretrain-Finetune Paradigm)"
type: concept
tags:
  - training
  - transfer-learning
  - nlp
  - pretraining
  - fine-tuning
created: 2026-04-23
last_updated: 2026-06-14
source_count: 2
confidence: high
status: active
---

# 사전학습-미세조정 패러다임 (Pretrain-Finetune Paradigm)

대규모 비라벨 데이터로 언어 모델을 **비지도 사전학습(unsupervised pre-training)** 한 뒤, 개별 다운스트림 태스크의 소규모 라벨 데이터로 **지도 미세조정(supervised fine-tuning)** 을 수행하는 2단계 학습 방식.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]

## 기원과 대표 사례

2018년 [[openai|OpenAI]]의 [[gpt-1|GPT-1]] 논문이 이 패러다임을 대표적으로 입증한 사례다.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018] 다음 단어 예측이라는 단순한 언어 모델링 목표만으로 사전학습한 뒤 미세조정하면, 질의응답·함의 추론·분류 등 다양한 NLP 태스크에서 좋은 성능을 낼 수 있다는 점이 보여졌다.[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]

## 현대 LLM 파이프라인과의 관계

[[llm-training-pipeline|현대 LLM 학습 파이프라인]]의 "사전학습 → (중간학습 →) SFT → RL" 흐름[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]은 이 2단계 패러다임의 확장이라 볼 수 있다. 즉 비지도 사전학습 이후의 적응 단계가 단일 미세조정에서 여러 하위 단계로 세분화된 형태다.

---

[^src-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]: [[source-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]]
[^src-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]: [[source-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]]
