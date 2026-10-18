import { describe, expect, it } from "vitest";

import { matchAcceptLanguage, matchLocale, resources, serverT } from "../src/i18n";
import { compare, flatten, paramsOf } from "../src/i18n/keys";
import { fmtDecimal, fmtHour } from "../src/i18n/format";

describe("matchLocale", () => {
  it("accepts the shipped languages, with regions and case", () => {
    expect(matchLocale("en")).toBe("en");
    expect(matchLocale("en-US")).toBe("en");
    expect(matchLocale("EN_gb")).toBe("en");
    expect(matchLocale("id")).toBe("id");
    expect(matchLocale("id-ID")).toBe("id");
  });
  it("falls back to Indonesian for anything else", () => {
    for (const value of ["fr", "", "english", undefined, null, 5, {}]) expect(matchLocale(value)).toBe("id");
  });
});

describe("matchAcceptLanguage", () => {
  it("takes the best shipped language by quality, then order", () => {
    expect(matchAcceptLanguage("en-US,en;q=0.9,id;q=0.8")).toBe("en");
    expect(matchAcceptLanguage("fr-FR,id;q=0.7,en;q=0.9")).toBe("en");
    expect(matchAcceptLanguage("id,en;q=0.5")).toBe("id");
    expect(matchAcceptLanguage("en;q=0,id")).toBe("id");
  });
  it("is Indonesian with no usable header", () => {
    expect(matchAcceptLanguage(null)).toBe("id");
    expect(matchAcceptLanguage("fr,de;q=0.4")).toBe("id");
  });
});

describe("serverT", () => {
  it("interpolates params and keeps an unknown placeholder visible", () => {
    expect(serverT("id")("push:family.poke.title", { name: "Dina" })).toBe("Dina menanyakan kabarmu");
    expect(serverT("en")("push:family.poke.title", { name: "Dina" })).toBe("Dina is checking in on you");
    expect(serverT("en")("push:family.poke.title")).toBe("{{name}} is checking in on you");
  });
  it("picks the plural form by the locale's rules: English has one, Indonesian only other", () => {
    const en = serverT("en");
    expect(en("push:family.alert.noSteps.body", { label: "Mom", count: 1, time: "11:00 AM" })).toContain("only 1 step has");
    expect(en("push:family.alert.noSteps.body", { label: "Mom", count: 0, time: "11:00 AM" })).toContain("only 0 steps have");
    const id = serverT("id");
    expect(id("push:family.alert.noSteps.body", { label: "Ibu", count: 1, time: "11.00" })).toBe("Sampai jam 11.00 baru 1 langkah tercatat dari Ibu. Mungkin jamnya belum dipakai. Coba tanya kabarnya.");
  });
  it("answers the key itself for an unknown one", () => {
    expect(serverT("en")("push:nope" as never)).toBe("push:nope");
  });
});

describe("format", () => {
  it("writes decimals and clock hours the way the locale does", () => {
    expect(fmtDecimal(5.5, "id")).toBe("5,5");
    expect(fmtDecimal(5.5, "en")).toBe("5.5");
    expect(fmtDecimal(5, "id")).toBe("5");
    expect(fmtHour(7, "id")).toBe("07.00");
    expect(fmtHour(13, "en")).toBe("1:00 PM");
    expect(fmtHour(0, "en")).toBe("12:00 AM");
  });
});

describe("resources", () => {
  it("English has every key Indonesian has, once per plural category, and nothing else", () => {
    expect(compare(resources.id, resources.id, "id")).toEqual({ missing: [], orphan: [] });
    expect(compare(resources.id, resources.en, "en")).toEqual({ missing: [], orphan: [] });
  });
  it("uses the same {{params}} in both languages", () => {
    const id = flatten(resources.id);
    const en = flatten(resources.en);
    for (const [key, text] of id) {
      const base = key.replace(/_other$/, "");
      const counterparts = [...en].filter(([k]) => k === key || k.startsWith(`${base}_`)).map(([, value]) => value);
      expect(counterparts.length, key).toBeGreaterThan(0);
      for (const other of counterparts) expect(paramsOf(other), key).toEqual(paramsOf(text));
    }
  });
});
