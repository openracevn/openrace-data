import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrganizerListSchema } from "../scripts/lib/schema.ts";

describe("organizers", () => {
  it("accepts an organizer with sourced links and one without", () => {
    const list = [
      { id: "a", name: "A", website: null, links: [{ url: "https://a.vn", kind: "official", foundOn: "a.vn" }] },
      { id: "b", name: "B", website: null },
    ];
    assert.equal(OrganizerListSchema.safeParse(list).success, true);
  });
  it("rejects a link kind other than official/facebook", () => {
    const list = [{ id: "a", name: "A", website: null, links: [{ url: "https://a.vn", kind: "seller", foundOn: "a.vn" }] }];
    assert.equal(OrganizerListSchema.safeParse(list).success, false);
  });
});
