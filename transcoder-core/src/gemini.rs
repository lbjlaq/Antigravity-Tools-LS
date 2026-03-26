use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct GeminiContentRequest {
    #[serde(default)]
    pub model: Option<String>,
    pub contents: Vec<GeminiContent>,
    #[serde(default)]
    pub system_instruction: Option<GeminiContent>,
    #[serde(default)]
    pub tools: Option<Vec<GeminiToolWrapper>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiToolWrapper {
    pub function_declarations: Option<Vec<GeminiFunctionDeclaration>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GeminiFunctionDeclaration {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub parameters: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiContent {
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiPart {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    #[serde(rename = "inlineData")]
    pub inline_data: Option<serde_json::Value>,
    #[serde(default)]
    #[serde(rename = "functionCall")]
    pub function_call: Option<serde_json::Value>,
    #[serde(default)]
    #[serde(rename = "functionResponse")]
    pub function_response: Option<serde_json::Value>,
}
