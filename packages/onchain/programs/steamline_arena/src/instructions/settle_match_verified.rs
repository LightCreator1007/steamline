use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::MatchSettled;
use crate::merkle::{fold_proof, hash_leaf, ProofNode};
use crate::state::{
    derive_outcome, Arena, Match, MAX_LEAF_DATA, MAX_PROOF_NODES, OUTCOME_AWAY, STATUS_OPEN,
    STATUS_SETTLED,
};

#[derive(Accounts)]
pub struct SettleMatchVerified<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ ArenaError::NotBookAuthority)]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        constraint = game.arena == arena.key() @ ArenaError::MatchNotOpen,
        constraint = game.status == STATUS_OPEN @ ArenaError::MatchNotOpen,
    )]
    pub game: Account<'info, Match>,
    /// CHECK: validated in the handler: the owner must be arena.txoracle_program
    /// and the key must equal the derived daily_scores_roots PDA for epoch_day.
    pub roots: UncheckedAccount<'info>,
}

// F2 (provisional): the proof establishes that leaf_data is a member of TxLINE's
// published scores Merkle tree anchored by the Txoracle roots account. It does
// NOT yet bind leaf_data to the score args, so the scores stay trusted until the
// leaf preimage format is pinned. This is why the wording is "provenance-verified"
// and not "trustless"; the upgrade path reconstructs the leaf in-program and drops
// the leaf_data argument.
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<SettleMatchVerified>,
    _fixture_id: u64,
    home_score: u16,
    away_score: u16,
    settled_outcome: u8,
    epoch_day: u64,
    leaf_data: Vec<u8>,
    proof: Vec<ProofNode>,
) -> Result<()> {
    require!(settled_outcome <= OUTCOME_AWAY, ArenaError::InvalidOutcome);
    require!(
        settled_outcome == derive_outcome(home_score, away_score),
        ArenaError::InvalidOutcome
    );
    require!(proof.len() <= MAX_PROOF_NODES, ArenaError::ProofTooLarge);
    require!(leaf_data.len() <= MAX_LEAF_DATA, ArenaError::LeafTooLarge);

    let txoracle = ctx.accounts.arena.txoracle_program;
    let width = ctx.accounts.arena.epoch_day_width as usize;
    let offset = ctx.accounts.arena.roots_data_offset as usize;
    let prefix_len = ctx.accounts.arena.scores_root_prefix_len as usize;
    let prefix = ctx.accounts.arena.scores_root_prefix;
    require!(
        prefix_len <= prefix.len() && matches!(width, 2 | 4 | 8),
        ArenaError::InvalidVerificationConfig
    );

    let roots_info = ctx.accounts.roots.to_account_info();

    // 1. Roots account is owned by the configured Txoracle program.
    require!(roots_info.owner == &txoracle, ArenaError::WrongRootsOwner);

    // 2. Roots account key is the canonical daily_scores_roots PDA for this epoch
    //    day (little-endian, seed width from arena config), under Txoracle.
    let epoch_bytes = epoch_day.to_le_bytes();
    let (expected, _bump) =
        Pubkey::find_program_address(&[&prefix[..prefix_len], &epoch_bytes[..width]], &txoracle);
    require!(roots_info.key() == expected, ArenaError::WrongRootsPda);

    // 3. Read the anchored root at the configured offset.
    let mut anchored = [0u8; 32];
    {
        let data = roots_info.try_borrow_data()?;
        let end = offset
            .checked_add(32)
            .ok_or(ArenaError::RootsOffsetOutOfBounds)?;
        require!(data.len() >= end, ArenaError::RootsOffsetOutOfBounds);
        anchored.copy_from_slice(&data[offset..end]);
    }

    // 4. The proof must fold the leaf back to the anchored root.
    let leaf = hash_leaf(&leaf_data);
    let computed = fold_proof(leaf, &proof)?;
    require!(computed == anchored, ArenaError::ProofMismatch);

    // 5. Settle, marked verified, anchoring the proven root as provenance.
    let clock = Clock::get()?;
    let game = &mut ctx.accounts.game;
    game.status = STATUS_SETTLED;
    game.home_score = home_score;
    game.away_score = away_score;
    game.settled_outcome = settled_outcome;
    game.verified = true;
    game.score_proof_ref = anchored;
    game.settled_at = clock.unix_timestamp;

    emit!(MatchSettled {
        game: game.key(),
        fixture_id: game.fixture_id,
        settled_outcome,
        verified: true,
    });
    Ok(())
}
