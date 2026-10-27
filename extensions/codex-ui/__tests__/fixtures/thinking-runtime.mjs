import assert from "node:assert/strict";
import { join } from "node:path";

import { thinking, longThinking, reply, readResult } from "./thinking-data.mjs";

const root = process.env.THINKING_TEST_ROOT;
const repo = process.env.THINKING_TEST_REPO;
if (!root || !repo) throw new Error("Run thinking-cli.mjs instead.");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled in the thinking acceptance"); };
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const { stripTerminalSequences } = await import("@earendil-works/pi-tui");
const codexUi = (await import("../../dist/index.js")).default;
const transformers = [];
const faux = ai.fauxProvider({ provider:"openai-codex", tokensPerSecond:100, tokenSize:{min:8,max:8} });
const models = await sdk.ModelRuntime.create({ credentials:new ai.InMemoryCredentialStore(),
  modelsStore:new ai.InMemoryModelsStore(), modelsPath:null, allowModelNetwork:false, refreshOnCreate:false });
models.registerNativeProvider(faux.provider);
const cwd = join(root,"workspace");
let ready = true;
const extension = pi => {
  codexUi({ ...pi, registerMarkdownTransformer(transform) {
    transformers.push(transform);
    pi.registerMarkdownTransformer(transform);
  }});
  pi.registerCommand("play", { description:"Replay offline thinking: /play or /play long", handler:async (args,ctx) => {
    if (!ready || !ctx.isIdle()) return;
    ready = false;
    faux.setResponses([ai.fauxAssistantMessage([{type:"thinking",thinking:args.trim() === "long" ? longThinking : thinking},
      {type:"text",text:"Replay complete. No model or network request was made."}])]);
    pi.sendUserMessage("Replay the thinking fixture.");
  }});
  pi.on("agent_settled", () => { ready = true; });
  pi.on("input", event => event.source === "extension" ? {action:"continue"} : {action:"handled"});
  pi.on("tool_call", () => ({block:true,reason:"Tool execution is disabled in this visual acceptance."}));
  pi.on("user_bash", () => ({result:{output:"Shell execution is disabled.",exitCode:0,cancelled:false,truncated:false}}));
  pi.on("session_before_compact", () => ({cancel:true}));
};
const sessions = sdk.SessionManager.inMemory(cwd);
sessions.appendMessage({role:"user",content:"Compare the thinking layouts without changing the reply or tool UI.",timestamp:1});
sessions.appendMessage({...ai.fauxAssistantMessage([
  {type:"thinking",thinking},
  {type:"toolCall",id:"fixture-read",name:"read",arguments:{path:"src/display.ts"}},
],{stopReason:"toolUse"}),timestamp:2});
sessions.appendMessage({role:"toolResult",toolCallId:"fixture-read",toolName:"read",
  content:[{type:"text",text:readResult}],isError:false,timestamp:3});
sessions.appendMessage({...ai.fauxAssistantMessage(reply),timestamp:4});
const create = async ({cwd,sessionManager,sessionStartEvent}) => {
  const services = await sdk.createAgentSessionServices({
    cwd,agentDir:join(root,"agent"),modelRuntime:models,
    settingsManager:sdk.SettingsManager.inMemory({quietStartup:true,theme:"codex-pi",hideThinkingBlock:false,
      outputPad:1,retry:{enabled:false},compaction:{enabled:false},terminal:{showImages:false}}),
    resourceLoaderOptions:{noExtensions:true,noSkills:true,noThemes:true,noContextFiles:true,noPromptTemplates:true,
      additionalThemePaths:[join(repo,"themes/codex-pi.json")],systemPromptOverride:() => "Offline visual fixture",
      extensionFactories:[extension]},
  });
  return {...await sdk.createAgentSessionFromServices({services,sessionManager,sessionStartEvent,model:faux.getModel(),noTools:"builtin"}),
    services,diagnostics:services.diagnostics};
};
const runtime = await sdk.createAgentSessionRuntime(create,{cwd,agentDir:join(root,"agent"),sessionManager:sessions});
try {
  if (process.argv.includes("--smoke")) {
    await runtime.session.bindExtensions({});
    sdk.initTheme("dark",false);
    const message = runtime.session.messages.find(m => m.role === "assistant" && m.content.some(c => c.type === "thinking"));
    const before = JSON.stringify(message);
    const row = new sdk.AssistantMessageComponent(message,false,undefined,"Thinking...",1,transformers);
    const output = row.render(80).map(stripTerminalSequences).join("\n");
    assert.match(output,/Checking the rendering boundary/u);
    assert.equal(transformers.length,1);
    assert.equal(output.match(/│ Thinking/gu)?.length,1);
    row.setHideThinkingBlock(true);
    assert.doesNotMatch(row.render(80).map(stripTerminalSequences).join("\n"),/Checking the rendering boundary/u);
    assert.equal(JSON.stringify(message),before);
    let deltas = 0;
    const off = runtime.session.subscribe(event => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") deltas++;
    });
    faux.setResponses([ai.fauxAssistantMessage([{type:"thinking",thinking:"Offline stream fixture."},{type:"text",text:"Complete."}])]);
    await runtime.session.prompt("Replay",{source:"extension"});
    off();
    assert.ok(deltas > 0);
    console.log(JSON.stringify({passed:true,host:`Pi ${sdk.VERSION}`,production:true,thinkingDeltas:deltas,networkAttempts}));
  } else {
    const interactive = new sdk.InteractiveMode(runtime,{migratedProviders:[],tuiMode:process.argv.includes("--fullscreen") ? "fullscreen" : "regular"});
    await interactive.run();
  }
} finally {
  await runtime.session.abort(); await runtime.dispose();
  assert.equal(networkAttempts,0);
}
