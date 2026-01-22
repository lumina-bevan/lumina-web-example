import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PSWAP Partial Fill Test",
  description: "Reproduction of PSWAP partial fill issue",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
