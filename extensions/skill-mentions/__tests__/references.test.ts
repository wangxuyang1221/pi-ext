import { describe, expect, it } from "vitest";
import { findReferences, completionReference } from "../src/references.js";

describe("reference boundaries", () => {
  it.each([...`,.;:!?，。；：！？、…)]}）］｝】》〉」』”’"'`])("accepts a closing delimiter without offering completion: %s", delimiter => {
    const text = `用 $alpha${delimiter}`;
    expect(findReferences(text)).toEqual([{ name: "alpha", start: 2, end: 8 }]);
    expect(completionReference(text, 8)).toBeUndefined();
  });
  it.each(["文字$alpha", "（$alpha）", "($alpha)", "$alpha\r", "$alpha\u00a0", "\\$alpha", "\\\\$alpha", "$alpha/beta", "$5.00"])("leaves adjacent or escaped text alone: %s", text => {
    expect(findReferences(text)).toEqual([]);
    expect(completionReference(text, text.length)).toBeUndefined();
  });

  it.each(["md", "中文", "é", "𐐀", "0", "９", "𝟠", "_", "-"])("does not end a reference at a period before %s", suffix => {
    const text = `$research.${suffix}`;
    expect(findReferences(text)).toEqual([]);
    expect(completionReference(text, "$research".length)).toBeUndefined();
  });

  it.each(["", " ", "\n", "\t", ",next", ".md", "/path", "@host", "😀", "\u0301"])("ends a reference at a period before a non-name character: %j", suffix => {
    expect(findReferences(`$research.${suffix}`)).toEqual([{ name: "research", start: 0, end: 9 }]);
  });

  it.each([...`,;:!?，。；：！？、…)]}）］｝】》〉」』”’"'`])("allows prose immediately after non-period delimiters: %s", delimiter => {
    const text = `$research${delimiter}继续`;
    expect(findReferences(text).map(item => item.name)).toEqual(["research"]);
    expect(completionReference(text, 9)).toBeUndefined();
  });

  it.each([...`/\\@#+=*([{［｛（【《〈「『“‘<>%&|^~`, "\r", "\u00a0", "\u3000", "\u200b", "—", "・"])("does not grant new boundaries to %j", delimiter => {
    expect(findReferences(`$research${delimiter}`)).toEqual([]);
    expect(findReferences(`${delimiter}$research,`)).toEqual([]);
    expect(completionReference(`$research${delimiter}`, 9)).toBeUndefined();
  });

  it.each([...`,.;:!?，。；：！？、…)]}）］｝】》〉」』”’"'`, "文字", "\\", "\\\\"])("does not relax the left boundary after %j", prefix => {
    expect(findReferences(`${prefix}$research,`)).toEqual([]);
  });

  it("keeps Unicode and hyphenated names whole with exact source offsets", () => {
    const text = "😀 $研究_𐐀-𝟠，继续\n$research-extra! $research_other. $research";
    const found = findReferences(text);
    expect(found.map(item => item.name)).toEqual(["研究_𐐀-𝟠", "research-extra", "research_other", "research"]);
    for (const reference of found) expect(text.slice(reference.start, reference.end)).toBe(`$${reference.name}`);
    expect(found[0].start).toBe(3);
  });

  it.each([
    "`$research,`", "`` $research! ` $research. ``", "```ts\n$research，\n```",
    "~~~\n$research。\n~~~", "> ```\n> $research!\n> ```", "- ~~~\n  $research;\n  ~~~",
    "    $research,", "[ `$research,` ](https://example.com)",
  ])("excludes punctuated references in Markdown code: %s", code => {
    expect(findReferences(`${code}\n\n$after,`).map(item => item.name)).toEqual(["after"]);
    const cursor = code.indexOf("$research") + "$research".length;
    expect(completionReference(code, cursor)).toBeUndefined();
  });

  it.each(["", " ", "\n", "\t"])("keeps completion at the name end with strict separators: %j", separator => {
    const prefix = separator ? `用${separator}` : "";
    const text = `${prefix}$research${separator}`;
    const cursor = prefix.length + "$research".length;
    expect(completionReference(text, cursor)?.name).toBe("research");
    for (let position = prefix.length + 1; position < cursor; position++) {
      expect(completionReference(text, position)).toBeUndefined();
    }
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
