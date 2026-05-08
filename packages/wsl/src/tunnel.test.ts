import { describe, expect, it } from "vitest";

import { buildRemoteLaunchScript } from "@t3tools/ssh/tunnel";

describe("WSL launch script contract", () => {
  it("uses the existing remote backend runner with loopback binding", () => {
    const script = buildRemoteLaunchScript({ packageSpec: "t3@1.2.3" });
    expect(script).toContain("serve --host 127.0.0.1 --port");
    expect(script).toContain("npx --yes 't3@1.2.3'");
    expect(script).toContain("npm exec --yes 't3@1.2.3' --");
  });
});
