import { PublicKey } from "@solana/web3.js";

// Txoracle roots PDAs are seeded by name + epoch day (little-endian). The
// integer width is confirmed by probing which derivation has an existing
// account on-chain (Task 9); all three candidates are supported here.
export function deriveRootsPda(
  name: string,
  epochDay: number,
  programId: PublicKey,
  widthBytes: 2 | 4 | 8,
): PublicKey {
  const buf = Buffer.alloc(widthBytes);
  if (widthBytes === 2) buf.writeUInt16LE(epochDay);
  else if (widthBytes === 4) buf.writeUInt32LE(epochDay);
  else buf.writeBigUInt64LE(BigInt(epochDay));
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from(name), buf], programId);
  return pda;
}
