import { Type } from 'typebox';
import subagent from '../../../../extensions/subagent/dist/index.js';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// Only the root fixture adds concurrent dispatch. Every dispatch uses the actual production tool.
export default function controller(pi: any) {
  const tools = new Map<string, any>();
  const proxy = new Proxy(pi, {
    get(target, property) {
      if (property === 'on') return (name: string, handler: any) => target.on(name, (event: any, ctx: any) => {
        if (name === 'session_start' && !process.env.PI_SUBAGENT_PARENT && existsSync(join(process.env.HOME!, 'leave-fault'))) {
          const ui = new Proxy(ctx.ui, { get(ui, key) {
            if (key === 'select') return async (...args: any[]) => {
              const choice = await ui.select(...args);
              return choice === 'Leave temporarily' ? 'End session' : choice;
            };
            return Reflect.get(ui, key);
          } });
          return handler(event, new Proxy(ctx, { get(context, key) { return key === 'ui' ? ui : Reflect.get(context, key); } }));
        }
        const path = join(process.env.HOME!, 'preflight-fault');
        if (name !== 'input' || !process.env.PI_SUBAGENT_PARENT || !existsSync(path)) return handler(event, ctx);
        const fault = readFileSync(path, 'utf8');
        const registry = new Proxy(ctx.modelRegistry, { get(registry, key) {
          if (key === 'hasConfiguredAuth') return () => false;
          if (key === 'getProviderAuth') return async () => { if (fault === 'authentication_failed') throw new Error('PRIVATE_AUTH_ERROR'); return undefined; };
          return Reflect.get(registry, key);
        } });
        const context = new Proxy(ctx, { get(context, key) {
          if (key === 'model' && fault === 'model_unavailable') return undefined;
          if (key === 'modelRegistry') return registry;
          return Reflect.get(context, key);
        } });
        return handler(event, context);
      });
      if (property === 'registerTool') return (tool: any) => {
        tools.set(tool.name, tool);
        target.registerTool(tool);
      };
      return Reflect.get(target, property);
    },
  });
  subagent(proxy, { extensionPath: new URL('./controller.ts', import.meta.url).pathname });
  if (process.env.PI_SUBAGENT_PARENT) return;
  pi.registerTool({
    name: 'audit_parallel', label: 'Concurrent production calls', description: 'Run production spawn calls in one concurrent reservation race.',
    parameters: Type.Object({ tasks: Type.Array(Type.String()) }),
    async execute(_id: string, args: { tasks: string[] }, signal: AbortSignal, _update: any, ctx: any) {
      const samples: any[] = [];
      const sample = () => {
        try {
          const state = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'subagents', 'sessions', ctx.sessionManager.getSessionId(), 'state.json'), 'utf8'));
          samples.push({ pending: state.reservations.length, uniqueProcesses: new Set([...state.children.map((c: any) => c.launch.processInstanceId), ...state.reservations.map((r: any) => r.processInstanceId)]).size });
        } catch { /* A state file is not required before the first reservation. */ }
      };
      const timer = setInterval(sample, 5);
      let results;
      try { results = await Promise.all(args.tasks.map(async task => {
        try { return { ok: true, value: await tools.get('subagent_spawn').execute(task, { task }, signal, undefined, ctx) }; }
        catch (error) { return { ok: false, error: String(error) }; }
      })); } finally { clearInterval(timer); sample(); }
      appendFileSync(join(process.env.HOME!, `capacity-${process.pid}.json`), JSON.stringify(samples));
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  });
}
