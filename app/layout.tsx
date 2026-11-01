// app/layout.tsx
import type { Metadata } from "next";
import { Google_Sans, Google_Sans_Code } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
});

const code = Google_Sans_Code({
  variable: "--font-sans-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Air Draw → UI",
  description:
    "Draw a UI wireframe in the air with your finger and watch it become a live React component.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${code.variable} h-full antialiased`}>
      <body className="flex h-full flex-col bg-background">
        {children}
        <Toaster theme="light" position="bottom-center" />
      </body>
    </html>
  );
}
