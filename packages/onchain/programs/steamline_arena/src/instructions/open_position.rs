use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::PositionOpened;
use crate::state::{
    AgentBook, Match, Position, OUTCOME_AWAY, POS_OPEN, SEED_POSITION, STATUS_OPEN,
};

#[derive(Accounts)]
#[instruction(fixture_id: u64, outcome: u8, stake_points: u64, entry_odds_milli: u32, edge_bps: i32, odds_msg_ref: [u8; 32], odds_ts: i64, signal_seq: u64)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ ArenaError::NotBookAuthority,
    )]
    pub book: Account<'info, AgentBook>,
    #[account(
        constraint = game.status == STATUS_OPEN @ ArenaError::MatchNotOpen,
    )]
    pub game: Account<'info, Match>,
    #[account(
        init,
        payer = authority,
        space = Position::DISCRIMINATOR.len() + Position::INIT_SPACE,
        seeds = [SEED_POSITION, game.key().as_ref(), book.key().as_ref(), &signal_seq.to_le_bytes()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<OpenPosition>,
    _fixture_id: u64,
    outcome: u8,
    stake_points: u64,
    entry_odds_milli: u32,
    edge_bps: i32,
    odds_msg_ref: [u8; 32],
    odds_ts: i64,
    signal_seq: u64,
) -> Result<()> {
    require!(outcome <= OUTCOME_AWAY, ArenaError::InvalidOutcome);

    let book = &mut ctx.accounts.book;
    require!(
        book.bankroll_points >= stake_points,
        ArenaError::InsufficientBankroll
    );
    book.bankroll_points = book
        .bankroll_points
        .checked_sub(stake_points)
        .ok_or(ArenaError::MathOverflow)?;
    book.staked_points = book
        .staked_points
        .checked_add(stake_points)
        .ok_or(ArenaError::MathOverflow)?;
    book.bets_opened = book
        .bets_opened
        .checked_add(1)
        .ok_or(ArenaError::MathOverflow)?;

    let position = &mut ctx.accounts.position;
    position.game = ctx.accounts.game.key();
    position.book = book.key();
    position.signal_seq = signal_seq;
    position.outcome = outcome;
    position.stake_points = stake_points;
    position.entry_odds_milli = entry_odds_milli;
    position.edge_bps = edge_bps;
    position.odds_msg_ref = odds_msg_ref;
    position.odds_ts = odds_ts;
    position.status = POS_OPEN;
    position.payout_points = 0;
    position.bump = ctx.bumps.position;

    emit!(PositionOpened {
        game: position.game,
        book: book.key(),
        position: position.key(),
        outcome,
        stake_points,
        entry_odds_milli,
        signal_seq,
    });
    Ok(())
}
