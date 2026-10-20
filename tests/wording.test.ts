import test from "node:test";
import assert from "node:assert/strict";
import en from "../src/i18n/en.json";
import { translator } from "../src/i18n";
test("mobile wording uses exact registered sources and leaves unrelated words unchanged", () => {
  const t = translator("en", { Refresh: "Reload" });
  assert.equal(t("refresh"), "Reload");
  assert.equal(t("signOut"), en.signOut);
  assert.equal(translator("en", { Refresh: "{missing}" })("refresh"), "Refresh");
  assert.equal(translator("en", { Refresh: "" })("refresh"), "Refresh");
});
