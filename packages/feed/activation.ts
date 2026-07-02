import nacl from "tweetnacl";

export function buildActivationMessage(txSig: string, leagues: string, jwt: string): string {
  return `${txSig}:${leagues}:${jwt}`;
}

export function signActivation(message: string, secretKey: Uint8Array): string {
  const sig = nacl.sign.detached(new TextEncoder().encode(message), secretKey);
  return Buffer.from(sig).toString("base64");
}
