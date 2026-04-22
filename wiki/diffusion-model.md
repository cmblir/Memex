---
title: Diffusion Model
type: concept
created: 2026-04-22
updated: 2026-04-22
sources:
  - test-diffusion-models.md
tags:
  - diffusion
  - generative-model
  - deep-learning
---

# Diffusion Model

데이터에 점진적으로 노이즈를 추가(forward process)한 뒤, 학습된 역과정(reverse process)으로 노이즈를 제거하여 새 샘플을 생성하는 생성 모델 계열.

## 작동 원리

1. **Forward process (diffusion)**: 원본 데이터 x₀에 T 단계에 걸쳐 가우시안 노이즈를 주입 → 최종적으로 순수 노이즈 xₜ
2. **Reverse process (denoising)**: 노이즈 xₜ에서 출발해 단계적으로 노이즈를 제거 → 원본 분포의 새 샘플 생성
3. **Score matching**: 각 노이즈 레벨에서 데이터 분포의 gradient(score)를 추정하는 학습 목표

## 대표 모델

- [[ddpm|DDPM]] (Ho et al., 2020) — diffusion 기반 이미지 생성의 돌파구
- [[stable-diffusion|Stable Diffusion]] (Rombach et al., 2022) — latent space에서 diffusion 수행, 오픈소스
- [[dall-e-2|DALL-E 2]] ([[openai|OpenAI]]) — CLIP + diffusion으로 텍스트→이미지 생성

## 응용

이미지 생성, 비디오 생성, 오디오 합성, 단백질 구조 예측 등.

## Transformer와의 결합

기존 diffusion model은 U-Net을 백본으로 사용했으나, [[dit|DiT (Diffusion Transformer)]]는 [[transformer|Transformer]]로 대체하여 스케일링 이점을 얻는다. 이는 [[self-attention|Self-Attention]]의 장거리 의존성 포착 능력을 diffusion에 도입한 것이다.
