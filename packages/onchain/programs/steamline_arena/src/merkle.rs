use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::errors::ArenaError;

pub const SIDE_LEFT: u8 = 0;
pub const SIDE_RIGHT: u8 = 1;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub side: u8,
}

/// Hash a leaf preimage once with sha256. Mirrors validate.ts sha256(leafBytes).
pub fn hash_leaf(leaf_data: &[u8]) -> [u8; 32] {
    hashv(&[leaf_data]).to_bytes()
}

/// Fold sibling nodes into a root. Mirrors validate.ts foldProof exactly:
/// left sibling  -> sha256(sibling || acc); right sibling -> sha256(acc || sibling).
pub fn fold_proof(leaf: [u8; 32], nodes: &[ProofNode]) -> Result<[u8; 32]> {
    let mut acc = leaf;
    for node in nodes {
        acc = match node.side {
            SIDE_LEFT => hashv(&[&node.hash, &acc]).to_bytes(),
            SIDE_RIGHT => hashv(&[&acc, &node.hash]).to_bytes(),
            _ => return err!(ArenaError::BadProofSide),
        };
    }
    Ok(acc)
}
