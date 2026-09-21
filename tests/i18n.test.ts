import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLocale, translationCoverage } from "../src/i18n";

test("startup language detection works without Object.hasOwn", () => {
  const original = Object.getOwnPropertyDescriptor(Object, "hasOwn")!;
  try {
    Object.defineProperty(Object, "hasOwn", { ...original, value: undefined });
    assert.equal(detectLocale("ta-IN"), "ta");
    assert.equal(detectLocale("en-IN"), "en");
    assert.equal(detectLocale("unknown"), "en");
    assert.equal(
      translationCoverage("ta").translated,
      translationCoverage("ta").total,
    );
  } finally {
    Object.defineProperty(Object, "hasOwn", original);
  }
});
