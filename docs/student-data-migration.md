# Yoobee Connect migration guide (Swipe/Matches ➜ Student Data Hub)

This guide updates your Google Apps Script backend and clears old swipe/match data so only the new student data model remains.

## 1) Deploy the new Apps Script backend

1. Open your Google Apps Script project.
2. Replace your script code with `docs/apps-script-backend.gs` from this repository.
3. Save the project.
4. Deploy as a new web app version (or update your current deployment).
5. Ensure access is set so your front-end can call it (typically **Anyone with the link**).

## 2) (Recommended) Keep current spreadsheet, reuse profiles sheet

The new backend reuses the `profiles` sheet and maps old columns automatically when possible.

- Old `country` becomes `home_country` analytics input.
- Old `background` becomes `programme` analytics input.
- Old `teams` becomes `email` input.

## 3) Remove old student/swipe/match records

You said previous student data is not needed. Do one of these:

### Option A — API reset (fastest)

Send this POST request to your Apps Script URL:

```json
{
  "action": "reset_data",
  "confirmToken": "ERASE_ALL_2026"
}
```

This keeps headers but deletes all existing profile rows.

### Option B — Manual reset in Google Sheets

1. Open the spreadsheet linked to your Apps Script.
2. Open `profiles`.
3. Delete all data rows and keep the header row.
4. (Optional) Delete `swipes` and `matches` sheets entirely.

## 4) Update front-end

- `index.html` is now the main student registration + public dashboard page.
- `admin-dashboard.html` is now a read-only public dashboard view.

## 5) Verify

1. Submit one student in `index.html`.
2. Confirm the dashboard cards and charts update.
3. Call `?action=dashboard_summary` and verify JSON output.

