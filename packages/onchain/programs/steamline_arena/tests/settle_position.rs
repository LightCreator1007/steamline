mod common;
use common::*;
use solana_sdk::signature::Keypair;
use steamline_arena::state::{AgentBook, Position, POS_LOST, POS_REFUNDED, POS_WON};

// Mirrors packages/engine/settle.ts payout: round_half_up(stake * odds_milli / 1000).
fn expected_payout(stake: u64, odds_milli: u32) -> u64 {
    (((stake as u128) * (odds_milli as u128) + 500) / 1000) as u64
}

#[test]
fn winning_position_pays_parity_amount_and_updates_equity() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 42);
    let stake = 30_000u64;
    let odds = 1950u32; // 1.95
                        // outcome 0 (home), match ends 2-1 -> home wins.
    let pos = open_position(&mut svm, &agent, &book, &game, 42, 0, stake, odds, 0).unwrap();
    settle_match(&mut svm, &payer, &arena, &game, 42, 2, 1).unwrap();
    settle_position(&mut svm, &payer, &game, &pos, &book).unwrap();

    let p: Position = load(&svm, &pos);
    let b: AgentBook = load(&svm, &book);
    let payout = expected_payout(stake, odds);
    assert_eq!(p.status, POS_WON);
    assert_eq!(p.payout_points, payout);
    assert_eq!(b.bankroll_points, STARTING_BANKROLL - stake + payout);
    assert_eq!(b.staked_points, 0);
    assert_eq!(b.realized_pnl, payout as i64 - stake as i64);
    assert_eq!(b.bets_won, 1);
    // equity invariant
    assert_eq!(
        b.bankroll_points + b.staked_points,
        (STARTING_BANKROLL as i64 + b.realized_pnl) as u64
    );
}

#[test]
fn parity_with_engine_odd_boundary() {
    // stake 12345, odds 2.137 -> round_half_up(12345*2137/1000) matches settle.ts.
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 7);
    let pos = open_position(&mut svm, &agent, &book, &game, 7, 0, 12_345, 2137, 0).unwrap();
    settle_match(&mut svm, &payer, &arena, &game, 7, 1, 0).unwrap();
    settle_position(&mut svm, &payer, &game, &pos, &book).unwrap();
    let p: Position = load(&svm, &pos);
    assert_eq!(p.payout_points, expected_payout(12_345, 2137));
}

#[test]
fn losing_position_books_minus_stake() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 42);
    let stake = 40_000u64;
    let pos = open_position(&mut svm, &agent, &book, &game, 42, 0, stake, 1950, 0).unwrap();
    // outcome 0 (home) but match ends 0-2 (away).
    settle_match(&mut svm, &payer, &arena, &game, 42, 0, 2).unwrap();
    settle_position(&mut svm, &payer, &game, &pos, &book).unwrap();
    let p: Position = load(&svm, &pos);
    let b: AgentBook = load(&svm, &book);
    assert_eq!(p.status, POS_LOST);
    assert_eq!(b.bankroll_points, STARTING_BANKROLL - stake);
    assert_eq!(b.staked_points, 0);
    assert_eq!(b.realized_pnl, -(stake as i64));
    assert_eq!(b.bets_lost, 1);
}

#[test]
fn voided_match_refunds_and_preserves_equity() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 42);
    let stake = 25_000u64;
    let pos = open_position(&mut svm, &agent, &book, &game, 42, 1, stake, 3000, 0).unwrap();
    void_match(&mut svm, &payer, &arena, &game, 42).unwrap();
    settle_position(&mut svm, &payer, &game, &pos, &book).unwrap();
    let p: Position = load(&svm, &pos);
    let b: AgentBook = load(&svm, &book);
    assert_eq!(p.status, POS_REFUNDED);
    assert_eq!(b.bankroll_points, STARTING_BANKROLL);
    assert_eq!(b.staked_points, 0);
    assert_eq!(b.realized_pnl, 0);
}

#[test]
fn cannot_settle_position_while_match_open() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 42);
    let pos = open_position(&mut svm, &agent, &book, &game, 42, 0, 10_000, 1950, 0).unwrap();
    let r = settle_position(&mut svm, &payer, &game, &pos, &book);
    assert!(r.is_err());
}

#[test]
fn double_settle_position_fails() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 42);
    let pos = open_position(&mut svm, &agent, &book, &game, 42, 0, 10_000, 1950, 0).unwrap();
    settle_match(&mut svm, &payer, &arena, &game, 42, 2, 0).unwrap();
    settle_position(&mut svm, &payer, &game, &pos, &book).unwrap();
    let r = settle_position(&mut svm, &payer, &game, &pos, &book);
    assert!(r.is_err());
}
