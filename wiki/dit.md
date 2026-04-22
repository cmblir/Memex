---
title: DiT (Diffusion Transformer)
type: concept
created: 2026-04-22
updated: 2026-04-22
sources:
  - test-diffusion-models.md
tags:
  - diffusion
  - transformer
  - architecture
---

# DiT (Diffusion Transformer)

[[transformer|Transformer]] 아키텍처를 [[diffusion-model|Diffusion Model]]의 백본으로 사용하는 접근. 기존 U-Net 기반 diffusion 모델을 대체하여 스케일링 이점을 얻는다.

## 핵심 아이디어

- 기존 diffusion model의 U-Net 백본을 Transformer로 교체
- [[self-attention|Self-Attention]]의 장거리 의존성 포착 능력을 diffusion 과정에 도입
- [[multi-head-attention|Multi-Head Attention]]을 통해 이미지 패치 간 관계를 효과적으로 모델링

## 의의

Transformer의 검증된 스케일링 특성을 이미지 생성에 적용할 수 있는 경로를 열었다.
