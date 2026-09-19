const fields = new Map(Object.entries({
    additional_tools: { required: ["role", "tools"] },
    message: { required: ["role", "content"], optional: ["phase"] },
    agent_message: { required: ["author", "recipient", "content"] },
    reasoning: { required: ["summary"], nullable: ["content", "encrypted_content"] },
    local_shell_call: { required: ["status", "action"], nullable: ["call_id"] },
    function_call: { required: ["name", "arguments", "call_id"], optional: ["namespace", "encrypted_function_args"] },
    tool_search_call: { required: ["execution", "arguments"], nullable: ["call_id"], optional: ["status"] },
    function_call_output: { required: ["output"], optional: ["call_id", "name", "namespace"] },
    custom_tool_call: { required: ["call_id", "name", "input"], optional: ["status", "namespace"] },
    custom_tool_call_output: { required: ["call_id", "output"], optional: ["name"] },
    tool_search_output: { required: ["status", "execution", "tools"], nullable: ["call_id"] },
    web_search_call: { required: [], optional: ["status", "action"] },
    image_generation_call: { required: ["status", "result"], optional: ["revised_prompt"] },
    compaction: { required: ["encrypted_content"] },
    configuration_update: { required: ["reasoning"] },
    compaction_trigger: { required: [] },
    context_compaction: { required: [], optional: ["encrypted_content"] },
}));
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function pick(value, required, nullable = [], optional = []) {
    const result = {};
    for (const key of required)
        result[key] = value[key];
    for (const key of nullable)
        result[key] = value[key] ?? null;
    for (const key of optional)
        if (value[key] !== undefined && value[key] !== null)
            result[key] = value[key];
    return result;
}
function contentPart(value) {
    if (!object(value))
        return value;
    switch (value.type) {
        case "input_text":
        case "output_text":
        case "summary_text":
        case "reasoning_text":
        case "text":
            return pick(value, ["type", "text"]);
        case "input_image": return pick(value, ["type", "image_url"], [], ["detail"]);
        case "input_audio": return pick(value, ["type", "audio_url"]);
        case "encrypted_content": return pick(value, ["type", "encrypted_content"]);
        default: return value;
    }
}
/** Mirror serialized valid Codex items, without mutating or validating wire input. */
export function responseItemEstimationView(input) {
    // Pi can supply shorthand message objects. Keep their actual framing rather
    // than claiming that these are valid Codex ResponseItem serde inputs.
    if (typeof input.type !== "string")
        return input;
    const type = input.type === "compaction_summary" ? "compaction" : input.type;
    const schema = fields.get(type);
    if (!schema)
        return { type: "other" };
    // Malformed known items have no official serde estimate. Keep the raw size
    // instead of throwing from a scheduling heuristic or inventing required data.
    if (schema.required.some((key) => input[key] === undefined))
        return input;
    const common = ["configuration_update", "compaction_trigger"].includes(type) ? [] : type === "additional_tools" ? ["id"] : ["id", "internal_chat_message_metadata_passthrough"];
    const result = { type, ...pick(input, schema.required, schema.nullable, [...(schema.optional ?? []), ...common]) };
    for (const key of ["content", "summary", "output"])
        if (Array.isArray(result[key]))
            result[key] = result[key].map(contentPart);
    if (type === "reasoning" && Array.isArray(result.content) && !result.content.some((part) => object(part) && part.type === "reasoning_text"))
        delete result.content;
    if (object(result.internal_chat_message_metadata_passthrough)) {
        const metadata = result.internal_chat_message_metadata_passthrough;
        const normalized = pick(metadata, [], [], ["turn_id", "create_time", "content_item_kinds"]);
        // DefaultOnError clears the complete field, not only malformed entries.
        if (normalized.content_item_kinds !== undefined && (!Array.isArray(normalized.content_item_kinds) || !normalized.content_item_kinds.every((kind) => typeof kind === "string")))
            delete normalized.content_item_kinds;
        result.internal_chat_message_metadata_passthrough = normalized;
    }
    if (type === "local_shell_call" && object(result.action))
        result.action = pick(result.action, ["type", "command"], ["timeout_ms", "working_directory", "env", "user"]);
    if (type === "web_search_call" && object(result.action)) {
        const action = result.action;
        const keys = action.type === "search" ? ["query", "queries"] : action.type === "open_page" ? ["url"] : action.type === "find_in_page" ? ["url", "pattern"] : undefined;
        result.action = keys ? pick(action, ["type"], [], keys) : { type: "other" };
    }
    if (type === "configuration_update" && object(result.reasoning))
        result.reasoning = pick(result.reasoning, ["effort"]);
    return result;
}
//# sourceMappingURL=response-item-estimation.js.map