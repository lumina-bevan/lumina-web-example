"use client";

import { WalletProviders } from "@/providers/wallet-providers";

export default function SigningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletProviders>{children}</WalletProviders>;
}
