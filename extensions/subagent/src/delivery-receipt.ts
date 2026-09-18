import { open } from "node:fs/promises";
import { currentOperation } from "./operation.js";

export const DELIVERY_RECEIPT_TYPE = "subagent_delivery";

export interface DeliveryReceipt {
  agentId: string;
  epoch: string;
  deliveryId: string;
  generation: number;
}

export function promptDeliveryId(text: string): string | undefined {
  return /^\[subagent:([a-f0-9]{12})\](?:\n|$)/u.exec(text)?.[1];
}

/** Scans only appended bytes, retaining at most one small receipt line per wait. */
export class DeliveryReceiptReader {
  private position = 0;
  private line = "";
  private oversized = false;
  private generation?: number;

  async read(sessionFile: string, expected: Omit<DeliveryReceipt, "generation">, signal = currentOperation()?.signal): Promise<number | undefined> {
    signal?.throwIfAborted();
    if (this.generation !== undefined) return this.generation;
    const file = await open(sessionFile, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      while (true) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(buffer, 0, buffer.length, this.position);
        if (bytesRead === 0) return undefined;
        this.position += bytesRead;
        let start = 0;
        for (let index = 0; index < bytesRead; index++) {
          if (buffer[index] !== 10) continue;
          this.add(buffer.subarray(start, index));
          if (!this.oversized) this.match(expected);
          this.line = "";
          this.oversized = false;
          start = index + 1;
          if (this.generation !== undefined) return this.generation;
        }
        this.add(buffer.subarray(start, bytesRead));
      }
    } finally { await file.close(); }
  }

  private add(bytes: Buffer): void {
    if (this.oversized) return;
    // Receipts contain ASCII identifiers only; large native message lines are skipped.
    if (this.line.length + bytes.length > 4096) {
      this.line = "";
      this.oversized = true;
    } else {
      this.line += bytes.toString("utf8");
    }
  }

  private match(expected: Omit<DeliveryReceipt, "generation">): void {
    if (!this.line.includes(DELIVERY_RECEIPT_TYPE)) return;
    let entry;
    try { entry = JSON.parse(this.line); } catch { return; }
    const data = entry?.data;
    if (entry?.type === "custom" && entry.customType === DELIVERY_RECEIPT_TYPE
      && data?.agentId === expected.agentId && data.epoch === expected.epoch
      && data.deliveryId === expected.deliveryId
      && Number.isSafeInteger(data.generation) && data.generation > 0) {
      this.generation = data.generation;
    }
  }
}
