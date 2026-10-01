import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "떠먹여주는 금융경제 | 금융·경제 보고서 분석",
  description: "한국은행·금융감독원 등의 PDF 보고서를 올리고 궁금한 챕터를 골라 보세요. 주요 내용과 수치를 풀어 설명하고, 차트로 정리합니다.",
};

import { AuthProvider } from "@/lib/auth-context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" translate="no" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
