import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Razorpay Recurring UPI — Example",
  description:
    "Next.js example app for @questili/razorpay-recurring-upi over Razorpay + Prisma."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#0f172a", background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
