// Adapted from Codex protocol/src/items.rs. Keep quick-xml's exact parsing
// semantics rather than interpreting this wrapper with an XML-shaped regex.
use quick_xml::de::from_str as from_xml_str;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename = "hook_prompt")]
struct HookPromptXml {
    #[serde(rename = "@hook_run_id")]
    hook_run_id: String,
    #[serde(rename = "$text")]
    #[allow(dead_code)]
    text: String,
}

pub fn is_hook_prompt(text: &str) -> bool {
    let trimmed = text.trim();
    let Ok(HookPromptXml { hook_run_id, .. }) = from_xml_str::<HookPromptXml>(trimmed) else {
        return false;
    };
    !hook_run_id.trim().is_empty()
}

// Only deserialization success matters here. Field order and validation match
// protocol.rs; ignored warehouse fields must not introduce new rejection rules.
#[allow(dead_code)]
#[derive(Deserialize)]
struct InterAgentCommunication {
    #[serde(default)]
    id: Option<String>,
    author: AgentPath,
    recipient: AgentPath,
    #[serde(default)]
    other_recipients: Vec<AgentPath>,
    content: String,
    #[serde(default)]
    encrypted_content: Option<String>,
    #[serde(default)]
    internal_chat_message_metadata_passthrough: Option<Metadata>,
    trigger_turn: bool,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct Metadata {
    #[serde(default)]
    turn_id: Option<String>,
    #[serde(default)]
    create_time: Option<serde_json::Number>,
    // The upstream DefaultOnError accepts any malformed value as absent.
    #[serde(default)]
    content_item_kinds: Option<serde::de::IgnoredAny>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(try_from = "String")]
struct AgentPath(String);

impl TryFrom<String> for AgentPath {
    type Error = &'static str;
    fn try_from(path: String) -> Result<Self, Self::Error> {
        if path == "/morpheus" {
            return Ok(Self(path));
        }
        let Some(stripped) = path.strip_prefix('/') else { return Err("invalid agent root"); };
        let mut segments = stripped.split('/');
        if segments.next() != Some("root") || stripped.ends_with('/') {
            return Err("invalid agent root");
        }
        for segment in segments {
            if segment.is_empty() || segment == "root" || !segment.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_') {
                return Err("invalid agent name");
            }
        }
        Ok(Self(path))
    }
}

pub fn is_inter_agent(text: &str) -> bool {
    serde_json::from_str::<InterAgentCommunication>(text).is_ok()
}
