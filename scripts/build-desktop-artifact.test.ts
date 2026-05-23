import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  createBuildConfig,
  isTransientMacNotarizationFailure,
  resolveBuildOptions,
  resolveDesktopBuildIconAssets,
  resolveDesktopProductName,
  resolveDesktopRuntimeDependencies,
  resolveDesktopUpdateChannel,
  resolveMockUpdateServerPort,
  resolveMockUpdateServerUrl,
} from "./build-desktop-artifact.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

it.layer(NodeServices.layer)("build-desktop-artifact", (it) => {
  it("resolves the dedicated nightly updater channel from nightly versions", () => {
    assert.equal(resolveDesktopUpdateChannel("0.0.17-nightly.20260413.42"), "nightly");
    assert.equal(resolveDesktopUpdateChannel("0.0.17"), "latest");
  });

  it("switches desktop packaging product names to nightly for nightly builds", () => {
    assert.equal(resolveDesktopProductName("0.0.17"), "Dynamo (Alpha)");
    assert.equal(resolveDesktopProductName("0.0.17-nightly.20260413.42"), "Dynamo (Nightly)");
  });

  it("switches desktop packaging icons to the nightly artwork for nightly versions", () => {
    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17"), {
      macIconPng: BRAND_ASSET_PATHS.productionMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    });

    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17-nightly.20260413.42"), {
      macIconPng: BRAND_ASSET_PATHS.nightlyMacIconPng,
      linuxIconPng: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    });
  });

  it.effect("enables hardened runtime and notarization only for signed macOS builds", () =>
    Effect.gen(function* () {
      const unsignedBuildConfig = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.0.17",
        false,
        false,
        undefined,
      );
      assert.deepStrictEqual(unsignedBuildConfig.mac, {
        target: ["dmg", "zip"],
        icon: "icon.icns",
        category: "public.app-category.developer-tools",
      });

      const signedBuildConfig = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.0.17",
        true,
        false,
        undefined,
      );
      assert.deepStrictEqual(signedBuildConfig.mac, {
        target: ["dmg", "zip"],
        icon: "icon.icns",
        category: "public.app-category.developer-tools",
        hardenedRuntime: true,
        entitlements: "apps/desktop/resources/entitlements.mac.plist",
        entitlementsInherit: "apps/desktop/resources/entitlements.mac.inherit.plist",
        notarize: true,
      });
    }),
  );

  it("omits bundled workspace packages from staged desktop dependencies", () => {
    assert.deepStrictEqual(
      resolveDesktopRuntimeDependencies(
        {
          "@effect/platform-node": "catalog:",
          "@t3tools/contracts": "workspace:*",
          "@t3tools/shared": "workspace:*",
          "@t3tools/ssh": "workspace:*",
          "@t3tools/tailscale": "workspace:*",
          effect: "catalog:",
          electron: "41.5.0",
        },
        {
          "@effect/platform-node": "4.0.0-beta.59",
          effect: "4.0.0-beta.59",
        },
      ),
      {
        "@effect/platform-node": "4.0.0-beta.59",
        effect: "4.0.0-beta.59",
      },
    );
  });

  it("falls back to the default mock update port when the configured port is blank", () => {
    assert.equal(resolveMockUpdateServerUrl(undefined), "http://localhost:3000");
    assert.equal(resolveMockUpdateServerUrl(4123), "http://localhost:4123");
  });

  it.effect("disables electron-builder publish auto-detection without an update repo", () =>
    Effect.gen(function* () {
      const previousUpdateRepository = process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY;
      const previousGitHubRepository = process.env.GITHUB_REPOSITORY;
      const previousGitHubToken = process.env.GH_TOKEN;

      try {
        delete process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY;
        delete process.env.GITHUB_REPOSITORY;
        process.env.GH_TOKEN = "token";

        const buildConfig = yield* createBuildConfig(
          "mac",
          "dmg",
          "0.0.17",
          false,
          false,
          undefined,
        );

        assert.equal(buildConfig.publish, null);
      } finally {
        if (previousUpdateRepository === undefined) {
          delete process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY;
        } else {
          process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY = previousUpdateRepository;
        }

        if (previousGitHubRepository === undefined) {
          delete process.env.GITHUB_REPOSITORY;
        } else {
          process.env.GITHUB_REPOSITORY = previousGitHubRepository;
        }

        if (previousGitHubToken === undefined) {
          delete process.env.GH_TOKEN;
        } else {
          process.env.GH_TOKEN = previousGitHubToken;
        }
      }
    }),
  );

  it("detects transient Apple notarytool throttling failures", () => {
    assert.equal(
      isTransientMacNotarizationFailure(`
        Failed to notarize via notarytool.
        Error: Unhandled error, code: serviceUnavailable, body:
        <h1>503 Slow Down</h1>
        <li>Message: Please reduce your request rate.</li>
      `),
      true,
    );
    assert.equal(
      isTransientMacNotarizationFailure("packaging failed: missing apps/server/dist/bin.mjs"),
      false,
    );
  });

  it("omits bundled workspace packages from staged desktop runtime dependencies", () => {
    assert.deepStrictEqual(
      resolveDesktopRuntimeDependencies(
        {
          "@effect/platform-node": "catalog:",
          "@t3tools/client-runtime": "workspace:*",
          "@t3tools/tailscale": "workspace:*",
          effect: "catalog:",
          electron: "40.9.3",
          "electron-updater": "^6.6.2",
        },
        {
          "@effect/platform-node": "4.0.0-beta.59",
          effect: "4.0.0-beta.59",
        },
      ),
      {
        "@effect/platform-node": "4.0.0-beta.59",
        effect: "4.0.0-beta.59",
        "electron-updater": "^6.6.2",
      },
    );
  });

  it.effect("normalizes mock update server ports from env-style strings", () =>
    Effect.gen(function* () {
      assert.equal(yield* resolveMockUpdateServerPort(undefined), undefined);
      assert.equal(yield* resolveMockUpdateServerPort(""), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("   "), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("4123"), 4123);
    }),
  );

  it.effect("rejects non-numeric or out-of-range mock update ports", () =>
    Effect.gen(function* () {
      const invalidPorts = ["abc", "12.5", "0", "65536"];
      for (const port of invalidPorts) {
        const exit = yield* Effect.exit(resolveMockUpdateServerPort(port));
        assert.equal(exit._tag, "Failure");
      }
    }),
  );

  it.effect("preserves explicit false boolean flags over true env defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveBuildOptions({
        platform: Option.some("mac"),
        target: Option.none(),
        arch: Option.some("arm64"),
        buildVersion: Option.none(),
        outputDir: Option.some("release-test"),
        skipBuild: Option.some(false),
        keepStage: Option.some(false),
        signed: Option.some(false),
        verbose: Option.some(false),
        mockUpdates: Option.some(false),
        mockUpdateServerPort: Option.none(),
      }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                T3CODE_DESKTOP_SKIP_BUILD: "true",
                T3CODE_DESKTOP_KEEP_STAGE: "true",
                T3CODE_DESKTOP_SIGNED: "true",
                T3CODE_DESKTOP_VERBOSE: "true",
                T3CODE_DESKTOP_MOCK_UPDATES: "true",
              },
            }),
          ),
        ),
      );

      assert.equal(resolved.skipBuild, false);
      assert.equal(resolved.keepStage, false);
      assert.equal(resolved.signed, false);
      assert.equal(resolved.verbose, false);
      assert.equal(resolved.mockUpdates, false);
    }),
  );
});
