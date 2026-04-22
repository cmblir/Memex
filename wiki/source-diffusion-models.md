---
title: "Diffusion Models 개요"
type: source
created: 2026-04-22
updated: 2026-04-22
sources:
  - test-diffusion-models.md
tags:
  - diffusion
  - generative-model
---

# Diffusion Models 개요

원본: `raw/test-diffusion-models.md`

## 요약

Diffusion model은 데이터에 점진적으로 노이즈를 추가(forward process)한 뒤, 역과정(reverse process)으로 노이즈를 제거하여 새로운 데이터를 생성하는 모델이다.

## 핵심 개념

- **Forward process**: 데이터 → 노이즈. 단계적으로 가우시안 노이즈를 주입
- **Reverse process**: 노이즈 → 데이터. 학습된 모델이 노이즈를 단계적으로 제거
- **Score matching / denoising score matching**: 노이즈 제거 방향을 학습하는 핵심 기법

## 주요 모델

| 모델 | 출처 | 연도 |
|------|------|------|
| [[ddpm\|DDPM]] | Ho et al. | 2020 |
| [[stable-diffusion\|Stable Diffusion]] | Rombach et al. | 2022 |
| [[dall-e-2\|DALL-E 2]] | [[openai\|OpenAI]] | 2022 |

## 응용 분야

이미지 생성, 비디오 생성, 오디오 합성, 단백질 구조 예측 등 다양한 도메인에 적용된다.

## 최신 동향

[[transformer\|Transformer]] 기반 diffusion 아키텍처인 [[dit\|DiT (Diffusion Transformer)]]가 최근 주목받고 있다. 기존 U-Net 백본을 Transformer로 대체하는 접근이다.
