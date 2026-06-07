// Sample interconnected wiki notes seeded into a fresh vault so the Graph,
// Provenance, and Overview views are populated on first launch instead of
// showing an empty canvas. Every page follows the vault CLAUDE.md schema
// (YAML frontmatter + inline [^src-*] citations + [[wikilinks]]), so the
// link graph forms real communities and the citation coverage view has data.
//
// Seeding is idempotent (write-if-missing), so a user can delete any of these
// and they won't reappear unless the file is gone.

/// (relative path under the vault root, file content).
pub const SAMPLE_NOTES: &[(&str, &str)] = &[
    (
        "wiki/transformer-architecture.md",
        r#"---
title: "Transformer Architecture"
type: concept
tags:
  - architecture
  - deep-learning
created: 2024-01-10
last_updated: 2024-03-02
source_count: 1
confidence: high
status: active
---

# Transformer Architecture

The transformer is a neural-network architecture built around the
[[attention-mechanism]] instead of recurrence[^src-attention-is-all-you-need].
It consumes [[tokenization|tokens]] as [[embeddings]] and its quality improves
predictably with compute and data, as described by the [[scaling-laws]].
Most modern models from [[openai]] and [[anthropic]] are transformers.

[^src-attention-is-all-you-need]: [[source-attention-is-all-you-need]]
"#,
    ),
    (
        "wiki/attention-mechanism.md",
        r#"---
title: "Attention Mechanism"
type: technique
tags:
  - architecture
created: 2024-01-11
last_updated: 2024-02-20
source_count: 1
confidence: high
status: active
---

# Attention Mechanism

Attention lets a model weigh every token against every other token when
forming a representation[^src-attention-is-all-you-need]. Self-attention is the
core building block of the [[transformer-architecture]] and operates over
[[embeddings]]. It replaced the sequential bottleneck of earlier recurrent
models.

[^src-attention-is-all-you-need]: [[source-attention-is-all-you-need]]
"#,
    ),
    (
        "wiki/embeddings.md",
        r#"---
title: "Embeddings"
type: concept
tags:
  - representation
created: 2024-01-12
last_updated: 2024-02-01
source_count: 1
confidence: medium
status: active
---

# Embeddings

Embeddings map discrete tokens into a continuous vector space where semantic
similarity becomes geometric distance[^src-attention-is-all-you-need]. The
[[transformer-architecture]] operates on embeddings, and the
[[attention-mechanism]] computes its weights from them.

[^src-attention-is-all-you-need]: [[source-attention-is-all-you-need]]
"#,
    ),
    (
        "wiki/tokenization.md",
        r#"---
title: "Tokenization"
type: technique
tags:
  - preprocessing
created: 2024-01-13
last_updated: 2024-02-03
source_count: 1
confidence: medium
status: active
---

# Tokenization

Tokenization splits raw text into the discrete units a model consumes, most
commonly via byte-pair encoding[^src-attention-is-all-you-need]. Its output
feeds the [[embeddings]] layer of the [[transformer-architecture]].

[^src-attention-is-all-you-need]: [[source-attention-is-all-you-need]]
"#,
    ),
    (
        "wiki/scaling-laws.md",
        r#"---
title: "Scaling Laws"
type: concept
tags:
  - training
  - empirical
created: 2024-01-15
last_updated: 2024-03-10
source_count: 1
confidence: high
status: active
---

# Scaling Laws

Scaling laws describe how model loss falls as a smooth power law in model size,
dataset size, and compute[^src-scaling-laws-paper]. They drove the race to
larger [[transformer-architecture|transformers]] at [[openai]]. Whether raw
scale or data quality matters more is examined in
[[analysis-scaling-vs-data]].

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/rlhf.md",
        r#"---
title: "RLHF"
type: technique
tags:
  - alignment
  - training
created: 2024-01-18
last_updated: 2024-03-05
source_count: 1
confidence: high
status: active
---

# RLHF

Reinforcement Learning from Human Feedback fine-tunes a base model against a
reward model trained on human preference rankings[^src-scaling-laws-paper]. It
is the main practical lever for [[alignment]] and is used by both [[openai]]
and [[anthropic]]. It is a specialised form of [[fine-tuning]].

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/alignment.md",
        r#"---
title: "Alignment"
type: concept
tags:
  - safety
created: 2024-01-20
last_updated: 2024-03-12
source_count: 1
confidence: medium
status: active
---

# Alignment

Alignment is the problem of making a model's behaviour match human intent and
values[^src-scaling-laws-paper]. [[rlhf]] is the dominant technique today, and
[[anthropic]] frames much of its research around it.

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/fine-tuning.md",
        r#"---
title: "Fine-tuning"
type: technique
tags:
  - training
created: 2024-01-22
last_updated: 2024-02-15
source_count: 1
confidence: medium
status: active
---

# Fine-tuning

Fine-tuning continues training a pretrained [[transformer-architecture]] on a
narrower dataset to specialise it[^src-scaling-laws-paper]. [[rlhf]] is a
preference-based variant used for [[alignment]].

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/openai.md",
        r#"---
title: "OpenAI"
type: entity
tags:
  - lab
created: 2024-01-25
last_updated: 2024-03-08
source_count: 1
confidence: high
status: active
---

# OpenAI

OpenAI is an AI research lab that popularised large
[[transformer-architecture|transformers]] and demonstrated the
[[scaling-laws]] in practice[^src-scaling-laws-paper]. It uses [[rlhf]] to
align its assistant models.

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/anthropic.md",
        r#"---
title: "Anthropic"
type: entity
tags:
  - lab
created: 2024-01-26
last_updated: 2024-03-09
source_count: 1
confidence: high
status: active
---

# Anthropic

Anthropic is an AI safety lab whose research centres on [[alignment]] and the
responsible scaling of [[transformer-architecture|transformers]][^src-scaling-laws-paper].
It relies on [[rlhf]] (and related preference methods) to train helpful,
harmless assistants.

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/source-attention-is-all-you-need.md",
        r#"---
title: "Source: Attention Is All You Need"
type: source-summary
tags:
  - paper
created: 2024-01-09
last_updated: 2024-01-09
source_count: 1
confidence: high
status: active
---

# Source: Attention Is All You Need

The 2017 paper that introduced the [[transformer-architecture]] and showed that
the [[attention-mechanism]] alone — without recurrence or convolution — could
reach state-of-the-art translation quality[^src-attention-is-all-you-need]. It
established the encoder/decoder stack that nearly all later models build on.

[^src-attention-is-all-you-need]: [[source-attention-is-all-you-need]]
"#,
    ),
    (
        "wiki/source-scaling-laws-paper.md",
        r#"---
title: "Source: Scaling Laws for Neural Language Models"
type: source-summary
tags:
  - paper
created: 2024-01-14
last_updated: 2024-01-14
source_count: 1
confidence: high
status: active
---

# Source: Scaling Laws for Neural Language Models

The paper that formalised the [[scaling-laws]]: test loss falls as a power law
in parameters, data, and compute over many orders of magnitude[^src-scaling-laws-paper].
It motivated the large-model programmes at [[openai]] and others.

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
"#,
    ),
    (
        "wiki/analysis-scaling-vs-data.md",
        r#"---
title: "Scaling vs. Data Quality"
type: analysis
tags:
  - debate
created: 2024-02-05
last_updated: 2024-03-15
source_count: 2
confidence: medium
status: active
---

# Scaling vs. Data Quality

Do better models come from raw scale or from cleaner data? The [[scaling-laws]]
argue that loss is dominated by model and dataset size[^src-scaling-laws-paper],
yet later work shows that data curation can match much larger
[[transformer-architecture|transformers]] trained on noisier
corpora[^src-attention-is-all-you-need]. The likely answer is both: scale sets
the ceiling, data quality decides how close you get.

[^src-scaling-laws-paper]: [[source-scaling-laws-paper]]
[^src-attention-is-all-you-need]: [[source-attention-is-all-you-need]]
"#,
    ),
];
