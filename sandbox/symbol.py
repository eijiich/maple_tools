from datetime import datetime
import math

def days_to_max_symbols(current_symbols: int, daily_done: bool, weekly_done: bool, today: datetime) -> int:
    # Calculate symbols needed
    symbols_needed = 2679 - current_symbols
    today_weekday = today.weekday()  # Get today's weekday (Monday=0, Sunday=6)

    # If daily mission is not done and, subtract 20 symbols from the total symbols needed
    if not daily_done:
        symbols_needed -=20

    # If weekly mission is not done, subtract 1 week worth of symbols from the total symbols needed
    days_until_sunday = (6 - today_weekday) % 7  # Days until next Sunday
    if not weekly_done:
        symbols_needed -= 45

    # If symbols are already maxed after the above, return 0 days
    if symbols_needed <= 0:
        return 0
    # Calculate the number of full weeks and remaining days
    symbols_per_week = 20 * 7 + 45  # 185 symbols per week
    full_weeks = symbols_needed // symbols_per_week
    remaining_symbols = symbols_needed % symbols_per_week
    if remaining_symbols > days_until_sunday * 20:
        remaining_symbols -= 45

    # Calculate the number of days for the remaining symbols
    days_for_remaining = math.ceil(remaining_symbols / 20)

    # Total days = full_weeks * 7 + days_for_remaining + extra_days
    total_days = full_weeks * 7 + days_for_remaining #+ extra_days
    
    return total_days

# Example usage:
current_symbols = 0
daily_done = True
weekly_done = True
today = datetime(2025, 1, 27)
# today = datetime.today()

days_required = days_to_max_symbols(current_symbols, daily_done, weekly_done, today)
print(f"Days required to max symbols: {days_required}")