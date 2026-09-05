const ENTRY_BYTES = 128;
const ARRAY_BYTES = 32;
/** Charges retained text and estimated entry overhead, not V8 heap or RSS. */
class BudgetCache {
    limitBytes;
    sizeOf;
    entries = new Map();
    chargedBytes = 0;
    hits = 0;
    misses = 0;
    evictions = 0;
    constructor(limitBytes, sizeOf) {
        this.limitBytes = limitBytes;
        this.sizeOf = sizeOf;
        if (!Number.isFinite(limitBytes) || limitBytes < 0) {
            throw new RangeError("Render cache budget must be finite and non-negative");
        }
    }
    memo(key, compute, usable = () => true) {
        const cached = this.entries.get(key);
        if (cached && usable(cached.value)) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            this.hits++;
            return cached.value;
        }
        this.misses++;
        const value = compute(cached?.value);
        const bytes = ENTRY_BYTES + key.length * 2 + this.sizeOf(value);
        if (bytes > this.limitBytes)
            return value;
        if (cached) {
            this.entries.delete(key);
            this.chargedBytes -= cached.bytes;
        }
        while (this.chargedBytes + bytes > this.limitBytes) {
            const oldest = this.entries.keys().next().value;
            this.chargedBytes -= this.entries.get(oldest).bytes;
            this.entries.delete(oldest);
            this.evictions++;
        }
        this.entries.set(key, { value, bytes });
        this.chargedBytes += bytes;
        return value;
    }
    clear() {
        this.entries.clear();
        this.chargedBytes = 0;
    }
    stats() {
        return { limitBytes: this.limitBytes, chargedBytes: this.chargedBytes, entries: this.entries.size,
            hits: this.hits, misses: this.misses, evictions: this.evictions };
    }
}
function lineBytes(lines) {
    let bytes = ARRAY_BYTES;
    for (const line of lines)
        bytes += ARRAY_BYTES + line.length * 2;
    return bytes;
}
/** A single budget shared by all tool rows of an extension instance. */
export class ToolRenderCache {
    layouts;
    counts;
    generation = 0;
    identities = new WeakMap();
    nextIdentity = 0;
    constructor(options = {}) {
        this.layouts = new BudgetCache(options.layoutBytes ?? 16 * 1024 * 1024, lineBytes);
        this.counts = new BudgetCache(options.countBytes ?? 2 * 1024 * 1024, () => 8);
    }
    scope() {
        const generation = this.generation;
        const owner = this;
        return {
            get active() { return generation === owner.generation; },
            identity: (source) => {
                let id = this.identities.get(source);
                if (id === undefined)
                    this.identities.set(source, id = this.nextIdentity++);
                return id;
            },
            lines: (key, compute) => generation === this.generation ? this.layouts.memo(key, compute) : compute(),
            count: (key, compute) => generation === this.generation ? this.counts.memo(key, compute) : compute(),
            prefix: (key, length, compute) => {
                const grow = (previous) => Array.from({ length }, (_, index) => previous?.[index] ?? compute(index));
                return generation === this.generation ? this.layouts.memo(key, grow, value => value.length >= length) : grow();
            },
        };
    }
    clear() {
        this.generation++;
        this.identities = new WeakMap();
        this.layouts.clear();
        this.counts.clear();
    }
    stats() {
        return { layouts: this.layouts.stats(), counts: this.counts.stats() };
    }
}
//# sourceMappingURL=render-cache.js.map