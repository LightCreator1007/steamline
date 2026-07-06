#![allow(dead_code)]
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use steamline_arena::state::{ROOT_PREFIX_MAX, SEED_ARENA, SEED_BOOK, SEED_MATCH, SEED_POSITION};

pub const PROGRAM_ID: Pubkey = steamline_arena::ID;
pub const TXORACLE: Pubkey = solana_sdk::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
pub const STARTING_BANKROLL: u64 = 1_000_000_000;

pub fn program_so_path() -> String {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/steamline_arena.so"
    )
    .to_string()
}

pub fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(PROGRAM_ID, program_so_path())
        .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    (svm, payer)
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ix: Instruction,
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let bh = svm.latest_blockhash();
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra_signers);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &signers, bh);
    svm.send_transaction(tx).map(|_| ())
}

pub fn load<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).unwrap();
    T::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

pub fn arena_pda(season_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_ARENA, &season_id.to_le_bytes()], &PROGRAM_ID)
}

pub fn book_pda(arena: &Pubkey, authority: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_BOOK, arena.as_ref(), authority.as_ref()],
        &PROGRAM_ID,
    )
}

pub fn match_pda(arena: &Pubkey, fixture_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_MATCH, arena.as_ref(), &fixture_id.to_le_bytes()],
        &PROGRAM_ID,
    )
}

pub fn position_pda(game: &Pubkey, book: &Pubkey, signal_seq: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            SEED_POSITION,
            game.as_ref(),
            book.as_ref(),
            &signal_seq.to_le_bytes(),
        ],
        &PROGRAM_ID,
    )
}

pub fn default_prefix() -> ([u8; ROOT_PREFIX_MAX], u8) {
    let name = b"daily_scores_roots";
    let mut prefix = [0u8; ROOT_PREFIX_MAX];
    prefix[..name.len()].copy_from_slice(name);
    (prefix, name.len() as u8)
}

pub fn init_arena(svm: &mut LiteSVM, payer: &Keypair, season_id: u64) -> Pubkey {
    let (arena, _) = arena_pda(season_id);
    let (prefix, prefix_len) = default_prefix();
    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: steamline_arena::accounts::InitializeArena {
            authority: payer.pubkey(),
            arena,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: steamline_arena::instruction::InitializeArena {
            season_id,
            starting_bankroll: STARTING_BANKROLL,
            txoracle_program: TXORACLE,
            scores_root_prefix: prefix,
            scores_root_prefix_len: prefix_len,
            epoch_day_width: 4,
            roots_data_offset: 8,
        }
        .data(),
    };
    send(svm, payer, &[], ix).unwrap();
    arena
}

pub fn register(
    svm: &mut LiteSVM,
    payer: &Keypair,
    arena: &Pubkey,
    agent: &Keypair,
    tag: [u8; 16],
) -> Pubkey {
    let (book, _) = book_pda(arena, &agent.pubkey());
    svm.airdrop(&agent.pubkey(), 10_000_000_000).unwrap();
    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: steamline_arena::accounts::RegisterAgent {
            authority: agent.pubkey(),
            arena: *arena,
            book,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: steamline_arena::instruction::RegisterAgent { strategy_tag: tag }.data(),
    };
    send(svm, agent, &[], ix).unwrap();
    book
}
