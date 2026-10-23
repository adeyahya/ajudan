-- No hard daily cap by default: the budget is a usage view now (0 = no limit).
UPDATE `businesses` SET `daily_budget_usd` = 0;
