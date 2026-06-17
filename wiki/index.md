---
tags:
  - meta
title: Index
type: overview
created: 2026-04-26
last_updated: 2026-06-18
---

# Wiki Index

All wiki pages, organized by type. Updated on every ingest.

## Overview
- [[overview]] — wiki scope and current state

## Sources
- [[source-byte-pair-encoding-bpe]] — Karpathy의 BPE(byte-pair encoding) 토크나이저 설명
- [[source-제목-gpt-1-improving-language-understanding-by-generative-pre-training-2018]] — GPT-1 원논문 "Improving Language Understanding by Generative Pre-Training" (2018)
- [[source-제목-안드레이-카파시andrej-karpathy의-nanochat-100달러로-만드는-나만의-chatgpt]] — Karpathy nanochat, $100로 만드는 풀스택 ChatGPT

## Entities
- [[alec-radford]] — GPT-1 제1저자, OpenAI 연구자
- [[andrej-karpathy]] — AI 연구자, ex-OpenAI/Tesla, nanoGPT·nanochat·llm101n 저자
- [[bookcorpus]] — 약 7,000권 도서 텍스트 데이터셋, GPT-1 학습 데이터
- [[gpt-1]] — OpenAI의 첫 GPT (2018), 117M 파라미터, decoder-only
- [[llm101n]] — Karpathy의 LLM 처음부터 만들기 강의
- [[nanochat]] — Karpathy의 $100 풀스택 ChatGPT 클론
- [[nanogpt]] — Karpathy의 미니멀 GPT 학습 레포
- [[openai]] — GPT 시리즈를 만든 AI 연구 기업

## Concepts
- [[llm-training-pipeline]] — 현대 LLM 학습 흐름 (pretrain → midtrain → SFT → RL)
- [[pretrain-finetune-paradigm]] — 비지도 사전학습 + 지도 미세조정 2단계 패러다임

## Techniques
- [[byte-pair-encoding]] — BPE 서브워드 토크나이제이션
- [[midtraining]] — 사전학습과 SFT 사이의 중간학습 단계
- [[transformer-decoder-only]] — decoder-only 트랜스포머 아키텍처

## Analyses
- [[lazyclaw-commit-history]] — lazyclaw 깃 히스토리(323 커밋, v3.99.29→6.3.1) 그룹 다이제스트

---

## lazyclaw (software project)

A separate cluster from the LLM-training research above — engineering notes on the
`lazyclaw` terminal-agent CLI, kept in `wiki/lazyclaw/`.

- [[lazyclaw-overview]] — TUI-first Node CLI agent ($0 subscription learning + every-channel) in the claw family
- [[lazyclaw-commit-history]] — grouped digest of 323 commits (v3.99.29 → 6.3.1, 2026-05-18 → 06-16)
- [[source-lazyclaw-codebase-2026-06]] — repo + README/CHANGELOG snapshot (2026-06-18)
