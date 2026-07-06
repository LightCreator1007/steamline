mod common;
use common::*;
use solana_sdk::signature::Signer;
use steamline_arena::state::{AgentBook, Arena};

#[test]
fn initialize_arena_sets_config_and_bump() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let a: Arena = load(&svm, &arena);
    assert_eq!(a.authority, payer.pubkey());
    assert_eq!(a.season_id, 2026);
    assert_eq!(a.starting_bankroll, STARTING_BANKROLL);
    assert_eq!(a.txoracle_program, TXORACLE);
    assert_eq!(a.epoch_day_width, 4);
    assert_eq!(a.roots_data_offset, 8);
    assert_eq!(a.match_count, 0);
}

#[test]
fn register_agent_is_permissionless_and_funds_bankroll() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 2026);
    let follow = solana_sdk::signature::Keypair::new();
    let book = register(
        &mut svm,
        &payer,
        &arena,
        &follow,
        *b"follow\0\0\0\0\0\0\0\0\0\0",
    );
    let b: AgentBook = load(&svm, &book);
    assert_eq!(b.authority, follow.pubkey());
    assert_eq!(b.bankroll_points, STARTING_BANKROLL);
    assert_eq!(b.staked_points, 0);
    assert_eq!(b.realized_pnl, 0);
}
