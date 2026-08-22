# boq-test — local behavioural test harness

Tests BOQ schemas against the **real engine**. `boq-test.mjs` imports `boq.js`'s
`_internal` export, so there is no port to drift out of sync with production.

Every DB lookup inside `calculate()` fails closed — escalation 1.0, no regional
factors, no duty — so runs are deterministic and need **no network, no Supabase
credentials, no `.env`**. Prices are therefore un-escalated; that is correct for
behavioural testing, where the question is whether an input changes the price at
all, not what the escalated figure is.

## Setup

    mkdir boqtest && cd boqtest
    cp /path/to/api/boq.js .
    cp boq-test.mjs .
    echo '{"type":"module"}' > package.json

Node 18+. No dependencies to install.

## Use

    node boq-test.mjs check   ./SCHEMAS                 # all schemas
    node boq-test.mjs check   ./SCHEMAS/X.json -v       # one, verbose
    node boq-test.mjs golden  ./SCHEMAS -o golden.json  # snapshot every price
    node boq-test.mjs compare ./SCHEMAS -g golden.json  # regression after a change
    node boq-test.mjs calc    ./SCHEMAS/X.json --set area=500 --set moc=SS316L

`BOQ_ENGINE=/path/to/boq.js` overrides the engine location.

Exit code 0 = no FAILs, 1 = at least one FAIL. Use it in CI or a pre-commit hook.

## Checks

| Code | Level | What it catches |
|---|---|---|
| `unpriceable` | FAIL | baseline item returns NO_BASELINE |
| `dead-input` | FAIL | a **mandatory** field that does not change the price |
| `missing-table` | FAIL | a formula names a factor table that does not exist |
| `rule-dead` | FAIL | a compliance rule that cannot fire for any input combination |
| `no-unity` | WARN | factor table with no 1.00 datum — every price skewed |
| `tier-empty` | WARN | a tier selects no factor table |
| `size-flat` | WARN | price responds to no numeric field |
| `uncalibrated` | WARN | baseline prices carrying `verify=true` |

`dead-input` is the important one. It is invisible to `schema_lint.py`, which
checks structure only. A schema can lint at 0 FAIL and still discard every
mandatory input the estimator fills in.

## Typical workflow

    node boq-test.mjs golden ./SCHEMAS -o before.json   # before any change
    # ... edit schemas ...
    node boq-test.mjs compare ./SCHEMAS -g before.json  # prove nothing moved
    node boq-test.mjs check ./SCHEMAS                   # and nothing regressed

## Known limits

- `rule-dead` probes at most 3 fields per rule and 24 values per field. A rule
  needing 4+ specific fields simultaneously may read as dead when it is merely
  hard to reach. Verify before deleting one.
- `dead-input` tests each field against the **first** baseline item. A field that
  is live for item 7 but dead for item 1 reads as dead. Re-run per item before
  acting on a single result.
- Offline runs use escalation 1.0. To reproduce production figures, supply the
  real factors or run against the live API.
