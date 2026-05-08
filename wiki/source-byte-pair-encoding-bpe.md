---
title: "Byte Pair Encoding (BPE)"
type: source-summary
tags:
  - tokenization
  - bpe
  - karpathy
  - llm
created: 2026-04-24
last_updated: 2026-04-24
source_count: 1
confidence: medium
status: active
---

# Byte Pair Encoding (BPE)

LLM이 텍스트를 처리하기 위해 사용하는 가장 대중적인 토큰화 알고리즘을 다루는 짧은 노트.[^src-byte-pair-encoding-bpe] [[andrej-karpathy|Andrej Karpathy]]의 'Let's build the GPT Tokenizer' 강의에서 심도 있게 다뤄진 주제를 요약한다.[^src-byte-pair-encoding-bpe]

## 핵심 주장

- **BPE는 LLM에서 가장 대중적으로 쓰이는 토큰화 알고리즘이다.**[^src-byte-pair-encoding-bpe]
- **동작 방식**: 원시 바이트 수준에서 시작해, 가장 빈번하게 등장하는 쌍(pair)을 반복적으로 병합하며 어휘 사전(Vocabulary)을 구축한다.[^src-byte-pair-encoding-bpe]
- **역할**: 모델이 문자를 숫자로 변환하는 '첫 번째 관문' 역할을 수행한다.[^src-byte-pair-encoding-bpe]
- **교육 레퍼런스**: Karpathy의 'Let's build the GPT Tokenizer' 강의가 심층 해설을 제공한다.[^src-byte-pair-encoding-bpe]

## 한계

원문 자체가 매우 짧은 개괄 노트로, 구체적 알고리즘 의사코드·시간 복잡도·실제 구현 세부(예: pre-tokenization, special tokens 처리, byte-level vs char-level 트레이드오프)는 포함하지 않는다. 자세한 내용은 원문이 지목한 Karpathy 강의를 참조하는 포인터로 기능한다.

## 관련 wiki 페이지

- [[byte-pair-encoding]] — 기법 상세
- [[andrej-karpathy|Andrej Karpathy]] — 'Let's build the GPT Tokenizer' 강의의 저자
- [[llm-training-pipeline|LLM 학습 파이프라인]] — BPE가 토크나이저 학습 단계에 해당
- [[nanochat]] — 65,536 토큰 어휘의 Rust 기반 토크나이저를 사용

---

[^src-byte-pair-encoding-bpe]: [[source-byte-pair-encoding-bpe]]
