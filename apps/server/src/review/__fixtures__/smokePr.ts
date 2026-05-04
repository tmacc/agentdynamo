export const smokeReviewFixture = {
  baseRef: "main",
  headRef: "review-smoke",
  changedFiles: [
    "apps/server/src/review-fixture/user.ts",
    "apps/server/src/review-fixture/CLAUDE.md",
  ],
  claudeMd: "Do not use non-null assertions in request handlers.",
  diff: `diff --git a/apps/server/src/review-fixture/user.ts b/apps/server/src/review-fixture/user.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/apps/server/src/review-fixture/user.ts
@@ -0,0 +1,8 @@
+interface User {
+  name?: string | null;
+}
+
+export function displayName(user: User | null) {
+  return user!.name!.trim();
+}
+`,
} as const;
