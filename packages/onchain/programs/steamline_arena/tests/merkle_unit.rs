use steamline_arena::merkle::{fold_proof, hash_leaf, ProofNode, SIDE_LEFT, SIDE_RIGHT};

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    solana_sha256_hasher::hashv(parts).to_bytes()
}

#[test]
fn hash_leaf_is_real_sha256() {
    // sha256("") = e3b0c442...b855, confirms hashv is SHA-256 (matches node:crypto).
    let h = hash_leaf(&[]);
    let expect = hex_lit("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert_eq!(h, expect);
}

#[test]
fn fold_matches_validate_ts_semantics() {
    let leaf = hash_leaf(b"score:fixture42:2-1");
    let sib_a = sha256(&[b"sibling-a"]);
    let sib_b = sha256(&[b"sibling-b"]);
    // Expected fold: node A is a left sibling, node B is a right sibling.
    let step1 = sha256(&[&sib_a, &leaf]); // left: sibling || acc
    let expected = sha256(&[&step1, &sib_b]); // right: acc || sibling
    let nodes = vec![
        ProofNode {
            hash: sib_a,
            side: SIDE_LEFT,
        },
        ProofNode {
            hash: sib_b,
            side: SIDE_RIGHT,
        },
    ];
    let root = fold_proof(leaf, &nodes).unwrap();
    assert_eq!(root, expected);
}

#[test]
fn fold_rejects_bad_side() {
    let leaf = hash_leaf(b"x");
    let nodes = vec![ProofNode {
        hash: [0u8; 32],
        side: 9,
    }];
    assert!(fold_proof(leaf, &nodes).is_err());
}

// Minimal hex decoder for the known vector (test-only).
fn hex_lit(s: &str) -> [u8; 32] {
    let bytes = s.as_bytes();
    let mut out = [0u8; 32];
    for i in 0..32 {
        let hi = (bytes[i * 2] as char).to_digit(16).unwrap() as u8;
        let lo = (bytes[i * 2 + 1] as char).to_digit(16).unwrap() as u8;
        out[i] = (hi << 4) | lo;
    }
    out
}
