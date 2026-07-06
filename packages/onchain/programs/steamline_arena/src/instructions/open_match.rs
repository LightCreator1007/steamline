use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::MatchOpened;
use crate::state::{Arena, Match, OUTCOME_NONE, SEED_MATCH, STATUS_OPEN};

#[derive(Accounts)]
#[instruction(fixture_id: u64)]
pub struct OpenMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ ArenaError::NotBookAuthority,
    )]
    pub arena: Account<'info, Arena>,
    #[account(
        init,
        payer = authority,
        space = Match::DISCRIMINATOR.len() + Match::INIT_SPACE,
        seeds = [SEED_MATCH, arena.key().as_ref(), &fixture_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Match>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<OpenMatch>, fixture_id: u64, start_time: i64) -> Result<()> {
    let arena = &mut ctx.accounts.arena;
    arena.match_count = arena
        .match_count
        .checked_add(1)
        .ok_or(ArenaError::MathOverflow)?;

    let game = &mut ctx.accounts.game;
    game.arena = arena.key();
    game.fixture_id = fixture_id;
    game.status = STATUS_OPEN;
    game.start_time = start_time;
    game.home_score = 0;
    game.away_score = 0;
    game.settled_outcome = OUTCOME_NONE;
    game.verified = false;
    game.score_proof_ref = [0u8; 32];
    game.settled_at = 0;
    game.bump = ctx.bumps.game;

    emit!(MatchOpened {
        arena: arena.key(),
        game: game.key(),
        fixture_id,
        start_time,
    });
    Ok(())
}
