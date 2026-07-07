use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::MatchSettled;
use crate::state::{derive_outcome, Arena, Match, OUTCOME_AWAY, STATUS_OPEN, STATUS_SETTLED};

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ ArenaError::NotBookAuthority)]
    pub arena: Account<'info, Arena>,
    #[account(
        mut,
        constraint = game.arena == arena.key() @ ArenaError::MatchNotOpen,
        constraint = game.status == STATUS_OPEN @ ArenaError::MatchNotOpen,
    )]
    pub game: Account<'info, Match>,
}

pub fn handler(
    ctx: Context<SettleMatch>,
    _fixture_id: u64,
    home_score: u16,
    away_score: u16,
    settled_outcome: u8,
    score_proof_ref: [u8; 32],
) -> Result<()> {
    require!(settled_outcome <= OUTCOME_AWAY, ArenaError::InvalidOutcome);
    require!(
        settled_outcome == derive_outcome(home_score, away_score),
        ArenaError::InvalidOutcome
    );
    let clock = Clock::get()?;
    let game = &mut ctx.accounts.game;
    game.status = STATUS_SETTLED;
    game.home_score = home_score;
    game.away_score = away_score;
    game.settled_outcome = settled_outcome;
    game.verified = false;
    game.score_proof_ref = score_proof_ref;
    game.settled_at = clock.unix_timestamp;

    emit!(MatchSettled {
        game: game.key(),
        fixture_id: game.fixture_id,
        settled_outcome,
        verified: false,
    });
    Ok(())
}
