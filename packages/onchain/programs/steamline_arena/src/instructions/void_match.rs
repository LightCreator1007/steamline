use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::MatchVoided;
use crate::state::{Arena, Match, STATUS_OPEN, STATUS_VOIDED};

#[derive(Accounts)]
pub struct VoidMatch<'info> {
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

pub fn handler(ctx: Context<VoidMatch>, _fixture_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let game = &mut ctx.accounts.game;
    game.status = STATUS_VOIDED;
    game.settled_at = clock.unix_timestamp;

    emit!(MatchVoided {
        game: game.key(),
        fixture_id: game.fixture_id,
    });
    Ok(())
}
