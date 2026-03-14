# Synthetic Store Daily Data Dictionary

Dataset: `synthetic_store_daily`

## Columns

- `Fiscal Date`:
  Date for the record in MM-DD-YYYY format.
- `Location Number and Desc`:
  Store identifier and description in the format
  "`<store_number> <store_name> - <city>, <state>`".
  Example: `232 TACOMA MALL - TACOMA, WA`.
- `Net Sales Retail Amt`:
  Net sales retail amount for the day.
- `Net Sales Retail Amt LY`:
  Net sales retail amount for the same day last year.
- `Net Sales Retail Amt Var LY %`:
  Year-over-year percent change in net sales retail amount.
- `Net Sales Qty`:
  Net sales quantity for the day.
- `Net Sales Qty LY`:
  Net sales quantity for the same day last year.
- `Net Sales Qty Var LY %`:
  Year-over-year percent change in net sales quantity.
- `Clr Net Sales Retail Amt`:
  Clearance net sales retail amount for the day.
- `Clr Net Sales Retail Amt LY`:
  Clearance net sales retail amount for the same day last year.
- `Clr Net Sales Retail Amt Var LY %`:
  Year-over-year percent change in clearance net sales retail amount.
- `Clearance Sales %`:
  Percentage of sales that are clearance (stored as numeric 0-100).
- `Clr Net Sales Qty`:
  Clearance net sales quantity for the day.
- `Clr Net Sales Qty LY`:
  Clearance net sales quantity for the same day last year.
- `Clr Net Sales Qty Var LY %`:
  Year-over-year percent change in clearance net sales quantity.
- `Selling Margin Amt`:
  Selling margin amount for the day.
- `Selling Margin Amt LY`:
  Selling margin amount for the same day last year.
- `Selling Margin % LY`:
  Selling margin percentage for the same day last year.
- `Selling Margin %`:
  Selling margin percentage for the day.
- `Net Sales AUR`:
  Net sales average unit retail for the day.
- `Net Sales AUR LY`:
  Net sales average unit retail for the same day last year.
- `Net Sales AUR Var LY %`:
  Year-over-year percent change in net sales AUR.

## Notes

- `Fiscal Date` is the only date column; there is no separate time-level field.
- There is no explicit `Region` column. Region can only be inferred
  from the state abbreviation embedded in `Location Number and Desc`.
- Location matching should use exact values from `Location Number and Desc`
  (for example, map "Tacoma" -> `232 TACOMA MALL - TACOMA, WA`).

# ATV/UPT Data Dictionary

Dataset: `synthetic_store_atv_upt`

## Columns

- `Org Wid`:
  Store number (matches the leading store number in `Location Number and Desc`).
- `Bucket`:
  Time bucket for the metrics. Known values: `YESTERDAY`, `WTD`, `MTD`, `YTD`.
- `ATV`:
  Average transaction value for the bucket.
- `UPT`:
  Units per transaction for the bucket.
- `Location Number and Desc`:
  Store identifier and description matched from the daily dataset.

## Notes

- Use `Bucket` to choose the time window for ATV/UPT questions.

# Department Performance Data Dictionary

Dataset: `synthetic_store_departments`

## Columns

- `Time Level - REQUIRED`:
  Time bucket for the metrics. Known values: `YESTERDAY`, `WTD`, `MTD`, `YTD`.
- `Location Number and Desc`:
  Store identifier and description.
- `Department Number and Desc`:
  Department identifier and description (e.g., `DEPT 809 ACTIVEWEAR`).
- `Sales %`:
  Department share of sales (numeric 0-100).
- `Sales Volume`:
  Department sales volume for the bucket.
- `vs LY`:
  Year-over-year percent change (numeric 0-100, can be negative).
- `Rank`:
  Rank within the store and bucket.

## Notes

- Use this table for department performance questions by store and time bucket.

# Sales Margin Data Dictionary

Dataset: `synthetic_store_sales_margin`

## Columns

- `Location Number and Desc`:
  Store identifier and description.
- `Time Level - REQUIRED`:
  Period bucket (DY, LW, WK, WTD, MTD, QTD, HTD, YTD).
- `Net Sales Retail Amt`, `Net Sales Retail Amt LY`, `Net Sales Retail Amt Var LY %`:
  Net sales retail amounts and year-over-year percent change.
- `Net Sales Qty`, `Net Sales Qty LY`, `Net Sales Qty Var LY %`:
  Net sales quantities and year-over-year percent change.
- `Clr Net Sales Retail Amt`, `Clr Net Sales Retail Amt LY`, `Clr Net Sales Retail Amt Var LY %`:
  Clearance net sales amounts and year-over-year percent change.
- `Clearance Sales %`:
  Clearance share of sales (numeric 0-100).
- `Clr Net Sales Qty`, `Clr Net Sales Qty LY`, `Clr Net Sales Qty Var LY %`:
  Clearance quantities and year-over-year percent change.
- `Selling Margin Amt`, `Selling Margin Amt LY`, `Selling Margin %`, `Selling Margin % LY`:
  Selling margin amounts and percentages.
- `Net Sales AUR`, `Net Sales AUR LY`, `Net Sales AUR Var LY %`:
  Average unit retail values and year-over-year percent change.

## Notes

- Use this table for summarized sales questions by time bucket.

# Gross Margin Data Dictionary

Dataset: `synthetic_store_gross_margin`

## Columns

- `Location Number and Desc`:
  Store identifier and description.
- `Time Level - REQUIRED`:
  Period bucket (DY, LW, WK, WTD, MTD, QTD, HTD, YTD).
- `Gross Margin Amt`, `Gross Margin Amt LY`:
  Gross margin amounts.
- `Gross Margin %`, `Gross Margin % LY`:
  Gross margin percentages.
- `Clr EOP Inv Qty`, `Reg POS EOP Inv Qty`, `Total EOP Qty`, `EOP Inv Qty`:
  End-of-period inventory quantities.
- `Reg POS Net Sales Qty`, `Clr Net Sales Qty`:
  Sales quantities by regular/clearance.
- `Inventory Health Index`:
  Inventory health index.
- `Total Sell Through%`, `Regular Sell Through%`, `Clearance Sell Through%`:
  Sell-through percentages.
- `Weeks Of Supply`:
  Weeks of supply.

## Notes

- Use this table for gross margin and inventory questions by time bucket.
