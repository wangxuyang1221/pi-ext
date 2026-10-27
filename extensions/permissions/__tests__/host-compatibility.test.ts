import { createTestUi } from "../../../test-support/pi-ui.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxProvider, fauxAssistantMessage, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import permissions from "../src/index.js";
import { APPROVAL_CHOICES } from "../src/permission-policy.js";

test.each([APPROVAL_CHOICES.ALLOW_ONCE, APPROVAL_CHOICES.DENY])("honors a real host tool-call approval: %s", async choice => {
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(resolve(".tmp/permissions-host-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const fixture = fauxProvider({ tokensPerSecond: 100000 });
    fixture.setResponses([fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content: "text" }), { stopReason: "toolUse" }), fauxAssistantMessage("Done")]);
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    modelRuntime.registerNativeProvider(fixture.provider);
    let executed = 0, prompted = 0;
    const errors: string[] = [];
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [pi => {
        permissions(pi, { env: { PI_PERMISSIONS_MODE: "default" } });
        pi.registerTool({ name: "write", label: "Write", description: "Fixture write", parameters: Type.Object({ path: Type.String(), content: Type.String() }),
          execute: async () => { executed++; return { content: [{ type: "text", text: "Fixture written" }], details: {} }; },
        });
      }],
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), settingsManager, sessionManager: SessionManager.inMemory(cwd), resourceLoader, modelRuntime, model: fixture.getModel(), noTools: "builtin" }));
    await session.bindExtensions({ mode: "tui", uiContext: { ...createTestUi(),
      setStatus() {}, select: async () => { prompted++; return choice; },
      theme: { fg: (_color: unknown, text: string) => text } as never,
    }, onError: error => { errors.push(error.error); } });
    await session.prompt("Run the fixture write");
    await session.waitForIdle();
    expect(errors).toEqual([]);
    expect(prompted).toBe(1);
    expect(executed).toBe(choice === APPROVAL_CHOICES.ALLOW_ONCE ? 1 : 0);
    expect(session.messages.filter(message => message.role === "toolResult").map(message => message.isError)).toEqual([choice === APPROVAL_CHOICES.DENY]);
  } finally { await session?.abort(); session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
