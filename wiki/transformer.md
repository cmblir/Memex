---
title: Transformer
type: concept
created: 2026-04-22
updated: 2026-04-22
sources:
  - test-attention-mechanism.md
tags:
  - architecture
  - deep-learning
---

# Transformer

2017년 [[source-attention-is-all-you-need|Attention Is All You Need]] 논문에서 제안된 신경망 아키텍처. [[google-brain|Google Brain]]의 [[ashish-vaswani|Ashish Vaswani]] 등이 설계했다.

## 핵심 설계

- RNN/LSTM의 순차 처리를 제거하고, [[self-attention|Self-Attention]]만으로 시퀀스를 병렬 처리
- 인코더-디코더 구조
- [[multi-head-attention|Multi-Head Attention]]으로 서로 다른 표현 부분공간의 정보를 동시에 포착
- Positional encoding으로 순서 정보 보존

## 영향

- BERT, GPT 시리즈 등 현대 LLM의 기반
- Vision Transformer(ViT)로 컴퓨터 비전까지 확장
- [[dit|DiT (Diffusion Transformer)]]로 [[diffusion-model|Diffusion Model]] 영역까지 확장
- [[andrej-karpathy|Andrej Karpathy]]가 minGPT, nanoGPT로 교육용 구현 공개

WMT 2014 번역 태스크에서 RNN 기반 모델 없이 SOTA를 달성하며 패러다임 전환을 이끌었다.
