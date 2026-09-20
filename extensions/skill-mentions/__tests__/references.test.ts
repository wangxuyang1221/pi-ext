import { describe, expect, it } from "vitest";
import { findReferences, completionReference } from "../src/references.js";

describe("reference boundaries", () => {
  it.each(["文字$alpha", "（$alpha）", "$alpha，继续", "($alpha)", "$alpha.", "$alpha\r", "$alpha\u00a0", "\\$alpha", "\\\\$alpha", "$alpha/beta", "$alpha:beta", "$5.00"])("leaves adjacent or escaped text alone: %s", text => {
    expect(findReferences(text)).toEqual([]);
    expect(completionReference(text, text.length)).toBeUndefined();
  });

  it("rejects cursor positions inside a name and allows the bare trigger", () => {
    expect(completionReference("$alpha", 3)).toBeUndefined();
    expect(completionReference("用 $ 后文", 3)?.name).toBe("");
  });

  it("uses the same prose boundaries for completion and activation around unmatched backticks", () => {
    const text = "an unmatched ` then $al";
    expect(completionReference(text, text.length)?.name).toBe("al");
  });

  it("treats unmatched backticks as prose on submission and recognizes quoted fences", () => {
    expect(findReferences("an unmatched ` then $alpha").map(item => item.name)).toEqual(["alpha"]);
    expect(findReferences("` unfinished\n\n$alpha").map(item => item.name)).toEqual(["alpha"]);
    expect(findReferences("> ```ts\n> $alpha\n> ```\n$beta").map(item => item.name)).toEqual(["beta"]);
    expect(findReferences("````\n$alpha\n```\n$beta\n````\n$gamma").map(item => item.name)).toEqual(["gamma"]);
  });

  it("recognizes fenced code inside list containers without hiding following prose", () => {
    expect(findReferences("- ~~~\n  $alpha\n  ~~~\n$beta").map(item => item.name)).toEqual(["beta"]);
    const draft = "- ~~~\n  $alpha\n  ~~~\n$be";
    expect(completionReference(draft, draft.length)?.name).toBe("be");
    expect(findReferences("1. ````ts\n   $alpha\n   ```\n   $beta\n   ````\n$gamma").map(item => item.name)).toEqual(["gamma"]);
  });

  it("keeps source identities through repeated names, tables, links and nested containers", () => {
    const text = "$alpha\n\n| A | B |\n| --- | --- |\n| ` $alpha ` | $beta |\n\n> - ~~~\n>   $alpha\n>   ~~~\n\n[ ` $beta ` ](https://example.com) $alpha";
    const found = findReferences(text);
    expect(found.map(item => item.name)).toEqual(["alpha", "beta", "alpha"]);
    for (const item of found) expect(text.slice(item.start, item.end)).toBe(`$${item.name}`);
  });

  it("excludes inline code with matching backtick runs and backtick or tilde fences", () => {
    const text = "$outside\n` $inline ` `` $double ` $nested ``\n```ts\n$fenced\n```\n~~~\n$tilde\n~~~\n$after";
    expect(findReferences(text).map(item => item.name)).toEqual(["outside", "after"]);
    expect(completionReference("before ` code $al `", 17)).toBeUndefined();
  });
  it("finds ordered whole tokens on any line with only space, tab or newline separators", () => {
    const text = "$alpha 用 $beta\n再用\t$alpha $partial";
    expect(findReferences(text).map(item => item.name)).toEqual(["alpha", "beta", "alpha", "partial"]);
    expect(completionReference("用 $al 后文", 5)?.name).toBe("al");
  });
});
