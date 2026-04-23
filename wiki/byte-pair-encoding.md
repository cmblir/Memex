---
title: "Byte Pair Encoding (BPE)"
type: technique
tags:
  - tokenization
  - bpe
  - llm
  - vocabulary
created: 2026-04-24
last_updated: 2026-04-24
source_count: 1
confidence: medium
status: active
---

# Byte Pair Encoding (BPE)

LLM이 텍스트를 처리하기 위해 사용하는 가장 대중적인 토큰화(tokenization) 알고리즘.[^src-byte-pair-encoding-bpe] 모델이 문자를 숫자(토큰 ID)로 변환하는 '첫 번째 관문' 역할을 한다.[^src-byte-pair-encoding-bpe]

## 동작 원리

원시 바이트 수준에서 시작해, 말뭉치에서 **가장 빈번하게 등장하는 쌍(pair)을 반복적으로 병합**하여 어휘 사전(Vocabulary)을 구축한다.[^src-byte-pair-encoding-bpe]

- 초기 상태: 바이트(byte) 단위 토큰만 존재
- 반복: 가장 자주 같이 나타나는 두 토큰을 찾아 하나의 새 토큰으로 병합, 어휘에 추가
- 종료: 원하는 어휘 크기에 도달할 때까지 반복

## [[llm-training-pipeline|LLM 학습 파이프라인]]에서의 위치

BPE 학습은 사전학습(pretraining) 이전에 수행되는 **토크나이저 학습 단계**에 해당한다. [[llm-training-pipeline|LLM 학습 파이프라인]]의 첫 단계이며, 이후 모든 단계(사전학습, [[midtraining|중간학습]], SFT, RL)가 이 토크나이저가 만든 토큰 ID 시퀀스 위에서 돌아간다.

## 구현 사례

- **[[nanochat]]**: 어휘 크기 65,536 토큰, 약 4.8 문자/토큰 압축률, Rust로 구현된 토크나이저를 사용.

## 교육 레퍼런스

[[andrej-karpathy|Andrej Karpathy]]의 **'Let's build the GPT Tokenizer'** 강의가 BPE를 바닥부터 구현하며 심도 있게 설명한다.[^src-byte-pair-encoding-bpe]

---

[^src-byte-pair-encoding-bpe]: [[source-byte-pair-encoding-bpe]]
