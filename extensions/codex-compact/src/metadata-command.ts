import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getMetadataVersionStatus, isMetadataClientVersion, MetadataConfigError, updateGlobalMetadataClientVersion,
	type MetadataVersionStatus } from "./config.js";

const USAGE = "Usage: /codex-metadata [version <major.minor.patch>|reset]";

function feedback(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error"): void {
	if (ctx.hasUI) {
		try { ctx.ui.notify(message, type); return; } catch {}
	}
	try { console.error(message); } catch {}
}

function statusText(status: MetadataVersionStatus): string {
	return `Effective metadata client version: ${status.version} (${status.source}${status.sourcePath ? `, ${status.sourcePath}` : ""}). Global config: ${status.globalPath}.`;
}

function reportStatus(ctx: ExtensionCommandContext, status: MetadataVersionStatus, prefix = ""): void {
	const override = status.source === "project"
		? ` Project override remains active: ${status.version} (${status.sourcePath}).` : "";
	feedback(ctx, `${prefix}${statusText(status)}${override} ${USAGE}`, "info");
	for (const warning of status.warnings) feedback(ctx, `Metadata config warning: ${warning}`, "warning");
}

export function registerMetadataCommand(pi: Pick<ExtensionAPI, "registerCommand">): void {
	pi.registerCommand("codex-metadata", {
		description: "Show or set the Codex model catalog client version. Usage: /codex-metadata [version <version>|reset]",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			if (tokens.length === 0) {
				reportStatus(ctx, getMetadataVersionStatus(ctx.cwd ?? "", ctx.isProjectTrusted()));
				return;
			}
			if (!((tokens.length === 1 && tokens[0] === "reset")
				|| (tokens.length === 2 && tokens[0] === "version" && isMetadataClientVersion(tokens[1])))) {
				feedback(ctx, USAGE, "error");
				return;
			}
			const version = tokens[0] === "reset" ? undefined : tokens[1];
			try {
				updateGlobalMetadataClientVersion(version);
			} catch (error) {
				feedback(ctx, error instanceof MetadataConfigError ? error.message : "Metadata config update failed: unknown_error", "error");
				return;
			}
			const status = getMetadataVersionStatus(ctx.cwd ?? "", ctx.isProjectTrusted());
			reportStatus(ctx, status, version === undefined
				? `Reset global metadata client version at ${status.globalPath}. `
				: `Saved metadata client version ${version} to ${status.globalPath}. `);
		},
	});
}
