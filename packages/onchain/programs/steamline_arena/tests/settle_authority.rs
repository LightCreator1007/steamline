mod common;
use common::*;
use solana_sdk::signature::{Keypair, Signer};
use steamline_arena::state::{Match, STATUS_SETTLED, STATUS_VOIDED};

#[test]
fn settle_match_sets_outcome_unverified() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let game = open_match(&mut svm, &payer, &arena, 42);
    settle_match(&mut svm, &payer, &arena, &game, 42, 2, 1).unwrap();
    let g: Match = load(&svm, &game);
    assert_eq!(g.status, STATUS_SETTLED);
    assert_eq!(g.settled_outcome, 0);
    assert!(!g.verified);
}

#[test]
fn settle_match_rejects_non_authority() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let game = open_match(&mut svm, &payer, &arena, 42);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 5_000_000_000).unwrap();
    let r = settle_match(&mut svm, &attacker, &arena, &game, 42, 2, 1);
    assert!(r.is_err());
}

#[test]
fn double_settle_fails() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let game = open_match(&mut svm, &payer, &arena, 42);
    settle_match(&mut svm, &payer, &arena, &game, 42, 2, 1).unwrap();
    let r = settle_match(&mut svm, &payer, &arena, &game, 42, 0, 0);
    assert!(r.is_err());
}

#[test]
fn void_match_sets_voided() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let game = open_match(&mut svm, &payer, &arena, 42);
    void_match(&mut svm, &payer, &arena, &game, 42).unwrap();
    let g: Match = load(&svm, &game);
    assert_eq!(g.status, STATUS_VOIDED);
}
