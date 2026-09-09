export declare const DELIVERY_RECEIPT_TYPE = "subagent_delivery";
export interface DeliveryReceipt {
    agentId: string;
    epoch: string;
    deliveryId: string;
    generation: number;
}
export declare function promptDeliveryId(text: string): string | undefined;
/** Scans only appended bytes, retaining at most one small receipt line per wait. */
export declare class DeliveryReceiptReader {
    private position;
    private line;
    private oversized;
    private generation?;
    read(sessionFile: string, expected: Omit<DeliveryReceipt, "generation">): Promise<number | undefined>;
    private add;
    private match;
}
//# sourceMappingURL=delivery-receipt.d.ts.map