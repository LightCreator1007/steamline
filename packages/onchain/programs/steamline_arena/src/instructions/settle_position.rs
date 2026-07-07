use anchor_lang::prelude::*;

use crate::errors::ArenaError;
use crate::events::PositionSettled;
use crate::state::{
    AgentBook, Match, Position, POS_LOST, POS_OPEN, POS_REFUNDED, POS_WON, SEED_POSITION,
    STATUS_OPEN, STATUS_VOIDED,
};

#[derive(Accounts)]
pub struct SettlePosition<'info> {
    #[account(
        constraint = game.status != STATUS_OPEN @ ArenaError::MatchStillOpen,
    )]
    pub game: Account<'info, Match>,
    #[account(
        mut,
        seeds = [SEED_POSITION, game.key().as_ref(), book.key().as_ref(), &position.signal_seq.to_le_bytes()],
        bump = position.bump,
        constraint = position.status == POS_OPEN @ ArenaError::PositionAlreadySettled,
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        constraint = book.key() == position.book @ ArenaError::NotBookAuthority,
    )]
    pub book: Account<'info, AgentBook>,
}

pub fn handler(ctx: Context<SettlePosition>) -> Result<()> {
    let game = &ctx.accounts.game;
    let position = &mut ctx.accounts.position;
    let book = &mut ctx.accounts.book;
    let stake = position.stake_points;

    if game.status == STATUS_VOIDED {
        // Refund: equity-neutral, P&L unchanged.
        book.bankroll_points = book
            .bankroll_points
            .checked_add(stake)
            .ok_or(ArenaError::MathOverflow)?;
        book.staked_points = book
            .staked_points
            .checked_sub(stake)
            .ok_or(ArenaError::MathOverflow)?;
        position.status = POS_REFUNDED;
        position.payout_points = 0;
    } else if position.outcome == game.settled_outcome {
        // Win: payout = round_half_up(stake * odds_milli / 1000). Parity with settle.ts.
        let numer = (stake as u128)
            .checked_mul(position.entry_odds_milli as u128)
            .ok_or(ArenaError::MathOverflow)?
            .checked_add(500)
            .ok_or(ArenaError::MathOverflow)?;
        let payout_u128 = numer.checked_div(1000).ok_or(ArenaError::MathOverflow)?;
        let payout: u64 = payout_u128
            .try_into()
            .map_err(|_| ArenaError::MathOverflow)?;
        book.bankroll_points = book
            .bankroll_points
            .checked_add(payout)
            .ok_or(ArenaError::MathOverflow)?;
        book.staked_points = book
            .staked_points
            .checked_sub(stake)
            .ok_or(ArenaError::MathOverflow)?;
        let delta = (payout as i64)
            .checked_sub(stake as i64)
            .ok_or(ArenaError::MathOverflow)?;
        book.realized_pnl = book
            .realized_pnl
            .checked_add(delta)
            .ok_or(ArenaError::MathOverflow)?;
        book.bets_won = book
            .bets_won
            .checked_add(1)
            .ok_or(ArenaError::MathOverflow)?;
        position.status = POS_WON;
        position.payout_points = payout;
    } else {
        // Loss.
        book.staked_points = book
            .staked_points
            .checked_sub(stake)
            .ok_or(ArenaError::MathOverflow)?;
        book.realized_pnl = book
            .realized_pnl
            .checked_sub(stake as i64)
            .ok_or(ArenaError::MathOverflow)?;
        book.bets_lost = book
            .bets_lost
            .checked_add(1)
            .ok_or(ArenaError::MathOverflow)?;
        position.status = POS_LOST;
        position.payout_points = 0;
    }

    emit!(PositionSettled {
        game: game.key(),
        book: book.key(),
        position: position.key(),
        status: position.status,
        payout_points: position.payout_points,
    });
    Ok(())
}
