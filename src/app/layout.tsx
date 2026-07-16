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
  title: "떠먹여주는 금융경제 | AI 경제 리포트 분석기",
  description: "한국은행, 금융감독원 등 공공기관의 경제 리포트를 AI로 심층 분석합니다. 복잡한 금융·경제 보고서를 대학생도 이해할 수 있도록 쉽게 풀어드립니다.",
};

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
      <body>{children}</body>
    </html>
  );
}
