import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@questili\/razorpay-recurring-upi\/testing$/,
        replacement: fromRoot("./packages/core/src/testing.ts")
      },
      {
        find: /^@questili\/razorpay-recurring-upi\/storage\/in-memory$/,
        replacement: fromRoot("./packages/core/src/storage/in-memory.ts")
      },
      {
        find: /^@questili\/razorpay-recurring-upi$/,
        replacement: fromRoot("./packages/core/src/index.ts")
      },
      {
        find: /^@questili\/razorpay-recurring-upi-razorpay$/,
        replacement: fromRoot("./packages/razorpay/src/index.ts")
      },
      {
        find: /^@questili\/razorpay-recurring-upi-prisma$/,
        replacement: fromRoot("./packages/prisma-adapter/src/index.ts")
      }
    ]
  },
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/**/test/**", "packages/**/src/**/index.ts", "packages/nextjs-example/**"]
    }
  }
});
