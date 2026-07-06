mod common;
use common::*;
use solana_sdk::signature::{Keypair, Signer};
use steamline_arena::state::{AgentBook, Position, POS_OPEN};

fn base() -> (
    litesvm::LiteSVM,
    Keypair,
    solana_sdk::pubkey::Pubkey,
    Keypair,
    solana_sdk::pubkey::Pubkey,
    solana_sdk::pubkey::Pubkey,
) {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let agent = Keypair::new();
    let book = register(&mut svm, &payer, &arena, &agent, [1u8; 16]);
    let game = open_match(&mut svm, &payer, &arena, 42);
    (svm, payer, arena, agent, book, game)
}

#[test]
fn open_position_debits_bankroll_and_stores_odds() {
    let (mut svm, _payer, _arena, agent, book, game) = base();
    let pos = open_position(&mut svm, &agent, &book, &game, 42, 0, 30_000, 1950, 0).unwrap();
    let p: Position = load(&svm, &pos);
    assert_eq!(p.status, POS_OPEN);
    assert_eq!(p.stake_points, 30_000);
    assert_eq!(p.entry_odds_milli, 1950);
    assert_eq!(p.outcome, 0);
    let b: AgentBook = load(&svm, &book);
    assert_eq!(b.bankroll_points, STARTING_BANKROLL - 30_000);
    assert_eq!(b.staked_points, 30_000);
    assert_eq!(b.bets_opened, 1);
}

#[test]
fn open_position_rejects_stake_above_bankroll() {
    let (mut svm, _payer, _arena, agent, book, game) = base();
    let r = open_position(
        &mut svm,
        &agent,
        &book,
        &game,
        42,
        0,
        STARTING_BANKROLL + 1,
        1950,
        0,
    );
    assert!(r.is_err());
}

#[test]
fn open_position_requires_book_authority_to_sign() {
    let (mut svm, _payer, _arena, _agent, book, game) = base();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 5_000_000_000).unwrap();
    // attacker signs but is not book.authority; has_one authority fails.
    let r = open_position(&mut svm, &attacker, &book, &game, 42, 0, 1000, 1950, 0);
    assert!(r.is_err());
}

#[test]
fn double_open_same_signal_seq_fails() {
    let (mut svm, _payer, _arena, agent, book, game) = base();
    open_position(&mut svm, &agent, &book, &game, 42, 0, 30_000, 1950, 5).unwrap();
    let r = open_position(&mut svm, &agent, &book, &game, 42, 1, 10_000, 2100, 5);
    assert!(
        r.is_err(),
        "reusing signal_seq must collide with the existing Position PDA"
    );
}
