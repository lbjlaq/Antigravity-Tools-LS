use async_trait::async_trait;
use anyhow::Result;
use serde_json::json;
use crate::mappers::{ProtocolMapper, MapperChunk};
use crate::gemini::{GeminiContentRequest};

pub struct GeminiMapper;

#[async_trait]
impl ProtocolMapper for GeminiMapper {
    type Request = GeminiContentRequest;

    fn get_protocol() -> String {
        "gemini".to_string()
    }

    fn get_model(req: &Self::Request) -> &str {
        // Gemini 原生协议将模型放在 URL path 中，由上层路由注入到请求体
        req.model.as_deref().unwrap_or("gemini-native")
    }

    fn build_prompt(req: &Self::Request) -> Result<String> {
        let mut prompt = String::new();
        if let Some(tools_wrapper) = &req.tools {
            let mut unified_tools = vec![];
            for tw in tools_wrapper {
                if let Some(decls) = &tw.function_declarations {
                    for fn_decl in decls {
                        unified_tools.push(crate::tools::UnifiedToolDefinition {
                            name: fn_decl.name.clone(),
                            description: fn_decl.description.clone(),
                            parameters: fn_decl.parameters.clone().unwrap_or_else(|| json!({})),
                        });
                    }
                }
            }
            let tool_prompt = crate::tools::build_tool_system_prompt(&unified_tools);
            if !tool_prompt.is_empty() {
                prompt.push_str(&tool_prompt);
                prompt.push_str("\n\n");
                prompt.push_str("IMPORTANT: If you need to use any of the tools above, you MUST output a <tool_call> XML tag containing the tool name and arguments in JSON format.\n");
            }
        }

        if let Some(sys) = &req.system_instruction {
            for p in &sys.parts { if let Some(t) = &p.text { prompt.push_str(t); prompt.push_str("\n\n"); } }
        }
        for c in &req.contents {
            for p in &c.parts { if let Some(t) = &p.text { prompt.push_str(t); prompt.push('\n'); } }
        }
        Ok(prompt)
    }

    async fn map_delta(
        _model: &str,
        delta: String,
        is_final: bool,
        tool_call_buffer: &mut String,
        in_tool_call: &mut bool,
        _tool_call_index: &mut u32,
    ) -> Result<Vec<MapperChunk>> {
        let mut results = vec![];

        if is_final {
            results.push(MapperChunk {
                event: None,
                data: json!({ "candidates": [{ "content": { "parts": [] }, "finishReason": "STOP" }] }).to_string()
            });
            return Ok(results);
        }

        let mut pending_text = delta;
        while !pending_text.is_empty() {
            if !*in_tool_call {
                if let Some(start_idx) = pending_text.find("<tool_call>") {
                    let before_text = &pending_text[..start_idx];
                    if !before_text.is_empty() {
                        let chunk_json = json!({ "candidates": [{ "content": { "parts": [{ "text": before_text }] } }] });
                        results.push(MapperChunk { event: None, data: chunk_json.to_string() });
                    }
                    *in_tool_call = true;
                    pending_text = pending_text[start_idx + "<tool_call>".len()..].to_string();
                } else {
                    let chunk_json = json!({ "candidates": [{ "content": { "parts": [{ "text": pending_text }] } }] });
                    results.push(MapperChunk { event: None, data: chunk_json.to_string() });
                    pending_text = String::new();
                }
            } else {
                if let Some(end_idx) = pending_text.find("</tool_call>") {
                    let inner_text = &pending_text[..end_idx];
                    tool_call_buffer.push_str(inner_text);
                    
                    if let Ok(json_obj) = serde_json::from_str::<serde_json::Value>(tool_call_buffer.trim()) {
                        let name = json_obj.get("name").and_then(|v| v.as_str()).unwrap_or("unknown_tool").to_string();
                        let args = json_obj.get("arguments").cloned().unwrap_or_else(|| json!({}));
                        let chunk_json = json!({ "candidates": [{ "content": { "parts": [{ "functionCall": { "name": name, "args": args } }] }, "finishReason": "STOP" }] });
                        results.push(MapperChunk { event: None, data: chunk_json.to_string() });
                    }

                    pending_text = pending_text[end_idx + "</tool_call>".len()..].to_string();
                    *in_tool_call = false;
                    tool_call_buffer.clear();
                } else {
                    tool_call_buffer.push_str(&pending_text);
                    pending_text = String::new();
                }
            }
        }
        Ok(results)
    }
}
