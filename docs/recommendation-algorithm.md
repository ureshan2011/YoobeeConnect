# Recommendation Algorithm Proposal

This proposal outlines a lightweight server-side recommendation pipeline for
suggesting classmates with similar interests, backgrounds, and countries while
ensuring everyone receives at least one suggestion.

## Data Model Inputs

For each student profile, store:

- `interests`: normalized list of interest tags (e.g., "UI/UX", "Robotics").
- `background`: categorical or free-text summary mapped to canonical tags (e.g.,
  "Graphic Design", "Computer Science").
- `country`: ISO country code or normalized country name.
- `recent_matches`: timestamps or IDs of recent matches to avoid repeats.

## Feature Weighting

Assign similarity weights that reflect how strongly each attribute should
influence matching. Example weights:

- Interest overlap: **0.5** (primary driver of compatibility).
- Background overlap: **0.3**.
- Same country (or region group): **0.2**.

Weights can be tuned later with analytics.

## Candidate Scoring Algorithm

1. **Pre-filter** potential candidates:
   - Exclude the user themself, already matched users, or anyone the user has
     explicitly declined recently (cooldown window).
   - Optionally keep the pool within the same course cohort or time zone bands.

2. **Compute similarity score** for each remaining candidate `c` relative to the
   target user `u`:

   ```pseudo
   interest_score = jaccard(u.interests, c.interests)
   background_score = jaccard(u.background_tags, c.background_tags)
   country_score = 1 if same_country_or_region(u.country, c.country) else 0

   total_score = 0.5 * interest_score
               + 0.3 * background_score
               + 0.2 * country_score
   ```

   Where `jaccard(A, B) = |A ∩ B| / |A ∪ B|`. Background strings should be mapped
   to tags to make comparison robust.

3. **Diversity boost (optional):** Apply a small multiplier (e.g., `1.1`) to the
   score for candidates who contribute to diversity goals (different campus,
   underrepresented interests, etc.) to avoid homophily.

4. **Rank and select** the top `N` candidates by `total_score`.

## Guaranteed Suggestion Fallback

If every candidate yields a score of zero (no shared metadata), provide at least
one suggestion by:

1. Selecting the candidate with the smallest Hamming distance on country/region
   (i.e., prefer same region if interests/backdrop are missing).
2. If still tied, pick the least recently suggested candidate (to balance
   exposure).
3. Optionally randomize among the top few fallback candidates to avoid always
   showing the same person first.

This ensures users never face an empty deck while still leaning toward the
closest available match.

## Match Confirmation Logic

When user `u` swipes right on candidate `c`:

1. Check if `c` also swiped right on `u`.
2. If yes, create a match record and notify both users.
3. Otherwise, keep `c` in `u`'s candidate pool but adjust their priority (e.g.,
   reduce score slightly) to avoid repetitive resurfacing.

## Operational Considerations

- Cache the candidate pool per user to avoid recomputing on every swipe. Refresh
  periodically (e.g., daily) or when the user updates their profile.
- Log acceptance/decline events to recalibrate weights and interest taxonomies
  over time.
- Provide administrative controls to modify weights, cooldown windows, and
  fallback logic without redeploying the service.

This framework balances relevant similarities with inclusivity, ensuring every
student receives at least one recommendation while prioritizing meaningful
connections.
