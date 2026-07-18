import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@flowgram.ai/free-layout-editor/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workflow",
  description: "Versioned workflow builder and runtime",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
