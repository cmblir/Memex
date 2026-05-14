// Provider adapters — one chat_complete signature, five backends. Each
// adapter converts our common message format into the provider's wire
// format and parses the response back. We deliberately do NOT stream in
// this first cut; the frontend can poll-display the final response.
//
// Provider identifiers (must match the frontend Settings panel):
//   anthropic-cli   → claude CLI shell-out (handled separately)
//   anthropic-api   → /v1/messages
//   openai-api      → /v1/chat/completions
//   google-api      → generativelanguage.googleapis.com
//   ollama          → http://localhost:11434/api/chat
//   openrouter      → openrouter.ai /api/v1/chat/completions

use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatResponse {
    pub provider_id: String,
    pub model: String,
    pub content: String,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

pub async fn chat_complete(
    req: ChatRequest,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    match req.provider_id.as_str() {
        "anthropic-api" => call_anthropic(&client, req, api_key).await,
        "openai-api" | "openrouter" => call_openai_compatible(&client, req, api_key).await,
        "google-api" => call_google(&client, req, api_key).await,
        "ollama" => call_ollama(&client, req).await,
        other => Err(format!("unsupported provider: {other}")),
    }
}

pub async fn list_models(
    provider_id: &str,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    match provider_id {
        "ollama" => list_ollama_models(&client).await,
        "openai-api" => list_openai_models(&client, api_key).await,
        "anthropic-api" => Ok(vec![
            "claude-opus-4-7".into(),
            "claude-sonnet-4-6".into(),
            "claude-haiku-4-5".into(),
        ]),
        "google-api" => Ok(vec![
            "gemini-2.0-pro".into(),
            "gemini-2.0-flash".into(),
            "gemini-1.5-pro".into(),
        ]),
        "openrouter" => list_openrouter_models(&client).await,
        _ => Ok(Vec::new()),
    }
}

// ---------- Anthropic /v1/messages ----------

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<AnthropicMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
}

async fn call_anthropic(
    client: &reqwest::Client,
    req: ChatRequest,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let key = api_key.ok_or_else(|| "missing Anthropic API key".to_string())?;
    let system = req
        .messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.as_str());
    let body_messages: Vec<AnthropicMessage> = req
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| AnthropicMessage {
            role: m.role.as_str(),
            content: m.content.as_str(),
        })
        .collect();
    let body = AnthropicRequest {
        model: &req.model,
        max_tokens: req.max_tokens.unwrap_or(4096),
        messages: body_messages,
        system,
        temperature: req.temperature,
    };
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("anthropic request: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "anthropic {}: {}",
            status,
            String::from_utf8_lossy(&bytes)
        ));
    }
    let parsed: AnthropicResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("anthropic parse: {e}"))?;
    let content = parsed
        .content
        .into_iter()
        .filter(|c| c.kind == "text")
        .filter_map(|c| c.text)
        .collect::<Vec<_>>()
        .join("");
    Ok(ChatResponse {
        provider_id: req.provider_id,
        model: req.model,
        content,
        usage: parsed.usage.map(|u| TokenUsage {
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
        }),
    })
}

// ---------- OpenAI-compatible /v1/chat/completions ----------

#[derive(Serialize)]
struct OpenAIRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAIMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct OpenAIMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
    usage: Option<OpenAIUsage>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Deserialize)]
struct OpenAIResponseMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

async fn call_openai_compatible(
    client: &reqwest::Client,
    req: ChatRequest,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let key = api_key.ok_or_else(|| "missing API key".to_string())?;
    let url = match req.provider_id.as_str() {
        "openrouter" => "https://openrouter.ai/api/v1/chat/completions",
        _ => "https://api.openai.com/v1/chat/completions",
    };
    let body = OpenAIRequest {
        model: &req.model,
        messages: req
            .messages
            .iter()
            .map(|m| OpenAIMessage {
                role: m.role.as_str(),
                content: m.content.as_str(),
            })
            .collect(),
        temperature: req.temperature,
        max_tokens: req.max_tokens,
    };
    let resp = client
        .post(url)
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{} {}: {}", req.provider_id, status, String::from_utf8_lossy(&bytes)));
    }
    let parsed: OpenAIResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("openai parse: {e}"))?;
    let content = parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .unwrap_or_default();
    Ok(ChatResponse {
        provider_id: req.provider_id,
        model: req.model,
        content,
        usage: parsed.usage.map(|u| TokenUsage {
            input_tokens: u.prompt_tokens,
            output_tokens: u.completion_tokens,
        }),
    })
}

async fn list_openai_models(
    client: &reqwest::Client,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let key = api_key.ok_or_else(|| "missing API key".to_string())?;
    let resp = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("openai models {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if id.starts_with("gpt-") || id.starts_with("o1") || id.starts_with("o3") {
                    out.push(id.to_string());
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

async fn list_openrouter_models(client: &reqwest::Client) -> Result<Vec<String>, String> {
    let resp = client
        .get("https://openrouter.ai/api/v1/models")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("openrouter models {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                out.push(id.to_string());
            }
        }
    }
    out.sort();
    out.truncate(80);
    Ok(out)
}

// ---------- Google Gemini ----------

#[derive(Serialize)]
struct GeminiRequest<'a> {
    contents: Vec<GeminiContent<'a>>,
    #[serde(rename = "systemInstruction", skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiContent<'a>>,
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    generation_config: Option<GeminiGenConfig>,
}

#[derive(Serialize)]
struct GeminiContent<'a> {
    role: &'a str, // "user" | "model"
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct GeminiGenConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsage>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiResponseContent>,
}

#[derive(Deserialize)]
struct GeminiResponseContent {
    parts: Option<Vec<GeminiResponsePart>>,
}

#[derive(Deserialize)]
struct GeminiResponsePart {
    text: Option<String>,
}

#[derive(Deserialize)]
struct GeminiUsage {
    #[serde(rename = "promptTokenCount", default)]
    prompt_token_count: u32,
    #[serde(rename = "candidatesTokenCount", default)]
    candidates_token_count: u32,
}

async fn call_google(
    client: &reqwest::Client,
    req: ChatRequest,
    api_key: Option<String>,
) -> Result<ChatResponse, String> {
    let key = api_key.ok_or_else(|| "missing Google API key".to_string())?;
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        req.model, key
    );
    let system = req.messages.iter().find(|m| m.role == "system");
    let contents: Vec<GeminiContent> = req
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| GeminiContent {
            role: if m.role == "assistant" { "model" } else { "user" },
            parts: vec![GeminiPart {
                text: m.content.as_str(),
            }],
        })
        .collect();
    let body = GeminiRequest {
        contents,
        system_instruction: system.map(|s| GeminiContent {
            role: "system",
            parts: vec![GeminiPart {
                text: s.content.as_str(),
            }],
        }),
        generation_config: Some(GeminiGenConfig {
            temperature: req.temperature,
            max_output_tokens: req.max_tokens,
        }),
    };
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("gemini request: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "gemini {}: {}",
            status,
            String::from_utf8_lossy(&bytes)
        ));
    }
    let parsed: GeminiResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("gemini parse: {e}"))?;
    let content = parsed
        .candidates
        .unwrap_or_default()
        .into_iter()
        .filter_map(|c| c.content)
        .flat_map(|c| c.parts.unwrap_or_default())
        .filter_map(|p| p.text)
        .collect::<Vec<_>>()
        .join("");
    Ok(ChatResponse {
        provider_id: req.provider_id,
        model: req.model,
        content,
        usage: parsed.usage_metadata.map(|u| TokenUsage {
            input_tokens: u.prompt_token_count,
            output_tokens: u.candidates_token_count,
        }),
    })
}

// ---------- Ollama (local) ----------

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaMessage<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
}

#[derive(Serialize)]
struct OllamaMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(rename = "num_predict", skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: Option<OllamaResponseMessage>,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
}

#[derive(Deserialize)]
struct OllamaResponseMessage {
    content: Option<String>,
}

async fn call_ollama(
    client: &reqwest::Client,
    req: ChatRequest,
) -> Result<ChatResponse, String> {
    let body = OllamaRequest {
        model: &req.model,
        messages: req
            .messages
            .iter()
            .map(|m| OllamaMessage {
                role: m.role.as_str(),
                content: m.content.as_str(),
            })
            .collect(),
        stream: false,
        options: Some(OllamaOptions {
            temperature: req.temperature,
            num_predict: req.max_tokens,
        }),
    };
    let endpoint = std::env::var("MEMEX_OLLAMA_URL")
        .unwrap_or_else(|_| "http://localhost:11434".to_string());
    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama request: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "ollama {}: {}",
            status,
            String::from_utf8_lossy(&bytes)
        ));
    }
    let parsed: OllamaResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("ollama parse: {e}"))?;
    let content = parsed
        .message
        .and_then(|m| m.content)
        .unwrap_or_default();
    Ok(ChatResponse {
        provider_id: req.provider_id,
        model: req.model,
        content,
        usage: Some(TokenUsage {
            input_tokens: parsed.prompt_eval_count,
            output_tokens: parsed.eval_count,
        }),
    })
}

async fn list_ollama_models(client: &reqwest::Client) -> Result<Vec<String>, String> {
    let endpoint = std::env::var("MEMEX_OLLAMA_URL")
        .unwrap_or_else(|_| "http://localhost:11434".to_string());
    let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("ollama tags {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = json.get("models").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                out.push(name.to_string());
            }
        }
    }
    out.sort();
    Ok(out)
}
