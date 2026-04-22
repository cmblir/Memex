# Diffusion Models 개요

Diffusion model은 데이터에 점진적으로 노이즈를 추가한 뒤 역과정으로 노이즈를 제거하여 생성하는 모델이다.

## 핵심 개념
- Forward process: 데이터→노이즈
- Reverse process: 노이즈→데이터
- Score matching / denoising score matching

## 주요 모델
- DDPM (Ho et al., 2020)
- Stable Diffusion (Rombach et al., 2022)
- DALL-E 2 (OpenAI)

## 응용
이미지 생성, 비디오 생성, 오디오 합성, 단백질 구조 예측 등.

Transformer 기반 diffusion (DiT)이 최근 주목받고 있다.