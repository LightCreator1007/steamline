use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::ArenaInitialized;
use crate::state::{Arena, ROOT_PREFIX_MAX, SEED_ARENA};

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct InitializeArena<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Arena::DISCRIMINATOR.len() + Arena::INIT_SPACE,
        seeds = [SEED_ARENA, &season_id.to_le_bytes()],
        bump
    )]
    pub arena: Account<'info, Arena>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitializeArena>,
    season_id: u64,
    starting_bankroll: u64,
    txoracle_program: Pubkey,
    scores_root_prefix: [u8; ROOT_PREFIX_MAX],
    scores_root_prefix_len: u8,
    epoch_day_width: u8,
    roots_data_offset: u16,
) -> Result<()> {
    require!(
        (scores_root_prefix_len as usize) <= ROOT_PREFIX_MAX,
        ArenaError::InvalidVerificationConfig
    );
    require!(
        matches!(epoch_day_width, 2 | 4 | 8),
        ArenaError::InvalidVerificationConfig
    );

    let arena = &mut ctx.accounts.arena;
    arena.authority = ctx.accounts.authority.key();
    arena.season_id = season_id;
    arena.match_count = 0;
    arena.starting_bankroll = starting_bankroll;
    arena.txoracle_program = txoracle_program;
    arena.scores_root_prefix = scores_root_prefix;
    arena.scores_root_prefix_len = scores_root_prefix_len;
    arena.epoch_day_width = epoch_day_width;
    arena.roots_data_offset = roots_data_offset;
    arena.bump = ctx.bumps.arena;

    emit!(ArenaInitialized {
        arena: arena.key(),
        authority: arena.authority,
        season_id,
        starting_bankroll,
    });
    Ok(())
}
