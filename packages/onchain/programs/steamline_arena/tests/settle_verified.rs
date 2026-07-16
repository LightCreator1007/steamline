mod common;
use common::*;

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_sdk::{account::Account, instruction::Instruction, pubkey::Pubkey, signature::Signer};
use steamline_arena::merkle::{fold_proof, hash_leaf, ProofNode, SIDE_RIGHT};
use steamline_arena::state::{Match, STATUS_SETTLED};

const SCORES_NAME: &[u8] = b"daily_scores_roots";
const EPOCH_DAY: u64 = 20_648;
const WIDTH: usize = 4; // init_arena uses epoch_day_width = 4
const OFFSET: usize = 8; // init_arena uses roots_data_offset = 8

fn roots_pda(epoch_day: u64) -> Pubkey {
    let ed = epoch_day.to_le_bytes();
    let (pda, _) = Pubkey::find_program_address(&[SCORES_NAME, &ed[..WIDTH]], &TXORACLE);
    pda
}

// A synthetic Txoracle roots account: owned by TXORACLE, carrying `root` at the
// configured offset. LiteSVM lets us place raw state at the derived PDA address.
fn place_roots(svm: &mut litesvm::LiteSVM, root: [u8; 32]) -> Pubkey {
    let key = roots_pda(EPOCH_DAY);
    let mut data = vec![0u8; OFFSET + 32];
    data[OFFSET..OFFSET + 32].copy_from_slice(&root);
    svm.set_account(
        key,
        Account {
            lamports: 1_000_000,
            data,
            owner: TXORACLE,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    key
}

#[allow(clippy::too_many_arguments)]
fn settle_verified_ix(
    authority: Pubkey,
    arena: Pubkey,
    game: Pubkey,
    roots: Pubkey,
    fixture_id: u64,
    home: u16,
    away: u16,
    leaf_data: Vec<u8>,
    proof: Vec<ProofNode>,
) -> Instruction {
    let outcome = if home > away {
        0
    } else if home < away {
        2
    } else {
        1
    };
    Instruction {
        program_id: PROGRAM_ID,
        accounts: steamline_arena::accounts::SettleMatchVerified {
            authority,
            arena,
            game,
            roots,
        }
        .to_account_metas(None),
        data: steamline_arena::instruction::SettleMatchVerified {
            fixture_id,
            home_score: home,
            away_score: away,
            settled_outcome: outcome,
            epoch_day: EPOCH_DAY,
            leaf_data,
            proof,
        }
        .data(),
    }
}

// leaf -> sha256(leaf || sibling) via a single right sibling; anchored root is
// exactly that fold, so a correct proof reproduces it.
fn sample_proof() -> (Vec<u8>, Vec<ProofNode>, [u8; 32]) {
    let leaf_data = b"scores:18237038:0:2".to_vec();
    let proof = vec![ProofNode {
        hash: [9u8; 32],
        side: SIDE_RIGHT,
    }];
    let anchored = fold_proof(hash_leaf(&leaf_data), &proof).unwrap();
    (leaf_data, proof, anchored)
}

#[test]
fn settle_verified_marks_match_verified() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 55);
    let fixture_id = 18_237_038u64;
    let game = open_match(&mut svm, &payer, &arena, fixture_id);

    let (leaf_data, proof, anchored) = sample_proof();
    let roots = place_roots(&mut svm, anchored);

    let ix = settle_verified_ix(
        payer.pubkey(),
        arena,
        game,
        roots,
        fixture_id,
        0,
        2,
        leaf_data,
        proof,
    );
    send(&mut svm, &payer, &[], ix).unwrap();

    let m: Match = load(&svm, &game);
    assert_eq!(m.status, STATUS_SETTLED);
    assert!(m.verified);
    assert_eq!(m.home_score, 0);
    assert_eq!(m.away_score, 2);
    assert_eq!(m.settled_outcome, 2);
    assert_eq!(m.score_proof_ref, anchored);
}

#[test]
fn settle_verified_rejects_bad_proof() {
    let (mut svm, payer) = setup();
    let arena = init_arena(&mut svm, &payer, 56);
    let fixture_id = 18_237_038u64;
    let game = open_match(&mut svm, &payer, &arena, fixture_id);

    let (leaf_data, proof, _anchored) = sample_proof();
    // Anchor a different root, so the proof cannot reproduce it.
    let roots = place_roots(&mut svm, [1u8; 32]);

    let ix = settle_verified_ix(
        payer.pubkey(),
        arena,
        game,
        roots,
        fixture_id,
        0,
        2,
        leaf_data,
        proof,
    );
    assert!(
        send(&mut svm, &payer, &[], ix).is_err(),
        "bad proof must be rejected"
    );
}
