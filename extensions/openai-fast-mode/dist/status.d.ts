import { type FastModeConfig, type ModelRef } from "./types.js";
export type StatusText = "fast" | undefined;
export type StatusContext = {
    hasUI?: boolean;
    mode?: string;
    ui?: {
        setStatus?: (key: string, text: string | undefined) => void;
        setWidget?: (key: string, content: undefined, options?: {
            placement?: "aboveEditor" | "belowEditor";
        }) => void;
    };
};
export declare function getStatusText(config: FastModeConfig, model: ModelRef | undefined): StatusText;
export declare function canSetTuiStatus(ctx: StatusContext): boolean;
export declare function updateFastStatus(ctx: StatusContext, config: FastModeConfig, model: ModelRef | undefined): void;
export declare function clearFastStatus(ctx: StatusContext): void;
//# sourceMappingURL=status.d.ts.map