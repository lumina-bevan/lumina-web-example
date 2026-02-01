"use client";

import React from "react";
import {
  WalletProvider,
  WalletModalProvider,
  MidenWalletAdapter,
  PrivateDataPermission,
  AllowedPrivateData,
} from "@demox-labs/miden-wallet-adapter";

interface WalletProvidersProps {
  children: React.ReactNode;
}

export function WalletProviders({ children }: WalletProvidersProps) {
  const wallets = React.useMemo(() => {
    return [new MidenWalletAdapter({ appName: "Lumina Web Example" })];
  }, []);

  return (
    <WalletProvider
      wallets={wallets}
      privateDataPermission={PrivateDataPermission.UponRequest}
      allowedPrivateData={AllowedPrivateData.All}
      autoConnect
      onError={(error: unknown) => console.error("Wallet error:", error)}
    >
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  );
}
