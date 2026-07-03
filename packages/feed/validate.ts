import { createHash } from "node:crypto";

export interface ProofNode {
  hash: string; // hex
  side: "left" | "right";
}

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export function foldProof(leaf: Uint8Array, nodes: ProofNode[]): Uint8Array {
  let acc = leaf;
  for (const n of nodes) {
    const sib = Buffer.from(n.hash, "hex");
    acc = n.side === "left" ? sha256(Buffer.concat([sib, acc])) : sha256(Buffer.concat([acc, sib]));
  }
  return acc;
}

export function verifyMerkle(leaf: Uint8Array, nodes: ProofNode[], root: Uint8Array): boolean {
  return Buffer.from(foldProof(leaf, nodes)).equals(Buffer.from(root));
}
