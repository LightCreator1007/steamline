import { EngineError } from "../engine/errors.ts";

export type Network = "devnet" | "mainnet";

export interface FeedEnv {
  network: Network;
  apiBase: string;
  rpcUrl: string;
  txoracleProgramId: string;
  keypairPath: string;
  jwt?: string;
  apiToken?: string;
}

export const TXORACLE_DEVNET = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
export const TXORACLE_MAINNET = "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA";
export const RPC_DEVNET_DEFAULT = "https://api.devnet.solana.com";

export function loadEnv(
  src: Record<string, string | undefined>,
  network: Network = (src.TXLINE_NETWORK as Network) ?? "devnet",
): FeedEnv {
  if (network !== "devnet" && network !== "mainnet") {
    throw new EngineError("INVALID_INPUT", `unknown network ${network}`, "set TXLINE_NETWORK to devnet or mainnet");
  }
  const apiBase =
    network === "devnet"
      ? (src.TXLINE_DEVNET_API_BASE ?? "https://txline-dev.txodds.com")
      : src.TXLINE_MAINNET_API_BASE;
  if (!apiBase) {
    throw new EngineError(
      "INVALID_INPUT",
      "mainnet API base is not configured",
      "set TXLINE_MAINNET_API_BASE; confirm the URL from the TxLINE docs or Discord",
    );
  }
  const rpcUrl =
    network === "devnet"
      ? (src.SOLANA_DEVNET_RPC ?? RPC_DEVNET_DEFAULT)
      : (src.SOLANA_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com");
  const upper = network.toUpperCase();
  return {
    network,
    apiBase,
    rpcUrl,
    txoracleProgramId: network === "devnet" ? TXORACLE_DEVNET : TXORACLE_MAINNET,
    keypairPath: src.TXLINE_KEYPAIR_PATH ?? `keypairs/feed-${network}.json`,
    jwt: src[`TXLINE_JWT_${upper}`],
    apiToken: src[`TXLINE_API_TOKEN_${upper}`],
  };
}
